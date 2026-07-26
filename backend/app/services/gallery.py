"""
Gallery — persistent storage for generated artifacts (images, videos) the
student explicitly chooses to keep.

Everything else that generates media in this codebase (illustration.py,
game.py's per-session image cache, cloudflare_ai.py) is ephemeral by design
— returned inline, regenerated on demand, gone when the request/session
ends. This is the one place a piece of generated media outlives that.
Deliberately opt-in (a "Lưu vào Gallery" button, not automatic) so it
doesn't silently accumulate every throwaway generation.

Same SQLite-in-finetune.db pattern as user_brain.py/quanta.py. Blobs are
stored as raw bytes (not base64) to avoid the ~33% size tax twice over —
once in the DB, once again in transit would be wasteful, so encoding to
base64 happens only at the API boundary, per response.
"""

from __future__ import annotations

import os
import sqlite3
import uuid
from datetime import datetime, timezone
from typing import Any

_HERE = os.path.dirname(os.path.abspath(__file__))
DB_PATH = os.path.join(_HERE, "../../finetune.db")

_DDL = """
CREATE TABLE IF NOT EXISTS gallery_items (
    id         TEXT PRIMARY KEY,
    user_key   TEXT NOT NULL,
    kind       TEXT NOT NULL,               -- image | video
    mime       TEXT NOT NULL,
    title      TEXT NOT NULL DEFAULT '',
    subject    TEXT NOT NULL DEFAULT '',
    source     TEXT NOT NULL DEFAULT '',    -- which tool produced it
    data       BLOB NOT NULL,
    created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_gallery_user ON gallery_items(user_key, created_at DESC);
"""


def _conn() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def init_db() -> None:
    with _conn() as c:
        c.executescript(_DDL)


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def save_artifact(
    user_key: str, kind: str, mime: str, data: bytes, title: str = "", subject: str = "", source: str = "",
) -> dict[str, Any]:
    if kind not in ("image", "video"):
        raise ValueError(f"unknown gallery kind: {kind}")
    item_id = uuid.uuid4().hex[:16]
    with _conn() as c:
        c.executescript(_DDL)
        c.execute(
            "INSERT INTO gallery_items (id, user_key, kind, mime, title, subject, source, data, created_at) "
            "VALUES (?,?,?,?,?,?,?,?,?)",
            (item_id, user_key, kind, mime, title[:200], subject[:80], source[:80], data, _now()),
        )
    return {"ok": True, "id": item_id}


def list_artifacts(user_key: str) -> list[dict[str, Any]]:
    """Metadata only — never the blob, so listing stays cheap regardless of
    how many/large the saved artifacts are."""
    with _conn() as c:
        c.executescript(_DDL)
        rows = c.execute(
            "SELECT id, kind, mime, title, subject, source, created_at, length(data) AS bytes "
            "FROM gallery_items WHERE user_key = ? ORDER BY created_at DESC",
            (user_key,),
        ).fetchall()
    return [dict(r) for r in rows]


def get_artifact(item_id: str, user_key: str) -> tuple[bytes, str] | None:
    with _conn() as c:
        c.executescript(_DDL)
        row = c.execute(
            "SELECT data, mime FROM gallery_items WHERE id = ? AND user_key = ?", (item_id, user_key),
        ).fetchone()
    if not row:
        return None
    return row["data"], row["mime"]


def delete_artifact(item_id: str, user_key: str) -> bool:
    with _conn() as c:
        c.executescript(_DDL)
        cur = c.execute("DELETE FROM gallery_items WHERE id = ? AND user_key = ?", (item_id, user_key))
    return cur.rowcount > 0
