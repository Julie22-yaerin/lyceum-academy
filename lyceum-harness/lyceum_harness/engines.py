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
from .guardrails import assert_valid, assert_valid_student_work
from .llm_client import LLMClient
from .prompts import (
    FEYNMAN_SYSTEM,
    FEYNMAN_USER_TEMPLATE,
    PODCAST_SYSTEM,
    PODCAST_USER_TEMPLATE,
    REVERSE_BUILD_EVAL_SYSTEM,
    REVERSE_BUILD_EVAL_USER_TEMPLATE,
    REVERSE_BUILDING_SYSTEM,
    REVERSE_BUILDING_USER_TEMPLATE,
    build_extra_context,
)
from .schemas import (
    Deconstruction,
    Difficulty,
    FeynmanExplanation,
    Meta,
    PodcastFormat,
    PodcastScript,
    ReverseBuildEvaluation,
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


class ReverseBuildEvaluatorEngine(_BaseEngine):
    """
    Audit a learner's own explanation: is the reasoning logically sound, and did
    they actually apply the concept the lesson was teaching?

    This is the reverse-building engine most integrators want, because it is the
    one that produces a decision. It returns `next_state`
    (HINTING / REVERSE_BUILD_RETRY / TRANSFER_TEST) so a tutoring product can
    route the learner without writing its own grading policy.

    Two behaviours worth knowing before you wire it up:

      * `answer_correct` and `reasoning_sound` are separate, and the verdict
        follows the REASONING. A right answer reached by a broken route cannot
        score a pass — that is the whole value of auditing rather than marking.
      * The tool-fidelity gate fails a LOWER-LEVEL dodge, not an unfamiliar
        one. A more sophisticated alternative method passes.
    """

    async def run(
        self,
        explanation: str,
        *,
        problem: str,
        concept: str,
        required_tools: list[str] | None = None,
        reference_answer: str = "",
        subject: Subject | str = Subject.OTHER,
        integrator_notes: str | None = None,
        request_id: str | None = None,
    ) -> tuple[ReverseBuildEvaluation, Meta]:
        started = time.monotonic()
        rid = request_id or uuid.uuid4().hex[:16]

        # Two different guardrail profiles on purpose. The learner's own words
        # get the permissive one — no STEM-relevance gate, because a hesitant
        # half-formed answer is precisely what we are here to audit. The
        # problem statement comes from the integrator and gets the full check.
        cleaned_explanation = assert_valid_student_work(explanation)
        cleaned_problem = assert_valid(problem)

        tools = required_tools or []
        user = REVERSE_BUILD_EVAL_USER_TEMPLATE.format(
            subject=Subject(subject).value,
            concept=concept.strip()[:300] or "(not specified)",
            required_tools=", ".join(t.strip() for t in tools if t.strip()) or "(not specified)",
            problem=cleaned_problem,
            reference_answer=(reference_answer or "").strip()[:2000],
            explanation=cleaned_explanation,
            extra=build_extra_context(integrator_notes),
        )
        data = await self._client.generate_structured(
            REVERSE_BUILD_EVAL_SYSTEM, user, ReverseBuildEvaluation
        )
        log.info(
            "reverse-build-eval ok rid=%s verdict=%s next=%s tool_ok=%s flaws=%d",
            rid, data.verdict.value, data.next_state.value,
            data.tool_fidelity.ok, len(data.flaws),
        )
        return data, self._meta(rid, started)


class PodcastEngine(_BaseEngine):
    """
    Turn study material into a TTS-ready, note-takeable podcast script.

    The output is built to be handed straight to a speech engine: every
    `spoken_text` is free of LaTeX, markdown and stage directions, with maths
    verbalised ("d y by d x"), because a TTS voice reads `\\frac` aloud as
    letters and ruins the audio. Display forms travel separately in
    `on_screen_latex`.

    Segments carrying something worth writing down are flagged
    `is_note_cue=true`, which is what drives a listen-and-write UI.
    """

    async def run(
        self,
        material: str,
        *,
        format: PodcastFormat | str = PodcastFormat.EXPLORERS,
        subject: Subject | str = Subject.OTHER,
        difficulty: Difficulty | str = Difficulty.A_LEVEL,
        minutes: int = 5,
        topic: str = "",
        integrator_notes: str | None = None,
        strict_stem: bool = False,
        request_id: str | None = None,
    ) -> tuple[PodcastScript, Meta]:
        started = time.monotonic()
        rid = request_id or uuid.uuid4().hex[:16]

        cleaned = assert_valid(material, strict_stem=strict_stem)
        # Clamp rather than reject: a client asking for a 90-minute lecture has
        # made a units mistake, and failing their request teaches them nothing.
        minutes = max(1, min(int(minutes or 5), 20))

        user = PODCAST_USER_TEMPLATE.format(
            subject=Subject(subject).value,
            difficulty=Difficulty(difficulty).value,
            format=PodcastFormat(format).value,
            minutes=minutes,
            topic=topic.strip()[:300],
            material=cleaned,
            extra=build_extra_context(integrator_notes),
        )
        data = await self._client.generate_structured(PODCAST_SYSTEM, user, PodcastScript)
        log.info("podcast ok rid=%s format=%s segments=%d cues=%d est=%ds",
                 rid, data.format.value, len(data.segments),
                 sum(1 for s in data.segments if s.is_note_cue), data.estimated_seconds)
        return data, self._meta(rid, started)
