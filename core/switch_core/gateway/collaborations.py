from __future__ import annotations

import logging
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from pydantic import ValidationError
from sqlalchemy.ext.asyncio import AsyncSession

from switch_core.bridges.collaboration.lifecycle_service import (
    CollaborationBridgeLifecycleService,
)
from switch_core.db.models import CollaborationBridge, ExternalUser, User
from switch_core.db.stores.collaboration_bridge_store import CollaborationBridgeStore
from switch_core.db.stores.external_user_store import ExternalUserStore
from switch_core.db.stores.room_store import RoomStore
from switch_core.db.stores.user_store import UserStore
from switch_core.gateway.auth import get_current_user, require_admin
from switch_core.gateway.dependencies import (
    get_bridge_store,
    get_collab_lifecycle,
    get_external_user_store,
    get_room_service,
    get_room_store,
    get_session,
    get_user_store,
)
from switch_core.gateway.schemas import (
    BridgeCreateRequest,
    BridgeDetail,
    BridgeTypeInfo,
    BridgeUpdateRequest,
    ClaimIdentityRequest,
    DirectoryUserSummary,
    ExternalUserSummary,
)
from switch_core.room_service import RoomService

logger = logging.getLogger(__name__)

router = APIRouter()


async def _home_url(
    bridge_id: str, collab_lifecycle: CollaborationBridgeLifecycleService
) -> str | None:
    """Link that opens the bridge's workspace in its messaging app, built by
    the live adapter. None when the bridge is not running or the platform has
    no such link — the same "offer it only when it works" rule the per-room
    channel deeplink follows."""
    adapter = collab_lifecycle.get_adapter(bridge_id)
    if adapter is None:
        return None
    try:
        return await adapter.home_deeplink()
    except Exception:
        logger.warning(
            "Failed to build home deeplink for bridge %s", bridge_id, exc_info=True
        )
        return None


async def _detail(
    bridge: CollaborationBridge,
    *,
    room_count: int,
    collab_lifecycle: CollaborationBridgeLifecycleService,
    is_default: bool | None = None,
) -> BridgeDetail:
    """One place every response shape is built, so a new field cannot reach
    some endpoints and miss others. `is_default` overrides the stored value for
    a caller that just changed it in the same request."""
    return BridgeDetail(
        bridge_id=bridge.id,
        bridge_type=bridge.type,
        display_name=bridge.display_name,
        status=bridge.status,
        agent_greetings_enabled=bridge.agent_greetings_enabled,
        is_default=bridge.is_default if is_default is None else is_default,
        room_count=room_count,
        created_at=str(bridge.created_at),
        home_url=await _home_url(bridge.id, collab_lifecycle),
    )


@router.get("/types")
async def list_bridge_types(
    collab_lifecycle: Annotated[
        CollaborationBridgeLifecycleService, Depends(get_collab_lifecycle)
    ],
    _user: Annotated[User, Depends(get_current_user)],
) -> list[BridgeTypeInfo]:
    return [
        BridgeTypeInfo(
            key=t,
            config_schema=collab_lifecycle.get_config_schema(t),
        )
        for t in collab_lifecycle.get_registered_types()
    ]


@router.post("")
async def create_bridge(
    req: BridgeCreateRequest,
    session: Annotated[AsyncSession, Depends(get_session)],
    bridge_store: Annotated[CollaborationBridgeStore, Depends(get_bridge_store)],
    collab_lifecycle: Annotated[
        CollaborationBridgeLifecycleService, Depends(get_collab_lifecycle)
    ],
    # Admin-only: a bridge is an unowned, workspace-wide integration holding
    # platform secrets, so there is no owner to scope to (unlike connectors,
    # whose authz is owner-or-admin) — registering one is an admin action.
    _user: Annotated[User, Depends(require_admin)],
) -> BridgeDetail:
    try:
        bridge = await collab_lifecycle.register(
            bridge_type=req.bridge_type,
            display_name=req.display_name,
            connection_config=dict(req.connection_config),
        )
    except ValidationError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    is_default = bridge.is_default
    if req.set_as_default:
        await bridge_store.set_default(session, bridge.id)
        await session.commit()
        is_default = True

    return await _detail(
        bridge, room_count=0, collab_lifecycle=collab_lifecycle, is_default=is_default
    )


