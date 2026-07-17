"""
Commander API Router
════════════════════

Chỉ huy đội dev + chống content độc hại.

Endpoints:
  POST /commander/triage              — Classify a bug (critical/minor)
  GET  /commander/bugs/critical       — List critical bugs (fix now)
  GET  /commander/bugs/minor          — List minor bugs (batch every 4 days)
  POST /commander/bugs/batch          — Trigger batch processing now
  POST /commander/safety/check-text   — AI text safety check
  POST /commander/safety/check-file   — File safety check
  GET  /commander/safety/blocked      — Admin: recent blocked content
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, HTTPException
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
    auth: dict | None = None,
) -> dict[str, Any]:
    """
    Classify a bug report as CRITICAL or MINOR.

    CRITICAL → dispatched to dev immediately
    MINOR → batched, processed every 4 days
    """
    reported_by = "anonymous"
    if auth:
        reported_by = auth.get("user_id") or auth.get("sub") or "anonymous"

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


# ── Content Safety ─────────────────────────────────────────────────────────

class TextSafetyRequest(BaseModel):
    text: str
    context: str = ""


@router.post("/safety/check-text")
async def check_text_safety(
    req: TextSafetyRequest,
) -> dict[str, Any]:
    """
    AI-powered text safety check.
    Detects profanity, hate speech, harmful content.
    """
    result = await cmd_svc.check_text_safety(req.text, req.context)
    return result


class FileSafetyRequest(BaseModel):
    filename: str
    mime: str = ""
    # Note: actual file content check is done via check_file_safety()
    # with raw bytes — this endpoint is for pre-upload validation info


@router.post("/safety/check-file")
async def check_file_safety_info(
    filename: str = "",
    mime: str = "",
) -> dict[str, Any]:
    """
    Quick file safety check (extension + MIME validation).
    For full content scan, use the upload endpoints which call
    commander.check_file_safety() internally.
    """
    import os
    ext = os.path.splitext(filename)[1].lower() if filename else ""

    dangerous_exts = {
        '.exe', '.dll', '.so', '.dylib', '.bat', '.cmd', '.sh', '.ps1',
        '.vbs', '.js', '.msi', '.app', '.dmg', '.pkg', '.deb', '.rpm',
        '.py', '.rb', '.php', '.pl', '.jar', '.class', '.elf',
        '.zip', '.tar', '.gz', '.rar', '.7z',
        '.html', '.htm', '.svg', '.xml',
        '.lnk', '.scr', '.pif',
    }

    safe_exts = {
        '.pdf', '.png', '.jpg', '.jpeg', '.webp',
        '.txt', '.md', '.webm', '.ogg', '.mp3', '.mp4', '.wav',
    }

    if ext in dangerous_exts:
        return {"safe": False, "reason": f"Extension '{ext}' not allowed", "category": "unauthorized-extension"}
    if ext and ext not in safe_exts:
        return {"safe": False, "reason": f"Extension '{ext}' not in whitelist", "category": "unknown-extension"}
    return {"safe": True, "reason": "passed", "category": "none"}


@router.get("/safety/blocked")
async def get_blocked_content(
    limit: int = 50,
    _: dict = Depends(require_auth),
) -> dict[str, Any]:
    """Admin: return recent blocked content events."""
    return {
        "blocked": cmd_svc.get_blocked_content(limit),
        "total": len(cmd_svc._blocked_content),
    }
