"""
Google reCAPTCHA v3 verification — bot protection on the login/signup form.

reCAPTCHA v3 never interrupts the user; it silently scores the interaction
(0.0 = bot, 1.0 = human) and the frontend sends that token along with the
login/signup attempt. We verify it server-side with Google before letting
the attempt through.

Docs: https://developers.google.com/recaptcha/docs/v3
"""

from __future__ import annotations

import logging

import httpx

from app.core.config import settings

VERIFY_URL = "https://www.google.com/recaptcha/api/siteverify"
DEFAULT_MIN_SCORE = 0.5

logger = logging.getLogger("pclick.recaptcha")


def is_configured() -> bool:
    return bool(settings.recaptcha_secret_key)


async def verify(token: str, remote_ip: str | None = None, min_score: float = DEFAULT_MIN_SCORE) -> bool:
    """
    Returns True if the token is valid and scores at or above min_score.
    Returns False (never raises) on any failure — callers should treat that
    as "block the request", not "let it through".
    """
    if not settings.recaptcha_secret_key or not token:
        return False

    data = {"secret": settings.recaptcha_secret_key, "response": token}
    if remote_ip:
        data["remoteip"] = remote_ip

    try:
        async with httpx.AsyncClient(timeout=8) as client:
            resp = await client.post(VERIFY_URL, data=data)
            resp.raise_for_status()
            result = resp.json()
    except Exception:
        logger.warning("recaptcha.verify request failed", exc_info=True)
        return False

    if not result.get("success"):
        return False
    return result.get("score", 0.0) >= min_score