@router.post("/{bridge_id}/default")
async def set_default_bridge(
    bridge_id: str,
    session: Annotated[AsyncSession, Depends(get_session)],
    bridge_store: Annotated[CollaborationBridgeStore, Depends(get_bridge_store)],
    room_store: Annotated[RoomStore, Depends(get_room_store)],
    collab_lifecycle: Annotated[
        CollaborationBridgeLifecycleService, Depends(get_collab_lifecycle)
    ],
    _user: Annotated[User, Depends(require_admin)],
) -> BridgeDetail:
    """Nominate a bridge as the instance default, demoting the previous one."""
    try:
        bridge = await bridge_store.set_default(session, bridge_id)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    await session.commit()

    rooms = await room_store.get_by_bridge(session, bridge_id)
    return await _detail(
        bridge, room_count=len(rooms), collab_lifecycle=collab_lifecycle
    )


@router.get("")
async def list_bridges(
    session: Annotated[AsyncSession, Depends(get_session)],
    bridge_store: Annotated[CollaborationBridgeStore, Depends(get_bridge_store)],
    room_store: Annotated[RoomStore, Depends(get_room_store)],
    collab_lifecycle: Annotated[
        CollaborationBridgeLifecycleService, Depends(get_collab_lifecycle)
    ],
    _user: Annotated[User, Depends(get_current_user)],
) -> list[BridgeDetail]:
    bridges = await bridge_store.get_all(session)

    details = []
    for bridge in bridges:
        rooms = await room_store.get_by_bridge(session, bridge.id)
        details.append(
            await _detail(
                bridge, room_count=len(rooms), collab_lifecycle=collab_lifecycle
            )
        )

    return details


@router.patch("/{bridge_id}")
async def update_bridge(
    bridge_id: str,
    payload: BridgeUpdateRequest,
    session: Annotated[AsyncSession, Depends(get_session)],
    bridge_store: Annotated[CollaborationBridgeStore, Depends(get_bridge_store)],
    room_store: Annotated[RoomStore, Depends(get_room_store)],
    collab_lifecycle: Annotated[
        CollaborationBridgeLifecycleService, Depends(get_collab_lifecycle)
    ],
    # Admin-only for the same reason as registering one: a bridge is an unowned,
    # workspace-wide integration, so there is no owner to scope mutation to.
    _user: Annotated[User, Depends(require_admin)],
) -> BridgeDetail:
    bridge = await bridge_store.get(session, bridge_id)
    if bridge is None:
        raise HTTPException(status_code=404, detail="Bridge not found")

    bridge = await bridge_store.set_agent_greetings_enabled(
        session, bridge_id, payload.agent_greetings_enabled
    )
    await session.commit()
    rooms = await room_store.get_by_bridge(session, bridge_id)
    return await _detail(
        bridge, room_count=len(rooms), collab_lifecycle=collab_lifecycle
    )


@router.get("/{bridge_id}/users")
async def list_bridge_users(
    bridge_id: str,
    session: Annotated[AsyncSession, Depends(get_session)],
    bridge_store: Annotated[CollaborationBridgeStore, Depends(get_bridge_store)],
    external_user_store: Annotated[ExternalUserStore, Depends(get_external_user_store)],
    user_store: Annotated[UserStore, Depends(get_user_store)],
    _user: Annotated[User, Depends(get_current_user)],
) -> list[ExternalUserSummary]:
    bridge = await bridge_store.get(session, bridge_id)
    if bridge is None:
        raise HTTPException(status_code=404, detail="Bridge not found")

    users = await external_user_store.get_by_bridge(session, bridge_id)
    claimants = await _claimant_names(session, user_store, users)
    return [
        ExternalUserSummary(
            id=u.id,
            bridge_id=u.bridge_id,
            external_user_id=u.external_user_id,
            external_username=u.external_username,
            user_id=u.user_id,
            user_name=claimants.get(u.user_id) if u.user_id else None,
        )
        for u in users
    ]


