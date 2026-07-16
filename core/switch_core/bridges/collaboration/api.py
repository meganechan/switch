from __future__ import annotations

from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from switch_core.bridges.collaboration.dependencies import (
    get_bridge_store,
    get_collab_lifecycle,
    get_session,
)
from switch_core.bridges.collaboration.lifecycle_service import (
    CollaborationBridgeLifecycleService,
)
from switch_core.db.stores.collaboration_bridge_store import CollaborationBridgeStore

router = APIRouter()


class OnboardBridgeRequest(BaseModel):
    bridge_type: str
    display_name: str
    connection_config: dict[str, Any]


class OnboardBridgeResponse(BaseModel):
    bridge_id: str
    status: str


class BridgeInfo(BaseModel):
    bridge_id: str
    bridge_type: str
    display_name: str
    status: str


@router.post("")
async def onboard_bridge(
    req: OnboardBridgeRequest,
    collab_lifecycle: Annotated[
        CollaborationBridgeLifecycleService, Depends(get_collab_lifecycle)
    ],
) -> OnboardBridgeResponse:
    try:
        bridge = await collab_lifecycle.register(
            bridge_type=req.bridge_type,
            display_name=req.display_name,
            connection_config=req.connection_config,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except RuntimeError as e:
        raise HTTPException(status_code=502, detail=str(e))

    return OnboardBridgeResponse(bridge_id=bridge.id, status=bridge.status)


@router.get("")
async def list_bridges(
    session: Annotated[AsyncSession, Depends(get_session)],
    bridge_store: Annotated[CollaborationBridgeStore, Depends(get_bridge_store)],
) -> list[BridgeInfo]:
    bridges = await bridge_store.get_all(session)
    return [
        BridgeInfo(
            bridge_id=b.id,
            bridge_type=b.type,
            display_name=b.display_name,
            status=b.status,
        )
        for b in bridges
    ]


@router.get("/{bridge_id}")
async def get_bridge(
    bridge_id: str,
    session: Annotated[AsyncSession, Depends(get_session)],
    bridge_store: Annotated[CollaborationBridgeStore, Depends(get_bridge_store)],
) -> BridgeInfo:
    bridge = await bridge_store.get(session, bridge_id)
    if bridge is None:
        raise HTTPException(status_code=404, detail="Bridge not found")

    return BridgeInfo(
        bridge_id=bridge.id,
        bridge_type=bridge.type,
        display_name=bridge.display_name,
        status=bridge.status,
    )


@router.delete("/{bridge_id}")
async def remove_bridge(
    bridge_id: str,
    collab_lifecycle: Annotated[
        CollaborationBridgeLifecycleService, Depends(get_collab_lifecycle)
    ],
) -> dict[str, bool]:
    await collab_lifecycle.remove(bridge_id)
    return {"ok": True}
