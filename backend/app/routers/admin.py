"""
Admin API router — RAG knowledge base management + fine-tuning examples.

All endpoints require the X-Admin-Token header matching ADMIN_SECRET env var.
"""

from __future__ import annotations
import io
import os
from typing import Optional

from fastapi import APIRouter, Depends, Header, HTTPException, UploadFile, File, Form
from fastapi.responses import PlainTextResponse
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.services import rag              as rag_svc
from app.services import second_brain     as second_brain_svc
from app.services import finetune_db      as ft_svc
from app.services import openai_finetune  as ft_openai
from app.services import activity_log     as activity_svc
from app.services import mastery_profile  as profile_svc
from app.services import feedback         as feedback_svc
from app.services import ai               as ai_svc
from app.services.content_safety import check_upload
from app.services.firebase_auth import verify_firebase_id_token
from app.db.session import get_db
from app.models.entities import UserProfile, AuthProviderEnum, SubscriptionPlan, PlanFeatureToken

router      = APIRouter(prefix="/admin", tags=["admin"])
ADMIN_TOKEN = os.getenv("ADMIN_SECRET", "pclick-admin-dev")


# ── Auth dependency ───────────────────────────────────────────────────────────
# Accepts either:
#   • the static ADMIN_SECRET dev token   (fast, no network call)
#   • a valid Firebase ID token whose email is in ADMIN_EMAILS allowlist

async def _auth(x_admin_token: Optional[str] = Header(None)):
    from app.core.config import settings as _settings

    if not x_admin_token:
        raise HTTPException(status_code=401, detail="Unauthorized")

    # Static dev token — always accept (no email check needed)
    if x_admin_token == ADMIN_TOKEN:
        return

    # Firebase ID token path
    try:
        payload = await verify_firebase_id_token(x_admin_token)
    except HTTPException:
        raise HTTPException(status_code=401, detail="Unauthorized")

    # If ADMIN_EMAILS is configured, enforce the allowlist
    allowed = _settings.admin_email_set
    if allowed:
        email = (payload.get("email") or "").lower()
        if email not in allowed:
            raise HTTPException(status_code=403, detail="Forbidden: not an admin")


# ── Applications ("Xét duyệt người dùng") — registration is closed; every
# new account starts as a waitlist application an admin must accept/decline.
# Priority applications (valid referral code) sort to the top.

@router.get("/applications")
def applications_list(status: Optional[str] = None, _: None = Depends(_auth)):
    from app.services import applications as applications_svc
    return {"applications": applications_svc.list_applications(status)}


@router.post("/applications/{app_id}/accept")
def applications_accept(app_id: str, _: None = Depends(_auth)):
    from app.services import applications as applications_svc
    result = applications_svc.decide(app_id, accept=True)
    if not result.get("ok"):
        raise HTTPException(status_code=404, detail=result.get("error"))
    return result


@router.post("/applications/{app_id}/decline")
def applications_decline(app_id: str, _: None = Depends(_auth)):
    from app.services import applications as applications_svc
    result = applications_svc.decide(app_id, accept=False)
    if not result.get("ok"):
        raise HTTPException(status_code=404, detail=result.get("error"))
    return result


@router.post("/applications/{app_id}/finalize")
def applications_finalize(app_id: str, _: None = Depends(_auth)):
    """After the onboarding meeting: promote 'meeting' → 'accepted' (unlocks sign-up)."""
    from app.services import applications as applications_svc
    result = applications_svc.finalize_meeting(app_id)
    if not result.get("ok"):
        raise HTTPException(status_code=404, detail=result.get("error"))
    return result


@router.post("/applications/{app_id}/restore")
def applications_restore(app_id: str, _: None = Depends(_auth)):
    """Pull a declined application back out of the trash into the queue."""
    from app.services import applications as applications_svc
    result = applications_svc.restore(app_id)
    if not result.get("ok"):
        raise HTTPException(status_code=404, detail=result.get("error"))
    return result


