"""
Admin API router — RAG knowledge base management + fine-tuning examples.

All endpoints require the X-Admin-Token header matching ADMIN_SECRET env var.
"""

from __future__ import annotations
import io
import os
from typing import Optional

from fastapi import APIRouter, Depends, Header, HTTPException, UploadFile, File, Form
from fastapi.responses import PlainTextResponse
from pydantic import BaseModel

from app.services import rag             as rag_svc
from app.services import finetune_db     as ft_svc
from app.services import openai_finetune as ft_openai
from app.services.firebase_auth import verify_firebase_id_token

router      = APIRouter(prefix="/admin", tags=["admin"])
ADMIN_TOKEN = os.getenv("ADMIN_SECRET", "pclick-admin-dev")


# ── Auth dependency ───────────────────────────────────────────────────────────
# Accepts either:
#   • the static ADMIN_SECRET dev token   (fast, no network call)
#   • a valid Firebase ID token            (SSO from main app on :3000)

async def _auth(x_admin_token: Optional[str] = Header(None)):
    if not x_admin_token:
        raise HTTPException(status_code=401, detail="Unauthorized")
    if x_admin_token == ADMIN_TOKEN:
        return  # dev token — always accept
    # Try as a Firebase ID token (SSO from the Next.js app)
    try:
        await verify_firebase_id_token(x_admin_token)
    except HTTPException:
        raise HTTPException(status_code=401, detail="Unauthorized")


# ── RAG — document management ─────────────────────────────────────────────────

@router.get("/rag/documents")
def rag_list(_: None = Depends(_auth)):
    """List all indexed documents."""
    return rag_svc.list_documents()


@router.post("/rag/upload")
async def rag_upload(
    file:    UploadFile = File(...),
    title:   str        = Form(...),
    subject: str        = Form(""),
    _: None = Depends(_auth),
):
    """Upload a document (PDF / TXT / MD), chunk it, and index it."""
    content = await file.read()
    fname   = file.filename or "upload"
    ext     = fname.rsplit(".", 1)[-1].lower() if "." in fname else "txt"

    if ext == "pdf":
        text = _pdf_text(content)
    elif ext in ("txt", "md"):
        text = content.decode("utf-8", errors="ignore")
    elif ext in ("png", "jpg", "jpeg", "webp"):
        text = _image_text(content, title)
    else:
        raise HTTPException(400, f"Unsupported file type '{ext}' — use PDF, TXT, MD, or PNG")

    doc_id = f"{fname}_{abs(hash(content))}"
    meta   = {"title": title, "subject": subject, "file_type": ext, "filename": fname}
    try:
        n = rag_svc.add_document(doc_id, text, meta)
    except RuntimeError as exc:
        # Embedding model not available (torch not installed)
        raise HTTPException(503, f"Embedding model not ready: {exc}")

    return {"doc_id": doc_id, "chunks": n, "title": title, "subject": subject}


@router.delete("/rag/documents/{doc_id:path}")
def rag_delete(doc_id: str, _: None = Depends(_auth)):
    """Delete all chunks for a document by its doc_id."""
    n = rag_svc.delete_document(doc_id)
    return {"deleted_chunks": n}


@router.post("/rag/search")
def rag_search(
    query:   str = "",
    n:       int = 5,
    subject: str = "",
    _: None = Depends(_auth),
):
    """Test semantic search against the indexed knowledge base."""
    return rag_svc.search(query, n=n, subject=subject or None)


# ── Fine-tuning — examples CRUD ───────────────────────────────────────────────

class ExampleIn(BaseModel):
    user_message:    str
    assistant_reply: str
    system_prompt:   str       = ""
    subject:         str       = ""
    tags:            list[str] = []


@router.get("/finetune/stats")
def ft_stats(_: None = Depends(_auth)):
    return ft_svc.stats()


@router.get("/finetune/examples")
def ft_list(subject: Optional[str] = None, _: None = Depends(_auth)):
    return ft_svc.list_all(subject)


@router.post("/finetune/examples", status_code=201)
def ft_create(body: ExampleIn, _: None = Depends(_auth)):
    return ft_svc.create(**body.model_dump())


