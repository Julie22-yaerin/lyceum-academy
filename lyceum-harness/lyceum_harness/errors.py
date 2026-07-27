"""
The harness's exception hierarchy.

One rule drives the design: a B2B client's app must never crash because of us,
and must always be able to tell *whose* fault a failure was. So every error
carries an HTTP-ish `status` and a stable machine-readable `code` the client
can branch on, and nothing here ever carries the caller's API key in its
message — these strings end up in the client's logs.
"""

from __future__ import annotations


class HarnessError(Exception):
    """Base class. `code` is stable API surface — do not rename casually."""

    status: int = 500
    code: str = "internal_error"

    def __init__(self, message: str, *, detail: str | None = None):
        super().__init__(message)
        self.message = message
        self.detail = detail

    def to_dict(self) -> dict:
        out: dict = {"error": {"code": self.code, "message": self.message}}
        if self.detail:
            out["error"]["detail"] = self.detail
        return out


# ── 4xx: the caller can fix these ────────────────────────────────────────────

class GuardrailRejection(HarnessError):
    """Input failed validation. Raised *before* any LLM call is made."""

    status = 422
    code = "input_rejected"

    def __init__(self, message: str, *, reason: str, checks: list[dict] | None = None):
        super().__init__(message)
        self.reason = reason
        self.checks = checks or []

    def to_dict(self) -> dict:
        return {
            "error": {
                "code": self.code,
                "message": self.message,
                "reason": self.reason,
                "failed_checks": self.checks,
            }
        }


class MissingCredentials(HarnessError):
    """BYOK: no key was supplied for the selected provider."""

    status = 401
    code = "missing_api_key"


class InvalidCredentials(HarnessError):
    """The upstream provider rejected the caller's key (401/403)."""

    status = 401
    code = "invalid_api_key"


class UnsupportedProvider(HarnessError):
    status = 400
    code = "unsupported_provider"


# ── 5xx / upstream: ours or the provider's ───────────────────────────────────

class UpstreamRateLimited(HarnessError):
    """Provider returned 429 and retries were exhausted."""

    status = 429
    code = "rate_limited"

    def __init__(self, message: str, *, retry_after: float | None = None):
        super().__init__(message)
        self.retry_after = retry_after


class UpstreamUnavailable(HarnessError):
    """Provider 5xx, connection error, or timeout after retries."""

    status = 503
    code = "upstream_unavailable"


class UpstreamTimeout(UpstreamUnavailable):
    code = "upstream_timeout"


class MalformedLLMOutput(HarnessError):
    """
    The model returned something that would not validate against the schema,
    and the repair attempt also failed.

    This is a 502 on purpose: the client's request was fine, the model
    misbehaved. Clients should treat it as retryable.
    """

    status = 502
    code = "malformed_model_output"

    def __init__(self, message: str, *, raw_excerpt: str | None = None):
        # Excerpt only — never echo an unbounded model dump into client logs.
        super().__init__(message, detail=(raw_excerpt or "")[:500] or None)


class ContentBlocked(HarnessError):
    """The provider's own safety layer refused to answer."""

    status = 422
    code = "content_blocked_upstream"
