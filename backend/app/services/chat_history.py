"""
AI Chat History — auto-save for the admin's conversations with the head
AIs (Commander, the 3 critique positions). SQLite-backed, same pattern as
commander.py / ai_registry.py.

One durable thread per agent_id (not per browser tab/session) — the point
is that reopening the admin panel, even on a different device, picks the
conversation back up.
"""

from __future__ import annotations

import os
import sqlite3
import time
from typing import Any

_HERE = os.path.dirname(os.path.abspath(__file__))
DB_PATH = os.path.join(_HERE, "../../finetune.db")

_DDL = """
CREATE TABLE IF NOT EXISTS ai_chat_history (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    agent_id   TEXT    NOT NULL,
    role       TEXT    NOT NULL,
    content    TEXT    NOT NULL DEFAULT '',
    created_at TEXT    NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_ai_chat_history_agent ON ai_chat_history(agent_id, id);
"""

_MAX_PER_AGENT = 500


def _conn() -> sqlite3.Connection:
    c = sqlite3.connect(DB_PATH)
    c.row_factory = sqlite3.Row
    return c


def init_db() -> None:
    with _conn() as c:
        c.executescript(_DDL)


def save_message(agent_id: str, role: str, content: str) -> None:
    """Persist one message. Prunes oldest rows past _MAX_PER_AGENT per agent."""
    from datetime import datetime, timezone

    now = datetime.now(timezone.utc).isoformat()
    with _conn() as c:
        c.execute(
            "INSERT INTO ai_chat_history (agent_id, role, content, created_at) VALUES (?,?,?,?)",
            (agent_id, role, content, now),
        )
        count = c.execute(
            "SELECT COUNT(*) FROM ai_chat_history WHERE agent_id = ?", (agent_id,)
        ).fetchone()[0]
        if count > _MAX_PER_AGENT:
            excess = count - _MAX_PER_AGENT
            c.execute(
                """DELETE FROM ai_chat_history WHERE id IN (
                     SELECT id FROM ai_chat_history WHERE agent_id = ?
                     ORDER BY id ASC LIMIT ?
                   )""",
                (agent_id, excess),
            )


def list_messages(agent_id: str, limit: int = 200) -> list[dict[str, Any]]:
    """Oldest-first, ready to render directly as a chat transcript."""
    with _conn() as c:
        rows = c.execute(
            "SELECT role, content, created_at FROM ai_chat_history "
            "WHERE agent_id = ? ORDER BY id DESC LIMIT ?",
            (agent_id, limit),
        ).fetchall()
    return [dict(r) for r in reversed(rows)]
