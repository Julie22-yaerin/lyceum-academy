from contextlib import asynccontextmanager
import asyncio
import base64
import json as _json
import logging
from datetime import datetime, timezone

from fastapi import FastAPI, HTTPException, UploadFile, File, Form, Request, Depends, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import JSONResponse, Response
from slowapi import _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
from starlette.middleware.base import BaseHTTPMiddleware
from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.orm import Session
import websockets as _ws

from app.core.config import settings
from app.core.limiter import limiter
from app.db.session import get_db
from app.api.deps import get_current_user, require_auth
from app.models.entities import FeatureUsageLog, AuthProviderEnum
from app.services.content_safety import check_prompt, check_messages, check_upload
from app.services import pii_filter as pii_svc
from app.services import rag as rag_svc
from app.services import local_image as local_image_svc
from app.services import wolfram as wolfram_svc
from app.services import safety_guard as safety_guard_svc
from app.services import data_retention as data_retention_svc
from app.services import personas as personas_svc
from app.services import feedback as feedback_svc

_s2s_logger = logging.getLogger("pclick.s2s")

_GEMINI_LIVE_URL = (
    "wss://generativelanguage.googleapis.com"
    "/ws/google.ai.generativelanguage.v1beta"
    ".GenerativeService.BidiGenerateContent"
)


def _uid(payload: dict) -> str:
    """Firebase UID from a require_auth-verified token payload, for scoping
    the personalization profile (app/services/mastery_profile.py)."""
    return payload.get("user_id") or payload.get("sub") or ""


def _uid_from_request(request: Request) -> str:
    """Extract user ID from request for logging purposes (best-effort)."""
    auth = request.headers.get("Authorization", "")
    if auth.startswith("Bearer "):
        try:
            token = auth[7:].strip()
            parts = token.split(".")
            if len(parts) == 3:
                padding = (4 - len(parts[1]) % 4) % 4
                payload_bytes = base64.urlsafe_b64decode(parts[1] + "=" * padding)
                payload_data = _json.loads(payload_bytes)
                return str(payload_data.get("user_id") or payload_data.get("sub") or "anonymous")
        except Exception:
            pass
    return "anonymous"


async def _with_safety_check(
    text: str,
    user_message: str = "",
    *,
    endpoint: str = "unknown",
    request: Request | None = None,
    auth: dict | None = None,
) -> str:
    """
    Run Nemotron Safety Guard on AI response text BEFORE delivering to user.
    If blocked, returns a safe fallback message instead.
    """
    uid = _uid(auth) if auth else (_uid_from_request(request) if request else "anonymous")
    result = await safety_guard_svc.check_response_safety(
        user_message=user_message or "[no user message available]",
        ai_response=text,
        endpoint=endpoint,
        user_id=uid,
    )
    if not result["safe"]:
        return result["fallback"]
    return result["response"]


def _record_grade_results(uid: str, items: list, grades: list[dict]) -> None:
    """Feed the personalization profile from a batch grading result — never
    blocks the actual response. `items` is the request's question list
    (each with .id/.concepts/.subject/.difficulty); `grades` is
    [{id, passed, ...}].

    Quanta: each correctly-answered card awards 1 Quanta (easy/medium) or 2
    (hard/extreme) — once per card, not per concept — via event_key dedupe
    so a re-grade of the same card never double-awards. Wrong answers earn
    no Quanta (mastery is what's rewarded, not attempts)."""
    if not uid:
        return
    try:
        from app.services import mastery_profile as mp_svc
        from app.services import quanta as quanta_svc
        by_id = {q.id: q for q in items}
        for g in grades:
            item = by_id.get(g.get("id"))
            if not item or not item.concepts:
                continue
            passed = bool(g.get("passed"))
            for concept in item.concepts[:3]:
                mp_svc.record_attempt(uid, concept, item.subject or "other", passed)
                if not passed:
                    mp_svc.record_event(uid, concept, item.subject or "other", "confusion")
            if passed:
                difficulty = (getattr(item, "difficulty", "") or "medium").lower()
                event_type = "exercise_correct_high" if difficulty in ("hard", "extreme") else "exercise_correct_low"
                quanta_svc.award(uid, event_type, context=item.id, event_key=f"{uid}|{event_type}|{item.id}")
    except Exception:
        pass


def _mind_map_ai_limit(tier: str | None) -> int | None:
    """Per-document (per-PDF) "Let AI see" quota — SOC-13. Plan limits are
    currently disabled app-wide (every tier is unlimited); keep the tier
    param and per-tier docstring so re-enabling later is a one-line change."""
    return None  # unlimited for every tier


def _mind_map_ai_usage(db: Session, user_id: str, document_id: str) -> int:
    query = (
        select(func.count(FeatureUsageLog.id))
        .where(FeatureUsageLog.user_id == user_id)
        .where(FeatureUsageLog.feature_name == "mindmap_ai_see")
    )
    if document_id:
        query = query.where(FeatureUsageLog.feature_metadata["document_id"].astext == document_id)
    else:
        query = query.where(FeatureUsageLog.feature_metadata["document_id"].astext.is_(None))
    return int(db.execute(query).scalar() or 0)


# ── Security headers middleware ───────────────────────────────────────────────
class SecurityHeadersMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        response = await call_next(request)

        # ── Prevent MIME-type sniffing ────────────────────────────────────────
        response.headers["X-Content-Type-Options"] = "nosniff"

        # ── Prevent clickjacking ──────────────────────────────────────────────
        response.headers["X-Frame-Options"] = "DENY"

        # ── Legacy XSS filter (belt-and-suspenders for old browsers) ─────────
        response.headers["X-XSS-Protection"] = "1; mode=block"

        # ── Limit referrer leakage ────────────────────────────────────────────
        response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"

        # ── Force HTTPS for 1 year (prod only; header ignored on HTTP) ────────
        response.headers["Strict-Transport-Security"] = (
            "max-age=31536000; includeSubDomains; preload"
        )

        # ── Permissions Policy — disable unneeded browser APIs ────────────────
        response.headers["Permissions-Policy"] = (
            "camera=(), microphone=(), geolocation=(), payment=(), usb=()"
        )

        # ── Content Security Policy ───────────────────────────────────────────
        # This is a pure JSON API — no HTML served except /docs (Swagger).
        # /docs needs unsafe-inline for Swagger UI JS; all other paths get strict CSP.
        path = request.url.path
        if path.startswith("/docs") or path.startswith("/redoc") or path == "/openapi.json":
            # Swagger UI requires inline scripts and styles
            csp = (
                "default-src 'self'; "
                "script-src 'self' 'unsafe-inline' cdn.jsdelivr.net; "
                "style-src 'self' 'unsafe-inline' cdn.jsdelivr.net; "
                "img-src 'self' data: fastapi.tiangolo.com; "
                "frame-ancestors 'none';"
            )
        else:
            # Strict CSP for all API endpoints
            csp = (
                "default-src 'none'; "
                "frame-ancestors 'none';"
            )
        response.headers["Content-Security-Policy"] = csp

        return response


# ── Request body size cap ─────────────────────────────────────────────────────
# check_upload/check_prompt already enforce per-field limits, but only AFTER
# the whole body has been read into memory. Rejecting oversized requests at
# the middleware level (via Content-Length) protects the worker from having
# its memory filled before those checks ever run.
_MAX_BODY_BYTES = 40 * 1024 * 1024   # base64-encoded PDF pages are the biggest legit payload


class BodySizeLimitMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        cl = request.headers.get("content-length")
        if cl and cl.isdigit() and int(cl) > _MAX_BODY_BYTES:
            return JSONResponse(status_code=413, content={"detail": "Request body too large."})
        return await call_next(request)


# ── Data Access Audit Middleware ─────────────────────────────────────────────
# Logs EVERY AI data-processing request for compliance transparency.
# Uses the existing activity_log service which stores to SQLite.
class DataAccessAuditMiddleware(BaseHTTPMiddleware):
    """
    Middleware that logs all data-accessing requests for audit trail compliance.
    
    Every request to an endpoint that processes user data (upload, grade, chat,
    analyze, etc.) is logged with: user, endpoint, timestamp.
    
    This provides an immutable record for answering:
      - "Which AI model accessed which user's data, when?"
      - "Was this access authorized and for what purpose?"
    """

    # Endpoints that DO process user data → need audit logging
    _DATA_ENDPOINTS: set[str] = {
        "/ai/chat",
        "/ai/dual",
        "/ai/upload-pset",
        "/ai/note-upload",
        "/ai/grade-all",
        "/ai/grade-dual",
        "/ai/analyze-page",
        "/ai/hint",
        "/ai/mastery",
        "/ai/decompose",
        "/ai/feynman",
        "/ai/reverse-build-eval",
        "/ai/reveal-solution",
        "/ai/generate-variants",
        "/ai/voice-fallback",
        "/ai/clean-question",
        "/ai/onboarding-analyze",
        "/ai/agents/content-analyzer/analyze",
        "/ai/agents/path-generator/generate",
        "/ai/agents/progress-tracker/analyze",
        "/ai/agents/dev-patrol/backend/scan",
        "/ai/agents/dev-patrol/frontend/scan",
        "/ai/agents/dev-patrol/integration/scan",
        "/ai/agents/dev-patrol/report",
        "/ai/agents/dev-patrol/report-bug",
        "/ai/agents/dev-patrol/scan-all",
        "/commander/triage",
        "/content-guard/check-text",
        "/content-guard/check-file",
        "/profile/event",
        "/profile/baseline",
        "/profile/subject-activity",
    }

    async def dispatch(self, request: Request, call_next):
        response = await call_next(request)

        # Only log configured data-processing endpoints
        if request.url.path in self._DATA_ENDPOINTS:
            try:
                from app.services import activity_log as _al
                # Extract user info from Authorization header (best-effort, no blocking)
                auth = request.headers.get("authorization", "")
                user_hint = auth[:20] + "..." if len(auth) > 20 else "anonymous"
                _al.record(
                    provider="audit_middleware",
                    task=f"data_access:{request.method}:{request.url.path}",
                    model=user_hint,
                    prompt_tokens=1,
                    completion_tokens=0,
                )
            except Exception:
                pass  # audit logging must never break the actual request

        return response


