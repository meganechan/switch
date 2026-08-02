"""HTTP operations front door (CHOO-1857 / CHOO-490).

The property under test is parity: every MCP tool is reachable over HTTP under
the same name, because both doors dispatch into one registry. If someone adds a
tool and these fail, that is the point.
"""

from __future__ import annotations

import pytest

from switch_core.bridges.agent.api.operations import (
    BadArgumentsError,
    UnknownOperationError,
    call_operation,
    list_operations,
)
from switch_core.bridges.agent.mcp import server as mcp_server
from switch_core.bridges.agent.mcp.callctx import (
    CallContext,
    current_call_context,
    reset_call_context,
    set_call_context,
)

AGENT = "agent-1"


async def _tool_names() -> set[str]:
    return {tool.name for tool in await mcp_server.mcp._list_tools()}


async def test_every_mcp_tool_is_reachable_over_http() -> None:
    assert set(await list_operations()) == await _tool_names()


async def test_operation_names_are_the_tool_names_verbatim() -> None:
    # One vocabulary: a translating runtime is POST /ops/${toolName}, nothing
    # more. Renaming or namespacing here would reintroduce a mapping table.
    ops = await list_operations()
    for expected in ("connect_to_room", "post_message", "assume_role", "list_tasks"):
        assert expected in ops


async def test_operations_advertise_their_parameters() -> None:
    ops = await list_operations()
    params = ops["connect_to_room"]["parameters"]
    assert "room_id" in params["properties"]
    # `ctx` is a transport detail, not an argument an agent supplies.
    assert "ctx" not in params["properties"]


async def test_unknown_operation_names_what_is_available() -> None:
    with pytest.raises(UnknownOperationError) as excinfo:
        await call_operation(
            operation="teleport",
            arguments={},
            agent_id=AGENT,
            connection_id=None,
        )
    assert "connect_to_room" in str(excinfo.value)


async def test_unexpected_arguments_are_refused() -> None:
    with pytest.raises(BadArgumentsError) as excinfo:
        await call_operation(
            operation="connect_to_room",
            arguments={"room_id": "r", "colour": "blue"},
            agent_id=AGENT,
            connection_id=None,
        )
    assert "colour" in str(excinfo.value)


async def test_missing_required_arguments_are_refused() -> None:
    with pytest.raises(BadArgumentsError) as excinfo:
        await call_operation(
            operation="connect_to_room",
            arguments={},
            agent_id=AGENT,
            connection_id=None,
        )
    assert "room_id" in str(excinfo.value)


# ── Call context ────────────────────────────────────────────────────────────


async def test_the_call_context_carries_agent_and_connection() -> None:
    """The operation sees who called and which connection it belongs to."""
    seen: dict[str, object] = {}

    async def fake_op(room_id: str, ctx: object = None) -> str:
        bound = current_call_context()
        seen["agent_id"] = bound.agent_id if bound else None
        seen["session_key"] = bound.session_key if bound else None
        seen["ctx"] = ctx
        return "ok"

    class _FakeTool:
        name = "fake_op"
        fn = staticmethod(fake_op)
        description = "fake"
        parameters: dict = {}

    original = mcp_server.mcp._list_tools

    async def _list_tools():  # type: ignore[no-untyped-def]
        return [*await original(), _FakeTool()]

    mcp_server.mcp._list_tools = _list_tools  # type: ignore[method-assign]
    try:
        result = await call_operation(
            operation="fake_op",
            arguments={"room_id": "room-1"},
            agent_id=AGENT,
            connection_id="conn-9",
        )
    finally:
        mcp_server.mcp._list_tools = original  # type: ignore[method-assign]

    assert result == "ok"
    assert seen["agent_id"] == AGENT
    # The connection is the caller's session key: this is what lets an
    # operation resolve the room binding without an MCP transport session.
    assert seen["session_key"] == "conn-9"
    assert seen["ctx"] is None


def test_the_call_context_is_cleared_after_the_call() -> None:
    assert current_call_context() is None
    token = set_call_context(CallContext(agent_id=AGENT, session_key="c1"))
    assert current_call_context() is not None
    reset_call_context(token)
    assert current_call_context() is None


async def test_agent_id_prefers_the_bound_context_over_the_request_scope() -> None:
    token = set_call_context(CallContext(agent_id="bound-agent", session_key=None))
    try:
        # No HTTP request in scope at all: resolving would fail if the bound
        # context were not consulted first.
        assert mcp_server._get_agent_id() == "bound-agent"
    finally:
        reset_call_context(token)


async def test_session_key_prefers_the_bound_context() -> None:
    token = set_call_context(CallContext(agent_id=AGENT, session_key="conn-7"))
    try:
        assert mcp_server._session_key(None) == "conn-7"
    finally:
        reset_call_context(token)


def test_session_key_falls_back_to_the_mcp_transport_session() -> None:
    class _Ctx:
        session_id = "mcp-session-3"

    assert mcp_server._session_key(_Ctx()) == "mcp-session-3"
    assert mcp_server._session_key(None) is None
