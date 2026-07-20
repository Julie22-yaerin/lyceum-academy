"""
Teams — the group plan's shared workspace.

A team is up to 3 accounts (plans.PLAN_CATALOG['team'].seats) sharing:
  - one workspace (the team itself),
  - the AI-provided document library (Second Brain — already global),
  - a team chat room (simple message log, polled by the client),
  - a document space where members author their own documents and mark each
    one private (author only), team (members only) or public.

Personal-plan users can author documents too — docs with team_id NULL are
personal; `visibility='public'` makes them readable by anyone signed in.

Same storage pattern as quanta.py: SQLite tables in finetune.db keyed by
Firebase UID strings.
"""

from __future__ import annotations

import os
import sqlite3
import uuid
from datetime import datetime, timezone
from typing import Any

from app.services import plans as plans_svc

_HERE = os.path.dirname(os.path.abspath(__file__))
DB_PATH = os.path.join(_HERE, "../../finetune.db")

MAX_SEATS = plans_svc.PLAN_CATALOG["team"]["seats"]

_DDL = """
CREATE TABLE IF NOT EXISTS teams (
    id         TEXT PRIMARY KEY,
    name       TEXT NOT NULL,
    owner_uid  TEXT NOT NULL,
    created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS team_members (
    team_id   TEXT NOT NULL,
    user_id   TEXT NOT NULL,
    email     TEXT NOT NULL DEFAULT '',
    role      TEXT NOT NULL DEFAULT 'member',
    joined_at TEXT NOT NULL,
    PRIMARY KEY (team_id, user_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_team_members_user ON team_members(user_id);

CREATE TABLE IF NOT EXISTS team_invites (
    id         TEXT PRIMARY KEY,
    team_id    TEXT NOT NULL,
    email      TEXT NOT NULL,
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS team_messages (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    team_id    TEXT NOT NULL,
    user_id    TEXT NOT NULL,
    author     TEXT NOT NULL DEFAULT '',
    content    TEXT NOT NULL,
    created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_team_messages ON team_messages(team_id, id);

CREATE TABLE IF NOT EXISTS user_documents (
    id         TEXT PRIMARY KEY,
    author_uid TEXT NOT NULL,
    team_id    TEXT,
    title      TEXT NOT NULL,
    content    TEXT NOT NULL DEFAULT '',
    folder     TEXT NOT NULL DEFAULT '',
    visibility TEXT NOT NULL DEFAULT 'private',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_user_documents_author ON user_documents(author_uid, updated_at);
CREATE INDEX IF NOT EXISTS idx_user_documents_team ON user_documents(team_id, updated_at);
"""

_VISIBILITIES = {"private", "team", "public"}


def _conn() -> sqlite3.Connection:
    c = sqlite3.connect(DB_PATH)
    c.row_factory = sqlite3.Row
    return c


def init_db() -> None:
    with _conn() as c:
        c.executescript(_DDL)


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


# ── Teams / membership ──────────────────────────────────────────────────────


def my_team(user_id: str) -> dict[str, Any] | None:
    with _conn() as c:
        c.executescript(_DDL)
        row = c.execute(
            "SELECT t.* FROM teams t JOIN team_members m ON m.team_id = t.id WHERE m.user_id=?",
            (user_id,),
        ).fetchone()
        if not row:
            return None
        members = [
            dict(m) for m in c.execute(
                "SELECT user_id, email, role, joined_at FROM team_members WHERE team_id=?",
                (row["id"],),
            ).fetchall()
        ]
        invites = [
            dict(i) for i in c.execute(
                "SELECT id, email, created_at FROM team_invites WHERE team_id=?",
                (row["id"],),
            ).fetchall()
        ]
    return {**dict(row), "members": members, "pending_invites": invites, "max_seats": MAX_SEATS}


