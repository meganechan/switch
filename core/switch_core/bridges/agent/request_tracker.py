from __future__ import annotations

import asyncio
import logging

from switch_core.events import MediationResult

logger = logging.getLogger(__name__)


class RequestTracker:
    def __init__(self) -> None:
        self._pending: dict[str, tuple[str, str, asyncio.Future[MediationResult]]] = {}

    def register(
        self, request_id: str, agent_id: str, room_id: str
    ) -> asyncio.Future[MediationResult]:
        loop = asyncio.get_running_loop()
        future: asyncio.Future[MediationResult] = loop.create_future()
        self._pending[request_id] = (agent_id, room_id, future)
        return future

    def resolve(self, request_id: str, result: MediationResult) -> None:
        entry = self._pending.pop(request_id, None)
        if entry is None:
            logger.warning("Verdict for unknown request_id: %s", request_id)
            return
        _, _, future = entry
        if not future.done():
            future.set_result(result)

    def cancel(self, request_id: str) -> None:
        entry = self._pending.pop(request_id, None)
        if entry is not None:
            _, _, future = entry
            if not future.done():
                future.cancel()

    def is_pending(self, request_id: str) -> bool:
        return request_id in self._pending
