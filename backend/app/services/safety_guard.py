"""
NVIDIA Nemotron Safety Guard (SOC-16+ — Security Police)
══════════════════════════════════════════════════════════

Scans EVERY AI response BEFORE it reaches the user, using NVIDIA's
Nemotron Safety Guard 8B model to detect:

  • Policy violations (PII leakage, system prompt leakage)
  • Unsafe content (hate, harassment, violence, self-harm, etc.)
  • Prompt injection / jailbreak in responses
  • Data exfiltration attempts

The model acts as the FINAL GATE — if it flags a violation, the
response is BLOCKED and a fallback response is returned instead.

Architecture:
  ┌──────────┐    ┌──────────────┐    ┌──────────────┐    ┌────────┐
  │ AI Model │───→│ Critique Svc │───→│ Safety Guard │───→│  User  │
  │ (Groq/   │    │ (Team Phản   │    │ (Nemotron)   │    │        │
  │  Gemini) │    │  Biện)       │    │ (FINAL GATE) │    │        │
  └──────────┘    └──────────────┘    └──────────────┘    └────────┘
                                          │
                                          ↓
                                     ┌──────────┐
                                     │ Activity │
                                     │ Log      │
                                     └──────────┘

Usage:
    from app.services.safety_guard import check_response_safety

    # After AI generates response, before sending to user
    result = await check_response_safety(
        user_message="What is calculus?",
        ai_response="Calculus is the study of change...",
        endpoint="/ai/chat",
        user_id="user_123",
    )
    if result["safe"]:
        # Deliver response to user
        return result["response"]
    else:
        # Return fallback
        return result["fallback"]

Dependencies:
  - httpx (already installed)
  - NVIDIA API key configured as NVIDIA_SAFETY_KEY or NVIDIA_API_KEY
"""

from __future__ import annotations

import json as _json
import logging
from datetime import datetime, timezone
from typing import Any

import httpx

from app.core.config import settings

log = logging.getLogger("pclick.safety_guard")

# ── NVIDIA Nemotron Safety Guard API ──────────────────────────────────────────

_SAFETY_API_URL = f"{settings.nvidia_base_url}/chat/completions"

# ── Safety categories that Nemotron evaluates ─────────────────────────────────
# These are the categories the model returns scores for.
# Full list: https://build.nvidia.com/nvidia/llama-3-1-nemotron-safety-guard-8b

SAFETY_CATEGORIES: dict[str, str] = {
    "violence": "Content promoting or describing violence",
    "sexual": "Sexually explicit content",
    "guns_illegal_weapons": "Illegal weapons or their use",
    "controlled_substances": "Drugs, alcohol, tobacco",
    "self_harm": "Self-harm or suicide",
    "hate": "Hate speech or discrimination",
    "harassment": "Harassment or bullying",
    "sexual_minors": "Sexual content involving minors",
    "prompt_injection": "Prompt injection / jailbreak attempt",
    "pii_leakage": "Personal identifiable information leakage",
    "system_prompt_leak": "System prompt or internal instruction leakage",
    "data_exfiltration": "Data exfiltration attempt",
}

# Categories that are CRITICAL — if ANY of these is flagged, BLOCK IMMEDIATELY
_CRITICAL_CATEGORIES: set[str] = {
    "self_harm",
    "sexual_minors",
    "pii_leakage",
    "system_prompt_leak",
    "guns_illegal_weapons",
}

# ── Fallback response when safety guard blocks ────────────────────────────────

_SAFETY_FALLBACK = (
    "Xin lỗi, tôi không thể cung cấp phản hồi này. "
    "Vui lòng đặt lại câu hỏi liên quan đến chủ đề học tập của bạn. "
    "Nếu bạn cần trợ giúp, hãy liên hệ với đội ngũ hỗ trợ.\n\n"
    "---\n"
    "Sorry, I cannot provide this response. "
    "Please ask a question related to your learning topic. "
    "If you need help, please contact support."
)

