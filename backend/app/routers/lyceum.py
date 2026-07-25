"""
Lyceum ship-day router — the new product surface added for launch:

  Plans (Quanta-denominated catalog, no USD pricing)
    GET  /plans/catalog          — plan list + tokens↔quanta conversion
    GET  /plans/current          — the caller's selected plan
    POST /plans/select           — pick a plan (personal or team) + cycle

  Quanta wallet (replaces the old per-feature usage panel)
    GET  /quanta/balance         — allowance / spent / remaining, both pools
    POST /quanta/extra-credits   — top up any amount of Quanta

  Referrals (1 invited friend = 5 Quanta)
    GET  /referral/me            — my share code + stats
    POST /referral/redeem        — invited user submits a code once

  Teams (group plan: 3 seats, shared workspace, chat room)
    GET  /teams/me               — my team, members, pending invites
    POST /teams/create           — start a team (becomes team plan)
    POST /teams/invite           — owner invites by email
    POST /teams/accept-invite    — claim a pending invite for my email
    POST /teams/leave
    GET  /teams/chat             — poll messages (?after_id=)
    POST /teams/chat             — post a message

  Authored documents (private / team / public)
    GET/POST/DELETE /documents…

  Second Brain customization (the only remaining external-document door)
    POST /second-brain/custom    — add material into the vault + index
    GET  /second-brain/custom    — list custom material

  Coach lesson package (the standard content unit for one topic)
    POST /ai/generate-lesson     — note+images+refs, 2 card sets (≤15 each),
                                    1-2 break games — see app.services.lesson

  Xiaohei Illustrations (Tool Dock 'illustrations')
    POST /ai/illustrations       — shot list + generated 16:9 hand-drawn
                                    illustrations for a text — see
                                    app.services.illustration

  Share Screen with AI (Tool Dock 'screen-share')
    POST /ai/screen-share        — Socrat comments on a cropped screen
                                    region — see app.services.ai.analyze_screen_share

  Exercise Cards (Tool Dock 'exercise-cards') — see app.services.exercise_cards
    POST /ai/exercise-cards/generate                — build a deck from a
                                    chopped past paper / textbook excerpt,
                                    pre-sorted medium → hard → easy
    POST /ai/exercise-cards/reverse-build/reveal     — 20 Quanta
    POST /ai/exercise-cards/reverse-build/evaluate   — free (paired with reveal)
    POST /ai/exercise-cards/problem-image            — 150 Quanta

  Text-to-speech (Floating Podcast narration — see app.services.cloudflare_ai)
    GET  /ai/tts/status          — is server-side narration configured?
    POST /ai/tts                 — script -> MP3 (free; falls back client-side
                                    to browser speechSynthesis when absent)

  Applications (registration is closed — "Get Started" applies to a waitlist)
    POST /applications/apply     — public, no auth: submit the onboarding
                                    quest (placement answers + learning-style
                                    vector + optional referral code)
    GET  /applications/status    — public, no auth: check status by email
    (admin review — list/accept/decline — lives in app.routers.admin)

  Library (thelyceum.site/library — public blog/research-paper sharing)
    GET  /library/posts              — list posts (public)
    GET  /library/posts/{id}         — post + comments + reaction counts (public)
    POST /library/posts              — publish (auth)
    POST /library/posts/{id}/comments — comment (auth)
    POST /library/posts/{id}/react    — toggle an emoji reaction (auth)

  Personal Second Brain (thelyceum.site/secondbrain — accepted accounts)
    POST /ai/generate-schedule   — AI-suggested weekly study schedule
    POST /orders                — submit documents + schedule as an order
    GET  /orders/mine           — my own submitted orders + status
    (admin review — list/accept/decline — lives in app.routers.admin)
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel

from app.api.deps import require_auth
from app.core.limiter import limiter
from app.services import plans as plans_svc
from app.services import quanta as quanta_svc
from app.services import teams as teams_svc

router = APIRouter(tags=["lyceum"])


def _uid(auth: dict) -> str:
    uid = auth.get("user_id") or auth.get("sub") or ""
    if not uid:
        raise HTTPException(status_code=401, detail="Unauthorized")
    return uid


# ── Applications (registration is closed — this is the waitlist gate) ──────
# Public endpoints — an applicant has no Firebase account yet at this point.


class ApplyRequest(BaseModel):
    email: str
    name: str = ""
    answers: dict = {}
    vector: dict = {}
    referral_code: str = ""


@router.post("/applications/apply")
@limiter.limit("5/minute")
async def applications_apply(request: Request, req: ApplyRequest):
    from app.services import applications as applications_svc
    result = applications_svc.submit_application(
        req.email, req.name, req.answers, req.vector, req.referral_code,
    )
    if not result.get("ok"):
        raise HTTPException(status_code=400, detail=result.get("error", "invalid_application"))
    return result


@router.get("/applications/status")
@limiter.limit("20/minute")
async def applications_status(request: Request, email: str):
    from app.services import applications as applications_svc
    return applications_svc.get_status(email)


class RedeemAccessCodeRequest(BaseModel):
    code: str
    email: str


@router.post("/access-codes/redeem")
@limiter.limit("8/minute")
async def redeem_access_code(request: Request, req: RedeemAccessCodeRequest):
    """Manual override for the accepted-application sign-up gate — an admin-
    generated one-time code that marks this email 'accepted' directly, for
    cases where the normal review pipeline hasn't run. Public: the applicant
    may have no Firebase account yet."""
    from app.services import access_codes as access_codes_svc
    result = access_codes_svc.redeem(req.code, req.email)
    if not result.get("ok"):
        raise HTTPException(status_code=400, detail=result.get("error", "redeem_failed"))
    return result


# ── Library (thelyceum.site/library) ────────────────────────────────────────
# Public blog/research-paper sharing. Reading is open to everyone; comments,
# reactions, and publishing require an account (registration is vetted, so
# every account is already a known, accepted person).


class LibraryPostRequest(BaseModel):
    title: str
    body: str = ""
    type: str = "blog"  # 'blog' | 'paper'
    paper_url: str = ""
    image_data_url: str = ""  # optional "data:image/png;base64,..." inline illustration


class LibraryCommentRequest(BaseModel):
    content: str


class LibraryReactRequest(BaseModel):
    emoji: str


def _display_name(auth: dict) -> str:
    return auth.get("name") or auth.get("email") or "A Lyceum student"


@router.get("/library/posts")
async def library_list_posts(limit: int = 30, offset: int = 0):
    from app.services import library as library_svc
    return {"posts": library_svc.list_posts(limit=min(limit, 100), offset=max(offset, 0))}


@router.get("/library/posts/{post_id}")
async def library_get_post(post_id: str):
    from app.services import library as library_svc
    post = library_svc.get_post(post_id)
    if not post:
        raise HTTPException(status_code=404, detail="not_found")
    return post


@router.post("/library/posts")
@limiter.limit("10/minute")
async def library_create_post(request: Request, req: LibraryPostRequest, auth: dict = Depends(require_auth)):
    from app.services import library as library_svc
    result = library_svc.create_post(
        _uid(auth), _display_name(auth), req.title, req.body, req.type, req.paper_url, req.image_data_url,
    )
    if not result.get("ok"):
        raise HTTPException(status_code=400, detail=result.get("error"))
    return result


@router.post("/library/posts/{post_id}/comments")
@limiter.limit("20/minute")
async def library_add_comment(request: Request, post_id: str, req: LibraryCommentRequest, auth: dict = Depends(require_auth)):
    from app.services import library as library_svc
    result = library_svc.add_comment(post_id, _uid(auth), _display_name(auth), req.content)
    if not result.get("ok"):
        raise HTTPException(status_code=400 if result.get("error") != "not_found" else 404, detail=result.get("error"))
    return result


@router.post("/library/posts/{post_id}/react")
@limiter.limit("30/minute")
async def library_react(request: Request, post_id: str, req: LibraryReactRequest, auth: dict = Depends(require_auth)):
    from app.services import library as library_svc
    result = library_svc.toggle_reaction(post_id, _uid(auth), req.emoji)
    if not result.get("ok"):
        raise HTTPException(status_code=400, detail=result.get("error"))
    return result


# ── Personal Second Brain (thelyceum.site/secondbrain) + Orders ─────────────
# Accepted accounts add their own documents (reuses the authored-documents
# system in teams.py) and a weekly study schedule — self-built or
# AI-suggested — then submit both together as an "order" the Lyceum team
# turns into a personalized plan (admin queue: app.routers.admin).


class GenerateScheduleRequest(BaseModel):
    weekly_hours: int = 10
    subject_keys: list[str] = []
    document_titles: list[str] = []


@router.post("/ai/generate-schedule")
@limiter.limit("6/minute")
async def generate_schedule(request: Request, req: GenerateScheduleRequest, auth: dict = Depends(require_auth)):
    import json as _json

    from app.services import ai as ai_svc

    uid = _uid(auth)
    subjects = req.subject_keys or ["general"]
    system = (
        "You are a study-schedule planner. Given a weekly study-hour budget, a list of subjects, and the "
        "titles of the student's own documents, propose a realistic weekly schedule. Respond with ONLY a "
        "JSON array, no markdown fences: [{\"day_of_week\": 0-6 (0=Monday), \"start_minute\": <int, minutes "
        "since midnight>, \"duration_minutes\": <int>, \"subject_key\": \"<one of the given subjects>\"}]. "
        "Spread sessions across different days, keep each block 45-90 minutes, and don't exceed the weekly "
        "hour budget in total."
    )
    user = (
        f"Weekly hours available: {req.weekly_hours}\n"
        f"Subjects: {', '.join(subjects)}\n"
        f"Document titles: {', '.join(req.document_titles) or '(none yet)'}"
    )
    try:
        resp = await ai_svc.chat(
            [{"role": "system", "content": system}, {"role": "user", "content": user}],
            temperature=0.4, max_tokens=1500,
        )
        text = ai_svc.extract_text(resp)
    except Exception as e:
        raise HTTPException(status_code=502, detail=str(e))

    raw = text.strip()
    if raw.startswith("```"):
        raw = raw.strip("`")
    start, end = raw.find("["), raw.rfind("]")
    blocks = []
    if start != -1 and end > start:
        try:
            parsed = _json.loads(raw[start:end + 1])
            if isinstance(parsed, list):
                for i, b in enumerate(parsed):
                    if not isinstance(b, dict):
                        continue
                    blocks.append({
                        "id": f"ai-{i}",
                        "subjectKey": str(b.get("subject_key", subjects[0])),
                        "dayOfWeek": max(0, min(6, int(b.get("day_of_week", 0)))),
                        "startMinute": max(0, min(1439, int(b.get("start_minute", 540)))),
                        "durationMinutes": max(15, min(240, int(b.get("duration_minutes", 60)))),
                    })
        except Exception:
            blocks = []

    quanta_svc.spend_tokens(uid, tokens=800, pool="standard", context="/ai/generate-schedule")
    return {"blocks": blocks}


class SubmitOrderRequest(BaseModel):
    documents: list[dict] = []
    schedule: list[dict] = []
    ai_generated: bool = False
    note: str = ""


@router.post("/orders")
@limiter.limit("10/minute")
async def submit_order(request: Request, req: SubmitOrderRequest, auth: dict = Depends(require_auth)):
    from app.services import orders as orders_svc
    result = orders_svc.create_order(
        _uid(auth), auth.get("email", ""), req.documents, req.schedule, req.ai_generated, req.note,
    )
    if not result.get("ok"):
        raise HTTPException(status_code=400, detail=result.get("error"))
    return result


@router.get("/orders/mine")
async def my_orders(auth: dict = Depends(require_auth)):
    from app.services import orders as orders_svc
    return {"orders": orders_svc.list_my_orders(_uid(auth))}


# ── Unlimited test access (replaces the free-trial program) ─────────────────


class RedeemUnlimitedRequest(BaseModel):
    code: str


@router.post("/account/redeem-unlimited")
@limiter.limit("5/minute")
async def redeem_unlimited(request: Request, req: RedeemUnlimitedRequest, auth: dict = Depends(require_auth)):
    result = plans_svc.redeem_unlimited_code(_uid(auth), req.code)
    if not result.get("ok"):
        raise HTTPException(status_code=400, detail=result.get("error"))
    return result


# ── Personal Second Brain, tools & prefs (per-workspace) ───────────────────


@router.get("/me/tools")
async def my_tools(auth: dict = Depends(require_auth)):
    """Which Tool Dock tools this account may see. Admin+Opus curate these
    per user; uncurated accounts get the tier-1 default set."""
    from app.services import user_brain
    keys = [_uid(auth)]
    if auth.get("email"):
        keys.append(auth["email"])
    return user_brain.get_tools(keys)


@router.get("/me/prefs")
async def my_prefs(auth: dict = Depends(require_auth)):
    from app.services import user_brain
    keys = [_uid(auth)]
    if auth.get("email"):
        keys.append(auth["email"])
    return user_brain.get_prefs(keys)


class TrainingPrefRequest(BaseModel):
    allow_training: bool


@router.post("/me/prefs/training")
async def set_training_pref(req: TrainingPrefRequest, auth: dict = Depends(require_auth)):
    """Toggle whether this account's data may be used to train models."""
    from app.services import user_brain
    return user_brain.set_prefs(_uid(auth), req.allow_training)


