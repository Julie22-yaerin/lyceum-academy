"""
Forum — the founder community at thelyceum.site/forum, reachable only from
inside a signed-in student's own workspace (the top-right link in
MainLayout) — not a public/invite-code funnel. A Gemini call classifies
each new member into 1-3 existing groups (seeded stage/industry groups,
admin-editable); Foundi is a small standalone point currency (100 on
signup). Same lightweight SQLite-in-finetune.db pattern as
access_codes.py/quanta.py — kept separate from quanta.py's academic XP
system since this is a different product surface (community, not
learning).

Gated on an active PAID plan (has_paid_plan below) — checked against the
real Stripe-backed UserSubscription table, not plans.py's local
plan-preference row, since that's the only place "actually paid" is
recorded. Forum has no Firebase session of its own (it's identified by
plain email, same style as applications.py), so the email is resolved to
a Firebase UID via firebase_admin before the subscription lookup.
"""

from __future__ import annotations

import hashlib
import hmac
import os
import re
import secrets
import sqlite3
import string
import time
import uuid
from datetime import datetime, timezone
from typing import Any

_HERE = os.path.dirname(os.path.abspath(__file__))
DB_PATH = os.path.join(_HERE, "../../finetune.db")

_DDL = """
CREATE TABLE IF NOT EXISTS forum_groups (
    id          TEXT PRIMARY KEY,
    name        TEXT NOT NULL,
    kind        TEXT NOT NULL,              -- 'stage' | 'industry'
    description TEXT NOT NULL DEFAULT '',
    is_active   INTEGER NOT NULL DEFAULT 1,
    created_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS forum_members (
    email          TEXT PRIMARY KEY,
    name           TEXT NOT NULL,
    role           TEXT NOT NULL DEFAULT 'founder',   -- 'founder' | 'visitor'
    business_email TEXT NOT NULL DEFAULT '',
    business_name  TEXT NOT NULL DEFAULT '',
    industry       TEXT NOT NULL DEFAULT '',
    stage          TEXT NOT NULL DEFAULT '',
    linkedin_url   TEXT NOT NULL,
    photo_url      TEXT NOT NULL DEFAULT '',
    looking_for_customers      INTEGER NOT NULL DEFAULT 0,
    target_customer_description TEXT NOT NULL DEFAULT '',
    referral_code  TEXT NOT NULL UNIQUE,
    referred_by    TEXT NOT NULL DEFAULT '',
    joined_at      TEXT NOT NULL,
    last_active_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS forum_group_members (
    group_id TEXT NOT NULL,
    email    TEXT NOT NULL,
    PRIMARY KEY (group_id, email)
);
CREATE INDEX IF NOT EXISTS idx_forum_group_members_email ON forum_group_members(email);

CREATE TABLE IF NOT EXISTS foundi_events (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    email      TEXT NOT NULL,
    amount     INTEGER NOT NULL,
    reason     TEXT NOT NULL,
    event_key  TEXT NOT NULL UNIQUE,
    created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_foundi_events_email ON foundi_events(email);

CREATE TABLE IF NOT EXISTS forum_connections (
    id           TEXT PRIMARY KEY,
    member_email TEXT NOT NULL,
    match_email  TEXT NOT NULL,
    kind         TEXT NOT NULL,     -- 'customer' | 'founder'
    reason       TEXT NOT NULL DEFAULT '',
    computed_at  TEXT NOT NULL,
    dismissed    INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_forum_connections_member ON forum_connections(member_email, dismissed);

CREATE TABLE IF NOT EXISTS forum_messages (
    id               TEXT PRIMARY KEY,
    thread_id        TEXT NOT NULL,   -- 'group:<group_id>' or 'dm:<emailA>|<emailB>' (sorted)
    author_email     TEXT NOT NULL,
    message_type     TEXT NOT NULL,   -- 'text' | 'pitch'
    body             TEXT NOT NULL DEFAULT '',
    pitch_context    TEXT NOT NULL DEFAULT '',
    pitch_hypothesis TEXT NOT NULL DEFAULT '',
    pitch_reasoning  TEXT NOT NULL DEFAULT '',
    pitch_risk       TEXT NOT NULL DEFAULT '',
    created_at       TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_forum_messages_thread ON forum_messages(thread_id, created_at);

CREATE TABLE IF NOT EXISTS forum_message_comments (
    id           TEXT PRIMARY KEY,
    message_id   TEXT NOT NULL,
    author_email TEXT NOT NULL,
    verdict      TEXT NOT NULL,     -- 'good' | 'mixed' | 'bad'
    content      TEXT NOT NULL DEFAULT '',
    created_at   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_forum_comments_message ON forum_message_comments(message_id);
"""