async def _claimant_names(
    session: AsyncSession,
    user_store: UserStore,
    external_users: list[ExternalUser],
) -> dict[str, str]:
    """Display names for the Switch users who have claimed these identities."""
    names: dict[str, str] = {}
    for claimed_by in {u.user_id for u in external_users if u.user_id}:
        if claimed_by is None:
            continue
        owner = await user_store.get(session, claimed_by)
        if owner is not None:
            names[claimed_by] = owner.name
    return names


@router.get("/{bridge_id}/directory")
async def search_bridge_directory(
    bridge_id: str,
    query: str,
    session: Annotated[AsyncSession, Depends(get_session)],
    bridge_store: Annotated[CollaborationBridgeStore, Depends(get_bridge_store)],
    external_user_store: Annotated[ExternalUserStore, Depends(get_external_user_store)],
    user_store: Annotated[UserStore, Depends(get_user_store)],
    collab_lifecycle: Annotated[
        CollaborationBridgeLifecycleService, Depends(get_collab_lifecycle)
    ],
    _user: Annotated[User, Depends(get_current_user)],
) -> list[DirectoryUserSummary]:
    """Search the messaging platform's own user directory.

    Switch only records someone as an `ExternalUser` once they have spoken, so
    a freshly connected workspace has nobody to pick from. This asks the
    platform instead, which is what makes claiming an identity possible before
    you have ever posted.

    Platforms with no searchable directory answer 501 rather than an empty
    list, so the caller can explain that a message must come first.
    """
    bridge = await bridge_store.get(session, bridge_id)
    if bridge is None:
        raise HTTPException(status_code=404, detail="Bridge not found")

    adapter = collab_lifecycle.get_adapter(bridge_id)
    if adapter is None:
        raise HTTPException(
            status_code=409,
            detail="Bridge is not running — start it before searching its directory",
        )

    try:
        found = await adapter.search_directory_users(query)
    except NotImplementedError as e:
        raise HTTPException(status_code=501, detail=str(e)) from e
    except RuntimeError as e:
        raise HTTPException(status_code=502, detail=str(e)) from e

    known = {
        u.external_user_id: u
        for u in await external_user_store.get_by_bridge(session, bridge_id)
    }
    claimants = await _claimant_names(session, user_store, list(known.values()))
    return [
        DirectoryUserSummary(
            external_user_id=person.external_user_id,
            username=person.username,
            display_name=person.display_name,
            email=person.email,
            known_external_user_id=(
                known[person.external_user_id].id
                if person.external_user_id in known
                else None
            ),
            claimed_by_user_id=(
                known[person.external_user_id].user_id
                if person.external_user_id in known
                else None
            ),
            claimed_by_user_name=(
                claimants.get(known[person.external_user_id].user_id or "")
                if person.external_user_id in known
                else None
            ),
        )
        for person in found
    ]


