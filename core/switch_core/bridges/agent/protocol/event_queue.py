from __future__ import annotations

import asyncio
import logging

from switch_core.bridges.agent.protocol.types import AgentEvent

logger = logging.getLogger(__name__)


def _is_notifiable(event: AgentEvent) -> bool:
    """Whether an event should also fan out to the agent's notification stream.

    The notification stream mirrors exactly what a connector treats as a
    notification: addressed messages, task events, and room_join events the
    agent is configured to listen for. It deliberately excludes unaddressed
    chatter and admin command events. The auto_session watcher consumes this
    stream to decide when to spin up a session.
    """
    if event.type == "message":
        return getattr(event.payload, "addressed", False)
    if event.type == "room_join":
        return getattr(event.payload, "listening", False)
    if event.type == "command":
        return False
    # All task_* events are enqueued only for the directly-involved agent.
    return event.type.startswith("task_")


class EventQueue:
    def __init__(self) -> None:
        self._queues: dict[str, dict[str, asyncio.Queue[AgentEvent]]] = {}
        self._notify: dict[str, asyncio.Event] = {}
        # A separate, agent-scoped notification stream (not keyed by room).
        # Notifiable events are fanned out here in addition to the per-room
        # queues above, so the auto_session watcher can long-poll it without
        # draining the per-room queues that live session pollers consume.
        self._notif_queues: dict[str, asyncio.Queue[AgentEvent]] = {}

    def _get_queue(self, agent_id: str, room_id: str) -> asyncio.Queue[AgentEvent]:
        agent_queues = self._queues.setdefault(agent_id, {})
        if room_id not in agent_queues:
            agent_queues[room_id] = asyncio.Queue()
        return agent_queues[room_id]

    def _get_notify(self, agent_id: str) -> asyncio.Event:
        if agent_id not in self._notify:
            self._notify[agent_id] = asyncio.Event()
        return self._notify[agent_id]

    def _get_notif_queue(self, agent_id: str) -> asyncio.Queue[AgentEvent]:
        if agent_id not in self._notif_queues:
            self._notif_queues[agent_id] = asyncio.Queue()
        return self._notif_queues[agent_id]

    def enqueue(self, agent_id: str, room_id: str, event: AgentEvent) -> None:
        logger.debug(
            "[EVENT-Q] enqueue agent=%s room=%s event=%s", agent_id, room_id, event.type
        )
        self._get_queue(agent_id, room_id).put_nowait(event)
        self._get_notify(agent_id).set()
        # Fan out to the agent-scoped notification stream. This is a SEPARATE
        # queue, so consuming it never removes the event from the per-room
        # queue a live session poller reads — no event stealing.
        if _is_notifiable(event):
            self._get_notif_queue(agent_id).put_nowait(event)

    async def poll(self, agent_id: str, timeout: float = 30) -> list[AgentEvent]:
        events = self._drain_all(agent_id)
        if events:
            return events

        notify = self._get_notify(agent_id)
        notify.clear()
        try:
            await asyncio.wait_for(notify.wait(), timeout=timeout)
        except TimeoutError:
            return []

        return self._drain_all(agent_id)

    async def poll_room(
        self, agent_id: str, room_id: str, timeout: float = 30
    ) -> list[AgentEvent]:
        queue = self._get_queue(agent_id, room_id)

        events: list[AgentEvent] = []
        while not queue.empty():
            events.append(queue.get_nowait())

        if events:
            return events

        try:
            event = await asyncio.wait_for(queue.get(), timeout=timeout)
            events.append(event)
        except TimeoutError:
            pass

        return events

    async def poll_notifications(
        self, agent_id: str, timeout: float = 30
    ) -> list[AgentEvent]:
        """Long-poll the agent's notification stream (across all rooms).

        Mirrors `poll_room` but drains the agent-scoped notification queue.
        Returns notifiable events only (see `_is_notifiable`).
        """
        queue = self._get_notif_queue(agent_id)

        events: list[AgentEvent] = []
        while not queue.empty():
            events.append(queue.get_nowait())

        if events:
            return events

        try:
            event = await asyncio.wait_for(queue.get(), timeout=timeout)
            events.append(event)
        except TimeoutError:
            pass

        return events

    def remove(self, agent_id: str) -> None:
        self._queues.pop(agent_id, None)
        self._notify.pop(agent_id, None)
        self._notif_queues.pop(agent_id, None)

    def _drain_all(self, agent_id: str) -> list[AgentEvent]:
        agent_queues = self._queues.get(agent_id)
        if not agent_queues:
            return []
        events: list[AgentEvent] = []
        for queue in agent_queues.values():
            while not queue.empty():
                events.append(queue.get_nowait())
        return events
