"""
FastAPI wrapper — the reference deployment a B2B client integrates against.

BYOK arrives as a header:

    X-LLM-Provider: gemini | openai      (optional, default gemini)
    X-LLM-API-Key:  <the client's own key>
    X-LLM-Model:    <optional model override>

The key is read off the request, used for that request, and dropped. It is
never written to a log, never persisted, and never echoed in a response — the
`redact()` helper exists so that no future edit accidentally changes that.

Every failure path returns the same error envelope, so a client can write one
error handler and be done:

    { "error": { "code": "...", "message": "...", ... } }

Run locally:
    uvicorn lyceum_harness.main:app --reload
"""

from __future__ import annotations

import logging
import os
import uuid
from contextlib import asynccontextmanager

import httpx
from fastapi import FastAPI, Header, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

from .config import DEFAULT_CONFIG, Provider
from .engines import (
    FeynmanEngine,
    PodcastEngine,
    ReverseBuildEvaluatorEngine,
    ReverseBuildingEngine,
)
from .errors import HarnessError, MissingCredentials
from .guardrails import validate_input
from .schemas import (
    DeconstructionResponse,
    Difficulty,
    FeynmanResponse,
    PodcastFormat,
    PodcastResponse,
    ReverseBuildEvaluationResponse,
    Subject,
)

logging.basicConfig(
    level=os.getenv("LYCEUM_LOG_LEVEL", "INFO"),
    format="%(asctime)s %(levelname)s %(name)s %(message)s",
)
log = logging.getLogger("lyceum_harness.api")


# A single shared connection pool. Re-creating a pool per request is the most
# common cause of socket exhaustion under load in FastAPI services.
@asynccontextmanager
async def lifespan(app: FastAPI):
    app.state.http = httpx.AsyncClient(
        limits=httpx.Limits(max_connections=100, max_keepalive_connections=20)
    )
    log.info("harness up (providers: %s)", ", ".join(p.value for p in Provider))
    try:
        yield
    finally:
        await app.state.http.aclose()
        # Clear it, don't leave a CLOSED client on state. Anything that touches
        # the app after shutdown (a test reusing the object, a re-mount) would
        # otherwise pick up a dead pool and fail with "client has been closed"
        # instead of transparently opening its own.
        app.state.http = None


app = FastAPI(
    title="The Lyceum — STEM Deconstruction Harness",
    version="1.0.0",
    description=(
        "Prompt-engineered STEM engines behind a strict JSON contract: Feynman "
        "breakdown, reverse-build answer auditing, first-principles "
        "deconstruction, and TTS-ready podcast scripting. Bring your own LLM key."
    ),
    lifespan=lifespan,
)

# Browser-based integrators need this; server-to-server callers do not care.
# Defaults to closed — set LYCEUM_CORS_ORIGINS to a comma-separated allowlist.
_origins = [o.strip() for o in os.getenv("LYCEUM_CORS_ORIGINS", "").split(",") if o.strip()]
if _origins:
    app.add_middleware(
        CORSMiddleware,
        allow_origins=_origins,
        allow_methods=["POST", "GET", "OPTIONS"],
        # X-LLM-API-Key must be allowed through explicitly or browsers strip it.
        allow_headers=["Content-Type", "X-LLM-API-Key", "X-LLM-Provider", "X-LLM-Model"],
    )


# ── Request bodies ───────────────────────────────────────────────────────────

class FeynmanRequest(BaseModel):
    concept: str = Field(..., description="The STEM concept or question to break down.")
    subject: Subject = Subject.OTHER
    difficulty: Difficulty = Difficulty.A_LEVEL
    integrator_notes: str | None = Field(
        None,
        description="Optional context about your learners. Treated as data, never as instructions.",
    )
    strict_stem: bool = Field(
        False,
        description="Raise the STEM relevance bar. Rejects more borderline input, saving cost.",
    )


class DeconstructRequest(BaseModel):
    target: str = Field(..., description="The theorem, law or system to deconstruct.")
    subject: Subject = Subject.OTHER
    difficulty: Difficulty = Difficulty.A_LEVEL
    integrator_notes: str | None = None
    strict_stem: bool = False


class EvaluateRequest(BaseModel):
    """
    The learner's explanation plus the context needed to judge it.

    `required_tools` is what makes the tool-fidelity gate work: without it the
    auditor can only check that the reasoning holds, not that the learner
    exercised the method the lesson was about.
    """

    explanation: str = Field(..., description="The learner's own words. Judged as-is.")
    problem: str = Field(..., description="The original problem statement.")
    concept: str = Field(..., description="The lesson concept under test, e.g. 'chain rule'.")
    required_tools: list[str] = Field(
        default_factory=list,
        description="Method(s) the lesson demands, e.g. ['chain rule']. Strongly recommended.",
    )
    reference_answer: str = Field("", description="Optional known-correct answer.")
    subject: Subject = Subject.OTHER
    integrator_notes: str | None = None


