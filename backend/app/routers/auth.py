"""
Cookie-based session management.

POST /auth/session   — exchange Firebase ID token for a secure HttpOnly cookie
DELETE /auth/session — clear the session cookie (logout)

Cookie attributes enforced:
  • HttpOnly  — JS cannot read the cookie (XSS protection)
  • Secure    — only sent over HTTPS (skipped in local dev)
  • SameSite  — "lax" blocks cross-site POSTs (CSRF protection)
  • Path=/    — available to all routes
  • Max-Age   — 1 hour (matches Firebase ID token lifetime)
"""

from __future__ import annotations

import os
from fastapi import APIRouter, HTTPException, Response, Cookie
from pydantic import BaseModel

from app.services.firebase_auth import verify_firebase_id_token

router = APIRouter(prefix="/auth", tags=["auth"])

COOKIE_NAME    = "__session"
COOKIE_MAX_AGE = 3600          # 1 hour — matches Firebase ID token lifetime
_IS_PROD       = os.getenv("APP_ENV", "development").lower() == "production"


def _set_session_cookie(response: Response, token: str) -> None:
    """
    Write the session cookie with all required security attributes.

    HttpOnly  — not accessible via document.cookie (XSS mitigation)
    Secure    — HTTPS-only transmission (skipped in local dev)
    SameSite  — 'lax' allows top-level navigation, blocks cross-site POSTs (CSRF mitigation)
    Path      — available to all routes
    Max-Age   — 1 hour
    """
    response.set_cookie(
        key=COOKIE_NAME,
        value=token,
        max_age=COOKIE_MAX_AGE,
        path="/",
        httponly=True,             # XSS: JS cannot read this cookie
        secure=_IS_PROD,           # HTTPS only in production; False locally so dev works
        samesite="lax",            # CSRF: blocks cross-site form POSTs
    )


def _clear_session_cookie(response: Response) -> None:
    response.delete_cookie(
        key=COOKIE_NAME,
        path="/",
        httponly=True,
        secure=_IS_PROD,
        samesite="lax",
    )


class SessionRequest(BaseModel):
    id_token: str   # Firebase ID token from the client SDK


@router.post("/session", status_code=204)
async def create_session(body: SessionRequest, response: Response):
    """
    Verify a Firebase ID token and issue a secure HttpOnly session cookie.
    Call this right after signInWithPopup / signInWithEmailAndPassword on the frontend.
    """
    if not body.id_token:
        raise HTTPException(status_code=400, detail="id_token required")

    # Verify the token (raises 401 if invalid/expired)
    await verify_firebase_id_token(body.id_token)

    _set_session_cookie(response, body.id_token)
    # 204 No Content — cookie is in the Set-Cookie header


@router.delete("/session", status_code=204)
async def delete_session(response: Response):
    """Clear the session cookie (logout)."""
    _clear_session_cookie(response)
