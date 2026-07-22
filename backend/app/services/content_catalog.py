"""
Admin-curated Content Catalog
══════════════════════════════

Plain CRUD helpers for WorkspaceCatalog/CatalogItem — the global catalog of
admin-authored subject workspaces students browse/join at onboarding, and
the lessons/exercise-sets/tools/games tagged to concepts within each. The
Coach (ai_roles/coach.py) selects from these; nothing here generates content.
"""

from __future__ import annotations

import uuid
from datetime import date

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.entities import CatalogItem, ServedMaterial, WorkspaceCatalog
from app.services.ai_roles.coach import select_daily_materials


def list_workspaces(db: Session, published_only: bool = False) -> list[WorkspaceCatalog]:
    q = select(WorkspaceCatalog)
    if published_only:
        q = q.where(WorkspaceCatalog.is_published.is_(True))
    return list(db.execute(q).scalars().all())


def create_workspace(db: Session, title: str, subject_key: str, field: str, description: str = "", is_published: bool = False) -> WorkspaceCatalog:
    ws = WorkspaceCatalog(title=title, subject_key=subject_key, field=field, description=description, is_published=is_published)
    db.add(ws)
    db.commit()
    db.refresh(ws)
    return ws


def delete_workspace(db: Session, workspace_id: str) -> bool:
    ws = db.get(WorkspaceCatalog, uuid.UUID(workspace_id))
    if not ws:
        return False
    db.delete(ws)
    db.commit()
    return True


def list_items(db: Session, workspace_id: str) -> list[CatalogItem]:
    q = select(CatalogItem).where(CatalogItem.workspace_id == uuid.UUID(workspace_id)).order_by(CatalogItem.ordinal)
    return list(db.execute(q).scalars().all())


def create_item(db: Session, workspace_id: str, concept_name: str, item_type: str, title: str, content: dict, ordinal: int = 0) -> CatalogItem:
    item = CatalogItem(
        workspace_id=uuid.UUID(workspace_id), concept_name=concept_name,
        item_type=item_type, title=title, content=content, ordinal=ordinal,
    )
    db.add(item)
    db.commit()
    db.refresh(item)
    return item


def delete_item(db: Session, item_id: str) -> bool:
    item = db.get(CatalogItem, uuid.UUID(item_id))
    if not item:
        return False
    db.delete(item)
    db.commit()
    return True


def served_today(db: Session, user_id: str, workspace_id: str, today: date | None = None) -> list[ServedMaterial]:
    today = today or date.today()
    q = select(ServedMaterial).where(
        ServedMaterial.user_id == user_id,
        ServedMaterial.workspace_id == uuid.UUID(workspace_id),
        ServedMaterial.served_date == today,
    )
    return list(db.execute(q).scalars().all())


def served_history(db: Session, user_id: str, workspace_id: str, before: date | None = None) -> list[ServedMaterial]:
    before = before or date.today()
    q = select(ServedMaterial).where(
        ServedMaterial.user_id == user_id,
        ServedMaterial.workspace_id == uuid.UUID(workspace_id),
        ServedMaterial.served_date < before,
    ).order_by(ServedMaterial.served_date.desc())
    return list(db.execute(q).scalars().all())


def served_concepts(db: Session, user_id: str, workspace_id: str) -> set[str]:
    """Concept names already served to this student in this workspace (any date)."""
    served_item_ids = db.execute(
        select(ServedMaterial.catalog_item_id).where(
            ServedMaterial.user_id == user_id,
            ServedMaterial.workspace_id == uuid.UUID(workspace_id),
        )
    ).scalars().all()
    if not served_item_ids:
        return set()
    concepts = db.execute(
        select(CatalogItem.concept_name).where(CatalogItem.id.in_(served_item_ids))
    ).scalars().all()
    return set(concepts)


def record_served(db: Session, user_id: str, workspace_id: str, catalog_item_ids: list[str], served_date: date | None = None) -> list[ServedMaterial]:
    served_date = served_date or date.today()
    rows = [
        ServedMaterial(user_id=user_id, workspace_id=uuid.UUID(workspace_id), catalog_item_id=uuid.UUID(cid), served_date=served_date)
        for cid in catalog_item_ids
    ]
    db.add_all(rows)
    db.commit()
    for r in rows:
        db.refresh(r)
    return rows


def _next_concept(db: Session, workspace_id: str, already_served: set[str]) -> str | None:
    items = list_items(db, workspace_id)
    for item in items:
        if item.concept_name not in already_served:
            return item.concept_name
    return None


async def get_or_create_today(db: Session, user_id: str, workspace_id: str) -> list[CatalogItem]:
    """
    Returns today's served CatalogItems for this student+workspace — if
    nothing's been served yet today, picks the next un-covered concept,
    asks the Coach which of its candidate items to serve, records them, and
    returns those. Idempotent within a day (re-visits just re-read the rows).
    """
    already_today = served_today(db, user_id, workspace_id)
    if already_today:
        ids = [row.catalog_item_id for row in already_today]
        return list(db.execute(select(CatalogItem).where(CatalogItem.id.in_(ids))).scalars().all())

    concept = _next_concept(db, workspace_id, served_concepts(db, user_id, workspace_id))
    if not concept:
        return []

    candidates = [i for i in list_items(db, workspace_id) if i.concept_name == concept]
    decision = await select_daily_materials(
        concept, [{"id": str(c.id), "item_type": c.item_type, "title": c.title} for c in candidates],
    )
    selected_ids = set(decision.get("selected_ids", []))
    chosen = [c for c in candidates if str(c.id) in selected_ids]
    if not chosen:
        chosen = candidates

    record_served(db, user_id, workspace_id, [str(c.id) for c in chosen])
    return chosen
