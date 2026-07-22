"""
Tier-based model routing for AI Roles.

Maps subscription tiers to model providers. Higher tiers unlock better models.

Key rules (per founder directive):
  - The free-trial AI stack is GONE — there is no free tier anymore. The
    Lyceum is application + deposit gated; every account routes to at least
    the compass (paid) model set. "free" and unknown plans normalize to
    compass.
  - OpenAI: paid tiers use OPENAI_PAID_KEY
  - Gemini: ALL tiers use gemini-1.5-pro with the same GOOGLE_API_KEY

Tier → Model mapping:
  compass    → GPT-4o-mini / Claude Haiku (paid key)
  scholar    → GPT-4o / Claude 3.5 Sonnet / Gemini 1.5 Pro
  mentor     → Claude 3 Opus / o1-mini (premium)
  researcher → Full premium — o1, Claude Opus, Gemini 1.5 Pro
"""

from __future__ import annotations

import logging
from dataclasses import dataclass

from app.core.config import settings

log = logging.getLogger("pclick.ai_roles.tier_router")

# ── Tier definitions (matches SubscriptionTierEnum) ───────────────────────────

# Kept only as a legacy alias — role modules still use it as a default
# parameter. It is NOT in the ladder anymore; normalize_tier maps it (and
# anything unknown) to compass, so the old free-trial AIs can never route.
TIER_FREE = "free"

TIER_COMPASS = "compass"
TIER_SCHOLAR = "scholar"
TIER_MENTOR = "mentor"
TIER_RESEARCHER = "researcher"

_TIER_ORDER = [TIER_COMPASS, TIER_SCHOLAR, TIER_MENTOR, TIER_RESEARCHER]

PAID_TIERS = {TIER_COMPASS, TIER_SCHOLAR, TIER_MENTOR, TIER_RESEARCHER}


def tier_at_least(user_tier: str, required: str) -> bool:
    """Check if user_tier >= required tier."""
    try:
        return _TIER_ORDER.index(user_tier) >= _TIER_ORDER.index(required)
    except ValueError:
        return False


def is_paid_tier(tier: str) -> bool:
    """Check if a tier is a paid (non-free) tier."""
    return tier in PAID_TIERS


# ── Model spec ────────────────────────────────────────────────────────────────

@dataclass(frozen=True)
class ModelSpec:
    """Resolved model configuration for a role at a given tier."""
    provider: str          # "groq" | "google" | "openai" | "anthropic" | "ollama"
    model: str             # model identifier
    use_premium: bool      # True → use dedicated premium provider functions
    use_paid_key: bool     # True → use OPENAI_PAID_KEY instead of OPENAI_API_KEY
    display_name: str = "" # human-readable name for logging


def _resolve_model(role: str, tier: str) -> ModelSpec:
    """Resolve which model to use for a given role + subscription tier."""
    spec = _TIER_MODELS.get(role, {}).get(tier)
    if spec is None:
        for t in reversed(_TIER_ORDER[:_TIER_ORDER.index(tier) + 1]):
            candidate = _TIER_MODELS.get(role, {}).get(t)
            if candidate and _provider_available(candidate.provider):
                return candidate
        spec = _TIER_MODELS.get(role, {}).get(TIER_COMPASS)

    if spec and not _provider_available(spec.provider):
        log.warning("Role %s: provider %s not configured, trying fallback", role, spec.provider)
        return _fallback_model(role, tier)

    return spec or ModelSpec(
        provider="groq", model="qwen/qwen3-32b",
        use_premium=False, use_paid_key=False,
        display_name="Groq Qwen3-32B (fallback)",
    )


def _fallback_model(role: str, tier: str) -> ModelSpec:
    """Find any available model for this role, starting from the lowest paid tier."""
    for t in _TIER_ORDER:
        spec = _TIER_MODELS.get(role, {}).get(t)
        if spec and _provider_available(spec.provider):
            return spec
    return ModelSpec(
        provider="groq", model="qwen/qwen3-32b",
        use_premium=False, use_paid_key=False,
        display_name="Groq Qwen3-32B (last resort)",
    )