class BrainDocRequest(BaseModel):
    title: str
    content: str
    subject: str = ""


@router.post("/me/brain/add")
@limiter.limit("6/minute")
async def add_to_my_brain(request: Request, req: BrainDocRequest, auth: dict = Depends(require_auth)):
    """Student adds material to their OWN Second Brain, with AI help to distill
    it — costs Quanta (Settings → Second Brain). The AI-cleaned note is stored
    private to this workspace and briefs the student's whole AI team."""
    from app.services import user_brain, second_brain
    uid = _uid(auth)
    if not req.content.strip():
        raise HTTPException(status_code=400, detail="empty_content")

    # AI distillation (dedicated Opus synthesizer). Falls back to raw material.
    title, body, subject = req.title, req.content, req.subject
    try:
        distilled = await second_brain.synthesize_note_with_opus(req.title, req.content, req.subject)
        if distilled:
            title = distilled.get("title") or title
            body = distilled.get("summary") or body
    except Exception:
        pass

    result = user_brain.add_note(uid, title, body, subject, source="student")
    # AI-assisted ingestion is a standard-pool spend.
    try:
        quanta_svc.spend_tokens(uid, tokens=120, pool="standard", context="brain_add")
    except Exception:
        pass
    return {**result, "title": title}


@router.get("/me/brain")
async def list_my_brain(auth: dict = Depends(require_auth)):
    from app.services import user_brain
    keys = [_uid(auth)]
    if auth.get("email"):
        keys.append(auth["email"])
    return {"notes": user_brain.list_notes(keys)}


