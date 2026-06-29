"""
OpenAI Fine-tuning bridge.

Flow:
  1. Caller provides JSONL content (already formatted as OpenAI chat messages).
  2. We upload it to OpenAI Files API (purpose="fine-tune").
  3. We create a fine-tuning job against the chosen base model.
  4. Caller can poll get_job() for status updates.

Requires:  OPENAI_API_KEY in environment.
Install:   pip install openai>=1.0.0
"""

from __future__ import annotations
import io
import os
from typing import Optional

OPENAI_API_KEY    = os.getenv("OPENAI_API_KEY", "")
DEFAULT_BASE_MODEL = "gpt-4o-mini-2024-07-18"


def _client():
    """Return an authenticated OpenAI client, raise if key is missing."""
    try:
        from openai import OpenAI
    except ImportError:
        raise RuntimeError("openai package not installed — run: pip install openai")
    if not OPENAI_API_KEY:
        raise RuntimeError("OPENAI_API_KEY is not set in .env")
    return OpenAI(api_key=OPENAI_API_KEY)


# ── Submit ────────────────────────────────────────────────────────────────────

def submit_job(
    jsonl_content: str,
    base_model:    str = DEFAULT_BASE_MODEL,
    suffix:        str = "pclick",
) -> dict:
    """
    Upload JSONL → create fine-tuning job.
    Returns a status dict with job_id, file_id, status.
    Raises RuntimeError if API key missing or openai not installed.
    Raises openai.APIError on API failures.
    """
    client = _client()

    # 1. Upload training file
    file_bytes = jsonl_content.encode("utf-8")
    file_obj = client.files.create(
        file=("training.jsonl", io.BytesIO(file_bytes), "application/jsonl"),
        purpose="fine-tune",
    )

    # 2. Create fine-tuning job
    job = client.fine_tuning.jobs.create(
        training_file=file_obj.id,
        model=base_model,
        suffix=suffix[:18],          # OpenAI max suffix length = 18 chars
    )

    return {
        "job_id":      job.id,
        "file_id":     file_obj.id,
        "status":      job.status,
        "base_model":  base_model,
        "created_at":  job.created_at,
    }


# ── Status ────────────────────────────────────────────────────────────────────

def get_job(job_id: str) -> dict:
    """Retrieve current status of a fine-tuning job."""
    client = _client()
    job = client.fine_tuning.jobs.retrieve(job_id)
    return _job_dict(job)


def list_jobs(limit: int = 20) -> list[dict]:
    """List recent fine-tuning jobs (newest first)."""
    client = _client()
    page = client.fine_tuning.jobs.list(limit=limit)
    return [_job_dict(j) for j in page.data]


def cancel_job(job_id: str) -> dict:
    """Cancel a queued or running fine-tuning job."""
    client = _client()
    job = client.fine_tuning.jobs.cancel(job_id)
    return _job_dict(job)


# ── Internal helpers ──────────────────────────────────────────────────────────

def _job_dict(job) -> dict:
    return {
        "job_id":            job.id,
        "status":            job.status,           # queued|running|succeeded|failed|cancelled
        "base_model":        job.model,
        "fine_tuned_model":  job.fine_tuned_model, # set when status == succeeded
        "trained_tokens":    job.trained_tokens,
        "error":             job.error.message if job.error else None,
        "created_at":        job.created_at,
        "finished_at":       job.finished_at,
    }
