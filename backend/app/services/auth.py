"""Supabase JWT verification.

Supabase ký token bằng RS256 (JWKS endpoint) hoặc HS256 (JWT Secret).
File này hỗ trợ cả hai — thử RS256 trước, fallback HS256.
"""
from __future__ import annotations

import asyncio
from collections.abc import Mapping
from typing import Annotated

import jwt
from fastapi import HTTPException, status, Depends, Header
from jwt import PyJWKClient
from sqlalchemy.orm import Session
from sqlalchemy import select

from app.core.config import settings
from app.db.session import get_db
from app.models.entities import UserProfile

# ── JWKS client cho RS256 ────────────────────────────────────
_sb_jwks_client: PyJWKClient | None = None
_sb_jwks_lock = asyncio.Lock()


async def _get_sb_jwks_client() -> PyJWKClient:
    global _sb_jwks_client
    if _sb_jwks_client:
        return _sb_jwks_client
    async with _sb_jwks_lock:
        if _sb_jwks_client:
            return _sb_jwks_client
        _sb_jwks_client = PyJWKClient(settings.supabase_jwks_url)
        return _sb_jwks_client


async def verify_access_token(token: str) -> Mapping[str, object]:
    """Verify a Supabase user access token. Returns the decoded payload."""
    if not token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing Supabase token",
        )

    # ── Attempt 1: RS256 via JWKS ────────────────────────────
    try:
        client = await _get_sb_jwks_client()
        signing_key = client.get_signing_key_from_jwt(token)
        payload = jwt.decode(
            token,
            signing_key.key,
            algorithms=["RS256", "ES256"],
            audience=settings.supabase_jwt_audience,
            options={"verify_exp": True},
        )
        return payload
    except Exception:
        pass  # fall through to HS256

    # ── Attempt 2: HS256 via JWT Secret ──────────────────────
    if settings.supabase_jwt_secret:
        try:
            payload = jwt.decode(
                token,
                settings.supabase_jwt_secret,
                algorithms=["HS256"],
                audience=settings.supabase_jwt_audience,
                options={"verify_exp": True},
            )
            return payload
        except jwt.ExpiredSignatureError as exc:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Supabase token expired",
            ) from exc
        except Exception as exc:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid Supabase token",
            ) from exc

    raise HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Could not verify Supabase token — check SUPABASE_JWT_SECRET",
    )


async def get_current_user(
    authorization: Annotated[str | None, Header()] = None,
    db: Session = Depends(get_db),
) -> UserProfile:
    """FastAPI dependency to get the current authenticated user."""
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing or invalid Authorization header",
        )

    token = authorization[7:].strip()
    payload = await verify_access_token(token)

    # Get user_id or sub from token
    user_id = payload.get("sub") or payload.get("user_id")
    if not user_id:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid token payload",
        )

    # Look up user in database
    result = db.execute(
        select(UserProfile).where(UserProfile.auth_subject == user_id)
    )
    user = result.scalar_one_or_none()

    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User not found",
        )

    return user
