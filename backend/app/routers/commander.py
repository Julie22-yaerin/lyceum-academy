"""
Commander API Router
════════════════════

Chỉ huy đội dev.

Endpoints:
  POST /commander/triage              — Classify a bug (critical/minor)
  GET  /commander/bugs/critical       — List critical bugs (fix now)
  GET  /commander/bugs/minor          — List minor bugs (batch every 4 days)
  GET  /commander/bugs/all            — Full bug history (admin Error Log)
  POST /commander/bugs/{id}/resolve   — Mark a bug fixed
  POST /commander/bugs/batch          — Trigger batch processing now

Content-safety endpoints live at /content-guard/* (app/routers/content_guard.py).
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel

from app.api.deps import require_auth
from app.routers.admin import _auth as _admin_auth
from app.services import commander as cmd_svc

router = APIRouter(prefix="/commander", tags=["commander"])


# ── Bug Triage ─────────────────────────────────────────────────────────────

class TriageRequest(BaseModel):
    bug_report: str
    endpoint: str = ""
    file_path: str = ""
    reported_by: str = "system"


@router.post("/triage")
async def triage_bug(
    req: TriageRequest,
    request: Request,
) -> dict[str, Any]:
    """
    Classify a bug report as CRITICAL or MINOR.

    CRITICAL → dispatched to dev immediately
    MINOR → batched, processed every 4 days
    """
    reported_by = "anonymous"
    auth_header = request.headers.get("authorization", "")
    if auth_header.startswith("Bearer "):
        try:
            from app.services.firebase_auth import verify_firebase_id_token
            payload = await verify_firebase_id_token(auth_header[7:].strip())
            reported_by = payload.get("user_id") or payload.get("sub") or "anonymous"
        except Exception:
            pass

    result = await cmd_svc.triage_bug(
        bug_report=req.bug_report,
        endpoint=req.endpoint,
        file_path=req.file_path,
        reported_by=reported_by,
    )
    return result


@router.get("/bugs/critical")
async def get_critical_bugs(
    _: dict = Depends(require_auth),
) -> dict[str, Any]:
    """List all critical bugs pending immediate dispatch."""
    return {
        "bugs": cmd_svc.get_critical_bugs(),
        "count": len(cmd_svc.get_critical_bugs()),
    }


@router.get("/bugs/minor")
async def get_minor_bugs(
    _: dict = Depends(require_auth),
) -> dict[str, Any]:
    """List all minor bugs pending batch processing."""
    bugs = cmd_svc.get_minor_bugs()
    return {
        "bugs": bugs,
        "count": len(bugs),
        "should_run_batch": cmd_svc.should_run_batch(),
        "batch_interval_days": 4,
    }


@router.get("/bugs/all")
async def list_all_bugs(
    status: str = "",
    _: None = Depends(_admin_auth),
) -> dict[str, Any]:
    """
    Full bug history for the admin Error Log — every triaged bug ever
    reported, newest first. status: "" (all) | "open" | "resolved".
    """
    bugs = cmd_svc.list_all_bugs(status)
    return {"bugs": bugs, "count": len(bugs)}


@router.post("/bugs/{bug_id}/resolve")
async def resolve_bug(
    bug_id: int,
    _: None = Depends(_admin_auth),
) -> dict[str, Any]:
    """Mark a bug as fixed."""
    if not cmd_svc.mark_resolved(bug_id):
        raise HTTPException(404, "Bug not found or already resolved")
    return {"ok": True}


@router.post("/bugs/batch")
async def trigger_batch(
    _: dict = Depends(require_auth),
) -> dict[str, Any]:
    """
    Trigger batch processing of minor bugs — dispatches each to its
    assigned dev and clears the minor queue.
    """
    batch = await cmd_svc.pop_batch()
    return {
        "batch": batch,
        "count": len(batch),
        "message": f"Batch of {len(batch)} minor bugs dispatched to dev agents.",
    }