# ── Plans ────────────────────────────────────────────────────────────────────


@router.get("/plans/catalog")
async def plans_catalog():
    return plans_svc.catalog()


@router.get("/plans/current")
async def plans_current(auth: dict = Depends(require_auth)):
    return plans_svc.current_plan(_uid(auth))


class SelectPlanRequest(BaseModel):
    plan_id: str
    cycle: str = "monthly"


@router.post("/plans/select")
@limiter.limit("10/minute")
async def plans_select(request: Request, req: SelectPlanRequest, auth: dict = Depends(require_auth)):
    return plans_svc.select_plan(_uid(auth), req.plan_id, req.cycle)


# ── Quanta wallet ────────────────────────────────────────────────────────────


@router.get("/quanta/balance")
async def quanta_balance(auth: dict = Depends(require_auth)):
    return quanta_svc.get_balance(_uid(auth))


class ExtraCreditsRequest(BaseModel):
    quanta: int


@router.post("/quanta/extra-credits")
@limiter.limit("10/minute")
async def quanta_extra_credits(request: Request, req: ExtraCreditsRequest, auth: dict = Depends(require_auth)):
    result = quanta_svc.purchase_extra_credits(_uid(auth), req.quanta)
    if not result.get("ok"):
        raise HTTPException(status_code=400, detail=result.get("error", "invalid_amount"))
    return {**result, "balance": quanta_svc.get_balance(_uid(auth))}