from app.services import ai         as ai_svc
from app.services import finetune_db as ft_svc
from app.routers  import admin      as admin_router
from app.routers  import auth       as auth_router
from app.routers  import subscriptions as subscriptions_router
from app.routers  import ux_metrics   as ux_metrics_router
from app.routers  import personas    as personas_router
from app.routers  import ai_agents   as ai_agents_router
from app.routers  import dev_patrol  as dev_patrol_router
from app.routers  import support_chat as support_chat_router
from app.routers  import commander   as commander_router
from app.routers  import content_guard as content_guard_router
from app.routers  import ai_registry as ai_registry_router
from app.routers  import schedule    as schedule_router
from app.routers  import ai_roles    as ai_roles_router
from app.routers  import lyceum      as lyceum_router


@asynccontextmanager
async def lifespan(_app: FastAPI):
    logger = logging.getLogger("pclick.startup")
    ft_svc.init_db()          # create SQLite tables if not present
    from app.services import activity_log as activity_log_svc
    activity_log_svc.init_db()
    from app.services import mastery_profile as mastery_profile_svc
    mastery_profile_svc.init_db()
    from app.services import feedback as feedback_svc
    feedback_svc.init_db()
    from app.services import quanta as quanta_svc
    quanta_svc.init_db()
    from app.services import plans as plans_svc
    plans_svc.init_db()
    from app.services import teams as teams_svc
    teams_svc.init_db()
    from app.services import applications as applications_svc
    applications_svc.init_db()
    from app.services import library as library_svc
    library_svc.init_db()
    from app.services import orders as orders_svc
    orders_svc.init_db()
    from app.services import user_brain as user_brain_svc
    user_brain_svc.init_db()

    # ── Start background AI agents ─────────────────────────────────────────
    from app.services.ai_agents import AGENTS as _ai_agents
    for _aid, _agent in _ai_agents.items():
        try:
            await _agent.start()
            logger.info("AI agent %s started ✓", _aid)
        except Exception as _ae:
            logger.warning("AI agent %s failed to start: %s", _aid, _ae)

    # The dev-patrol router (and Commander's dispatch) submit tasks to
    # DEV_AGENTS — a separate set of instances from the backend-dev/
    # frontend-dev/security-dev entries above. They must be started too,
    # otherwise submitted tasks queue forever and never execute.
    from app.services.ai_agents.dev_patrol import DEV_AGENTS as _dev_agents
    for _aid, _agent in _dev_agents.items():
        try:
            await _agent.start()
            logger.info("Dev Patrol agent %s started ✓", _aid)
        except Exception as _ae:
            logger.warning("Dev Patrol agent %s failed to start: %s", _aid, _ae)

    # ── Commander: restore persisted queue + start the 4-day batch loop ───
    from app.services import commander as commander_svc
    commander_svc.init_db()
    commander_svc.load_pending()

    from app.services import ai_registry as ai_registry_svc
    ai_registry_svc.init_db()

    from app.services import chat_history as chat_history_svc
    chat_history_svc.init_db()

    async def _commander_batch_loop() -> None:
        """Every 6h, check whether the 4-day minor-bug batch is due and
        dispatch it. Coarse enough interval for a multi-day cadence, cheap
        enough to just let run for the life of the process."""
        while True:
            try:
                await asyncio.sleep(6 * 3600)
                if commander_svc.should_run_batch():
                    await commander_svc.pop_batch()
                    logger.info("Commander: minor-bug batch dispatched")
            except asyncio.CancelledError:
                break
            except Exception as _be:
                logger.warning("Commander batch loop error: %s", _be)

    _commander_batch_task = asyncio.create_task(_commander_batch_loop())

    # ── Coach: daily off-peak curriculum generation batch loop ────────────
    async def _coach_batch_loop() -> None:
        """Every day at coach_batch_hour:coach_batch_minute UTC, generate
        personalized curricula for all active students. Runs as a background
        task for the life of the process."""
        import datetime as _dt
        while True:
            try:
                now = _dt.datetime.now(_dt.timezone.utc)
                target = now.replace(
                    hour=settings.coach_batch_hour,
                    minute=settings.coach_batch_minute,
                    second=0, microsecond=0,
                )
                if target <= now:
                    target += _dt.timedelta(days=1)
                wait_sec = (target - now).total_seconds()
                logger.info("Coach: next batch in %.0fs (at %s UTC)", wait_sec, target.strftime("%H:%M"))
                await asyncio.sleep(wait_sec)
                # TODO: iterate active students and call generate_curriculum()
                # For now, the batch loop is wired — actual student iteration
                # requires a user query against the DB (out of scope for setup).
                logger.info("Coach: daily batch tick — ready for student iteration")
            except asyncio.CancelledError:
                break
            except Exception as _ce:
                logger.warning("Coach batch loop error: %s", _ce)

    _coach_batch_task = asyncio.create_task(_coach_batch_loop())

    # Pre-warm the embedding model so the first upload doesn't time out.
    # all-MiniLM-L6-v2 (~80 MB) is downloaded from HuggingFace on first run.
    logger.info("Loading embedding model (may download ~80 MB on first run)…")
    try:
        from app.services.embeddings import embed
        loop = asyncio.get_running_loop()
        await asyncio.wait_for(
            loop.run_in_executor(None, embed, "warmup"),
            timeout=8.0,
        )
        logger.info("Embedding model ready ✓")
    except asyncio.TimeoutError:
        logger.warning("Embedding model warmup timed out (8s) — backend will start anyway.")
        logger.warning("Model will load on first upload request.")
    except Exception as exc:
        logger.warning("Embedding model warmup skipped: %s", exc)
        logger.warning("Uploads will still work — model loads on first request.")

    # ── Second Brain: auto re-index the curriculum vault on startup ───────
    # No persistent volume is mounted for this service, so chroma_db/
    # finetune.db reset on every redeploy — re-running ingest_vault() here
    # (idempotent: it upserts by note id) keeps the RAG index populated
    # without depending on someone remembering to click "Re-index" in the
    # admin panel after every deploy. Runs as a background task so it
    # doesn't delay readiness.
    from app.services import second_brain as second_brain_svc
    second_brain_svc.init_db()

    async def _second_brain_startup_ingest() -> None:
        try:
            loop = asyncio.get_running_loop()
            stats = await loop.run_in_executor(None, second_brain_svc.ingest_vault)
            logger.info("Second Brain: ingested vault ✓ %s", stats)
        except Exception as exc:
            logger.warning("Second Brain: startup ingest failed: %s", exc)

    asyncio.create_task(_second_brain_startup_ingest())

    # ── Batch pre-generation scheduler — polls exercise_batch_jobs every 5min ─
    from apscheduler.schedulers.asyncio import AsyncIOScheduler
    from app.services import scheduler_jobs

    _batch_scheduler = AsyncIOScheduler()
    _batch_scheduler.add_job(scheduler_jobs.poll_and_generate, "interval", minutes=5, id="batch_pregeneration")
    _batch_scheduler.start()
    logger.info("Batch pre-generation scheduler started (5min interval) ✓")

    yield

    _batch_scheduler.shutdown(wait=False)

    # ── Shutdown background AI agents ──────────────────────────────────────
    _commander_batch_task.cancel()
    try:
        await _commander_batch_task
    except asyncio.CancelledError:
        pass

    for _aid, _agent in _ai_agents.items():
        try:
            await _agent.stop()
        except Exception:
            pass

    for _aid, _agent in _dev_agents.items():
        try:
            await _agent.stop()
        except Exception:
            pass


app = FastAPI(title=settings.app_name, lifespan=lifespan)
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)
app.add_middleware(DataAccessAuditMiddleware)
app.add_middleware(SecurityHeadersMiddleware)
app.add_middleware(BodySizeLimitMiddleware)
# Compress JSON responses >1KB — note/pset analysis payloads are often 50-200KB
# of text, so this is a large win for load time and egress under load.
app.add_middleware(GZipMiddleware, minimum_size=1024)
app.include_router(admin_router.router)
app.include_router(auth_router.router)
app.include_router(subscriptions_router.router)
app.include_router(subscriptions_router.webhook_router)
app.include_router(ux_metrics_router.router)
app.include_router(personas_router.router)
app.include_router(ai_agents_router.router)
app.include_router(dev_patrol_router.router)
app.include_router(support_chat_router.router)
app.include_router(commander_router.router)
app.include_router(content_guard_router.router)
app.include_router(ai_registry_router.router)
app.include_router(schedule_router.router)
app.include_router(ai_roles_router.router)
app.include_router(lyceum_router.router)

_cors_origins = settings.cors_origins_list
# In development allow file:// (origin = "null") and any localhost port
if settings.app_env == "development":
    _cors_origins = ["*"]

app.add_middleware(
    CORSMiddleware,
    allow_origins=_cors_origins,
    allow_credentials=_cors_origins != ["*"],   # credentials + wildcard is invalid
    allow_methods=["*"],
    allow_headers=["*"],
)


# ── Health ────────────────────────────────────────────────────────────────────

# ── Data Retention Endpoint ─────────────────────────────────────────────────

class RetentionRunRequest(BaseModel):
    dry_run: bool = True


@app.post("/admin/retention/run")
@limiter.limit("2/minute")
async def admin_retention_run(
    request: Request,
    req: RetentionRunRequest,
    _: dict = Depends(require_auth),
):
    """
    Trigger a data retention sweep.
    
    By default runs in dry-run mode (reports what WOULD be deleted without
    actually deleting). Set dry_run=false to execute actual deletion.
    
    Accessible only to authenticated users with admin privileges.
    Designed to be called by an external cron scheduler (Railway Cron).
    
    Returns a detailed report of what was processed.
    """
    results = data_retention_svc.run_all_purges(dry_run=req.dry_run)
    return {
        "status": "dry_run" if req.dry_run else "executed",
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "results": results,
    }


