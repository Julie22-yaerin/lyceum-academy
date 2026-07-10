"""
UX Metrics Service (SOC-16+) — Theo dõi chỉ số UX theo cohort
══════════════════════════════════════════════════════════════

Tracks and aggregates key UX metrics:
  • Thời gian hoàn thành bài học (completion time)
  • Tỷ lệ phụ thuộc (dependency rate — % attempts using hints)
  • Tỉ lệ trả lời đúng (accuracy rate)
  • Tỉ lệ quay lại theo thời gian (return rate — 7d & 30d retention)

Aggregated per cohort of N students (default: 50) for charting.
Stored in ux_metrics_snapshots table.
"""

from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone
from typing import Any

from sqlalchemy import func, select, text
from sqlalchemy.orm import Session

from app.db.session import SessionLocal
from app.models.entities import (
    Attempt,
    AttemptHint,
    UserProfile,
    UXMetricsSnapshot,
)

log = logging.getLogger("pclick.ux_metrics")

# ── Config ────────────────────────────────────────────────────────────────────

_COHORT_SIZE = 50
"""Number of students per cohort for aggregation."""

_RETENTION_WINDOWS = {
    "7d": timedelta(days=7),
    "30d": timedelta(days=30),
}
"""Retention windows for return rate calculation."""


# ── Core calculation functions ────────────────────────────────────────────────


def _get_user_cohorts(db: Session) -> list[tuple[int, list[str]]]:
    """
    Get all user cohorts based on registration order.
    
    Returns list of (cohort_index, [user_id, ...]) tuples.
    Cohorts are sequential: cohort_0 = users 0-49, cohort_1 = users 50-99, etc.
    """
    users = (
        db.query(UserProfile.id)
        .order_by(UserProfile.created_at.asc())
        .all()
    )
    user_ids = [str(u.id) for u in users]

    cohorts = []
    for i in range(0, len(user_ids), _COHORT_SIZE):
        cohort_index = i // _COHORT_SIZE
        cohort_ids = user_ids[i:i + _COHORT_SIZE]
        cohorts.append((cohort_index, cohort_ids))

    return cohorts


