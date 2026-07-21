"""
Library — the public research/blog sharing page (thelyceum.site/library).

Any signed-in user can publish a post (a short blog write-up or a research
paper share, optionally linking an external PDF). Anyone — signed in or
not — can read posts, comments, and reaction counts; commenting and
reacting requires an account (there are no anonymous accounts anymore,
registration is closed/vetted — see app.services.applications).

Same lightweight SQLite-in-finetune.db pattern as quanta.py/second_brain.py.
"""

from __future__ import annotations

import os
import sqlite3
import uuid
from datetime import datetime, timezone
from typing import Any

_HERE = os.path.dirname(os.path.abspath(__file__))
DB_PATH = os.path.join(_HERE, "../../finetune.db")

POST_TYPES = {"blog", "paper"}
ALLOWED_EMOJI = {"👍", "❤️", "🤯", "💡", "🔥", "🤔"}

_DDL = """
CREATE TABLE IF NOT EXISTS library_posts (
    id           TEXT PRIMARY KEY,
    author_uid   TEXT NOT NULL,
    author_name  TEXT NOT NULL DEFAULT '',
    title        TEXT NOT NULL,
    type         TEXT NOT NULL DEFAULT 'blog',
    body         TEXT NOT NULL DEFAULT '',
    paper_url    TEXT NOT NULL DEFAULT '',
    created_at   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_library_posts_created ON library_posts(created_at DESC);

CREATE TABLE IF NOT EXISTS library_comments (
    id          TEXT PRIMARY KEY,
    post_id     TEXT NOT NULL,
    author_uid  TEXT NOT NULL,
    author_name TEXT NOT NULL DEFAULT '',
    content     TEXT NOT NULL,
    created_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_library_comments_post ON library_comments(post_id, created_at ASC);

CREATE TABLE IF NOT EXISTS library_reactions (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    post_id    TEXT NOT NULL,
    user_id    TEXT NOT NULL,
    emoji      TEXT NOT NULL,
    created_at TEXT NOT NULL,
    UNIQUE(post_id, user_id, emoji)
);
CREATE INDEX IF NOT EXISTS idx_library_reactions_post ON library_reactions(post_id);
"""


def _conn() -> sqlite3.Connection:
    c = sqlite3.connect(DB_PATH)
    c.row_factory = sqlite3.Row
    return c


def init_db() -> None:
    with _conn() as c:
        c.executescript(_DDL)


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _reaction_counts(c: sqlite3.Connection, post_id: str) -> dict[str, int]:
    rows = c.execute(
        "SELECT emoji, COUNT(*) as n FROM library_reactions WHERE post_id=? GROUP BY emoji", (post_id,)
    ).fetchall()
    return {r["emoji"]: r["n"] for r in rows}


def create_post(
    uid: str, author_name: str, title: str, body: str, post_type: str = "blog", paper_url: str = "",
) -> dict[str, Any]:
    title = (title or "").strip()
    if not title:
        return {"ok": False, "error": "title_required"}
    if post_type not in POST_TYPES:
        post_type = "blog"
    post_id = uuid.uuid4().hex[:16]
    now = _now()
    with _conn() as c:
        c.executescript(_DDL)
        c.execute(
            "INSERT INTO library_posts (id, author_uid, author_name, title, type, body, paper_url, created_at) "
            "VALUES (?,?,?,?,?,?,?,?)",
            (post_id, uid, author_name[:80], title[:200], post_type, body[:20000], paper_url[:500], now),
        )
    return {"ok": True, "id": post_id}


def list_posts(limit: int = 50, offset: int = 0) -> list[dict[str, Any]]:
    with _conn() as c:
        c.executescript(_DDL)
        rows = c.execute(
            "SELECT * FROM library_posts ORDER BY created_at DESC LIMIT ? OFFSET ?", (limit, offset)
        ).fetchall()
        out = []
        for r in rows:
            post = dict(r)
            comment_count = c.execute(
                "SELECT COUNT(*) FROM library_comments WHERE post_id=?", (post["id"],)
            ).fetchone()[0]
            post["comment_count"] = comment_count
            post["reactions"] = _reaction_counts(c, post["id"])
            out.append(post)
    return out


def get_post(post_id: str) -> dict[str, Any] | None:
    with _conn() as c:
        c.executescript(_DDL)
        row = c.execute("SELECT * FROM library_posts WHERE id=?", (post_id,)).fetchone()
        if not row:
            return None
        post = dict(row)
        post["reactions"] = _reaction_counts(c, post_id)
        comments = c.execute(
            "SELECT id, author_name, content, created_at FROM library_comments "
            "WHERE post_id=? ORDER BY created_at ASC", (post_id,)
        ).fetchall()
        post["comments"] = [dict(cm) for cm in comments]
    return post


def add_comment(post_id: str, uid: str, author_name: str, content: str) -> dict[str, Any]:
    content = (content or "").strip()
    if not content:
        return {"ok": False, "error": "empty_comment"}
    with _conn() as c:
        c.executescript(_DDL)
        exists = c.execute("SELECT 1 FROM library_posts WHERE id=?", (post_id,)).fetchone()
        if not exists:
            return {"ok": False, "error": "not_found"}
        comment_id = uuid.uuid4().hex[:16]
        c.execute(
            "INSERT INTO library_comments (id, post_id, author_uid, author_name, content, created_at) "
            "VALUES (?,?,?,?,?,?)",
            (comment_id, post_id, uid, author_name[:80], content[:4000], _now()),
        )
    return {"ok": True, "id": comment_id}


def toggle_reaction(post_id: str, uid: str, emoji: str) -> dict[str, Any]:
    if emoji not in ALLOWED_EMOJI:
        return {"ok": False, "error": "invalid_emoji"}
    with _conn() as c:
        c.executescript(_DDL)
        exists = c.execute(
            "SELECT id FROM library_reactions WHERE post_id=? AND user_id=? AND emoji=?", (post_id, uid, emoji)
        ).fetchone()
        if exists:
            c.execute("DELETE FROM library_reactions WHERE id=?", (exists["id"],))
            action = "removed"
        else:
            c.execute(
                "INSERT INTO library_reactions (post_id, user_id, emoji, created_at) VALUES (?,?,?,?)",
                (post_id, uid, emoji, _now()),
            )
            action = "added"
        counts = _reaction_counts(c, post_id)
    return {"ok": True, "action": action, "reactions": counts}