# ── Health ────────────────────────────────────────────────────────────────────

@app.api_route("/health/live", methods=["GET", "HEAD"])
def health_live():
    return {"status": "ok"}


# ── Image proxy ──────────────────────────────────────────────────────────────
# Some image hosts block hotlinking (Referer checks) or trip the browser's
# Opaque Response Blocking, so Gemma's research images fail to render even
# though the URLs are valid. Re-serving them from our own origin fixes that.
#
# NOT an open proxy: <img> tags can't send Authorization headers, so instead
# of auth this endpoint is locked to an allowlist of the trusted image CDNs
# our research pipeline actually returns, with size/type/scheme validation
# and rate limiting.
_IMAGE_PROXY_ALLOWED_HOSTS = (
    "wikimedia.org",        # upload.wikimedia.org — main Wikipedia image host
    "wikipedia.org",
    "gstatic.com",          # Google Knowledge Graph thumbnails (t0/encrypted-tbn*)
    "googleusercontent.com",
    "ggpht.com",
)
_IMAGE_PROXY_MAX_BYTES = 8 * 1024 * 1024
_IMAGE_PROXY_MAX_REDIRECTS = 3


def _image_proxy_host_ok(url: str) -> bool:
    from urllib.parse import urlparse
    try:
        p = urlparse(url)
    except Exception:
        return False
    if p.scheme != "https" or not p.hostname:
        return False
    host = p.hostname.lower()
    return any(host == h or host.endswith("." + h) for h in _IMAGE_PROXY_ALLOWED_HOSTS)


@app.get("/media/proxy")
@limiter.limit("120/minute")
async def media_proxy(request: Request, url: str):
    if not _image_proxy_host_ok(url):
        raise HTTPException(status_code=400, detail="URL host not allowed.")
    import httpx
    # Wikimedia's User-Agent policy (meta.wikimedia.org/wiki/User-Agent_policy)
    # 403s requests without a contact URL, especially from cloud/datacenter
    # IPs — confirmed live: a generic "Pclick/1.0 (educational app)" UA got
    # 403'd from Railway's IP while working fine from a residential IP.
    headers = {"User-Agent": "LyceumAcademy/1.0 (https://www.thelyceum.site) httpx"}
    try:
        async with httpx.AsyncClient(timeout=10, follow_redirects=False) as client:
            current = url
            for _ in range(_IMAGE_PROXY_MAX_REDIRECTS + 1):
                r = await client.get(current, headers=headers)
                if r.status_code in (301, 302, 303, 307, 308):
                    nxt = r.headers.get("location", "")
                    # Re-validate every hop so a redirect can't escape the allowlist.
                    if not _image_proxy_host_ok(nxt):
                        raise HTTPException(status_code=400, detail="Redirect target not allowed.")
                    current = nxt
                    continue
                break
            if r.status_code != 200:
                raise HTTPException(status_code=502, detail=f"Upstream returned {r.status_code}.")
            ctype = r.headers.get("content-type", "")
            if not ctype.startswith("image/"):
                raise HTTPException(status_code=415, detail="Upstream response is not an image.")
            if len(r.content) > _IMAGE_PROXY_MAX_BYTES:
                raise HTTPException(status_code=413, detail="Image too large.")
            return Response(
                content=r.content,
                media_type=ctype,
                headers={
                    "Cache-Control": "public, max-age=86400, immutable",
                    "X-Content-Type-Options": "nosniff",
                },
            )
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Image fetch failed: {e}")


# ── Persona endpoints ─────────────────────────────────────────────────────────
# Expose the Firestore-backed scientist personas so the frontend and AI layer
# can query them.  All persona endpoints require authentication.

class PersonaChatRequest(BaseModel):
    persona_id: str
    messages: list[dict]
    temperature: float = 0.7
    max_tokens: int = 2048


@app.get("/personas")
@limiter.limit("60/minute")
async def list_personas(request: Request, _: dict = Depends(require_auth)):
    """Return the list of all available scientist personas."""
    if not settings.has_firestore:
        raise HTTPException(status_code=503, detail="Firestore not configured")
    personas = await asyncio.get_running_loop().run_in_executor(
        None, personas_svc.list_personas
    )
    return {"personas": personas}


@app.get("/personas/{persona_id}")
@limiter.limit("60/minute")
async def get_persona(
    request: Request,
    persona_id: str,
    _: dict = Depends(require_auth),
):
    """Return a single persona's full profile including cognitive indices."""
    if not settings.has_firestore:
        raise HTTPException(status_code=503, detail="Firestore not configured")
    persona = await asyncio.get_running_loop().run_in_executor(
        None, personas_svc.get_persona, persona_id
    )
    if persona is None:
        raise HTTPException(status_code=404, detail=f"Persona '{persona_id}' not found")
    return persona


@app.get("/personas/{persona_id}/prompt")
@limiter.limit("60/minute")
async def get_persona_prompt(
    request: Request,
    persona_id: str,
    _: dict = Depends(require_auth),
):
    """Return the system prompt for a persona (used to configure the AI)."""
    if not settings.has_firestore:
        raise HTTPException(status_code=503, detail="Firestore not configured")
    prompt = await asyncio.get_running_loop().run_in_executor(
        None, personas_svc.get_system_prompt, persona_id
    )
    if not prompt:
        raise HTTPException(status_code=404, detail=f"Persona '{persona_id}' not found")
    return {"persona_id": persona_id, "system_prompt": prompt}


@app.post("/ai/persona/chat")
@limiter.limit("3/minute")
async def persona_chat(
    request: Request,
    req: PersonaChatRequest,
    auth: dict = Depends(require_auth),
):
    """
    Chat with the AI while it embodies a specific scientist persona.

    The persona's system prompt is prepended as the first system message,
    followed by any persona context block, then the user's messages.
    Safety checks and privacy guards apply as usual.
    """
    if not settings.has_firestore:
        raise HTTPException(status_code=503, detail="Firestore not configured")

    # Safety check on the last user message
    last_user = next(
        (m.get("content", "") for m in reversed(req.messages) if m.get("role") == "user"),
        "",
    )
    safety_result = await check_prompt(last_user)
    if safety_result.get("blocked"):
        raise HTTPException(status_code=400, detail=safety_result.get("reason", "Blocked"))

    loop = asyncio.get_running_loop()

    # Fetch persona context from Firestore (non-blocking via executor)
    system_prompt = await loop.run_in_executor(
        None, personas_svc.get_system_prompt, req.persona_id
    )
    if not system_prompt:
        raise HTTPException(
            status_code=404,
            detail=f"Persona '{req.persona_id}' not found in Firestore. Run the seed script first.",
        )

    persona_ctx = await loop.run_in_executor(
        None, personas_svc.persona_context_for_chat, req.persona_id, last_user
    )

    # Build the full message list: [system] + [persona context as system] + user messages
    full_messages: list[dict] = [{"role": "system", "content": system_prompt}]
    if persona_ctx:
        full_messages.append({"role": "system", "content": persona_ctx})
    full_messages.extend(req.messages)

    response = await ai_svc.chat(
        full_messages,
        temperature=req.temperature,
        max_tokens=req.max_tokens,
    )
    text = ai_svc.extract_text(response)
    text = await _with_safety_check(text, last_user, endpoint="/ai/persona/chat",
                                     request=request, auth=auth)
    return {"reply": text, "persona_id": req.persona_id}


# ── AI endpoints ──────────────────────────────────────────────────────────────

class ChatRequest(BaseModel):
    messages: list[dict]
    model: str | None = None
    temperature: float = 0.7
    max_tokens: int = 2048
    # Optional: set to a persona_id (e.g. "einstein") to have the AI
    # respond in the style and epistemological voice of that scientist.
    persona_id: str | None = None
    # Optional: student's preferred language code (e.g. "en", "vi", "ko").
    # When set, a language directive is injected into the system prompt so the
    # AI responds in that language.
    language: str | None = None


class VoiceFallbackRequest(BaseModel):
    messages: list[dict]
    system_instruction: str = ""


class HintRequest(BaseModel):
    exercise: str
    level: int = 1   # 1 = vague, 2 = name concept, 3 = first step


class ComputeRequest(BaseModel):
    query: str


class MasteryRequest(BaseModel):
    exercise: str
    solution: str
    concepts: list[str] = []   # feeds the personalization profile — see app/services/mastery_profile.py
    subject: str = ""


class ReverseBuildRequest(BaseModel):
    student_explanation: str
    original_exercise: str
    required_tools: list[str] = []
    subject_area: str = "math"


class DecomposeRequest(BaseModel):
    playground_text: str


class TopicMapRequest(BaseModel):
    topic: str


