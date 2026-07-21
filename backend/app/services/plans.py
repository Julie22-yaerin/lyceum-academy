"""
Plans — the Lyceum subscription catalog, denominated in Quanta.

The old USD/Stripe tier set (compass/scholar/mentor/researcher) is retired.
Every plan is now expressed as a monthly Quanta allowance, split between
"standard" tools (notes, exercises, dialogue) and the Coach orchestrator
(the heaviest AI role). Conversion is fixed app-wide:

    1 Quanta = 5 tokens   (TOKENS_PER_QUANTA)

Personal plans (each sold monthly and annually — annual is the same monthly
allowance, billed per year):

    e-lite  —  4,000 std tokens /  15,000 coach tokens  →   800 /  3,000 Q
    basic   —  8,000 std tokens /  30,000 coach tokens  → 1,600 /  6,000 Q
    plus    — 10,000 std tokens /  40,000 coach tokens  → 2,000 /  8,000 Q
    intense — 20,000 std tokens /  50,000 coach tokens  → 4,000 / 10,000 Q

Team plan: up to 3 accounts sharing one workspace, one AI-provided document
library, and a team chat room. The Quanta pool is shared (3× plus).

Extra credits: users type any Quanta amount and it's added to their wallet
(see quanta.purchase_extra_credits). No USD pricing is computed anywhere —
pricing/billing wiring is intentionally out of scope for the catalog.

Storage follows the quanta.py pattern: small SQLite tables in the shared
finetune.db keyed by Firebase UID.
"""

from __future__ import annotations

import os
import sqlite3
from datetime import datetime, timezone
from typing import Any

_HERE = os.path.dirname(os.path.abspath(__file__))
DB_PATH = os.path.join(_HERE, "../../finetune.db")

TOKENS_PER_QUANTA = 5

_DDL = """
CREATE TABLE IF NOT EXISTS user_plans (
    user_id     TEXT PRIMARY KEY,
    plan_id     TEXT NOT NULL,
    cycle       TEXT NOT NULL DEFAULT 'monthly',
    selected_at TEXT NOT NULL
);

-- Unlimited test access — see redeem_unlimited_code(). There is no
-- free-trial program anymore; this is a deliberate one-time bypass, not
-- something regular applicants can obtain.
CREATE TABLE IF NOT EXISTS unlimited_accounts (
    user_id    TEXT PRIMARY KEY,
    granted_at TEXT NOT NULL
);
"""

# Effectively-uncapped allowance shown to unlimited-access accounts —
# large enough that no realistic usage pattern will exhaust it.
UNLIMITED_QUANTA = 10_000_000


def _q(tokens: int) -> int:
    return tokens // TOKENS_PER_QUANTA


# Canonical catalog. `standard_quanta` covers every normal AI tool for the
# month; `coach_quanta` is a separate pool for the Coach orchestrator role.
PLAN_CATALOG: dict[str, dict[str, Any]] = {
    "e-lite": {
        "id": "e-lite",
        "name": "E-Lite",
        "kind": "personal",
        "standard_tokens": 4_000,
        "coach_tokens": 15_000,
        "standard_quanta": _q(4_000),
        "coach_quanta": _q(15_000),
        "seats": 1,
        "emoji": "🌱",
    },
    "basic": {
        "id": "basic",
        "name": "Basic",
        "kind": "personal",
        "standard_tokens": 8_000,
        "coach_tokens": 30_000,
        "standard_quanta": _q(8_000),
        "coach_quanta": _q(30_000),
        "seats": 1,
        "emoji": "📘",
    },
    "plus": {
        "id": "plus",
        "name": "Plus",
        "kind": "personal",
        "standard_tokens": 10_000,
        "coach_tokens": 40_000,
        "standard_quanta": _q(10_000),
        "coach_quanta": _q(40_000),
        "seats": 1,
        "emoji": "✦",
    },
    "intense": {
        "id": "intense",
        "name": "Intense",
        "kind": "personal",
        "standard_tokens": 20_000,
        "coach_tokens": 50_000,
        "standard_quanta": _q(20_000),
        "coach_quanta": _q(50_000),
        "seats": 1,
        "emoji": "🔥",
    },
    "team": {
        "id": "team",
        "name": "Team",
        "kind": "team",
        # Shared pool for the whole team: 3× plus.
        "standard_tokens": 30_000,
        "coach_tokens": 120_000,
        "standard_quanta": _q(30_000),
        "coach_quanta": _q(120_000),
        "seats": 3,
        "emoji": "🏛️",
    },
}