@router.put("/finetune/examples/{ex_id}")
def ft_update(ex_id: int, body: ExampleIn, _: None = Depends(_auth)):
    result = ft_svc.update(ex_id, **body.model_dump())
    if result is None:
        raise HTTPException(404, "Example not found")
    return result


@router.delete("/finetune/examples/{ex_id}")
def ft_delete(ex_id: int, _: None = Depends(_auth)):
    if not ft_svc.delete(ex_id):
        raise HTTPException(404, "Example not found")
    return {"ok": True}


@router.get("/finetune/export.jsonl", response_class=PlainTextResponse)
def ft_export(_: None = Depends(_auth)):
    """Download all examples as OpenAI-format JSONL for fine-tuning."""
    return ft_svc.export_jsonl()


# ── Fine-tuning — OpenAI job pipeline ────────────────────────────────────────

class SubmitJobIn(BaseModel):
    model_id:   str                            # used as subject prefix: train__{model_id}__
    base_model: str  = "gpt-4o-mini-2024-07-18"
    suffix:     str  = "pclick"


@router.post("/finetune/submit-job")
def ft_submit_job(body: SubmitJobIn, _: None = Depends(_auth)):
    """
    Gather all few-shot examples for model_id, upload to OpenAI,
    and kick off a fine-tuning job.  Returns the OpenAI job object.
    """
    subject_prefix = f"train__{body.model_id}__"
    jsonl = ft_svc.export_jsonl_filtered(subject_prefix)
    if not jsonl.strip():
        raise HTTPException(400, "No training examples found for this model — add some first.")
    try:
        return ft_openai.submit_job(jsonl, body.base_model, body.suffix)
    except RuntimeError as exc:
        raise HTTPException(503, str(exc))
    except Exception as exc:
        raise HTTPException(500, f"OpenAI API error: {exc}")


@router.get("/finetune/jobs")
def ft_list_jobs(_: None = Depends(_auth)):
    """List the 20 most recent OpenAI fine-tuning jobs."""
    try:
        return ft_openai.list_jobs()
    except RuntimeError as exc:
        raise HTTPException(503, str(exc))
    except Exception as exc:
        raise HTTPException(500, f"OpenAI API error: {exc}")


@router.get("/finetune/jobs/{job_id}")
def ft_get_job(job_id: str, _: None = Depends(_auth)):
    """Get current status of a fine-tuning job."""
    try:
        return ft_openai.get_job(job_id)
    except RuntimeError as exc:
        raise HTTPException(503, str(exc))
    except Exception as exc:
        raise HTTPException(500, f"OpenAI API error: {exc}")


@router.delete("/finetune/jobs/{job_id}")
def ft_cancel_job(job_id: str, _: None = Depends(_auth)):
    """Cancel a queued or running fine-tuning job."""
    try:
        return ft_openai.cancel_job(job_id)
    except RuntimeError as exc:
        raise HTTPException(503, str(exc))
    except Exception as exc:
        raise HTTPException(500, f"OpenAI API error: {exc}")


# ── Helpers ───────────────────────────────────────────────────────────────────

def _pdf_text(data: bytes) -> str:
    try:
        import PyPDF2
        reader = PyPDF2.PdfReader(io.BytesIO(data))
        return "\n".join(p.extract_text() or "" for p in reader.pages)
    except Exception as exc:
        raise HTTPException(500, f"PDF parse error: {exc}")


def _image_text(data: bytes, title: str = "") -> str:
    """Extract text from an image via OCR (pytesseract).
    Falls back to a descriptive placeholder if Tesseract is not installed."""
    try:
        from PIL import Image
        import pytesseract
        img  = Image.open(io.BytesIO(data)).convert("RGB")
        text = pytesseract.image_to_string(img, lang="vie+eng").strip()
        if text:
            return f"[Schema diagram: {title}]\n\n{text}"
    except Exception:
        pass
    # Tesseract not available — store title + label so it can still be found by search
    return (
        f"[Schema diagram: {title}]\n\n"
        "This document is a visual schema diagram (PNG image). "
        "Install Tesseract (brew install tesseract tesseract-lang) "
        "and re-upload to enable full OCR text extraction."
    )
