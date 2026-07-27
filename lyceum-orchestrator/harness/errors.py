"""
Typed exception hierarchy.

One rule drives it: a B2B client's app must never crash because of us, and must
always be able to tell *whose* fault a failure was. So every error carries an
HTTP status and a stable machine-readable `code` the client branches on — and
nothing here ever puts the caller's API key in a message, because these strings
land in the client's log aggregator.
"""

from __future__ import annotations


class HarnessError(Exception):
    """Base class. `code` is public API surface — do not rename casually."""

    status: int = 500
    code: str = "internal_error"

    def __init__(self, message: str, *, detail: str | None = None) -> None:
        super().__init__(message)
        self.message = message
        self.detail = detail

    def to_dict(self) -> dict:
        out: dict = {"error": {"code": self.code, "message": self.message}}
        if self.detail:
            out["error"]["detail"] = self.detail
        return out


# ── 4xx — the caller can fix these ───────────────────────────────────────────

class GuardrailRejection(HarnessError):
    """Input failed validation. Raised BEFORE any LLM call, so it costs nothing."""

    status = 422
    code = "input_rejected"

    def __init__(self, message: str, *, reason: str, checks: list[dict] | None = None) -> None:
        super().__init__(message)
        self.reason = reason
        self.checks = checks or []

    def to_dict(self) -> dict:
        return {"error": {
            "code": self.code, "message": self.message,
            "reason": self.reason, "failed_checks": self.checks,
        }}


class MissingCredentials(HarnessError):
    status = 401
    code = "missing_api_key"


class InvalidCredentials(HarnessError):
    status = 401
    code = "invalid_api_key"


class UnsupportedProvider(HarnessError):
    status = 400
    code = "unsupported_provider"


class UnknownSkill(HarnessError):
    """A client asked for a skill that is not registered."""

    status = 400
    code = "unknown_skill"


# ── 5xx / upstream ───────────────────────────────────────────────────────────

class UpstreamRateLimited(HarnessError):
    status = 429
    code = "rate_limited"

    def __init__(self, message: str, *, retry_after: float | None = None) -> None:
        super().__init__(message)
        self.retry_after = retry_after


class UpstreamUnavailable(HarnessError):
    status = 503
    code = "upstream_unavailable"


class UpstreamTimeout(UpstreamUnavailable):
    code = "upstream_timeout"


class MalformedLLMOutput(HarnessError):
    """
    The model returned something that will not validate, and the repair attempt
    failed too. A 502 on purpose: the request was fine, the model misbehaved.
    Clients should treat it as retryable.
    """

    status = 502
    code = "malformed_model_output"

    def __init__(self, message: str, *, raw_excerpt: str | None = None) -> None:
        # Excerpt only — never dump an unbounded model response into a client log.
        super().__init__(message, detail=(raw_excerpt or "")[:500] or None)


class ContentBlocked(HarnessError):
    """The provider's own safety layer refused."""

    status = 422
    code = "content_blocked_upstream"


class SkillFailed(HarnessError):
    """
    A single skill blew up in a way the orchestrator could not absorb.

    Carries `skill` so a client knows which part of the chain broke — and so a
    partial response can still be assembled around it where the chain allows.
    """

    status = 502
    code = "skill_failed"

    def __init__(self, message: str, *, skill: str, detail: str | None = None) -> None:
        super().__init__(message, detail=detail)
        self.skill = skill

    def to_dict(self) -> dict:
        out = super().to_dict()
        out["error"]["skill"] = self.skill
        return out
