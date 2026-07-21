"""
Orders — submissions from the personal Second Brain page
(thelyceum.site/secondbrain, accepted-accounts only): a student adds their
own documents plus a study schedule (self-built or AI-suggested) and
submits it as an "order" for the Lyceum team to turn into a personalized
plan. Lands in the admin "Orders" queue (app/routers/admin.py) — the same
accept/decline pattern as applications.py, FIFO (oldest pending first).

Same lightweight SQLite-in-finetune.db pattern as the rest of this module family.
"""

from __future__ import annotations

import json
import os
import sqlite3
import uuid
from datetime import datetime, timezone
from typing import Any

_HERE = os.path.dirname(os.path.abspath(__file__))
DB_PATH = os.path.join(_HERE, "../../finetune.db")

STATUSES = {"pending", "accepted", "declined"}

_DDL = """
CREATE TABLE IF NOT EXISTS orders (
    id           TEXT PRIMARY KEY,
    user_id      TEXT NOT NULL,
    email        TEXT NOT NULL DEFAULT '',
    documents    TEXT NOT NULL DEFAULT '[]',
    schedule     TEXT NOT NULL DEFAULT '[]',
    ai_generated INTEGER NOT NULL DEFAULT 0,
    note         TEXT NOT NULL DEFAULT '',
    status       TEXT NOT NULL DEFAULT 'pending',
    created_at   TEXT NOT NULL,
    decided_at   TEXT
);
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status, created_at ASC);
CREATE INDEX IF NOT EXISTS idx_orders_user ON orders(user_id, created_at DESC);
"""


def _conn() -> sqlite3.Connection:
    c = sqlite3.connect(DB_PATH)
    c.row_factory = sqlite3.Row
    return c


def init_db() -> None:
    with _conn() as c:
        c.executescript(_DDL)


def _row_to_dict(row: sqlite3.Row) -> dict[str, Any]:
    d = dict(row)
    d["documents"] = json.loads(d.get("documents") or "[]")
    d["schedule"] = json.loads(d.get("schedule") or "[]")
    d["ai_generated"] = bool(d.get("ai_generated"))
    return d


def create_order(
    user_id: str, email: str, documents: list[dict[str, Any]], schedule: list[dict[str, Any]],
    ai_generated: bool = False, note: str = "",
) -> dict[str, Any]:
    if not documents and not schedule:
        return {"ok": False, "error": "empty_order"}
    order_id = uuid.uuid4().hex[:16]
    now = datetime.now(timezone.utc).isoformat()
    with _conn() as c:
        c.executescript(_DDL)
        c.execute(
            "INSERT INTO orders (id, user_id, email, documents, schedule, ai_generated, note, status, created_at) "
            "VALUES (?,?,?,?,?,?,?,?,?)",
            (order_id, user_id, email, json.dumps(documents), json.dumps(schedule),
             int(ai_generated), note[:2000], "pending", now),
        )
    return {"ok": True, "id": order_id}


def list_my_orders(user_id: str) -> list[dict[str, Any]]:
    with _conn() as c:
        c.executescript(_DDL)
        rows = c.execute(
            "SELECT * FROM orders WHERE user_id=? ORDER BY created_at DESC", (user_id,)
        ).fetchall()
    return [_row_to_dict(r) for r in rows]


def list_orders(status: str | None = None) -> list[dict[str, Any]]:
    with _conn() as c:
        c.executescript(_DDL)
        if status and status in STATUSES:
            rows = c.execute(
                "SELECT * FROM orders WHERE status=? ORDER BY created_at ASC", (status,)
            ).fetchall()
        else:
            rows = c.execute("SELECT * FROM orders ORDER BY created_at ASC").fetchall()
    return [_row_to_dict(r) for r in rows]


def decide(order_id: str, accept: bool) -> dict[str, Any]:
    now = datetime.now(timezone.utc).isoformat()
    with _conn() as c:
        c.executescript(_DDL)
        row = c.execute("SELECT id FROM orders WHERE id=?", (order_id,)).fetchone()
        if not row:
            return {"ok": False, "error": "not_found"}
        c.execute(
            "UPDATE orders SET status=?, decided_at=? WHERE id=?",
            ("accepted" if accept else "declined", now, order_id),
        )
    return {"ok": True, "status": "accepted" if accept else "declined"}
