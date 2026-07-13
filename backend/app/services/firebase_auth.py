from __future__ import annotations

import asyncio
from collections.abc import Mapping

import jwt
from fastapi import HTTPException, status
from jwt import PyJWKClient

from app.core.config import settings

_jwks_client: PyJWKClient | None = None
_jwks_lock = asyncio.Lock()


async def _get_client() -> PyJWKClient:
    global _jwks_client
    if _jwks_client:
        return _jwks_client
    async with _jwks_lock:
        if _jwks_client:
            return _jwks_client
        _jwks_client = PyJWKClient(settings.firebase_jwks_url)
        return _jwks_client


async def verify_firebase_id_token(token: str) -> Mapping[str, str]:
    if not token:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Missing token")
    if not settings.firebase_project_id or not settings.firebase_issuer:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Missing FIREBASE_PROJECT_ID")

    client = await _get_client()
    try:
        signing_key = client.get_signing_key_from_jwt(token)
        payload = jwt.decode(
            token,
            signing_key.key,
            algorithms=["RS256"],
            audience=settings.firebase_project_id,
            issuer=settings.firebase_issuer,
            options={"verify_exp": True},
        )
        # Email verification check disabled
        return payload
    except HTTPException:
        raise
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid Firebase token") from exc

