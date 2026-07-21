"""
Quanta — an XP-like point system rewarding real learning signals (drawing a
mind map, answering exercise questions well). Same lightweight pattern as
mastery_profile.py/activity_log.py/second_brain.py: a raw event ledger plus
a rolled-up per-user totals table in the shared finetune.db, keyed by the
same Firebase UID string every other personalization service uses.
"""

from __future__ import annotations

import os
import sqlite3
from datetime import datetime, timezone
from typing import Any

_HERE = os.path.dirname(os.path.abspath(__file__))
DB_PATH = os.path.join(_HERE, "../../finetune.db")

_DDL = """
CREATE TABLE IF NOT EXISTS quanta_events (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id    TEXT NOT NULL,
    event_type TEXT NOT NULL,
    points     INTEGER NOT NULL,
    context    TEXT NOT NULL DEFAULT '',
    event_key  TEXT,
    created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_quanta_events_user ON quanta_events(user_id, created_at);
CREATE UNIQUE INDEX IF NOT EXISTS uq_quanta_events_dedupe
    ON quanta_events(event_key) WHERE event_key IS NOT NULL;

CREATE TABLE IF NOT EXISTS quanta_totals (
    user_id      TEXT PRIMARY KEY,
    total_points INTEGER NOT NULL DEFAULT 0,
    level        INTEGER NOT NULL DEFAULT 1,
    updated_at   TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS quanta_spend (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id    TEXT NOT NULL,
    quanta     INTEGER NOT NULL,
    pool       TEXT NOT NULL DEFAULT 'standard',
    context    TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_quanta_spend_user ON quanta_spend(user_id, created_at);

CREATE TABLE IF NOT EXISTS quanta_credits (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id    TEXT NOT NULL,
    quanta     INTEGER NOT NULL,
    source     TEXT NOT NULL DEFAULT 'extra_purchase',
    created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_quanta_credits_user ON quanta_credits(user_id);

CREATE TABLE IF NOT EXISTS referral_codes (
    user_id    TEXT PRIMARY KEY,
    code       TEXT NOT NULL UNIQUE,
    created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS referral_redemptions (
    invited_uid TEXT PRIMARY KEY,
    code        TEXT NOT NULL,
    inviter_uid TEXT NOT NULL,
    created_at  TEXT NOT NULL
);
"""

# App-wide token↔quanta conversion (kept in sync with plans.TOKENS_PER_QUANTA).
TOKENS_PER_QUANTA = 5

# Point values are deliberately approximate, not precise — a passed exercise
# should feel meaningfully bigger than a bare attempt, mind-map creation
# sits between the two. `note_understood` is reserved for the card-based
# exercise feature (sourced from Second Brain notes) to call once it grades
# a note-sourced question — no code changes needed here when that lands.
POINT_RULES: dict[str, int] = {
    "mind_map_created": 25,
    "mind_map_ai_reviewed": 15,
    # Every correct exercise/quest/lesson card awards 1-2 Quanta — the low
    # bucket for easy/medium cards, the high bucket for hard/extreme ones.
    # Wrong answers earn nothing (Quanta rewards mastery, not attempts).
    "exercise_correct_low": 1,
    "exercise_correct_high": 2,
    "note_understood": 20,
    # Referral: 1 invited friend who signs up = 5 quanta for the inviter.
    "friend_invited": 5,
}

# Events a client is allowed to self-report via POST /quanta/award. Anything
# not in this set (exercise_*, mind_map_ai_reviewed) is only ever awarded
# from inside a trusted server-side code path, so a client can't fabricate
# a passed grade or a fake AI review for free points.
CLIENT_AWARDABLE_EVENTS = {"mind_map_created"}

_LEVEL_BASE = 100
_LEVEL_GROWTH = 1.15
_LEVEL_STEP = 20


def _conn() -> sqlite3.Connection:
    c = sqlite3.connect(DB_PATH)
    c.row_factory = sqlite3.Row
    return c


def init_db() -> None:
    with _conn() as c:
        c.executescript(_DDL)


def _level_for_points(total: int) -> tuple[int, int, int]:
    """(level, points already earned into the current level, points needed
    to reach the next level). Escalating thresholds computed iteratively —
    cheap early levels, harder later, no lookup table to maintain."""
    level, remaining, threshold = 1, total, _LEVEL_BASE
    while remaining >= threshold:
        remaining -= threshold
        level += 1
        threshold = int(threshold * _LEVEL_GROWTH) + _LEVEL_STEP
    return level, remaining, threshold


