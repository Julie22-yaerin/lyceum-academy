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

-- The admin "Training AI" board's per-model Role & Characteristic (system
-- prompt / persona) — was localStorage-only, so it never actually made it
-- into a model's exported training data unless copy-pasted into every
-- example by hand. Persisting it here lets export_jsonl_filtered() fall
-- back to it for examples that weren't given their own system_prompt.
CREATE TABLE IF NOT EXISTS ai_model_roles (
    model_id        TEXT    PRIMARY KEY,
    role            TEXT    NOT NULL DEFAULT '',
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
        c.executescript(DDL)


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


def export_jsonl_filtered(subject_prefix: str, model_id: Optional[str] = None) -> str:
    """Export examples (filtered by subject prefix) as OpenAI fine-tune JSONL.

    Examples created without their own system_prompt fall back to the
    model's persisted Role & Characteristic (see get_role()), so the role
    an admin sets on the Training AI board always makes it into the job
    even for examples that predate that role or never had one attached.
    """
    fallback_role = get_role(model_id) if model_id else ""
    lines = []
    for ex in list_by_prefix(subject_prefix):
        msgs: list[dict] = []
        system_prompt = ex["system_prompt"] or fallback_role
        if system_prompt:
            msgs.append({"role": "system", "content": system_prompt})
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


# ── Per-model Role & Characteristic ──────────────────────────────────────────
# The Admin "Training AI" board's system-prompt/persona field for each model
# (previously localStorage-only — see admin/index.html's loadRole/saveRole).

def get_role(model_id: str) -> str:
    with _conn() as c:
        row = c.execute(
            "SELECT role FROM ai_model_roles WHERE model_id=?", (model_id,)
        ).fetchone()
    return row["role"] if row else ""


def set_role(model_id: str, role: str) -> dict:
    now = _now()
    with _conn() as c:
        c.execute(
            """INSERT INTO ai_model_roles (model_id, role, updated_at) VALUES (?,?,?)
               ON CONFLICT(model_id) DO UPDATE SET role=excluded.role, updated_at=excluded.updated_at""",
            (model_id, role, now),
        )
    return {"model_id": model_id, "role": role, "updated_at": now}


def list_roles() -> dict[str, str]:
    with _conn() as c:
        rows = c.execute("SELECT model_id, role FROM ai_model_roles").fetchall()
    return {r["model_id"]: r["role"] for r in rows}
