from __future__ import annotations

import logging
from typing import TYPE_CHECKING, Any

from nio import MatrixRoom, RoomMessageText

from switch_core.clients.client_base import ClientBase, ClientConfig
from switch_core.events import AgentRuntimeStateEvent

if TYPE_CHECKING:
    from switch_core.bridges.collaboration.bridge_core import BridgeCore

logger = logging.getLogger(__name__)


class BridgeClientConfig(ClientConfig):
    bridge_id: str


class BridgeClient(ClientBase[BridgeClientConfig]):
    config_class = BridgeClientConfig

    def __init__(self, *, bridge_core: BridgeCore, **kwargs: Any) -> None:
        super().__init__(**kwargs)
        self._bridge_core = bridge_core

    async def on_message(self, room: MatrixRoom, event: RoomMessageText) -> None:
        logger.debug(
            "[BRIDGE-CLIENT] on_message room=%s sender=%s",
            room.room_id,
            event.sender,
        )
        await self._bridge_core.handle_outbound_message(room, event)

    async def on_agent_runtime_state(
        self, room: MatrixRoom, event: AgentRuntimeStateEvent
    ) -> None:
        await self._bridge_core.handle_agent_runtime_state(room, event)
