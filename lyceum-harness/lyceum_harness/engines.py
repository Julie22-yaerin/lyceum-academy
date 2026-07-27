"""
The two engines. Thin on purpose.

Each engine does exactly four things: validate the input locally, render the
prompt, call the client, and stamp metadata. All the hard behaviour lives in
`guardrails` (what we refuse), `prompts` (what we ask for) and `llm_client`
(how we survive the network) — an engine that also parsed JSON or retried would
be the place bugs hide.

Both are usable two ways:
  * directly as a Python library (`await FeynmanEngine(...).run(...)`)
  * behind the FastAPI wrapper in `main.py`
The library path is the one B2B clients embedding in a Python backend want;
the HTTP path is for everyone else.
"""

from __future__ import annotations

import logging
import time
import uuid

import httpx

from .config import DEFAULT_CONFIG, HarnessConfig, Provider
from .guardrails import assert_valid
from .llm_client import LLMClient
from .prompts import (
    FEYNMAN_SYSTEM,
    FEYNMAN_USER_TEMPLATE,
    REVERSE_BUILDING_SYSTEM,
    REVERSE_BUILDING_USER_TEMPLATE,
    build_extra_context,
)
from .schemas import (
    Deconstruction,
    Difficulty,
    FeynmanExplanation,
    Meta,
    Subject,
    Usage,
)

log = logging.getLogger("lyceum_harness.engines")


class _BaseEngine:
    """Shared plumbing: credentials, config, timing, metadata."""

    def __init__(
        self,
        api_key: str,
        provider: Provider | str = Provider.GEMINI,
        model: str | None = None,
        config: HarnessConfig = DEFAULT_CONFIG,
        http_client: httpx.AsyncClient | None = None,
    ):
        # Constructing the client here validates the provider name and the
        # presence of a key before any prompt work happens.
        self._client = LLMClient(
            api_key=api_key, provider=provider, model=model,
            config=config, http_client=http_client,
        )

    def _meta(self, request_id: str, started: float) -> Meta:
        return Meta(
            request_id=request_id,
            provider=self._client.provider.value,
            model=self._client.model,
            latency_ms=int((time.monotonic() - started) * 1000),
            attempts=self._client.attempts_used,
            usage=Usage(**self._client.last_usage) if self._client.last_usage else Usage(),
        )


class FeynmanEngine(_BaseEngine):
    """
    Break a STEM concept down using the Feynman technique.

    The output's centre of gravity is `knowledge_gaps`: what the learner must
    already understand, plus a diagnostic question per gap. That is the field
    tutoring centres actually build product on — it tells them what to teach
    before they teach the thing that was asked about.
    """

    async def run(
        self,
        concept: str,
        *,
        subject: Subject | str = Subject.OTHER,
        difficulty: Difficulty | str = Difficulty.A_LEVEL,
        integrator_notes: str | None = None,
        strict_stem: bool = False,
        request_id: str | None = None,
    ) -> tuple[FeynmanExplanation, Meta]:
        started = time.monotonic()
        rid = request_id or uuid.uuid4().hex[:16]

        # Guardrails first — a rejection here costs zero tokens.
        cleaned = assert_valid(concept, strict_stem=strict_stem)

        user = FEYNMAN_USER_TEMPLATE.format(
            concept=cleaned,
            subject=Subject(subject).value,
            difficulty=Difficulty(difficulty).value,
            extra=build_extra_context(integrator_notes),
        )
        data = await self._client.generate_structured(FEYNMAN_SYSTEM, user, FeynmanExplanation)
        log.info("feynman ok rid=%s gaps=%d analogies=%d",
                 rid, len(data.knowledge_gaps), len(data.analogies))
        return data, self._meta(rid, started)


class ReverseBuildingEngine(_BaseEngine):
    """
    Deconstruct a theorem/system to first principles and rebuild the ladder.

    Every derivation step carries `required_tool` — the method that step must
    use. This is what lets a client refuse a learner's algebraic shortcut
    around a calculus lesson, which is the difference between practising a
    method and merely reaching a number.
    """

    async def run(
        self,
        target: str,
        *,
        subject: Subject | str = Subject.OTHER,
        difficulty: Difficulty | str = Difficulty.A_LEVEL,
        integrator_notes: str | None = None,
        strict_stem: bool = False,
        request_id: str | None = None,
    ) -> tuple[Deconstruction, Meta]:
        started = time.monotonic()
        rid = request_id or uuid.uuid4().hex[:16]

        cleaned = assert_valid(target, strict_stem=strict_stem)

        user = REVERSE_BUILDING_USER_TEMPLATE.format(
            target=cleaned,
            subject=Subject(subject).value,
            difficulty=Difficulty(difficulty).value,
            extra=build_extra_context(integrator_notes),
        )
        data = await self._client.generate_structured(
            REVERSE_BUILDING_SYSTEM, user, Deconstruction
        )
        log.info("deconstruct ok rid=%s blocks=%d steps=%d",
                 rid, len(data.building_blocks), len(data.derivation))
        return data, self._meta(rid, started)
