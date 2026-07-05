"""
SQLite-backed log of every AI provider call the backend makes, for the
admin "Activity Log" view — which model handled what, and how often.

Reuses the same lightweight sqlite3 pattern as finetune_db.py (own table,
same DB file, no ORM).
"""

from __future__ import annotations
import os
import sqlite3
from datetime import datetime, timezone

_HERE   = os.path.dirname(os.path.abspath(__file__))
DB_PATH = os.path.join(_HERE, "../../finetune.db")

# Rolling window — this is an operational log, not an audit trail; keep it
# small enough that the admin table stays fast to query and render.
_MAX_ROWS = 5000

DDL = """
CREATE TABLE IF NOT EXISTS ai_activity_log (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    created_at        TEXT    NOT NULL,
    provider          TEXT    NOT NULL,
    model             TEXT    NOT NULL DEFAULT '',
    task              TEXT    NOT NULL DEFAULT '',
    role              TEXT    NOT NULL DEFAULT '',
    prompt_tokens     INTEGER NOT NULL DEFAULT 0,
    completion_tokens INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_ai_activity_created_at ON ai_activity_log(created_at);
CREATE INDEX IF NOT EXISTS idx_ai_activity_provider ON ai_activity_log(provider);
"""

# Maps the Python function name that triggered the call (captured
# automatically via the call stack — see ai.py's _record_usage) to a
# human-readable "role" for the admin dashboard. Unmapped functions fall
# back to their raw name so nothing is silently dropped.
ROLE_LABELS: dict[str, str] = {
    "chat":                      "General Chat / Socratic Dialogue",
    "chat_gemini":                "Gemini Direct Chat",
    "voice_fallback_chat":        "ARI Voice Fallback (text+TTS)",
    "synthesize_note":            "Feynman Note Synthesis",
    "node_summary":               "Knowledge Tree Node Summary (Gemma Research)",
    "analyze_tool_map":           "Tool Map Analysis",
    "validate_tool_map":          "Tool Map Validation",
    "topic_to_nodemap":           "Topic -> Knowledge Map Generation",
    "describe_drawing":           "Drawing Description",
    "clean_question":             "Question Cleanup",
    "decompose_pset":             "Problem Set Decomposition",
    "grade_all":                  "Auto-Grading",
    "grade_dual":                 "Dual-Model Auto-Grading",
    "get_hint":                   "Hint Generation",
    "check_mastery":              "Mastery Check",
    "analyze_image_pset_direct":  "Image Problem Set Analysis",
    "analyze_file_pset":          "File Problem Set Analysis",
    "extract_pdf_text":           "PDF Text Extraction",
    "transcribe_audio":           "Audio Transcription (Whisper)",
    "feynman_evaluate":           "Feynman Explanation Evaluation",
    "generate_note_diagrams":     "Note Diagram Generation",
    "moderate_community":         "Community Moderation",
    "analyze_onboarding":         "Onboarding Answer Analysis",
}


def _conn() -> sqlite3.Connection:
    c = sqlite3.connect(DB_PATH)
    c.row_factory = sqlite3.Row
    return c


def init_db() -> None:
    """Create the table if it doesn't exist. Safe to call multiple times."""
    with _conn() as c:
        c.executescript(DDL)


def record(provider: str, task: str, model: str = "", prompt_tokens: int = 0, completion_tokens: int = 0) -> None:
    """
    Best-effort insert — logging must never break the actual AI call, so
    any failure here (e.g. DB locked under load) is swallowed.
    """
    try:
        role = ROLE_LABELS.get(task, task or "unknown")
        now = datetime.now(timezone.utc).isoformat()
        with _conn() as c:
            c.execute(
                """INSERT INTO ai_activity_log
                   (created_at, provider, model, task, role, prompt_tokens, completion_tokens)
                   VALUES (?,?,?,?,?,?,?)""",
                (now, provider, model, task, role, prompt_tokens, completion_tokens),
            )
            # Prune occasionally rather than every insert (cheap check, avoids
            # a COUNT(*) scan on the hot path most of the time).
            row_id = c.execute("SELECT last_insert_rowid()").fetchone()[0]
            if row_id % 200 == 0:
                total = c.execute("SELECT COUNT(*) FROM ai_activity_log").fetchone()[0]
                if total > _MAX_ROWS:
                    c.execute(
                        "DELETE FROM ai_activity_log WHERE id IN "
                        "(SELECT id FROM ai_activity_log ORDER BY id ASC LIMIT ?)",
                        (total - _MAX_ROWS,),
                    )
    except Exception:
        pass


def list_recent(limit: int = 100, offset: int = 0, provider: str = "", task: str = "") -> list[dict]:
    limit = max(1, min(limit, 500))
    clauses, params = [], []
    if provider:
        clauses.append("provider = ?")
        params.append(provider)
    if task:
        clauses.append("task = ?")
        params.append(task)
    where = f"WHERE {' AND '.join(clauses)}" if clauses else ""
    with _conn() as c:
        rows = c.execute(
            f"SELECT * FROM ai_activity_log {where} ORDER BY id DESC LIMIT ? OFFSET ?",
            (*params, limit, offset),
        ).fetchall()
    return [dict(r) for r in rows]


def summary() -> dict:
    """All-time (within the rolling window) counts grouped by role/provider."""
    with _conn() as c:
        total = c.execute("SELECT COUNT(*) FROM ai_activity_log").fetchone()[0]
        by_role = c.execute(
            """SELECT role, provider, COUNT(*) as calls,
                      SUM(prompt_tokens) as prompt_tokens,
                      SUM(completion_tokens) as completion_tokens,
                      MAX(created_at) as last_used
               FROM ai_activity_log GROUP BY role, provider ORDER BY calls DESC"""
        ).fetchall()
    return {"total_calls": total, "by_role": [dict(r) for r in by_role]}
