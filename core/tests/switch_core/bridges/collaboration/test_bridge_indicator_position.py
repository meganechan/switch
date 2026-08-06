from __future__ import annotations

import asyncio
from types import SimpleNamespace
from typing import Any

from switch_core.bridges.collaboration.bridge_core import BridgeCore


class _FakeAdapter:
    def __init__(self, live: list[str]) -> None:
        self._live = live
        self.moved: list[tuple[str, str]] = []

    def agents_with_live_runtime_state(self, channel_id: str) -> list[str]:
        return list(self._live)

    async def reposition_runtime_state(self, channel_id: str, agent_name: str) -> None:
        self.moved.append((channel_id, agent_name))


def _bridge(live: list[str], *, aliases: dict[str, str] | None = None) -> Any:
    """A BridgeCore stand-in wired to the real positioning methods."""
    adapter = _FakeAdapter(live)
    alias_map = aliases or {}

    class _RoomStore:
        async def get_agent_id_by_alias(
            self, _session: Any, _room_id: str, alias: str
        ) -> str | None:
            return alias_map.get(alias.lower())

    class _AgentStore:
        async def get(self, _session: Any, agent_id: str) -> Any:
            return SimpleNamespace(name=agent_id)

    class _Session:
        async def __aenter__(self) -> Any:
            return self

        async def __aexit__(self, *_exc: Any) -> None:
            return None

    ns = SimpleNamespace(
        _adapter=adapter,
        _room_store=_RoomStore(),
        _agent_store=_AgentStore(),
        _session_factory=lambda: _Session(),
        _indicator_move_timers={},
        adapter_spy=adapter,
    )
    for name in (
        "_move_indicator_for_sender",
        "_move_indicators_for_addressees",
        "_live_agents_addressed_by_alias",
        "_schedule_indicator_move",
        "_run_indicator_move",
    ):
        setattr(ns, name, getattr(BridgeCore, name).__get__(ns))
    return ns


def _drain(bridge: Any, coro: Any) -> list[tuple[str, str]]:
    """Run `coro`, then let every queued move fire, and report what moved."""

    async def _go() -> None:
        await coro
        timers = list(bridge._indicator_move_timers.values())
        # Fire the coalescing timers immediately rather than waiting them out.
        for timer in timers:
            timer.cancel()
        for key in list(bridge._indicator_move_timers):
            await bridge._run_indicator_move(key)

    asyncio.run(_go())
    return bridge.adapter_spy.moved


def _addressees(bridge: Any, content: str, channel_type: str = "channel_public") -> Any:
    return bridge._move_indicators_for_addressees(
        channel_id="chan-1",
        room_id="room-1",
        channel_type=channel_type,
        content=content,
        mention_target=None,
    )


# ── Inbound: only agents the message addresses ──────────────────────────────


def test_addressed_agent_indicator_follows_the_message() -> None:
    bridge = _bridge(["agent-a"])

    moved = _drain(bridge, _addressees(bridge, "@agent-a can you look at this?"))

    assert moved == [("chan-1", "agent-a")]


def test_unaddressed_chatter_leaves_the_indicator_alone() -> None:
    # The whole point of scoping this per agent: a busy channel must not drag a
    # working agent's indicator around on traffic that has nothing to do with it.
    bridge = _bridge(["agent-a"])

    moved = _drain(bridge, _addressees(bridge, "unrelated chatter between humans"))

    assert moved == []


def test_only_the_addressed_agent_of_several_moves() -> None:
    bridge = _bridge(["agent-a", "agent-b"])

    moved = _drain(bridge, _addressees(bridge, "@agent-b over to you"))

    assert moved == [("chan-1", "agent-b")]


def test_a_prefix_of_a_longer_name_is_not_treated_as_addressed() -> None:
    bridge = _bridge(["agent-a"])

    moved = _drain(bridge, _addressees(bridge, "@agent-a-2 please take this"))

    assert moved == []


def test_agent_addressed_by_its_room_alias_moves() -> None:
    bridge = _bridge(["agent-a"], aliases={"worker": "agent-a"})

    moved = _drain(bridge, _addressees(bridge, "@worker ping"))

    assert moved == [("chan-1", "agent-a")]


def test_every_message_addresses_the_agent_in_a_dm_room() -> None:
    bridge = _bridge(["agent-a"])

    moved = _drain(
        bridge, _addressees(bridge, "no mention here", channel_type="direct")
    )

    assert moved == [("chan-1", "agent-a")]


def test_nothing_is_scheduled_when_no_indicator_is_live() -> None:
    bridge = _bridge([])

    moved = _drain(bridge, _addressees(bridge, "@agent-a hello"))

    assert moved == []


# ── Outbound: the agent's own messages ──────────────────────────────────────


def test_indicator_follows_a_message_the_agent_posts() -> None:
    bridge = _bridge(["agent-a"])

    moved = _drain(bridge, bridge._move_indicator_for_sender("chan-1", "agent-a"))

    assert moved == [("chan-1", "agent-a")]


def test_another_agents_message_does_not_move_this_indicator() -> None:
    bridge = _bridge(["agent-a"])

    moved = _drain(bridge, bridge._move_indicator_for_sender("chan-1", "agent-b"))

    assert moved == []


# ── Coalescing ──────────────────────────────────────────────────────────────


def test_a_burst_of_messages_costs_a_single_move() -> None:
    bridge = _bridge(["agent-a"])
    scheduled: list[Any] = []

    async def burst() -> None:
        for _ in range(20):
            await _addressees(bridge, "@agent-a another one")
            scheduled.append(bridge._indicator_move_timers[("chan-1", "agent-a")])

    moved = _drain(bridge, burst())

    # One timer object throughout: later messages were absorbed into the queued
    # move rather than each scheduling their own.
    assert len(scheduled) == 20
    assert all(timer is scheduled[0] for timer in scheduled)
    assert moved == [("chan-1", "agent-a")]


def test_a_later_message_does_not_push_the_queued_move_back() -> None:
    # A sustained conversation must not starve the move by resetting its timer
    # on every message, so the deadline is set once and left alone.
    bridge = _bridge(["agent-a"])
    deadlines: list[float] = []

    async def burst() -> None:
        for _ in range(3):
            await _addressees(bridge, "@agent-a keep talking")
            deadlines.append(
                bridge._indicator_move_timers[("chan-1", "agent-a")].when()
            )

    _drain(bridge, burst())

    assert len(set(deadlines)) == 1


def test_a_platform_failure_during_a_move_does_not_escape() -> None:
    # The indicator is cosmetic; a failed move must not propagate into the
    # bridge callback that happened to trigger it.
    bridge = _bridge(["agent-a"])

    async def boom(_channel_id: str, _agent_name: str) -> None:
        raise RuntimeError("platform down")

    bridge._adapter.reposition_runtime_state = boom

    asyncio.run(bridge._run_indicator_move(("chan-1", "agent-a")))
