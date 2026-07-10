"""
Personas router — learning-style matching + task-based season orchestration.

POST /personas/match
    Body: { learning_style: {slider_key: 0–100}, top_n?: 1–9 }
    Returns top_n personas ranked by cosine similarity to the user's sliders.

POST /personas/season
    Body: { task_type, subjects?: [...], learning_style?: {...} }
    Returns the best persona for each task_type (or a specific one).

GET  /personas/
    List all available personas (public, no auth required for discovery).

GET  /personas/{persona_id}
    Full persona detail.

POST /personas/save-style
    Persist the user's learning_style to Firestore under
    users/{uid}/learning_style  (called from onboarding Done step).
"""

from __future__ import annotations

import logging
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field

from app.api.deps import require_auth
from app.core.config import settings
from app.services import personas as persona_svc
from app.services import ai as ai_svc

log = logging.getLogger("pclick.personas")

router = APIRouter(prefix="/personas", tags=["personas"])

# ── Task type literal ─────────────────────────────────────────────────────────
TaskType = Literal["psets", "feynman", "hints", "mastery", "roadmap", "note", "chat"]

ALL_TASK_TYPES: list[TaskType] = ["psets", "feynman", "hints", "mastery", "roadmap", "note", "chat"]


# ── Schemas ───────────────────────────────────────────────────────────────────

class LearningStyleIn(BaseModel):
    visual:       float = Field(50, ge=0, le=100)
    exploration:  float = Field(50, ge=0, le=100)
    concrete:     float = Field(50, ge=0, le=100)
    pace:         float = Field(50, ge=0, le=100)
    challenge:    float = Field(50, ge=0, le=100)
    depth:        float = Field(50, ge=0, le=100)
    structure:    float = Field(50, ge=0, le=100)
    practice:     float = Field(50, ge=0, le=100)
    ai_proactive: float = Field(50, ge=0, le=100)
    critique:     float = Field(50, ge=0, le=100)


class MatchRequest(BaseModel):
    learning_style: LearningStyleIn
    top_n: int = Field(3, ge=1, le=9)


class SeasonRequest(BaseModel):
    task_type: TaskType | None = None   # None → return full season analysis for all tasks
    subjects: list[str] = []
    learning_style: LearningStyleIn | None = None


class SaveStyleRequest(BaseModel):
    learning_style: LearningStyleIn
    subjects: list[str] = []


# ── Helper: extract UID from auth payload ─────────────────────────────────────

def _uid(auth: dict) -> str:
    return auth.get("user_id") or auth.get("sub") or ""


# ── Save learning style to Firestore ─────────────────────────────────────────

async def _save_to_firestore(uid: str, learning_style: dict, subjects: list[str]) -> None:
    """
    Persist user's learning_style + matched_personas to Firestore.
    Collection: users/{uid}  fields: learning_style, subjects, persona_matches
    Soft-fail: never block the onboarding response if Firestore is down.
    """
    try:
        import firebase_admin
        from firebase_admin import firestore as _fs

        if not firebase_admin._apps:
            log.warning("_save_to_firestore: Firebase admin not initialised — skipping")
            return

        db = _fs.client()
        # Compute top-3 matches to store alongside
        personas = persona_svc.list_personas()
        matches = persona_svc.match_personas(learning_style, personas=personas, top_n=3)
        season = persona_svc.season_analysis(subjects, personas=personas,
                                             user_learning_style=learning_style)

        db.collection("users").document(uid).set(
            {
                "learning_style": learning_style,
                "subjects": subjects,
                "persona_matches": [
                    {"id": m["persona_id"], "name": m["name"], "match_pct": m["match_pct"]}
                    for m in matches
                ],
                "season_analysis": {
                    task: {
                        "persona_id": v["persona_id"],
                        "name": v["name"],
                        "match_pct": v["match_pct"],
                    }
                    for task, v in season.items()
                },
            },
            merge=True,
        )
        log.info("_save_to_firestore: saved style for uid=%s", uid)
    except Exception as exc:
        log.warning("_save_to_firestore: soft-fail — %s", exc)


# ── Endpoints ─────────────────────────────────────────────────────────────────

@router.get("/")
def list_all_personas():
    """
    Public endpoint — list all available scientist personas.
    Used by the frontend persona selector and onboarding Done screen.
    """
    try:
        personas = persona_svc.list_personas()
        # Fall back to in-process canonical data if Firestore is empty / not configured
        if not personas:
            personas = [
                {"id": pid, **data}
                for pid, data in persona_svc.PERSONAS_DATA.items()
            ]
        return {"personas": personas}
    except Exception as exc:
        log.error("list_all_personas: %s", exc)
        # Always return something — use canonical data as last resort
        return {
            "personas": [
                {"id": pid, **data}
                for pid, data in persona_svc.PERSONAS_DATA.items()
            ]
        }