# ── Referrals ────────────────────────────────────────────────────────────────


@router.get("/referral/me")
async def referral_me(auth: dict = Depends(require_auth)):
    uid = _uid(auth)
    return {"code": quanta_svc.get_or_create_referral_code(uid), **quanta_svc.referral_stats(uid)}


class RedeemRequest(BaseModel):
    code: str


@router.post("/referral/redeem")
@limiter.limit("5/minute")
async def referral_redeem(request: Request, req: RedeemRequest, auth: dict = Depends(require_auth)):
    result = quanta_svc.redeem_referral(req.code, _uid(auth))
    if not result.get("ok"):
        raise HTTPException(status_code=400, detail=result.get("error", "invalid_code"))
    return result


# ── Teams ────────────────────────────────────────────────────────────────────


@router.get("/teams/me")
async def teams_me(auth: dict = Depends(require_auth)):
    return {"team": teams_svc.my_team(_uid(auth))}


class CreateTeamRequest(BaseModel):
    name: str
    email: str = ""


@router.post("/teams/create")
@limiter.limit("5/minute")
async def teams_create(request: Request, req: CreateTeamRequest, auth: dict = Depends(require_auth)):
    result = teams_svc.create_team(_uid(auth), req.name, req.email or auth.get("email", ""))
    if not result.get("ok"):
        raise HTTPException(status_code=400, detail=result.get("error"))
    return result


