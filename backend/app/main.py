from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException, UploadFile, File, Form, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.util import get_remote_address
from slowapi.errors import RateLimitExceeded
from pydantic import BaseModel

from app.core.config import settings

# ── Rate limiter ─────────────────────────────────────────────────────────────
limiter = Limiter(key_func=get_remote_address)
from app.services import ai         as ai_svc
from app.services import finetune_db as ft_svc
from app.routers  import admin      as admin_router


@asynccontextmanager
async def lifespan(_app: FastAPI):
    ft_svc.init_db()          # create SQLite tables if not present

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
app.include_router(admin_router.router)

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


# ── AI endpoints ──────────────────────────────────────────────────────────────

class ChatRequest(BaseModel):
    messages: list[dict]
    model: str | None = None
    temperature: float = 0.7
    max_tokens: int = 2048


class HintRequest(BaseModel):
    problem: str
    level: int = 1   # 1 = vague, 2 = name concept, 3 = first step


class MasteryRequest(BaseModel):
    problem: str
    solution: str


class DecomposeRequest(BaseModel):
    pset_text: str


class TopicMapRequest(BaseModel):
    topic: str


@app.post("/ai/chat")
async def ai_chat(req: ChatRequest):
    """Raw chat call — pass messages directly to Ollama (qwq:32b)."""
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


@app.post("/ai/hint")
async def ai_hint(req: HintRequest):
    """Return a Socratic hint for a problem at level 1–3."""
    try:
        hint = await ai_svc.get_hint(req.problem, req.level)
        return {"hint": hint}
    except Exception as e:
        raise HTTPException(status_code=502, detail=str(e))


@app.post("/ai/decompose")
async def ai_decompose(req: DecomposeRequest):
    """Decompose a problem set into a reasoning tree."""
    try:
        result = await ai_svc.decompose_pset(req.pset_text)
        return result
    except Exception as e:
        raise HTTPException(status_code=502, detail=str(e))


@app.post("/ai/mastery")
async def ai_mastery(req: MasteryRequest):
    """Evaluate a student's solution and return mastery delta."""
    try:
        result = await ai_svc.check_mastery(req.problem, req.solution)
        return result
    except Exception as e:
        raise HTTPException(status_code=502, detail=str(e))


class GradeItem(BaseModel):
    id: str
    prompt: str
    answer: str

class GradeAllRequest(BaseModel):
    questions: list[GradeItem]

class OnboardingRequest(BaseModel):
    answers: dict[str, str]   # {question_id: answer}


@app.post("/ai/onboarding-analyze")
async def ai_onboarding_analyze(req: OnboardingRequest):
    """
    Analyze onboarding answers with Meta Llama 3.1 70B orchestrator
    and return the recommended pricing plan.
    Returns {recommended_plan_id, plan_name, reasoning, alternatives}
    """
    if not req.answers:
        raise HTTPException(status_code=400, detail="answers cannot be empty")
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

class GradeDualRequest(BaseModel):
    questions: list[GradeDualItem]

class AnalyzePageRequest(BaseModel):
    page_data: str    # base64 JPEG
    page_index: int
    total_pages: int

@app.post("/ai/analyze-page")
async def ai_analyze_page(req: AnalyzePageRequest):
    """Analyze a single PDF page on demand (progressive loading). Returns {problems:[...]}."""
    try:
        pg = {"index": req.page_index, "data": req.page_data, "width": 0, "height": 0}
        problems = await ai_svc._analyze_one_page(pg, req.total_pages)
        return {"problems": problems}
    except Exception as e:
        raise HTTPException(status_code=502, detail=str(e))


@app.post("/ai/grade-dual")
async def ai_grade_dual(req: GradeDualRequest):
    """
    Dual-AI grading:
    - Meta Llama (Groq): grades answers + transcribes handwriting from canvas images
    - Gemma (NVIDIA): generates study suggestions for wrong answers
    Returns {grades:[{id,passed,feedback,suggestions?}]}
    """
    try:
        items = [
            {"id": q.id, "prompt": q.prompt, "answer": q.answer, "image_b64": q.image_b64}
            for q in req.questions
        ]
        result = await ai_svc.grade_dual(items)
        return result
    except Exception as e:
        raise HTTPException(status_code=502, detail=str(e))


class ModerateCommunityRequest(BaseModel):
    rooms: list[dict] = []
    messages: list[dict] = []

@app.post("/ai/moderate-community")
async def ai_moderate_community(req: ModerateCommunityRequest):
    """
    Weekly AI moderation — Meta Llama 70B reviews rooms and messages.
    Archives low-engagement/off-topic rooms, flags inappropriate messages.
    """
    try:
        result = await ai_svc.moderate_community(req.rooms, req.messages)
        return result
    except Exception as e:
        raise HTTPException(status_code=502, detail=str(e))