def _calc_cohort_metrics(
    db: Session,
    user_ids: list[str],
    window_start: datetime,
    window_end: datetime,
) -> dict[str, Any]:
    """
    Calculate all UX metrics for a cohort of users within a time window.
    
    Args:
        db: Database session
        user_ids: List of user IDs in this cohort
        window_start: Start of the analysis window
        window_end: End of the analysis window
        
    Returns:
        Dict with all calculated metrics.
    """
    if not user_ids:
        return _empty_metrics()

    # Convert UUIDs to strings for SQLAlchemy queries
    uid_strs = user_ids

    # ── 1. Completion time: avg + median time_spent_seconds ──────────────
    time_result = db.execute(
        select(
            func.coalesce(func.avg(Attempt.time_spent_seconds), 0).label("avg_time"),
            func.coalesce(
                func.percentile_cont(0.5).within_group(
                    Attempt.time_spent_seconds.asc()
                ),
                0,
            ).label("median_time"),
        ).where(
            Attempt.user_id.in_(uid_strs),
            Attempt.completed == True,
            Attempt.created_at >= window_start,
            Attempt.created_at <= window_end,
        )
    ).first() or {"avg_time": 0, "median_time": 0}

    # ── 2. Dependency rate: % of attempts that used hints ────────────────
    total_attempts = db.execute(
        select(func.count(Attempt.id)).where(
            Attempt.user_id.in_(uid_strs),
            Attempt.created_at >= window_start,
            Attempt.created_at <= window_end,
        )
    ).scalar() or 0

    attempts_with_hints = db.execute(
        select(func.count(func.distinct(AttemptHint.attempt_id))).where(
            AttemptHint.attempt_id.in_(
                select(Attempt.id).where(
                    Attempt.user_id.in_(uid_strs),
                    Attempt.created_at >= window_start,
                    Attempt.created_at <= window_end,
                )
            ),
        )
    ).scalar() or 0

    dependency_rate = (attempts_with_hints / total_attempts) if total_attempts > 0 else 0.0

    # ── 3. Accuracy rate: avg accuracy_score across completed attempts ────
    accuracy_result = db.execute(
        select(
            func.coalesce(func.avg(Attempt.accuracy_score), 0.0).label("avg_accuracy"),
        ).where(
            Attempt.user_id.in_(uid_strs),
            Attempt.completed == True,
            Attempt.created_at >= window_start,
            Attempt.created_at <= window_end,
        )
    ).scalar() or 0.0

    # ── 4. Return rate: % of users who came back in 7d / 30d after first attempt ──
    return_7d = _calc_return_rate(db, uid_strs, window_end, _RETENTION_WINDOWS["7d"])
    return_30d = _calc_return_rate(db, uid_strs, window_end, _RETENTION_WINDOWS["30d"])

    # ── 5. Active users & completed psets ────────────────────────────────
    active_users = db.execute(
        select(func.count(func.distinct(Attempt.user_id))).where(
            Attempt.user_id.in_(uid_strs),
            Attempt.created_at >= window_start,
            Attempt.created_at <= window_end,
        )
    ).scalar() or 0

    completed_count = db.execute(
        select(func.count(func.distinct(Attempt.problem_id))).where(
            Attempt.user_id.in_(uid_strs),
            Attempt.completed == True,
            Attempt.created_at >= window_start,
            Attempt.created_at <= window_end,
        )
    ).scalar() or 0

    # Compute median completion time using a different approach
    # (percentile_cont may not be supported by all PostgreSQL installations)
    median_time = _calc_manual_median(db, uid_strs, window_start, window_end)

    return {
        "avg_completion_time_seconds": round(float(time_result.avg_time), 1) if time_result else 0.0,
        "median_completion_time_seconds": round(float(median_time), 1),
        "dependency_rate": round(dependency_rate, 4),
        "avg_accuracy": round(float(accuracy_result), 4),
        "return_rate_7d": round(return_7d, 4),
        "return_rate_30d": round(return_30d, 4),
        "total_users_in_cohort": len(user_ids),
        "active_users_in_window": int(active_users),
        "total_attempts": int(total_attempts),
        "completed_psets": int(completed_count),
    }


def _calc_manual_median(
    db: Session,
    user_ids: list[str],
    window_start: datetime,
    window_end: datetime,
) -> float:
    """Compute median completion time using PostgreSQL percentile_disc."""
    try:
        result = db.execute(
            text(
                """
                SELECT percentile_disc(0.5) WITHIN GROUP (ORDER BY time_spent_seconds)
                FROM attempts
                WHERE user_id = ANY(:user_ids)
                  AND completed = TRUE
                  AND created_at >= :window_start
                  AND created_at <= :window_end
                """
            ),
            {
                "user_ids": user_ids,
                "window_start": window_start,
                "window_end": window_end,
            },
        ).scalar()
        return float(result) if result is not None else 0.0
    except Exception as e:
        log.warning("calc_manual_median failed (fallback to avg): %s", e)
        # Fallback: use average as rough median approximation
        avg = db.execute(
            select(func.avg(Attempt.time_spent_seconds)).where(
                Attempt.user_id.in_(user_ids),
                Attempt.completed == True,
                Attempt.created_at >= window_start,
                Attempt.created_at <= window_end,
            )
        ).scalar()
        return float(avg) if avg else 0.0


