from __future__ import annotations

import logging
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Response
from sqlalchemy.ext.asyncio import AsyncSession

from switch_core.config import SwitchConfig
from switch_core.db.models import User
from switch_core.db.stores.user_store import UserStore
from switch_core.gateway.auth import (
    get_current_user,
    hash_password,
    require_admin,
    set_session_cookie,
    verify_password,
)
from switch_core.gateway.dependencies import get_config, get_session, get_user_store
from switch_core.gateway.schemas import (
    AuthConfigResponse,
    CreateUserRequest,
    LoginRequest,
    UserResponse,
)

logger = logging.getLogger(__name__)

router = APIRouter()


@router.post("/auth/login")
async def login(
    req: LoginRequest,
    response: Response,
    session: Annotated[AsyncSession, Depends(get_session)],
    user_store: Annotated[UserStore, Depends(get_user_store)],
    config: Annotated[SwitchConfig, Depends(get_config)],
) -> UserResponse:
    if not config.gateway_password_login_enabled:
        raise HTTPException(status_code=403, detail="Password login is disabled")

    user = await user_store.get_by_email(session, req.email)
    if user is None or not verify_password(req.password, user.password_hash):
        raise HTTPException(status_code=401, detail="Invalid email or password")

    set_session_cookie(
        response, user, config.jwt_secret_key, config.gateway_cookie_secure
    )
    return UserResponse(
        id=user.id,
        name=user.name,
        email=user.email,
        role=user.role,
        created_at=str(user.created_at),
    )


@router.post("/auth/refresh")
async def refresh(
    response: Response,
    user: Annotated[User, Depends(get_current_user)],
    config: Annotated[SwitchConfig, Depends(get_config)],
) -> UserResponse:
    # Re-mint the switch_auth cookie from the still-valid session so an active
    # client renews before expiry without re-authenticating — provider-agnostic
    # (works for password and OIDC users alike, since it re-issues from the User
    # rather than replaying either login flow). get_current_user rejects a
    # missing/expired/invalid cookie with 401, so an expired session cannot renew
    # itself; the client falls back to interactive sign-in in that case.
    set_session_cookie(
        response, user, config.jwt_secret_key, config.gateway_cookie_secure
    )
    return UserResponse(
        id=user.id,
        name=user.name,
        email=user.email,
        role=user.role,
        created_at=str(user.created_at),
    )


@router.post("/auth/logout")
async def logout(response: Response) -> dict[str, bool]:
    response.delete_cookie("switch_auth", path="/")
    return {"ok": True}


@router.get("/auth/config")
async def auth_config(
    config: Annotated[SwitchConfig, Depends(get_config)],
) -> AuthConfigResponse:
    # Unauthenticated on purpose: the login page reads this before any session
    # exists to decide which login methods to offer.
    return AuthConfigResponse(
        password_login_enabled=config.gateway_password_login_enabled,
        oidc_enabled=config.gateway_oidc_enabled,
        oidc_provider_label=config.gateway_oidc_provider_label,
    )


@router.get("/auth/me")
async def me(
    user: Annotated[User, Depends(get_current_user)],
) -> UserResponse:
    return UserResponse(
        id=user.id,
        name=user.name,
        email=user.email,
        role=user.role,
        created_at=str(user.created_at),
    )


@router.get("/users")
async def list_users(
    session: Annotated[AsyncSession, Depends(get_session)],
    user_store: Annotated[UserStore, Depends(get_user_store)],
    _admin: Annotated[User, Depends(require_admin)],
) -> list[UserResponse]:
    users = await user_store.get_all(session)
    return [
        UserResponse(
            id=u.id,
            name=u.name,
            email=u.email,
            role=u.role,
            created_at=str(u.created_at),
        )
        for u in users
    ]


@router.post("/users")
async def create_user(
    req: CreateUserRequest,
    session: Annotated[AsyncSession, Depends(get_session)],
    user_store: Annotated[UserStore, Depends(get_user_store)],
    _admin: Annotated[User, Depends(require_admin)],
) -> UserResponse:
    existing = await user_store.get_by_email(session, req.email)
    if existing is not None:
        raise HTTPException(status_code=409, detail="Email already registered")

    user = User(
        name=req.name,
        email=req.email,
        role=req.role,
        password_hash=hash_password(req.password),
    )
    await user_store.create(session, user)
    await session.commit()

    logger.info("Created user: %s (%s)", user.email, user.id)
    return UserResponse(
        id=user.id,
        name=user.name,
        email=user.email,
        role=user.role,
        created_at=str(user.created_at),
    )
