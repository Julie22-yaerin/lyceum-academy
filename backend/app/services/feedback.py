"""
SQLite-backed store for anonymous student feedback (star rating + comment),
for the admin "Feedback" dashboard.

Reuses the same lightweight sqlite3 pattern as activity_log.py / finetune_db.py
(own table, same DB file, no ORM). No auth required to submit — the widget
must work for anonymous landing-page visitors too — spam is bounded by the
per-IP/per-user rate limiter on the endpoint instead. Rows never store a
user identifier, by design.
"""

from __future__ import annotations
import json
import os
import sqlite3
from datetime import datetime, timezone

_HERE = os.path.dirname(os.path.abspath(__file__))
DB_PATH = os.path.join(_HERE, "../../finetune.db")

DDL = """
CREATE TABLE IF NOT EXISTS user_feedback (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    created_at TEXT    NOT NULL,
    rating     INTEGER NOT NULL,
    comment    TEXT    NOT NULL DEFAULT '',
    context    TEXT    NOT NULL DEFAULT '',
    raw        TEXT    NOT NULL DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS idx_feedback_created_at ON user_feedback(created_at);
CREATE INDEX IF NOT EXISTS idx_feedback_rating ON user_feedback(rating);
"""


def _conn() -> sqlite3.Connection:
    c = sqlite3.connect(DB_PATH)
    c.row_factory = sqlite3.Row
    return c


def init_db() -> None:
    """Create the table if it doesn't exist. Safe to call multiple times."""
    with _conn() as c:
        c.executescript(DDL)
        cols = {row["name"] for row in c.execute("PRAGMA table_info(user_feedback)")}
        if "raw" not in cols:
            c.execute("ALTER TABLE user_feedback ADD COLUMN raw TEXT NOT NULL DEFAULT '{}'")


def submit(rating: int, comment: str = "", context: str = "", raw: dict | None = None) -> None:
    """Store one feedback submission. No user identifier is recorded."""
    rating = max(1, min(5, int(rating)))
    now = datetime.now(timezone.utc).isoformat()
    raw_json = json.dumps(raw or {})[:4000]
    with _conn() as c:
        c.execute(
            "INSERT INTO user_feedback (created_at, rating, comment, context, raw) VALUES (?,?,?,?,?)",
            (now, rating, (comment or "").strip()[:2000], (context or "").strip()[:100], raw_json),
        )


def list_recent(limit: int = 200, offset: int = 0) -> list[dict]:
    limit = max(1, min(limit, 500))
    with _conn() as c:
        rows = c.execute(
            "SELECT * FROM user_feedback ORDER BY id DESC LIMIT ? OFFSET ?",
            (limit, offset),
        ).fetchall()
    return [dict(r) for r in rows]


def summary() -> dict:
    """Total count, average rating, and 1-5 star distribution."""
    with _conn() as c:
        total = c.execute("SELECT COUNT(*) FROM user_feedback").fetchone()[0]
        avg = c.execute("SELECT AVG(rating) FROM user_feedback").fetchone()[0]
        dist_rows = c.execute(
            "SELECT rating, COUNT(*) as n FROM user_feedback GROUP BY rating"
        ).fetchall()
    distribution = {str(i): 0 for i in range(1, 6)}
    for r in dist_rows:
        distribution[str(r["rating"])] = r["n"]
    return {"total": total, "average": round(avg, 2) if avg else 0, "distribution": distribution}


def recent_for_analysis(limit: int = 300) -> list[dict]:
    """Most recent feedback (rating + comment only) for the AI theme analysis."""
    with _conn() as c:
        rows = c.execute(
            "SELECT rating, comment FROM user_feedback ORDER BY id DESC LIMIT ?",
            (limit,),
        ).fetchall()
    return [dict(r) for r in rows]
