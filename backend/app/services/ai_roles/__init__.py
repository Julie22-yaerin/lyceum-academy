"""
AI Roles — 5 premium persona agents for the Lyceum learning experience.

Each role is a specialized AI persona with its own model, system prompt,
and interaction pattern. Model quality scales with subscription tier.

Tier → Model mapping:
  free       → Groq/Google cascade (existing free providers)
  compass    → GPT-4o-mini / Claude Haiku (basic paid)
  scholar    → GPT-4o / Claude 3.5 Sonnet / Gemini 1.5 Pro
  mentor     → Claude 3 Opus / o1-mini (premium)
  researcher → Full premium (o1, Claude Opus, Gemini 1.5 Pro)

Roles:
  1. Coach          — Backend Orchestrator (OpenAI o1, batch/off-peak)
  2. Feynman        — Real-time EQ Listener (Claude 3.5 Sonnet, streaming)
  3. Debate Partner — Scientific Peer (Gemini 1.5 Pro, multimodal)
  4. Concierge      — Lead Socratic Interface (Claude 3 Opus, streaming)
  5. Grader         — Solution Grader & Reverse Builder (GPT-4o + Wolfram)
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