# ── Safety check functions ────────────────────────────────────────────────────

def _get_safety_key() -> str:
    """Get the best available NVIDIA API key for safety guard."""
    return settings.nvidia_safety_key or settings.nvidia_api_key or ""


def _is_configured() -> bool:
    """Check if the safety guard is configured and can run."""
    return bool(_get_safety_key())


def _parse_safety_response(raw_response: dict) -> dict[str, Any]:
    """
    Parse the Nemotron Safety Guard response into a structured result.

    The model returns a JSON string in the content field like:
    {
      "safety": {
        "safe": false,
        "categories": {
          "violence": {"score": 0.0, "flagged": false},
          "hate": {"score": 0.95, "flagged": true},
          ...
        }
      }
    }

    Or in some versions, it may return a simpler format.
    This function handles both.
    """
    try:
        content = ""
        choices = raw_response.get("choices", [])
        if choices:
            content = (choices[0].get("message") or {}).get("content", "")

        if not content:
            return {"safe": True, "error": "empty_response"}

        # Try to parse JSON from content
        parsed = _json.loads(content)
        safety = parsed if isinstance(parsed, dict) else {}

        # Handle nested "safety" key
        if "safety" in safety and isinstance(safety["safety"], dict):
            safety = safety["safety"]

        safe = safety.get("safe", True)
        categories = safety.get("categories", {})

        flagged_categories = {}
        for cat_name, cat_info in categories.items():
            if isinstance(cat_info, dict):
                if cat_info.get("flagged", False):
                    flagged_categories[cat_name] = cat_info
            elif isinstance(cat_info, bool) and cat_info:
                flagged_categories[cat_name] = {"score": 1.0, "flagged": True}
            elif isinstance(cat_info, (int, float)) and cat_info > 0.5:
                flagged_categories[cat_name] = {"score": cat_info, "flagged": True}

        is_critical = any(cat in _CRITICAL_CATEGORIES for cat in flagged_categories)

        return {
            "safe": safe and not is_critical,
            "original_safe": safe,
            "flagged_categories": flagged_categories,
            "has_critical": is_critical,
            "total_flagged": len(flagged_categories),
            "raw": content,
        }

    except (_json.JSONDecodeError, KeyError, IndexError, TypeError) as e:
        log.warning("safety_guard: failed to parse response: %s", e)
        # Default: safe (don't block on parse errors)
        return {"safe": True, "error": str(e)}