@router.get("/applications/trash")
def applications_trash(_: None = Depends(_auth)):
    """Declined applications still inside the 7-day window (auto-purges expired)."""
    from app.services import applications as applications_svc
    return {"applications": applications_svc.list_trash()}


# ── Workspace access codes — manual override for the accepted-application
# sign-up gate, in case the normal admin-review pipeline doesn't fire for
# someone (backend: app/services/access_codes.py).

class AccessCodeIn(BaseModel):
    email: str = ""
    note: str = ""


@router.get("/access-codes")
def access_codes_list(_: None = Depends(_auth)):
    from app.services import access_codes as access_codes_svc
    return {"codes": access_codes_svc.list_codes()}


@router.post("/access-codes")
def access_codes_generate(body: AccessCodeIn, _: None = Depends(_auth)):
    from app.services import access_codes as access_codes_svc
    return access_codes_svc.generate(body.email, body.note)


@router.delete("/access-codes/{code}")
def access_codes_revoke(code: str, _: None = Depends(_auth)):
    from app.services import access_codes as access_codes_svc
    result = access_codes_svc.revoke(code)
    if not result.get("ok"):
        raise HTTPException(status_code=404, detail=result.get("error"))
    return result


# ── Per-user Second Brain — the admin builds a personalized brain WITH Opus
# for each accepted student, then curates their tools. Everything scoped to
# one workspace (backend: app/services/user_brain.py).

class BrainChatIn(BaseModel):
    user_key: str
    message: str


class BrainNoteIn(BaseModel):
    user_key: str
    title: str
    content: str
    subject: str = ""


class ToolsIn(BaseModel):
    user_key: str
    tools: list[str] = []


@router.get("/brain/users")
def brain_users(_: None = Depends(_auth)):
    from app.services import user_brain
    return {"users": user_brain.list_brain_users()}


@router.get("/brain/{user_key}")
def brain_detail(user_key: str, _: None = Depends(_auth)):
    from app.services import user_brain
    return {
        "notes": user_brain.list_notes(user_key),
        "chat": user_brain.chat_history(user_key),
        "tools": user_brain.get_tools(user_key)["tools"],
        "prefs": user_brain.get_prefs(user_key),
    }


@router.post("/brain/chat")
async def brain_chat(body: BrainChatIn, _: None = Depends(_auth)):
    """One admin turn in the Opus brain-building chat (auto-saved)."""
    from app.services import user_brain
    result = await user_brain.opus_brain_chat(body.user_key, body.message)
    if not result.get("ok"):
        raise HTTPException(status_code=503, detail=result.get("error"))
    return result


@router.post("/brain/notes")
def brain_add_note(body: BrainNoteIn, _: None = Depends(_auth)):
    from app.services import user_brain
    return user_brain.add_note(body.user_key, body.title, body.content, body.subject, source="admin")


@router.delete("/brain/notes/{note_id}")
def brain_delete_note(note_id: str, _: None = Depends(_auth)):
    from app.services import user_brain
    if not user_brain.delete_note(note_id):
        raise HTTPException(status_code=404, detail="not_found")
    return {"ok": True}


@router.put("/brain/tools")
def brain_set_tools(body: ToolsIn, _: None = Depends(_auth)):
    from app.services import user_brain
    return user_brain.set_tools(body.user_key, body.tools)


# ── Customers — the accepted-application roster, each opening into a big
# workspace + profile-info form (likes/dislikes, required subjects, major,
# teaching-method preferences, device, ADHD/focus note).

class ProfileIn(BaseModel):
    user_key: str
    liked_subjects: list[str] = []
    disliked_subjects: list[str] = []
    required_subjects: list[str] = []
    major: str = ""
    agrees_top_down: bool = False
    advance_to_basic: bool = False
    device: str = ""
    has_adhd: bool = False


@router.get("/customers")
def customers_list(_: None = Depends(_auth)):
    """Accepted applications — the actual customer roster, one card per student."""
    from app.services import applications as applications_svc
    return {"customers": applications_svc.list_applications("accepted")}


@router.get("/profile/{user_key}")
def profile_get(user_key: str, _: None = Depends(_auth)):
    from app.services import user_brain
    return user_brain.get_profile(user_key)


