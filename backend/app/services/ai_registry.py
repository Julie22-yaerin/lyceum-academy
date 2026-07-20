"""
AI Registry — identity, status, and editable power/hierarchy for every AI
agent in the system, for the admin "AI System" board.

SQLite-backed (same lightweight sqlite3 pattern as commander.py / feedback.py,
own table in the shared finetune.db). Seeded once with the 9 agents that
exist today; every field is then editable from the admin UI.
"""

from __future__ import annotations

import os
import sqlite3
from typing import Any

_HERE = os.path.dirname(os.path.abspath(__file__))
DB_PATH = os.path.join(_HERE, "../../finetune.db")

_DDL = """
CREATE TABLE IF NOT EXISTS ai_registry (
    id          TEXT PRIMARY KEY,
    name        TEXT NOT NULL DEFAULT '',
    description TEXT NOT NULL DEFAULT '',
    category    TEXT NOT NULL DEFAULT '',
    parent_id   TEXT,
    notes       TEXT NOT NULL DEFAULT ''
);
"""

# custom_instructions: live-editable text appended to this agent's system
# prompt on every real call (triage/review/admin_chat) — either edited
# directly here or set by the agent itself via its update_instructions
# tool when an admin asks it to change how it behaves. Distinct from
# `notes`, which is just descriptive text for the org-chart UI.

# (id, name, description, category, parent_id) — the "as of now" snapshot.
_SEED: list[tuple[str, str, str, str, str | None]] = [
    ("commander", "Commander", "Dev-team commander — triages bug reports (critical vs minor), dispatches them to the right dev, and takes direct function-calling commands from admin chat.", "head", None),
    ("content-guard", "Safety Guard", "Content intake gate — blocks profanity, malware uploads, and unauthorized file extensions before they enter the pipeline. A peer to Commander, not a subordinate.", "head", None),
    ("support-chat", "Support Consultant", "Always-on customer support chat. Answers platform questions and auto-detects technical complaints, forwarding them to the Commander for triage.", "head", "commander"),
    ("backend-dev", "Backend Dev", "Silent dev-patrol agent — Python/FastAPI bugs, SQL, async errors. Acts only when Commander or an admin submits a task.", "dev", "commander"),
    ("frontend-dev", "Frontend Dev", "Silent dev-patrol agent — React/TypeScript/CSS bugs. Acts only when Commander or an admin submits a task.", "dev", "commander"),
    ("security-dev", "Security Dev", "Silent dev-patrol agent — auth, injection, CORS, SOC compliance. Acts only when Commander or an admin submits a task.", "dev", "commander"),
    ("content-analyzer", "Content Analyzer", "Background learning agent — extracts concepts and difficulty from uploaded content.", "support", None),
    ("path-generator", "Path Generator", "Background learning agent — builds personalized learning paths.", "support", None),
    ("progress-tracker", "Progress Tracker", "Background learning agent — analyzes mastery signals and predicts readiness.", "support", None),
    # ── Premium AI Roles ──────────────────────────────────────────────────────
    ("coach", "Coach (Backend Orchestrator)", "Deep Chain-of-Thought analysis of student knowledge state. Generates personalized next-day curriculum (Markdown notes + progressive problem sets) from Second Brain + error logs. Model: OpenAI o1. Runs as daily off-peak batch.", "role", None),
    ("feynman", "Feynman Listener", "Real-time EQ persona — simulates a naive 5-year-old child's perspective. Identifies logical vulnerabilities in student explanations and asks max 3 lethal Socratic questions. Detects stuck states → switches to guidance mode. Model: Claude 3.5 Sonnet.", "role", None),
    ("debate-partner", "Scientific Debate Partner", "Peer-level scientist (AP/IB rigor). Stress-tests student hypotheses with counter-arguments and extreme edge cases. Analyzes visual inputs (sketches, graphs, 3D structures) for geometric/spatial reasoning flaws. Model: Gemini 1.5 Pro. Premium feature.", "role", None),
    ("concierge", "Lead Concierge & Socratic Chatter", "Master frontline interface. NEVER exposes direct answers. Branches on performance score: below threshold → foundational blocks + micro-questions; above → theoretical debates. Triggers dynamic UI widgets. Model: Claude 3 Opus.", "role", None),
    ("grader", "Solution Grader & Reverse Builder", "Hybrid verification engine. Grades process correctness via Tool Map analysis, validates math with WolframAlpha, evaluates reverse building (recreating paths from known answers). Model: GPT-4o + Wolfram Alpha.", "role", None),
]