BILLING_CYCLES = ("monthly", "annual")
DEFAULT_PLAN_ID = "e-lite"

# Legacy tiers → nearest new plan, so existing subscription rows and the
# AI model router keep working without a data migration.
LEGACY_TIER_MAP = {
    "free": "e-lite",
    "compass": "e-lite",
    "scholar": "basic",
    "mentor": "plus",
    "researcher": "intense",
}


def _conn() -> sqlite3.Connection:
    c = sqlite3.connect(DB_PATH)
    c.row_factory = sqlite3.Row
    return c


def init_db() -> None:
    with _conn() as c:
        c.executescript(_DDL)


def normalize_plan_id(plan_or_tier: str) -> str:
    p = (plan_or_tier or "").strip().lower()
    if p in PLAN_CATALOG:
        return p
    return LEGACY_TIER_MAP.get(p, DEFAULT_PLAN_ID)


def catalog() -> dict[str, Any]:
    return {
        "tokens_per_quanta": TOKENS_PER_QUANTA,
        "billing_cycles": list(BILLING_CYCLES),
        "plans": list(PLAN_CATALOG.values()),
    }


def select_plan(user_id: str, plan_id: str, cycle: str = "monthly") -> dict[str, Any]:
    plan_id = normalize_plan_id(plan_id)
    if cycle not in BILLING_CYCLES:
        cycle = "monthly"
    now = datetime.now(timezone.utc).isoformat()
    with _conn() as c:
        c.executescript(_DDL)
        c.execute(
            "INSERT INTO user_plans (user_id, plan_id, cycle, selected_at) VALUES (?,?,?,?) "
            "ON CONFLICT(user_id) DO UPDATE SET plan_id=excluded.plan_id, "
            "cycle=excluded.cycle, selected_at=excluded.selected_at",
            (user_id, plan_id, cycle, now),
        )
    return current_plan(user_id)


def current_plan(user_id: str) -> dict[str, Any]:
    with _conn() as c:
        c.executescript(_DDL)
        row = c.execute("SELECT * FROM user_plans WHERE user_id = ?", (user_id,)).fetchone()
        unlimited = c.execute("SELECT 1 FROM unlimited_accounts WHERE user_id = ?", (user_id,)).fetchone()
    plan_id = row["plan_id"] if row else DEFAULT_PLAN_ID
    plan = PLAN_CATALOG.get(plan_id, PLAN_CATALOG[DEFAULT_PLAN_ID])
    if unlimited:
        # Unlimited testers always route on the top-tier plan's model
        # quality, regardless of whatever plan_id is on file.
        plan = PLAN_CATALOG["intense"]
    return {
        "plan": plan,
        "cycle": row["cycle"] if row else "monthly",
        "selected_at": row["selected_at"] if row else None,
        "is_default": row is None,
        "unlimited": bool(unlimited),
    }


def is_unlimited(user_id: str) -> bool:
    with _conn() as c:
        c.executescript(_DDL)
        return c.execute("SELECT 1 FROM unlimited_accounts WHERE user_id = ?", (user_id,)).fetchone() is not None


def redeem_unlimited_code(user_id: str, code: str) -> dict[str, Any]:
    """One-time redemption: if `code` matches settings.admin_unlimited_test_code
    (non-empty), permanently mark this account unlimited. Never distributed
    to regular applicants — this is the admin's own indefinite-testing bypass
    for the now-closed free-trial program."""
    from app.core.config import settings

    expected = settings.admin_unlimited_test_code
    if not expected or code != expected:
        return {"ok": False, "error": "invalid_code"}
    now = datetime.now(timezone.utc).isoformat()
    with _conn() as c:
        c.executescript(_DDL)
        c.execute(
            "INSERT INTO unlimited_accounts (user_id, granted_at) VALUES (?,?) "
            "ON CONFLICT(user_id) DO NOTHING",
            (user_id, now),
        )
    return {"ok": True, "unlimited": True}
