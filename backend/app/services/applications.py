"""
Applications — the Lyceum is invite/vetted-only now, not open registration.

"Get Started" no longer leads straight to sign-up. It leads to a short
application: a few placement questions (grade level, research habits,
biggest study struggle, budget) plus a 4-axis learning-style vector
(collected via the slider dashboard in ApplyView) and an optional referral
code. Submitting adds the applicant to a waitlist; an admin reviews it in
the "Xét duyệt người dùng" console (accept/decline). Account creation
(AuthPage sign-up) is gated on `status == 'accepted'` for that email —
see app.routers.lyceum applications_status / AuthPage.tsx.

A valid referral code marks the application `priority=True`, which sorts
it to the top of the admin queue — same referral_codes table the Quanta
share-link feature writes to (app.services.quanta), so one code space
serves both features.

Storage follows the same lightweight SQLite-in-finetune.db pattern as
quanta.py/second_brain.py.
"""

from __future__ import annotations

import json
import os
import re
import sqlite3
import uuid
from datetime import datetime, timezone
from typing import Any

_HERE = os.path.dirname(os.path.abspath(__file__))
DB_PATH = os.path.join(_HERE, "../../finetune.db")

_EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")

_DDL = """
CREATE TABLE IF NOT EXISTS applications (
    id           TEXT PRIMARY KEY,
    email        TEXT NOT NULL UNIQUE,
    name         TEXT NOT NULL DEFAULT '',
    answers      TEXT NOT NULL DEFAULT '{}',
    vector       TEXT NOT NULL DEFAULT '{}',
    referral_code TEXT NOT NULL DEFAULT '',
    priority     INTEGER NOT NULL DEFAULT 0,
    status       TEXT NOT NULL DEFAULT 'pending',
    created_at   TEXT NOT NULL,
    decided_at   TEXT
);
CREATE INDEX IF NOT EXISTS idx_applications_status ON applications(status, priority DESC, created_at ASC);
"""

# pending  → in the review queue (admin swipes right/left)
# meeting  → accepted; moved to the "Gặp gỡ" (meetings) list to schedule onboarding
# declined → swiped left; kept in the trash for 7 days, then hard-purged
# accepted → onboarding done, allowed to create an account (AuthPage gate)
STATUSES = {"pending", "meeting", "accepted", "declined"}

# How long a declined application lingers in the trash before purge.
TRASH_TTL_DAYS = 7


def _conn() -> sqlite3.Connection:
    c = sqlite3.connect(DB_PATH)
    c.row_factory = sqlite3.Row
    return c


def init_db() -> None:
    with _conn() as c:
        c.executescript(_DDL)


def _referral_code_valid(code: str) -> bool:
    if not code:
        return False
    with _conn() as c:
        c.executescript("CREATE TABLE IF NOT EXISTS referral_codes ("
                         "user_id TEXT PRIMARY KEY, code TEXT NOT NULL UNIQUE, created_at TEXT NOT NULL)")
        row = c.execute("SELECT 1 FROM referral_codes WHERE code = ?", (code,)).fetchone()
    return row is not None


def _row_to_dict(row: sqlite3.Row) -> dict[str, Any]:
    d = dict(row)
    d["answers"] = json.loads(d.get("answers") or "{}")
    d["vector"] = json.loads(d.get("vector") or "{}")
    d["priority"] = bool(d.get("priority"))
    return d


def submit_application(
    email: str, name: str, answers: dict[str, Any], vector: dict[str, Any], referral_code: str = "",
) -> dict[str, Any]:
    email = (email or "").strip().lower()
    if not _EMAIL_RE.match(email):
        return {"ok": False, "error": "invalid_email"}

    priority = _referral_code_valid(referral_code.strip()) if referral_code else False
    now = datetime.now(timezone.utc).isoformat()
    app_id = uuid.uuid4().hex[:16]

    with _conn() as c:
        c.executescript(_DDL)
        existing = c.execute("SELECT id, status FROM applications WHERE email = ?", (email,)).fetchone()
        if existing:
            if existing["status"] == "pending":
                # Re-submission before review — update in place, don't spam the queue.
                c.execute(
                    "UPDATE applications SET name=?, answers=?, vector=?, referral_code=?, priority=? WHERE id=?",
                    (name[:120], json.dumps(answers), json.dumps(vector), referral_code[:40],
                     int(priority or 0), existing["id"]),
                )
                return {"ok": True, "status": "pending", "priority": priority, "resubmitted": True}
            return {"ok": True, "status": existing["status"], "priority": priority, "already_decided": True}

        c.execute(
            "INSERT INTO applications (id, email, name, answers, vector, referral_code, priority, status, created_at) "
            "VALUES (?,?,?,?,?,?,?,?,?)",
            (app_id, email, name[:120], json.dumps(answers), json.dumps(vector), referral_code[:40],
             int(priority), "pending", now),
        )
    return {"ok": True, "status": "pending", "priority": priority}


