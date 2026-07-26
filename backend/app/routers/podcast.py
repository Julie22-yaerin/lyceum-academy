"""
Podcast script generation + self-serve AI Research — the two pieces the
Floating Podcast and the per-subject material-source chooser need.

  GET  /ai/podcast/material?subject=      — how much of the student's own
                                             material exists for this subject
                                             (so the client can offer "no
                                             notes yet — upload or research
                                             first" instead of a blank script)
  POST /ai/podcast/script                 — material -> produced audio
                                             script (Elite Audio Producer),
                                             NOT narration — POST /ai/tts
                                             still does that step
  POST /me/brain/research                 — AI Research: given a subject +
                                             topic, synthesize study material
                                             and save it into the student's
                                             own Second Brain (source
                                             "ai-research"). Costs Quanta —
                                             deliberately more than a single
                                             manual note add, since it is a
                                             full synthesis pass.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel

from app.api.deps import require_auth
from app.core.limiter import limiter
from app.services import quanta as quanta_svc

router = APIRouter(tags=["podcast"])


def _uid(auth: dict) -> str:
    return auth.get("user_id") or auth.get("sub") or ""


@router.get("/ai/podcast/material")
async def podcast_material_status(subject: str = "", auth: dict = Depends(require_auth)):
    from app.services import user_brain

    uid = _uid(auth)
    keys = [uid]
    if auth.get("email"):
        keys.append(auth["email"])
    notes = user_brain.list_notes(keys)
    if subject:
        notes = [n for n in notes if n.get("subject") == subject]
    chars = sum(len(n.get("content", "")) for n in notes)
    return {"note_count": len(notes), "char_count": chars, "has_material": chars > 200}


class PodcastScriptRequest(BaseModel):
    subject: str
    format: str = "1"  # "1" Storyteller | "2" Explorers | "3" Gladiators
    topic: str = ""


@router.post("/ai/podcast/script")
@limiter.limit("8/minute")
async def podcast_script(request: Request, req: PodcastScriptRequest, auth: dict = Depends(require_auth)):
    from app.services import podcast_script as podcast_svc
    from app.services import user_brain

    uid = _uid(auth)
    keys = [uid]
    if auth.get("email"):
        keys.append(auth["email"])
    notes = user_brain.list_notes(keys)
    if req.subject:
        notes = [n for n in notes if n.get("subject") == req.subject]
    material = "\n\n".join(f"## {n['title']}\n{n['content']}" for n in notes)[:8000]

    if not material.strip() and not req.topic.strip():
        raise HTTPException(
            status_code=422,
            detail="no_material — chưa có tài liệu cho môn này. Upload tài liệu, tạo Second Brain, "
                   "hoặc dùng AI Research trước khi tạo podcast.",
        )

    try:
        script = await podcast_svc.generate_script(
            material or f"(không có ghi chú lưu sẵn — chỉ có chủ đề do học sinh nhập: {req.topic})",
            subject=req.subject, format_choice=req.format, topic=req.topic,
        )
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"podcast_script_failed: {e}")

    quanta_svc.spend_tokens(uid, tokens=350, pool="standard", context="/ai/podcast/script")
    return {"script": script, "format": req.format, "source_note_count": len(notes)}


class ResearchSubjectRequest(BaseModel):
    subject: str
    topic: str


@router.post("/me/brain/research")
@limiter.limit("4/minute")
async def ai_research_subject(request: Request, req: ResearchSubjectRequest, auth: dict = Depends(require_auth)):
    from app.services import user_brain, rag as rag_svc
    from app.services.ai_roles.providers import route_chat

    uid = _uid(auth)
    topic = req.topic.strip()
    if not topic:
        raise HTTPException(status_code=400, detail="topic_required")

    try:
        vault_context = rag_svc.context_for(f"{req.subject} {topic}".strip())
    except Exception:
        vault_context = ""

    system = (
        "You are the Lyceum's AI Research role. Given a subject and a topic, produce a thorough, "
        "well-organized study document a student could use as their entire reference material for "
        "that topic — not a summary, a genuine build-out: definitions, the key equations/mechanisms, "
        "worked reasoning, common misconceptions, and how it connects to adjacent topics in the "
        "subject. Ground it in the provided vault context where relevant, plus standard curriculum "
        "knowledge for the subject and level implied by the topic. Markdown formatting. 700-1200 words."
    )
    user = (
        f"Subject: {req.subject or 'general'}\nTopic: {topic}\n\n"
        f"Existing vault context (may be empty):\n{vault_context or '(none)'}"
    )

    try:
        resp, text = await route_chat(
            [{"role": "user", "content": user}],
            provider="anthropic", model="claude-3-5-sonnet-20241022",
            system=system, temperature=0.4, max_tokens=3200,
        )
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"research_failed: {e}")

    result = user_brain.add_note(uid, title=topic, content=text, subject=req.subject, source="ai-research")

    # A full research pass is deliberately costed above a manual note add
    # (/me/brain/add spends 120) — it's a synthesis run, not a paste-and-clean.
    usage = (resp or {}).get("usage") or {}
    tokens = max(int(usage.get("total_tokens") or 0), 900)
    quanta_svc.spend_tokens(uid, tokens=tokens, pool="standard", context="/me/brain/research")

    return {**result, "title": topic, "content": text}