_ALPHABET = string.ascii_uppercase + string.digits

# Default groups seeded on first run so the Gemini classifier (and the
# rule-based fallback) always have real targets, matching LandingPage.tsx's
# STAGES copy (Idea Validation → MVP → Launch → Growth → Scale) plus a
# handful of common startup industries.
_DEFAULT_GROUPS: list[tuple[str, str, str, str]] = [
    ("stage-idea-validation", "Idea Validation", "stage", "Founders still testing whether the problem is real."),
    ("stage-mvp", "MVP", "stage", "Founders building their first working version."),
    ("stage-launch", "Launch", "stage", "Founders who have shipped and are finding first customers."),
    ("stage-growth", "Growth", "stage", "Founders scaling acquisition and retention."),
    ("stage-scale", "Scale", "stage", "Founders scaling the org, not just the product."),
    ("industry-saas", "SaaS", "industry", "B2B/B2C software-as-a-service founders."),
    ("industry-fintech", "Fintech", "industry", "Payments, banking, lending, investing products."),
    ("industry-ecommerce", "E-commerce", "industry", "Direct-to-consumer and marketplace retail."),
    ("industry-hardware", "Hardware", "industry", "Physical product and hardware founders."),
    ("industry-marketplace", "Marketplace", "industry", "Two-sided marketplace and platform businesses."),
]

STAGE_NAMES = [g[1] for g in _DEFAULT_GROUPS if g[2] == "stage"]
INDUSTRY_NAMES = [g[1] for g in _DEFAULT_GROUPS if g[2] == "industry"]

_LINKEDIN_RE = re.compile(r"^https?://([\w.-]+\.)?linkedin\.com/.+", re.IGNORECASE)
_EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


def _conn() -> sqlite3.Connection:
    c = sqlite3.connect(DB_PATH)
    c.row_factory = sqlite3.Row
    return c


def init_db() -> None:
    with _conn() as c:
        c.executescript(_DDL)


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def has_paid_plan(email: str) -> bool:
    """
    True only if this email maps to a Lyceum account with a real, currently
    active/trialing Stripe subscription — plans.py's `current_plan` isn't
    enough on its own, since that row can exist purely as a UI preference
    with no payment behind it. Fails closed (False) on any lookup error:
    an email that can't be resolved to a paying account doesn't get in.
    """
    import logging
    log = logging.getLogger("pclick.forum")

    try:
        import firebase_admin
        from firebase_admin import auth as fb_auth

        if not firebase_admin._apps:
            # Mirrors the lazy-init guard used elsewhere (services/personas.py) —
            # if Firebase Admin was never configured in this environment,
            # there's no way to resolve email -> uid, so fail closed.
            return False
        user = fb_auth.get_user_by_email(email)
    except Exception:
        return False

    try:
        from sqlalchemy import select
        from app.db.session import SessionLocal
        from app.models.entities import UserSubscription

        with SessionLocal() as db:
            row = db.execute(
                select(UserSubscription.id)
                .where(UserSubscription.user_id == user.uid)
                .where(UserSubscription.status.in_(["active", "trialing"]))
            ).first()
        return row is not None
    except Exception:
        log.warning("has_paid_plan: subscription lookup failed for %s", email, exc_info=True)
        return False


def _gen_referral_code() -> str:
    body = "".join(secrets.choice(_ALPHABET) for _ in range(10))
    return f"FOUNDI-{body[:5]}-{body[5:]}"