def get_status(email: str) -> dict[str, Any]:
    email = (email or "").strip().lower()
    with _conn() as c:
        c.executescript(_DDL)
        row = c.execute("SELECT status, priority FROM applications WHERE email = ?", (email,)).fetchone()
    if not row:
        return {"status": "not_found", "priority": False}
    return {"status": row["status"], "priority": bool(row["priority"])}


def list_applications(status: str | None = None) -> list[dict[str, Any]]:
    with _conn() as c:
        c.executescript(_DDL)
        if status and status in STATUSES:
            rows = c.execute(
                "SELECT * FROM applications WHERE status=? ORDER BY priority DESC, created_at ASC", (status,)
            ).fetchall()
        else:
            rows = c.execute(
                "SELECT * FROM applications ORDER BY priority DESC, created_at ASC"
            ).fetchall()
    return [_row_to_dict(r) for r in rows]


def decide(app_id: str, accept: bool) -> dict[str, Any]:
    """Admin swipe. Right (accept) → 'meeting': the applicant advances to the
    "Gặp gỡ" list where the team schedules onboarding and builds their Second
    Brain. Left (decline) → 'declined': dropped into the trash, auto-purged
    after TRASH_TTL_DAYS."""
    now = datetime.now(timezone.utc).isoformat()
    new_status = "meeting" if accept else "declined"
    with _conn() as c:
        c.executescript(_DDL)
        row = c.execute("SELECT id FROM applications WHERE id=?", (app_id,)).fetchone()
        if not row:
            return {"ok": False, "error": "not_found"}
        c.execute(
            "UPDATE applications SET status=?, decided_at=? WHERE id=?",
            (new_status, now, app_id),
        )
    return {"ok": True, "status": new_status}


def finalize_meeting(app_id: str) -> dict[str, Any]:
    """After the onboarding meeting + Second Brain setup, promote a 'meeting'
    applicant to 'accepted' — this is what unlocks account creation on the
    AuthPage sign-up gate."""
    now = datetime.now(timezone.utc).isoformat()
    with _conn() as c:
        c.executescript(_DDL)
        row = c.execute("SELECT id FROM applications WHERE id=?", (app_id,)).fetchone()
        if not row:
            return {"ok": False, "error": "not_found"}
        c.execute("UPDATE applications SET status='accepted', decided_at=? WHERE id=?", (now, app_id))
    return {"ok": True, "status": "accepted"}


def restore(app_id: str) -> dict[str, Any]:
    """Pull a declined application back out of the trash into the queue."""
    with _conn() as c:
        c.executescript(_DDL)
        row = c.execute("SELECT id FROM applications WHERE id=?", (app_id,)).fetchone()
        if not row:
            return {"ok": False, "error": "not_found"}
        c.execute("UPDATE applications SET status='pending', decided_at=NULL WHERE id=?", (app_id,))
    return {"ok": True, "status": "pending"}


def purge_expired_trash() -> int:
    """Hard-delete declined applications whose trash TTL has elapsed. Called
    lazily whenever the admin lists the trash, and by the scheduler."""
    from datetime import timedelta
    cutoff = (datetime.now(timezone.utc) - timedelta(days=TRASH_TTL_DAYS)).isoformat()
    with _conn() as c:
        c.executescript(_DDL)
        cur = c.execute(
            "DELETE FROM applications WHERE status='declined' AND decided_at IS NOT NULL AND decided_at < ?",
            (cutoff,),
        )
        return cur.rowcount


def list_trash() -> list[dict[str, Any]]:
    """Declined applications still inside their 7-day window, each annotated
    with days remaining before purge."""
    purge_expired_trash()
    from datetime import timedelta
    rows = list_applications("declined")
    out = []
    for r in rows:
        decided = r.get("decided_at")
        days_left = TRASH_TTL_DAYS
        if decided:
            try:
                expiry = datetime.fromisoformat(decided) + timedelta(days=TRASH_TTL_DAYS)
                days_left = max(0, (expiry - datetime.now(timezone.utc)).days)
            except Exception:
                pass
        out.append({**r, "days_left": days_left})
    return out
