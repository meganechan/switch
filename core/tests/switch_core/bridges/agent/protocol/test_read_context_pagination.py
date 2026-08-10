"""read_context must page the homeserver, not read one page and stop.

The bug this covers (CHOO-2034): a single /messages call returned whatever
fitted in one server-capped page, state events ate into that page, and `since`
/ `before` were applied as filters over it — so `before` could never reach
older history and a truncated read was indistinguishable from a complete one.
"""

from __future__ import annotations

from types import SimpleNamespace
from typing import Any

import nio

from switch_core.bridges.agent.protocol.connections import ConnectionRegistry
from switch_core.bridges.agent.protocol.service import ProtocolService


def _msg(event_id: str, ts: int, body: str = "hi") -> SimpleNamespace:
    return SimpleNamespace(
        event_id=event_id,
        sender="@u:s",
        server_timestamp=ts,
        body=body,
        source={"content": {"sender_name": "U"}},
    )


def _join(event_id: str, ts: int, user: str, displayname: str) -> nio.RoomMemberEvent:
    return nio.RoomMemberEvent.from_dict(
        {
            "type": "m.room.member",
            "event_id": event_id,
            "sender": user,
            "state_key": user,
            "origin_server_ts": ts,
            "content": {"membership": "join", "displayname": displayname},
        }
    )


def _rename(event_id: str, ts: int, user: str, displayname: str) -> nio.RoomMemberEvent:
    """A display-name change: membership join, but they were already here."""
    return nio.RoomMemberEvent.from_dict(
        {
            "type": "m.room.member",
            "event_id": event_id,
            "sender": user,
            "state_key": user,
            "origin_server_ts": ts,
            "content": {"membership": "join", "displayname": displayname},
            "unsigned": {"prev_content": {"membership": "join"}},
        }
    )


class _PagedNio:
    """Homeserver stand-in that hands out history one page at a time."""

    def __init__(self, pages: list[list[Any]]) -> None:
        self._pages = pages
        self.requested_starts: list[str | None] = []

    async def room_messages(
        self, room_id: str, start: str | None = None, limit: int = 0
    ) -> SimpleNamespace:
        self.requested_starts.append(start)
        index = 0 if start is None else int(start)
        if index >= len(self._pages):
            return SimpleNamespace(chunk=[], end=None)
        is_last = index == len(self._pages) - 1
        return SimpleNamespace(
            chunk=self._pages[index],
            end=None if is_last else str(index + 1),
        )

    async def room_get_event(self, room_id: str, event_id: str) -> Any:
        return object.__new__(nio.RoomGetEventError)


def _service(nio_client: _PagedNio) -> ProtocolService:
    svc = object.__new__(ProtocolService)
    svc.connections = ConnectionRegistry()

    async def _require(agent_id: str, room_id: str) -> SimpleNamespace:
        return SimpleNamespace(matrix_room_id="!room:s")

    svc.require_room_member = _require  # type: ignore[assignment]
    svc.client_lifecycle = SimpleNamespace(  # type: ignore[assignment]
        get_by_agent_id=lambda agent_id: SimpleNamespace(nio_client=nio_client)
    )
    return svc


def _roots(result: dict[str, Any]) -> list[str]:
    return [g["root"]["id"] for g in result["threads"]]


class TestPagination:
    async def test_follows_continuation_token_across_pages(self) -> None:
        # Three pages of one message each — the old code saw only the first.
        nio_client = _PagedNio(
            [[_msg("e3", 300)], [_msg("e2", 200)], [_msg("e1", 100)]]
        )
        svc = _service(nio_client)

        result = await svc.read_context("agent", "room", limit=10)

        assert sorted(_roots(result)) == ["e1", "e2", "e3"]
        assert nio_client.requested_starts == [None, "1", "2"]

    async def test_state_events_do_not_consume_the_message_budget(self) -> None:
        # A page full of events that reach nobody must not end the read.
        noise = [
            SimpleNamespace(
                event_id=f"$n{i}",
                sender="@s:s",
                server_timestamp=500 - i,
                body=None,
                source={"content": {}},
            )
            for i in range(20)
        ]
        nio_client = _PagedNio([noise, [_msg("e1", 100)]])
        svc = _service(nio_client)

        result = await svc.read_context("agent", "room", limit=5)

        assert _roots(result) == ["e1"]

    async def test_stops_at_limit_and_reports_truncated(self) -> None:
        nio_client = _PagedNio([[_msg("e3", 300), _msg("e2", 200)], [_msg("e1", 100)]])
        svc = _service(nio_client)

        result = await svc.read_context("agent", "room", limit=2)

        assert sorted(_roots(result)) == ["e2", "e3"]
        assert result["truncated"] is True
        assert result["oldest_timestamp"] == 200

    async def test_reaching_room_start_is_not_truncated(self) -> None:
        nio_client = _PagedNio([[_msg("e2", 200)], [_msg("e1", 100)]])
        svc = _service(nio_client)

        result = await svc.read_context("agent", "room", limit=50)

        assert result["truncated"] is False
        assert result["oldest_timestamp"] == 100


class TestWindowing:
    async def test_before_pages_backwards_instead_of_filtering(self) -> None:
        # Everything older than the cutoff lives on later pages. The old code
        # filtered page one, found nothing, and returned empty.
        nio_client = _PagedNio(
            [
                [_msg("new2", 900), _msg("new1", 800)],
                [_msg("old2", 200), _msg("old1", 100)],
            ]
        )
        svc = _service(nio_client)

        result = await svc.read_context("agent", "room", limit=10, before_ms=500)

        assert sorted(_roots(result)) == ["old1", "old2"]

    async def test_since_stops_the_walk_once_the_window_is_covered(self) -> None:
        nio_client = _PagedNio([[_msg("e2", 900)], [_msg("e1", 100)]])
        svc = _service(nio_client)

        result = await svc.read_context("agent", "room", limit=50, since_ms=500)

        assert _roots(result) == ["e2"]
        # The window was fully covered — this is not a truncated read.
        assert result["truncated"] is False


class TestJoins:
    async def test_join_appears_in_the_timeline(self) -> None:
        nio_client = _PagedNio([[_join("$j", 100, "@alice:s", "Alice")]])
        svc = _service(nio_client)

        result = await svc.read_context("agent", "room", limit=10)

        entry = result["threads"][0]["root"]
        assert entry["kind"] == "room_join"
        assert entry["body"] == "Alice joined the room"
        assert entry["sender"] == "@alice:s"

    async def test_display_name_change_is_not_an_arrival(self) -> None:
        nio_client = _PagedNio([[_rename("$r", 100, "@alice:s", "Alice II")]])
        svc = _service(nio_client)

        result = await svc.read_context("agent", "room", limit=10)

        assert result["threads"] == []

    async def test_messages_are_labelled_as_messages(self) -> None:
        nio_client = _PagedNio([[_msg("e1", 100)]])
        svc = _service(nio_client)

        result = await svc.read_context("agent", "room", limit=10)

        assert result["threads"][0]["root"]["kind"] == "message"