@app.post("/ai/chat")
@limiter.limit("3/minute")
async def ai_chat(request: Request, req: ChatRequest, _: dict = Depends(require_auth)):
    """Raw chat call — pass messages directly to Ollama (qwq:32b)."""
    check_messages(req.messages)
    try:
        last_user = next(
            (m.get("content", "") for m in reversed(req.messages) if m.get("role") == "user"),
            "",
        )

        # ── WolframAlpha fast-path (SOC-17): pure computation queries don't
        # need a full LLM call — exact, faster, and cheaper than an LLM
        # doing arithmetic in its head.
        if req.model is None and wolfram_svc.looks_computational(last_user):
            wolfram_answer = await wolfram_svc.compute(last_user)
            if wolfram_answer:
                return {"text": wolfram_answer, "model": "wolframalpha", "usage": None}

        # ── RAG (SOC-17): ground the answer in the indexed knowledge base
        # to reduce hallucination. No-op until documents are indexed via
        # /admin/rag/upload, and degrades silently if the embedding model
        # isn't installed.
        messages = req.messages
        try:
            rag_context = rag_svc.context_for(last_user) if last_user else ""
        except Exception:
            rag_context = ""
        if rag_context:
            messages = [
                {"role": "system", "content": f"Reference material from the knowledge base (use if relevant, otherwise ignore):\n{rag_context}"},
                *messages,
            ]

        # ── Personal Second Brain + learning-method glossary: brief every AI
        # in the student's workspace on who they are and how they learn
        # (TOP DOWN / HARD TO EASY / JUST IN TIME). Private per workspace.
        try:
            from app.services import user_brain
            _brain_uid = _uid_from_request(request)
            if _brain_uid:
                brain_ctx = user_brain.system_context_for_user(_brain_uid)
                if brain_ctx:
                    messages = [{"role": "system", "content": brain_ctx}, *messages]
        except Exception:
            pass

        # ── Persona (optional): inject scientist persona as system context ─
        if req.persona_id and settings.has_firestore:
            loop = asyncio.get_running_loop()
            try:
                persona_prompt = await loop.run_in_executor(
                    None, personas_svc.get_system_prompt, req.persona_id
                )
                persona_ctx = await loop.run_in_executor(
                    None, personas_svc.persona_context_for_chat, req.persona_id, last_user
                )
                persona_messages: list[dict] = []
                if persona_prompt:
                    persona_messages.append({"role": "system", "content": persona_prompt})
                if persona_ctx:
                    persona_messages.append({"role": "system", "content": persona_ctx})
                if persona_messages:
                    messages = persona_messages + messages
            except Exception as _pe:
                pass  # persona injection failure must never break the main chat path

        # ── Language directive: ensure AI responds in the student's chosen language ─
        if req.language and req.language != 'en':
            _LANG_NAMES = {
                'vi': 'Vietnamese', 'ko': 'Korean', 'ja': 'Japanese',
                'zh': 'Chinese', 'es': 'Spanish', 'fr': 'French',
                'de': 'German', 'pt': 'Portuguese', 'ru': 'Russian',
                'th': 'Thai', 'hi': 'Hindi', 'ar': 'Arabic',
            }
            _lang_name = _LANG_NAMES.get(req.language, req.language)
            _lang_directive = (
                f"\n\n=== LANGUAGE DIRECTIVE (mandatory) ===\n"
                f"The student's preferred language is {_lang_name} ({req.language}).\n"
                f"ALWAYS respond in {_lang_name}. Mirror the student's language only if they explicitly switch languages themselves.\n"
                f"If the student writes in another language, keep your reply in {_lang_name} unless they explicitly ask for something else.\n"
                f"All explanations, feedback, hints, and dialogue must be in {_lang_name}."
            )
            if messages and messages[0].get('role') == 'system':
                messages[0] = {**messages[0], 'content': messages[0]['content'] + _lang_directive}
            else:
                messages.insert(0, {'role': 'system', 'content': f'You are a helpful educational assistant.{_lang_directive}'})

        resp = await ai_svc.chat(
            messages,
            model=req.model,
            temperature=req.temperature,
            max_tokens=req.max_tokens,
        )
        text = ai_svc.extract_text(resp)
        # ── Safety Guard: final gate before user ──────────────────────────
        last_user = next(
            (m.get("content", "") for m in reversed(req.messages) if m.get("role") == "user"),
            "",
        )
        text = await _with_safety_check(
            text,
            user_message=last_user,
            endpoint="/ai/chat",
            request=request,
        )
        # ── Quanta wallet: convert this call's token usage into spend ─────
        try:
            from app.services import quanta as quanta_svc
            _spend_uid = _uid_from_request(request)
            _usage = resp.get("usage") or {}
            _tokens = int(_usage.get("total_tokens") or 0) or (len(text) // 4 + 50)
            quanta_svc.spend_tokens(_spend_uid, _tokens, pool="standard", context="/ai/chat")
        except Exception:
            pass
        # ──────────────────────────────────────────────────────────────────
        return {
            "text": text,
            "model": resp.get("model"),
            "usage": resp.get("usage"),
        }
    except Exception as e:
        raise HTTPException(status_code=502, detail=str(e))


class DualChatRequest(BaseModel):
    messages: list[dict]
    temperature: float = 0.7
    max_tokens: int = 2048
    prefer_fast: bool = False


@app.post("/ai/dual")
@limiter.limit("3/minute")
async def ai_dual_chat(request: Request, req: DualChatRequest, auth: dict = Depends(require_auth)):
    """
    Dual-role AI pipeline:

    Stage 1 — PRIMARY (thinker): Groq → Google → NVIDIA → OpenRouter → Ollama
      drafts a full answer (reasoning, calculation, explanation).

    Stage 2 — REVIEWER (editor): google/diffusiongemma-26b-a4b-it on NVIDIA NIM
      refines the draft for clarity and accuracy before delivery to the student.
      Retried up to nvidia_gemma_reviewer_max_retries times on 4xx/5xx/timeout.
      Falls back to the draft if all reviewer attempts fail (fail-open).

    WolframAlpha: used as a last resort if the primary also fails and the
      query looks computational.

    Returns:
      { text, draft, model, primary_model?, reviewer_used, wolfram_fallback? }
    """
    check_messages(req.messages)
    last_user = next(
        (m.get("content", "") for m in reversed(req.messages) if m.get("role") == "user"),
        "",
    )
    try:
        result = await ai_svc.dual_role_chat(
            req.messages,
            temperature=req.temperature,
            max_tokens=req.max_tokens,
            prefer_fast=req.prefer_fast,
        )
        text = result["text"]
        # ── Safety Guard ──────────────────────────────────────────────────
        text = await _with_safety_check(
            text,
            user_message=last_user,
            endpoint="/ai/dual",
            auth=auth,
        )
        # ──────────────────────────────────────────────────────────────────
        result["text"] = text
        return result
    except Exception as e:
        raise HTTPException(status_code=502, detail=str(e))


@app.post("/ai/voice-fallback")
@limiter.limit("3/minute")
async def ai_voice_fallback(request: Request, req: VoiceFallbackRequest, _: dict = Depends(require_auth)):
    """Text-based GPT fallback for ARI when the Gemini Live WS session is down."""
    check_messages(req.messages)
    try:
        text = await ai_svc.voice_fallback_chat(req.messages, req.system_instruction)
        # ── Safety Guard ──────────────────────────────────────────────────
        last_user = next(
            (m.get("content", "") for m in reversed(req.messages) if m.get("role") == "user"),
            "",
        )
        text = await _with_safety_check(
            text,
            user_message=last_user,
            endpoint="/ai/voice-fallback",
            request=request,
        )
        # ──────────────────────────────────────────────────────────────────
        return {"text": text}
    except Exception as e:
        raise HTTPException(status_code=502, detail=str(e))


@app.post("/ai/hint")
@limiter.limit("3/minute")
async def ai_hint(request: Request, req: HintRequest, _: dict = Depends(require_auth)):
    """Return a Socratic hint for an exercise at level 1–3."""
    check_prompt(req.exercise, "exercise")
    try:
        hint = await ai_svc.get_hint(req.exercise, req.level)
        # ── Safety Guard ──────────────────────────────────────────────────
        hint = await _with_safety_check(
            hint,
            user_message=req.exercise,
            endpoint="/ai/hint",
            request=request,
        )
        # ──────────────────────────────────────────────────────────────────
        return {"hint": hint}
    except Exception as e:
        raise HTTPException(status_code=502, detail=str(e))


@app.post("/ai/compute")
@limiter.limit("3/minute")
async def ai_compute(request: Request, req: ComputeRequest, _: dict = Depends(require_auth)):
    """
    Exact computation via WolframAlpha (SOC-17 plugin) — used by Ari's live
    voice tool-calling (compute_math) for arithmetic/algebra/unit-conversion
    questions that need a precise answer rather than a Socratic discussion.
    """
    check_prompt(req.query, "query")
    if not wolfram_svc.is_configured():
        return {"result": None, "configured": False}
    result = await wolfram_svc.compute(req.query)
    return {"result": result, "configured": True}


@app.post("/ai/reverse-build-eval")
@limiter.limit("3/minute")
async def ai_reverse_build_eval(
    request: Request,
    req: ReverseBuildRequest,
    _: dict = Depends(require_auth),
):
    """
    Evaluate a student's REVERSE_BUILD explanation.

    HARD GATE — tool_fidelity:
      If the student used a lower-level method instead of required_tools
      (e.g. algebra for a calculus problem), tool_fidelity.ok=False
      and next_state="HINTING" is returned regardless of other scores.

    Returns ReverseBuildEval:
      {
        tool_fidelity: { required_tools, used_tools, ok, mismatch_note },
        conceptual_accuracy: "pass"|"partial"|"fail",
        logical_flow:        "pass"|"partial"|"fail",
        completeness:        "pass"|"partial"|"fail",
        verdict:             "pass"|"partial"|"fail",
        next_state:          "TRANSFER_TEST"|"REVERSE_BUILD_RETRY"|"HINTING",
        feedback:            str  (shown to student)
      }
    """
    check_prompt(req.student_explanation, "student_explanation")
    check_prompt(req.original_exercise, "original_exercise")
    try:
        result = await ai_svc.evaluate_reverse_build(
            student_explanation=req.student_explanation,
            original_problem=req.original_exercise,
            required_tools=req.required_tools,
            subject_area=req.subject_area,
        )
        # ── Safety Guard ──────────────────────────────────────────────────
        if result.get("feedback"):
            result["feedback"] = await _with_safety_check(
                result["feedback"],
                user_message=req.student_explanation,
                endpoint="/ai/reverse-build-eval",
                request=request,
            )
        # ──────────────────────────────────────────────────────────────────
        return result
    except Exception as e:
        raise HTTPException(status_code=502, detail=str(e))


@app.post("/ai/decompose")
@limiter.limit("3/minute")
async def ai_decompose(request: Request, req: DecomposeRequest, _: dict = Depends(require_auth)):
    """Decompose a playground into a reasoning tree."""
    check_prompt(req.playground_text, "playground_text")
    try:
        result = await ai_svc.decompose_pset(req.playground_text)
        # ── Safety Guard ──────────────────────────────────────────────────
        if result.get("summary"):
            result["summary"] = await _with_safety_check(
                result["summary"],
                user_message=req.playground_text[:800],
                endpoint="/ai/decompose",
                request=request,
            )
        # ──────────────────────────────────────────────────────────────────
        return result
    except Exception as e:
        raise HTTPException(status_code=502, detail=str(e))


@app.post("/ai/mastery")
@limiter.limit("3/minute")
async def ai_mastery(request: Request, req: MasteryRequest, auth: dict = Depends(require_auth)):
    """Evaluate a student's solution and return mastery delta."""
    check_prompt(req.exercise, "exercise")
    check_prompt(req.solution, "solution")
    try:
        result = await ai_svc.check_mastery(req.exercise, req.solution)
        # Feed the personalization profile — never blocks the actual response.
        try:
            from app.services import mastery_profile as mp_svc
            uid = _uid(auth)
            if uid and req.concepts:
                passed = bool(result.get("correct"))
                for concept in req.concepts[:3]:
                    mp_svc.record_attempt(uid, concept, req.subject or "other", passed)
                    if not passed:
                        mp_svc.record_event(uid, concept, req.subject or "other", "confusion")
        except Exception:
            pass
        # ── Safety Guard ──────────────────────────────────────────────────
        feedback_text = result.get("feedback", "")
        if feedback_text:
            result["feedback"] = await _with_safety_check(
                feedback_text,
                user_message=req.exercise,
                endpoint="/ai/mastery",
                request=request,
            )
        # ──────────────────────────────────────────────────────────────────
        return result
    except Exception as e:
        raise HTTPException(status_code=502, detail=str(e))


class GradeItem(BaseModel):
    id: str
    prompt: str
    answer: str
    concepts: list[str] = []   # feeds the personalization profile
    subject: str = ""
    difficulty: str = "medium"  # easy|medium|hard|extreme — scales correct-answer Quanta

class GradeAllRequest(BaseModel):
    questions: list[GradeItem]

class AnalyzePsetItem(BaseModel):
    id: str
    prompt: str
    difficulty: str = "medium"
    concepts: list[str] = []

class AnalyzePlaygroundRequest(BaseModel):
    questions: list[AnalyzePsetItem]


@app.post("/ai/analyze-pset-questions")
@limiter.limit("3/minute")
async def ai_analyze_pset_questions(request: Request, req: AnalyzePlaygroundRequest, _: dict = Depends(require_auth)):
    """
    Analyze all questions in a playground — topic, question types, difficulty
    distribution, and estimated time per question.
    Returns { overall_topic, question_types, difficulty_distribution,
             estimated_time_per_question, total_estimated_time }
    """
    try:
        items = [{"id": q.id, "prompt": q.prompt, "difficulty": q.difficulty, "concepts": q.concepts} for q in req.questions]
        result = await ai_svc.analyze_pset_questions(items)
        return result
    except Exception as e:
        raise HTTPException(status_code=502, detail=str(e))


class RevealSolutionRequest(BaseModel):
    exercise: str
    concepts: list[str] = []
    subject: str = ""


@app.post("/ai/reveal-solution")
@limiter.limit("3/minute")
async def ai_reveal_solution(request: Request, req: RevealSolutionRequest, _: dict = Depends(require_auth)):
    """
    REVERSE_BUILD rescue (playgrounds): after 3 wrong attempts on the same
    question, reveal the worked solution so the student can rebuild the
    reasoning from scratch. Returns { solution, required_tools }.
    """
    check_prompt(req.exercise, "exercise")
    try:
        result = await ai_svc.reveal_solution(req.exercise, req.concepts, req.subject)
        return result
    except Exception as e:
        raise HTTPException(status_code=502, detail=str(e))


class VariantSourceItem(BaseModel):
    prompt: str
    concepts: list[str] = []
    difficulty: str = "medium"


class GenerateVariantsRequest(BaseModel):
    source_questions: list[VariantSourceItem]


@app.post("/ai/generate-variants")
@limiter.limit("3/minute")
async def ai_generate_variants(request: Request, req: GenerateVariantsRequest, _: dict = Depends(require_auth)):
    """
    Bonus round after a playground: one fresh practice question per source
    question the student had to REVERSE_BUILD-rescue, same concept/difficulty.
    Returns { questions: [{id, prompt, difficulty, concepts}] }.
    """
    try:
        sources = [{"prompt": s.prompt, "concepts": s.concepts, "difficulty": s.difficulty} for s in req.source_questions]
        result = await ai_svc.generate_variant_questions(sources)
        return result
    except Exception as e:
        raise HTTPException(status_code=502, detail=str(e))


class GenerateExercisesRequest(BaseModel):
    subject: str
    topic: str = ""
    count: int = 10


@app.post("/ai/generate-exercises")
@limiter.limit("3/minute")
async def ai_generate_exercises(request: Request, req: GenerateExercisesRequest, auth: dict = Depends(require_auth)):
    """
    Generate exercise cards on-the-fly from second brain curriculum content.
    Uses RAG to pull relevant notes, then AI generates grounded questions.
    Returns { cards: [{ id, question, difficulty, concepts, subject, topic, source }] }.
    Question depth scales with the student's plan (native-expert on paid,
    competent-senior on free) via ai_roles.expertise.
    """
    try:
        expertise = ""
        uid = _uid(auth)
        if uid:
            try:
                from app.services import plans as plans_svc
                from app.services.ai_roles.expertise import expertise_directive
                plan_id = plans_svc.current_plan(uid)["plan"]["id"]
                expertise = expertise_directive("grader", plan_id)
            except Exception:
                expertise = ""
        result = await ai_svc.generate_exercises(
            subject=req.subject,
            topic=req.topic,
            count=min(req.count, 20),
            expertise=expertise,
        )
        return result
    except Exception as e:
        raise HTTPException(status_code=502, detail=str(e))


class ScheduleBlockPayload(BaseModel):
    subject_key: str
    day_of_week: int
    start_minute: int
    duration_minutes: int


class ScheduleDecideRequest(BaseModel):
    schedule: list[ScheduleBlockPayload]
    current_subject: str | None = None
    candidate_subject: str


@app.post("/ai/schedule-decide")
@limiter.limit("20/minute")
async def ai_schedule_decide(request: Request, req: ScheduleDecideRequest, _: dict = Depends(require_auth)):
    """
    Called by the frontend's ScheduleLockManager (polled every ~60s) whenever
    a scheduled block goes "live". Asks the AI whether to auto-open/lock the
    workspace onto that subject. Returns { allow_switch, recommended_subject,
    lock_minutes, reason }.
    """
    try:
        result = await ai_svc.decide_schedule_lock(
            schedule=[b.model_dump() for b in req.schedule],
            current_subject=req.current_subject,
            candidate_subject=req.candidate_subject,
        )
        return result
    except Exception as e:
        raise HTTPException(status_code=502, detail=str(e))


class OnboardingRequest(BaseModel):
    answers: dict[str, str]   # {question_id: answer}
    learning_style: dict[str, float] | None = None   # 10 slider values 0-100
    persona_ids: list[str] | None = None              # up to 3 selected persona IDs


@app.get("/ai/onboarding/questions")
async def ai_onboarding_questions():
    """
    Return the onboarding question set so the frontend can render them
    dynamically without hardcoding.  Public — no auth required.
    """
    from app.services.ai import _ONBOARDING_QUESTIONS, _PRICING_PLANS
    return {
        "questions": _ONBOARDING_QUESTIONS,
        "plans": [
            {k: v for k, v in p.items() if k not in ("features", "missing", "best_for")}
            for p in _PRICING_PLANS
        ],
    }


@app.post("/ai/onboarding-analyze")
@limiter.limit("3/minute")
async def ai_onboarding_analyze(request: Request, req: OnboardingRequest, _: dict = Depends(require_auth)):
    """
    Analyze onboarding answers with Meta Llama 3.1 70B orchestrator
    and return the recommended pricing plan.
    Returns {recommended_plan_id, plan_name, reasoning, alternatives}
    """
    if not req.answers:
        raise HTTPException(status_code=400, detail="answers cannot be empty")
    for v in req.answers.values():
        check_prompt(v, "answer")
    try:
        result = await ai_svc.analyze_onboarding(
            req.answers,
            learning_style=req.learning_style,
            persona_ids=req.persona_ids,
        )
        # ── Safety Guard ──────────────────────────────────────────────────
        if result.get("reasoning"):
            result["reasoning"] = await _with_safety_check(
                result["reasoning"],
                user_message="[onboarding answers]",
                endpoint="/ai/onboarding-analyze",
                request=request,
            )
        # ──────────────────────────────────────────────────────────────────
        return result
    except Exception as e:
        raise HTTPException(status_code=502, detail=str(e))


class FeedbackRequest(BaseModel):
    rating:  int = 0            # 1-5 stars
    comment: str = ""
    context: str = ""           # optional, e.g. "workspace" — not user-identifying
    raw: dict = {}               # client submission context (page/view, user agent, ts) — opaque, admin-only


@app.post("/feedback")
@limiter.limit("5/minute")
async def submit_feedback(request: Request, req: FeedbackRequest):
    """
    Store one anonymous feedback submission (star rating + optional comment)
    for the admin Feedback dashboard. No auth required — the feedback widget
    must work for anonymous landing-page visitors, not just signed-in
    students — the per-IP/per-user rate limiter above is the spam gate
    instead. The stored row never includes a user identifier.
    """
    if req.rating < 1 or req.rating > 5:
        raise HTTPException(status_code=400, detail="rating must be 1-5")
    if req.comment:
        check_prompt(req.comment, "comment")
    try:
        feedback_svc.submit(req.rating, req.comment, req.context, req.raw)
        return {"ok": True}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


class GradeDualItem(BaseModel):
    id: str
    prompt: str
    answer: str
    image_b64: str | None = None   # base64 PNG from canvas (handwriting)
    concepts: list[str] = []   # feeds the personalization profile
    subject: str = ""
    difficulty: str = "medium"  # easy|medium|hard|extreme — scales correct-answer Quanta

class GradeDualRequest(BaseModel):
    questions: list[GradeDualItem]

class AnalyzePageRequest(BaseModel):
    page_data: str    # base64 JPEG
    page_index: int
    total_pages: int

@app.post("/ai/analyze-page")
@limiter.limit("3/minute")
async def ai_analyze_page(request: Request, req: AnalyzePageRequest, _: dict = Depends(require_auth)):
    """Analyze a single PDF page on demand (progressive loading). Returns {problems:[...]}."""
    try:
        pg = {"index": req.page_index, "data": req.page_data, "width": 0, "height": 0}
        problems = await ai_svc._analyze_one_page(pg, req.total_pages)
        return {"problems": problems}
    except Exception as e:
        raise HTTPException(status_code=502, detail=str(e))


@app.post("/ai/grade-dual")
@limiter.limit("3/minute")
async def ai_grade_dual(request: Request, req: GradeDualRequest, auth: dict = Depends(require_auth)):
    """
    Dual-AI grading:
    - Meta Llama (Groq): grades answers + transcribes handwriting from canvas images
    - Gemma (NVIDIA): generates study suggestions for wrong answers
    Returns {grades:[{id,passed,feedback,suggestions?}]}
    """
    for q in req.questions:
        check_prompt(q.prompt, "prompt")
        check_prompt(q.answer, "answer")
    try:
        items = [
            {"id": q.id, "prompt": q.prompt, "answer": q.answer, "image_b64": q.image_b64}
            for q in req.questions
        ]
        result = await ai_svc.grade_dual(items)
        _record_grade_results(_uid(auth), req.questions, result.get("grades", []))
        # ── Safety Guard: check feedback text ─────────────────────────────
        for g in result.get("grades", []):
            fb = g.get("feedback", "")
            if fb:
                g["feedback"] = await _with_safety_check(
                    fb,
                    user_message=g.get("prompt", ""),
                    endpoint="/ai/grade-dual",
                    request=request,
                )
            sg = g.get("suggestions", "")
            if isinstance(sg, str) and sg:
                g["suggestions"] = await _with_safety_check(
                    sg,
                    user_message=g.get("prompt", ""),
                    endpoint="/ai/grade-dual",
                    request=request,
                )
        # ──────────────────────────────────────────────────────────────────
        return result
    except Exception as e:
        raise HTTPException(status_code=502, detail=str(e))




@app.post("/ai/grade-all")
@limiter.limit("3/minute")
async def ai_grade_all(request: Request, req: GradeAllRequest, auth: dict = Depends(require_auth)):
    """Batch-grade all answers in one Groq call. Returns {grades:[{id,passed,feedback}]}."""
    for q in req.questions:
        check_prompt(q.prompt, "prompt")
        check_prompt(q.answer, "answer")
    try:
        items = [{"id": q.id, "prompt": q.prompt, "answer": q.answer} for q in req.questions]
        result = await ai_svc.grade_all(items)
        _record_grade_results(_uid(auth), req.questions, result.get("grades", []))
        # ── Safety Guard: check feedback text ─────────────────────────────
        for g in result.get("grades", []):
            fb = g.get("feedback", "")
            if fb:
                g["feedback"] = await _with_safety_check(
                    fb,
                    user_message=g.get("prompt", ""),
                    endpoint="/ai/grade-all",
                    request=request,
                )
        # ──────────────────────────────────────────────────────────────────
        return result
    except Exception as e:
        raise HTTPException(status_code=502, detail=str(e))


@app.post("/ai/gemini")
@limiter.limit("3/minute")
async def ai_gemini(request: Request, req: ChatRequest, _: dict = Depends(require_auth)):
    """Chat via Ollama primary model (Ollama-only mode)."""
    try:
        resp = await ai_svc.chat_gemini(
            req.messages,
            temperature=req.temperature,
            max_tokens=req.max_tokens,
        )
        return {
            "text": ai_svc.extract_text(resp),
            "model": resp.get("model"),
            "usage": resp.get("usage"),
        }
    except Exception as e:
        raise HTTPException(status_code=502, detail=str(e))


@app.post("/ai/upload-pset")
@limiter.limit("3/minute")
async def ai_upload_pset(request: Request, file: UploadFile = File(...), _: dict = Depends(require_auth)):
    """
    Upload a PDF or PNG/JPG image containing a playground.
    1. Quick difficulty scan (title + overview only, Gemini Flash)
    2. Full analysis via vision + decompose
    Returns { summary, problems, source_file, difficulty_assessment }
    """
    import base64
    try:
        content  = await check_upload(file, max_bytes=10 * 1024 * 1024)
        mime     = file.content_type or "application/octet-stream"
        fname    = file.filename or "upload"

        # ── Safety Guard file safety check ──────────────────────────────────
        from app.services import content_guard as guard_svc
        file_safety = guard_svc.check_file_safety(fname, content, mime)
        if not file_safety.get("safe", True):
            raise HTTPException(
                status_code=400,
                detail=file_safety.get("reason", "File failed safety check"),
            )

        # ── Step 1: Quick difficulty scan ─────────────────────────────────
        difficulty_info = {"difficulty": "medium", "rationale": "skipped", "subject_area": "other"}
        try:
            if mime.startswith("image/"):
                scan_b64 = base64.b64encode(content).decode()
            elif mime == "application/pdf" or fname.lower().endswith(".pdf"):
                # Render first page to PNG for quick scan
                try:
                    import fitz
                    doc = fitz.open(stream=content, filetype="pdf")
                    page = doc[0]
                    pix = page.get_pixmap(matrix=fitz.Matrix(1.5, 1.5))
                    scan_b64 = base64.b64encode(pix.tobytes("png")).decode()
                    doc.close()
                except Exception:
                    scan_b64 = ""
            else:
                scan_b64 = ""

            if scan_b64:
                difficulty_info = await ai_svc.quick_difficulty_scan(scan_b64, fname)
        except Exception as e:
            import logging
            logging.getLogger("pclick").warning("quick_difficulty_scan failed: %s", e)

        # ── Step 2: Full analysis ──────────────────────────────────────────
        # PII filter is applied INSIDE ai.py after text extraction —
        # do NOT strip raw bytes here; that would corrupt binary PDF/image data.
        result = await ai_svc.analyze_file_pset(content, fname, mime)

        result["difficulty_assessment"] = difficulty_info
        return result

    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=502, detail=str(e))


