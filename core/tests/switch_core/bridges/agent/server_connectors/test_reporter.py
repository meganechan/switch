"""The production reporter: what a connector's output actually does.

The connector suites use a recording fake, so this is the only place the real
`_ProtocolReporter` — the thing that talks to `ProtocolService` — is exercised.
"""

from __future__ import annotations

from typing import Any

from switch_core.bridges.agent.server_connectors.core import (
    _AgentHandle,
    _ProtocolReporter,
)

ROOM_ID = "room-1"
AGENT_ID = "agent-1"


class _FakeProtocol:
    def __init__(self) -> None:
        self.sends: list[dict[str, Any]] = []

    async def send_message(
        self, agent_id: str, room_id: str, content: str, thread_id: str | None = None
    ) -> str:
        self.sends.append(
            {
                "agent_id": agent_id,
                "room_id": room_id,
                "content": content,
                "thread_id": thread_id,
            }
        )
        return "$event"


def _reporter(protocol: _FakeProtocol) -> _ProtocolReporter:
    return _ProtocolReporter(
        protocol,  # type: ignore[arg-type]
        _AgentHandle(agent_id=AGENT_ID, agent_name="agent"),
    )


async def test_a_thread_id_reaches_the_protocol_service() -> None:
    # The plumbing that makes threaded replies possible at all. ProtocolService
    # has always accepted thread_id; the reporter simply never passed it.
    protocol = _FakeProtocol()
    await _reporter(protocol).send_message(ROOM_ID, "hello", "$root")

    assert protocol.sends == [
        {
            "agent_id": AGENT_ID,
            "room_id": ROOM_ID,
            "content": "hello",
            "thread_id": "$root",
        }
    ]


async def test_omitting_the_thread_posts_at_the_room_root() -> None:
    protocol = _FakeProtocol()
    await _reporter(protocol).send_message(ROOM_ID, "hello")

    assert protocol.sends[0]["thread_id"] is None


async def test_the_reporter_sends_as_its_own_agent() -> None:
    # One reporter is bound per agent handle; sending as the wrong agent would
    # attribute an agent's words to another.
    protocol = _FakeProtocol()
    await _reporter(protocol).send_message(ROOM_ID, "hello")

    assert protocol.sends[0]["agent_id"] == AGENT_ID