def award(user_id: str, event_type: str, context: str = "", event_key: str | None = None) -> dict[str, Any]:
    """Best-effort — never raises. Points are always looked up server-side
    from POINT_RULES; callers never supply an amount. `event_key`, if given,
    makes a duplicate award (e.g. a retried request) a no-op via a unique
    index rather than double-counting."""
    if not user_id or event_type not in POINT_RULES:
        return {"awarded": 0, "event_type": event_type, "total_points": 0, "level": 1, "leveled_up": False}

    points = POINT_RULES[event_type]
    now = datetime.now(timezone.utc).isoformat()
    try:
        with _conn() as c:
            try:
                c.execute(
                    "INSERT INTO quanta_events (user_id, event_type, points, context, event_key, created_at) "
                    "VALUES (?,?,?,?,?,?)",
                    (user_id, event_type, points, context, event_key, now),
                )
            except sqlite3.IntegrityError:
                # Duplicate event_key — this exact award already happened.
                row = c.execute(
                    "SELECT total_points, level FROM quanta_totals WHERE user_id = ?", (user_id,)
                ).fetchone()
                total = row["total_points"] if row else 0
                level = row["level"] if row else 1
                return {"awarded": 0, "event_type": event_type, "total_points": total, "level": level, "leveled_up": False}

            row = c.execute(
                "SELECT total_points, level FROM quanta_totals WHERE user_id = ?", (user_id,)
            ).fetchone()
            prev_total = row["total_points"] if row else 0
            prev_level = row["level"] if row else 1
            new_total = prev_total + points
            new_level, _, _ = _level_for_points(new_total)

            c.execute(
                "INSERT INTO quanta_totals (user_id, total_points, level, updated_at) VALUES (?,?,?,?) "
                "ON CONFLICT(user_id) DO UPDATE SET total_points=excluded.total_points, "
                "level=excluded.level, updated_at=excluded.updated_at",
                (user_id, new_total, new_level, now),
            )

        return {
            "awarded": points,
            "event_type": event_type,
            "total_points": new_total,
            "level": new_level,
            "leveled_up": new_level > prev_level,
        }
    except Exception:
        return {"awarded": 0, "event_type": event_type, "total_points": 0, "level": 1, "leveled_up": False}


def get_profile(user_id: str) -> dict[str, Any]:
    with _conn() as c:
        row = c.execute(
            "SELECT total_points, level FROM quanta_totals WHERE user_id = ?", (user_id,)
        ).fetchone()
        total = row["total_points"] if row else 0
        level = row["level"] if row else 1
        _, points_into_level, points_to_next_level = _level_for_points(total)

        events = c.execute(
            "SELECT event_type, points, context, created_at FROM quanta_events "
            "WHERE user_id = ? ORDER BY id DESC LIMIT 20",
            (user_id,),
        ).fetchall()

    return {
        "total_points": total,
        "level": level,
        "points_into_level": points_into_level,
        "points_to_next_level": points_to_next_level,
        "recent_events": [dict(e) for e in events],
    }


# ── Wallet: plan allowance + earned + extra credits − spend ─────────────────
# The Quanta bar in the UI reads this instead of the old per-feature usage
# panel. Spend is recorded in tokens at the AI call sites and converted here.


def spend_tokens(user_id: str, tokens: int, pool: str = "standard", context: str = "") -> None:
    """Best-effort ledger write — never raises, never blocks the AI reply.
    `pool` is 'standard' for normal tools, 'coach' for the Coach role."""
    if not user_id or tokens <= 0:
        return
    quanta = max(1, round(tokens / TOKENS_PER_QUANTA))
    now = datetime.now(timezone.utc).isoformat()
    try:
        with _conn() as c:
            c.execute(
                "INSERT INTO quanta_spend (user_id, quanta, pool, context, created_at) VALUES (?,?,?,?,?)",
                (user_id, quanta, pool if pool in ("standard", "coach") else "standard", context, now),
            )
    except Exception:
        pass


def purchase_extra_credits(user_id: str, quanta: int) -> dict[str, Any]:
    """Extra-credit top-up: the user types any positive Quanta amount and it
    lands in their wallet. Billing/payment capture is handled outside this
    ledger; this records the entitlement."""
    quanta = int(quanta)
    if not user_id or quanta <= 0 or quanta > 1_000_000:
        return {"ok": False, "error": "invalid_amount"}
    now = datetime.now(timezone.utc).isoformat()
    with _conn() as c:
        c.execute(
            "INSERT INTO quanta_credits (user_id, quanta, source, created_at) VALUES (?,?,?,?)",
            (user_id, quanta, "extra_purchase", now),
        )
    return {"ok": True, "added_quanta": quanta}