@router.put("/profile")
def profile_set(body: ProfileIn, _: None = Depends(_auth)):
    from app.services import user_brain
    fields = body.model_dump()
    user_key = fields.pop("user_key")
    return user_brain.set_profile(user_key, **fields)


# ── Orders — submissions from the personal Second Brain page
# (thelyceum.site/secondbrain): documents + a study schedule (self-built or
# AI-suggested), submitted for the team to turn into a personalized plan.

@router.get("/orders")
def orders_list(status: Optional[str] = None, _: None = Depends(_auth)):
    from app.services import orders as orders_svc
    return {"orders": orders_svc.list_orders(status)}


@router.post("/orders/{order_id}/accept")
def orders_accept(order_id: str, _: None = Depends(_auth)):
    from app.services import orders as orders_svc
    result = orders_svc.decide(order_id, accept=True)
    if not result.get("ok"):
        raise HTTPException(status_code=404, detail=result.get("error"))
    return result


@router.post("/orders/{order_id}/decline")
def orders_decline(order_id: str, _: None = Depends(_auth)):
    from app.services import orders as orders_svc
    result = orders_svc.decide(order_id, accept=False)
    if not result.get("ok"):
        raise HTTPException(status_code=404, detail=result.get("error"))
    return result


# ── RAG — document management ─────────────────────────────────────────────────

@router.get("/rag/documents")
def rag_list(_: None = Depends(_auth)):
    """List all indexed documents."""
    return rag_svc.list_documents()


@router.post("/rag/upload")
async def rag_upload(
    file:    UploadFile = File(...),
    title:   str        = Form(...),
    subject: str        = Form(""),
    _: None = Depends(_auth),
):
    """Upload a document (PDF / TXT / MD), chunk it, and index it."""
    content = await check_upload(file, max_bytes=40 * 1024 * 1024)
    fname   = file.filename or "upload"
    ext     = fname.rsplit(".", 1)[-1].lower() if "." in fname else "txt"

    if ext == "pdf":
        text = _pdf_text(content)
    elif ext in ("txt", "md"):
        text = content.decode("utf-8", errors="ignore")
    elif ext in ("png", "jpg", "jpeg", "webp"):
        text = _image_text(content, title)
    else:
        raise HTTPException(400, f"Unsupported file type '{ext}' — use PDF, TXT, MD, or PNG")

    doc_id = f"{fname}_{abs(hash(content))}"
    meta   = {"title": title, "subject": subject, "file_type": ext, "filename": fname}
    try:
        n = rag_svc.add_document(doc_id, text, meta)
    except RuntimeError as exc:
        # Embedding model not available (torch not installed)
        raise HTTPException(503, f"Embedding model not ready: {exc}")

    return {"doc_id": doc_id, "chunks": n, "title": title, "subject": subject}


@router.delete("/rag/documents/{doc_id:path}")
def rag_delete(doc_id: str, _: None = Depends(_auth)):
    """Delete all chunks for a document by its doc_id."""
    n = rag_svc.delete_document(doc_id)
    return {"deleted_chunks": n}


@router.post("/rag/search")
def rag_search(
    query:   str = "",
    n:       int = 5,
    subject: str = "",
    _: None = Depends(_auth),
):
    """Test semantic search against the indexed knowledge base."""
    return rag_svc.search(query, n=n, subject=subject or None)


# ── Second Brain — shared curriculum vault ─────────────────────────────────────

@router.post("/second-brain/ingest")
def second_brain_ingest(_: None = Depends(_auth)):
    """Re-parse the vault, re-index it into RAG, and rebuild the graph tables."""
    return second_brain_svc.ingest_vault()


@router.get("/second-brain/graph")
def second_brain_graph(_: None = Depends(_auth)):
    """Nodes + edges for the admin Second Brain graph view."""
    return second_brain_svc.list_graph()


@router.get("/second-brain/notes/{note_id}")
def second_brain_note(note_id: str, _: None = Depends(_auth)):
    """One note's full parsed content for the graph's detail panel."""
    note = second_brain_svc.get_note(note_id)
    if not note:
        raise HTTPException(404, "Note not found")
    return note