@router.post("/{bridge_id}/identities")
async def claim_bridge_identity(
    bridge_id: str,
    payload: ClaimIdentityRequest,
    session: Annotated[AsyncSession, Depends(get_session)],
    bridge_store: Annotated[CollaborationBridgeStore, Depends(get_bridge_store)],
    external_user_store: Annotated[ExternalUserStore, Depends(get_external_user_store)],
    user_store: Annotated[UserStore, Depends(get_user_store)],
    collab_lifecycle: Annotated[
        CollaborationBridgeLifecycleService, Depends(get_collab_lifecycle)
    ],
    user: Annotated[User, Depends(get_current_user)],
) -> ExternalUserSummary:
    """Claim a platform identity for a Switch user (CHOO-2137).

    This is what makes owner-only addressing enforceable: until the person
    behind a Slack or Mattermost account is known to be a particular Switch
    user, an owner-scoped rule can never recognise them.

    You may claim an identity for yourself; claiming one for someone else is
    an admin action. An identity already claimed by a different user is a
    conflict rather than a silent takeover.
    """
    bridge = await bridge_store.get(session, bridge_id)
    if bridge is None:
        raise HTTPException(status_code=404, detail="Bridge not found")

    target_user_id = payload.user_id or user.id
    if target_user_id != user.id and user.role != "admin":
        raise HTTPException(
            status_code=403,
            detail="Only an admin may claim a messaging identity for another user",
        )
    if await user_store.get(session, target_user_id) is None:
        raise HTTPException(status_code=404, detail="Switch user not found")

    external_user = await external_user_store.get_by_external_id(
        session, bridge_id, payload.external_user_id
    )
    if external_user is None:
        # Nobody has seen this person speak yet, which is the normal case right
        # after connecting a workspace. Provision the identity now rather than
        # making them post something first.
        bridge_core = collab_lifecycle.get(bridge_id)
        if bridge_core is None:
            raise HTTPException(
                status_code=409,
                detail=(
                    "Bridge is not running — start it before claiming an "
                    "identity Switch has not seen yet"
                ),
            )
        try:
            external_user = await bridge_core.ensure_external_user(
                external_user_id=payload.external_user_id,
                external_username=payload.username,
            )
        except ValueError as e:
            raise HTTPException(status_code=409, detail=str(e)) from e
        session.expire_all()
        external_user = await external_user_store.get_by_external_id(
            session, bridge_id, payload.external_user_id
        )
        if external_user is None:
            raise HTTPException(
                status_code=500,
                detail="Identity was provisioned but could not be read back",
            )

    try:
        claimed = await external_user_store.claim(
            session, external_user, target_user_id
        )
    except ValueError as e:
        raise HTTPException(status_code=409, detail=str(e)) from e
    await session.commit()

    owner = await user_store.get(session, target_user_id)
    return ExternalUserSummary(
        id=claimed.id,
        bridge_id=claimed.bridge_id,
        external_user_id=claimed.external_user_id,
        external_username=claimed.external_username,
        user_id=claimed.user_id,
        user_name=owner.name if owner is not None else None,
    )


@router.delete("/{bridge_id}/identities/{external_user_row_id}")
async def release_bridge_identity(
    bridge_id: str,
    external_user_row_id: str,
    session: Annotated[AsyncSession, Depends(get_session)],
    external_user_store: Annotated[ExternalUserStore, Depends(get_external_user_store)],
    user: Annotated[User, Depends(get_current_user)],
) -> ExternalUserSummary:
    """Unclaim a platform identity. Yours, or anyone's if you are an admin."""
    external_user = await external_user_store.get(session, external_user_row_id)
    if external_user is None or external_user.bridge_id != bridge_id:
        raise HTTPException(status_code=404, detail="Identity not found")
    if external_user.user_id != user.id and user.role != "admin":
        raise HTTPException(
            status_code=403,
            detail="Only an admin may release another user's messaging identity",
        )

    released = await external_user_store.release(session, external_user)
    await session.commit()
    return ExternalUserSummary(
        id=released.id,
        bridge_id=released.bridge_id,
        external_user_id=released.external_user_id,
        external_username=released.external_username,
        user_id=None,
        user_name=None,
    )


@router.delete("/{bridge_id}")
async def delete_bridge(
    bridge_id: str,
    session: Annotated[AsyncSession, Depends(get_session)],
    bridge_store: Annotated[CollaborationBridgeStore, Depends(get_bridge_store)],
    room_store: Annotated[RoomStore, Depends(get_room_store)],
    room_service: Annotated[RoomService, Depends(get_room_service)],
    collab_lifecycle: Annotated[
        CollaborationBridgeLifecycleService, Depends(get_collab_lifecycle)
    ],
    # Admin-only: deleting a bridge cascades into deleting every room on it, so
    # this is the most destructive operation on the router.
    _user: Annotated[User, Depends(require_admin)],
) -> dict[str, bool]:
    bridge = await bridge_store.get(session, bridge_id)
    if bridge is None:
        raise HTTPException(status_code=404, detail="Bridge not found")

    rooms = await room_store.get_by_bridge(session, bridge_id)
    for room in rooms:
        await room_service.delete_room(room.id)

    await collab_lifecycle.remove(bridge_id)
    return {"ok": True}
