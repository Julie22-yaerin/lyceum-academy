"""
Support Chat API Router
═══════════════════════

Endpoints:
  POST /support/chat          — Send a message, get a reply
  GET  /support/complaints    — Admin: view reported technical complaints
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from app.api.deps import require_auth
from app.services import support_chat as support_svc

router = APIRouter(prefix="/support", tags=["support"])


class SupportChatRequest(BaseModel):
    session_id: str
    message: str


@router.post("/chat")
async def support_chat_endpoint(
    req: SupportChatRequest,
    auth: dict | None = None,
) -> dict[str, Any]:
    """
    Send a message to the support chat.
    Returns { reply, complaint_reported, complaint_data? }
    """
    user_id = "anonymous"
    if auth:
        user_id = auth.get("user_id") or auth.get("sub") or "anonymous"

    result = await support_svc.support_chat(
        session_id=req.session_id,
        user_message=req.message,
        user_id=user_id,
    )
    return result


@router.get("/complaints")
async def get_complaints(
    limit: int = 50,
    _: dict = Depends(require_auth),
) -> dict[str, Any]:
    """Admin: return recent technical complaints reported by the support chat."""
    complaints = support_svc.get_complaints(limit)
    return {
        "complaints": complaints,
        "total": support_svc.get_complaint_count(),
    }