# ── Forum token — the rest of the app never ties forum membership to a
# Firebase login (it's a plain email-identified signup funnel). Real chat
# between real people means a client just claiming to be `email` in a
# request body is no longer good enough, so apply()/login() hand back a
# short HMAC-signed token that chat/connection endpoints require instead.
_TOKEN_TTL_SECONDS = 180 * 24 * 3600  # long-lived by design — low-stakes, no refresh flow


def _token_secret() -> bytes:
    secret = os.getenv("FORUM_TOKEN_SECRET", "") or os.getenv("ADMIN_SECRET", "") or "lyceum-forum-dev-secret"
    return secret.encode()


def issue_forum_token(email: str) -> str:
    email = (email or "").strip().lower()
    expiry = int(time.time()) + _TOKEN_TTL_SECONDS
    payload = f"{email}.{expiry}"
    sig = hmac.new(_token_secret(), payload.encode(), hashlib.sha256).hexdigest()
    return f"{payload}.{sig}"


def verify_forum_token(token: str) -> str | None:
    try:
        email, expiry_s, sig = (token or "").rsplit(".", 2)
        expiry = int(expiry_s)
    except (ValueError, TypeError):
        return None
    if time.time() > expiry:
        return None
    expected = hmac.new(_token_secret(), f"{email}.{expiry}".encode(), hashlib.sha256).hexdigest()
    if not hmac.compare_digest(expected, sig):
        return None
    return email


def seed_default_groups() -> None:
    """Idempotent — only inserts groups that don't already exist by id, so
    re-running on every startup is safe and admin edits/deletes persist."""
    with _conn() as c:
        c.executescript(_DDL)
        now = _now()
        for gid, name, kind, desc in _DEFAULT_GROUPS:
            c.execute(
                "INSERT OR IGNORE INTO forum_groups (id, name, kind, description, is_active, created_at) "
                "VALUES (?,?,?,?,1,?)",
                (gid, name, kind, desc, now),
            )


def list_groups(active_only: bool = False) -> list[dict[str, Any]]:
    with _conn() as c:
        c.executescript(_DDL)
        where = "WHERE is_active=1" if active_only else ""
        groups = [dict(r) for r in c.execute(f"SELECT * FROM forum_groups {where} ORDER BY kind, name").fetchall()]
        counts = c.execute("SELECT group_id, COUNT(*) as n FROM forum_group_members GROUP BY group_id").fetchall()
    count_by_id = {r["group_id"]: r["n"] for r in counts}
    for g in groups:
        g["member_count"] = count_by_id.get(g["id"], 0)
    return groups


def create_group(name: str, kind: str, description: str = "") -> dict[str, Any]:
    if not name.strip() or kind not in ("stage", "industry"):
        return {"ok": False, "error": "invalid_group"}
    gid = f"{kind}-{uuid.uuid4().hex[:10]}"
    with _conn() as c:
        c.executescript(_DDL)
        c.execute(
            "INSERT INTO forum_groups (id, name, kind, description, is_active, created_at) VALUES (?,?,?,?,1,?)",
            (gid, name.strip(), kind, description[:500], _now()),
        )
    return {"ok": True, "id": gid}


def update_group(group_id: str, name: str | None = None, description: str | None = None, is_active: bool | None = None) -> dict[str, Any]:
    with _conn() as c:
        c.executescript(_DDL)
        row = c.execute("SELECT id FROM forum_groups WHERE id=?", (group_id,)).fetchone()
        if not row:
            return {"ok": False, "error": "not_found"}
        if name is not None:
            c.execute("UPDATE forum_groups SET name=? WHERE id=?", (name.strip(), group_id))
        if description is not None:
            c.execute("UPDATE forum_groups SET description=? WHERE id=?", (description[:500], group_id))
        if is_active is not None:
            c.execute("UPDATE forum_groups SET is_active=? WHERE id=?", (1 if is_active else 0, group_id))
    return {"ok": True}