class PodcastRequest(BaseModel):
    material: str = Field(..., description="Study material to adapt into audio.")
    format: PodcastFormat = PodcastFormat.EXPLORERS
    subject: Subject = Subject.OTHER
    difficulty: Difficulty = Difficulty.A_LEVEL
    minutes: int = Field(5, ge=1, le=20, description="Target runtime. Clamped to 1-20.")
    topic: str = Field("", description="Optional focus within the material.")
    integrator_notes: str | None = None
    strict_stem: bool = False


class ValidateRequest(BaseModel):
    text: str
    strict_stem: bool = False


# ── Credential extraction ────────────────────────────────────────────────────

def _pool(request: Request) -> httpx.AsyncClient | None:
    """
    The shared connection pool, if there is one.

    Returns None rather than raising when `lifespan` never ran — which happens
    for real: a client who does `parent.mount("/lyceum", harness_app)` gets no
    lifespan events on the sub-app (a long-standing Starlette behaviour), and
    `app.state.http` would not exist. LLMClient then opens a short-lived pool
    per request: slightly less efficient, but the endpoint still works instead
    of 500-ing on every call.

    A closed pool is treated as absent for the same reason.
    """
    pool = getattr(request.app.state, "http", None)
    if pool is None or pool.is_closed:
        return None
    return pool


def _credentials(
    x_llm_api_key: str | None,
    x_llm_provider: str | None,
    x_llm_model: str | None,
) -> tuple[str, str, str | None]:
    if not x_llm_api_key or not x_llm_api_key.strip():
        raise MissingCredentials(
            "Missing X-LLM-API-Key header. This harness is bring-your-own-key: "
            "pass your own provider key with each request."
        )
    return x_llm_api_key.strip(), (x_llm_provider or Provider.GEMINI.value).strip(), (
        x_llm_model.strip() if x_llm_model else None
    )


# ── Error handling ───────────────────────────────────────────────────────────

@app.exception_handler(HarnessError)
async def harness_error_handler(request: Request, exc: HarnessError) -> JSONResponse:
    rid = getattr(request.state, "request_id", "-")
    # Guardrail rejections are normal traffic, not incidents — log at info so
    # they do not page anyone, but keep them visible for tuning the filters.
    (log.info if exc.status < 500 else log.error)(
        "rid=%s %s: %s", rid, exc.code, exc.message
    )
    payload = exc.to_dict()
    payload["error"]["request_id"] = rid
    headers = {}
    if (ra := getattr(exc, "retry_after", None)):
        headers["Retry-After"] = str(int(ra))
    return JSONResponse(status_code=exc.status, content=payload, headers=headers)


@app.exception_handler(Exception)
async def unexpected_error_handler(request: Request, exc: Exception) -> JSONResponse:
    """
    Last line of defence. A client's app must get a clean JSON 500, never an
    HTML stack trace, and the trace must never reach them — it can contain
    request fragments.
    """
    rid = getattr(request.state, "request_id", "-")
    log.exception("rid=%s unhandled error", rid)
    return JSONResponse(
        status_code=500,
        content={"error": {
            "code": "internal_error",
            "message": "Unexpected error inside the harness.",
            "request_id": rid,
        }},
    )


@app.middleware("http")
async def attach_request_id(request: Request, call_next):
    rid = request.headers.get("X-Request-Id") or uuid.uuid4().hex[:16]
    request.state.request_id = rid
    response = await call_next(request)
    response.headers["X-Request-Id"] = rid
    return response


# ── Endpoints ────────────────────────────────────────────────────────────────

@app.get("/healthz", tags=["ops"])
async def healthz():
    """Liveness only. Deliberately does NOT call a provider — a health check
    that spends the client's tokens is a bug."""
    return {"status": "ok", "version": app.version}


@app.post("/v1/validate", tags=["guardrails"])
async def validate_only(body: ValidateRequest, request: Request):
    """
    Run the guardrails without calling an LLM. Free, instant, no key needed.

    Useful for client-side pre-checks: reject junk in your own UI before it
    reaches a billable endpoint.
    """
    outcome = validate_input(body.text, strict_stem=body.strict_stem)
    return {
        "ok": outcome.ok,
        "reason": outcome.reason or None,
        "message": outcome.message or None,
        "checks": [c.as_dict() for c in outcome.checks],
        "request_id": request.state.request_id,
    }


