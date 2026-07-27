"""
Operational configuration.

Note what is absent: API keys. This is a BYOK harness — the caller's key arrives
with the request and lives only for that request. Nothing here reads a key from
the environment, and nothing persists one.

Everything below is a knob the *operator* of the harness sets, not a secret.
"""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from enum import Enum


class Provider(str, Enum):
    GEMINI = "gemini"
    OPENAI = "openai"
    ANTHROPIC = "anthropic"


DEFAULT_MODELS: dict[Provider, str] = {
    Provider.GEMINI: os.getenv("LYCEUM_GEMINI_MODEL", "gemini-2.5-flash"),
    Provider.OPENAI: os.getenv("LYCEUM_OPENAI_MODEL", "gpt-4o-mini"),
    Provider.ANTHROPIC: os.getenv("LYCEUM_ANTHROPIC_MODEL", "claude-sonnet-4-5"),
}

PROVIDER_ENDPOINTS: dict[Provider, str] = {
    Provider.GEMINI: "https://generativelanguage.googleapis.com/v1beta",
    Provider.OPENAI: "https://api.openai.com/v1",
    Provider.ANTHROPIC: "https://api.anthropic.com/v1",
}

ANTHROPIC_API_VERSION = "2023-06-01"


def _f(name: str, default: float) -> float:
    try:
        return float(os.getenv(name, default))
    except (TypeError, ValueError):
        return default


def _i(name: str, default: int) -> int:
    try:
        return int(os.getenv(name, default))
    except (TypeError, ValueError):
        return default


@dataclass(frozen=True)
class RetryPolicy:
    """
    Exponential backoff with full jitter.

    Retries only what is worth retrying: 429, 5xx, connection errors, timeouts.
    A 400/401/403 is retried zero times — the caller's key or payload is wrong,
    and hammering the provider only burns their quota.

    `max_attempts` counts the first try: 3 means one call plus two retries.
    """

    max_attempts: int = field(default_factory=lambda: _i("LYCEUM_MAX_ATTEMPTS", 3))
    base_delay_s: float = field(default_factory=lambda: _f("LYCEUM_RETRY_BASE_S", 0.75))
    max_delay_s: float = field(default_factory=lambda: _f("LYCEUM_RETRY_MAX_S", 8.0))
    # Ceiling on a provider-supplied Retry-After, so a hostile or buggy 429
    # cannot park a client's request thread for minutes.
    max_honoured_retry_after_s: float = field(
        default_factory=lambda: _f("LYCEUM_MAX_RETRY_AFTER_S", 10.0)
    )


@dataclass(frozen=True)
class Timeouts:
    """Separate connect/read, so a slow model does not look like a dead host."""

    connect_s: float = field(default_factory=lambda: _f("LYCEUM_CONNECT_TIMEOUT_S", 5.0))
    read_s: float = field(default_factory=lambda: _f("LYCEUM_READ_TIMEOUT_S", 90.0))


@dataclass(frozen=True)
class OrchestratorConfig:
    retry: RetryPolicy = field(default_factory=RetryPolicy)
    timeouts: Timeouts = field(default_factory=Timeouts)

    # Low by default: these are explanations rendered into a UI, and output that
    # churns between identical requests reads as a bug to end users.
    temperature: float = field(default_factory=lambda: _f("LYCEUM_TEMPERATURE", 0.25))
    max_output_tokens: int = field(default_factory=lambda: _i("LYCEUM_MAX_OUTPUT_TOKENS", 4096))

    # One extra "you broke the schema, here are the errors" round trip when the
    # first response fails validation. Costs a call; saves the client a 502.
    enable_repair_pass: bool = field(
        default_factory=lambda: os.getenv("LYCEUM_REPAIR_PASS", "1") != "0"
    )

    # The intent classifier tries a free local heuristic first and only spends a
    # model call when the heuristic is genuinely unsure. Set to 0 to forbid the
    # LLM classifier entirely — the heuristic then decides alone.
    allow_model_classifier: bool = field(
        default_factory=lambda: os.getenv("LYCEUM_MODEL_CLASSIFIER", "1") != "0"
    )
    # Heuristic confidence below this triggers the model classifier (when allowed).
    classifier_escalation_threshold: float = field(
        default_factory=lambda: _f("LYCEUM_CLASSIFIER_THRESHOLD", 0.55)
    )

    # Hard ceiling on LLM calls per orchestrate() request. Protects the client's
    # bill from a pathological plan, and makes worst-case latency predictable.
    max_llm_calls_per_request: int = field(
        default_factory=lambda: _i("LYCEUM_MAX_LLM_CALLS", 4)
    )


DEFAULT_CONFIG = OrchestratorConfig()


def redact(secret: str | None) -> str:
    """
    Render a key safe for logs. Never log a raw key — these lines end up in the
    client's log store, and a leaked BYOK key is their incident, not ours.
    """
    if not secret:
        return "<none>"
    if len(secret) <= 8:
        return "***"
    return f"{secret[:4]}…{secret[-2:]}"
