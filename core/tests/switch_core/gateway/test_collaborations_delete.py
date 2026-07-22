from __future__ import annotations

import uuid
from unittest.mock import MagicMock

import pytest
from fastapi import HTTPException
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from switch_core.bridges.collaboration.lifecycle_service import (
    CollaborationBridgeLifecycleService,
)
from switch_core.db.models import Client, CollaborationBridge, ExternalUser, Room
from switch_core.db.stores.collaboration_bridge_store import CollaborationBridgeStore
from switch_core.db.stores.external_user_store import ExternalUserStore
from switch_core.db.stores.room_store import RoomStore
from switch_core.gateway.collaborations import delete_bridge


def _lifecycle(
    session_factory: async_sessionmaker[AsyncSession],
) -> CollaborationBridgeLifecycleService:
    """Real service with real stores; mock the deps remove() never touches."""
    return CollaborationBridgeLifecycleService(
        bridge_store=CollaborationBridgeStore(),
        external_user_store=ExternalUserStore(),
        bridge_message_map_store=MagicMock(),
        room_store=RoomStore(),
        agent_store=MagicMock(),
        client_store=MagicMock(),
        client_lifecycle=MagicMock(),
        room_service=MagicMock(),
        matrix_admin=MagicMock(),
        session_factory=session_factory,
        config=MagicMock(),
    )


async def _make_client(session: AsyncSession, *, client_type: str) -> str:
    client = Client(
        matrix_user_id=f"@{client_type}-{uuid.uuid4().hex[:8]}:test",
        display_name=f"{client_type} client",
        type=client_type,
        password="x",
    )
    session.add(client)
    await session.flush()
    return client.id


async def _make_bridge(session: AsyncSession) -> str:
    client_id = await _make_client(session, client_type="bridge")
    bridge = CollaborationBridge(
        type="mattermost",
        display_name="MM",
        client_id=client_id,
        status="active",
    )
    session.add(bridge)
    await session.flush()
    return bridge.id


async def _make_bridged_room(session: AsyncSession, *, bridge_id: str) -> str:
    room = Room(
        matrix_room_id=f"!{uuid.uuid4().hex[:8]}:test",
        name="bridged room",
        description="mirror of an external channel",
        bridge_id=bridge_id,
        channel_type="channel_public",
        external_channel_id="C123",
    )
    session.add(room)
    await session.flush()
    return room.id


async def _make_external_user(session: AsyncSession, *, bridge_id: str) -> str:
    client_id = await _make_client(session, client_type="external_user")
    user = ExternalUser(
        bridge_id=bridge_id,
        external_user_id=f"U{uuid.uuid4().hex[:8]}",
        external_username="alice",
        client_id=client_id,
    )
    session.add(user)
    await session.flush()
    return user.id


@pytest.mark.asyncio
async def test_delete_bridge_detaches_dependent_rooms(
    session_factory: async_sessionmaker[AsyncSession],
) -> None:
    """The DELETE /collab/bridges endpoint must be non-destructive and atomic.

    Regression for CHOO-1487: the endpoint used to destructively delete every
    dependent room one-by-one (each in its own committed transaction, also
    destroying the Matrix room) before removing the bridge. A failure partway
    left a partial delete + 500. It now routes removal entirely through
    remove(), which detaches dependent rooms atomically — so bridged rooms
    survive as internal-only rooms.
    """
    async with session_factory() as session:
        bridge_id = await _make_bridge(session)
        room_id = await _make_bridged_room(session, bridge_id=bridge_id)
        external_user_id = await _make_external_user(session, bridge_id=bridge_id)
        await session.commit()

    async with session_factory() as session:
        result = await delete_bridge(
            bridge_id=bridge_id,
            session=session,
            bridge_store=CollaborationBridgeStore(),
            collab_lifecycle=_lifecycle(session_factory),
            _user=MagicMock(),
        )

    assert result == {"ok": True}

    async with session_factory() as session:
        assert await CollaborationBridgeStore().get(session, bridge_id) is None

        # Room survives, just detached from the (now-gone) bridge.
        room = await RoomStore().get(session, room_id)
        assert room is not None
        assert room.bridge_id is None
        assert room.channel_type is None
        assert room.external_channel_id is None

        # External users for the bridge are cleaned up.
        assert await ExternalUserStore().get(session, external_user_id) is None


@pytest.mark.asyncio
async def test_delete_bridge_missing_is_not_found(
    session_factory: async_sessionmaker[AsyncSession],
) -> None:
    async with session_factory() as session:
        with pytest.raises(HTTPException) as exc:
            await delete_bridge(
                bridge_id="does-not-exist",
                session=session,
                bridge_store=CollaborationBridgeStore(),
                collab_lifecycle=_lifecycle(session_factory),
                _user=MagicMock(),
            )

    assert exc.value.status_code == 404
