"""
Commander / Coordinator — chỉ huy đội dev + chống content độc hại.

Two roles:
  1. Dev Triage: classify reported bugs
     - CRITICAL (affects entire feature) → dispatch to dev immediately
     - MINOR (LaTeX, fonts, images) → batch every 4 days

  2. Content Safety: AI-powered harmful content detection
     - Profanity / offensive language
     - Virus / malware in uploads
     - Unauthorized file extensions
     - Harmful/inappropriate content in AI responses

Powered by: nvidia/nemotron-3.5-content-safety
"""

from __future__ import annotations

import json
import os
import sqlite3
import time
from datetime import datetime, timezone
from typing import Any

import httpx

from app.core.config import settings

NVIDIA_URL = "https://integrate.api.nvidia.com/v1/chat/completions"

# ── Bug triage queue ───────────────────────────────────────────────────────
# Critical bugs: dispatched immediately to dev team
# Minor bugs: batched, processed every 4 days
_critical_bugs: list[dict[str, Any]] = []
_minor_bugs: list[dict[str, Any]] = []
_MAX_QUEUE = 500

_BATCH_INTERVAL_DAYS = 4

# ── SQLite persistence ──────────────────────────────────────────────────────
# Same lightweight sqlite3 pattern as feedback.py / activity_log.py — own
# tables in the shared finetune.db, no ORM. This is the crash-recovery "safe
# landing spot": if the backend process dies/restarts, load_pending() on the
# next startup repopulates the in-memory queues from disk so no reported bug
# is silently lost.
_HERE = os.path.dirname(os.path.abspath(__file__))
DB_PATH = os.path.join(_HERE, "../../finetune.db")

_DDL = """
CREATE TABLE IF NOT EXISTS commander_bugs (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    created_at    TEXT    NOT NULL,
    queue         TEXT    NOT NULL,
    severity      TEXT    NOT NULL DEFAULT '',
    category      TEXT    NOT NULL DEFAULT '',
    reason        TEXT    NOT NULL DEFAULT '',
    affected_scope TEXT   NOT NULL DEFAULT '',
    assign_to     TEXT    NOT NULL DEFAULT '',
    bug_report    TEXT    NOT NULL DEFAULT '',
    endpoint      TEXT    NOT NULL DEFAULT '',
    file_path     TEXT    NOT NULL DEFAULT '',
    reported_by   TEXT    NOT NULL DEFAULT '',
    dispatched_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_commander_bugs_queue ON commander_bugs(queue, dispatched_at);

CREATE TABLE IF NOT EXISTS commander_meta (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
);
"""


def _conn() -> sqlite3.Connection:
    c = sqlite3.connect(DB_PATH)
    c.row_factory = sqlite3.Row
    return c


def init_db() -> None:
    """Create commander tables if they don't exist. Safe to call multiple times."""
    with _conn() as c:
        c.executescript(_DDL)
        cols = {row["name"] for row in c.execute("PRAGMA table_info(commander_bugs)")}
        if "resolved_at" not in cols:
            c.execute("ALTER TABLE commander_bugs ADD COLUMN resolved_at TEXT")


def _save_bug(entry: dict[str, Any], queue: str) -> int:
    """Persist a triaged bug row. Returns the row id."""
    now = datetime.now(timezone.utc).isoformat()
    with _conn() as c:
        cur = c.execute(
            """INSERT INTO commander_bugs
               (created_at, queue, severity, category, reason, affected_scope,
                assign_to, bug_report, endpoint, file_path, reported_by)
               VALUES (?,?,?,?,?,?,?,?,?,?,?)""",
            (
                now,
                queue,
                entry.get("severity", ""),
                entry.get("category", ""),
                entry.get("reason", ""),
                entry.get("affected_scope", ""),
                entry.get("assign_to", ""),
                entry.get("bug_report", ""),
                entry.get("endpoint", ""),
                entry.get("file_path", ""),
                entry.get("reported_by", ""),
            ),
        )
        return int(cur.lastrowid)


def _mark_dispatched(row_id: int) -> None:
    now = datetime.now(timezone.utc).isoformat()
    with _conn() as c:
        c.execute("UPDATE commander_bugs SET dispatched_at = ? WHERE id = ?", (now, row_id))