@app.get("/ai/usage")
def ai_usage():
    """Return token counts accumulated since backend start."""
    return ai_svc.get_session_usage()


class ToolMapValidateRequest(BaseModel):
    inputs:  list[str] = []
    tools:   list[str] = []
    outputs: list[str] = []
    context: str = ""   # optional problem statement for richer feedback


@app.post("/ai/tool-map/validate")
@limiter.limit("3/minute")
async def ai_tool_map_validate(request: Request, req: ToolMapValidateRequest, _: dict = Depends(require_auth)):
    """
    Validate a student's INPUT → TOOL → OUTPUT map using Google Gemini.
    Returns { verdict, feedback, correct: [...], issues: [...], missing: [...], suggestions: [...] }
    """
    if not req.tools:
        raise HTTPException(status_code=400, detail="Add at least one tool/step")
    check_prompt(req.context, "context")
    for item in req.inputs + req.tools + req.outputs:
        check_prompt(item, "input")
    try:
        result = await ai_svc.validate_tool_map(
            inputs=req.inputs, tools=req.tools,
            outputs=req.outputs, context=req.context,
        )
        return result
    except Exception as e:
        raise HTTPException(status_code=502, detail=str(e))


class DrawingRequest(BaseModel):
    image: str   # base64 JPEG from canvas