# ── Fine-tuning — examples CRUD ───────────────────────────────────────────────

class ExampleIn(BaseModel):
    user_message:    str
    assistant_reply: str
    system_prompt:   str       = ""
    subject:         str       = ""
    tags:            list[str] = []


@router.get("/finetune/stats")
def ft_stats(_: None = Depends(_auth)):
    return ft_svc.stats()


@router.get("/finetune/examples")
def ft_list(subject: Optional[str] = None, _: None = Depends(_auth)):
    return ft_svc.list_all(subject)


@router.post("/finetune/examples", status_code=201)
def ft_create(body: ExampleIn, _: None = Depends(_auth)):
    return ft_svc.create(**body.model_dump())


@router.put("/finetune/examples/{ex_id}")
def ft_update(ex_id: int, body: ExampleIn, _: None = Depends(_auth)):
    result = ft_svc.update(ex_id, **body.model_dump())
    if result is None:
        raise HTTPException(404, "Example not found")
    return result


@router.delete("/finetune/examples/{ex_id}")
def ft_delete(ex_id: int, _: None = Depends(_auth)):
    if not ft_svc.delete(ex_id):
        raise HTTPException(404, "Example not found")
    return {"ok": True}


# ── AI activity log — every provider call the backend makes, with the task/
# role that triggered it. Populated automatically from ai.py's _record_usage.

@router.get("/activity/log")
def activity_log(
    limit: int = 100, offset: int = 0, provider: str = "", task: str = "",
    _: None = Depends(_auth),
):
    return {"items": activity_svc.list_recent(limit=limit, offset=offset, provider=provider, task=task)}


@router.get("/activity/summary")
def activity_summary(_: None = Depends(_auth)):
    return activity_svc.summary()


@router.get("/activity/roles")
def activity_roles(_: None = Depends(_auth)):
    """Reference list of every known task -> friendly role label, for the admin UI filter dropdown."""
    return {"roles": activity_svc.ROLE_LABELS}


@router.get("/activity/model-totals")
def activity_model_totals(_: None = Depends(_auth)):
    """True all-time token usage per model, across every user this backend
    has ever served (never pruned — see /activity/summary for recent-only)."""
    return {"models": activity_svc.model_totals()}


@router.get("/finetune/export.jsonl", response_class=PlainTextResponse)
def ft_export(_: None = Depends(_auth)):
    """Download all examples as OpenAI-format JSONL for fine-tuning."""
    return ft_svc.export_jsonl()


# ── User Feedback — anonymous star rating + comment, collected in-app ──────

@router.get("/feedback")
def feedback_list(limit: int = 200, offset: int = 0, _: None = Depends(_auth)):
    return {"items": feedback_svc.list_recent(limit=limit, offset=offset)}


@router.get("/feedback/summary")
def feedback_summary(_: None = Depends(_auth)):
    return feedback_svc.summary()


@router.get("/feedback/insights")
async def feedback_insights(_: None = Depends(_auth)):
    """
    AI-generated theme breakdown of the free-text feedback comments
    (NVIDIA Gemma) — powers the admin Feedback dashboard's chart.
    """
    items = feedback_svc.recent_for_analysis()
    return await ai_svc.analyze_feedback_themes(items)


# ── Per-model Role & Characteristic — the Training AI board's system-prompt/
# persona field, persisted here so it survives across browsers/devices and
# so export_jsonl_filtered() can fall back to it during a training push.

class RoleIn(BaseModel):
    role: str = ""


@router.get("/models/roles")
def list_model_roles(_: None = Depends(_auth)):
    return {"roles": ft_svc.list_roles()}


@router.put("/models/{model_id}/role")
def set_model_role(model_id: str, body: RoleIn, _: None = Depends(_auth)):
    return ft_svc.set_role(model_id, body.role)


# ── Personalization profiles — the shared per-user, per-concept store every
# AI feature reads (see app/services/mastery_profile.py). Admin-only, read-only.