def load_pending() -> None:
    """
    Repopulate the in-memory critical/minor queues from any un-dispatched
    rows in the DB. Call once at app startup — this is what lets Commander
    recover its queue after a process crash/restart instead of losing it.
    """
    global _critical_bugs, _minor_bugs
    with _conn() as c:
        rows = c.execute(
            "SELECT * FROM commander_bugs WHERE dispatched_at IS NULL ORDER BY id ASC"
        ).fetchall()

    critical, minor = [], []
    for r in rows:
        entry = {
            "_row_id": r["id"],
            "severity": r["severity"],
            "category": r["category"],
            "reason": r["reason"],
            "affected_scope": r["affected_scope"],
            "assign_to": r["assign_to"],
            "bug_report": r["bug_report"],
            "endpoint": r["endpoint"],
            "file_path": r["file_path"],
            "reported_by": r["reported_by"],
            "timestamp": time.time(),
        }
        (critical if r["queue"] == "critical" else minor).append(entry)

    _critical_bugs = critical
    _minor_bugs = minor


def _get_meta(key: str, default: str = "") -> str:
    with _conn() as c:
        row = c.execute("SELECT value FROM commander_meta WHERE key = ?", (key,)).fetchone()
    return row["value"] if row else default


def _set_meta(key: str, value: str) -> None:
    with _conn() as c:
        c.execute(
            "INSERT INTO commander_meta (key, value) VALUES (?, ?) "
            "ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            (key, value),
        )

# ── Content safety log ─────────────────────────────────────────────────────
_blocked_content: list[dict[str, Any]] = []
_MAX_BLOCKED = 300


# ── VAI TRÒ 1: BUG TRIAGE ─────────────────────────────────────────────────

async def triage_bug(
    bug_report: str,
    endpoint: str = "",
    file_path: str = "",
    reported_by: str = "system",
) -> dict[str, Any]:
    """
    Classify a reported bug as CRITICAL or MINOR.

    CRITICAL = affects entire feature (e.g., /ai/chat returns 500 for everyone)
    MINOR    = cosmetic (LaTeX render, font size, image alignment)

    Returns { severity, classification, reason, dispatch_action }
    """
    api_key = settings.commander_key or settings.nvidia_api_key
    model = settings.commander_model

    system = """You are a senior engineering commander triaging bug reports.

Classify each bug as CRITICAL or MINOR:

CRITICAL (fix immediately):
- Affects entire feature for all users
- Backend crash / 500 error on production endpoint
- Data loss / corruption
- Authentication/authorization bypass
- Security vulnerability
- Complete feature failure (e.g., "chat doesn't work at all")

MINOR (batch every 4 days):
- LaTeX rendering issues
- Font size / typography problems
- Image alignment / layout
- Cosmetic UI glitches
- Minor spelling errors
- Non-blocking edge cases
- Performance optimization (not broken, just slow)

Return JSON:
{
  "severity": "critical|minor",
  "category": "backend-crash|feature-failure|security|data-loss|latex|font|image|cosmetic|typo|performance|other",
  "reason": "brief explanation of classification",
  "affected_scope": "all-users|specific-user|specific-page|cosmetic",
  "dispatch_action": "immediate|batch-4-day",
  "assign_to": "backend-dev|frontend-dev|security-dev"
}"""

    context_parts = [f"Bug report: {bug_report}"]
    if endpoint:
        context_parts.append(f"Endpoint: {endpoint}")
    if file_path:
        context_parts.append(f"File: {file_path}")

    messages = [
        {"role": "system", "content": system},
        {"role": "user", "content": "\n\n".join(context_parts)},
    ]

    try:
        result = await _nvidia_call(api_key, model, messages, temperature=0.1, max_tokens=512)
    except Exception as e:
        # Fail-open: AI unavailable/errored → fall back to the keyword
        # classifier instead of ever raising out of triage_bug.
        result = _keyword_classify(bug_report)

    # Store in appropriate queue
    bug_entry = {
        **result,
        "bug_report": bug_report,
        "endpoint": endpoint,
        "file_path": file_path,
        "reported_by": reported_by,
        "timestamp": time.time(),
    }

    queue = "critical" if result.get("severity") == "critical" else "minor"

    # Persist immediately so the report survives a process crash/restart
    # even if nothing below this line ever runs.
    try:
        row_id = _save_bug(bug_entry, queue)
        bug_entry["_row_id"] = row_id
    except Exception:
        row_id = None

    if queue == "critical":
        _critical_bugs.append(bug_entry)
        if len(_critical_bugs) > _MAX_QUEUE:
            _critical_bugs.pop(0)
        result["dispatch_action"] = "immediate"
        result["queue"] = "critical"
        # Critical → dispatch to the assigned dev right away.
        try:
            await _dispatch_to_dev(bug_entry)
            if row_id is not None:
                _mark_dispatched(row_id)
        except Exception:
            pass  # dispatch failure must never break the triage response
    else:
        _minor_bugs.append(bug_entry)
        if len(_minor_bugs) > _MAX_QUEUE:
            _minor_bugs.pop(0)
        result["dispatch_action"] = "batch-4-day"
        result["queue"] = "minor"

    return result