def _month_start_iso() -> str:
    now = datetime.now(timezone.utc)
    return now.replace(day=1, hour=0, minute=0, second=0, microsecond=0).isoformat()


def get_balance(user_id: str) -> dict[str, Any]:
    """Monthly wallet snapshot: plan allowances (standard + coach pools),
    earned points, purchased extra credits, and this month's spend."""
    from app.services import plans as plans_svc

    cur = plans_svc.current_plan(user_id)
    plan = cur["plan"]
    month_start = _month_start_iso()

    with _conn() as c:
        c.executescript(_DDL)
        spent_std = c.execute(
            "SELECT COALESCE(SUM(quanta),0) FROM quanta_spend WHERE user_id=? AND pool='standard' AND created_at>=?",
            (user_id, month_start),
        ).fetchone()[0]
        spent_coach = c.execute(
            "SELECT COALESCE(SUM(quanta),0) FROM quanta_spend WHERE user_id=? AND pool='coach' AND created_at>=?",
            (user_id, month_start),
        ).fetchone()[0]
        extra = c.execute(
            "SELECT COALESCE(SUM(quanta),0) FROM quanta_credits WHERE user_id=?",
            (user_id,),
        ).fetchone()[0]
        row = c.execute(
            "SELECT total_points FROM quanta_totals WHERE user_id=?", (user_id,)
        ).fetchone()
        earned = row["total_points"] if row else 0

    unlimited = bool(cur.get("unlimited"))
    std_allowance = plans_svc.UNLIMITED_QUANTA if unlimited else plan["standard_quanta"] + extra + earned
    coach_allowance = plans_svc.UNLIMITED_QUANTA if unlimited else plan["coach_quanta"]
    return {
        "plan_id": plan["id"],
        "plan_name": plan["name"] + (" (unlimited test)" if unlimited else ""),
        "cycle": cur["cycle"],
        "tokens_per_quanta": TOKENS_PER_QUANTA,
        "standard_allowance": std_allowance,
        "standard_spent": spent_std,
        "standard_remaining": max(0, std_allowance - spent_std),
        "coach_allowance": coach_allowance,
        "coach_spent": spent_coach,
        "coach_remaining": max(0, coach_allowance - spent_coach),
        "extra_credits": extra,
        "earned_points": earned,
    }


# ── Referrals: share link → +5 quanta per friend who joins ─────────────────


def get_or_create_referral_code(user_id: str) -> str:
    import secrets

    with _conn() as c:
        c.executescript(_DDL)
        row = c.execute("SELECT code FROM referral_codes WHERE user_id=?", (user_id,)).fetchone()
        if row:
            return row["code"]
        now = datetime.now(timezone.utc).isoformat()
        for _ in range(8):
            code = secrets.token_urlsafe(6)[:8].replace("_", "x").replace("-", "y")
            try:
                c.execute(
                    "INSERT INTO referral_codes (user_id, code, created_at) VALUES (?,?,?)",
                    (user_id, code, now),
                )
                return code
            except sqlite3.IntegrityError:
                continue
    return ""


def redeem_referral(code: str, invited_uid: str) -> dict[str, Any]:
    """Called once when a newly signed-up user submits an invite code. Each
    invited account can only ever be redeemed once (PK on invited_uid), and
    self-referrals are rejected. Awards the inviter friend_invited (+5)."""
    code = (code or "").strip()
    if not code or not invited_uid:
        return {"ok": False, "error": "missing_code"}
    with _conn() as c:
        c.executescript(_DDL)
        row = c.execute("SELECT user_id FROM referral_codes WHERE code=?", (code,)).fetchone()
        if not row:
            return {"ok": False, "error": "unknown_code"}
        inviter = row["user_id"]
        if inviter == invited_uid:
            return {"ok": False, "error": "self_referral"}
        now = datetime.now(timezone.utc).isoformat()
        try:
            c.execute(
                "INSERT INTO referral_redemptions (invited_uid, code, inviter_uid, created_at) VALUES (?,?,?,?)",
                (invited_uid, code, inviter, now),
            )
        except sqlite3.IntegrityError:
            return {"ok": False, "error": "already_redeemed"}
    result = award(inviter, "friend_invited", context=invited_uid, event_key=f"referral|{invited_uid}")
    return {"ok": True, "inviter_awarded": result["awarded"]}


def referral_stats(user_id: str) -> dict[str, Any]:
    with _conn() as c:
        c.executescript(_DDL)
        count = c.execute(
            "SELECT COUNT(*) FROM referral_redemptions WHERE inviter_uid=?", (user_id,)
        ).fetchone()[0]
    return {"invited_count": count, "quanta_earned": count * POINT_RULES["friend_invited"]}
