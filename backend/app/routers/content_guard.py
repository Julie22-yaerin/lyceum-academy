"""
Content Guard API Router ("Safety Guard" in the admin UI)
══════════════════════════════════════════════════════════

Endpoints:
  POST /content-guard/check-text   — AI text safety check
  POST /content-guard/check-file   — File safety check (extension/MIME info)
  GET  /content-guard/blocked      — Admin: recent blocked content
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends
from pydantic import BaseModel

from app.routers.admin import _auth as _admin_auth
from app.services import content_guard as guard_svc

router = APIRouter(prefix="/content-guard", tags=["content-guard"])


class TextSafetyRequest(BaseModel):
    text: str
    context: str = ""


@router.post("/check-text")
async def check_text_safety(req: TextSafetyRequest) -> dict[str, Any]:
    """AI-powered text safety check. Detects profanity, hate speech, harmful content."""
    return await guard_svc.check_text_safety(req.text, req.context)


@router.post("/check-file")
async def check_file_safety_info(filename: str = "", mime: str = "") -> dict[str, Any]:
    """
    Quick file safety check (extension + MIME validation).
    For full content scan, use the upload endpoints which call
    content_guard.check_file_safety() internally.
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


@router.get("/blocked")
async def get_blocked_content(limit: int = 50, _: None = Depends(_admin_auth)) -> dict[str, Any]:
    """Admin: return recent blocked content events."""
    return {
        "blocked": guard_svc.get_blocked_content(limit),
        "total": len(guard_svc._blocked_content),
    }
