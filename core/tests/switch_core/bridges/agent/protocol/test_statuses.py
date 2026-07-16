from __future__ import annotations

from types import SimpleNamespace
from typing import Any

from switch_core.bridges.agent.protocol.statuses import compute_agent_statuses
from switch_core.bridges.agent.protocol.types import AgentStatus


class _FakeSessionStore:
    """Stub AgentSessionStore: an agent id is "live" iff it is in `live_ids`."""

    def __init__(self, live_ids: set[str]) -> None:
        self._live = live_ids
        self.calls: list[tuple[list[str], str | None]] = []

    async def get_live_agent_ids(
        self, _session: Any, agent_ids: list[str], room_id: str | None
    ) -> set[str]:
        self.calls.append((list(agent_ids), room_id))
        return {aid for aid in agent_ids if aid in self._live}


def _agent(agent_id: str, connection_model: str) -> SimpleNamespace:
    return SimpleNamespace(
        id=agent_id,
        integration_profile={"connection_model": connection_model},
    )


class TestComputeAgentStatuses:
    async def test_status_per_connection_model(self) -> None:
        agents = [
            _agent("on-live", "always_on"),
            _agent("on-down", "always_on"),
            _agent("addr-live", "session_addressable"),
            _agent("addr-none", "session_addressable"),
            _agent("passive", "session_passive"),
        ]
        store = _FakeSessionStore(live_ids={"on-live", "addr-live"})

        statuses = await compute_agent_statuses(None, agents, "room-1", store)

        assert statuses == {
            "on-live": AgentStatus.LIVE,
            "on-down": AgentStatus.DISCONNECTED,
            "addr-live": AgentStatus.LIVE,
            "addr-none": AgentStatus.NO_SESSION,
            "passive": AgentStatus.AWAITING_MANUAL_POLL,
        }

    async def test_liveness_scope_per_model(self) -> None:
        # always_on liveness is room-agnostic (room=None); session_addressable
        # liveness is scoped to the room.
        agents = [
            _agent("on", "always_on"),
            _agent("addr", "session_addressable"),
        ]
        store = _FakeSessionStore(live_ids=set())

        await compute_agent_statuses(None, agents, "room-9", store)

        assert (["on"], None) in store.calls
        assert (["addr"], "room-9") in store.calls

    async def test_missing_connection_model_defaults_to_passive(self) -> None:
        agent = SimpleNamespace(id="x", integration_profile={})
        store = _FakeSessionStore(live_ids=set())

        statuses = await compute_agent_statuses(None, [agent], "room-1", store)

        assert statuses == {"x": AgentStatus.AWAITING_MANUAL_POLL}