class InviteRequest(BaseModel):
    email: str


@router.post("/teams/invite")
@limiter.limit("10/minute")
async def teams_invite(request: Request, req: InviteRequest, auth: dict = Depends(require_auth)):
    result = teams_svc.invite_member(_uid(auth), req.email)
    if not result.get("ok"):
        raise HTTPException(status_code=400, detail=result.get("error"))
    return result


class AcceptInviteRequest(BaseModel):
    email: str = ""


@router.post("/teams/accept-invite")
@limiter.limit("10/minute")
async def teams_accept(request: Request, req: AcceptInviteRequest, auth: dict = Depends(require_auth)):
    email = req.email or auth.get("email", "")
    result = teams_svc.accept_invite(_uid(auth), email)
    if not result.get("ok"):
        raise HTTPException(status_code=400, detail=result.get("error"))
    return result


@router.post("/teams/leave")
@limiter.limit("5/minute")
async def teams_leave(request: Request, auth: dict = Depends(require_auth)):
    return teams_svc.leave_team(_uid(auth))


class ChatPostRequest(BaseModel):
    content: str
    author: str = ""


@router.get("/teams/chat")
async def teams_chat_list(after_id: int = 0, auth: dict = Depends(require_auth)):
    return teams_svc.list_messages(_uid(auth), after_id=after_id)


@router.post("/teams/chat")
@limiter.limit("60/minute")
async def teams_chat_post(request: Request, req: ChatPostRequest, auth: dict = Depends(require_auth)):
    result = teams_svc.post_message(_uid(auth), req.author or auth.get("email", ""), req.content)
    if not result.get("ok"):
        raise HTTPException(status_code=400, detail=result.get("error"))
    return result


# ── Authored documents ───────────────────────────────────────────────────────


class SaveDocumentRequest(BaseModel):
    title: str
    content: str = ""
    doc_id: str | None = None
    folder: str = ""
    visibility: str = "private"  # private | team | public


@router.get("/documents")
async def documents_list(auth: dict = Depends(require_auth)):
    return teams_svc.list_documents(_uid(auth))


@router.get("/documents/{doc_id}")
async def documents_get(doc_id: str, auth: dict = Depends(require_auth)):
    doc = teams_svc.get_document(_uid(auth), doc_id)
    if not doc:
        raise HTTPException(status_code=404, detail="not_found")
    return doc


@router.post("/documents")
@limiter.limit("60/minute")
async def documents_save(request: Request, req: SaveDocumentRequest, auth: dict = Depends(require_auth)):
    result = teams_svc.save_document(
        _uid(auth), req.title, req.content,
        doc_id=req.doc_id, folder=req.folder, visibility=req.visibility,
        share_with_team=req.visibility == "team",
    )
    if not result.get("ok"):
        raise HTTPException(status_code=400, detail=result.get("error"))
    return result


@router.delete("/documents/{doc_id}")
async def documents_delete(doc_id: str, auth: dict = Depends(require_auth)):
    result = teams_svc.delete_document(_uid(auth), doc_id)
    if not result.get("ok"):
        raise HTTPException(status_code=404, detail=result.get("error"))
    return result


# ── Second Brain customization ───────────────────────────────────────────────


