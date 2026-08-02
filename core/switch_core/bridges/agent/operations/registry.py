"""The agent operation registry — the single definition of what an agent can do.

Both agent-facing front doors are built from this: the HTTP operations endpoint
dispatches into it, and the MCP server registers its tools from it. Neither
owns the operations, so neither can drift from the other, and removing a door
is removing a door rather than a refactor of everything underneath.

An operation is a plain async function. It takes its arguments and nothing
else — who is calling and which connection they belong to come from the call
context, so operations carry no transport types in their signatures.
"""

from __future__ import annotations

from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from typing import Any

OperationFn = Callable[..., Awaitable[Any]]


@dataclass(frozen=True)
class Operation:
    name: str
    fn: OperationFn
    description: str


_REGISTRY: dict[str, Operation] = {}


def operation(fn: OperationFn) -> OperationFn:
    """Register an agent operation under its own function name.

    The name is the function name verbatim — it is what an agent calls over
    MCP and what appears in `POST /ops/{operation}`. One vocabulary, so a
    translating runtime needs no mapping table.
    """
    name = fn.__name__
    if name in _REGISTRY:
        raise RuntimeError(f"operation {name!r} is already registered")
    _REGISTRY[name] = Operation(
        name=name, fn=fn, description=(fn.__doc__ or "").strip()
    )
    return fn


def all_operations() -> dict[str, Operation]:
    return dict(_REGISTRY)


def get_operation(name: str) -> Operation | None:
    return _REGISTRY.get(name)
