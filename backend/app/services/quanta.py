"""
Quanta — an XP-like point system rewarding real learning signals (drawing a
mind map, answering exercise questions well). Same lightweight pattern as
mastery_profile.py/activity_log.py/second_brain.py: a raw event ledger plus
a rolled-up per-user totals table in the shared finetune.db, keyed by the
same Firebase UID string every other personalization service uses.
"""

from __future__ import annotations

import os
import sqlite3
from datetime import datetime, timezone
from typing import Any

_HERE = os.path.dirname(os.path.abspath(__file__))
DB_PATH = os.path.join(_HERE, "../../finetune.db")

_DDL = """
CREATE TABLE IF NOT EXISTS quanta_events (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id    TEXT NOT NULL,
    event_type TEXT NOT NULL,
    points     INTEGER NOT NULL,
    context    TEXT NOT NULL DEFAULT '',
    event_key  TEXT,
    created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_quanta_events_user ON quanta_events(user_id, created_at);
CREATE UNIQUE INDEX IF NOT EXISTS uq_quanta_events_dedupe
    ON quanta_events(event_key) WHERE event_key IS NOT NULL;

CREATE TABLE IF NOT EXISTS quanta_totals (
    user_id      TEXT PRIMARY KEY,
    total_points INTEGER NOT NULL DEFAULT 0,
    level        INTEGER NOT NULL DEFAULT 1,
    updated_at   TEXT NOT NULL
);
"""

# Point values are deliberately approximate, not precise — a passed exercise
# should feel meaningfully bigger than a bare attempt, mind-map creation
# sits between the two. `note_understood` is reserved for the card-based
# exercise feature (sourced from Second Brain notes) to call once it grades
# a note-sourced question — no code changes needed here when that lands.
POINT_RULES: dict[str, int] = {
    "mind_map_created": 25,
    "mind_map_ai_reviewed": 15,
    "exercise_attempt": 5,
    "exercise_correct": 20,
    "note_understood": 20,
}

# Events a client is allowed to self-report via POST /quanta/award. Anything
# not in this set (exercise_*, mind_map_ai_reviewed) is only ever awarded
# from inside a trusted server-side code path, so a client can't fabricate
# a passed grade or a fake AI review for free points.
CLIENT_AWARDABLE_EVENTS = {"mind_map_created"}

_LEVEL_BASE = 100
_LEVEL_GROWTH = 1.15
_LEVEL_STEP = 20


def _conn() -> sqlite3.Connection:
    c = sqlite3.connect(DB_PATH)
    c.row_factory = sqlite3.Row
    return c


def init_db() -> None:
    with _conn() as c:
        c.executescript(_DDL)


def _level_for_points(total: int) -> tuple[int, int, int]:
    """(level, points already earned into the current level, points needed
    to reach the next level). Escalating thresholds computed iteratively —
    cheap early levels, harder later, no lookup table to maintain."""
    level, remaining, threshold = 1, total, _LEVEL_BASE
    while remaining >= threshold:
        remaining -= threshold
        level += 1
        threshold = int(threshold * _LEVEL_GROWTH) + _LEVEL_STEP
    return level, remaining, threshold


def award(user_id: str, event_type: str, context: str = "", event_key: str | None = None) -> dict[str, Any]:
    """Best-effort — never raises. Points are always looked up server-side
    from POINT_RULES; callers never supply an amount. `event_key`, if given,
    makes a duplicate award (e.g. a retried request) a no-op via a unique
    index rather than double-counting."""
    if not user_id or event_type not in POINT_RULES:
        return {"awarded": 0, "event_type": event_type, "total_points": 0, "level": 1, "leveled_up": False}

    points = POINT_RULES[event_type]
    now = datetime.now(timezone.utc).isoformat()
    try:
        with _conn() as c:
            try:
                c.execute(
                    "INSERT INTO quanta_events (user_id, event_type, points, context, event_key, created_at) "
                    "VALUES (?,?,?,?,?,?)",
                    (user_id, event_type, points, context, event_key, now),
                )
            except sqlite3.IntegrityError:
                # Duplicate event_key — this exact award already happened.
                row = c.execute(
                    "SELECT total_points, level FROM quanta_totals WHERE user_id = ?", (user_id,)
                ).fetchone()
                total = row["total_points"] if row else 0
                level = row["level"] if row else 1
                return {"awarded": 0, "event_type": event_type, "total_points": total, "level": level, "leveled_up": False}

            row = c.execute(
                "SELECT total_points, level FROM quanta_totals WHERE user_id = ?", (user_id,)
            ).fetchone()
            prev_total = row["total_points"] if row else 0
            prev_level = row["level"] if row else 1
            new_total = prev_total + points
            new_level, _, _ = _level_for_points(new_total)

            c.execute(
                "INSERT INTO quanta_totals (user_id, total_points, level, updated_at) VALUES (?,?,?,?) "
                "ON CONFLICT(user_id) DO UPDATE SET total_points=excluded.total_points, "
                "level=excluded.level, updated_at=excluded.updated_at",
                (user_id, new_total, new_level, now),
            )

        return {
            "awarded": points,
            "event_type": event_type,
            "total_points": new_total,
            "level": new_level,
            "leveled_up": new_level > prev_level,
        }
    except Exception:
        return {"awarded": 0, "event_type": event_type, "total_points": 0, "level": 1, "leveled_up": False}


def get_profile(user_id: str) -> dict[str, Any]:
    with _conn() as c:
        row = c.execute(
            "SELECT total_points, level FROM quanta_totals WHERE user_id = ?", (user_id,)
        ).fetchone()
        total = row["total_points"] if row else 0
        level = row["level"] if row else 1
        _, points_into_level, points_to_next_level = _level_for_points(total)

        events = c.execute(
            "SELECT event_type, points, context, created_at FROM quanta_events "
            "WHERE user_id = ? ORDER BY id DESC LIMIT 20",
            (user_id,),
        ).fetchall()

    return {
        "total_points": total,
        "level": level,
        "points_into_level": points_into_level,
        "points_to_next_level": points_to_next_level,
        "recent_events": [dict(e) for e in events],
    }