# Agents with a live BaseAgent worker (queue/status) behind them.
_LIVE_STATUS_AGENTS = {"backend-dev", "frontend-dev", "security-dev"}


def _conn() -> sqlite3.Connection:
    c = sqlite3.connect(DB_PATH)
    c.row_factory = sqlite3.Row
    return c


def init_db() -> None:
    """Create the table and seed it (once) if empty. Safe to call multiple times."""
    with _conn() as c:
        c.executescript(_DDL)
        cols = {row["name"] for row in c.execute("PRAGMA table_info(ai_registry)")}
        if "custom_instructions" not in cols:
            c.execute("ALTER TABLE ai_registry ADD COLUMN custom_instructions TEXT NOT NULL DEFAULT ''")
        count = c.execute("SELECT COUNT(*) FROM ai_registry").fetchone()[0]
        if count == 0:
            c.executemany(
                "INSERT INTO ai_registry (id, name, description, category, parent_id) VALUES (?,?,?,?,?)",
                _SEED,
            )
        else:
            # Backfill: agents added after initial deployments — insert them
            # if missing, without touching any row an admin may have since edited.
            backfill_ids = [
                "content-guard",
                "coach", "feynman", "debate-partner", "concierge", "grader",
            ]
            for bid in backfill_ids:
                row = c.execute("SELECT 1 FROM ai_registry WHERE id = ?", (bid,)).fetchone()
                if not row:
                    seed_row = next((r for r in _SEED if r[0] == bid), None)
                    if seed_row:
                        c.execute(
                            "INSERT INTO ai_registry (id, name, description, category, parent_id) VALUES (?,?,?,?,?)",
                            seed_row,
                        )


def list_agents() -> list[dict[str, Any]]:
    with _conn() as c:
        rows = c.execute("SELECT * FROM ai_registry ORDER BY category, name").fetchall()
    return [dict(r) for r in rows]


def get_agent(agent_id: str) -> dict[str, Any] | None:
    with _conn() as c:
        row = c.execute("SELECT * FROM ai_registry WHERE id = ?", (agent_id,)).fetchone()
    return dict(row) if row else None


def create_agent(
    agent_id: str,
    name: str = "",
    description: str = "",
    category: str = "",
    parent_id: str | None = None,
    notes: str = "",
    custom_instructions: str = "",
) -> dict[str, Any]:
    with _conn() as c:
        c.execute(
            "INSERT INTO ai_registry (id, name, description, category, parent_id, notes, custom_instructions) VALUES (?,?,?,?,?,?,?)",
            (agent_id, name, description, category, parent_id, notes, custom_instructions),
        )
    return get_agent(agent_id)  # type: ignore[return-value]


def get_custom_instructions(agent_id: str) -> str:
    """Convenience accessor for callers building a system prompt."""
    agent = get_agent(agent_id)
    return (agent or {}).get("custom_instructions", "") or ""


def update_agent(agent_id: str, **fields: Any) -> dict[str, Any] | None:
    """Edit name/description/category/parent_id/notes/custom_instructions. Unknown keys are ignored."""
    allowed = {"name", "description", "category", "parent_id", "notes", "custom_instructions"}
    updates = {k: v for k, v in fields.items() if k in allowed}
    if not updates:
        return get_agent(agent_id)
    set_clause = ", ".join(f"{k} = ?" for k in updates)
    with _conn() as c:
        cur = c.execute(
            f"UPDATE ai_registry SET {set_clause} WHERE id = ?",
            (*updates.values(), agent_id),
        )
        if cur.rowcount == 0:
            return None
    return get_agent(agent_id)


def delete_agent(agent_id: str) -> bool:
    with _conn() as c:
        cur = c.execute("DELETE FROM ai_registry WHERE id = ?", (agent_id,))
        return cur.rowcount > 0


def live_status(agent_id: str) -> dict[str, Any]:
    """Live worker status for dev-patrol agents; static n/a for everything else."""
    if agent_id in _LIVE_STATUS_AGENTS:
        try:
            from app.services.ai_agents.dev_patrol import DEV_AGENTS

            agent = DEV_AGENTS.get(agent_id)
            if agent:
                return agent.get_status()
        except Exception:
            pass
    return {"status": "n/a"}


def list_agents_with_status() -> list[dict[str, Any]]:
    """list_agents() merged with live_status() — what the admin board renders."""
    agents = list_agents()
    for a in agents:
        a["live"] = live_status(a["id"])
    return agents
