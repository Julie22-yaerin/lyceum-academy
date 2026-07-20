"""
AI Roles API Router
═══════════════════

Exposes 5 premium AI persona roles via REST endpoints.
Model quality scales with subscription tier (free → researcher).

Tier → Model mapping:
  free       → Groq/Google cascade (existing free providers)
  compass    → GPT-4o-mini / Claude Haiku
  scholar    → GPT-4o / Claude 3.5 Sonnet / Gemini 1.5 Pro
  mentor     → Claude 3 Opus / o1-mini
  researcher → Full premium (o1, Claude Opus, Gemini 1.5 Pro)

Role Endpoints:
  POST /ai/roles/coach/generate       — Coach: generate next-day curriculum
  POST /ai/roles/feynman/respond      — Feynman Listener: Socratic response
  POST /ai/roles/debate/round         — Debate Partner: scientific debate
  POST /ai/roles/concierge/respond    — Lead Concierge: master interface
  POST /ai/roles/grader/grade         — Solution Grader: grade + reverse build
  GET  /ai/roles/tiers                — Available roles per tier
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.db.session import get_db

router = APIRouter(prefix="/ai/roles", tags=["ai-roles"])


# ── Subscription tier resolver ────────────────────────────────────────────────

def _resolve_tier(request: Request, db: Session = Depends(get_db)) -> str:
    """
    FastAPI dependency: extract the user's subscription tier from their JWT.

    Falls back to "free" if:
      - No auth token present
      - User has no active subscription
      - DB lookup fails
    """
    try:
        from app.api.deps import get_current_user
        auth_data = get_current_user(request)
        uid = auth_data.get("user_id") or auth_data.get("sub") or ""
        if not uid:
            return "free"

        from app.routers.subscriptions import get_user_subscription
        _, plan = get_user_subscription(db, uid)
        return plan.tier.value if plan else "free"
    except Exception:
        return "free"


# ── Request / Response Models ─────────────────────────────────────────────────

class CoachRequest(BaseModel):
    user_id: str = ""
    second_brain_excerpts: list[str] = Field(default_factory=list)
    error_logs: list[dict[str, Any]] = Field(default_factory=list)
    mastery_profile: dict[str, Any] = Field(default_factory=dict)
    tier: str = ""  # auto-resolved from auth if empty


class FeynmanRequest(BaseModel):
    conversation_history: list[dict[str, Any]] = Field(default_factory=list)
    current_explanation: str
    tier: str = ""


class DebateRequest(BaseModel):
    thesis_text: str
    conversation_history: list[dict[str, Any]] | None = None
    image_b64_list: list[str] | None = None
    tier: str = ""


class ConciergeRequest(BaseModel):
    session_history: list[dict[str, Any]] = Field(default_factory=list)
    current_message: str
    performance_score: float | None = None
    dashboard_data: dict[str, Any] | None = None
    tier: str = ""


class GraderRequest(BaseModel):
    solution_text: str
    tool_map: dict[str, Any] | None = None
    problem_context: str = ""
    known_answer: str | None = None
    tier: str = ""


# ── Tier info endpoint ────────────────────────────────────────────────────────

@router.get("/tiers")
async def get_tier_info() -> dict[str, Any]:
    """Return which roles are available at each subscription tier."""
    from app.services.ai_roles.tier_router import get_available_tiers, _TIER_MODELS, _provider_available
    tiers = get_available_tiers()
    details = {}
    for role, tier_map in _TIER_MODELS.items():
        details[role] = {}
        for tier, spec in tier_map.items():
            details[role][tier] = {
                "model": spec.model,
                "provider": spec.provider,
                "display_name": spec.display_name,
                "available": _provider_available(spec.provider),
            }
    return {"tiers": tiers, "details": details}


# ── Role 1: Coach ────────────────────────────────────────────────────────────

@router.post("/coach/generate")
async def coach_generate(
    req: CoachRequest,
    tier: str = Depends(_resolve_tier),
) -> dict[str, Any]:
    """
    Generate a personalized next-day curriculum (Coach role).

    Batch endpoint — designed for off-peak execution.
    Model quality scales with tier: GPT-4o-mini (compass) → o1 (researcher).
    """
    from app.services.ai_roles.coach import generate_curriculum

    effective_tier = req.tier or tier

    try:
        result = await generate_curriculum(
            user_id=req.user_id,
            second_brain_excerpts=req.second_brain_excerpts,
            error_logs=req.error_logs,
            mastery_profile=req.mastery_profile,
            tier=effective_tier,
        )
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Coach generation failed: {e}")

    if result.get("error"):
        raise HTTPException(status_code=422, detail=result)

    result["_tier"] = effective_tier
    return result


# ── Role 2: Feynman Listener ────────────────────────────────────────────────

@router.post("/feynman/respond")
async def feynman_respond_endpoint(
    req: FeynmanRequest,
    tier: str = Depends(_resolve_tier),
) -> dict[str, Any]:
    """
    Feynman Listener: Socratic response to student's explanation.

    Real-time use — model quality scales with tier:
    Groq Qwen3 (free) → Claude Haiku (compass) → Claude 3.5 Sonnet (scholar+)
    """
    from app.services.ai_roles.feynman import feynman_respond

    effective_tier = req.tier or tier

    try:
        result = await feynman_respond(
            conversation_history=req.conversation_history,
            current_explanation=req.current_explanation,
            tier=effective_tier,
        )
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Feynman response failed: {e}")

    result["_tier"] = effective_tier
    return result


# ── Role 3: Scientific Debate Partner ────────────────────────────────────────

@router.post("/debate/round")
async def debate_round_endpoint(
    req: DebateRequest,
    tier: str = Depends(_resolve_tier),
) -> dict[str, Any]:
    """
    Scientific Debate Partner: peer-level intellectual debate.

    Accepts optional images (sketches, graphs, 3D structures).
    Model scales: Gemini Flash (free) → Gemini 1.5 Pro (scholar+)
    """
    from app.services.ai_roles.debate import debate_round

    effective_tier = req.tier or tier

    try:
        result = await debate_round(
            thesis_text=req.thesis_text,
            conversation_history=req.conversation_history,
            image_b64_list=req.image_b64_list,
            tier=effective_tier,
        )
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Debate round failed: {e}")

    result["_tier"] = effective_tier
    return result


# ── Role 4: Lead Concierge ──────────────────────────────────────────────────

@router.post("/concierge/respond")
async def concierge_respond_endpoint(
    req: ConciergeRequest,
    tier: str = Depends(_resolve_tier),
) -> dict[str, Any]:
    """
    Lead Concierge: master Socratic interface.

    Never exposes direct answers. Branches on performance score.
    Model scales: Groq (free) → Claude Haiku (compass) → Claude Opus (mentor+)
    """
    from app.services.ai_roles.concierge import concierge_respond

    effective_tier = req.tier or tier

    try:
        result = await concierge_respond(
            session_history=req.session_history,
            current_message=req.current_message,
            performance_score=req.performance_score,
            dashboard_data=req.dashboard_data,
            tier=effective_tier,
        )
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Concierge response failed: {e}")

    result["_tier"] = effective_tier
    return result


# ── Role 5: Solution Grader ─────────────────────────────────────────────────

@router.post("/grader/grade")
async def grader_grade_endpoint(
    req: GraderRequest,
    tier: str = Depends(_resolve_tier),
) -> dict[str, Any]:
    """
    Solution Grader & Reverse Builder.

    Hybrid verification: model analysis + WolframAlpha numeric validation.
    Model scales: GPT-4o-mini (compass) → GPT-4o (scholar+) + Wolfram
    """
    from app.services.ai_roles.grader import grade_solution

    effective_tier = req.tier or tier

    try:
        result = await grade_solution(
            solution_text=req.solution_text,
            tool_map=req.tool_map,
            problem_context=req.problem_context,
            known_answer=req.known_answer,
            tier=effective_tier,
        )
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Grading failed: {e}")

    result["_tier"] = effective_tier
    return result
