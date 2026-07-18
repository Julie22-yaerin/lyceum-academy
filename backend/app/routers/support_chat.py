"""
Support Chat API Router
═══════════════════════

Endpoints:
  POST /support/chat          — Send a message, get a reply
  GET  /support/complaints    — Admin: view reported technical complaints
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Header, HTTPException, Request
from pydantic import BaseModel

from app.services import support_chat as support_svc

router = APIRouter(prefix="/support", tags=["support"])


class SupportChatRequest(BaseModel):
    session_id: str
    message: str


@router.post("/chat")
async def support_chat_endpoint(
    req: SupportChatRequest,
    request: Request,
) -> dict[str, Any]:
    """
    Send a message to the support chat.
    Returns { reply, complaint_reported, complaint_data? }
    """
    user_id = "anonymous"
    auth_header = request.headers.get("authorization", "")
    if auth_header.startswith("Bearer "):
        try:
            from app.services.firebase_auth import verify_firebase_id_token
            payload = await verify_firebase_id_token(auth_header[7:].strip())
            user_id = payload.get("user_id") or payload.get("sub") or "anonymous"
        except Exception:
            pass

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
