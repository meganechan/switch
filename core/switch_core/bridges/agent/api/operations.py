"""HTTP front door for the agent operations (CHOO-1857 / CHOO-490).

`POST /agents/{agent_id}/ops/{operation}` with the operation's arguments as the
JSON body. Operation names are exactly the MCP tool names — one vocabulary, so
a local runtime translating between the two is `POST /ops/${toolName}` and
nothing more.

Both front doors dispatch into the **same** registry: this module looks the
operation up in the MCP tool registry rather than re-implementing it. Parity is
therefore structural — a new tool is reachable over HTTP the moment it exists,
and neither door can quietly fall behind the other.

What is deliberately NOT here: media upload/download (multipart and binary, so
HTTP semantics matter), the event stream, connection lifecycle, mediation, and
registration. Those are not agent tools.
"""

from __future__ import annotations

import inspect
import logging
from typing import Annotated, Any

from fastapi import APIRouter, Depends, Header, HTTPException

from switch_core.bridges.agent.auth import get_agent_from_scope
from switch_core.bridges.agent.dependencies import get_protocol
from switch_core.bridges.agent.mcp.callctx import (
    CallContext,
    reset_call_context,
    set_call_context,
)
from switch_core.bridges.agent.mcp.server import mcp
from switch_core.bridges.agent.protocol.connections import UnknownConnectionError
from switch_core.bridges.agent.protocol.service import ProtocolService
from switch_core.db.models import Agent

logger = logging.getLogger(__name__)


class UnknownOperationError(Exception):
    def __init__(self, name: str, known: list[str]) -> None:
        super().__init__(
            f"unknown operation {name!r}; expected one of: {', '.join(sorted(known))}"
        )
        self.name = name


class BadArgumentsError(Exception):
    """The body did not match the operation's parameters."""


async def list_operations() -> dict[str, dict[str, Any]]:
    """Every operation, with its JSON-schema parameters.

    Read straight off the tool registry, so this is the authoritative list for
    both doors and for the protocol documentation.
    """
    tools = await mcp._list_tools()
    return {
        tool.name: {
            "description": (tool.description or "").strip().split("\n")[0],
            "parameters": tool.parameters,
        }
        for tool in tools
    }


async def call_operation(
    *,
    operation: str,
    arguments: dict[str, Any],
    agent_id: str,
    connection_id: str | None,
) -> Any:
    """Run one operation on behalf of an agent.

    `connection_id` becomes the caller's session key, so an operation that
    depends on the caller's room binding — `connect_to_room`, `post_message`,
    `assume_role` — resolves it from the connection rather than from an MCP
    transport session. That is what makes the two doors interchangeable.
    """
    tools = {tool.name: tool for tool in await mcp._list_tools()}
    tool = tools.get(operation)
    if tool is None:
        raise UnknownOperationError(operation, list(tools))

    fn = getattr(tool, "fn", None)
    if fn is None:
        # Every agent operation is a plain function registered as a tool. A
        # tool without one is something else (a proxy or a mount) and must not
        # be silently treated as unavailable.
        raise RuntimeError(
            f"operation {operation!r} is registered as {type(tool).__name__}, "
            "which has no callable to dispatch to"
        )
    signature = inspect.signature(fn)
    accepted = set(signature.parameters)

    unexpected = set(arguments) - accepted
    if unexpected:
        raise BadArgumentsError(
            f"{operation} does not accept: {', '.join(sorted(unexpected))}"
        )

    call_args: dict[str, Any] = dict(arguments)
    if "ctx" in accepted:
        # There is no FastMCP context on this path. The only thing operations
        # take from it is the session key, which the call context supplies.
        call_args["ctx"] = None

    missing = [
        name
        for name, param in signature.parameters.items()
        if name not in call_args and param.default is inspect.Parameter.empty
    ]
    if missing:
        raise BadArgumentsError(f"{operation} requires: {', '.join(missing)}")

    token = set_call_context(CallContext(agent_id=agent_id, session_key=connection_id))
    try:
        result = fn(**call_args)
        if inspect.isawaitable(result):
            result = await result
        return result
    finally:
        reset_call_context(token)


# ── HTTP router ──────────────────────────────────────────────────────────────


router = APIRouter(prefix="/agents", tags=["operations"])


@router.get("/{agent_id}/ops")
async def get_operations(
    agent_id: str,
    agent: Annotated[Agent, Depends(get_agent_from_scope)],
) -> dict[str, Any]:
    """List every operation and its parameters, straight from the registry."""
    return {"operations": await list_operations()}


@router.post("/{agent_id}/ops/{operation}")
async def post_operation(
    agent_id: str,
    operation: str,
    agent: Annotated[Agent, Depends(get_agent_from_scope)],
    protocol: Annotated[ProtocolService, Depends(get_protocol)],
    body: dict[str, Any] | None = None,
    connection_id: Annotated[str | None, Header(alias="x-switch-connection-id")] = None,
) -> dict[str, Any]:
    """Run one operation. The body is the operation's arguments.

    `X-Switch-Connection-Id` ties the call to an open connection, which is how
    an operation that depends on the caller's room binding resolves it. It is
    derived here from the header rather than trusted from the body, and the
    connection is checked against the calling agent.
    """
    if connection_id is not None:
        # Derived, never taken on trust: a connection id belonging to another
        # agent, or to one that has already died, is refused rather than
        # silently treated as no connection at all.
        try:
            protocol.connections.require(agent.id, connection_id)
        except UnknownConnectionError as exc:
            raise HTTPException(status_code=409, detail=str(exc)) from exc

    try:
        result = await call_operation(
            operation=operation,
            arguments=body or {},
            agent_id=agent.id,
            connection_id=connection_id,
        )
    except UnknownOperationError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except BadArgumentsError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except PermissionError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc
    except ValueError as exc:
        # Operations raise ValueError for "you asked for something that is not
        # there or not allowed yet" - surfaced rather than swallowed.
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    return {"result": result}
