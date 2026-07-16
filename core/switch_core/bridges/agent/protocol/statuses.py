from __future__ import annotations

from sqlalchemy.ext.asyncio import AsyncSession

from switch_core.bridges.agent.protocol.types import AgentStatus
from switch_core.db.models import Agent
from switch_core.db.stores.agent_session_store import AgentSessionStore


async def compute_agent_statuses(
    session: AsyncSession,
    agents: list[Agent],
    room_id: str,
    agent_session_store: AgentSessionStore,
) -> dict[str, AgentStatus]:
    """Derive each agent's presence status in a room, keyed by agent id.

    The status follows the agent's ``connection_model``:

    - ``always_on``: LIVE if it has a live (room-agnostic) session, else
      DISCONNECTED.
    - ``session_addressable``: LIVE if it has a live session for this room,
      else NO_SESSION.
    - ``auto_session``: LIVE if it has a live session for this room; else
      DORMANT if a connector is actively watching (global "watching"
      heartbeat) and will spawn on demand; else DISCONNECTED.
    - ``session_passive``: always AWAITING_MANUAL_POLL (no heartbeat).

    Shared by ProtocolService (room detail / participants) and the in-room
    ``!status`` command so both report presence identically.
    """
    always_on_ids: list[str] = []
    addressable_ids: list[str] = []
    auto_session_ids: list[str] = []
    model_by_id: dict[str, str] = {}
    for agent in agents:
        connection_model = (agent.integration_profile or {}).get(
            "connection_model", "session_passive"
        )
        model_by_id[agent.id] = connection_model
        if connection_model == "always_on":
            always_on_ids.append(agent.id)
        elif connection_model == "session_addressable":
            addressable_ids.append(agent.id)
        elif connection_model == "auto_session":
            auto_session_ids.append(agent.id)

    live_always_on = await agent_session_store.get_live_agent_ids(
        session, always_on_ids, None
    )
    # auto_session agents are LIVE when a session heartbeats for this room,
    # and DORMANT when only the global "watching" heartbeat is fresh.
    live_auto_room = await agent_session_store.get_live_agent_ids(
        session, auto_session_ids, room_id
    )
    watching_auto = await agent_session_store.get_live_agent_ids(
        session, auto_session_ids, None
    )
    live_addressable = await agent_session_store.get_live_agent_ids(
        session, addressable_ids, room_id
    )

    statuses: dict[str, AgentStatus] = {}
    for agent in agents:
        model = model_by_id[agent.id]
        if model == "always_on":
            statuses[agent.id] = (
                AgentStatus.LIVE
                if agent.id in live_always_on
                else AgentStatus.DISCONNECTED
            )
        elif model == "session_addressable":
            statuses[agent.id] = (
                AgentStatus.LIVE
                if agent.id in live_addressable
                else AgentStatus.NO_SESSION
            )
        elif model == "auto_session":
            if agent.id in live_auto_room:
                statuses[agent.id] = AgentStatus.LIVE
            elif agent.id in watching_auto:
                statuses[agent.id] = AgentStatus.DORMANT
            else:
                statuses[agent.id] = AgentStatus.DISCONNECTED
        else:
            statuses[agent.id] = AgentStatus.AWAITING_MANUAL_POLL
    return statuses
