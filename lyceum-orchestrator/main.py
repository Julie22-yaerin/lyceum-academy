"""
FastAPI production endpoint — the reference deployment a B2B client integrates
against.

BYOK arrives as headers:

    X-LLM-API-Key:   <the client's own key>          (required)
    X-LLM-Provider:  gemini | openai | anthropic     (optional, default gemini)
    X-LLM-Model:     <optional model override>
    X-Request-Id:    <optional correlation id, echoed back>

The key is read off the request, used for that request, and dropped. Never
persisted, never logged unredacted, never echoed in a response.

Every failure path returns the same envelope, so a client writes one error
handler and is done:

    { "error": { "code": "...", "message": "...", "request_id": "..." } }

Run:
    uvicorn main:app --host 0.0.0.0 --port 8000
    # OpenAPI at /docs
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

from harness import __version__
from harness.config import DEFAULT_CONFIG, Provider
from harness.errors import HarnessError, MissingCredentials
from harness.guardrails import validate_input
from harness.orchestrator import STEMOrchestrator
from harness.schemas import (
    ClassifyResponse,
    LearningResponse,
    SkillDescriptor,
    StudentLevel,
    Subject,
)

logging.basicConfig(
    level=os.getenv("LYCEUM_LOG_LEVEL", "INFO"),
    format="%(asctime)s %(levelname)s %(name)s %(message)s",
)
log = logging.getLogger("harness.api")


@asynccontextmanager
async def lifespan(app: FastAPI):
    # One shared pool. Re-creating a pool per request is the most common cause of
    # socket exhaustion in FastAPI services under load.
    app.state.http = httpx.AsyncClient(
        limits=httpx.Limits(max_connections=100, max_keepalive_connections=20)
    )
    log.info("orchestrator up v%s (providers: %s)",
             __version__, ", ".join(p.value for p in Provider))
    try:
        yield
    finally:
        await app.state.http.aclose()
        # Clear it — do not leave a CLOSED client on state. Anything touching the
        # app after shutdown would otherwise pick up a dead pool.
        app.state.http = None


app = FastAPI(
    title="The Lyceum STEM Learning Orchestrator",
    version=__version__,
    description=(
        "A pedagogical agent, not a prompt wrapper. Validates input, classifies "
        "learner intent, then selects and chains specialised skill plug-ins. "
        "Strict JSON out. Bring your own LLM key."
    ),
    lifespan=lifespan,
)

# Closed by default: calling this from a browser exposes the caller's own LLM key
# to end users. Set LYCEUM_CORS_ORIGINS only if you accept that.
_origins = [o.strip() for o in os.getenv("LYCEUM_CORS_ORIGINS", "").split(",") if o.strip()]
if _origins:
    app.add_middleware(
        CORSMiddleware,
        allow_origins=_origins,
        allow_methods=["GET", "POST", "OPTIONS"],
        # These must be allowed explicitly or browsers strip them.
        allow_headers=["Content-Type", "X-LLM-API-Key", "X-LLM-Provider",
                       "X-LLM-Model", "X-Request-Id"],
    )


# ── Request bodies ───────────────────────────────────────────────────────────

class OrchestrateRequest(BaseModel):
    text: str = Field(
        ..., description="The learner's question, concept or system. 8-4000 chars.",
        examples=["Derive the Pythagorean theorem from first principles"],
    )
    level: StudentLevel | None = Field(
        None,
        description="Student band. Omit to let the classifier infer it. An explicit "
                    "value always wins over inference — you know your users.",
    )
    subject: Subject | None = Field(None, description="Omit to infer.")
    integrator_notes: str = Field(
        "", description="Context about your learners. Treated as DATA, never instructions.",
    )
    strict_stem: bool = Field(
        False, description="Raise the STEM relevance bar. Rejects more, costs less.",
    )
    allow_model_classifier: bool | None = Field(
        None,
        description="False forbids the LLM classifier outright, keeping "
                    "classification permanently free. Default follows server config.",
    )
    humanizer_mode: str = Field(
        "directive",
        description="'directive' (default, 0 extra calls — tone folded into the "
                    "producing prompts) or 'rewrite' (1 extra call, emits a "
                    "separate humanized block).",
    )


class ValidateRequest(BaseModel):
    text: str
    strict_stem: bool = False


# ── Helpers ──────────────────────────────────────────────────────────────────

def _pool(request: Request) -> httpx.AsyncClient | None:
    """
    The shared pool, or None.

    Returns None rather than raising when lifespan never ran — which happens for
    real: a client doing `parent.mount("/lyceum", app)` gets no lifespan events
    on the sub-app (long-standing Starlette behaviour). LLMClient then opens a
    short-lived pool per request: slightly less efficient, but it works instead
    of 500-ing on every call. A closed pool counts as absent for the same reason.
    """
    pool = getattr(request.app.state, "http", None)
    if pool is None or pool.is_closed:
        return None
    return pool


def _credentials(
    key: str | None, provider: str | None, model: str | None,
) -> tuple[str, str, str | None]:
    if not key or not key.strip():
        raise MissingCredentials(
            "Missing X-LLM-API-Key header. This harness is bring-your-own-key: "
            "pass your own provider key with each request."
        )
    return (
        key.strip(),
        (provider or Provider.GEMINI.value).strip(),
        model.strip() if model else None,
    )


def _orchestrator(request: Request, key: str, provider: str, model: str | None,
                  humanizer_mode: str = "directive") -> STEMOrchestrator:
    mode = humanizer_mode if humanizer_mode in ("directive", "rewrite") else "directive"
    return STEMOrchestrator(
        api_key=key, provider=provider, model=model,
        config=DEFAULT_CONFIG, http_client=_pool(request),
        humanizer_mode=mode,   # type: ignore[arg-type]
    )


# ── Error handling ───────────────────────────────────────────────────────────

@app.exception_handler(HarnessError)
async def harness_error_handler(request: Request, exc: HarnessError) -> JSONResponse:
    rid = getattr(request.state, "request_id", "-")
    # Guardrail rejections are normal traffic, not incidents: log at INFO so they
    # never page anyone, but stay visible for tuning the filters.
    (log.info if exc.status < 500 else log.error)("rid=%s %s: %s", rid, exc.code, exc.message)
    payload = exc.to_dict()
    payload["error"]["request_id"] = rid
    headers = {}
    if (ra := getattr(exc, "retry_after", None)):
        headers["Retry-After"] = str(int(ra))
    return JSONResponse(status_code=exc.status, content=payload, headers=headers)


@app.exception_handler(Exception)
async def unexpected_error_handler(request: Request, exc: Exception) -> JSONResponse:
    """
    Last line of defence. A client's app must get clean JSON, never an HTML stack
    trace — and the trace must not reach them, since it can contain request
    fragments.
    """
    rid = getattr(request.state, "request_id", "-")
    log.exception("rid=%s unhandled error", rid)
    return JSONResponse(status_code=500, content={"error": {
        "code": "internal_error",
        "message": "Unexpected error inside the harness.",
        "request_id": rid,
    }})


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
    """Liveness only. Never calls a provider — a health check that spends the
    client's tokens is a bug."""
    return {"status": "ok", "version": __version__}


