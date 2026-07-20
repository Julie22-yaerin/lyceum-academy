"""
Weekly Study Schedule + Exercise Pre-generation Router
═══════════════════════════════════════════════════════

Backs the onboarding drag-and-drop weekly scheduler (POST/GET /schedule),
the sendBeacon session-end signal (POST /session/end — intentionally
unauthenticated, sendBeacon can't attach headers), and the pre-generated
exercise handoff (GET /exercises/pregenerated) consumed once a future view
wires it in.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import require_auth
from app.core.limiter import limiter
from app.db.session import get_db
from app.models.entities import ExerciseBatchJob, ScheduleBlock

router = APIRouter(tags=["schedule"])


def _uid(auth: dict) -> str:
    return auth.get("user_id") or auth.get("sub") or ""


class ScheduleBlockIn(BaseModel):
    day_of_week: int
    start_minute: int
    duration_minutes: int
    subject_key: str


class ScheduleUpsertRequest(BaseModel):
    blocks: list[ScheduleBlockIn]


@router.post("/schedule")
async def upsert_schedule(
    req: ScheduleUpsertRequest,
    db: Session = Depends(get_db),
    auth: dict = Depends(require_auth),
):
    """Replace-all upsert of the caller's weekly schedule blocks."""
    uid = _uid(auth)
    db.query(ScheduleBlock).filter(ScheduleBlock.user_id == uid).delete()
    for b in req.blocks:
        db.add(ScheduleBlock(
            user_id=uid, day_of_week=b.day_of_week, start_minute=b.start_minute,
            duration_minutes=b.duration_minutes, subject_key=b.subject_key,
        ))
    db.commit()
    return {"saved": len(req.blocks)}


@router.get("/schedule")
async def get_schedule(db: Session = Depends(get_db), auth: dict = Depends(require_auth)):
    uid = _uid(auth)
    blocks = db.execute(select(ScheduleBlock).where(ScheduleBlock.user_id == uid)).scalars().all()
    return {
        "blocks": [
            {
                "id": str(b.id), "day_of_week": b.day_of_week, "start_minute": b.start_minute,
                "duration_minutes": b.duration_minutes, "subject_key": b.subject_key,
            }
            for b in blocks
        ]
    }


class SessionEndRequest(BaseModel):
    uid: str
    subject: str | None = None
    ts: int | None = None


LOOKAHEAD_HOURS = 24


def _next_occurrence(block: ScheduleBlock, now: datetime) -> datetime:
    """Next wall-clock datetime this block starts, on or after `now`."""
    current_day = (now.weekday())  # Monday=0 .. Sunday=6, matches ScheduleBlock.day_of_week
    days_ahead = (block.day_of_week - current_day) % 7
    candidate = (now.replace(hour=0, minute=0, second=0, microsecond=0)
                 + timedelta(days=days_ahead, minutes=block.start_minute))
    if candidate < now:
        candidate += timedelta(days=7)
    return candidate


@router.post("/session/end")
@limiter.limit("10/minute")
async def session_end(request: Request, req: SessionEndRequest, db: Session = Depends(get_db)):
    """
    sendBeacon target — fired when the student closes the tab/browser.
    No auth (sendBeacon can't attach an Authorization header); the payload
    is low-stakes (uid + subject + timestamp only). Best-effort: looks up
    the student's schedule and queues a pre-generation job for whichever
    subject is coming up next, so it's ready before they return.
    """
    if not req.uid:
        return {"queued": False}

    blocks = db.execute(select(ScheduleBlock).where(ScheduleBlock.user_id == req.uid)).scalars().all()
    if not blocks:
        return {"queued": False}

    now = datetime.now(timezone.utc)
    lookahead = now + timedelta(hours=LOOKAHEAD_HOURS)
    upcoming = sorted(
        (b for b in blocks if _next_occurrence(b, now) <= lookahead),
        key=lambda b: _next_occurrence(b, now),
    )
    if not upcoming:
        return {"queued": False}

    next_block = upcoming[0]
    existing = db.execute(
        select(ExerciseBatchJob).where(
            ExerciseBatchJob.user_id == req.uid,
            ExerciseBatchJob.subject_key == next_block.subject_key,
            ExerciseBatchJob.status.in_(["queued", "running"]),
        )
    ).scalars().first()
    if existing:
        return {"queued": False, "reason": "already_pending"}

    db.add(ExerciseBatchJob(
        user_id=req.uid, subject_key=next_block.subject_key,
        status="queued", source="session_end",
    ))
    db.commit()
    return {"queued": True, "subject": next_block.subject_key}


@router.get("/exercises/pregenerated")
async def get_pregenerated_exercises(
    subject: str,
    db: Session = Depends(get_db),
    auth: dict = Depends(require_auth),
):
    """
    Returns the newest completed pre-generation job's result for this
    subject, if any (and marks it consumed by deleting the row). Not yet
    wired into any frontend view — ready for whichever exercise-consuming
    view needs it next.
    """
    uid = _uid(auth)
    job = db.execute(
        select(ExerciseBatchJob)
        .where(
            ExerciseBatchJob.user_id == uid,
            ExerciseBatchJob.subject_key == subject,
            ExerciseBatchJob.status == "completed",
        )
        .order_by(ExerciseBatchJob.completed_at.desc())
    ).scalars().first()
    if not job:
        return {"result": None}
    result = job.result_payload
    db.delete(job)
    db.commit()
    return {"result": result}
