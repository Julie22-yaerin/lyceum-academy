"""
Workspace access codes — a manual override for the accepted-application
sign-up gate (app.routers.lyceum applications_status / AuthPage.tsx).

Normally: applicant → admin accepts (status 'meeting') → admin builds their
Second Brain → admin finalizes (status 'accepted') → AuthPage lets them sign
up. This is the automatic path.

If that pipeline doesn't fire for some reason (a manual arrangement, a
support case, testing), an admin can generate a one-time code here. A code
is optionally pinned to one email; redeeming it marks that email's
application 'accepted' (creating the application row if none exists yet),
which is the same flag AuthPage already checks — so redemption just
unblocks the existing sign-up gate rather than adding a second one.

Storage: same SQLite-in-finetune.db pattern as applications.py/quanta.py.
"""

from __future__ import annotations

import secrets
import sqlite3
import string
from datetime import datetime, timezone
from typing import Any

_HERE = __import__("os").path.dirname(__import__("os").path.abspath(__file__))
DB_PATH = __import__("os").path.join(_HERE, "../../finetune.db")

_DDL = """
CREATE TABLE IF NOT EXISTS access_codes (
    code       TEXT PRIMARY KEY,
    email      TEXT NOT NULL DEFAULT '',   -- '' = any email may redeem it
    note       TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    used_at    TEXT,
    used_by    TEXT NOT NULL DEFAULT ''
);
"""

_ALPHABET = string.ascii_uppercase + string.digits


def _conn() -> sqlite3.Connection:
    c = sqlite3.connect(DB_PATH)
    c.row_factory = sqlite3.Row
    return c


def init_db() -> None:
    with _conn() as c:
        c.executescript(_DDL)


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _gen_code() -> str:
    body = "".join(secrets.choice(_ALPHABET) for _ in range(10))
    return f"LYCEUM-{body[:5]}-{body[5:]}"


def generate(email: str = "", note: str = "") -> dict[str, Any]:
    code = _gen_code()
    with _conn() as c:
        c.executescript(_DDL)
        c.execute(
            "INSERT INTO access_codes (code, email, note, created_at) VALUES (?,?,?,?)",
            (code, (email or "").strip().lower(), note[:200], _now()),
        )
    return {"ok": True, "code": code, "email": email.strip().lower(), "note": note}


def list_codes() -> list[dict[str, Any]]:
    with _conn() as c:
        c.executescript(_DDL)
        rows = c.execute("SELECT * FROM access_codes ORDER BY created_at DESC").fetchall()
    return [dict(r) for r in rows]


def revoke(code: str) -> dict[str, Any]:
    with _conn() as c:
        c.executescript(_DDL)
        cur = c.execute("DELETE FROM access_codes WHERE code=? AND used_at IS NULL", (code,))
    if cur.rowcount == 0:
        return {"ok": False, "error": "not_found_or_already_used"}
    return {"ok": True}


def redeem(code: str, email: str) -> dict[str, Any]:
    email = (email or "").strip().lower()
    code = (code or "").strip().upper()
    if not email or not code:
        return {"ok": False, "error": "email_and_code_required"}

    with _conn() as c:
        c.executescript(_DDL)
        row = c.execute("SELECT * FROM access_codes WHERE code=?", (code,)).fetchone()
        if not row:
            return {"ok": False, "error": "invalid_code"}
        if row["used_at"]:
            return {"ok": False, "error": "code_already_used"}
        if row["email"] and row["email"] != email:
            return {"ok": False, "error": "code_not_valid_for_this_email"}

        c.execute("UPDATE access_codes SET used_at=?, used_by=? WHERE code=?", (_now(), email, code))

    # Unblock the existing accepted-application sign-up gate for this email.
    from app.services import applications as applications_svc
    with applications_svc._conn() as c:  # noqa: SLF001 — reuse the shared connection helper
        c.executescript(applications_svc._DDL)
        existing = c.execute("SELECT id FROM applications WHERE email=?", (email,)).fetchone()
        now = _now()
        if existing:
            c.execute("UPDATE applications SET status='accepted', decided_at=? WHERE id=?", (now, existing["id"]))
        else:
            import uuid
            app_id = uuid.uuid4().hex[:16]
            c.execute(
                "INSERT INTO applications (id, email, name, answers, vector, referral_code, priority, status, created_at, decided_at) "
                "VALUES (?,?,?,?,?,?,?,?,?,?)",
                (app_id, email, "", "{}", "{}", "", 0, "accepted", now, now),
            )

    return {"ok": True, "status": "accepted"}