def _provider_available(provider: str) -> bool:
    """Check if a provider's API key is configured."""
    checks = {
        "groq": lambda: bool(settings.groq_api_key),
        "google": lambda: bool(settings.google_api_key),
        "openai": lambda: bool(settings.openai_api_key),
        "anthropic": lambda: bool(settings.anthropic_api_key),
        "ollama": lambda: bool(settings.ollama_keys),
    }
    return checks.get(provider, lambda: False)()


def get_openai_key_for_tier(tier: str) -> str:
    """Return the correct OpenAI API key for the given tier."""
    if is_paid_tier(tier) and settings.openai_paid_key:
        return settings.openai_paid_key
    return settings.openai_api_key


# ── Tier → Model mapping for each role ────────────────────────────────────────
#
# use_paid_key=True  → OpenAI calls use OPENAI_PAID_KEY (paid subscriber)
# use_paid_key=False → OpenAI calls use OPENAI_API_KEY (legacy key)

_TIER_MODELS: dict[str, dict[str, ModelSpec]] = {
    # ── Role 1: Coach (Backend Orchestrator) ──────────────────────────────────
    # Deep CoT reasoning — free: Groq, paid: OpenAI o1/GPT-4o
    "coach": {
        TIER_COMPASS: ModelSpec(
            provider="openai", model="gpt-4o-mini",
            use_premium=False, use_paid_key=True,
            display_name="GPT-4o Mini (paid key)",
        ),
        TIER_SCHOLAR: ModelSpec(
            provider="openai", model="gpt-4o",
            use_premium=False, use_paid_key=True,
            display_name="GPT-4o (paid key)",
        ),
        TIER_MENTOR: ModelSpec(
            provider="openai", model="o1-mini",
            use_premium=True, use_paid_key=True,
            display_name="OpenAI o1-mini (paid key)",
        ),
        TIER_RESEARCHER: ModelSpec(
            provider="openai", model="o1",
            use_premium=True, use_paid_key=True,
            display_name="OpenAI o1 full (paid key)",
        ),
    },

    # ── Role 2: Feynman Listener ──────────────────────────────────────────────
    # Needs strong instruction-following + persona adherence
    "feynman": {
        TIER_COMPASS: ModelSpec(
            provider="anthropic", model="claude-3-haiku-20240307",
            use_premium=True, use_paid_key=False,
            display_name="Claude 3 Haiku",
        ),
        TIER_SCHOLAR: ModelSpec(
            provider="anthropic", model="claude-3-5-sonnet-20241022",
            use_premium=True, use_paid_key=False,
            display_name="Claude 3.5 Sonnet",
        ),
        TIER_MENTOR: ModelSpec(
            provider="anthropic", model="claude-3-5-sonnet-20241022",
            use_premium=True, use_paid_key=False,
            display_name="Claude 3.5 Sonnet",
        ),
        TIER_RESEARCHER: ModelSpec(
            provider="anthropic", model="claude-3-5-sonnet-20241022",
            use_premium=True, use_paid_key=False,
            display_name="Claude 3.5 Sonnet",
        ),
    },

    # ── Role 3: Scientific Debate Partner ──────────────────────────────────────
    # Gemini: ALL tiers use gemini-1.5-pro with the same GOOGLE_API_KEY
    "debate": {
        TIER_COMPASS: ModelSpec(
            provider="google", model="gemini-1.5-pro",
            use_premium=False, use_paid_key=False,
            display_name="Gemini 1.5 Pro (all tiers)",
        ),
        TIER_SCHOLAR: ModelSpec(
            provider="google", model="gemini-1.5-pro",
            use_premium=False, use_paid_key=False,
            display_name="Gemini 1.5 Pro (all tiers)",
        ),
        TIER_MENTOR: ModelSpec(
            provider="google", model="gemini-1.5-pro",
            use_premium=False, use_paid_key=False,
            display_name="Gemini 1.5 Pro (all tiers)",
        ),
        TIER_RESEARCHER: ModelSpec(
            provider="google", model="gemini-1.5-pro",
            use_premium=False, use_paid_key=False,
            display_name="Gemini 1.5 Pro (all tiers)",
        ),
    },

    # ── Role 4: Lead Concierge ────────────────────────────────────────────────
    # Needs deep long-context + academic tone
    "concierge": {
        TIER_COMPASS: ModelSpec(
            provider="anthropic", model="claude-3-haiku-20240307",
            use_premium=True, use_paid_key=False,
            display_name="Claude 3 Haiku",
        ),
        TIER_SCHOLAR: ModelSpec(
            provider="anthropic", model="claude-3-5-sonnet-20241022",
            use_premium=True, use_paid_key=False,
            display_name="Claude 3.5 Sonnet",
        ),
        TIER_MENTOR: ModelSpec(
            provider="anthropic", model="claude-3-opus-20240229",
            use_premium=True, use_paid_key=False,
            display_name="Claude 3 Opus",
        ),
        TIER_RESEARCHER: ModelSpec(
            provider="anthropic", model="claude-3-opus-20240229",
            use_premium=True, use_paid_key=False,
            display_name="Claude 3 Opus",
        ),
    },

    # ── Role 5: Solution Grader ───────────────────────────────────────────────
    # Needs strong math + tool use — free: Groq, paid: OpenAI GPT-4o
    "grader": {
        TIER_COMPASS: ModelSpec(
            provider="openai", model="gpt-4o-mini",
            use_premium=False, use_paid_key=True,
            display_name="GPT-4o Mini (paid key)",
        ),
        TIER_SCHOLAR: ModelSpec(
            provider="openai", model="gpt-4o",
            use_premium=False, use_paid_key=True,
            display_name="GPT-4o (paid key)",
        ),
        TIER_MENTOR: ModelSpec(
            provider="openai", model="gpt-4o",
            use_premium=False, use_paid_key=True,
            display_name="GPT-4o (paid key)",
        ),
        TIER_RESEARCHER: ModelSpec(
            provider="openai", model="gpt-4o",
            use_premium=False, use_paid_key=True,
            display_name="GPT-4o + Wolfram (paid key)",
        ),
    },
}