@router.get("/{persona_id}")
def get_one_persona(persona_id: str):
    """Full persona detail including system prompt."""
    persona = persona_svc.get_persona(persona_id)
    if not persona:
        # Try in-process canonical fallback
        canon = persona_svc.PERSONAS_DATA.get(persona_id)
        if canon:
            return {"id": persona_id, **canon,
                    "system_prompt": persona_svc.PERSONAS_PROMPTS.get(persona_id, "")}
        raise HTTPException(status_code=404, detail=f"Persona '{persona_id}' not found")
    persona["system_prompt"] = persona_svc.get_system_prompt(persona_id)
    return persona


@router.post("/match")
async def match_personas_endpoint(
    request: Request,
    body: MatchRequest,
    auth: dict = Depends(require_auth),
):
    """
    Score all personas against the user's learning-style sliders using
    cosine similarity.  Returns the top_n best matches with match_pct.

    Called from:
      - Onboarding Done screen (auto, after Step 3 completes)
      - Profile settings when the user re-tunes their sliders
    """
    style_dict = body.learning_style.model_dump()
    try:
        personas = persona_svc.list_personas()
        if not personas:
            personas = [{"id": pid, **data} for pid, data in persona_svc.PERSONAS_DATA.items()]
        matches = persona_svc.match_personas(style_dict, personas=personas, top_n=body.top_n)
        return {
            "matches": matches,
            "total_personas": len(personas),
        }
    except Exception as exc:
        log.error("match_personas_endpoint: %s", exc)
        raise HTTPException(status_code=502, detail=str(exc))


@router.post("/season")
async def season_endpoint(
    request: Request,
    body: SeasonRequest,
    auth: dict = Depends(require_auth),
):
    """
    Task/season-based persona orchestration.

    If task_type is provided → return the single best persona for that task.
    If task_type is omitted  → return the full season map for all 7 task types.

    The AI orchestrator weights the persona cognitive_indices against the
    task's preferred skill profile (pure Python, no LLM call needed).
    Optionally blends 30% user learning-style fit if learning_style is provided.
    """
    style_dict = body.learning_style.model_dump() if body.learning_style else None
    try:
        personas = persona_svc.list_personas()
        if not personas:
            personas = [{"id": pid, **data} for pid, data in persona_svc.PERSONAS_DATA.items()]

        if body.task_type:
            picks = persona_svc.get_persona_for_task(
                body.task_type,
                personas=personas,
                user_learning_style=style_dict,
                top_n=3,
            )
            return {
                "task_type": body.task_type,
                "task_season": persona_svc.TASK_SEASON_LABELS.get(body.task_type, body.task_type),
                "picks": picks,
                "subjects": body.subjects,
            }
        else:
            # Full analysis for all task types
            season = persona_svc.season_analysis(
                subjects=body.subjects,
                personas=personas,
                user_learning_style=style_dict,
            )
            return {
                "season": season,
                "subjects": body.subjects,
                "task_types": ALL_TASK_TYPES,
            }
    except Exception as exc:
        log.error("season_endpoint: %s", exc)
        raise HTTPException(status_code=502, detail=str(exc))


@router.post("/save-style")
async def save_learning_style(
    request: Request,
    body: SaveStyleRequest,
    auth: dict = Depends(require_auth),
):
    """
    Persist the user's learning_style sliders + computed persona matches
    to Firestore (users/{uid}).  Called from the onboarding Done step.

    Also returns the top-3 matches and full season analysis so the
    frontend can display them without a second round-trip.
    """
    uid = _uid(auth)
    if not uid:
        raise HTTPException(status_code=401, detail="Unauthorized")

    style_dict = body.learning_style.model_dump()
    try:
        personas = persona_svc.list_personas()
        if not personas:
            personas = [{"id": pid, **data} for pid, data in persona_svc.PERSONAS_DATA.items()]

        matches = persona_svc.match_personas(style_dict, personas=personas, top_n=3)
        season  = persona_svc.season_analysis(
            subjects=body.subjects,
            personas=personas,
            user_learning_style=style_dict,
        )

        # Fire-and-forget Firestore write (soft-fail)
        await _save_to_firestore(uid, style_dict, body.subjects)

        return {
            "ok": True,
            "uid": uid,
            "top_matches": matches,
            "season": season,
        }
    except Exception as exc:
        log.error("save_learning_style: %s", exc)
        raise HTTPException(status_code=502, detail=str(exc))


# ── Invoke — multi-agent persona brain ───────────────────────────────────────

class InvokeRequest(BaseModel):
    message: str = Field(..., min_length=1, max_length=4000,
                         description="The student's question or problem")
    # Explicit persona IDs to use — if omitted the system picks from user's
    # saved matches in Firestore (or falls back to top season picks)
    persona_ids: list[str] = Field(default=[], max_length=3)
    # Optional: pass the user's learning-style so the brain can pick the
    # most fitting personas when persona_ids is not provided
    learning_style: LearningStyleIn | None = None
    # Which task context is this call for? Used to weight persona selection.
    task_type: TaskType | None = "chat"
    # Any additional context (subject, topic, pset title…)
    context: str = ""


