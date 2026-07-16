from __future__ import annotations

from switch_core.events import SwitchEvent


class ResourceLoadEntry(SwitchEvent):
    id: str
    name: str
    description: str
    content: str


class ResourceLoadRequest(SwitchEvent):
    request_id: str
    agent_id: str
    document_ids: list[str]


class ResourceLoadResponse(SwitchEvent):
    request_id: str
    agent_id: str
    status: str  # "ok" | "error"
    documents: list[ResourceLoadEntry] = []
    error: str | None = None


# ── Room-scoped document mutations (agent-created via MCP) ────────────────


class RoomDocumentCreateRequest(SwitchEvent):
    request_id: str
    agent_id: str
    name: str
    description: str
    instructions: str
    content: str


class RoomDocumentCreateResponse(SwitchEvent):
    request_id: str
    agent_id: str
    status: str  # "ok" | "error"
    document_id: str | None = None
    document_name: str | None = None
    error: str | None = None


class RoomDocumentUpdateRequest(SwitchEvent):
    request_id: str
    agent_id: str
    document_id: str
    name: str | None = None
    description: str | None = None
    instructions: str | None = None
    content: str | None = None


class RoomDocumentUpdateResponse(SwitchEvent):
    request_id: str
    agent_id: str
    status: str
    document_name: str | None = None
    error: str | None = None


class RoomDocumentDeleteRequest(SwitchEvent):
    request_id: str
    agent_id: str
    document_id: str


class RoomDocumentDeleteResponse(SwitchEvent):
    request_id: str
    agent_id: str
    status: str
    document_name: str | None = None
    error: str | None = None
