"""
Content Catalog Router
════════════════════════

Admin CRUD for the curated WorkspaceCatalog/CatalogItem catalog, plus the
two student-facing endpoints that replace manual upload/topic-input across
Notes/Playground: GET /workspaces/catalog (onboarding's catalog browser) and
GET /coach/today (what the Coach picked for a joined workspace today).
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.api.deps import require_auth
from app.db.session import get_db
from app.routers.admin import _auth as _admin_auth
from app.services import content_catalog as catalog_svc

router = APIRouter(tags=["content-catalog"])


def _uid(auth: dict) -> str:
    return auth.get("user_id") or auth.get("sub") or ""


def _workspace_dict(ws) -> dict[str, Any]:
    return {
        "id": str(ws.id), "title": ws.title, "subject_key": ws.subject_key,
        "field": ws.field.value if hasattr(ws.field, "value") else ws.field,
        "description": ws.description, "is_published": ws.is_published,
    }


def _item_dict(item) -> dict[str, Any]:
    return {
        "id": str(item.id), "workspace_id": str(item.workspace_id),
        "concept_name": item.concept_name, "item_type": item.item_type,
        "title": item.title, "content": item.content, "ordinal": item.ordinal,
    }


# ── Admin CRUD ────────────────────────────────────────────────────────────

class WorkspaceIn(BaseModel):
    title: str
    subject_key: str
    field: str
    description: str = ""
    is_published: bool = False


@router.post("/admin/catalog/workspaces", status_code=201)
async def admin_create_workspace(body: WorkspaceIn, db: Session = Depends(get_db), _: None = Depends(_admin_auth)):
    ws = catalog_svc.create_workspace(db, body.title, body.subject_key, body.field, body.description, body.is_published)
    return _workspace_dict(ws)


@router.get("/admin/catalog/workspaces")
async def admin_list_workspaces(db: Session = Depends(get_db), _: None = Depends(_admin_auth)):
    return {"workspaces": [_workspace_dict(w) for w in catalog_svc.list_workspaces(db)]}


@router.delete("/admin/catalog/workspaces/{workspace_id}")
async def admin_delete_workspace(workspace_id: str, db: Session = Depends(get_db), _: None = Depends(_admin_auth)):
    if not catalog_svc.delete_workspace(db, workspace_id):
        raise HTTPException(404, "Workspace not found")
    return {"ok": True}


class CatalogItemIn(BaseModel):
    concept_name: str
    item_type: str
    title: str
    content: dict = {}
    ordinal: int = 0


@router.post("/admin/catalog/workspaces/{workspace_id}/items", status_code=201)
async def admin_create_item(workspace_id: str, body: CatalogItemIn, db: Session = Depends(get_db), _: None = Depends(_admin_auth)):
    item = catalog_svc.create_item(db, workspace_id, body.concept_name, body.item_type, body.title, body.content, body.ordinal)
    return _item_dict(item)


@router.get("/admin/catalog/workspaces/{workspace_id}/items")
async def admin_list_items(workspace_id: str, db: Session = Depends(get_db), _: None = Depends(_admin_auth)):
    return {"items": [_item_dict(i) for i in catalog_svc.list_items(db, workspace_id)]}


@router.delete("/admin/catalog/items/{item_id}")
async def admin_delete_item(item_id: str, db: Session = Depends(get_db), _: None = Depends(_admin_auth)):
    if not catalog_svc.delete_item(db, item_id):
        raise HTTPException(404, "Item not found")
    return {"ok": True}


# ── Student-facing ───────────────────────────────────────────────────────

@router.get("/workspaces/catalog")
async def list_published_workspaces(db: Session = Depends(get_db), _: dict = Depends(require_auth)):
    """Published workspaces students can browse/join at onboarding."""
    return {"workspaces": [_workspace_dict(w) for w in catalog_svc.list_workspaces(db, published_only=True)]}


@router.get("/coach/today")
async def coach_today(workspace_id: str, db: Session = Depends(get_db), auth: dict = Depends(require_auth)):
    """
    What the Coach has selected for this student in this workspace — split
    into today's freshly-served items and the student's serving history.
    Triggers selection (one Coach call) if nothing's been served yet today.
    """
    uid = _uid(auth)
    today_items = await catalog_svc.get_or_create_today(db, uid, workspace_id)
    history = catalog_svc.served_history(db, uid, workspace_id)
    history_item_ids = [row.catalog_item_id for row in history]
    from sqlalchemy import select
    from app.models.entities import CatalogItem
    studied_items = list(db.execute(select(CatalogItem).where(CatalogItem.id.in_(history_item_ids))).scalars().all()) if history_item_ids else []
    return {
        "today": [_item_dict(i) for i in today_items],
        "studied": [_item_dict(i) for i in studied_items],
    }