@router.post("/invoke")
async def invoke_persona_brain(
    request: Request,
    body: InvokeRequest,
    auth: dict = Depends(require_auth),
):
    """
    Multi-agent persona brain endpoint.

    GPT-4.1 (PERSONA_MIND_KEY) reads the user's question + 3 character sheets
    loaded from the Firebase persona library and produces 3 independent
    in-character responses — one per scientist persona.

    Persona selection priority:
      1. body.persona_ids (explicit, up to 3)
      2. User's saved persona_matches from Firestore (users/{uid}.persona_matches)
      3. Season analysis for body.task_type + body.learning_style
      4. Hard-coded canonical top-3 (last resort)

    Returns:
      {
        "responses": [
          {"persona_id": str, "name": str, "voice_tag": str, "response": str},
          ...
        ],
        "model": str,
        "brain": "gpt-4.1" | "cascade_fallback",
        "personas_used": [str, ...]
      }
    """
    from app.services.content_safety import check_prompt
    check_prompt(body.message, "message")
    if body.context:
        check_prompt(body.context, "context")

    uid = _uid(auth)

    # ── Resolve which 3 personas to use ──────────────────────────────────────
    selected_personas: list[dict] = []

    # 1) Explicit IDs from request
    if body.persona_ids:
        for pid in body.persona_ids[:3]:
            p = persona_svc.get_persona(pid)
            if p is None:
                canon = persona_svc.PERSONAS_DATA.get(pid)
                if canon:
                    p = {"id": pid, **canon}
            if p:
                p["system_prompt"] = persona_svc.get_system_prompt(pid) or \
                                     persona_svc.PERSONAS_PROMPTS.get(pid, "")
                selected_personas.append(p)

    # 2) Load user's saved matches from Firestore
    if len(selected_personas) < 3 and uid:
        try:
            import firebase_admin
            from firebase_admin import firestore as _fs
            if firebase_admin._apps:
                db = _fs.client()
                user_doc = db.collection("users").document(uid).get()
                if user_doc.exists:
                    saved = user_doc.to_dict() or {}
                    existing_ids = {p.get("id") for p in selected_personas}
                    for m in saved.get("persona_matches", []):
                        if len(selected_personas) >= 3:
                            break
                        pid = m.get("id") or m.get("persona_id")
                        if pid and pid not in existing_ids:
                            p = persona_svc.get_persona(pid)
                            if p is None:
                                canon = persona_svc.PERSONAS_DATA.get(pid)
                                if canon:
                                    p = {"id": pid, **canon}
                            if p:
                                p["system_prompt"] = persona_svc.get_system_prompt(pid) or \
                                                     persona_svc.PERSONAS_PROMPTS.get(pid, "")
                                selected_personas.append(p)
                                existing_ids.add(pid)
        except Exception as exc:
            log.warning("invoke: Firestore user lookup failed — %s", exc)

    # 3) Season / learning-style picks as fallback
    if len(selected_personas) < 3:
        all_personas = persona_svc.list_personas()
        if not all_personas:
            all_personas = [{"id": pid, **data}
                            for pid, data in persona_svc.PERSONAS_DATA.items()]
        style_dict = body.learning_style.model_dump() if body.learning_style else None
        task = body.task_type or "chat"
        picks = persona_svc.get_persona_for_task(
            task,
            personas=all_personas,
            user_learning_style=style_dict,
            top_n=3,
        )
        existing_ids = {p.get("id") for p in selected_personas}
        for pick in picks:
            if len(selected_personas) >= 3:
                break
            pid = pick["persona_id"]
            if pid in existing_ids:
                continue
            p = persona_svc.get_persona(pid)
            if p is None:
                canon = persona_svc.PERSONAS_DATA.get(pid)
                if canon:
                    p = {"id": pid, **canon}
            if p:
                p["system_prompt"] = persona_svc.get_system_prompt(pid) or \
                                     persona_svc.PERSONAS_PROMPTS.get(pid, "")
                selected_personas.append(p)
                existing_ids.add(pid)

    if not selected_personas:
        raise HTTPException(status_code=500, detail="Could not resolve any personas to invoke.")

    # ── Prepend any additional context to the message ─────────────────────────
    full_message = body.message
    if body.context:
        full_message = f"Context: {body.context}\n\n{body.message}"

    # ── Call the brain ────────────────────────────────────────────────────────
    try:
        style_dict = body.learning_style.model_dump() if body.learning_style else None
        result = await ai_svc.multi_agent_split(
            full_message,
            selected_personas,
            user_learning_style=style_dict,
            fallback_to_cascade=True,
        )
    except Exception as exc:
        log.error("invoke_persona_brain: %s", exc)
        raise HTTPException(status_code=502, detail=str(exc))

    return {
        **result,
        "personas_used": [p.get("id") for p in selected_personas],
    }
