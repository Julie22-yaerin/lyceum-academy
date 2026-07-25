"""
Retention offers — what a subscriber is shown when they try to cancel.

Three layers, in order, each declinable:
  1. DISCOUNT   — 65% off. Applied as a Stripe coupon when
                  settings.stripe_retention_coupon_id is configured; otherwise
                  recorded here so the founder can apply it by hand.
  2. CALL       — book a call with the founder, and the account is credited
                  settings.retention_call_bonus_quanta Quanta for showing up.
  3. CANCEL     — the actual cancellation. Always reachable; the UI presents it
                  as a clearly legible option, not a hidden one.

Every step is logged to `retention_events` so the funnel is measurable and so
an accepted offer can be honoured even if the Stripe side failed.
"""

from __future__ import annotations

import logging
import os
import sqlite3
import uuid
from datetime import datetime, timezone
from typing import Any

from app.core.config import settings

log = logging.getLogger("pclick.retention")

_HERE = os.path.dirname(os.path.abspath(__file__))
DB_PATH = os.path.join(_HERE, "../../finetune.db")

# The layer a user reached / acted on.
STEP_INTENT = "cancel_intent"
STEP_DISCOUNT = "discount_accepted"
STEP_CALL = "call_accepted"
STEP_CANCELLED = "cancelled"

_DDL = """
CREATE TABLE IF NOT EXISTS retention_events (
    id         TEXT PRIMARY KEY,
    user_id    TEXT NOT NULL,
    step       TEXT NOT NULL,
    detail     TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_retention_user ON retention_events(user_id, created_at DESC);
"""


def _conn() -> sqlite3.Connection:
    c = sqlite3.connect(DB_PATH)
    c.row_factory = sqlite3.Row
    return c


def init_db() -> None:
    with _conn() as c:
        c.executescript(_DDL)


def _log(user_id: str, step: str, detail: str = "") -> None:
    with _conn() as c:
        c.executescript(_DDL)
        c.execute(
            "INSERT INTO retention_events (id, user_id, step, detail, created_at) VALUES (?,?,?,?,?)",
            (uuid.uuid4().hex[:16], user_id, step, detail[:500],
             datetime.now(timezone.utc).isoformat()),
        )


def record_intent(user_id: str) -> dict[str, Any]:
    """Called when the cancel flow opens — the top of the funnel."""
    _log(user_id, STEP_INTENT)
    return {"ok": True}


def accept_discount(user_id: str, stripe_subscription_id: str = "") -> dict[str, Any]:
    """Layer 1: apply the 65% save offer to the user's live subscription.

    The caller resolves `stripe_subscription_id` (the router has the DB
    session; this service is plain SQLite and deliberately doesn't reach into
    the SQLAlchemy models).
    """
    coupon = settings.stripe_retention_coupon_id
    if not coupon or not stripe_subscription_id:
        # Nothing to apply against — honour the offer manually rather than
        # silently dropping it or telling the user it worked.
        reason = "no_coupon_configured" if not coupon else "no_active_subscription"
        _log(user_id, STEP_DISCOUNT, f"{reason}:manual_followup")
        return {
            "ok": True, "applied": False,
            "message": "Ưu đãi đã được ghi nhận. Chúng tôi sẽ áp dụng vào hoá đơn kế tiếp.",
        }

    try:
        import stripe
        stripe.Subscription.modify(stripe_subscription_id, coupon=coupon)
    except Exception as exc:
        # The user accepted in good faith; record it so it can be honoured.
        log.warning("retention discount could not be applied for %s: %s", user_id, exc)
        _log(user_id, STEP_DISCOUNT, f"stripe_failed:{exc}"[:500])
        return {
            "ok": True, "applied": False,
            "message": "Ưu đãi đã được ghi nhận. Chúng tôi sẽ áp dụng vào hoá đơn kế tiếp.",
        }

    _log(user_id, STEP_DISCOUNT, f"coupon:{coupon}")
    return {"ok": True, "applied": True, "message": "Đã áp dụng giảm 65% cho kỳ tiếp theo."}


def accept_call_bonus(user_id: str) -> dict[str, Any]:
    """Layer 2: they booked a call — credit the bonus Quanta.

    Guarded so repeat visits to the cancel flow can't farm the bonus.
    """
    with _conn() as c:
        c.executescript(_DDL)
        already = c.execute(
            "SELECT 1 FROM retention_events WHERE user_id=? AND step=? LIMIT 1",
            (user_id, STEP_CALL),
        ).fetchone()
    if already:
        return {"ok": True, "granted_quanta": 0, "message": "Bonus đã được cộng trước đó."}

    from app.services import quanta as quanta_svc
    bonus = settings.retention_call_bonus_quanta
    quanta_svc.purchase_extra_credits(user_id, bonus)
    _log(user_id, STEP_CALL, f"granted:{bonus}")
    return {
        "ok": True, "granted_quanta": bonus,
        "message": f"Đã cộng {bonus} Quanta vào ví của bạn.",
    }


def record_cancelled(user_id: str, reason: str = "") -> dict[str, Any]:
    """Layer 3: they went through with it. Logged for the churn record."""
    _log(user_id, STEP_CANCELLED, reason)
    return {"ok": True}


def funnel_counts() -> dict[str, int]:
    """Admin view: how many users reached each layer."""
    with _conn() as c:
        c.executescript(_DDL)
        rows = c.execute(
            "SELECT step, COUNT(DISTINCT user_id) AS n FROM retention_events GROUP BY step"
        ).fetchall()
    return {r["step"]: r["n"] for r in rows}