def create_team(user_id: str, name: str, email: str = "") -> dict[str, Any]:
    if my_team(user_id):
        return {"ok": False, "error": "already_in_team"}
    team_id = uuid.uuid4().hex[:12]
    now = _now()
    with _conn() as c:
        c.execute("INSERT INTO teams (id, name, owner_uid, created_at) VALUES (?,?,?,?)",
                  (team_id, (name or "My Team").strip()[:60], user_id, now))
        c.execute("INSERT INTO team_members (team_id, user_id, email, role, joined_at) VALUES (?,?,?,?,?)",
                  (team_id, user_id, email, "owner", now))
    plans_svc.select_plan(user_id, "team")
    return {"ok": True, "team": my_team(user_id)}


def invite_member(user_id: str, email: str) -> dict[str, Any]:
    team = my_team(user_id)
    if not team:
        return {"ok": False, "error": "no_team"}
    if team["owner_uid"] != user_id:
        return {"ok": False, "error": "not_owner"}
    email = (email or "").strip().lower()
    if not email or "@" not in email:
        return {"ok": False, "error": "invalid_email"}
    occupied = len(team["members"]) + len(team["pending_invites"])
    if occupied >= MAX_SEATS:
        return {"ok": False, "error": "team_full"}
    with _conn() as c:
        c.execute("INSERT INTO team_invites (id, team_id, email, created_at) VALUES (?,?,?,?)",
                  (uuid.uuid4().hex[:10], team["id"], email, _now()))
    return {"ok": True, "team": my_team(user_id)}


def accept_invite(user_id: str, email: str) -> dict[str, Any]:
    """Called after sign-in: if this account's email has a pending invite,
    join that team (and adopt the team plan)."""
    email = (email or "").strip().lower()
    if not email or my_team(user_id):
        return {"ok": False, "error": "no_invite"}
    with _conn() as c:
        c.executescript(_DDL)
        inv = c.execute("SELECT * FROM team_invites WHERE email=? ORDER BY created_at LIMIT 1",
                        (email,)).fetchone()
        if not inv:
            return {"ok": False, "error": "no_invite"}
        seats = c.execute("SELECT COUNT(*) FROM team_members WHERE team_id=?", (inv["team_id"],)).fetchone()[0]
        if seats >= MAX_SEATS:
            c.execute("DELETE FROM team_invites WHERE id=?", (inv["id"],))
            return {"ok": False, "error": "team_full"}
        c.execute("INSERT OR IGNORE INTO team_members (team_id, user_id, email, role, joined_at) VALUES (?,?,?,?,?)",
                  (inv["team_id"], user_id, email, "member", _now()))
        c.execute("DELETE FROM team_invites WHERE id=?", (inv["id"],))
    plans_svc.select_plan(user_id, "team")
    return {"ok": True, "team": my_team(user_id)}


def leave_team(user_id: str) -> dict[str, Any]:
    team = my_team(user_id)
    if not team:
        return {"ok": False, "error": "no_team"}
    with _conn() as c:
        c.execute("DELETE FROM team_members WHERE team_id=? AND user_id=?", (team["id"], user_id))
        remaining = c.execute("SELECT COUNT(*) FROM team_members WHERE team_id=?", (team["id"],)).fetchone()[0]
        if remaining == 0:
            c.execute("DELETE FROM teams WHERE id=?", (team["id"],))
            c.execute("DELETE FROM team_invites WHERE team_id=?", (team["id"],))
            c.execute("DELETE FROM team_messages WHERE team_id=?", (team["id"],))
    return {"ok": True}


# ── Team chat room ──────────────────────────────────────────────────────────


def post_message(user_id: str, author: str, content: str) -> dict[str, Any]:
    team = my_team(user_id)
    if not team:
        return {"ok": False, "error": "no_team"}
    content = (content or "").strip()
    if not content:
        return {"ok": False, "error": "empty"}
    with _conn() as c:
        c.execute(
            "INSERT INTO team_messages (team_id, user_id, author, content, created_at) VALUES (?,?,?,?,?)",
            (team["id"], user_id, author[:60], content[:4000], _now()),
        )
    return {"ok": True}


