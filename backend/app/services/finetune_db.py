"""
SQLite-backed storage for fine-tuning training examples.

Each example is an (optional system prompt, user message, assistant reply) triple
that can be exported as OpenAI-compatible JSONL for fine-tuning.
"""

from __future__ import annotations
import json
import os
import sqlite3
from datetime import datetime, timezone
from typing import Optional

_HERE   = os.path.dirname(os.path.abspath(__file__))
DB_PATH = os.path.join(_HERE, "../../finetune.db")

DDL = """
CREATE TABLE IF NOT EXISTS ft_examples (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    system_prompt   TEXT    NOT NULL DEFAULT '',
    user_message    TEXT    NOT NULL,
    assistant_reply TEXT    NOT NULL,
    subject         TEXT    NOT NULL DEFAULT '',
    tags            TEXT    NOT NULL DEFAULT '[]',
    created_at      TEXT    NOT NULL,
    updated_at      TEXT    NOT NULL
);
"""


def _conn() -> sqlite3.Connection:
    c = sqlite3.connect(DB_PATH)
    c.row_factory = sqlite3.Row
    return c


def init_db():
    """Create tables if they don't exist.  Safe to call multiple times."""
    with _conn() as c:
        c.execute(DDL)


def _row(r) -> dict:
    d = dict(r)
    d["tags"] = json.loads(d.get("tags") or "[]")
    return d


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


# ── CRUD ──────────────────────────────────────────────────────────────────────

def create(
    user_message: str,
    assistant_reply: str,
    system_prompt: str = "",
    subject: str = "",
    tags: list[str] | None = None,
) -> dict:
    now = _now()
    with _conn() as c:
        cur = c.execute(
            """INSERT INTO ft_examples
               (system_prompt, user_message, assistant_reply, subject, tags,
                created_at, updated_at)
               VALUES (?,?,?,?,?,?,?)""",
            (system_prompt, user_message, assistant_reply,
             subject, json.dumps(tags or []), now, now),
        )
        row = c.execute(
            "SELECT * FROM ft_examples WHERE id=?", (cur.lastrowid,)
        ).fetchone()
    return _row(row)


def list_all(subject: Optional[str] = None) -> list[dict]:
    with _conn() as c:
        if subject:
            rows = c.execute(
                "SELECT * FROM ft_examples WHERE subject=? ORDER BY created_at DESC",
                (subject,),
            ).fetchall()
        else:
            rows = c.execute(
                "SELECT * FROM ft_examples ORDER BY created_at DESC"
            ).fetchall()
    return [_row(r) for r in rows]


def list_by_prefix(subject_prefix: str) -> list[dict]:
    """List all examples where subject starts with prefix (for fetching all tasks of a model)."""
    with _conn() as c:
        rows = c.execute(
            "SELECT * FROM ft_examples WHERE subject LIKE ? ORDER BY created_at ASC",
            (subject_prefix + "%",),
        ).fetchall()
    return [_row(r) for r in rows]


def export_jsonl_filtered(subject_prefix: str) -> str:
    """Export examples (filtered by subject prefix) as OpenAI fine-tune JSONL."""
    lines = []
    for ex in list_by_prefix(subject_prefix):
        msgs: list[dict] = []
        if ex["system_prompt"]:
            msgs.append({"role": "system", "content": ex["system_prompt"]})
        msgs.append({"role": "user",      "content": ex["user_message"]})
        msgs.append({"role": "assistant", "content": ex["assistant_reply"]})
        lines.append(json.dumps({"messages": msgs}, ensure_ascii=False))
    return "\n".join(lines)


def update(ex_id: int, **fields) -> Optional[dict]:
    allowed = {"system_prompt", "user_message", "assistant_reply", "subject", "tags"}
    data = {}
    for k, v in fields.items():
        if k not in allowed:
            continue
        data[k] = json.dumps(v) if k == "tags" else v
    if not data:
        return None
    data["updated_at"] = _now()
    cols = ", ".join(f"{k}=?" for k in data)
    with _conn() as c:
        c.execute(
            f"UPDATE ft_examples SET {cols} WHERE id=?",
            [*data.values(), ex_id],
        )
        row = c.execute(
            "SELECT * FROM ft_examples WHERE id=?", (ex_id,)
        ).fetchone()
    return _row(row) if row else None


def delete(ex_id: int) -> bool:
    with _conn() as c:
        cur = c.execute("DELETE FROM ft_examples WHERE id=?", (ex_id,))
    return cur.rowcount > 0


def stats() -> dict:
    with _conn() as c:
        total = c.execute("SELECT COUNT(*) FROM ft_examples").fetchone()[0]
        rows  = c.execute(
            "SELECT subject, COUNT(*) n FROM ft_examples GROUP BY subject ORDER BY n DESC"
        ).fetchall()
    return {
        "total":      total,
        "by_subject": {r["subject"] or "(none)": r["n"] for r in rows},
    }


def export_jsonl() -> str:
    """Return all examples as OpenAI fine-tune JSONL (one JSON object per line)."""
    lines = []
    for ex in list_all():
        msgs: list[dict] = []
        if ex["system_prompt"]:
            msgs.append({"role": "system", "content": ex["system_prompt"]})
        msgs.append({"role": "user",      "content": ex["user_message"]})
        msgs.append({"role": "assistant", "content": ex["assistant_reply"]})
        lines.append(json.dumps({"messages": msgs}, ensure_ascii=False))
    return "\n".join(lines)
