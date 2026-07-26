"""
Raw material cache — every file a student uploads through /ai/note-upload
or /ai/upload-pset gets its original bytes kept here for 12 hours, purely
so a failed/incomplete synthesis can be retried without asking the student
to re-upload. Invisible by design: no list endpoint, no UI, nothing surfaced
to the student — this is operational safety net, not a feature.

Auto-purges on write rather than running a background job (no scheduler
infra in this app) — every save first deletes anything past its 12h
window, so the table never grows unbounded and nothing needs a cron.
"""

from __future__ import annotations

import os
import sqlite3
import uuid
from datetime import datetime, timedelta, timezone

_HERE = os.path.dirname(os.path.abspath(__file__))
DB_PATH = os.path.join(_HERE, "../../finetune.db")

RETENTION = timedelta(hours=12)

_DDL = """
CREATE TABLE IF NOT EXISTS raw_material_cache (
    id         TEXT PRIMARY KEY,
    user_key   TEXT NOT NULL,
    kind       TEXT NOT NULL,      -- 'note' | 'pset'
    filename   TEXT NOT NULL DEFAULT '',
    mime       TEXT NOT NULL DEFAULT '',
    data       BLOB NOT NULL,
    created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_raw_material_created ON raw_material_cache(created_at);
"""


def _conn() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _purge(c: sqlite3.Connection) -> None:
    cutoff = (_now() - RETENTION).isoformat()
    c.execute("DELETE FROM raw_material_cache WHERE created_at < ?", (cutoff,))


def save_raw(user_key: str, kind: str, filename: str, mime: str, data: bytes) -> str:
    """Best-effort — a cache write failing must never block the actual
    upload pipeline, so callers should wrap this in try/except and ignore
    failures."""
    item_id = uuid.uuid4().hex[:16]
    with _conn() as c:
        c.executescript(_DDL)
        _purge(c)
        c.execute(
            "INSERT INTO raw_material_cache (id, user_key, kind, filename, mime, data, created_at) "
            "VALUES (?,?,?,?,?,?,?)",
            (item_id, user_key, kind, filename[:200], mime, data, _now().isoformat()),
        )
    return item_id


def get_raw(item_id: str, user_key: str) -> tuple[bytes, str, str] | None:
    """Internal-only lookup (e.g. a retry path) — not exposed via any router."""
    with _conn() as c:
        c.executescript(_DDL)
        _purge(c)
        row = c.execute(
            "SELECT data, mime, filename FROM raw_material_cache WHERE id = ? AND user_key = ?",
            (item_id, user_key),
        ).fetchone()
    if not row:
        return None
    return row["data"], row["mime"], row["filename"]