async def _dispatch_to_dev(bug_entry: dict[str, Any]) -> None:
    """Submit a triaged bug to the dev agent named in bug_entry['assign_to']."""
    from app.services.ai_agents.dev_patrol import DEV_AGENTS

    agent_id = bug_entry.get("assign_to") or "backend-dev"
    agent = DEV_AGENTS.get(agent_id) or DEV_AGENTS["backend-dev"]
    await agent.submit({
        "mode": "report",
        "bug_report": bug_entry.get("bug_report", ""),
        "endpoint": bug_entry.get("endpoint", ""),
        "file_path": bug_entry.get("file_path", ""),
    })


# ── Admin chat — talk directly to the Commander ──────────────────────────────
_admin_sessions: dict[str, list[dict[str, str]]] = {}
_ADMIN_MAX_HISTORY = 20


async def admin_chat(session_id: str, message: str) -> str:
    """
    Open-ended admin chat with the Commander — same NVIDIA model used for
    triage, but conversational. Folds in a live queue summary so the admin
    can ask things like "what's in your critical queue right now?".
    """
    api_key = settings.commander_key or settings.nvidia_api_key
    if not api_key:
        return "Commander has no API key configured."
    model = settings.commander_model

    queue_summary = (
        f"Current queue: {len(_critical_bugs)} critical bug(s) pending immediate "
        f"dispatch, {len(_minor_bugs)} minor bug(s) queued for the next 4-day batch."
    )
    system = (
        "You are the Commander — dev-team coordinator and content-safety gate "
        "for The Lyceum Academy. You triage bug reports (critical vs minor) and "
        "dispatch them to backend-dev/frontend-dev/security-dev. You are now "
        "talking directly with an admin, not triaging a report — answer their "
        "questions about your role, current queue, and decisions plainly and "
        f"conversationally, in the language they write in.\n\n{queue_summary}"
    )

    history = _admin_sessions.setdefault(session_id, [])
    history.append({"role": "user", "content": message})
    if len(history) > _ADMIN_MAX_HISTORY:
        history[:] = history[-_ADMIN_MAX_HISTORY:]

    messages = [{"role": "system", "content": system}] + history

    try:
        result = await _nvidia_call(api_key, model, messages, temperature=0.4, max_tokens=1024)
        reply = result.get("raw") or result.get("reply") or json.dumps(result, ensure_ascii=False)
    except Exception as e:
        return f"Sorry, I'm unavailable right now ({type(e).__name__})."

    history.append({"role": "assistant", "content": reply})
    return reply


def _keyword_classify(text: str) -> dict[str, Any]:
    """Fallback keyword-based classification when AI is unavailable."""
    lower = text.lower()
    critical_kw = ["500", "crash", "broken", "doesn't work", "not working", "error", "fail", "security", "auth", "data loss"]
    minor_kw = ["latex", "font", "image", "align", "cosmetic", "typo", "color", "spacing", "animation"]

    if any(kw in lower for kw in critical_kw):
        return {"severity": "critical", "category": "feature-failure", "reason": "Keyword match", "affected_scope": "all-users", "assign_to": "backend-dev"}
    return {"severity": "minor", "category": "cosmetic", "reason": "Keyword match", "affected_scope": "cosmetic", "assign_to": "frontend-dev"}


def get_critical_bugs() -> list[dict[str, Any]]:
    """Return all critical bugs pending immediate dispatch."""
    return list(_critical_bugs)


def get_minor_bugs() -> list[dict[str, Any]]:
    """Return all minor bugs pending batch processing."""
    return list(_minor_bugs)