def _calc_return_rate(
    db: Session,
    user_ids: list[str],
    reference_time: datetime,
    window: timedelta,
) -> float:
    """
    Calculate return rate: % of users who made their first attempt before the
    reference time, then made at least one more attempt within the window.
    """
    if not user_ids:
        return 0.0

    cutoff_time = reference_time - window

    # Get users whose first attempt was BEFORE the reference time
    first_attempt_users = db.execute(
        select(Attempt.user_id, func.min(Attempt.created_at).label("first_attempt"))
        .where(
            Attempt.user_id.in_(user_ids),
            Attempt.created_at < reference_time,
        )
        .group_by(Attempt.user_id)
    ).all()

    if not first_attempt_users:
        return 0.0

    # Count how many of those users returned (had another attempt within window)
    returned_count = 0
    for row in first_attempt_users:
        user_id = row.user_id
        first_time = row.first_attempt

        # Check if they returned after their first attempt but before cutoff
        later_attempt = db.execute(
            select(func.count(Attempt.id)).where(
                Attempt.user_id == user_id,
                Attempt.created_at > first_time,
                Attempt.created_at >= cutoff_time,
                Attempt.created_at <= reference_time,
            )
        ).scalar() or 0

        if later_attempt > 0:
            returned_count += 1

    return returned_count / len(first_attempt_users) if first_attempt_users else 0.0


def _empty_metrics() -> dict[str, Any]:
    """Return a zeroed-out metrics dict."""
    return {
        "avg_completion_time_seconds": 0.0,
        "median_completion_time_seconds": 0.0,
        "dependency_rate": 0.0,
        "avg_accuracy": 0.0,
        "return_rate_7d": 0.0,
        "return_rate_30d": 0.0,
        "total_users_in_cohort": 0,
        "active_users_in_window": 0,
        "total_attempts": 0,
        "completed_psets": 0,
    }


# ── Snapshot creation ────────────────────────────────────────────────────────


def create_metrics_snapshot(
    window_start: datetime | None = None,
    window_end: datetime | None = None,
    cohort_size: int = _COHORT_SIZE,
) -> dict[str, Any]:
    """
    Calculate and store UX metrics for ALL cohorts in a time window.
    
    Args:
        window_start: Start of analysis window (default: 30 days ago)
        window_end: End of analysis window (default: now)
        cohort_size: Number of users per cohort (default: 50)
        
    Returns:
        Summary of what was stored (number of snapshots created, metrics summary).
    """
    if window_end is None:
        window_end = datetime.now(timezone.utc)
    if window_start is None:
        window_start = window_end - timedelta(days=30)

    # Use cohort_size parameter directly

    db = SessionLocal()
    try:
        cohorts = _get_user_cohorts(db)
        snapshots_created = 0

        for cohort_index, user_ids in cohorts:
            # Only compute for cohorts that have data in the window
            metrics = _calc_cohort_metrics(db, user_ids, window_start, window_end)

            snapshot = UXMetricsSnapshot(
                cohort_index=cohort_index,
                cohort_size=cohort_size,
                window_start=window_start,
                window_end=window_end,
                avg_completion_time_seconds=metrics["avg_completion_time_seconds"],
                median_completion_time_seconds=metrics["median_completion_time_seconds"],
                dependency_rate=metrics["dependency_rate"],
                avg_accuracy=metrics["avg_accuracy"],
                return_rate_7d=metrics["return_rate_7d"],
                return_rate_30d=metrics["return_rate_30d"],
                total_users_in_cohort=metrics["total_users_in_cohort"],
                active_users_in_window=metrics["active_users_in_window"],
                total_attempts=metrics["total_attempts"],
                completed_psets=metrics["completed_psets"],
            )
            db.add(snapshot)
            snapshots_created += 1
            log.info(
                "UX cohort %d: avg_time=%.1fs dep_rate=%.1f%% accuracy=%.1f%% "
                "return_7d=%.1f%% return_30d=%.1f%% active=%d/%d",
                cohort_index,
                metrics["avg_completion_time_seconds"],
                metrics["dependency_rate"] * 100,
                metrics["avg_accuracy"] * 100,
                metrics["return_rate_7d"] * 100,
                metrics["return_rate_30d"] * 100,
                metrics["active_users_in_window"],
                metrics["total_users_in_cohort"],
            )

        db.commit()

        return {
            "status": "ok",
            "snapshots_created": snapshots_created,
            "window_start": window_start.isoformat(),
            "window_end": window_end.isoformat(),
            "cohort_size": cohort_size,
        }

    except Exception as e:
        db.rollback()
        log.error("create_metrics_snapshot failed: %s", e)
        return {"status": "error", "error": str(e)}
    finally:
        db.close()