@app.post("/ai/describe-drawing")
@limiter.limit("3/minute")
async def ai_describe_drawing(request: Request, req: DrawingRequest, _: dict = Depends(require_auth)):
    """Use Gemini vision to transcribe a student's whiteboard drawing."""
    try:
        text = await ai_svc.describe_drawing(req.image)
        # ── Safety Guard ──────────────────────────────────────────────────
        text = await _with_safety_check(
            text,
            endpoint="/ai/describe-drawing",
            request=request,
        )
        # ──────────────────────────────────────────────────────────────────
        return {"text": text}
    except Exception as e:
        raise HTTPException(status_code=502, detail=str(e))


class GenerateSpriteRequest(BaseModel):
    prompt: str
    width: int = 384
    height: int = 384


@app.post("/ai/generate-sprite")
@limiter.limit("3/minute")
async def ai_generate_sprite(request: Request, req: GenerateSpriteRequest, _: dict = Depends(require_auth)):
    """
    Generate a 2D game-asset image (sprite/background) on the backend's own
    CPU — no external image API, no GPU. Slow (tens of seconds to a couple
    of minutes) and serialized one-at-a-time server-side; the frontend must
    show an honest loading state, not a fast spinner.
    """
    check_prompt(req.prompt, "prompt")
    try:
        png_bytes = await local_image_svc.generate_sprite(req.prompt, width=req.width, height=req.height)
        return {"image": base64.b64encode(png_bytes).decode()}
    except Exception as e:
        raise HTTPException(status_code=502, detail=str(e))


class NodeSummaryRequest(BaseModel):
    label: str
    node_type: str = "concept"
    description: str = ""
    connections: list[str] = []


@app.post("/ai/node-summary")
@limiter.limit("3/minute")
async def ai_node_summary(request: Request, req: NodeSummaryRequest, _: dict = Depends(require_auth)):
    """
    Fast Groq summary for a single knowledge graph node.
    Returns {definition, equations, example, key_insight, formula_display}
    """
    check_prompt(req.label, "label")
    check_prompt(req.description, "description")
    try:
        result = await ai_svc.node_summary(
            label=req.label,
            node_type=req.node_type,
            description=req.description,
            connections=req.connections,
        )
        # ── Safety Guard ──────────────────────────────────────────────────
        if result.get("definition"):
            result["definition"] = await _with_safety_check(
                result["definition"],
                user_message=req.label,
                endpoint="/ai/node-summary",
                request=request,
            )
        # ──────────────────────────────────────────────────────────────────
        return result
    except Exception as e:
        raise HTTPException(status_code=502, detail=str(e))


