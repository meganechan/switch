from __future__ import annotations

import logging
from typing import Annotated, Any

from authlib.integrations.starlette_client import OAuth, OAuthError
from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.ext.asyncio import AsyncSession
from starlette.responses import RedirectResponse

from switch_core.config import SwitchConfig
from switch_core.db.stores.user_store import UserStore
from switch_core.gateway.auth import set_session_cookie
from switch_core.gateway.dependencies import get_config, get_session, get_user_store

logger = logging.getLogger(__name__)

router = APIRouter()

# Module-level OAuth registry. The single gateway client is registered once at
# app construction (see register_oidc_client) when OIDC is configured.
oauth = OAuth()
_CLIENT_NAME = "gateway_oidc"


def register_oidc_client(config: SwitchConfig) -> None:
    """Register the gateway OIDC client from config.

    Endpoints (authorize / token / jwks / issuer) are discovered from the
    provider's well-known metadata, so this works against any standards
    compliant IdP (Okta, Keycloak, Auth0, …) — bring-your-own.
    """
    oauth.register(
        name=_CLIENT_NAME,
        server_metadata_url=config.gateway_oidc_metadata_url,
        client_id=config.gateway_oidc_client_id,
        client_secret=config.gateway_oidc_client_secret,
        client_kwargs={"scope": config.gateway_oidc_scopes},
    )


def _client() -> Any:
    # authlib is untyped here; the returned StarletteOAuth2App exposes
    # authorize_redirect / authorize_access_token / userinfo.
    client = oauth.create_client(_CLIENT_NAME)
    if client is None:
        raise HTTPException(status_code=404, detail="OIDC login is not configured")
    return client


@router.get("/auth/oidc/login")
async def oidc_login(
    request: Request,
    config: Annotated[SwitchConfig, Depends(get_config)],
):
    if not config.gateway_oidc_enabled:
        raise HTTPException(status_code=404, detail="OIDC login is not configured")
    client = _client()
    # The redirect URI must exactly match the one registered with the IdP.
    # Behind a reverse proxy / Tailscale the request URL's scheme+host can't be
    # trusted, so prefer the explicitly configured value.
    redirect_uri = config.gateway_oidc_redirect_url or str(
        request.url_for("oidc_callback")
    )
    return await client.authorize_redirect(request, redirect_uri)


@router.get("/auth/oidc/callback", name="oidc_callback")
async def oidc_callback(
    request: Request,
    config: Annotated[SwitchConfig, Depends(get_config)],
    session: Annotated[AsyncSession, Depends(get_session)],
    user_store: Annotated[UserStore, Depends(get_user_store)],
) -> RedirectResponse:
    if not config.gateway_oidc_enabled:
        raise HTTPException(status_code=404, detail="OIDC login is not configured")
    client = _client()
    try:
        # Server-side code→token exchange + id_token signature/nonce/aud
        # validation against the discovered JWKS.
        token = await client.authorize_access_token(request)
    except OAuthError as exc:
        logger.warning("OIDC callback failed: %s", exc)
        raise HTTPException(status_code=401, detail="OIDC authentication failed")

    claims = token.get("userinfo")
    if not claims:
        claims = await client.userinfo(token=token)
    email = claims.get("email")
    sub = claims.get("sub")
    if not email or not sub:
        logger.error("OIDC claims missing email/sub (got %s)", sorted(claims))
        raise HTTPException(
            status_code=401, detail="OIDC token missing email or sub claim"
        )
    name = claims.get("name") or email.split("@")[0]

    user = await user_store.get_or_create_oidc_user(
        session, email=email, name=name, sub=sub
    )
    await session.commit()

    # Verify-at-login only: we don't persist the IdP tokens. Land the browser
    # back on the SPA with our own session cookie set.
    response = RedirectResponse(url=config.frontend_base_url or "/", status_code=303)
    set_session_cookie(
        response, user, config.jwt_secret_key, config.gateway_cookie_secure
    )
    return response
