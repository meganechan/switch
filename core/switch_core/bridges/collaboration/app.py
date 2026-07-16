from __future__ import annotations

from fastapi import FastAPI

from switch_core.bridges.collaboration.api import router as bridges_router
from switch_core.bridges.collaboration.dependencies import init_dependencies
from switch_core.bridges.collaboration.lifecycle_service import (
    CollaborationBridgeLifecycleService,
)
from switch_core.db.stores.collaboration_bridge_store import CollaborationBridgeStore


def create_collaboration_bridge_app(
    *,
    bridge_store: CollaborationBridgeStore,
    collab_lifecycle: CollaborationBridgeLifecycleService,
    session_factory: object,
) -> FastAPI:
    init_dependencies(
        bridge_store=bridge_store,
        collab_lifecycle=collab_lifecycle,
        session_factory=session_factory,
    )

    app = FastAPI(title="Switch Collaboration Bridge API")
    app.include_router(bridges_router, prefix="/bridges", tags=["bridges"])

    return app