class MindMapStatusResponse(BaseModel):
    tier: str
    document_limit: int | None
    used_in_document: int
    remaining: int | None
    can_use: bool


@app.get("/ai/mind-map/status", response_model=MindMapStatusResponse)
def ai_mind_map_status(
    document_id: str = "",
    current_user = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    uid = str(current_user.id)
    subscription, plan = subscriptions_router.get_user_subscription(db, uid)
    tier = plan.tier.value if plan else "free"
    document_limit = _mind_map_ai_limit(tier)
    used_in_document = _mind_map_ai_usage(db, uid, document_id)
    remaining = None if document_limit is None else max(0, document_limit - used_in_document)
    return MindMapStatusResponse(
        tier=tier,
        document_limit=document_limit,
        used_in_document=used_in_document,
        remaining=remaining,
        can_use=document_limit is None or used_in_document < document_limit,
    )


class MindMapInspectRequest(BaseModel):
    image: str
    context: str = ""
    document_id: str = ""


@app.post("/ai/mind-map/inspect")
@limiter.limit("3/minute")
async def ai_mind_map_inspect(
    request: Request,
    req: MindMapInspectRequest,
    current_user = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    uid = str(current_user.id)
    subscription, plan = subscriptions_router.get_user_subscription(db, uid)
    tier = plan.tier.value if plan else "free"
    document_limit = _mind_map_ai_limit(tier)
    used_in_document = _mind_map_ai_usage(db, uid, req.document_id)
    if document_limit is not None and used_in_document >= document_limit:
        raise HTTPException(
            status_code=429,
            detail=f"Mind map AI limit reached for this document on the {tier} tier.",
        )

    image_b64 = req.image
    if image_b64.startswith("data:"):
        image_b64 = image_b64.split(",", 1)[-1]
    result = await ai_svc.analyze_mind_map_vision(image_b64, req.context)

    if current_user.auth_provider == AuthProviderEnum.firebase and current_user.auth_subject:
        from app.services import quanta as quanta_svc
        quanta_svc.award(current_user.auth_subject, "mind_map_ai_reviewed", context=req.document_id or "")

    log_entry = FeatureUsageLog(
        user_id=current_user.id,
        feature_name="mindmap_ai_see",
        feature_metadata={
            "tier": tier,
            "document_limit": document_limit,
            "document_id": req.document_id or None,
            "model": "meta/llama-3.2-11b-vision-instruct",
        },
        created_at=datetime.now(timezone.utc),
    )
    db.add(log_entry)
    db.commit()

    status = {
        "tier": tier,
        "document_limit": document_limit,
        "used_in_document": used_in_document + 1,
        "remaining": None if document_limit is None else max(0, document_limit - used_in_document - 1),
        "can_use": document_limit is None or used_in_document + 1 < document_limit,
    }
    return {**result, **status}


class CleanQuestionRequest(BaseModel):
    prompt: str
    context: str = ""   # optional: surrounding text / playground title


@app.post("/ai/clean-question")
@limiter.limit("3/minute")
async def ai_clean_question(request: Request, req: CleanQuestionRequest, _: dict = Depends(require_auth)):
    """
    Use NVIDIA Nemotron to distil a raw question prompt:
    - Remove OCR noise, redundant preamble, irrelevant context
    - Keep ONLY what the student needs to solve the problem
    - Rewrite math clearly using LaTeX $...$ delimiters
    Returns { clean: str }
    """
    check_prompt(req.prompt, "prompt")
    check_prompt(req.context, "context")
    try:
        result = await ai_svc.clean_question(req.prompt, req.context)
        # ── Safety Guard ──────────────────────────────────────────────────
        safe_clean = await _with_safety_check(
            result,
            user_message=req.prompt,
            endpoint="/ai/clean-question",
            request=request,
        )
        # ──────────────────────────────────────────────────────────────────
        return {"clean": safe_clean}
    except Exception as e:
        raise HTTPException(status_code=502, detail=str(e))




@app.post("/ai/note-upload")
@limiter.limit("3/minute")
async def ai_note_from_file(request: Request, file: UploadFile = File(...), _: dict = Depends(require_auth)):
    """
    Synthesize a PDF or image into a structured study note.
    """
    try:
        content  = await check_upload(file, max_bytes=20 * 1024 * 1024)
        mime     = file.content_type or "application/octet-stream"
        fname    = file.filename or "upload"

        # ── Safety Guard file safety check ──────────────────────────────────
        from app.services import content_guard as guard_svc
        file_safety = guard_svc.check_file_safety(fname, content, mime)
        if not file_safety.get("safe", True):
            raise HTTPException(
                status_code=400,
                detail=file_safety.get("reason", "File failed safety check"),
            )

        if mime == "application/pdf" or fname.lower().endswith(".pdf"):
            raw_text = await ai_svc.extract_pdf_text(content)
            source_type = "PDF document"
        elif mime.startswith("image/"):
            # Use vision to describe image content first
            import base64
            b64 = base64.b64encode(content).decode()
            raw_text = await ai_svc.describe_drawing(b64)
            source_type = "image"
        else:
            raw_text = content.decode("utf-8", errors="replace")
            source_type = "text document"

        if not raw_text.strip():
            raise HTTPException(status_code=422, detail="Could not extract text from file.")

        # ── PII Filter: strip personal info before sending to AI provider ──
        safe_text = pii_svc.strip_pii(raw_text)
        # ─────────────────────────────────────────────────────────────────
        result = await ai_svc.synthesize_note(safe_text, source_type=source_type, source_title=fname)
        # Generate diagrams (best-effort)
        try:
            result["diagrams"] = await ai_svc.generate_note_diagrams(result)
        except Exception:
            result["diagrams"] = []
        return result
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=502, detail=str(e))


@app.post("/ai/feynman")
@limiter.limit("3/minute")
async def ai_feynman(
    request: Request,
    audio: UploadFile = File(...),
    note_title: str = Form(""),
    key_concepts: str = Form("[]"),
    subject: str = Form(""),
    auth: dict = Depends(require_auth),
):
    """
    Feynman technique evaluator.
    1. Transcribes audio with Groq Whisper
    2. AI plays a 5-year-old: reacts, asks questions, scores the explanation
    Returns {reaction, questions, score, score_reason, gaps, transcript}
    """
    check_prompt(note_title, "note_title")
    import json as _json
    try:
        audio_bytes = await check_upload(audio, max_bytes=25 * 1024 * 1024)

        transcript = await ai_svc.transcribe_audio(
            audio_bytes, audio.filename or "recording.webm"
        )
        if not transcript.strip():
            raise HTTPException(
                status_code=422,
                detail="Couldn't make out any speech — try speaking louder or closer to the mic."
            )

        try:
            concepts = _json.loads(key_concepts)
        except Exception:
            concepts = []

        result = await ai_svc.feynman_evaluate(transcript, note_title, concepts)
        result["transcript"] = transcript
        # ── Safety Guard ──────────────────────────────────────────────────
        if result.get("reaction"):
            result["reaction"] = await _with_safety_check(
                result["reaction"],
                user_message=note_title,
                endpoint="/ai/feynman",
                auth=auth,
            )
        # questions is a list[str] — check each question individually
        if result.get("questions") and isinstance(result["questions"], list):
            checked_questions = []
            for q_text in result["questions"]:
                if isinstance(q_text, str):
                    checked = await _with_safety_check(
                        q_text,
                        user_message=note_title,
                        endpoint="/ai/feynman",
                        auth=auth,
                    )
                    checked_questions.append(checked)
                else:
                    checked_questions.append(q_text)
            result["questions"] = checked_questions
        # ──────────────────────────────────────────────────────────────────

        # Feed the personalization profile: gaps the 5-year-old persona
        # flagged are exactly "lỗ hổng tự phát hiện khi giảng lại" — the
        # student's OWN re-explanation revealed them, not a quiz. A low
        # self-rated score (out of 10) is a "not yet understood" signal.
        try:
            from app.services import mastery_profile as mp_svc
            uid = _uid(auth)
            gaps = result.get("gaps") or []
            score = result.get("score")
            if uid and concepts:
                for concept in concepts[:3]:
                    for _ in range(len(gaps)):
                        mp_svc.record_event(uid, concept, subject or "other", "self_discovered_gap")
                    if isinstance(score, (int, float)) and score < 5:
                        mp_svc.record_event(uid, concept, subject or "other", "not_understood")
        except Exception:
            pass

        return result
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=502, detail=str(e))


@app.post("/ai/topic-map")
@limiter.limit("3/minute")
async def ai_topic_map(request: Request, req: TopicMapRequest, _: dict = Depends(require_auth)):
    """
    Convert a topic into an Obsidian-style knowledge node map.
    Returns { topic, nodes: [{id, label, type, description}], edges: [{source, target, label}] }
    """
    check_prompt(req.topic, "topic")
    if not req.topic.strip():
        raise HTTPException(status_code=400, detail="topic cannot be empty")
    try:
        result = await ai_svc.topic_to_nodemap(req.topic.strip())
        # ── Safety Guard: check summary/definition fields ─────────────────
        for node in result.get("nodes", []):
            desc = node.get("description", "")
            if desc:
                node["description"] = await _with_safety_check(
                    desc,
                    user_message=req.topic,
                    endpoint="/ai/topic-map",
                    request=request,
                )
        # ──────────────────────────────────────────────────────────────────
        return result
    except Exception as e:
        raise HTTPException(status_code=502, detail=str(e))