class CustomNoteRequest(BaseModel):
    title: str
    content: str
    subject: str = ""


@router.post("/second-brain/custom")
@limiter.limit("10/minute")
async def second_brain_custom_add(request: Request, req: CustomNoteRequest, auth: dict = Depends(require_auth)):
    from app.services import second_brain as sb_svc
    if not (req.content or "").strip():
        raise HTTPException(status_code=400, detail="content_required")
    result = await sb_svc.add_custom_note(req.title, req.content, req.subject, uploader_uid=_uid(auth))
    if not result.get("ok"):
        raise HTTPException(status_code=500, detail=result.get("error"))
    return result


@router.get("/second-brain/custom")
async def second_brain_custom_list(auth: dict = Depends(require_auth)):
    from app.services import second_brain as sb_svc
    _uid(auth)
    return {"notes": sb_svc.list_custom_notes()}


# ── Note generation from the Second Brain ───────────────────────────────────
# External uploads are no longer the everyday path — notes are synthesized
# from the curriculum vault (plus any custom material added in Settings).


class GenerateNoteRequest(BaseModel):
    topic: str
    subject: str = ""
    language: str = "en"


@router.post("/ai/generate-note")
@limiter.limit("6/minute")
async def generate_note(request: Request, req: GenerateNoteRequest, auth: dict = Depends(require_auth)):
    import json as _json

    from app.services import ai as ai_svc
    from app.services import rag as rag_svc

    uid = _uid(auth)
    topic = (req.topic or "").strip()
    if not topic:
        raise HTTPException(status_code=400, detail="topic_required")

    try:
        rag_context = rag_svc.context_for(f"{req.subject} {topic}".strip())
    except Exception:
        rag_context = ""

    # Note synthesis is native-expert depth on paid plans, competent-senior
    # on free (ai_roles.expertise), resolved from the student's plan.
    from app.services.ai_roles.expertise import expertise_directive
    plan_id = plans_svc.current_plan(uid)["plan"]["id"]

    system = (
        "You are the Lyceum's Note Synthesist. Build a rich study note grounded ONLY in the "
        "provided Second Brain curriculum material (plus universally standard knowledge of the topic). "
        "Respond with ONLY a JSON object, no markdown fences, with keys: "
        "title (string), tldr (string, 1-2 sentences), summary (markdown string, 300-500 words), "
        "key_concepts (array of {concept, definition, equation (LaTeX or ''), explanation (fun analogy), emoji}), "
        "socratic_questions (array of 3 strings), key_insight (string). "
        f"Write in language code '{req.language}'."
    ) + expertise_directive("coach", plan_id)
    user = f"Topic: {topic}\nSubject: {req.subject or 'general'}\n\nSecond Brain material:\n{rag_context or '(no matching vault notes — rely on standard curriculum knowledge)'}"

    try:
        resp = await ai_svc.chat(
            [{"role": "system", "content": system}, {"role": "user", "content": user}],
            temperature=0.5, max_tokens=3000,
        )
        text = ai_svc.extract_text(resp)
    except Exception as e:
        raise HTTPException(status_code=502, detail=str(e))

    # Tolerant JSON extraction (models sometimes wrap in fences anyway).
    raw = text.strip()
    if raw.startswith("```"):
        raw = raw.strip("`")
        raw = raw[raw.find("{"):]
    start, end = raw.find("{"), raw.rfind("}")
    note: dict = {}
    if start != -1 and end > start:
        try:
            note = _json.loads(raw[start:end + 1])
        except Exception:
            note = {}
    if not note.get("title"):
        note = {"title": topic.title(), "tldr": "", "summary": text, "key_concepts": [],
                "socratic_questions": [], "key_insight": ""}
    note["source_type"] = "second-brain"

    usage = resp.get("usage") or {}
    quanta_svc.spend_tokens(uid, int(usage.get("total_tokens") or 0) or (len(text) // 4 + 50),
                            pool="standard", context="/ai/generate-note")
    return note


# ── Coach lesson package ─────────────────────────────────────────────────────
# The standard content unit for one topic: 1 illustrated note + 2 exercise
# card sets (daily + suggested past-paper, ≤15 cards each) + 1-2 break games.
# Correct-answer Quanta is awarded where cards are actually graded
# (/ai/grade-dual, /ai/grade-all — see main.py _record_grade_results), not
# here; this endpoint only assembles the package.


class GenerateLessonRequest(BaseModel):
    subject: str
    topic: str = ""
    language: str = "en"


@router.post("/ai/generate-lesson")
@limiter.limit("4/minute")
async def generate_lesson(request: Request, req: GenerateLessonRequest, auth: dict = Depends(require_auth)):
    from app.services import lesson as lesson_svc
    from app.services.ai_roles.expertise import expertise_directive

    uid = _uid(auth)
    subject = (req.subject or "").strip()
    if not subject and not req.topic.strip():
        raise HTTPException(status_code=400, detail="subject_or_topic_required")

    plan_id = plans_svc.current_plan(uid)["plan"]["id"]
    expertise = expertise_directive("coach", plan_id)

    try:
        package = await lesson_svc.generate_lesson_package(
            subject=subject, topic=req.topic.strip(), language=req.language, expertise=expertise,
        )
    except Exception as e:
        raise HTTPException(status_code=502, detail=str(e))

    # Rough flat estimate — the package makes several AI calls internally
    # (note + 2 card sets + break games); billed to the standard pool since
    # it's everyday content generation, not a Coach-only orchestration run.
    quanta_svc.spend_tokens(uid, tokens=2500, pool="standard", context="/ai/generate-lesson")
    return package


# ── Xiaohei Illustrations — plain-white, hand-drawn, deadpan-absurd body
# illustrations for an article/note (see app.services.illustration). Tool
# Dock tool 'illustrations'.


class GenerateIllustrationsRequest(BaseModel):
    text: str
    max_shots: int = 5


@router.post("/ai/illustrations")
@limiter.limit("3/minute")
async def generate_illustrations_endpoint(request: Request, req: GenerateIllustrationsRequest, auth: dict = Depends(require_auth)):
    from app.services import illustration as illustration_svc

    uid = _uid(auth)
    text = req.text.strip()
    if not text:
        raise HTTPException(status_code=400, detail="text_required")

    try:
        result = await illustration_svc.generate_illustrations(text, req.max_shots)
    except Exception as e:
        raise HTTPException(status_code=502, detail=str(e))

    # Flat estimate: one shot-list LLM call + N local image generations.
    quanta_svc.spend_tokens(uid, tokens=400 + 150 * len(result.get("shots") or []), pool="standard", context="/ai/illustrations")
    return result


# ── Share Screen with AI — student picks a screen region, Socrat looks at it
# (see app.services.ai.analyze_screen_share). Tool Dock tool 'screen-share'.


class ScreenShareRequest(BaseModel):
    image: str  # base64 PNG, optionally with a data: URL prefix
    question: str = ""


@router.post("/ai/screen-share")
@limiter.limit("6/minute")
async def screen_share_endpoint(request: Request, req: ScreenShareRequest, auth: dict = Depends(require_auth)):
    from app.services import ai as ai_svc

    uid = _uid(auth)
    image_b64 = req.image
    if image_b64.startswith("data:"):
        image_b64 = image_b64.split(",", 1)[-1]
    if not image_b64.strip():
        raise HTTPException(status_code=400, detail="image_required")

    try:
        result = await ai_svc.analyze_screen_share(image_b64, req.question)
    except Exception as e:
        raise HTTPException(status_code=502, detail=str(e))

    quanta_svc.spend_tokens(uid, tokens=200, pool="standard", context="/ai/screen-share")
    return result


# ── Exercise Cards (Tool Dock 'exercise-cards') — a deck built straight from
# a chopped past paper or textbook excerpt, always presented medium → hard →
# easy. Exactly three assists exist for these cards: Reverse Building (20
# Quanta), Image Generator (150 Quanta, content-specific), and Lotus Map
# (free, client-side only — see app.services.exercise_cards).


class ExerciseCardsGenerateRequest(BaseModel):
    source_text: str
    max_cards: int = 6


@router.post("/ai/exercise-cards/generate")
@limiter.limit("4/minute")
async def exercise_cards_generate(request: Request, req: ExerciseCardsGenerateRequest, auth: dict = Depends(require_auth)):
    from app.services import exercise_cards as exercise_cards_svc

    _uid(auth)
    text = req.source_text.strip()
    if not text:
        raise HTTPException(status_code=400, detail="source_text_required")
    try:
        cards = await exercise_cards_svc.generate_cards(text, req.max_cards)
    except Exception as e:
        raise HTTPException(status_code=502, detail=str(e))
    return {"cards": cards}


class ExerciseCardsRevealRequest(BaseModel):
    problem: str
    concepts: list[str] = []
    subject: str = ""


@router.post("/ai/exercise-cards/reverse-build/reveal")
@limiter.limit("6/minute")
async def exercise_cards_reveal(request: Request, req: ExerciseCardsRevealRequest, auth: dict = Depends(require_auth)):
    """Reverse Building assist, step 1: reveal the worked solution — 20 Quanta."""
    from app.services import ai as ai_svc

    uid = _uid(auth)
    try:
        result = await ai_svc.reveal_solution(req.problem, req.concepts, req.subject)
    except Exception as e:
        raise HTTPException(status_code=502, detail=str(e))
    quanta_svc.spend_tokens(uid, tokens=20, pool="standard", context="/ai/exercise-cards/reverse-build")
    return result


class ExerciseCardsEvalRequest(BaseModel):
    student_explanation: str
    original_problem: str
    required_tools: list[str] = []
    subject_area: str = "math"


@router.post("/ai/exercise-cards/reverse-build/evaluate")
@limiter.limit("6/minute")
async def exercise_cards_evaluate(request: Request, req: ExerciseCardsEvalRequest, auth: dict = Depends(require_auth)):
    """Reverse Building assist, step 2: grade the student's rebuilt explanation.
    No extra charge — the 20 Quanta is spent once, at reveal."""
    from app.services import ai as ai_svc

    _uid(auth)
    try:
        return await ai_svc.evaluate_reverse_build(
            req.student_explanation, req.original_problem, req.required_tools, req.subject_area,
        )
    except Exception as e:
        raise HTTPException(status_code=502, detail=str(e))


class ExerciseCardsImageRequest(BaseModel):
    problem: str


@router.post("/ai/exercise-cards/problem-image")
@limiter.limit("3/minute")
async def exercise_cards_problem_image(request: Request, req: ExerciseCardsImageRequest, auth: dict = Depends(require_auth)):
    """Image Generator assist: a diagram of THIS problem's concrete scenario
    (not the underlying theory) — 150 Quanta."""
    from app.services import exercise_cards as exercise_cards_svc
    import base64

    uid = _uid(auth)
    problem = req.problem.strip()
    if not problem:
        raise HTTPException(status_code=400, detail="problem_required")
    try:
        png_bytes = await exercise_cards_svc.generate_problem_image(problem)
    except Exception as e:
        raise HTTPException(status_code=502, detail=str(e))
    quanta_svc.spend_tokens(uid, tokens=150, pool="standard", context="/ai/exercise-cards/problem-image")
    return {"image_base64": base64.b64encode(png_bytes).decode("ascii")}


class TtsRequest(BaseModel):
    text: str
    lang: str = "en"


@router.get("/ai/tts/status")
async def tts_status():
    """Whether server-side narration is available. The Floating Podcast asks
    first and falls back to the browser's own speechSynthesis if not."""
    from app.services import cloudflare_ai
    return {"available": cloudflare_ai.tts_configured()}


@router.post("/ai/tts")
@limiter.limit("10/minute")
async def text_to_speech(request: Request, req: TtsRequest, auth: dict = Depends(require_auth)):
    """Narrate a script (typically the podcast script Coach wrote) as audio.
    Returns MP3 bytes. Free — no Quanta: this is a delivery format for
    material the student already paid to generate, not a new generation."""
    from app.services import cloudflare_ai
    from fastapi import Response

    text = req.text.strip()
    if not text:
        raise HTTPException(status_code=400, detail="text_required")
    if not cloudflare_ai.tts_configured():
        raise HTTPException(status_code=503, detail="tts_not_configured")
    try:
        audio = await cloudflare_ai.text_to_speech(text, req.lang)
    except Exception as e:
        raise HTTPException(status_code=502, detail=str(e))
    return Response(content=audio, media_type="audio/mpeg")
