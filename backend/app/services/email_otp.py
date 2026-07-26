"""
Email OTP — a 6-digit code sent by email, required at both signup and each
login. New subsystem: there was no code-based email verification anywhere
in this codebase before (Firebase's own link-based email verification is a
separate, already-existing mechanism this doesn't replace at the Firebase
layer — the frontend now gates entry on this instead).

Same lightweight SQLite-in-finetune.db pattern as access_codes.py/
quanta.py. A code is single-use (consumed on successful verify) and
expires after 10 minutes; requesting a new one invalidates any still-live
code for that (email, purpose) pair rather than letting multiple valid
codes pile up.
"""

from __future__ import annotations

import hashlib
import os
import secrets
import sqlite3
from datetime import datetime, timedelta, timezone

_HERE = os.path.dirname(os.path.abspath(__file__))
DB_PATH = os.path.join(_HERE, "../../finetune.db")

CODE_TTL = timedelta(minutes=10)
REQUEST_COOLDOWN = timedelta(seconds=30)  # per (email, purpose) — blocks resend-mashing

_DDL = """
CREATE TABLE IF NOT EXISTS email_otp_codes (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    email        TEXT NOT NULL,
    purpose      TEXT NOT NULL,        -- 'signup' | 'login'
    code_hash    TEXT NOT NULL,
    attempts     INTEGER NOT NULL DEFAULT 0,
    created_at   TEXT NOT NULL,
    expires_at   TEXT NOT NULL,
    consumed_at  TEXT
);
CREATE INDEX IF NOT EXISTS idx_email_otp_lookup ON email_otp_codes(email, purpose, created_at DESC);
"""

MAX_ATTEMPTS = 5


def _conn() -> sqlite3.Connection:
    c = sqlite3.connect(DB_PATH)
    c.row_factory = sqlite3.Row
    return c


def init_db() -> None:
    with _conn() as c:
        c.executescript(_DDL)


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _hash(code: str, email: str) -> str:
    # Salted with the email so a leaked hash from one row can't be replayed
    # against another; codes are short-lived and single-use anyway, but this
    # costs nothing and rules out a class of mistakes.
    return hashlib.sha256(f"{email.lower()}:{code}".encode()).hexdigest()


def request_code(email: str, purpose: str) -> dict:
    """Generates and stores a new code, returns {ok, code|None, cooldown_seconds}.
    The plaintext code is returned ONLY so the caller (the router) can hand
    it to app.services.email.send_email — it is never stored in plaintext
    and never returned to the frontend."""
    email = email.strip().lower()
    if purpose not in ("signup", "login"):
        raise ValueError(f"unknown otp purpose: {purpose}")

    with _conn() as c:
        c.executescript(_DDL)
        recent = c.execute(
            "SELECT created_at FROM email_otp_codes WHERE email=? AND purpose=? "
            "ORDER BY created_at DESC LIMIT 1",
            (email, purpose),
        ).fetchone()
        if recent:
            created = datetime.fromisoformat(recent["created_at"])
            elapsed = _now() - created
            if elapsed < REQUEST_COOLDOWN:
                return {"ok": False, "error": "cooldown", "retry_after": (REQUEST_COOLDOWN - elapsed).seconds + 1}

        code = f"{secrets.randbelow(1_000_000):06d}"
        now = _now()
        c.execute(
            "INSERT INTO email_otp_codes (email, purpose, code_hash, created_at, expires_at) VALUES (?,?,?,?,?)",
            (email, purpose, _hash(code, email), now.isoformat(), (now + CODE_TTL).isoformat()),
        )
    return {"ok": True, "code": code}


def verify_code(email: str, purpose: str, code: str) -> bool:
    email = email.strip().lower()
    code = code.strip()
    with _conn() as c:
        c.executescript(_DDL)
        row = c.execute(
            "SELECT id, code_hash, attempts, expires_at, consumed_at FROM email_otp_codes "
            "WHERE email=? AND purpose=? ORDER BY created_at DESC LIMIT 1",
            (email, purpose),
        ).fetchone()
        if not row or row["consumed_at"]:
            return False
        if datetime.fromisoformat(row["expires_at"]) < _now():
            return False
        if row["attempts"] >= MAX_ATTEMPTS:
            return False

        c.execute("UPDATE email_otp_codes SET attempts = attempts + 1 WHERE id = ?", (row["id"],))
        if row["code_hash"] != _hash(code, email):
            return False

        c.execute("UPDATE email_otp_codes SET consumed_at = ? WHERE id = ?", (_now().isoformat(), row["id"]))
    return True
