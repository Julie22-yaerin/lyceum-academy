"""
Batch Pre-generation Scheduler (APScheduler)
═════════════════════════════════════════════

No provider used here has a real async Batch API (Groq/Google AI Studio/
NVIDIA NIM/OpenRouter/Ollama are all synchronous request/response) — this
approximates the cost/latency win of a batch job by firing the queued
requests concurrently against the existing chat() pipeline instead, via an
in-process APScheduler tick. Queued by POST /session/end (schedule.py) when
a student's browser tab closes; picked up here and, once complete, served
via GET /exercises/pregenerated.
"""

from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timedelta, timezone

from sqlalchemy import select

from app.db.session import SessionLocal
from app.models.entities import ExerciseBatchJob, ScheduleBlock
from app.services import ai as ai_svc

log = logging.getLogger("pclick")

LOOKAHEAD_HOURS = 24


def _next_occurrence(block: ScheduleBlock, now: datetime) -> datetime:
    current_day = now.weekday()
    days_ahead = (block.day_of_week - current_day) % 7
    candidate = (now.replace(hour=0, minute=0, second=0, microsecond=0)
                 + timedelta(days=days_ahead, minutes=block.start_minute))
    if candidate < now:
        candidate += timedelta(days=7)
    return candidate


async def _generate_for_job(job: ExerciseBatchJob) -> dict:
    result = await ai_svc.generate_exercises(subject=job.subject_key, count=10)
    return result


async def poll_and_generate() -> dict:
    """
    Runs on a 5-minute interval. Only processes jobs whose subject has an
    upcoming scheduled occurrence within the lookahead window — "chỉ chạy
    những môn có lịch học sắp tới."
    """
    db = SessionLocal()
    processed, expired, failed = 0, 0, 0
    try:
        jobs = db.execute(
            select(ExerciseBatchJob).where(ExerciseBatchJob.status == "queued")
        ).scalars().all()
        if not jobs:
            return {"processed": 0, "expired": 0, "failed": 0}

        now = datetime.now(timezone.utc)
        lookahead = now + timedelta(hours=LOOKAHEAD_HOURS)

        runnable: list[ExerciseBatchJob] = []
        for job in jobs:
            blocks = db.execute(
                select(ScheduleBlock).where(
                    ScheduleBlock.user_id == job.user_id,
                    ScheduleBlock.subject_key == job.subject_key,
                )
            ).scalars().all()
            still_upcoming = any(_next_occurrence(b, now) <= lookahead for b in blocks)
            if still_upcoming:
                job.status = "running"
                runnable.append(job)
            else:
                job.status = "failed"
                expired += 1
        db.commit()

        if not runnable:
            return {"processed": 0, "expired": expired, "failed": 0}

        # Concurrent async calls against the existing chat() pipeline — the
        # "batch" approximation (no real provider batch discount available).
        results = await asyncio.gather(*(_generate_for_job(j) for j in runnable), return_exceptions=True)

        for job, result in zip(runnable, results):
            if isinstance(result, Exception):
                log.warning("scheduler_jobs: generation failed for %s/%s: %s", job.user_id, job.subject_key, result)
                job.status = "failed"
                failed += 1
            else:
                job.status = "completed"
                job.result_payload = result
                job.completed_at = datetime.now(timezone.utc)
                processed += 1
        db.commit()

        return {"processed": processed, "expired": expired, "failed": failed}
    except Exception as e:
        log.error("scheduler_jobs.poll_and_generate failed: %s", e)
        return {"processed": processed, "expired": expired, "failed": failed, "error": str(e)}
    finally:
        db.close()