# ── Query functions ──────────────────────────────────────────────────────────


def get_metrics_chart_data(
    window_start: datetime | None = None,
    window_end: datetime | None = None,
    limit: int = 50,
) -> list[dict[str, Any]]:
    """
    Get UX metrics chart data — returns snapshots ordered by cohort.
    
    Returns chart-ready data for:
      - avg_completion_time_seconds vs cohort_index
      - dependency_rate vs cohort_index
      - avg_accuracy vs cohort_index
      - return_rate_7d and return_rate_30d vs cohort_index
    
    Each return item includes:
    {
        cohort_index, cohort_size, window_start, window_end,
        avg_completion_time_seconds, median_completion_time_seconds,
        dependency_rate, avg_accuracy,
        return_rate_7d, return_rate_30d,
        total_users_in_cohort, active_users_in_window,
        total_attempts, completed_psets
    }
    """
    if window_end is None:
        window_end = datetime.now(timezone.utc)
    if window_start is None:
        window_start = window_end - timedelta(days=365)

    db = SessionLocal()
    try:
        snapshots = (
            db.query(UXMetricsSnapshot)
            .filter(
                UXMetricsSnapshot.window_start >= window_start,
                UXMetricsSnapshot.window_end <= window_end,
            )
            .order_by(UXMetricsSnapshot.cohort_index.asc())
            .limit(limit)
            .all()
        )

        return [
            {
                "cohort_index": s.cohort_index,
                "cohort_size": s.cohort_size,
                "window_start": s.window_start.isoformat(),
                "window_end": s.window_end.isoformat(),
                "avg_completion_time_seconds": s.avg_completion_time_seconds,
                "median_completion_time_seconds": s.median_completion_time_seconds,
                "dependency_rate": s.dependency_rate,
                "avg_accuracy": s.avg_accuracy,
                "return_rate_7d": s.return_rate_7d,
                "return_rate_30d": s.return_rate_30d,
                "total_users_in_cohort": s.total_users_in_cohort,
                "active_users_in_window": s.active_users_in_window,
                "total_attempts": s.total_attempts,
                "completed_psets": s.completed_psets,
            }
            for s in snapshots
        ]
    except Exception as e:
        log.error("get_metrics_chart_data failed: %s", e)
        return []
    finally:
        db.close()


def get_latest_snapshot() -> dict[str, Any] | None:
    """Get the most recent metrics snapshot (latest window)."""
    db = SessionLocal()
    try:
        s = (
            db.query(UXMetricsSnapshot)
            .order_by(UXMetricsSnapshot.window_end.desc())
            .first()
        )
        if not s:
            return None
        return {
            "cohort_index": s.cohort_index,
            "cohort_size": s.cohort_size,
            "window_start": s.window_start.isoformat(),
            "window_end": s.window_end.isoformat(),
            "avg_completion_time_seconds": s.avg_completion_time_seconds,
            "median_completion_time_seconds": s.median_completion_time_seconds,
            "dependency_rate": s.dependency_rate,
            "avg_accuracy": s.avg_accuracy,
            "return_rate_7d": s.return_rate_7d,
            "return_rate_30d": s.return_rate_30d,
            "total_users_in_cohort": s.total_users_in_cohort,
            "active_users_in_window": s.active_users_in_window,
            "total_attempts": s.total_attempts,
            "completed_psets": s.completed_psets,
        }
    except Exception as e:
        log.error("get_latest_snapshot failed: %s", e)
        return None
    finally:
        db.close()