def list_messages(user_id: str, after_id: int = 0, limit: int = 100) -> dict[str, Any]:
    team = my_team(user_id)
    if not team:
        return {"ok": False, "error": "no_team", "messages": []}
    with _conn() as c:
        rows = c.execute(
            "SELECT id, user_id, author, content, created_at FROM team_messages "
            "WHERE team_id=? AND id>? ORDER BY id DESC LIMIT ?",
            (team["id"], after_id, min(limit, 200)),
        ).fetchall()
    return {"ok": True, "messages": [dict(r) for r in reversed(rows)]}


# ── Authored documents (personal + team, private/team/public) ──────────────


def save_document(
    user_id: str, title: str, content: str,
    doc_id: str | None = None, folder: str = "", visibility: str = "private",
    share_with_team: bool = False,
) -> dict[str, Any]:
    if visibility not in _VISIBILITIES:
        visibility = "private"
    team = my_team(user_id) if (share_with_team or visibility == "team") else None
    team_id = team["id"] if team else None
    if visibility == "team" and not team_id:
        visibility = "private"
    now = _now()
    with _conn() as c:
        c.executescript(_DDL)
        if doc_id:
            row = c.execute("SELECT author_uid FROM user_documents WHERE id=?", (doc_id,)).fetchone()
            if not row or row["author_uid"] != user_id:
                return {"ok": False, "error": "not_found"}
            c.execute(
                "UPDATE user_documents SET title=?, content=?, folder=?, visibility=?, team_id=?, updated_at=? WHERE id=?",
                ((title or "Untitled")[:120], content, folder[:60], visibility, team_id, now, doc_id),
            )
        else:
            doc_id = uuid.uuid4().hex[:12]
            c.execute(
                "INSERT INTO user_documents (id, author_uid, team_id, title, content, folder, visibility, created_at, updated_at) "
                "VALUES (?,?,?,?,?,?,?,?,?)",
                (doc_id, user_id, team_id, (title or "Untitled")[:120], content, folder[:60], visibility, now, now),
            )
    return {"ok": True, "id": doc_id}


def list_documents(user_id: str) -> dict[str, Any]:
    """Own docs + team docs (visibility 'team'/'public' within my team) +
    other users' public docs (metadata only)."""
    team = my_team(user_id)
    team_id = team["id"] if team else None
    with _conn() as c:
        c.executescript(_DDL)
        mine = [dict(r) for r in c.execute(
            "SELECT id, title, folder, visibility, team_id, created_at, updated_at "
            "FROM user_documents WHERE author_uid=? ORDER BY updated_at DESC", (user_id,)).fetchall()]
        shared = []
        if team_id:
            shared = [dict(r) for r in c.execute(
                "SELECT id, title, folder, visibility, author_uid, created_at, updated_at "
                "FROM user_documents WHERE team_id=? AND author_uid<>? AND visibility IN ('team','public') "
                "ORDER BY updated_at DESC", (team_id, user_id)).fetchall()]
        public = [dict(r) for r in c.execute(
            "SELECT id, title, folder, author_uid, created_at, updated_at "
            "FROM user_documents WHERE visibility='public' AND author_uid<>? "
            "ORDER BY updated_at DESC LIMIT 50", (user_id,)).fetchall()]
    return {"mine": mine, "team": shared, "public": public}


def get_document(user_id: str, doc_id: str) -> dict[str, Any] | None:
    team = my_team(user_id)
    team_id = team["id"] if team else None
    with _conn() as c:
        row = c.execute("SELECT * FROM user_documents WHERE id=?", (doc_id,)).fetchone()
    if not row:
        return None
    doc = dict(row)
    if doc["author_uid"] == user_id or doc["visibility"] == "public":
        return doc
    if doc["visibility"] == "team" and team_id and doc["team_id"] == team_id:
        return doc
    return None


def delete_document(user_id: str, doc_id: str) -> dict[str, Any]:
    with _conn() as c:
        row = c.execute("SELECT author_uid FROM user_documents WHERE id=?", (doc_id,)).fetchone()
        if not row or row["author_uid"] != user_id:
            return {"ok": False, "error": "not_found"}
        c.execute("DELETE FROM user_documents WHERE id=?", (doc_id,))
    return {"ok": True}
