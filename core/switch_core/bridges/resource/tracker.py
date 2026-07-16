from __future__ import annotations

import asyncio
import logging

from switch_core.bridges.resource.events import (
    ResourceLoadResponse,
    RoomDocumentCreateResponse,
    RoomDocumentDeleteResponse,
    RoomDocumentUpdateResponse,
)

logger = logging.getLogger(__name__)

ResourceResponse = (
    ResourceLoadResponse
    | RoomDocumentCreateResponse
    | RoomDocumentUpdateResponse
    | RoomDocumentDeleteResponse
)


class ResourceRequestTracker:
    """Tracks in-flight resource round-trips (loads + room-document mutations).
    Mirrors RequestTracker for the mediation flow."""

    def __init__(self) -> None:
        self._pending: dict[str, tuple[str, str, asyncio.Future[ResourceResponse]]] = {}

    def register(
        self, request_id: str, agent_id: str, room_id: str
    ) -> asyncio.Future[ResourceResponse]:
        loop = asyncio.get_running_loop()
        future: asyncio.Future[ResourceResponse] = loop.create_future()
        self._pending[request_id] = (agent_id, room_id, future)
        return future

    def resolve(self, request_id: str, response: ResourceResponse) -> None:
        entry = self._pending.pop(request_id, None)
        if entry is None:
            logger.warning("Resource response for unknown request_id: %s", request_id)
            return
        _, _, future = entry
        if not future.done():
            future.set_result(response)

    def cancel(self, request_id: str) -> None:
        entry = self._pending.pop(request_id, None)
        if entry is not None:
            _, _, future = entry
            if not future.done():
                future.cancel()

    def is_pending(self, request_id: str) -> bool:
        return request_id in self._pending