class RoadmapRequest(BaseModel):
    topic: str
    # Onboarding answers, passed straight from the frontend (localStorage) —
    # not persisted server-side, see lib/onboarding.ts. Optional so the
    # roadmap still works (with a neutral 1/3-1/3-1/3 style split) for a
    # user who skipped onboarding.
    q1_goal: str = ""          # "What is your main learning goal?"
    q3_hours: str = ""         # "How many hours do you study per week?"
    q7_learning_style: list[str] = []   # "How do you like to learn?"


@app.post("/ai/roadmap")
@limiter.limit("3/minute")
async def ai_roadmap(request: Request, req: RoadmapRequest, auth: dict = Depends(require_auth)):
    """
    DeepSeek-generated learning roadmap for a target topic — prerequisites
    + a sequenced path, blended across top-down/bottom-up/just-in-time
    styles by the student's measured fit (mastery_profile.py). Shown in
    Nexus (e.g. "want to learn quantum mechanics? here's what to shore up
    first, and in what order").
    """
    check_prompt(req.topic, "topic")
    if not req.topic.strip():
        raise HTTPException(status_code=400, detail="topic cannot be empty")
    uid = _uid(auth)
    try:
        from app.services import mastery_profile as mp_svc
        learning_style = mp_svc.derive_learning_style_fit(uid, req.q7_learning_style) if uid else \
            {"top_down_pct": 34, "bottom_up_pct": 33, "just_in_time_pct": 33}
        study_mode = mp_svc.derive_study_mode(req.q1_goal, req.q3_hours)
        needs_attention = mp_svc.get_full_profile(uid)["needs_attention"] if uid else []

        result = await ai_svc.generate_roadmap(req.topic.strip(), learning_style, study_mode, needs_attention)
        result["learning_style"] = learning_style
        result["study_mode"] = study_mode
        # ── Safety Guard ──────────────────────────────────────────────────
        for step in result.get("roadmap_steps", []):
            desc = step.get("description", "")
            if desc:
                step["description"] = await _with_safety_check(
                    desc,
                    user_message=req.topic,
                    endpoint="/ai/roadmap",
                    request=request,
                )
        # ──────────────────────────────────────────────────────────────────
        return result
    except Exception as e:
        raise HTTPException(status_code=502, detail=str(e))


# ── Personalization profile ───────────────────────────────────────────────
# The shared store every AI feature reads/writes — see
# app/services/mastery_profile.py for the full design. Endpoints that
# generate an AI response with clean concept context (mastery check,
# grading, Feynman) record events directly in their own handlers above;
# these generic endpoints exist for signals that never otherwise reach the
# backend (Mistake Bank entries, community activity, daily study focus —
# all currently client-side/localStorage only).

from app.services.mastery_profile import EVENT_COLUMNS as _PROFILE_EVENT_COLUMNS
_PROFILE_EVENT_TYPES = set(_PROFILE_EVENT_COLUMNS.keys())


class ProfileEventRequest(BaseModel):
    concept: str
    subject: str = "other"
    event_type: str   # one of mastery_profile.EVENT_COLUMNS keys


class ProfileSubjectActivityRequest(BaseModel):
    subject: str
    kind: str = "study"   # 'community' kind retired along with the Community feature


class ProfileBaselineRequest(BaseModel):
    concept: str
    subject: str = "other"
    score: int   # 1-20


@app.post("/profile/event")
@limiter.limit("60/minute")
async def profile_record_event(request: Request, req: ProfileEventRequest, auth: dict = Depends(require_auth)):
    """Record one raw personalization signal for (concept). See
    mastery_profile.EVENT_COLUMNS for the full list of event_type values."""
    if req.event_type not in _PROFILE_EVENT_TYPES:
        raise HTTPException(status_code=400, detail=f"event_type must be one of {sorted(_PROFILE_EVENT_TYPES)}")
    check_prompt(req.concept, "concept")
    uid = _uid(auth)
    if not uid:
        raise HTTPException(status_code=401, detail="Unauthorized")
    from app.services import mastery_profile as mp_svc
    mp_svc.record_event(uid, req.concept.strip().lower(), req.subject, req.event_type)
    return {"ok": True}


@app.post("/profile/baseline")
@limiter.limit("30/minute")
async def profile_record_baseline(request: Request, req: ProfileBaselineRequest, auth: dict = Depends(require_auth)):
    """Set/refresh the pre-learning proficiency baseline for a concept (1-20)."""
    check_prompt(req.concept, "concept")
    uid = _uid(auth)
    if not uid:
        raise HTTPException(status_code=401, detail="Unauthorized")
    from app.services import mastery_profile as mp_svc
    mp_svc.record_baseline(uid, req.concept.strip().lower(), req.subject, req.score)
    return {"ok": True}


@app.post("/profile/subject-activity")
@limiter.limit("60/minute")
async def profile_subject_activity(request: Request, req: ProfileSubjectActivityRequest, auth: dict = Depends(require_auth)):
    """Record a study event for a subject — feeds the love/fear bars (see
    mastery_profile.get_subject_affinity)."""
    if req.kind != "study":
        raise HTTPException(status_code=400, detail="kind must be 'study'")
    uid = _uid(auth)
    if not uid:
        raise HTTPException(status_code=401, detail="Unauthorized")
    from app.services import mastery_profile as mp_svc
    mp_svc.record_subject_activity(uid, req.subject, req.kind)
    return {"ok": True}


@app.get("/profile/full")
@limiter.limit("30/minute")
async def profile_get_full(request: Request, auth: dict = Depends(require_auth)):
    """The complete shared personalization store for the current user —
    every AI feature should fetch this before responding."""
    uid = _uid(auth)
    if not uid:
        raise HTTPException(status_code=401, detail="Unauthorized")
    from app.services import mastery_profile as mp_svc
    return mp_svc.get_full_profile(uid)


@app.get("/profile/concept/{concept}")
@limiter.limit("60/minute")
async def profile_get_concept(request: Request, concept: str, auth: dict = Depends(require_auth)):
    """Bars + derived AI tuning for a single concept (null fields until any
    signal has been recorded for it)."""
    uid = _uid(auth)
    if not uid:
        raise HTTPException(status_code=401, detail="Unauthorized")
    from app.services import mastery_profile as mp_svc
    profile = mp_svc.get_concept_profile(uid, concept.strip().lower())
    return profile or {"concept": concept, "subject": "other", "baseline_proficiency_bar": 10,
                        "confusion_frequency_bar": 1, "knowledge_gap_bar": 1, "not_understood_bar": 1,
                        "questions_asked_bar": 1, "self_discovered_gap_bar": 1, "voiced_uncertainty_bar": 1,
                        "question_frequency_bar": 1,
                        "teaching_style": {"baby_mode_pct": 100, "cross_subject_link_pct": 0, "reverse_hypothesis_pct": 0},
                        "raw": {}}


# ── Quanta — XP-like points for learning activity ────────────────────────────

class QuantaAwardRequest(BaseModel):
    event_type: str
    context: str = ""


@app.post("/quanta/award")
@limiter.limit("30/minute")
async def quanta_award(request: Request, req: QuantaAwardRequest, auth: dict = Depends(require_auth)):
    """Client-reported events only (e.g. a new mind map was saved) — the
    point amount is always looked up server-side from quanta.POINT_RULES,
    never accepted from the request, so a client can't award itself for a
    fabricated grade or AI review (those are awarded from trusted
    server-side code paths, not this endpoint)."""
    from app.services import quanta as quanta_svc
    if req.event_type not in quanta_svc.CLIENT_AWARDABLE_EVENTS:
        raise HTTPException(status_code=400, detail=f"event_type must be one of {sorted(quanta_svc.CLIENT_AWARDABLE_EVENTS)}")
    uid = _uid(auth)
    if not uid:
        raise HTTPException(status_code=401, detail="Unauthorized")
    event_key = f"{uid}|{req.event_type}|{req.context}" if req.context else None
    return quanta_svc.award(uid, req.event_type, context=req.context, event_key=event_key)


@app.get("/quanta/me")
@limiter.limit("30/minute")
async def quanta_me(request: Request, auth: dict = Depends(require_auth)):
    uid = _uid(auth)
    if not uid:
        raise HTTPException(status_code=401, detail="Unauthorized")
    from app.services import quanta as quanta_svc
    return quanta_svc.get_profile(uid)


# ── ARI S2S Voice Proxy (Gemini Live API) ────────────────────────────────────

@app.websocket("/ws/s2s")
async def s2s_proxy(websocket: WebSocket):
    """
    Bidirectional WebSocket proxy: browser ↔ backend ↔ Gemini Live BidiGenerateContent.
    The client sends JSON frames (setup + realtimeInput), the backend forwards them
    to Gemini and streams audio/transcript chunks back unchanged.
    """
    await websocket.accept()

    api_key = settings.google_api_key
    if not api_key:
        await websocket.send_text(_json.dumps({"error": "GOOGLE_API_KEY not configured on server"}))
        await websocket.close(code=1011)
        return

    gemini_url = f"{_GEMINI_LIVE_URL}?key={api_key}"
    try:
        async with _ws.connect(gemini_url, ping_interval=20, ping_timeout=20) as gemini_ws:

            async def client_to_gemini():
                try:
                    while True:
                        msg = await websocket.receive_text()
                        await gemini_ws.send(msg)
                except (WebSocketDisconnect, Exception):
                    # Client disconnected — close the Gemini side too
                    try:
                        await gemini_ws.close()
                    except Exception:
                        pass

            async def gemini_to_client():
                try:
                    async for msg in gemini_ws:
                        if isinstance(msg, bytes):
                            msg = msg.decode()
                        await websocket.send_text(msg)
                except Exception:
                    pass

            await asyncio.gather(
                client_to_gemini(),
                gemini_to_client(),
                return_exceptions=True,
            )

    except Exception as e:
        _s2s_logger.error(f"S2S Proxy error: {e}")
        err_str = str(e)
        try:
            await websocket.send_text(_json.dumps({"error": err_str}))
        except Exception:
            pass
        try:
            await websocket.close(code=1011, reason=err_str[:120])
        except Exception:
            pass