def delete_group(group_id: str) -> dict[str, Any]:
    with _conn() as c:
        c.executescript(_DDL)
        c.execute("DELETE FROM forum_group_members WHERE group_id=?", (group_id,))
        cur = c.execute("DELETE FROM forum_groups WHERE id=?", (group_id,))
    if cur.rowcount == 0:
        return {"ok": False, "error": "not_found"}
    return {"ok": True}


def award_foundi(email: str, amount: int, reason: str, event_key: str) -> int:
    """Idempotent ledger insert — a duplicate event_key is a silent no-op
    (mirrors quanta.py's award() dedupe-by-unique-index pattern). Returns
    the member's new balance."""
    now = _now()
    with _conn() as c:
        c.executescript(_DDL)
        try:
            c.execute(
                "INSERT INTO foundi_events (email, amount, reason, event_key, created_at) VALUES (?,?,?,?,?)",
                (email, amount, reason, event_key, now),
            )
        except sqlite3.IntegrityError:
            pass  # already awarded once — not double-counted
    return get_foundi_balance(email)


def get_foundi_balance(email: str) -> int:
    with _conn() as c:
        c.executescript(_DDL)
        row = c.execute("SELECT COALESCE(SUM(amount),0) AS total FROM foundi_events WHERE email=?", (email,)).fetchone()
    return int(row["total"] or 0)


def touch_activity(email: str) -> None:
    with _conn() as c:
        c.executescript(_DDL)
        c.execute("UPDATE forum_members SET last_active_at=? WHERE email=?", (_now(), email))


def get_member(email: str) -> dict[str, Any] | None:
    email = (email or "").strip().lower()
    with _conn() as c:
        c.executescript(_DDL)
        row = c.execute("SELECT * FROM forum_members WHERE email=?", (email,)).fetchone()
        if not row:
            return None
        group_ids = [r["group_id"] for r in c.execute(
            "SELECT group_id FROM forum_group_members WHERE email=?", (email,)
        ).fetchall()]
        groups = [dict(g) for g in c.execute(
            f"SELECT * FROM forum_groups WHERE id IN ({','.join('?' * len(group_ids))})", group_ids
        ).fetchall()] if group_ids else []
    member = dict(row)
    member["foundi_balance"] = get_foundi_balance(email)
    member["groups"] = groups
    return member


def list_group_members(group_id: str) -> list[dict[str, Any]]:
    with _conn() as c:
        c.executescript(_DDL)
        emails = [r["email"] for r in c.execute(
            "SELECT email FROM forum_group_members WHERE group_id=?", (group_id,)
        ).fetchall()]
        if not emails:
            return []
        members = [dict(r) for r in c.execute(
            f"SELECT * FROM forum_members WHERE email IN ({','.join('?' * len(emails))})", emails
        ).fetchall()]
    now = datetime.now(timezone.utc)
    for m in members:
        m["foundi_balance"] = get_foundi_balance(m["email"])
        try:
            last = datetime.fromisoformat(m["last_active_at"])
            m["days_since_active"] = max(0, (now - last).days)
        except Exception:
            m["days_since_active"] = None
    return members


def list_all_members() -> list[dict[str, Any]]:
    with _conn() as c:
        c.executescript(_DDL)
        members = [dict(r) for r in c.execute("SELECT * FROM forum_members ORDER BY joined_at DESC").fetchall()]
    now = datetime.now(timezone.utc)
    for m in members:
        m["foundi_balance"] = get_foundi_balance(m["email"])
        try:
            last = datetime.fromisoformat(m["last_active_at"])
            m["days_since_active"] = max(0, (now - last).days)
        except Exception:
            m["days_since_active"] = None
    return members


def _rule_based_groups(industry: str, stage: str) -> list[str]:
    """Never leaves a member with zero groups — used when Gemini
    classification fails or returns nothing usable."""
    picked: list[str] = []
    with _conn() as c:
        c.executescript(_DDL)
        if stage:
            row = c.execute(
                "SELECT id FROM forum_groups WHERE kind='stage' AND lower(name)=lower(?) AND is_active=1", (stage,)
            ).fetchone()
            if row:
                picked.append(row["id"])
        if industry:
            row = c.execute(
                "SELECT id FROM forum_groups WHERE kind='industry' AND lower(name)=lower(?) AND is_active=1", (industry,)
            ).fetchone()
            if row:
                picked.append(row["id"])
    return picked


