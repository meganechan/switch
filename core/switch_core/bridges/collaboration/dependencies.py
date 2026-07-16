from __future__ import annotations

from collections.abc import AsyncIterator
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from switch_core.bridges.collaboration.lifecycle_service import (
    CollaborationBridgeLifecycleService,
)
from switch_core.db.stores.collaboration_bridge_store import CollaborationBridgeStore

_state: dict[str, Any] = {}


def init_dependencies(
    *,
    bridge_store: CollaborationBridgeStore,
    collab_lifecycle: CollaborationBridgeLifecycleService,
    session_factory: Any,
) -> None:
    _state["bridge_store"] = bridge_store
    _state["collab_lifecycle"] = collab_lifecycle
    _state["session_factory"] = session_factory


async def get_session() -> AsyncIterator[AsyncSession]:
    async with _state["session_factory"]() as session:
        yield session


def get_bridge_store() -> CollaborationBridgeStore:
    return _state["bridge_store"]  # type: ignore[no-any-return]


def get_collab_lifecycle() -> CollaborationBridgeLifecycleService:
    return _state["collab_lifecycle"]  # type: ignore[no-any-return]