@app.post("/v1/feynman", response_model=FeynmanResponse, tags=["engines"])
async def feynman(
    body: FeynmanRequest,
    request: Request,
    x_llm_api_key: str | None = Header(None, alias="X-LLM-API-Key"),
    x_llm_provider: str | None = Header(None, alias="X-LLM-Provider"),
    x_llm_model: str | None = Header(None, alias="X-LLM-Model"),
):
    """Break a STEM concept down with the Feynman technique."""
    key, provider, model = _credentials(x_llm_api_key, x_llm_provider, x_llm_model)
    engine = FeynmanEngine(
        api_key=key, provider=provider, model=model,
        config=DEFAULT_CONFIG, http_client=_pool(request),
    )
    data, meta = await engine.run(
        body.concept,
        subject=body.subject,
        difficulty=body.difficulty,
        integrator_notes=body.integrator_notes,
        strict_stem=body.strict_stem,
        request_id=request.state.request_id,
    )
    return FeynmanResponse(data=data, meta=meta)


@app.post("/v1/deconstruct", response_model=DeconstructionResponse, tags=["engines"])
async def deconstruct(
    body: DeconstructRequest,
    request: Request,
    x_llm_api_key: str | None = Header(None, alias="X-LLM-API-Key"),
    x_llm_provider: str | None = Header(None, alias="X-LLM-Provider"),
    x_llm_model: str | None = Header(None, alias="X-LLM-Model"),
):
    """Deconstruct a theorem or system to first principles (Reverse Building)."""
    key, provider, model = _credentials(x_llm_api_key, x_llm_provider, x_llm_model)
    engine = ReverseBuildingEngine(
        api_key=key, provider=provider, model=model,
        config=DEFAULT_CONFIG, http_client=_pool(request),
    )
    data, meta = await engine.run(
        body.target,
        subject=body.subject,
        difficulty=body.difficulty,
        integrator_notes=body.integrator_notes,
        strict_stem=body.strict_stem,
        request_id=request.state.request_id,
    )
    return DeconstructionResponse(data=data, meta=meta)


@app.post("/v1/reverse-build/evaluate", response_model=ReverseBuildEvaluationResponse,
          tags=["engines"])
async def reverse_build_evaluate(
    body: EvaluateRequest,
    request: Request,
    x_llm_api_key: str | None = Header(None, alias="X-LLM-API-Key"),
    x_llm_provider: str | None = Header(None, alias="X-LLM-Provider"),
    x_llm_model: str | None = Header(None, alias="X-LLM-Model"),
):
    """
    Audit a learner's explanation: is the reasoning logically sound, and did
    they apply the lesson's concept correctly?

    Returns `next_state` (HINTING / REVERSE_BUILD_RETRY / TRANSFER_TEST) so your
    app can route the learner without implementing a grading policy of its own.

    Note that `answer_correct` and `reasoning_sound` are reported separately and
    the verdict follows the reasoning — a right answer reached by a broken route
    does not pass.
    """
    key, provider, model = _credentials(x_llm_api_key, x_llm_provider, x_llm_model)
    engine = ReverseBuildEvaluatorEngine(
        api_key=key, provider=provider, model=model,
        config=DEFAULT_CONFIG, http_client=_pool(request),
    )
    data, meta = await engine.run(
        body.explanation,
        problem=body.problem,
        concept=body.concept,
        required_tools=body.required_tools,
        reference_answer=body.reference_answer,
        subject=body.subject,
        integrator_notes=body.integrator_notes,
        request_id=request.state.request_id,
    )
    return ReverseBuildEvaluationResponse(data=data, meta=meta)


@app.post("/v1/podcast", response_model=PodcastResponse, tags=["engines"])
async def podcast(
    body: PodcastRequest,
    request: Request,
    x_llm_api_key: str | None = Header(None, alias="X-LLM-API-Key"),
    x_llm_provider: str | None = Header(None, alias="X-LLM-Provider"),
    x_llm_model: str | None = Header(None, alias="X-LLM-Model"),
):
    """
    Turn study material into a TTS-ready podcast script with note cues.

    Every `spoken_text` is safe to send straight to a speech engine: no LaTeX,
    no markdown, no stage directions, maths verbalised. Display forms travel in
    `on_screen_latex`, and `is_note_cue` marks the lines worth writing down.
    """
    key, provider, model = _credentials(x_llm_api_key, x_llm_provider, x_llm_model)
    engine = PodcastEngine(
        api_key=key, provider=provider, model=model,
        config=DEFAULT_CONFIG, http_client=_pool(request),
    )
    data, meta = await engine.run(
        body.material,
        format=body.format,
        subject=body.subject,
        difficulty=body.difficulty,
        minutes=body.minutes,
        topic=body.topic,
        integrator_notes=body.integrator_notes,
        strict_stem=body.strict_stem,
        request_id=request.state.request_id,
    )
    return PodcastResponse(data=data, meta=meta)