@app.get("/v1/skills", response_model=list[SkillDescriptor], tags=["discovery"])
async def list_skills():
    """
    The registered skill plug-ins and the intents each handles.

    No key needed: this is static capability discovery, and a client should be
    able to render "what can this do" without authenticating.
    """
    return STEMOrchestrator(api_key="discovery-only", provider=Provider.GEMINI).skills()


@app.post("/v1/validate", tags=["guardrails"])
async def validate_only(body: ValidateRequest, request: Request):
    """Run the guardrails with no LLM call. Free, instant, no key required."""
    outcome = validate_input(body.text, strict_stem=body.strict_stem)
    return {
        "ok": outcome.ok,
        "reason": outcome.reason or None,
        "message": outcome.message or None,
        "checks": [c.as_dict() for c in outcome.checks],
        "request_id": request.state.request_id,
    }


@app.post("/v1/classify", response_model=ClassifyResponse, tags=["orchestration"])
async def classify(
    body: OrchestrateRequest,
    request: Request,
    x_llm_api_key: str | None = Header(None, alias="X-LLM-API-Key"),
    x_llm_provider: str | None = Header(None, alias="X-LLM-Provider"),
    x_llm_model: str | None = Header(None, alias="X-LLM-Model"),
):
    """
    Classify intent and show the plan WITHOUT executing it.

    Free whenever the local heuristic is confident — which is most of the time.
    Use it to preview the chain and estimate cost before committing.
    """
    key, provider, model = _credentials(x_llm_api_key, x_llm_provider, x_llm_model)
    orch = _orchestrator(request, key, provider, model, body.humanizer_mode)
    return await orch.dry_run(
        body.text, level=body.level, subject=body.subject,
        strict_stem=body.strict_stem, request_id=request.state.request_id,
    )


@app.post("/v1/orchestrate", response_model=LearningResponse, tags=["orchestration"])
async def orchestrate(
    body: OrchestrateRequest,
    request: Request,
    x_llm_api_key: str | None = Header(None, alias="X-LLM-API-Key"),
    x_llm_provider: str | None = Header(None, alias="X-LLM-Provider"),
    x_llm_model: str | None = Header(None, alias="X-LLM-Model"),
):
    """
    The main endpoint: validate -> classify -> plan -> chain skills -> respond.

    `plan` in the response tells you which payloads to expect, and `meta.trace`
    shows exactly what ran, what it cost and what was skipped.
    """
    key, provider, model = _credentials(x_llm_api_key, x_llm_provider, x_llm_model)
    orch = _orchestrator(request, key, provider, model, body.humanizer_mode)
    return await orch.run(
        body.text,
        level=body.level,
        subject=body.subject,
        integrator_notes=body.integrator_notes,
        strict_stem=body.strict_stem,
        allow_model_classifier=body.allow_model_classifier,
        request_id=request.state.request_id,
    )