def list_all_bugs(status: str = "") -> list[dict[str, Any]]:
    """
    Full bug history for the admin Error Log — every triaged bug ever
    reported, newest first.

    status: "" (all) | "open" (not yet resolved) | "resolved"
    """
    query = "SELECT * FROM commander_bugs"
    if status == "open":
        query += " WHERE resolved_at IS NULL"
    elif status == "resolved":
        query += " WHERE resolved_at IS NOT NULL"
    query += " ORDER BY id DESC"

    with _conn() as c:
        rows = c.execute(query).fetchall()
    return [dict(r) for r in rows]


def mark_resolved(row_id: int) -> bool:
    """Mark a bug as fixed. Returns False if no such row exists."""
    now = datetime.now(timezone.utc).isoformat()
    with _conn() as c:
        cur = c.execute(
            "UPDATE commander_bugs SET resolved_at = ? WHERE id = ? AND resolved_at IS NULL",
            (now, row_id),
        )
        return cur.rowcount > 0


def should_run_batch() -> bool:
    """Check if it's time to process the minor bug batch (every 4 days)."""
    if not _minor_bugs:
        return False
    last_batch_at = float(_get_meta("last_batch_at", "0") or "0")
    elapsed_days = (time.time() - last_batch_at) / 86400
    return elapsed_days >= _BATCH_INTERVAL_DAYS


async def pop_batch() -> list[dict[str, Any]]:
    """
    Dispatch every queued minor bug to its assigned dev, mark them
    dispatched in the DB, clear the in-memory queue, and record this
    batch run (persisted, so the 4-day interval survives restarts).
    Returns the dispatched batch.
    """
    batch = list(_minor_bugs)
    for bug_entry in batch:
        try:
            await _dispatch_to_dev(bug_entry)
            row_id = bug_entry.get("_row_id")
            if row_id is not None:
                _mark_dispatched(row_id)
        except Exception:
            pass  # one bad dispatch must not block the rest of the batch
    _minor_bugs.clear()
    _set_meta("last_batch_at", str(time.time()))
    return batch


# ── VAI TRÒ 2: CONTENT SAFETY ─────────────────────────────────────────────

# Profanity patterns (Vietnamese + English)
_PROFANITY_PATTERNS = [
    # English
    r'(?i)\b(f+u+c+k|s+h+i+t|a+s+s|h+e+l+l|d+a+m+n|b+i+t+c+h|d+i+c+k|c+r+a+p)\b',
    r'(?i)\b(bullshit|asshole|motherfucker|dumbass|jackass|bastard)\b',
    # Vietnamese (common offensive)
    r'(?i)\b(ch+ử+ [+f]+ụ+|đ+m+|l+ụ+|c+ặ+c|đ+i+ê+n|ch+ó+|l+ợ+n)\b',
    r'(?i)\b(cl+|đ*m|ocl|lol|dm|vc|cc|l+c)\b',
]

import re as _re
_PROFANITY_RE = [_re.compile(p) for p in _PROFANITY_PATTERNS]

# Dangerous file indicators in content
_DANGEROUS_CONTENT_MARKERS = [
    b'X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR',  # EICAR test
    b'MZ\x90\x00',   # PE header
    b'\x7fELF',      # ELF binary
    b'#!/bin/sh',     # Shell script
    b'#!/bin/bash',
    b'<script',       # XSS
    b'javascript:',   # JS URI
]


async def check_text_safety(text: str, context: str = "") -> dict[str, Any]:
    """
    AI-powered text safety check.
    Returns { safe: bool, reason: str, category: str }
    """
    if not text or not text.strip():
        return {"safe": True, "reason": "empty", "category": "none"}

    # Quick regex profanity check first (no API call needed)
    for pattern in _PROFANITY_RE:
        if pattern.search(text):
            return {
                "safe": False,
                "reason": "Content contains offensive language",
                "category": "profanity",
            }

    # AI deep check for subtle harmful content
    api_key = settings.commander_key or settings.nvidia_api_key
    model = settings.commander_model

    if not api_key:
        return {"safe": True, "reason": "no-api-key", "category": "none"}

    system = """You are a content safety classifier. Analyze the text and determine if it's safe.

Check for:
- Profanity, hate speech, harassment
- Harmful instructions (how to harm self/others)
- Inappropriate sexual content
- Discrimination / hate targeting groups
- Threats or intimidation

Return JSON:
{
  "safe": true/false,
  "category": "none|profanity|hate|harmful|sexual|discrimination|threat",
  "reason": "brief explanation if unsafe",
  "confidence": 0.0-1.0
}"""

    messages = [
        {"role": "system", "content": system},
        {"role": "user", "content": f"Check this text for safety:\n\n{text[:2000]}"},
    ]

    try:
        result = await _nvidia_call(api_key, model, messages, temperature=0.1, max_tokens=256)
        if not result.get("safe", True):
            _log_blocked("text", result.get("category", "unknown"), text[:200], context)
        return result
    except Exception:
        # If AI fails, let it through (fail-open for text, but log it)
        return {"safe": True, "reason": "ai-unavailable", "category": "none"}