async def _classify_groups(name: str, business_name: str, industry: str, stage: str) -> list[str]:
    groups = list_groups(active_only=True)
    if not groups:
        return []
    try:
        from app.services import ai as ai_svc
        catalog = "\n".join(f"- id={g['id']} name={g['name']} kind={g['kind']} desc={g['description']}" for g in groups)
        system = (
            "You are sorting a new founder-community member into the best-fit existing groups. "
            "Return ONLY valid JSON: {\"group_ids\": [\"...\"]} with 1 to 3 ids chosen from the "
            "provided list — never invent an id that isn't listed, never return more than 3."
        )
        user = (
            f"Available groups:\n{catalog}\n\n"
            f"New member: name={name}, business={business_name or '(none)'}, "
            f"industry={industry or '(unspecified)'}, stage={stage or '(unspecified)'}"
        )
        parsed = await ai_svc.classify_json(system, user)
        if parsed and isinstance(parsed.get("group_ids"), list):
            valid_ids = {g["id"] for g in groups}
            picked = [gid for gid in parsed["group_ids"] if gid in valid_ids][:3]
            if picked:
                return picked
    except Exception:
        import logging
        logging.getLogger("pclick").warning("Forum Gemini classification failed, using rule-based fallback", exc_info=True)

    fallback = _rule_based_groups(industry, stage)
    return fallback or [groups[0]["id"]]


async def apply(
    name: str,
    email: str,
    linkedin_url: str,
    role: str = "founder",
    business_email: str = "",
    business_name: str = "",
    industry: str = "",
    stage: str = "",
    photo_url: str = "",
    looking_for_customers: bool = False,
    target_customer_description: str = "",
) -> dict[str, Any]:
    email = (email or "").strip().lower()
    name = (name or "").strip()
    linkedin_url = (linkedin_url or "").strip()
    role = role if role in ("founder", "visitor") else "founder"

    if not name or not email or not linkedin_url:
        return {"ok": False, "error": "name_email_linkedin_required"}
    if not _EMAIL_RE.match(email):
        return {"ok": False, "error": "invalid_email"}
    if not _LINKEDIN_RE.match(linkedin_url):
        return {"ok": False, "error": "invalid_linkedin_url"}
    if not has_paid_plan(email):
        return {"ok": False, "error": "paid_plan_required"}

    existing = get_member(email)
    if existing:
        return {"ok": True, "member": existing, "already_joined": True, "forum_token": issue_forum_token(email)}

    now = _now()
    own_code = _gen_referral_code()
    with _conn() as c:
        c.executescript(_DDL)
        for _ in range(8):
            try:
                c.execute(
                    "INSERT INTO forum_members "
                    "(email, name, role, business_email, business_name, industry, stage, linkedin_url, photo_url, "
                    "looking_for_customers, target_customer_description, "
                    "referral_code, referred_by, joined_at, last_active_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                    (email, name, role, business_email.strip(), business_name.strip(), industry.strip(), stage.strip(),
                     linkedin_url, (photo_url or "").strip(), 1 if looking_for_customers else 0,
                     target_customer_description.strip()[:2000],
                     own_code, "", now, now),
                )
                break
            except sqlite3.IntegrityError:
                own_code = _gen_referral_code()

    award_foundi(email, 100, "signup", event_key=f"signup|{email}")

    if role == "founder":
        group_ids = await _classify_groups(name, business_name, industry, stage)
        with _conn() as c:
            c.executescript(_DDL)
            for gid in group_ids:
                c.execute(
                    "INSERT OR IGNORE INTO forum_group_members (group_id, email) VALUES (?,?)", (gid, email)
                )

    member = get_member(email)
    return {"ok": True, "member": member, "already_joined": False, "forum_token": issue_forum_token(email)}


