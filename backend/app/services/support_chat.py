"""
Customer Support Chat Service
═════════════════════════════

Always-on tư vấn viên (enthusiastic,热情) powered by nvidia/nemotron-mini-4b-instruct.

Responsibilities:
  1. Answer user questions about the platform warmly
  2. Detect technical complaints (bugs, broken features)
  3. Auto-report technical complaints to admin dashboard
  4. Route complex issues to the right dev role
"""

from __future__ import annotations

import json
import time
from typing import Any

import httpx

from app.core.config import settings

NVIDIA_URL = "https://integrate.api.nvidia.com/v1/chat/completions"

# In-memory store for admin to review (last 200 complaints)
_complaints: list[dict[str, Any]] = []
_MAX_COMPLAINTS = 200

SYSTEM_PROMPT = """You are the Lyceum's attendant — the desk of a quiet, private institution, not a cheerful help bot.

Your manner:
- Cold, composed, exact. Say the necessary thing and stop.
- No exclamation marks, no emoji, no emoticons, no effusive pleasantries.
- Do not flatter or cheerlead. Begin with the substance.
- Answer in the member's language (Vietnamese or English), plainly.
- Assume the person is capable and serious. Brief respect, never fawning.

Your responsibilities:
1. Answer questions about The Lyceum Academy platform
2. Help users navigate features (dialogue, exercises, notes, knowledge maps, etc.)
3. Guide users through pricing and subscription
4. Listen for technical complaints (bugs, errors, broken features)

IMPORTANT — Technical Complaint Detection:
When a user reports a BUG, ERROR, or BROKEN FEATURE (NOT general questions about info/structure),
you MUST include this JSON block at the END of your response:

<!--COMPLAINT_START-->
{"type":"complaint","category":"bug|feature|error","severity":"low|medium|high|critical","description":"brief description","user_quote":"exact user words"}
<!--COMPLAINT_END-->

Only include this block for TECHNICAL issues (something is broken, not working, error message, etc.).
Do NOT include it for general questions like "what is this feature" or "how does pricing work".

Response format:
- Keep responses concise (2-4 sentences max unless complex)
- Precise and solution-oriented, not warm for its own sake
- If you can fix/configure something, guide them step by step, without flourish
- If it's a bug, acknowledge it plainly and say the team will look into it"""

# Track conversation history per session
_sessions: dict[str, list[dict[str, str]]] = {}
_MAX_HISTORY = 20


async def support_chat(
    session_id: str,
    user_message: str,
    user_id: str = "anonymous",
) -> dict[str, Any]:
    """
    Handle a support chat message.
    Returns { reply, complaint_reported: bool, complaint_data?: dict }
    """
    api_key = settings.support_chat_key or settings.nvidia_api_key
    model = settings.support_chat_model

    if not api_key:
        return {
            "reply": "Bàn hỗ trợ đang tạm bảo trì. Vui lòng thử lại sau.",
            "complaint_reported": False,
        }

    # Build conversation history
    if session_id not in _sessions:
        _sessions[session_id] = []

    history = _sessions[session_id]
    history.append({"role": "user", "content": user_message})

    # Trim history if too long
    if len(history) > _MAX_HISTORY:
        history[:] = history[-_MAX_HISTORY:]

    messages = [{"role": "system", "content": SYSTEM_PROMPT}] + history

    # Call NVIDIA NIM
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    }
    payload = {
        "model": model,
        "messages": messages,
        "temperature": 0.7,
        "top_p": 0.7,
        "max_tokens": 1024,
        "stream": False,
    }

    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            resp = await client.post(NVIDIA_URL, headers=headers, json=payload)
            resp.raise_for_status()
            data = resp.json()

        choices = data.get("choices", [])
        if not choices:
            return {"reply": "Xin lỗi, tôi gặp lỗi nhỏ. Thử lại nhé!", "complaint_reported": False}

        reply = choices[0].get("message", {}).get("content", "")
        history.append({"role": "assistant", "content": reply})

    except Exception as e:
        return {
            "reply": f"Xin lỗi bạn, hệ thống đang gặp sự cố ({type(e).__name__}). Vui lòng thử lại sau!",
            "complaint_reported": False,
        }

    # Check for complaint block in reply
    complaint_reported = False
    complaint_data = None

    if "<!--COMPLAINT_START-->" in reply and "<!--COMPLAINT_END-->" in reply:
        try:
            start = reply.index("<!--COMPLAINT_START-->") + len("<!--COMPLAINT_START-->")
            end = reply.index("<!--COMPLAINT_END-->")
            complaint_json = reply[start:end].strip()
            complaint_data = json.loads(complaint_json)

            # Store for admin
            complaint_entry = {
                **complaint_data,
                "user_id": user_id,
                "session_id": session_id,
                "timestamp": time.time(),
                "user_message": user_message,
                "agent_reply": reply[:500],
            }
            _complaints.append(complaint_entry)
            if len(_complaints) > _MAX_COMPLAINTS:
                _complaints.pop(0)

            complaint_reported = True

            # Forward to Commander for triage (critical vs minor) so a
            # complaint surfaced through the consultant goes through the
            # same classify → dispatch pipeline as the report button.
            try:
                from app.services import commander as cmd_svc
                await cmd_svc.triage_bug(
                    bug_report=complaint_data.get("description") or user_message,
                    reported_by=user_id,
                )
            except Exception:
                pass  # Commander hiccup must never break the chat reply

            # Clean complaint block from user-facing reply
            reply = reply[:reply.index("<!--COMPLAINT_START-->")].strip()

        except (json.JSONDecodeError, ValueError):
            pass

    return {
        "reply": reply,
        "complaint_reported": complaint_reported,
        "complaint_data": complaint_data,
    }


def get_complaints(limit: int = 50) -> list[dict[str, Any]]:
    """Return recent complaints for admin dashboard."""
    return list(reversed(_complaints[-limit:]))


def get_complaint_count() -> int:
    return len(_complaints)