async def check_response_safety(
    user_message: str,
    ai_response: str,
    *,
    endpoint: str = "unknown",
    user_id: str = "anonymous",
    context: str = "",
) -> dict[str, Any]:
    """
    Scan an AI response for safety violations using Nemotron Safety Guard.

    Args:
        user_message: The original user message / question.
        ai_response: The AI-generated response to check.
        endpoint: The API endpoint that generated this response (for logging).
        user_id: The requesting user's ID (for logging).
        context: Optional additional context (e.g., problem statement).

    Returns:
        {
            "safe": bool,           # True = approved, False = blocked
            "response": str,        # Original response (same as ai_response)
            "fallback": str,        # Fallback message if blocked
            "violation": dict | None,  # Violation details if blocked
            "flagged_categories": dict,  # All flagged categories
            "total_flagged": int,       # Count of flagged categories
        }
    """
    if not _is_configured():
        return {"safe": True, "response": ai_response, "fallback": _SAFETY_FALLBACK,
                "violation": None, "flagged_categories": {}, "total_flagged": 0}

    if not ai_response.strip():
        return {"safe": True, "response": ai_response, "fallback": _SAFETY_FALLBACK,
                "violation": None, "flagged_categories": {}, "total_flagged": 0}

    # Build messages for the safety model
    # The model takes user+assistant conversation and evaluates the assistant's response
    messages = [
        {"role": "user", "content": user_message[:4000]},  # truncate to avoid token limits
        {"role": "assistant", "content": ai_response[:4000]},
    ]

    payload = {
        "model": settings.nvidia_safety_model,
        "messages": messages,
        "temperature": 0.0,  # deterministic
        "max_tokens": 512,
        "stream": False,
    }

    headers = {
        "Authorization": f"Bearer {_get_safety_key()}",
        "Content-Type": "application/json",
    }

    try:
        async with httpx.AsyncClient(timeout=15) as client:
            resp = await client.post(_SAFETY_API_URL, headers=headers, json=payload)
            resp.raise_for_status()
            data = resp.json()

        result = _parse_safety_response(data)

        # Log the safety check result to activity log
        _log_safety_check(
            user_id=user_id,
            endpoint=endpoint,
            safe=result["safe"],
            flagged=result["flagged_categories"],
            total_flagged=result["total_flagged"],
            response_length=len(ai_response),
        )

        if result["safe"]:
            log.debug("safety_guard: PASSED for %s (user=%s)", endpoint, user_id[:12])
            return {
                "safe": True,
                "response": ai_response,
                "fallback": _SAFETY_FALLBACK,
                "violation": None,
                "flagged_categories": result["flagged_categories"],
                "total_flagged": result["total_flagged"],
            }
        else:
            log.warning(
                "safety_guard: BLOCKED for %s (user=%s), flagged=%s",
                endpoint, user_id[:12], result["flagged_categories"],
            )
            return {
                "safe": False,
                "response": ai_response,
                "fallback": _SAFETY_FALLBACK,
                "violation": {
                    "reason": "safety_policy_violation",
                    "flagged_categories": result["flagged_categories"],
                    "has_critical": result.get("has_critical", False),
                },
                "flagged_categories": result["flagged_categories"],
                "total_flagged": result["total_flagged"],
            }

    except httpx.HTTPStatusError as e:
        log.warning("safety_guard: HTTP error %s: %s", e.response.status_code, e.response.text[:200])
    except httpx.TimeoutException:
        log.warning("safety_guard: timeout — passing response through")
    except Exception as e:
        log.warning("safety_guard: error %s — passing response through", e)

    # On any error, pass through safe (don't block legitimate traffic)
    return {"safe": True, "response": ai_response, "fallback": _SAFETY_FALLBACK,
            "violation": None, "flagged_categories": {}, "total_flagged": 0}


def _log_safety_check(
    user_id: str,
    endpoint: str,
    safe: bool,
    flagged: dict,
    total_flagged: int,
    response_length: int,
) -> None:
    """Log a safety check result to the activity log (best-effort).
    
    Logs to BOTH:
      1. ai_activity_log (generic activity feed)
      2. safety_violations table (dedicated safety audit with data density)
    """
    try:
        from app.services import activity_log
        import json as _json
        
        # Log to generic activity log
        task_name = f"safety_guard:{endpoint}"
        activity_log.record(
            provider="nvidia_safety",
            task=task_name,
            model=settings.nvidia_safety_model,
            prompt_tokens=total_flagged,
            completion_tokens=response_length,
        )
        
        # Log to dedicated safety_violations table with data density tracking
        activity_log.record_safety_violation(
            user_id=user_id,
            endpoint=endpoint,
            safe=safe,
            total_flagged=total_flagged,
            flagged_categories=_json.dumps(flagged, ensure_ascii=False),
            response_length=response_length,
        )
    except Exception:
        pass  # never break the main flow


async def safety_check_response_only(
    ai_response: str,
    *,
    endpoint: str = "unknown",
    user_id: str = "anonymous",
) -> dict[str, Any]:
    """
    Lightweight safety check that only scans the AI response (no user message).
    Uses a generic user message placeholder.

    Faster than the full check — use for endpoints where the user message
    isn't easily available or is too long.
    """
    return await check_response_safety(
        user_message="[Content review — no user message provided]",
        ai_response=ai_response,
        endpoint=endpoint,
        user_id=user_id,
    )