def login(email: str) -> dict[str, Any] | None:
    """Re-entry for a returning member — no re-applying needed, just proves
    the email exists as a member and hands back a fresh token. Re-checks
    the paid-plan gate every time: a lapsed subscription loses access on
    the next visit, not just at signup. Returns {"error": ...} rather than
    None for the paid-gate case so the frontend can tell "never joined"
    apart from "joined, but the plan lapsed."""
    member = get_member(email)
    if not member:
        return None
    if not has_paid_plan(member["email"]):
        return {"error": "paid_plan_required"}
    return {"member": member, "forum_token": issue_forum_token(member["email"])}


# ── Chat — a group's thread_id is 'group:<group_id>'; a DM's thread_id is
# the two participant emails sorted alphabetically and joined with '|', e.g.
# 'dm:alice@x.com|bob@y.com' — so there is exactly one thread per pair with
# no separate "conversation" table or creation race to worry about. ────────


def dm_thread_id(email_a: str, email_b: str) -> str:
    a, b = sorted([(email_a or "").strip().lower(), (email_b or "").strip().lower()])
    return f"dm:{a}|{b}"


def _thread_participants(thread_id: str) -> tuple[str, ...] | None:
    """Returns the emails allowed to post/read in this thread, or None if
    the thread_id is malformed."""
    if thread_id.startswith("group:"):
        group_id = thread_id[len("group:"):]
        with _conn() as c:
            c.executescript(_DDL)
            emails = [r["email"] for r in c.execute(
                "SELECT email FROM forum_group_members WHERE group_id=?", (group_id,)
            ).fetchall()]
        return tuple(emails)
    if thread_id.startswith("dm:"):
        pair = thread_id[len("dm:"):]
        parts = pair.split("|")
        if len(parts) == 2:
            return tuple(parts)
    return None


def can_access_thread(thread_id: str, email: str) -> bool:
    participants = _thread_participants(thread_id)
    if participants is None:
        return False
    return (email or "").strip().lower() in participants


def post_message(
    thread_id: str,
    author_email: str,
    message_type: str,
    body: str = "",
    pitch_context: str = "",
    pitch_hypothesis: str = "",
    pitch_reasoning: str = "",
    pitch_risk: str = "",
) -> dict[str, Any]:
    author_email = (author_email or "").strip().lower()
    if message_type not in ("text", "pitch"):
        return {"ok": False, "error": "invalid_message_type"}
    if not can_access_thread(thread_id, author_email):
        return {"ok": False, "error": "not_a_participant"}
    if message_type == "text" and not body.strip():
        return {"ok": False, "error": "empty_message"}
    if message_type == "pitch" and not (pitch_context.strip() or pitch_hypothesis.strip()):
        return {"ok": False, "error": "empty_pitch"}

    mid = uuid.uuid4().hex
    now = _now()
    with _conn() as c:
        c.executescript(_DDL)
        c.execute(
            "INSERT INTO forum_messages (id, thread_id, author_email, message_type, body, "
            "pitch_context, pitch_hypothesis, pitch_reasoning, pitch_risk, created_at) "
            "VALUES (?,?,?,?,?,?,?,?,?,?)",
            (mid, thread_id, author_email, message_type, body.strip()[:5000],
             pitch_context.strip()[:2000], pitch_hypothesis.strip()[:2000],
             pitch_reasoning.strip()[:2000], pitch_risk.strip()[:2000], now),
        )
    touch_activity(author_email)
    return {"ok": True, "id": mid, "created_at": now}


def list_messages(thread_id: str, since: str | None = None) -> list[dict[str, Any]]:
    with _conn() as c:
        c.executescript(_DDL)
        if since:
            rows = c.execute(
                "SELECT * FROM forum_messages WHERE thread_id=? AND created_at>? ORDER BY created_at ASC",
                (thread_id, since),
            ).fetchall()
        else:
            rows = c.execute(
                "SELECT * FROM forum_messages WHERE thread_id=? ORDER BY created_at ASC", (thread_id,)
            ).fetchall()
        messages = [dict(r) for r in rows]
        for m in messages:
            comments = c.execute(
                "SELECT * FROM forum_message_comments WHERE message_id=? ORDER BY created_at ASC", (m["id"],)
            ).fetchall()
            m["comments"] = [dict(cm) for cm in comments]
    return messages


