"""
WolframAlpha plugin (SOC-17).

Used for two cases, both about protecting answer accuracy:
  1. The query is pure computation (arithmetic, algebra, unit conversion,
     "what is X% of Y", etc.) that doesn't need a full LLM call — Wolfram's
     Short Answers API is faster, cheaper, and exact.
  2. Every chat provider in ai.chat()'s cascade failed or errored — Wolfram
     is tried as a last-resort answer for computational queries instead of
     surfacing a bare 502 to the student.

Docs: https://products.wolframalpha.com/short-answers-api/documentation
"""

from __future__ import annotations

import re

import httpx

from app.core.config import settings

SHORT_ANSWERS_URL = "https://api.wolframalpha.com/v1/result"

# Signals a query is a computation Wolfram can answer directly, rather than
# something needing tutoring/explanation (which stays with the LLM cascade).
_COMPUTE_PATTERNS = [
    r"\d\s*[\+\-\*/\^%]\s*\d",           # 12 * 7, 3^2
    r"\bsqrt\b|\bcăn\b|√",
    r"\btích phân\b|\bintegral\b|\bderivative\b|\bđạo hàm\b",
    r"\bgiải phương trình\b|\bsolve\b.*=",
    r"=\s*\?|\bbằng bao nhiêu\b|\bbằng mấy\b",
    r"\bconvert\b|\bđổi\b.*\b(kg|km|cm|mile|inch|độ|celsius|fahrenheit)\b",
    r"\blog\(|\bln\(|\bsin\(|\bcos\(|\btan\(",
]
_COMPUTE_RE = re.compile("|".join(_COMPUTE_PATTERNS), re.IGNORECASE)


def is_configured() -> bool:
    return bool(settings.wolfram_app_id)


def looks_computational(text: str) -> bool:
    """Heuristic: does this read like a calculation rather than a concept/essay question?"""
    if not text or len(text) > 200:
        # Long prose is virtually never a bare computation query.
        return False
    return bool(_COMPUTE_RE.search(text))


async def compute(query: str) -> str | None:
    """
    Ask WolframAlpha for a short plain-text answer.
    Returns None (never raises) if unconfigured, Wolfram has no result (501),
    or the request fails — callers should treat None as "fall through".
    """
    if not settings.wolfram_app_id:
        return None

    params = {"i": query, "appid": settings.wolfram_app_id}
    try:
        async with httpx.AsyncClient(timeout=15) as client:
            resp = await client.get(SHORT_ANSWERS_URL, params=params)
            if resp.status_code == 501:
                # Wolfram's "no short answer available" response
                return None
            resp.raise_for_status()
            answer = resp.text.strip()
            return answer or None
    except Exception:
        import logging
        logging.getLogger("pclick").warning("wolfram.compute failed", exc_info=True)
        return None
