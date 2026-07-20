"""
AI Roles — the Lyceum Faculty: 5 persona agents, each *native* to its post.

Every role has one job, one voice, and hard boundaries — Socrat never
grades, the Grader never coaches, Leo never knows calculus. Model quality
scales with the student's Quanta plan (see tier_router.PLAN_TO_TIER for
the plan→routing mapping; legacy tier names still resolve).

Plan → Model routing:
  e-lite  (≈compass)    → GPT-4o-mini / Claude Haiku
  basic   (≈scholar)    → GPT-4o / Claude 3.5 Sonnet / Gemini 1.5 Pro
  plus    (≈mentor)     → Claude 3 Opus / o1-mini (premium)
  intense (≈researcher) → Full premium (o1, Claude Opus, Gemini 1.5 Pro)
  team                  → routes at plus level, shared Quanta pool

The Faculty:
  1. Coach     — curriculum orchestrator; plans from the Second Brain +
                 error logs, never chats directly (batch/off-peak; its
                 token spend bills to the separate Coach Quanta pool)
  2. Leo       — the Feynman child; tests explanations by not understanding
  3. The Peer  — scientific debate partner (multimodal, AP/IB rigor)
  4. Socrat    — Lead Concierge, the student's Socratic interface
  5. The Grader— solution auditor & reverse builder (Wolfram-assisted)
"""

from app.services.ai_roles.coach import generate_curriculum
from app.services.ai_roles.feynman import feynman_respond
from app.services.ai_roles.debate import debate_round
from app.services.ai_roles.concierge import concierge_respond
from app.services.ai_roles.grader import grade_solution
from app.services.ai_roles.tier_router import resolve_role_model, tier_at_least

__all__ = [
    "generate_curriculum",
    "feynman_respond",
    "debate_round",
    "concierge_respond",
    "grade_solution",
    "resolve_role_model",
    "tier_at_least",
]
