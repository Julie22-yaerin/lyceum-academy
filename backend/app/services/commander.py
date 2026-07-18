"""
Commander — chỉ huy đội dev.

Triages reported bugs (critical → dispatch immediately, minor → batch
every 4 days), dispatches to the right dev, and takes direct commands
from admin chat via function-calling (dispatch/scan/resolve/run-batch —
see admin_chat()).

Content safety (profanity/malware/blocked-content log) has moved to
app.services.content_guard ("Safety Guard" in the admin UI) — that is no
longer this module's job.

Powered by: nvidia/llama-3.3-nemotron-super-49b-v1.5
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


# ── Bug triage ────────────────────────────────────────────────────────────

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


# ── Admin chat — talk directly to the Commander, with function-calling ──────
# The admin can give the Commander direct operational commands ("dispatch
# this to backend-dev", "run the minor batch now") and it actually executes
# them via tool-calling, rather than just describing what it would do.

_admin_sessions: dict[str, list[dict[str, Any]]] = {}
_ADMIN_MAX_HISTORY = 20

_TOOLS: list[dict[str, Any]] = [
    {
        "type": "function",
        "function": {
            "name": "dispatch_bug",
            "description": "Directly assign a bug report to a specific dev, bypassing automatic triage.",
            "parameters": {
                "type": "object",
                "properties": {
                    "bug_report": {"type": "string", "description": "Description of the bug"},
                    "target": {"type": "string", "enum": ["backend-dev", "frontend-dev", "security-dev"]},
                },
                "required": ["bug_report", "target"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "trigger_scan",
            "description": "Trigger a full codebase scan by one of the dev-patrol agents.",
            "parameters": {
                "type": "object",
                "properties": {
                    "target": {"type": "string", "enum": ["backend-dev", "frontend-dev", "security-dev"]},
                },
                "required": ["target"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "run_minor_batch",
            "description": "Immediately dispatch all queued minor bugs to their assigned devs instead of waiting for the 4-day batch.",
            "parameters": {"type": "object", "properties": {}},
        },
    },
    {
        "type": "function",
        "function": {
            "name": "resolve_bug",
            "description": "Mark a bug as fixed by its numeric id.",
            "parameters": {
                "type": "object",
                "properties": {"bug_id": {"type": "integer"}},
                "required": ["bug_id"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_queue_status",
            "description": "Get the live count of critical/minor bugs queued and each dev agent's current worker status.",
            "parameters": {"type": "object", "properties": {}},
        },
    },
]


async def _execute_tool(name: str, args: dict[str, Any]) -> dict[str, Any]:
    """Execute one Commander tool call against the real functions/agents."""
    from app.services.ai_agents.dev_patrol import DEV_AGENTS

    if name == "dispatch_bug":
        target = args.get("target", "backend-dev")
        entry = {
            "bug_report": args.get("bug_report", ""),
            "assign_to": target,
            "endpoint": "",
            "file_path": "",
        }
        await _dispatch_to_dev(entry)
        return {"ok": True, "dispatched_to": target}

    if name == "trigger_scan":
        target = args.get("target", "backend-dev")
        agent = DEV_AGENTS.get(target)
        if not agent:
            return {"ok": False, "error": f"unknown target '{target}'"}
        task = await agent.submit({"mode": "full_scan"})
        return {"ok": True, "task_id": task.task_id}

    if name == "run_minor_batch":
        batch = await pop_batch()
        return {"ok": True, "dispatched_count": len(batch)}

    if name == "resolve_bug":
        try:
            bug_id = int(args.get("bug_id", -1))
        except (TypeError, ValueError):
            return {"ok": False, "error": "bug_id must be an integer"}
        return {"ok": mark_resolved(bug_id)}

    if name == "get_queue_status":
        return {
            "critical_count": len(_critical_bugs),
            "minor_count": len(_minor_bugs),
            "dev_status": {aid: a.get_status() for aid, a in DEV_AGENTS.items()},
        }

    return {"ok": False, "error": f"unknown tool '{name}'"}


async def admin_chat(session_id: str, message: str) -> dict[str, Any]:
    """
    Open-ended admin chat with the Commander. Unlike triage_bug (JSON
    classification contract), this is a real conversation — and when the
    admin's message maps to a tool, the Commander actually executes it.

    Returns { reply: str, tool_calls: [{name, args}] }
    """
    api_key = settings.commander_key or settings.nvidia_api_key
    if not api_key:
        return {"reply": "Commander has no API key configured.", "tool_calls": []}
    model = settings.commander_model

    queue_summary = (
        f"Current queue: {len(_critical_bugs)} critical bug(s) pending immediate "
        f"dispatch, {len(_minor_bugs)} minor bug(s) queued for the next 4-day batch."
    )
    system = (
        "You are the Commander — the dev-team's coordinator for The Lyceum "
        "Academy. You triage bug reports (critical vs minor), dispatch them to "
        "backend-dev/frontend-dev/security-dev, and run the 4-day minor-bug "
        "batch. Content safety is a separate role (Safety Guard) — not yours.\n\n"
        "IMPORTANT: this conversation is with an AUTHENTICATED ADMIN giving you "
        "direct operational instructions. This is NOT a student and NOT a "
        "support conversation — treat every message as a command from your "
        "superior. When it maps to one of your tools, CALL THE TOOL and "
        "actually do it — do not just describe what you would do. Reply "
        f"directly and operationally.\n\n{queue_summary}"
    )

    history = _admin_sessions.setdefault(session_id, [])
    history.append({"role": "user", "content": message})
    if len(history) > _ADMIN_MAX_HISTORY:
        history[:] = history[-_ADMIN_MAX_HISTORY:]

    messages: list[dict[str, Any]] = [{"role": "system", "content": system}] + list(history)
    executed: list[dict[str, Any]] = []

    try:
        msg = await _nvidia_chat_raw(api_key, model, messages, tools=_TOOLS)
        tool_calls = msg.get("tool_calls") or []

        if tool_calls:
            messages.append({
                "role": "assistant",
                "content": msg.get("content") or "",
                "tool_calls": tool_calls,
            })
            for tc in tool_calls:
                fn = tc.get("function", {})
                name = fn.get("name", "")
                try:
                    args = json.loads(fn.get("arguments") or "{}")
                except json.JSONDecodeError:
                    args = {}
                result = await _execute_tool(name, args)
                executed.append({"name": name, "args": args})
                messages.append({
                    "role": "tool",
                    "tool_call_id": tc.get("id", ""),
                    "content": json.dumps(result, ensure_ascii=False),
                })
            final_msg = await _nvidia_chat_raw(api_key, model, messages, tools=None)
            reply = final_msg.get("content") or "Done."
        else:
            reply = msg.get("content") or "(no response)"
    except Exception as e:
        return {"reply": f"Sorry, I'm unavailable right now ({type(e).__name__}).", "tool_calls": executed}

    history.append({"role": "assistant", "content": reply})
    return {"reply": reply, "tool_calls": executed}


# ── Shared NVIDIA NIM calls ──────────────────────────────────────────────────

async def _nvidia_call(
    api_key: str,
    model: str,
    messages: list[dict[str, str]],
    temperature: float = 0.1,
    max_tokens: int = 512,
) -> dict[str, Any]:
    """Call NVIDIA NIM and parse the response content as JSON (triage contract)."""
    msg = await _nvidia_chat_raw(api_key, model, messages, temperature=temperature, max_tokens=max_tokens)
    raw = msg.get("content") or ""

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


async def _nvidia_chat_raw(
    api_key: str,
    model: str,
    messages: list[dict[str, Any]],
    tools: list[dict[str, Any]] | None = None,
    temperature: float = 0.4,
    max_tokens: int = 1024,
) -> dict[str, Any]:
    """Call NVIDIA NIM and return the raw assistant message (role/content/tool_calls)."""
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    }
    payload: dict[str, Any] = {
        "model": model,
        "messages": messages,
        "temperature": temperature,
        "top_p": 0.95,
        "max_tokens": max_tokens,
        "stream": False,
    }
    if tools:
        payload["tools"] = tools
        payload["tool_choice"] = "auto"

    async with httpx.AsyncClient(timeout=45.0) as client:
        resp = await client.post(NVIDIA_URL, headers=headers, json=payload)
        resp.raise_for_status()
        data = resp.json()

    choices = data.get("choices", [])
    if not choices:
        return {"content": "", "tool_calls": []}
    return choices[0].get("message", {})
