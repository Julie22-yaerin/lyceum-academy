from contextlib import asynccontextmanager
import asyncio
import base64
import json as _json
import logging

from fastapi import FastAPI, HTTPException, UploadFile, File, Form, Request, Depends, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import JSONResponse, Response
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.util import get_remote_address
from slowapi.errors import RateLimitExceeded
from starlette.middleware.base import BaseHTTPMiddleware
from pydantic import BaseModel
import websockets as _ws

from app.core.config import settings
from app.api.deps import require_auth
from app.services.content_safety import check_prompt, check_messages, check_upload

_s2s_logger = logging.getLogger("pclick.s2s")

_GEMINI_LIVE_URL = (
    "wss://generativelanguage.googleapis.com"
    "/ws/google.ai.generativelanguage.v1beta"
    ".GenerativeService.BidiGenerateContent"
)


# ── Per-user rate limiting key ────────────────────────────────────────────────
def get_user_key(request: Request) -> str:
    """Rate limit by Firebase UID when authenticated, else fall back to IP."""
    auth = request.headers.get("Authorization", "")
    if auth.startswith("Bearer "):
        token = auth[7:].strip()
        try:
            # Decode payload without signature verification — just need the UID.
            # Verification is handled by require_auth; here we only need the key.
            parts = token.split(".")
            if len(parts) == 3:
                payload_b64 = parts[1]
                padding = (4 - len(payload_b64) % 4) % 4
                payload_bytes = base64.urlsafe_b64decode(payload_b64 + "=" * padding)
                payload_data = _json.loads(payload_bytes)
                uid = payload_data.get("user_id") or payload_data.get("sub") or ""
                if uid and len(uid) > 4:
                    return f"uid:{uid}"
        except Exception:
            pass
    return get_remote_address(request)


def _uid(payload: dict) -> str:
    """Firebase UID from a require_auth-verified token payload, for scoping
    the personalization profile (app/services/mastery_profile.py)."""
    return payload.get("user_id") or payload.get("sub") or ""


def _record_grade_results(uid: str, items: list, grades: list[dict]) -> None:
    """Feed the personalization profile from a batch grading result — never
    blocks the actual response. `items` is the request's question list
    (each with .id/.concepts/.subject); `grades` is [{id, passed, ...}]."""
    if not uid:
        return
    try:
        from app.services import mastery_profile as mp_svc
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
    except Exception:
        pass


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


# ── Rate limiter ─────────────────────────────────────────────────────────────
limiter = Limiter(key_func=get_user_key)
from app.services import ai         as ai_svc
from app.services import finetune_db as ft_svc
from app.routers  import admin      as admin_router
from app.routers  import auth       as auth_router


@asynccontextmanager
async def lifespan(_app: FastAPI):
    ft_svc.init_db()          # create SQLite tables if not present
    from app.services import activity_log as activity_log_svc
    activity_log_svc.init_db()
    from app.services import mastery_profile as mastery_profile_svc
    mastery_profile_svc.init_db()

    # Pre-warm the embedding model so the first upload doesn't time out.
    # all-MiniLM-L6-v2 (~80 MB) is downloaded from HuggingFace on first run.
    import logging
    logger = logging.getLogger("pclick.startup")
    logger.info("Loading embedding model (may download ~80 MB on first run)…")
    try:
        import asyncio
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

    yield


app = FastAPI(title=settings.app_name, lifespan=lifespan)
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)
app.add_middleware(SecurityHeadersMiddleware)
app.add_middleware(BodySizeLimitMiddleware)
# Compress JSON responses >1KB — note/pset analysis payloads are often 50-200KB
# of text, so this is a large win for load time and egress under load.
app.add_middleware(GZipMiddleware, minimum_size=1024)
app.include_router(admin_router.router)
app.include_router(auth_router.router)

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

@app.get("/health/live")
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
    headers = {"User-Agent": "LyceumAcademy/1.0 (https://lyceum-academy.vercel.app) httpx"}
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