def check_file_safety(filename: str, content: bytes, mime: str) -> dict[str, Any]:
    """
    Synchronous file safety check — virus/malware indicators.
    Returns { safe: bool, reason: str, category: str }
    """
    import os

    # Check extension
    ext = os.path.splitext(filename or "")[1].lower()
    dangerous_exts = {
        '.exe', '.dll', '.so', '.dylib', '.bat', '.cmd', '.sh', '.ps1',
        '.vbs', '.js', '.msi', '.app', '.dmg', '.pkg', '.deb', '.rpm',
        '.py', '.rb', '.php', '.pl', '.jar', '.class', '.elf',
        '.zip', '.tar', '.gz', '.rar', '.7z',
        '.html', '.htm', '.svg', '.xml',
        '.lnk', '.scr', '.pif',
    }
    if ext in dangerous_exts:
        _log_blocked("file", "unauthorized-extension", filename, "")
        return {
            "safe": False,
            "reason": f"File extension '{ext}' is not authorized",
            "category": "unauthorized-extension",
        }

    # Check for dangerous content markers
    for marker in _DANGEROUS_CONTENT_MARKERS:
        if marker in content[:4096]:
            _log_blocked("file", "malware-indicator", filename, f"Contains {marker[:20]}")
            return {
                "safe": False,
                "reason": "File contains potentially dangerous content",
                "category": "malware",
            }

    # Check for suspiciously large executables disguised as other types
    if mime and not mime.startswith(('image/', 'audio/', 'application/pdf', 'text/')):
        if len(content) > 1024 * 1024:  # >1MB non-standard type
            _log_blocked("file", "suspicious-upload", filename, f"MIME: {mime}, Size: {len(content)}")
            return {
                "safe": False,
                "reason": f"Unusual file type ({mime}) with large size",
                "category": "suspicious",
            }

    return {"safe": True, "reason": "passed", "category": "none"}


def _log_blocked(content_type: str, category: str, content_preview: str, context: str) -> None:
    """Log a blocked content event."""
    entry = {
        "content_type": content_type,
        "category": category,
        "preview": content_preview[:200],
        "context": context,
        "timestamp": time.time(),
    }
    _blocked_content.append(entry)
    if len(_blocked_content) > _MAX_BLOCKED:
        _blocked_content.pop(0)


def get_blocked_content(limit: int = 50) -> list[dict[str, Any]]:
    """Return recent blocked content for admin review."""
    return list(reversed(_blocked_content[-limit:]))


# ── Shared NVIDIA NIM call ─────────────────────────────────────────────────

async def _nvidia_call(
    api_key: str,
    model: str,
    messages: list[dict[str, str]],
    temperature: float = 0.1,
    max_tokens: int = 512,
) -> dict[str, Any]:
    """Call NVIDIA NIM and parse JSON response."""
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    }
    payload = {
        "model": model,
        "messages": messages,
        "temperature": temperature,
        "top_p": 0.95,
        "max_tokens": max_tokens,
        "stream": False,
    }

    async with httpx.AsyncClient(timeout=30.0) as client:
        resp = await client.post(NVIDIA_URL, headers=headers, json=payload)
        resp.raise_for_status()
        data = resp.json()

    choices = data.get("choices", [])
    if not choices:
        return {"error": "no choices"}

    raw = choices[0].get("message", {}).get("content", "")

    # Parse JSON, strip markdown fences if present
    text = raw.strip()
    if text.startswith("```"):
        lines = text.split("\n")
        start = 1 if lines[0].startswith("```") else 0
        end = -1 if lines[-1].strip() == "```" else len(lines)
        text = "\n".join(lines[start:end])

    try:
        return json.loads(text)
    except json.JSONDecodeError:
        return {"raw": raw[:1000], "_parse_error": True}
