from __future__ import annotations

from fastapi import Depends, Header, HTTPException, status
from sqlalchemy.orm import Session

from app.core.config import settings
from app.db.session import get_db
from app.models.entities import AuthProviderEnum, UserProfile
from app.services.auth import verify_access_token
from app.services.firebase_auth import verify_firebase_id_token


def db_session() -> Session:
    return Depends(get_db)


async def require_auth(
    authorization: str | None = Header(default=None),
) -> dict:
    """
    Lightweight auth guard for AI endpoints.
    Verifies Firebase ID token only — no DB lookup.
    Returns the decoded token payload {user_id, email, ...}.
    """
    if not authorization:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Unauthorized")
    token = authorization.removeprefix("Bearer ").strip()
    if not token:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Unauthorized")
    return await verify_firebase_id_token(token)


async def get_current_user(
    db: Session = Depends(get_db),
    authorization: str | None = Header(default=None),
    x_dev_user_email: str | None = Header(default=None),
) -> UserProfile:
    if authorization:
        token = authorization.removeprefix("Bearer ").strip()
        # 1) thử Supabase JWT (nếu bật)
        if settings.has_supabase:
            try:
                payload = await verify_access_token(token)
                user = (
                    db.query(UserProfile)
                    .filter(
                        UserProfile.auth_provider == AuthProviderEnum.supabase,
                        UserProfile.auth_subject == str(payload["sub"]),
                    )
                    .one_or_none()
                )
                if user:
                    return user
            except HTTPException:
                pass

        # 2) fallback: Firebase ID token
        payload = await verify_firebase_id_token(token)
        subject = str(payload.get("user_id") or payload.get("sub") or "")
        email = str(payload.get("email") or "")
        if not subject:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid Firebase token subject")

        user = (
            db.query(UserProfile)
            .filter(UserProfile.auth_provider == AuthProviderEnum.firebase, UserProfile.auth_subject == subject)
            .one_or_none()
        )
        if user:
            return user

        # Auto-provision user lần đầu (MVP-friendly)
        if not email:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Firebase token missing email")
        user = UserProfile(auth_provider=AuthProviderEnum.firebase, auth_subject=subject, email=email)
        db.add(user)
        db.commit()
        db.refresh(user)
        return user
    if settings.api_allow_dev_auth and x_dev_user_email:
        user = db.query(UserProfile).filter(UserProfile.email == x_dev_user_email).one_or_none()
        if user:
            return user
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Developer user not found")
    raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Unauthorized")