@app.post("/ai/grade-all")
async def ai_grade_all(req: GradeAllRequest):
    """Batch-grade all answers in one Groq call. Returns {grades:[{id,passed,feedback}]}."""
    try:
        items = [{"id": q.id, "prompt": q.prompt, "answer": q.answer} for q in req.questions]
        result = await ai_svc.grade_all(items)
        return result
    except Exception as e:
        raise HTTPException(status_code=502, detail=str(e))


@app.post("/ai/gemini")
async def ai_gemini(req: ChatRequest):
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
async def ai_upload_pset(file: UploadFile = File(...)):
    """
    Upload a PDF or PNG/JPG image containing a problem set.
    Extracts text (PDF) or uses vision OCR (images), then decomposes into question cards.
    Returns { summary, problems: [{id, title, prompt, difficulty, concepts}], source_file }
    """
    try:
        content  = await file.read()
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
async def ai_tool_map_validate(req: ToolMapValidateRequest):
    """
    Validate a student's INPUT → TOOL → OUTPUT map using Google Gemini.
    Returns { verdict, feedback, correct: [...], issues: [...], missing: [...], suggestions: [...] }
    """
    if not req.tools:
        raise HTTPException(status_code=400, detail="Add at least one tool/step")
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
async def ai_describe_drawing(req: DrawingRequest):
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
async def ai_node_summary(req: NodeSummaryRequest):
    """
    Fast Groq summary for a single knowledge graph node.
    Returns {definition, equations, example, key_insight, formula_display}
    """
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
async def ai_clean_question(req: CleanQuestionRequest):
    """
    Use NVIDIA Nemotron to distil a raw question prompt:
    - Remove OCR noise, redundant preamble, irrelevant context
    - Keep ONLY what the student needs to solve the problem
    - Rewrite math clearly using LaTeX $...$ delimiters
    Returns { clean: str }
    """
    try:
        result = await ai_svc.clean_question(req.prompt, req.context)
        return {"clean": result}
    except Exception as e:
        raise HTTPException(status_code=502, detail=str(e))


class NoteRequest(BaseModel):
    url: str          # YouTube URL
    title: str = ""   # optional override

class NoteTextRequest(BaseModel):
    content: str
    source_type: str = "text"
    title: str = ""


@app.post("/ai/note")
@limiter.limit("10/minute")
async def ai_note_from_url(request: Request, req: NoteRequest):
    """
    Synthesize a YouTube video into a structured study note.
    Returns { title, tldr, summary, key_concepts, socratic_questions, key_insight }
    """
    try:
        yt = await ai_svc.get_youtube_content(req.url)
        content = yt["content"]
        title   = yt.get("title") or req.url
        vid_id  = yt.get("video_id", "")

        result = await ai_svc.synthesize_note(content, source_type="YouTube video", source_title=title)

        # If AI synthesis failed, return raw transcript as a basic note instead of an error
        if result.get("error"):
            snippet = content[:600].strip()
            result = {
                "title": f"📝 {title}",
                "tldr": "Transcript extracted — AI synthesis unavailable.",
                "summary": content[:4000],
                "key_concepts": [],
                "socratic_questions": [],
                "key_insight": snippet + ("…" if len(content) > 600 else ""),
                "source_type": "YouTube video",
                "video_id": vid_id,
                "diagrams": [],
            }
        else:
            result["video_id"] = vid_id
            # Skip diagrams for YouTube — no visual source content
            result["diagrams"] = []

        return result
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=502, detail=str(e))


@app.post("/ai/note-upload")
@limiter.limit("10/minute")
async def ai_note_from_file(request: Request, file: UploadFile = File(...)):
    """
    Synthesize a PDF or image into a structured study note.
    """
    try:
        content  = await file.read()
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
):
    """
    Feynman technique evaluator.
    1. Transcribes audio with Groq Whisper
    2. AI plays a 5-year-old: reacts, asks questions, scores the explanation
    Returns {reaction, questions, score, score_reason, gaps, transcript}
    """
    import json as _json
    try:
        audio_bytes = await audio.read()
        if not audio_bytes:
            raise HTTPException(status_code=422, detail="Empty audio file")

        transcript = await ai_svc.transcribe_audio(
            audio_bytes, audio.filename or "recording.webm"
        )
        if not transcript.strip():
            raise HTTPException(
                status_code=422,
                detail="Không nhận ra giọng nói — thử nói to hơn hoặc gần mic hơn"
            )

        try:
            concepts = _json.loads(key_concepts)
        except Exception:
            concepts = []

        result = await ai_svc.feynman_evaluate(transcript, note_title, concepts)
        result["transcript"] = transcript
        return result
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=502, detail=str(e))


@app.post("/ai/topic-map")
async def ai_topic_map(req: TopicMapRequest):
    """
    Convert a topic into an Obsidian-style knowledge node map.
    Returns { topic, nodes: [{id, label, type, description}], edges: [{source, target, label}] }
    """
    if not req.topic.strip():
        raise HTTPException(status_code=400, detail="topic cannot be empty")
    try:
        result = await ai_svc.topic_to_nodemap(req.topic.strip())
        return result
    except Exception as e:
        raise HTTPException(status_code=502, detail=str(e))