def add_comment(message_id: str, author_email: str, verdict: str, content: str) -> dict[str, Any]:
    author_email = (author_email or "").strip().lower()
    if verdict not in ("good", "mixed", "bad"):
        return {"ok": False, "error": "invalid_verdict"}
    with _conn() as c:
        c.executescript(_DDL)
        msg = c.execute("SELECT thread_id FROM forum_messages WHERE id=?", (message_id,)).fetchone()
        if not msg:
            return {"ok": False, "error": "message_not_found"}
        if not can_access_thread(msg["thread_id"], author_email):
            return {"ok": False, "error": "not_a_participant"}
        cid = uuid.uuid4().hex
        now = _now()
        c.execute(
            "INSERT INTO forum_message_comments (id, message_id, author_email, verdict, content, created_at) "
            "VALUES (?,?,?,?,?,?)",
            (cid, message_id, author_email, verdict, content.strip()[:2000], now),
        )
    touch_activity(author_email)
    return {"ok": True, "id": cid, "created_at": now}


# ── Suggested connections — computed once daily by recompute_connections()
# (called from an APScheduler job in main.py), not on-demand, since Gemini
# calls scale with member count. Split by kind so the frontend never has to
# guess which section a suggestion belongs in. ─────────────────────────────


def _keyword_overlap(a: str, b: str) -> int:
    words_a = {w.lower() for w in re.findall(r"[a-zA-Z]{4,}", a)}
    words_b = {w.lower() for w in re.findall(r"[a-zA-Z]{4,}", b)}
    return len(words_a & words_b)


def _upsert_connections(member_email: str, kind: str, picks: list[tuple[str, str]]) -> None:
    """Replaces this member's undismissed suggestions of this kind; leaves
    dismissed rows alone so a hidden suggestion doesn't reappear tomorrow."""
    now = _now()
    with _conn() as c:
        c.executescript(_DDL)
        c.execute(
            "DELETE FROM forum_connections WHERE member_email=? AND kind=? AND dismissed=0",
            (member_email, kind),
        )
        for match_email, reason in picks:
            if match_email == member_email:
                continue
            c.execute(
                "INSERT INTO forum_connections (id, member_email, match_email, kind, reason, computed_at, dismissed) "
                "VALUES (?,?,?,?,?,?,0)",
                (uuid.uuid4().hex, member_email, match_email, kind, reason[:300], now),
            )


async def _match_customers_for_founder(founder: dict[str, Any], visitors: list[dict[str, Any]]) -> list[tuple[str, str]]:
    if not visitors:
        return []
    try:
        from app.services import ai as ai_svc
        catalog = "\n".join(f"- email={v['email']} looking_for={v['target_customer_description']}" for v in visitors)
        system = (
            "You are matching a founder's target-customer description against a list of visitors "
            "looking for products. Return ONLY valid JSON: "
            "{\"matches\": [{\"email\": \"...\", \"reason\": \"<one short sentence>\"}]} "
            "with up to 5 best-fit visitor emails chosen ONLY from the provided list."
        )
        user = f"Founder's target customer: {founder['target_customer_description']}\n\nVisitors:\n{catalog}"
        parsed = await ai_svc.classify_json(system, user)
        if parsed and isinstance(parsed.get("matches"), list):
            valid = {v["email"] for v in visitors}
            picks = [(m["email"], m.get("reason", "")) for m in parsed["matches"] if isinstance(m, dict) and m.get("email") in valid]
            if picks:
                return picks[:5]
    except Exception:
        import logging
        logging.getLogger("pclick").warning("Forum customer-match Gemini call failed, using keyword fallback", exc_info=True)

    scored = sorted(
        visitors,
        key=lambda v: _keyword_overlap(founder["target_customer_description"], v["target_customer_description"]),
        reverse=True,
    )
    return [(v["email"], "Similar interests based on shared keywords.") for v in scored[:3] if
            _keyword_overlap(founder["target_customer_description"], v["target_customer_description"]) > 0]


