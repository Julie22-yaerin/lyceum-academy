"""
Forum — public signup/browse/chat endpoints for thelyceum.site/forum. No
Firebase auth requirement: this is a pre-account signup funnel identified by
email, same style as applications.py/access_codes.py. Chat and connection
endpoints instead require a forum-issued token (X-Forum-Token header,
app.services.forum.issue_forum_token/verify_forum_token) since real
user-to-user interaction makes a bare client-supplied email spoofable.
Admin management (group CRUD, member rosters) lives in admin.py alongside
every other admin resource, guarded by admin.py's own `_auth`.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, Header, HTTPException, Request
from pydantic import BaseModel

from app.core.limiter import limiter
from app.services import forum as forum_svc

router = APIRouter(prefix="/forum", tags=["forum"])


def _forum_auth(x_forum_token: str = Header(...)) -> str:
    email = forum_svc.verify_forum_token(x_forum_token)
    if not email:
        raise HTTPException(status_code=401, detail="invalid_or_expired_forum_token")
    return email


@router.get("/groups")
def forum_groups():
    return {"groups": forum_svc.list_groups(active_only=True)}


class ForumApplyRequest(BaseModel):
    name: str
    email: str
    linkedin_url: str = ""
    role: str = "founder"
    business_email: str = ""
    business_name: str = ""
    industry: str = ""
    stage: str = ""
    photo_url: str = ""
    looking_for_customers: bool = False
    target_customer_description: str = ""


@router.post("/apply")
@limiter.limit("5/minute")
async def forum_apply(request: Request, req: ForumApplyRequest):
    result = await forum_svc.apply(
        name=req.name,
        email=req.email,
        linkedin_url=req.linkedin_url,
        role=req.role,
        business_email=req.business_email,
        business_name=req.business_name,
        industry=req.industry,
        stage=req.stage,
        photo_url=req.photo_url,
        looking_for_customers=req.looking_for_customers,
        target_customer_description=req.target_customer_description,
    )
    if not result.get("ok"):
        status = 402 if result.get("error") == "paid_plan_required" else 400
        raise HTTPException(status_code=status, detail=result.get("error"))
    return result


class ForumLoginRequest(BaseModel):
    email: str


@router.post("/login")
@limiter.limit("10/minute")
def forum_login(request: Request, req: ForumLoginRequest):
    result = forum_svc.login(req.email)
    if not result:
        raise HTTPException(status_code=404, detail="not_found")
    if result.get("error"):
        raise HTTPException(status_code=402, detail=result["error"])
    return result


@router.get("/me")
def forum_me(email: str):
    member = forum_svc.get_member(email)
    if not member:
        raise HTTPException(status_code=404, detail="not_found")
    forum_svc.touch_activity(member["email"])
    return {"member": member}


@router.get("/connections")
def forum_connections(email: str = Depends(_forum_auth)):
    return forum_svc.get_connections(email)


@router.post("/connections/{connection_id}/dismiss")
def forum_connections_dismiss(connection_id: str, email: str = Depends(_forum_auth)):
    result = forum_svc.dismiss_connection(connection_id, email)
    if not result.get("ok"):
        raise HTTPException(status_code=404, detail=result.get("error"))
    return result


@router.get("/threads/{thread_id}/messages")
def forum_thread_messages(thread_id: str, since: str | None = None, email: str = Depends(_forum_auth)):
    if not forum_svc.can_access_thread(thread_id, email):
        raise HTTPException(status_code=403, detail="not_a_participant")
    return {"messages": forum_svc.list_messages(thread_id, since)}


class ForumPitchIn(BaseModel):
    context: str = ""
    hypothesis: str = ""
    reasoning: str = ""
    risk: str = ""


class ForumPostMessageRequest(BaseModel):
    message_type: str
    body: str = ""
    pitch: ForumPitchIn | None = None


@router.post("/threads/{thread_id}/messages")
@limiter.limit("20/minute")
def forum_post_message(request: Request, thread_id: str, req: ForumPostMessageRequest, email: str = Depends(_forum_auth)):
    pitch = req.pitch or ForumPitchIn()
    result = forum_svc.post_message(
        thread_id=thread_id,
        author_email=email,
        message_type=req.message_type,
        body=req.body,
        pitch_context=pitch.context,
        pitch_hypothesis=pitch.hypothesis,
        pitch_reasoning=pitch.reasoning,
        pitch_risk=pitch.risk,
    )
    if not result.get("ok"):
        raise HTTPException(status_code=400, detail=result.get("error"))
    return result


class ForumCommentRequest(BaseModel):
    verdict: str
    content: str = ""


@router.post("/messages/{message_id}/comments")
@limiter.limit("30/minute")
def forum_post_comment(request: Request, message_id: str, req: ForumCommentRequest, email: str = Depends(_forum_auth)):
    result = forum_svc.add_comment(message_id, email, req.verdict, req.content)
    if not result.get("ok"):
        raise HTTPException(status_code=400, detail=result.get("error"))
    return result
