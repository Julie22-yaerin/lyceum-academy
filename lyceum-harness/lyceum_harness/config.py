"""
Harness configuration.

Note what is NOT here: API keys. This is a BYOK harness — the caller's key
arrives with the request and is used for exactly that request. Nothing in this
module reads a key from the environment, and nothing persists one.

Everything here is an operational knob (timeouts, retry budget, model
defaults) that the operator of the harness sets, not a secret.
"""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from enum import Enum


class Provider(str, Enum):
    GEMINI = "gemini"
    OPENAI = "openai"


# Default model per provider. Overridable per request so a client can trade
# cost for quality without us shipping a new version.
DEFAULT_MODELS: dict[Provider, str] = {
    Provider.GEMINI: os.getenv("LYCEUM_GEMINI_MODEL", "gemini-2.5-flash"),
    Provider.OPENAI: os.getenv("LYCEUM_OPENAI_MODEL", "gpt-4o-mini"),
}

PROVIDER_ENDPOINTS: dict[Provider, str] = {
    Provider.GEMINI: "https://generativelanguage.googleapis.com/v1beta",
    Provider.OPENAI: "https://api.openai.com/v1",
}


def _env_float(name: str, default: float) -> float:
    try:
        return float(os.getenv(name, default))
    except (TypeError, ValueError):
        return default


def _env_int(name: str, default: int) -> int:
    try:
        return int(os.getenv(name, default))
    except (TypeError, ValueError):
        return default


@dataclass(frozen=True)
class RetryPolicy:
    """
    Exponential backoff with full jitter.

    Only retries what is worth retrying: 429, 5xx, connection errors and
    timeouts. A 400 or 401 is retried zero times — the caller's key or payload
    is wrong and hammering the provider just burns their quota.

    `max_attempts` counts the FIRST try. 3 = one call plus two retries.
    """

    max_attempts: int = field(default_factory=lambda: _env_int("LYCEUM_MAX_ATTEMPTS", 3))
    base_delay_s: float = field(default_factory=lambda: _env_float("LYCEUM_RETRY_BASE_S", 0.75))
    max_delay_s: float = field(default_factory=lambda: _env_float("LYCEUM_RETRY_MAX_S", 8.0))
    # Hard ceiling on a provider-supplied Retry-After. Without this a hostile
    # or buggy 429 could park a client's request thread for minutes.
    max_honoured_retry_after_s: float = field(
        default_factory=lambda: _env_float("LYCEUM_MAX_RETRY_AFTER_S", 10.0)
    )


@dataclass(frozen=True)
class Timeouts:
    """Separate connect/read so a slow model doesn't look like a dead host."""

    connect_s: float = field(default_factory=lambda: _env_float("LYCEUM_CONNECT_TIMEOUT_S", 5.0))
    read_s: float = field(default_factory=lambda: _env_float("LYCEUM_READ_TIMEOUT_S", 90.0))


@dataclass(frozen=True)
class HarnessConfig:
    retry: RetryPolicy = field(default_factory=RetryPolicy)
    timeouts: Timeouts = field(default_factory=Timeouts)
    # Deterministic-ish by default: these are explanations, not creative
    # writing, and clients render them into UI that should not churn.
    temperature: float = field(default_factory=lambda: _env_float("LYCEUM_TEMPERATURE", 0.25))
    max_output_tokens: int = field(default_factory=lambda: _env_int("LYCEUM_MAX_OUTPUT_TOKENS", 4096))
    # One extra "you broke the schema, return only JSON" round trip when the
    # first response fails validation. Costs a call; saves a 502 for the client.
    enable_repair_pass: bool = field(
        default_factory=lambda: os.getenv("LYCEUM_REPAIR_PASS", "1") != "0"
    )


DEFAULT_CONFIG = HarnessConfig()


def redact(secret: str | None) -> str:
    """
    Render a key safe for logs. Never log a raw key — these strings land in
    the client's log aggregator, and a leaked BYOK key is their incident.
    """
    if not secret:
        return "<none>"
    if len(secret) <= 8:
        return "***"
    return f"{secret[:4]}…{secret[-2:]}"