async def _match_founders_for_founder(founder: dict[str, Any], other_founders: list[dict[str, Any]]) -> list[tuple[str, str]]:
    if not other_founders:
        return []
    my_groups = {g["id"] for g in founder.get("groups", [])}
    try:
        from app.services import ai as ai_svc
        catalog = "\n".join(
            f"- email={f['email']} business={f['business_name'] or '(unnamed)'} industry={f['industry']} stage={f['stage']}"
            for f in other_founders
        )
        system = (
            "You are suggesting founder-to-founder connections for networking. Return ONLY valid JSON: "
            "{\"matches\": [{\"email\": \"...\", \"reason\": \"<one short sentence>\"}]} "
            "with up to 5 best-fit founder emails chosen ONLY from the provided list, favoring adjacent "
            "(not identical) stage/industry combinations that make for a useful conversation."
        )
        user = (
            f"This founder: business={founder['business_name'] or '(unnamed)'}, industry={founder['industry']}, "
            f"stage={founder['stage']}\n\nOther founders:\n{catalog}"
        )
        parsed = await ai_svc.classify_json(system, user)
        if parsed and isinstance(parsed.get("matches"), list):
            valid = {f["email"] for f in other_founders}
            picks = [(m["email"], m.get("reason", "")) for m in parsed["matches"] if isinstance(m, dict) and m.get("email") in valid]
            if picks:
                return picks[:5]
    except Exception:
        import logging
        logging.getLogger("pclick").warning("Forum founder-match Gemini call failed, using shared-group fallback", exc_info=True)

    shared = [f for f in other_founders if {g["id"] for g in f.get("groups", [])} & my_groups]
    return [(f["email"], "You're both in the same group.") for f in shared[:3]]


async def recompute_connections() -> dict[str, int]:
    """Daily batch entry point (called from an APScheduler job). Best-effort
    per member — one member's Gemini failure doesn't block the rest."""
    all_members = list_all_members()
    founders = [m for m in all_members if m["role"] == "founder"]
    visitors = [m for m in all_members if m["role"] == "visitor"]
    processed = 0
    for founder in founders:
        full = get_member(founder["email"])  # need `groups` embedded, not in list_all_members()
        if not full:
            continue
        if full.get("looking_for_customers") and full.get("target_customer_description"):
            picks = await _match_customers_for_founder(full, visitors)
            _upsert_connections(full["email"], "customer", picks)
        other_founders = [get_member(f["email"]) for f in founders if f["email"] != full["email"]]
        picks = await _match_founders_for_founder(full, [f for f in other_founders if f])
        _upsert_connections(full["email"], "founder", picks)
        processed += 1
    return {"processed": processed, "founders": len(founders), "visitors": len(visitors)}


def get_connections(email: str) -> dict[str, list[dict[str, Any]]]:
    email = (email or "").strip().lower()
    with _conn() as c:
        c.executescript(_DDL)
        rows = c.execute(
            "SELECT * FROM forum_connections WHERE member_email=? AND dismissed=0 ORDER BY computed_at DESC",
            (email,),
        ).fetchall()
    connections = [dict(r) for r in rows]
    matches = {m["email"]: m for m in list_all_members()}
    result: dict[str, list[dict[str, Any]]] = {"customers": [], "founders": []}
    for conn in connections:
        match = matches.get(conn["match_email"])
        if not match:
            continue
        entry = {**conn, "match": match}
        if conn["kind"] == "customer":
            result["customers"].append(entry)
        else:
            result["founders"].append(entry)
    return result


def dismiss_connection(connection_id: str, email: str) -> dict[str, Any]:
    with _conn() as c:
        c.executescript(_DDL)
        cur = c.execute(
            "UPDATE forum_connections SET dismissed=1 WHERE id=? AND member_email=?",
            (connection_id, (email or "").strip().lower()),
        )
    if cur.rowcount == 0:
        return {"ok": False, "error": "not_found"}
    return {"ok": True}
