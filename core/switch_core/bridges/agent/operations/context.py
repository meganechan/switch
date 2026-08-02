"""Who is calling an operation, and what they are bound to.

Operations take their arguments and nothing else. Everything about the caller —
which agent, which connection or session, and therefore which room — is
resolved here, so an operation's signature carries no transport types and the
same function serves both front doors.
"""

from __future__ import annotations

import logging
from typing import TYPE_CHECKING

from switch_core.bridges.agent.operations.callctx import current_call_context

if TYPE_CHECKING:
    from switch_core.bridges.agent.protocol.service import ProtocolService

logger = logging.getLogger(__name__)

_protocol: ProtocolService | None = None


def init_operations_protocol(protocol: ProtocolService) -> None:
    global _protocol
    _protocol = protocol


def get_protocol() -> ProtocolService:
    assert _protocol is not None, "operations protocol not initialized"
    return _protocol


def get_agent_id() -> str:
    """The agent this call is being made on behalf of.

    Every front door binds a call context before dispatching, so operations
    never reach into a transport to find out who is calling.
    """
    bound = current_call_context()
    if bound is None:
        raise ValueError(
            "No call context bound — the front door must establish the caller "
            "before dispatching an operation"
        )
    return bound.agent_id


def session_key() -> str | None:
    """The thing that owns this caller's room binding.

    A connection id, or an MCP transport session — operations only ever compare
    it for equality, so which one it is does not matter above this line. None
    when the caller is bound to nothing, which the operations that need a room
    report as "not connected".
    """
    bound = current_call_context()
    return bound.session_key if bound is not None else None


async def require_connected_room() -> str:
    """The room this caller is bound to, or a clear error saying it is not."""
    key = session_key()
    if not key:
        raise ValueError("Not connected to a room. Call connect_to_room first.")
    protocol = get_protocol()
    async with protocol.session_factory() as db:
        result = await protocol.agent_session_store.get_connected_room(db, key)
    if result is None:
        raise ValueError("Not connected to a room. Call connect_to_room first.")
    _, room_id = result
    return room_id
