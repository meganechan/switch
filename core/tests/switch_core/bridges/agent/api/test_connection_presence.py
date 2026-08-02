"""A connection counts as presence (CHOO-1857 stage B).

Presence is still read from `agent_sessions` and `role_leases` — the rows the
pre-connection clients maintained with /connection/renew, /watch/heartbeat and
/leases/renew. A client that has moved to the single connection heartbeat sends
none of those. Without the bridge tested here it would show DISCONNECTED and
lose its role lease while demonstrably alive on the stream, which is precisely
what blocks switchdash from migrating.

These are the tests that must fail when the bridge is eventually deleted — at
which point the readers derive presence from connections directly and the
guarantee moves, rather than disappearing.
"""

from __future__ import annotations

from types import SimpleNamespace
from typing import Any

import pytest
from starlette.responses import StreamingResponse

from switch_core.bridges.agent.api.handlers import (
    connection_beat,
    connection_subscribe,
    poll_events,
)
from switch_core.bridges.agent.api.schemas import (
    ConnectionBeatRequest,
    ConnectionSubscribeRequest,
)
from switch_core.bridges.agent.protocol.connections import (
    PROTOCOL_VERSION,
    ConnectionRegistry,
)
from switch_core.bridges.agent.protocol.event_buffer import EventBuffer

AGENT_ID = "agent-1"
ROOM = "room-1"


class _Protocol:
    """Records presence writes instead of touching the database."""

    def __init__(self) -> None:
        self.event_buffer = EventBuffer()
        self.connections = ConnectionRegistry()
        self.presence: list[set[str]] = []
        self.members_of: set[str] = {ROOM, "room-2"}

    async def record_connection_presence(self, agent_id: str, rooms: Any) -> None:
        assert agent_id == AGENT_ID
        self.presence.append(set(rooms))

    async def require_room_member(self, agent_id: str, room_id: str) -> None:
        if room_id not in self.members_of:
            raise PermissionError(f"{agent_id} is not a member of {room_id}")


def _agent() -> Any:
    return SimpleNamespace(id=AGENT_ID)


async def _open(
    protocol: _Protocol, *, connection_id: str, rooms: str | None = None
) -> Any:
    return await poll_events(
        agent_id=AGENT_ID,
        agent=_agent(),
        protocol=protocol,
        timeout=0,
        accept="text/event-stream",
        connection_id=connection_id,
        scope="all",
        event_filter="all",
        start_from="head",
        spawn_capable=False,
        protocol_version=PROTOCOL_VERSION,
        rooms=rooms,
        last_event_id=None,
    )


async def test_opening_a_stream_records_presence_immediately() -> None:
    """An agent that reconnects must not blink offline until its first beat."""
    protocol = _Protocol()

    resp = await _open(protocol, connection_id="c1")

    assert isinstance(resp, StreamingResponse)
    assert protocol.presence == [set()]


async def test_rooms_claimed_at_open_are_part_of_that_first_presence_write() -> None:
    # Resume declares its room on the query string, so the room-scoped
    # presence row must be refreshed then — not one beat later.
    protocol = _Protocol()

    await _open(protocol, connection_id="c1", rooms=ROOM)

    assert protocol.presence == [{ROOM}]


async def test_the_heartbeat_records_presence_for_every_covered_room() -> None:
    protocol = _Protocol()
    await _open(protocol, connection_id="c1", rooms=ROOM)
    protocol.presence.clear()

    result = await connection_beat(
        agent_id=AGENT_ID,
        req=ConnectionBeatRequest(connection_id="c1", cursor=0),
        agent=_agent(),
        protocol=protocol,
    )

    assert result["ok"] is True
    assert protocol.presence == [{ROOM}]


async def test_subscribing_makes_the_new_room_present_without_waiting_for_a_beat() -> (
    None
):
    protocol = _Protocol()
    await _open(protocol, connection_id="c1")
    protocol.presence.clear()

    await connection_subscribe(
        agent_id=AGENT_ID,
        req=ConnectionSubscribeRequest(connection_id="c1", room_id=ROOM),
        agent=_agent(),
        protocol=protocol,
    )

    assert protocol.presence == [{ROOM}]


async def test_a_connection_covering_no_room_still_reports_the_agent_alive() -> None:
    """The room-agnostic slot is what always_on liveness and DORMANT read.

    An `all`-scope connection with nothing claimed is exactly the watcher that
    used to send /watch/heartbeat, so it has to keep that slot warm.
    """
    protocol = _Protocol()
    await _open(protocol, connection_id="c1")
    protocol.presence.clear()

    await connection_beat(
        agent_id=AGENT_ID,
        req=ConnectionBeatRequest(connection_id="c1", cursor=0),
        agent=_agent(),
        protocol=protocol,
    )

    # Empty set, but the write still happened: record_connection_presence
    # always refreshes the room-agnostic row.
    assert protocol.presence == [set()]


async def test_presence_is_not_recorded_for_a_refused_subscription() -> None:
    """A room the agent does not belong to must not become presence."""
    protocol = _Protocol()
    await _open(protocol, connection_id="c1")
    protocol.presence.clear()

    with pytest.raises(Exception):
        await connection_subscribe(
            agent_id=AGENT_ID,
            req=ConnectionSubscribeRequest(connection_id="c1", room_id="not-mine"),
            agent=_agent(),
            protocol=protocol,
        )

    assert protocol.presence == []
