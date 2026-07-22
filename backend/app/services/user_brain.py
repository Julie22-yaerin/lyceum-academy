"""
Per-user Second Brain — the personalized knowledge base an admin builds
WITH Opus for each accepted student after their onboarding meeting.

Unlike the shared vault (second_brain.py), everything here is scoped to one
user's workspace: their notes are injected into every AI call THEY make,
and nobody else's. The admin console has a dedicated chat with Opus whose
transcript auto-saves; distilled notes get committed into the student's
brain from there.

Also home to:
  - per-user tool curation (which Tool Dock tools an account sees, chosen
    by the admin + Opus during setup)
  - per-user preferences (e.g. the "use my data for model training" toggle)
  - the learning-methodology glossary (TOP DOWN / HARD TO EASY / JUST IN
    TIME) every Lyceum AI is briefed on

Identity: rows are keyed by `user_key`, which may be a Firebase UID or an
email — admins usually only know the email (from the application card)
before the student's first sign-in, while runtime calls know the UID. Reads
accept a list of candidate keys and match any.

Storage: same SQLite-in-finetune.db pattern as quanta.py/applications.py.
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

_DDL = """
CREATE TABLE IF NOT EXISTS user_brain_notes (
    id         TEXT PRIMARY KEY,
    user_key   TEXT NOT NULL,
    title      TEXT NOT NULL,
    content    TEXT NOT NULL,
    subject    TEXT NOT NULL DEFAULT '',
    source     TEXT NOT NULL DEFAULT 'admin',   -- admin | opus-chat | student
    created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_ubn_user ON user_brain_notes(user_key, created_at DESC);

CREATE TABLE IF NOT EXISTS user_brain_chats (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    user_key   TEXT NOT NULL,
    role       TEXT NOT NULL,                   -- admin | opus
    content    TEXT NOT NULL,
    created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_ubc_user ON user_brain_chats(user_key, id ASC);

CREATE TABLE IF NOT EXISTS user_tools (
    user_key   TEXT PRIMARY KEY,
    tools      TEXT NOT NULL DEFAULT '[]',      -- JSON array of tool ids
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS user_prefs (
    user_key       TEXT PRIMARY KEY,
    allow_training INTEGER NOT NULL DEFAULT 1,
    updated_at     TEXT NOT NULL
);

-- Admin-filled student profile — the "workspace + customer info" form filled
-- in from the student's card in the admin console.
CREATE TABLE IF NOT EXISTS student_profile (
    user_key           TEXT PRIMARY KEY,
    liked_subjects     TEXT NOT NULL DEFAULT '[]',   -- JSON array
    disliked_subjects  TEXT NOT NULL DEFAULT '[]',   -- JSON array
    required_subjects  TEXT NOT NULL DEFAULT '[]',   -- JSON array
    major              TEXT NOT NULL DEFAULT '',
    agrees_top_down    INTEGER NOT NULL DEFAULT 0,
    advance_to_basic   INTEGER NOT NULL DEFAULT 0,
    device             TEXT NOT NULL DEFAULT '',
    has_adhd           INTEGER NOT NULL DEFAULT 0,
    updated_at         TEXT NOT NULL
);
"""

# Every AI role in the Lyceum is briefed on these study-strategy terms so a
# student (or the admin's curriculum notes) can use them as shorthand.
LEARNING_METHODS_PROMPT = (
    "=== LYCEUM LEARNING METHODOLOGY GLOSSARY ===\n"
    "When the student, their Second Brain, or their study plan uses these terms, "
    "apply them exactly as defined:\n"
    "- TOP DOWN: teach from the central, most important concept first, then descend "
    "into its smaller supporting branches. Big picture before details; each detail is "
    "introduced only as a branch of the core idea.\n"
    "- HARD TO EASY: reverse-order learning. Start from the HARDEST problem or concept "
    "in the topic, and pull in the easier supporting ideas only as they become necessary "
    "to crack it. Struggle first, scaffolding second.\n"
    "- JUST IN TIME LEARNING: teach ONLY the parts the student critically needs right now "
    "for their immediate goal, plus the minimum extra context required to truly understand "
    "those parts. Aggressively skip everything else.\n"
)

# The full tool roster the Tool Dock can render, mirrored in
# src/context/ToolDockContext.tsx. Tier 2 tools carry a neural-overload
# warning client-side.
TIER1_TOOLS = ["feynman", "toolmap", "reverse-build", "games", "spaced-repetition"]
TIER2_TOOLS = [
    "node-map", "tactile-friction", "shatter", "auditory-gating",
    "membrane-flow", "steric-snap", "topo-lock", "time-lapse",
]
# Simulation/game tools, grouped separately in the admin curation UI so
# admins can find and assign them without hunting through Tier 1/2.
GAME_TOOLS = ["game-builder"]
ALL_TOOLS = TIER1_TOOLS + TIER2_TOOLS + GAME_TOOLS

# Default for accounts the admin hasn't curated yet: full tier 1, no tier 2.
DEFAULT_TOOLS = list(TIER1_TOOLS)


def _conn() -> sqlite3.Connection:
    c = sqlite3.connect(DB_PATH)
    c.row_factory = sqlite3.Row
    return c


def init_db() -> None:
    with _conn() as c:
        c.executescript(_DDL)


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _keys(user_keys: str | list[str]) -> list[str]:
    if isinstance(user_keys, str):
        user_keys = [user_keys]
    return [k.strip().lower() if "@" in k else k.strip() for k in user_keys if k and k.strip()]


# ── Brain notes ─────────────────────────────────────────────────────────────

def add_note(user_key: str, title: str, content: str, subject: str = "", source: str = "admin") -> dict[str, Any]:
    note_id = uuid.uuid4().hex[:16]
    key = _keys(user_key)[0]
    with _conn() as c:
        c.executescript(_DDL)
        c.execute(
            "INSERT INTO user_brain_notes (id, user_key, title, content, subject, source, created_at) "
            "VALUES (?,?,?,?,?,?,?)",
            (note_id, key, title[:200], content[:40000], subject[:80], source, _now()),
        )
    return {"ok": True, "id": note_id}


def list_notes(user_keys: str | list[str]) -> list[dict[str, Any]]:
    keys = _keys(user_keys)
    if not keys:
        return []
    ph = ",".join("?" * len(keys))
    with _conn() as c:
        c.executescript(_DDL)
        rows = c.execute(
            f"SELECT * FROM user_brain_notes WHERE user_key IN ({ph}) ORDER BY created_at DESC", keys
        ).fetchall()
    return [dict(r) for r in rows]


def delete_note(note_id: str) -> bool:
    with _conn() as c:
        c.executescript(_DDL)
        cur = c.execute("DELETE FROM user_brain_notes WHERE id=?", (note_id,))
    return cur.rowcount > 0


def brain_context(user_keys: str | list[str], max_chars: int = 6000) -> str:
    """Compiled context block injected into every AI call the student makes.
    Their whole team of AIs sees it — but only within their workspace."""
    notes = list_notes(user_keys)
    if not notes:
        return ""
    parts: list[str] = []
    used = 0
    for n in notes:
        chunk = f"## {n['title']}" + (f" [{n['subject']}]" if n["subject"] else "") + f"\n{n['content']}\n"
        if used + len(chunk) > max_chars:
            remaining = max_chars - used
            if remaining > 200:
                parts.append(chunk[:remaining] + "…")
            break
        parts.append(chunk)
        used += len(chunk)
    return (
        "=== STUDENT'S PERSONAL SECOND BRAIN (private to this workspace) ===\n"
        "Curated by the Lyceum team specifically for THIS student after their onboarding "
        "meeting. Treat it as the authoritative picture of who they are, what they're "
        "working toward, and how their curriculum is structured. Follow any study-method "
        "directives in it (TOP DOWN / HARD TO EASY / JUST IN TIME LEARNING).\n\n"
        + "\n".join(parts)
    )


def profile_context(user_keys: str | list[str]) -> str:
    """Formats the admin-filled student profile (likes/dislikes, major,
    methodology preferences, device, ADHD/focus note) as a system prompt
    block, if the admin has filled anything in beyond the defaults."""
    p = get_profile(user_keys)
    if p == dict(_PROFILE_DEFAULTS):
        return ""
    lines = ["=== STUDENT PROFILE (set by admin) ==="]
    if p["major"]:
        lines.append(f"Major: {p['major']}")
    if p["required_subjects"]:
        lines.append(f"Must study: {', '.join(p['required_subjects'])}")
    if p["liked_subjects"]:
        lines.append(f"Likes: {', '.join(p['liked_subjects'])}")
    if p["disliked_subjects"]:
        lines.append(f"Dislikes: {', '.join(p['disliked_subjects'])}")
    lines.append(f"Prefers TOP DOWN teaching: {'yes' if p['agrees_top_down'] else 'no'}")
    lines.append(f"Prefers advance-to-basic (start advanced, work back to fundamentals): {'yes' if p['advance_to_basic'] else 'no'}")
    if p["device"]:
        lines.append(f"Studies on: {p['device']}")
    if p["has_adhd"]:
        lines.append("Has ADHD or difficulty concentrating — keep explanations short, break tasks into small steps, minimize distractions.")
    return "\n".join(lines)


def system_context_for_user(user_keys: str | list[str]) -> str:
    """Learning-method glossary + the student's personal brain + their admin
    profile, ready to drop in as one system message. Glossary always
    present; the other two only if the admin has actually filled them in."""
    brain = brain_context(user_keys)
    profile = profile_context(user_keys)
    out = LEARNING_METHODS_PROMPT
    if profile:
        out += "\n" + profile
    if brain:
        out += "\n" + brain
    return out


# ── Admin ↔ Opus brain-building chat (auto-saved) ───────────────────────────

def append_chat(user_key: str, role: str, content: str) -> None:
    key = _keys(user_key)[0]
    with _conn() as c:
        c.executescript(_DDL)
        c.execute(
            "INSERT INTO user_brain_chats (user_key, role, content, created_at) VALUES (?,?,?,?)",
            (key, role, content[:40000], _now()),
        )


def chat_history(user_key: str, limit: int = 200) -> list[dict[str, Any]]:
    keys = _keys(user_key)
    if not keys:
        return []
    with _conn() as c:
        c.executescript(_DDL)
        rows = c.execute(
            "SELECT * FROM user_brain_chats WHERE user_key=? ORDER BY id ASC LIMIT ?", (keys[0], limit)
        ).fetchall()
    return [dict(r) for r in rows]


async def opus_brain_chat(user_key: str, message: str) -> dict[str, Any]:
    """One admin turn in the brain-building conversation with Opus. The whole
    exchange auto-saves. Opus sees the student's application card (if any),
    current brain notes, and the running transcript."""
    from app.core.config import settings
    from app.services.ai_roles.providers import anthropic_chat, extract_anthropic_text

    key = settings.second_brain_anthropic_key or settings.anthropic_api_key
    if not key:
        return {"ok": False, "error": "no_anthropic_key"}

    append_chat(user_key, "admin", message)

    # Application card (best-effort) — gives Opus the student's own answers.
    app_card = ""
    try:
        from app.services import applications as applications_svc
        for a in applications_svc.list_applications():
            if a.get("email") == _keys(user_key)[0] or a.get("id") == user_key:
                app_card = json.dumps(
                    {"name": a.get("name"), "email": a.get("email"),
                     "answers": a.get("answers"), "vector": a.get("vector")},
                    ensure_ascii=False,
                )
                break
    except Exception:
        pass

    existing = brain_context(user_key, max_chars=4000)
    system = (
        "You are Opus, the Lyceum's Second Brain architect. You work WITH the admin "
        "(who just met this student) to design the student's personal Second Brain: a small "
        "set of dense notes that will silently brief every AI tutor in the student's workspace.\n"
        + LEARNING_METHODS_PROMPT +
        "\nWrite in the admin's language (usually Vietnamese). Ask sharp questions about the "
        "meeting when information is missing. When the admin asks you to draft brain notes, "
        "output each note as a fenced block starting with a line 'NOTE: <title> | <subject>' "
        "followed by the note body — the console has a button to commit those blocks into "
        "the student's brain verbatim.\n"
        + (f"\nSTUDENT APPLICATION CARD:\n{app_card}\n" if app_card else "")
        + (f"\nCURRENT BRAIN CONTENT:\n{existing}\n" if existing else "\nThe student's brain is still empty.")
    )

    history = chat_history(user_key, limit=40)
    msgs = [
        {"role": "user" if h["role"] == "admin" else "assistant", "content": h["content"]}
        for h in history
    ]

    try:
        data = await anthropic_chat(
            msgs, model=settings.anthropic_claude_opus_model,
            system=system, temperature=0.6, max_tokens=3000, api_key=key,
        )
        reply = extract_anthropic_text(data).strip()
    except Exception as e:
        return {"ok": False, "error": f"opus_call_failed: {e}"}

    append_chat(user_key, "opus", reply)
    return {"ok": True, "reply": reply}


# ── Per-user tool curation ──────────────────────────────────────────────────

def get_tools(user_keys: str | list[str]) -> dict[str, Any]:
    keys = _keys(user_keys)
    with _conn() as c:
        c.executescript(_DDL)
        for k in keys:
            row = c.execute("SELECT tools FROM user_tools WHERE user_key=?", (k,)).fetchone()
            if row:
                try:
                    return {"tools": json.loads(row["tools"]), "curated": True}
                except Exception:
                    break
    return {"tools": DEFAULT_TOOLS, "curated": False}


def set_tools(user_key: str, tools: list[str]) -> dict[str, Any]:
    clean = [t for t in tools if t in ALL_TOOLS]
    key = _keys(user_key)[0]
    with _conn() as c:
        c.executescript(_DDL)
        c.execute(
            "INSERT INTO user_tools (user_key, tools, updated_at) VALUES (?,?,?) "
            "ON CONFLICT(user_key) DO UPDATE SET tools=excluded.tools, updated_at=excluded.updated_at",
            (key, json.dumps(clean), _now()),
        )
    return {"ok": True, "tools": clean}


# ── Preferences (training-data opt-out) ─────────────────────────────────────

def get_prefs(user_keys: str | list[str]) -> dict[str, Any]:
    keys = _keys(user_keys)
    with _conn() as c:
        c.executescript(_DDL)
        for k in keys:
            row = c.execute("SELECT allow_training FROM user_prefs WHERE user_key=?", (k,)).fetchone()
            if row:
                return {"allow_training": bool(row["allow_training"])}
    return {"allow_training": True}


def set_prefs(user_key: str, allow_training: bool) -> dict[str, Any]:
    key = _keys(user_key)[0]
    with _conn() as c:
        c.executescript(_DDL)
        c.execute(
            "INSERT INTO user_prefs (user_key, allow_training, updated_at) VALUES (?,?,?) "
            "ON CONFLICT(user_key) DO UPDATE SET allow_training=excluded.allow_training, updated_at=excluded.updated_at",
            (key, int(allow_training), _now()),
        )
    return {"ok": True, "allow_training": allow_training}


# ── Student profile (workspace + customer info form) ────────────────────────

_PROFILE_DEFAULTS: dict[str, Any] = {
    "liked_subjects": [], "disliked_subjects": [], "required_subjects": [],
    "major": "", "agrees_top_down": False, "advance_to_basic": False,
    "device": "", "has_adhd": False,
}


def get_profile(user_keys: str | list[str]) -> dict[str, Any]:
    keys = _keys(user_keys)
    with _conn() as c:
        c.executescript(_DDL)
        for k in keys:
            row = c.execute("SELECT * FROM student_profile WHERE user_key=?", (k,)).fetchone()
            if row:
                return {
                    "liked_subjects": json.loads(row["liked_subjects"]),
                    "disliked_subjects": json.loads(row["disliked_subjects"]),
                    "required_subjects": json.loads(row["required_subjects"]),
                    "major": row["major"],
                    "agrees_top_down": bool(row["agrees_top_down"]),
                    "advance_to_basic": bool(row["advance_to_basic"]),
                    "device": row["device"],
                    "has_adhd": bool(row["has_adhd"]),
                }
    return dict(_PROFILE_DEFAULTS)


def set_profile(user_key: str, **fields: Any) -> dict[str, Any]:
    key = _keys(user_key)[0]
    merged = {**_PROFILE_DEFAULTS, **fields}
    with _conn() as c:
        c.executescript(_DDL)
        c.execute(
            "INSERT INTO student_profile "
            "(user_key, liked_subjects, disliked_subjects, required_subjects, major, "
            " agrees_top_down, advance_to_basic, device, has_adhd, updated_at) "
            "VALUES (?,?,?,?,?,?,?,?,?,?) "
            "ON CONFLICT(user_key) DO UPDATE SET "
            "liked_subjects=excluded.liked_subjects, disliked_subjects=excluded.disliked_subjects, "
            "required_subjects=excluded.required_subjects, major=excluded.major, "
            "agrees_top_down=excluded.agrees_top_down, advance_to_basic=excluded.advance_to_basic, "
            "device=excluded.device, has_adhd=excluded.has_adhd, updated_at=excluded.updated_at",
            (
                key, json.dumps(merged["liked_subjects"]), json.dumps(merged["disliked_subjects"]),
                json.dumps(merged["required_subjects"]), merged["major"][:120],
                int(merged["agrees_top_down"]), int(merged["advance_to_basic"]),
                merged["device"][:200], int(merged["has_adhd"]), _now(),
            ),
        )
    return {"ok": True, **merged}


# ── Directory of brain-holding users (admin console picker) ─────────────────

def list_brain_users() -> list[dict[str, Any]]:
    with _conn() as c:
        c.executescript(_DDL)
        note_rows = c.execute(
            "SELECT user_key, COUNT(*) AS notes, MAX(created_at) AS last_note FROM user_brain_notes GROUP BY user_key"
        ).fetchall()
        chat_rows = c.execute(
            "SELECT user_key, COUNT(*) AS turns FROM user_brain_chats GROUP BY user_key"
        ).fetchall()
    turns = {r["user_key"]: r["turns"] for r in chat_rows}
    out = {r["user_key"]: {"user_key": r["user_key"], "notes": r["notes"],
                           "last_note": r["last_note"], "chat_turns": turns.get(r["user_key"], 0)}
           for r in note_rows}
    for k, t in turns.items():
        if k not in out:
            out[k] = {"user_key": k, "notes": 0, "last_note": None, "chat_turns": t}
    return sorted(out.values(), key=lambda r: r["last_note"] or "", reverse=True)
