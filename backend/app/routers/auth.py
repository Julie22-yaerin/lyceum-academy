"""
Cookie-based session management.

POST /auth/session   — exchange Firebase ID token for a secure HttpOnly cookie
DELETE /auth/session — clear the session cookie (logout)

Cookie attributes enforced:
  • HttpOnly  — JS cannot read the cookie (XSS protection)
  • Secure    — only sent over HTTPS (skipped in local dev)
  • SameSite  — "none" in production (frontend and backend are on different
                registrable domains — thelyceum.site vs up.railway.app —
                so this is a genuinely cross-site cookie; "lax" would never
                be sent back on API calls at all). "lax" in local dev, where
                frontend/backend share the "localhost" site.
  • Path=/    — available to all routes
  • Max-Age   — 1 hour (matches Firebase ID token lifetime)

This cookie is supplementary — every request is still authenticated via the
Authorization: Bearer <id_token> header (see app.api.deps.require_auth),
which is what actually gates every endpoint. Nothing currently reads this
cookie server-side; it exists for future same-origin/SSR use cases.
"""

from __future__ import annotations

import os
from fastapi import APIRouter, HTTPException, Request, Response, Cookie
from pydantic import BaseModel

from app.core.limiter import limiter, get_client_ip
from app.services import recaptcha as recaptcha_svc
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
    SameSite  — see module docstring for why this differs between prod/dev
    Path      — available to all routes
    Max-Age   — 1 hour
    """
    response.set_cookie(
        key=COOKIE_NAME,
        value=token,
        max_age=COOKIE_MAX_AGE,
        path="/",
        httponly=True,                          # XSS: JS cannot read this cookie
        secure=_IS_PROD,                         # HTTPS only in production; False locally so dev works
        samesite="none" if _IS_PROD else "lax",  # cross-site in prod, same-site (localhost) in dev
    )


def _clear_session_cookie(response: Response) -> None:
    response.delete_cookie(
        key=COOKIE_NAME,
        path="/",
        httponly=True,
        secure=_IS_PROD,
        samesite="none" if _IS_PROD else "lax",
    )


class SessionRequest(BaseModel):
    id_token: str   # Firebase ID token from the client SDK


@router.post("/session", status_code=204)
@limiter.limit("20/minute")
async def create_session(request: Request, body: SessionRequest, response: Response):
    """
    Verify a Firebase ID token and issue a secure HttpOnly session cookie.

    Called on every auth state change on the frontend (sign-in, sign-up,
    and session restore on page load/new tab) — not just the initial login —
    so this is rate-limited generously (20/min) rather than under the strict
    anti-brute-force limit. The actual credential-guessing surface is gated
    separately by POST /auth/login-attempt below.
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


@router.post("/login-attempt", status_code=204)
@limiter.limit("2/5minute")
async def login_attempt_gate(request: Request):
    """
    Rate-limit + bot-check gate for the email/password login and signup form.

    signInWithEmailAndPassword/createUserWithEmailAndPassword run entirely
    client-side against Firebase's own servers — our backend never sees the
    credentials, so it can't rate limit or bot-check that call directly. The
    frontend calls this endpoint first (with an optional reCAPTCHA v3 token
    in the JSON body: {"recaptcha_token": "..."}) and only proceeds to
    Firebase if this doesn't 403/429:
      - 429 — more than 2 attempts from this IP in the last 5 minutes.
      - 403 — reCAPTCHA score too low (looks automated), only enforced once
        RECAPTCHA_SECRET_KEY is configured.

    Body is parsed manually (rather than a Pydantic model) so this stays
    backward-compatible with callers that send no body at all.
    """
    if recaptcha_svc.is_configured():
        token = None
        try:
            payload = await request.json()
            if isinstance(payload, dict):
                token = payload.get("recaptcha_token")
        except Exception:
            pass
        if not await recaptcha_svc.verify(token or "", remote_ip=get_client_ip(request)):
            raise HTTPException(status_code=403, detail="Bot verification failed")


# ── Email OTP — required at both signup and every login ────────────────────
# See app.services.email_otp for the code lifecycle and app.services.email
# for the actual SMTP send. New subsystem, independent of Firebase's own
# link-based email verification (that flow is untouched).

class OtpRequestBody(BaseModel):
    email: str
    purpose: str  # "signup" | "login"


@router.post("/otp/request")
@limiter.limit("5/minute")
async def otp_request(request: Request, body: OtpRequestBody):
    from app.services import email_otp, email as email_svc

    email = body.email.strip().lower()
    if not email or "@" not in email:
        raise HTTPException(status_code=400, detail="valid_email_required")
    if body.purpose not in ("signup", "login"):
        raise HTTPException(status_code=400, detail="invalid_purpose")

    result = email_otp.request_code(email, body.purpose)
    if not result["ok"]:
        raise HTTPException(status_code=429, detail=f"try_again_in_{result['retry_after']}s")

    sent = email_svc.send_email(
        email,
        "Mã xác nhận The Lyceum",
        f"Mã xác nhận của bạn là: {result['code']}\n\nMã có hiệu lực trong 10 phút. "
        "Nếu bạn không yêu cầu mã này, hãy bỏ qua email này.",
    )
    # SMTP not configured is a deployment gap, not a client error — the code
    # still exists and is logged server-side (app.services.email), so this
    # stays a 200 rather than blocking local/dev use entirely.
    return {"ok": True, "delivered": sent}


class OtpVerifyBody(BaseModel):
    email: str
    purpose: str
    code: str


@router.post("/otp/verify")
@limiter.limit("10/minute")
async def otp_verify(request: Request, body: OtpVerifyBody):
    from app.services import email_otp

    ok = email_otp.verify_code(body.email, body.purpose, body.code)
    if not ok:
        raise HTTPException(status_code=400, detail="invalid_or_expired_code")
    return {"ok": True}