def _resolve_identities(db: Session, user_ids: list[str]) -> dict[str, dict]:
    """Best-effort Firebase UID -> {email, full_name} lookup against the
    Postgres `users` table. Many personalization user_ids will have no match
    here — mastery_profile is written from require_auth (JWT-only, no DB
    row), while `users` rows are only provisioned by get_current_user
    (subscriptions flow). Missing identities just fall back to the raw UID
    in the admin UI rather than failing the whole request."""
    if not user_ids:
        return {}
    try:
        rows = (
            db.query(UserProfile)
            .filter(UserProfile.auth_provider == AuthProviderEnum.firebase, UserProfile.auth_subject.in_(user_ids))
            .all()
        )
        return {r.auth_subject: {"email": r.email, "full_name": r.full_name} for r in rows}
    except Exception:
        return {}


@router.get("/profiles")
def list_profiles(db: Session = Depends(get_db), _: None = Depends(_auth)):
    """All users with a personalization profile, for the admin board list."""
    user_ids = profile_svc.get_all_user_ids()
    identities = _resolve_identities(db, user_ids)
    items = []
    for uid in user_ids:
        identity = identities.get(uid, {})
        items.append({
            "user_id": uid,
            "email": identity.get("email"),
            "full_name": identity.get("full_name"),
            **profile_svc.get_user_activity_summary(uid),
        })
    items.sort(key=lambda r: r["last_active"] or "", reverse=True)
    return {"items": items}


@router.get("/profiles/{user_id}")
def get_profile(user_id: str, db: Session = Depends(get_db), _: None = Depends(_auth)):
    """Full personalization profile for one user — every measured bar plus
    the AI teaching-style mix derived from them, for the admin detail panel."""
    identity = _resolve_identities(db, [user_id]).get(user_id, {})
    return {
        "user_id": user_id,
        "email": identity.get("email"),
        "full_name": identity.get("full_name"),
        **profile_svc.get_full_profile(user_id),
    }


# ── Plan feature tokens — admin-editable token allotment per plan, per
# feature (migration 008: note=500, chat=2000, etc.) ────────────────────────
# Data model only — NOT wired to a real Stripe payment yet —
# user_subscriptions/users don't exist in production, so there's nothing
# to auto-grant onto. This just lets the admin view/set the per-plan,
# per-feature numbers ahead of that follow-up.

@router.get("/plans")
def list_plans(db: Session = Depends(get_db), _: None = Depends(_auth)):
    rows = db.execute(select(SubscriptionPlan)).scalars().all()
    return {
        "plans": [
            {"id": str(p.id), "tier": p.tier.value, "billing_cycle": p.billing_cycle.value}
            for p in rows
        ]
    }


@router.get("/plans/{plan_id}/tokens")
def list_plan_tokens(plan_id: str, db: Session = Depends(get_db), _: None = Depends(_auth)):
    rows = db.execute(
        select(PlanFeatureToken).where(PlanFeatureToken.plan_id == plan_id)
    ).scalars().all()
    return {
        "tokens": [
            {"feature_name": r.feature_name, "tokens_monthly": r.tokens_monthly}
            for r in rows
        ]
    }


class PlanFeatureTokenIn(BaseModel):
    tokens_monthly: int


@router.put("/plans/{plan_id}/tokens/{feature_name}")
def set_plan_feature_token(
    plan_id: str, feature_name: str, body: PlanFeatureTokenIn,
    db: Session = Depends(get_db), _: None = Depends(_auth),
):
    plan = db.get(SubscriptionPlan, plan_id)
    if not plan:
        raise HTTPException(404, "Plan not found")
    row = db.execute(
        select(PlanFeatureToken)
        .where(PlanFeatureToken.plan_id == plan_id, PlanFeatureToken.feature_name == feature_name)
    ).scalar_one_or_none()
    if row:
        row.tokens_monthly = body.tokens_monthly
    else:
        row = PlanFeatureToken(plan_id=plan_id, feature_name=feature_name, tokens_monthly=body.tokens_monthly)
        db.add(row)
    db.commit()
    return {"ok": True, "feature_name": feature_name, "tokens_monthly": body.tokens_monthly}