# New Quanta-plan ids (app/services/plans.py) → the legacy routing tiers this
# table is built around. Model quality scales with the plan the same way it
# scaled with the old tier ladder; 'team' routes at plus level.
PLAN_TO_TIER = {
    "e-lite": TIER_COMPASS,
    "basic": TIER_SCHOLAR,
    "plus": TIER_MENTOR,
    "intense": TIER_RESEARCHER,
    "team": TIER_MENTOR,
}


def normalize_tier(tier_or_plan: str) -> str:
    """Accept either a legacy tier name or a new plan id. 'free' and anything
    unknown resolve to compass — the free-trial AI stack no longer exists."""
    t = (tier_or_plan or "").strip().lower()
    if t in _TIER_ORDER:
        return t
    return PLAN_TO_TIER.get(t, TIER_COMPASS)


def resolve_role_model(role: str, tier: str) -> ModelSpec:
    """Public API: resolve the model spec for a role + subscription tier
    (legacy tier names and new Quanta-plan ids both accepted)."""
    return _resolve_model(role, normalize_tier(tier))


def get_available_tiers() -> dict[str, list[str]]:
    """Return which roles are available at each tier (for admin/UI display)."""
    result: dict[str, list[str]] = {}
    for t in _TIER_ORDER:
        roles = []
        for role in _TIER_MODELS:
            spec = _TIER_MODELS[role].get(t)
            if spec and _provider_available(spec.provider):
                roles.append(role)
        result[t] = roles
    return result
