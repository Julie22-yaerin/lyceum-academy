"""
UX Metrics API Router (SOC-16+)
══════════════════════════════════

Endpoints for monitoring UX metrics per cohort of 50 students.
Returns chart-ready data for the admin dashboard.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query

from app.api.deps import require_auth
from app.services import ux_metrics as ux_svc

router = APIRouter(prefix="/ux-metrics", tags=["ux-metrics"])


@router.get("/chart")
async def get_ux_chart_data(
    days: int = Query(365, description="Lookback window in days"),
    limit: int = Query(50, description="Max number of snapshots to return"),
    _: dict = Depends(require_auth),
) -> dict[str, Any]:
    """
    Get UX metrics chart data.
    
    Returns aggregated metrics per cohort, sorted by cohort index.
    Use this data to build charts for:
      - avg_completion_time_seconds vs cohort_index (line chart)
      - dependency_rate vs cohort_index (bar chart)
      - avg_accuracy vs cohort_index (line chart)
      - return_rate vs cohort_index (multi-line chart: 7d + 30d)
    
    Each data point represents one cohort of ~50 students.
    """
    window_end = datetime.now(timezone.utc)
    window_start = window_end - timedelta(days=days)

    snapshots = ux_svc.get_metrics_chart_data(
        window_start=window_start,
        window_end=window_end,
        limit=limit,
    )

    return {
        "snapshots": snapshots,
        "total_cohorts": len(snapshots),
        "window_start": window_start.isoformat(),
        "window_end": window_end.isoformat(),
    }


@router.get("/latest")
async def get_latest_metrics(
    _: dict = Depends(require_auth),
) -> dict[str, Any]:
    """
    Get the most recent UX metrics snapshot.
    Returns null if no snapshots exist yet.
    """
    snapshot = ux_svc.get_latest_snapshot()
    return {"snapshot": snapshot}


@router.post("/snapshot")
async def trigger_metrics_snapshot(
    days: int = Query(30, description="Lookback window in days"),
    cohort_size: int = Query(50, description="Users per cohort"),
    _: dict = Depends(require_auth),
) -> dict[str, Any]:
    """
    Manually trigger a UX metrics snapshot calculation.
    
    Calculates metrics for ALL cohorts in the given time window.
    By default looks at the last 30 days with cohorts of 50 users.
    
    Returns summary of what was stored.
    """
    window_end = datetime.now(timezone.utc)
    window_start = window_end - timedelta(days=days)

    result = ux_svc.create_metrics_snapshot(
        window_start=window_start,
        window_end=window_end,
        cohort_size=cohort_size,
    )

    if result["status"] == "error":
        raise HTTPException(status_code=500, detail=result.get("error", "Unknown error"))

    return result


@router.get("/summary")
async def get_metrics_summary(
    _: dict = Depends(require_auth),
) -> dict[str, Any]:
    """
    Get a summary of all available UX metrics data.
    Returns total cohorts tracked, date range, and average values.
    """
    from app.db.session import SessionLocal
    from app.models.entities import UXMetricsSnapshot

    db = SessionLocal()
    try:
        total = db.query(UXMetricsSnapshot).count()
        earliest = db.query(UXMetricsSnapshot.window_start).order_by(
            UXMetricsSnapshot.window_start.asc()
        ).first()
        latest = db.query(UXMetricsSnapshot.window_end).order_by(
            UXMetricsSnapshot.window_end.desc()
        ).first()

        return {
            "total_snapshots": total,
            "earliest_window": earliest[0].isoformat() if earliest else None,
            "latest_window": latest[0].isoformat() if latest else None,
            "cohort_size": 50,
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        db.close()