# ── AI endpoints ──────────────────────────────────────────────────────────────

class ChatRequest(BaseModel):
    messages: list[dict]
    model: str | None = None
    temperature: float = 0.7
    max_tokens: int = 2048


class VoiceFallbackRequest(BaseModel):
    messages: list[dict]
    system_instruction: str = ""


class HintRequest(BaseModel):
    problem: str
    level: int = 1   # 1 = vague, 2 = name concept, 3 = first step


class MasteryRequest(BaseModel):
    problem: str
    solution: str
    concepts: list[str] = []   # feeds the personalization profile — see app/services/mastery_profile.py
    subject: str = ""


class DecomposeRequest(BaseModel):
    pset_text: str


class TopicMapRequest(BaseModel):
    topic: str


@app.post("/ai/chat")
@limiter.limit("10/minute")
async def ai_chat(request: Request, req: ChatRequest, _: dict = Depends(require_auth)):
    """Raw chat call — pass messages directly to Ollama (qwq:32b)."""
    check_messages(req.messages)
    try:
        resp = await ai_svc.chat(
            req.messages,
            model=req.model,
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


@app.post("/ai/voice-fallback")
@limiter.limit("20/minute")
async def ai_voice_fallback(request: Request, req: VoiceFallbackRequest, _: dict = Depends(require_auth)):
    """Text-based GPT fallback for ARI when the Gemini Live WS session is down."""
    check_messages(req.messages)
    try:
        text = await ai_svc.voice_fallback_chat(req.messages, req.system_instruction)
        return {"text": text}
    except Exception as e:
        raise HTTPException(status_code=502, detail=str(e))


@app.post("/ai/hint")
@limiter.limit("20/minute")
async def ai_hint(request: Request, req: HintRequest, _: dict = Depends(require_auth)):
    """Return a Socratic hint for a problem at level 1–3."""
    check_prompt(req.problem, "problem")
    try:
        hint = await ai_svc.get_hint(req.problem, req.level)
        return {"hint": hint}
    except Exception as e:
        raise HTTPException(status_code=502, detail=str(e))


@app.post("/ai/decompose")
@limiter.limit("10/minute")
async def ai_decompose(request: Request, req: DecomposeRequest, _: dict = Depends(require_auth)):
    """Decompose a problem set into a reasoning tree."""
    check_prompt(req.pset_text, "pset_text")
    try:
        result = await ai_svc.decompose_pset(req.pset_text)
        return result
    except Exception as e:
        raise HTTPException(status_code=502, detail=str(e))


@app.post("/ai/mastery")
@limiter.limit("20/minute")
async def ai_mastery(request: Request, req: MasteryRequest, auth: dict = Depends(require_auth)):
    """Evaluate a student's solution and return mastery delta."""
    check_prompt(req.problem, "problem")
    check_prompt(req.solution, "solution")
    try:
        result = await ai_svc.check_mastery(req.problem, req.solution)
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
        return result
    except Exception as e:
        raise HTTPException(status_code=502, detail=str(e))


class GradeItem(BaseModel):
    id: str
    prompt: str
    answer: str
    concepts: list[str] = []   # feeds the personalization profile
    subject: str = ""

class GradeAllRequest(BaseModel):
    questions: list[GradeItem]

class OnboardingRequest(BaseModel):
    answers: dict[str, str]   # {question_id: answer}


@app.post("/ai/onboarding-analyze")
@limiter.limit("10/minute")
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
        result = await ai_svc.analyze_onboarding(req.answers)
        return result
    except Exception as e:
        raise HTTPException(status_code=502, detail=str(e))


class GradeDualItem(BaseModel):
    id: str
    prompt: str
    answer: str
    image_b64: str | None = None   # base64 PNG from canvas (handwriting)
    concepts: list[str] = []   # feeds the personalization profile
    subject: str = ""

class GradeDualRequest(BaseModel):
    questions: list[GradeDualItem]

class AnalyzePageRequest(BaseModel):
    page_data: str    # base64 JPEG
    page_index: int
    total_pages: int

@app.post("/ai/analyze-page")
@limiter.limit("5/minute")
async def ai_analyze_page(request: Request, req: AnalyzePageRequest, _: dict = Depends(require_auth)):
    """Analyze a single PDF page on demand (progressive loading). Returns {problems:[...]}."""
    try:
        pg = {"index": req.page_index, "data": req.page_data, "width": 0, "height": 0}
        problems = await ai_svc._analyze_one_page(pg, req.total_pages)
        return {"problems": problems}
    except Exception as e:
        raise HTTPException(status_code=502, detail=str(e))


@app.post("/ai/grade-dual")
@limiter.limit("5/minute")
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
        return result
    except Exception as e:
        raise HTTPException(status_code=502, detail=str(e))




@app.post("/ai/grade-all")
@limiter.limit("10/minute")
async def ai_grade_all(request: Request, req: GradeAllRequest, auth: dict = Depends(require_auth)):
    """Batch-grade all answers in one Groq call. Returns {grades:[{id,passed,feedback}]}."""
    for q in req.questions:
        check_prompt(q.prompt, "prompt")
        check_prompt(q.answer, "answer")
    try:
        items = [{"id": q.id, "prompt": q.prompt, "answer": q.answer} for q in req.questions]
        result = await ai_svc.grade_all(items)
        _record_grade_results(_uid(auth), req.questions, result.get("grades", []))
        return result
    except Exception as e:
        raise HTTPException(status_code=502, detail=str(e))


@app.post("/ai/gemini")
@limiter.limit("10/minute")
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
@limiter.limit("5/minute")
async def ai_upload_pset(request: Request, file: UploadFile = File(...), _: dict = Depends(require_auth)):
    """
    Upload a PDF or PNG/JPG image containing a problem set.
    Extracts text (PDF) or uses vision OCR (images), then decomposes into question cards.
    Returns { summary, problems: [{id, title, prompt, difficulty, concepts}], source_file }
    """
    try:
        content  = await check_upload(file, max_bytes=10 * 1024 * 1024)
        mime     = file.content_type or "application/octet-stream"
        fname    = file.filename or "upload"
        result   = await ai_svc.analyze_file_pset(content, fname, mime)
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
@limiter.limit("20/minute")
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
@limiter.limit("10/minute")
async def ai_describe_drawing(request: Request, req: DrawingRequest, _: dict = Depends(require_auth)):
    """Use Gemini vision to transcribe a student's whiteboard drawing."""
    try:
        text = await ai_svc.describe_drawing(req.image)
        return {"text": text}
    except Exception as e:
        raise HTTPException(status_code=502, detail=str(e))


class NodeSummaryRequest(BaseModel):
    label: str
    node_type: str = "concept"
    description: str = ""
    connections: list[str] = []


@app.post("/ai/node-summary")
@limiter.limit("30/minute")
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
        return result
    except Exception as e:
        raise HTTPException(status_code=502, detail=str(e))


class CleanQuestionRequest(BaseModel):
    prompt: str
    context: str = ""   # optional: surrounding text / problem set title


@app.post("/ai/clean-question")
@limiter.limit("20/minute")
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
        return {"clean": result}
    except Exception as e:
        raise HTTPException(status_code=502, detail=str(e))




@app.post("/ai/note-upload")
@limiter.limit("10/minute")
async def ai_note_from_file(request: Request, file: UploadFile = File(...), _: dict = Depends(require_auth)):
    """
    Synthesize a PDF or image into a structured study note.
    """
    try:
        content  = await check_upload(file, max_bytes=20 * 1024 * 1024)
        mime     = file.content_type or "application/octet-stream"
        fname    = file.filename or "upload"

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

        result = await ai_svc.synthesize_note(raw_text, source_type=source_type, source_title=fname)
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
@limiter.limit("5/minute")
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
@limiter.limit("10/minute")
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
@limiter.limit("10/minute")
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
