"""
Shared rate limiter — lives outside main.py so router modules (auth, etc.)
can import it without a circular import back into the app entrypoint.
"""

from __future__ import annotations

import base64
import json as _json

from fastapi import Request
from slowapi import Limiter
from slowapi.util import get_remote_address


def get_user_key(request: Request) -> str:
    """Rate limit by Firebase UID when authenticated, else fall back to IP."""
    auth = request.headers.get("Authorization", "")
    if auth.startswith("Bearer "):
        token = auth[7:].strip()
        try:
            # Decode payload without signature verification — just need the UID.
            # Verification is handled by require_auth; here we only need the key.
            parts = token.split(".")
            if len(parts) == 3:
                payload_b64 = parts[1]
                padding = (4 - len(payload_b64) % 4) % 4
                payload_bytes = base64.urlsafe_b64decode(payload_b64 + "=" * padding)
                payload_data = _json.loads(payload_bytes)
                uid = payload_data.get("user_id") or payload_data.get("sub") or ""
                if uid and len(uid) > 4:
                    return f"uid:{uid}"
        except Exception:
            pass
    return get_remote_address(request)


limiter = Limiter(key_func=get_user_key)