@router.delete("/plans/{plan_id}/tokens/{feature_name}")
def delete_plan_feature_token(
    plan_id: str, feature_name: str,
    db: Session = Depends(get_db), _: None = Depends(_auth),
):
    row = db.execute(
        select(PlanFeatureToken)
        .where(PlanFeatureToken.plan_id == plan_id, PlanFeatureToken.feature_name == feature_name)
    ).scalar_one_or_none()
    if not row:
        raise HTTPException(404, "Feature token not found")
    db.delete(row)
    db.commit()
    return {"ok": True}


# ── Fine-tuning — OpenAI job pipeline ────────────────────────────────────────

class SubmitJobIn(BaseModel):
    model_id:   str                            # used as subject prefix: train__{model_id}__
    base_model: str  = "gpt-4o-mini-2024-07-18"
    suffix:     str  = "pclick"


@router.post("/finetune/submit-job")
def ft_submit_job(body: SubmitJobIn, _: None = Depends(_auth)):
    """
    Gather all few-shot examples for model_id, upload to OpenAI,
    and kick off a fine-tuning job.  Returns the OpenAI job object.
    """
    subject_prefix = f"train__{body.model_id}__"
    jsonl = ft_svc.export_jsonl_filtered(subject_prefix, model_id=body.model_id)
    if not jsonl.strip():
        raise HTTPException(400, "No training examples found for this model — add some first.")
    try:
        return ft_openai.submit_job(jsonl, body.base_model, body.suffix)
    except RuntimeError as exc:
        raise HTTPException(503, str(exc))
    except Exception as exc:
        raise HTTPException(500, f"OpenAI API error: {exc}")


@router.get("/finetune/jobs")
def ft_list_jobs(_: None = Depends(_auth)):
    """List the 20 most recent OpenAI fine-tuning jobs."""
    try:
        return ft_openai.list_jobs()
    except RuntimeError as exc:
        raise HTTPException(503, str(exc))
    except Exception as exc:
        raise HTTPException(500, f"OpenAI API error: {exc}")


@router.get("/finetune/jobs/{job_id}")
def ft_get_job(job_id: str, _: None = Depends(_auth)):
    """Get current status of a fine-tuning job."""
    try:
        return ft_openai.get_job(job_id)
    except RuntimeError as exc:
        raise HTTPException(503, str(exc))
    except Exception as exc:
        raise HTTPException(500, f"OpenAI API error: {exc}")


@router.delete("/finetune/jobs/{job_id}")
def ft_cancel_job(job_id: str, _: None = Depends(_auth)):
    """Cancel a queued or running fine-tuning job."""
    try:
        return ft_openai.cancel_job(job_id)
    except RuntimeError as exc:
        raise HTTPException(503, str(exc))
    except Exception as exc:
        raise HTTPException(500, f"OpenAI API error: {exc}")


# ── Helpers ───────────────────────────────────────────────────────────────────

def _pdf_text(data: bytes) -> str:
    try:
        import PyPDF2
        reader = PyPDF2.PdfReader(io.BytesIO(data))
        return "\n".join(p.extract_text() or "" for p in reader.pages)
    except Exception as exc:
        raise HTTPException(500, f"PDF parse error: {exc}")


def _image_text(data: bytes, title: str = "") -> str:
    """Extract text from an image via OCR (pytesseract).
    Falls back to a descriptive placeholder if Tesseract is not installed."""
    try:
        from PIL import Image
        import pytesseract
        img  = Image.open(io.BytesIO(data)).convert("RGB")
        text = pytesseract.image_to_string(img, lang="vie+eng").strip()
        if text:
            return f"[Schema diagram: {title}]\n\n{text}"
    except Exception:
        pass
    # Tesseract not available — store title + label so it can still be found by search
    return (
        f"[Schema diagram: {title}]\n\n"
        "This document is a visual schema diagram (PNG image). "
        "Install Tesseract (brew install tesseract tesseract-lang) "
        "and re-upload to enable full OCR text extraction."
    )
