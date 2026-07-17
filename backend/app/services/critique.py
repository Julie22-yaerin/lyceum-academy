"""
Team Phản Biện — 3-Position Debate Architecture
════════════════════════════════════════════════

Mọi response trước khi tới người dùng đều phải qua team này.

┌─────────────────────────────────────────────────────────────────┐
│  Pos 1 — OpenAI GPT-4o                                         │
│  Phân tích 100% nội dung gốc. Toàn diện, không bỏ sót.        │
│                                                                  │
│  Pos 2 — Groq (qwen3-32b)                                      │
│  Tập trung ≈50% cốt lõi nhất. Chỉ tranh luận về điều quan     │
│  trọng nhất — bỏ qua chi tiết ngoại lệ.                        │
│                                                                  │
│  Pos 3 — Ollama Cloud (qwen3.5:9b) — ĐIỀU PHỐI VIÊN           │
│  Đọc 20% tinh túy. Nhận output của Pos 1 & 2, điều phối        │
│  tranh luận, chắt lọc → tối đa 6 điểm chí mạng → câu trả lời  │
└─────────────────────────────────────────────────────────────────┘

Flow:
  1. Pos 1 & Pos 2 chạy song song (asyncio.gather)
  2. Pos 3 nhận kết quả của cả hai → điều phối → chốt ≤ 6 điểm chí mạng
  3. Nếu draft pass → trả về nguyên bản
     Nếu không pass → Pos 3 viết lại response dựa trên 6 điểm chí mạng
  4. Tối đa 2 vòng revise
"""

from __future__ import annotations

import asyncio
import json as _json
import logging
import re as _re
import httpx
from typing import Any

from app.core.config import settings
from app.services.ai import (
    OPENAI_CHAT_URL,
    GROQ_CHAT_URL,
    GOOGLE_CHAT_URL,
    extract_text,
    _parse_json_robust,
    _record_usage,
)

log = logging.getLogger("pclick.critique")

# ── System prompts ────────────────────────────────────────────────────────────

_SYS_POS1 = """\
Bạn là Critic 1 trong Team Phản Biện — một hội đồng AI kiểm duyệt response \
trước khi gửi tới học sinh.

NHIỆM VỤ: Phân tích TOÀN BỘ 100% nội dung gốc của response (không bỏ sót gì).

Tập trung đánh giá:
- Độ chính xác thực tế (factual accuracy)
- Lập luận logic có chặt chẽ không
- Có điểm nào sai hoặc gây hiểu nhầm không
- Có thiếu context quan trọng không

Return ONLY valid JSON (no markdown):
{
  "pos": 1,
  "issues": ["<vấn đề cụ thể>", ...],   // empty list if none
  "critical_flags": ["<lỗi nghiêm trọng>", ...],  // empty list if none
  "verdict": "pass" | "revise",
  "notes": "<nhận xét tổng thể 1-2 câu>"
}"""

_SYS_POS2 = """\
Bạn là Critic 2 trong Team Phản Biện — một hội đồng AI kiểm duyệt response \
trước khi gửi tới học sinh.

NHIỆM VỤ: Tập trung vào ≈50% CỐT LÕI NHẤT của response.
Bỏ qua các chi tiết phụ, ngoại lệ, ví dụ nhỏ. \
Chỉ tranh luận về những gì QUAN TRỌNG NHẤT và có ảnh hưởng lớn nhất.

Tập trung đánh giá:
- Có dạy được không (Socratic) hay chỉ đưa đáp án
- Phần cốt lõi có đúng hướng giải quyết vấn đề không
- Có bỏ sót điểm chính nào không
- Học sinh đọc xong CÓ HIỂU không

Return ONLY valid JSON (no markdown):
{
  "pos": 2,
  "core_focus": "<tóm tắt 50% cốt lõi mày đang đánh giá>",
  "issues": ["<vấn đề cụ thể>", ...],
  "critical_flags": ["<lỗi nghiêm trọng>", ...],
  "verdict": "pass" | "revise",
  "notes": "<nhận xét 1-2 câu>"
}"""

_SYS_POS3_COORD = """\
Bạn là Critic 3 — ĐIỀU PHỐI VIÊN của Team Phản Biện.

NHIỆM VỤ: Đọc ý kiến của Critic 1 & Critic 2, điều phối tranh luận, \
chắt lọc ra tối đa 6 ĐIỂM CHÍ MẠNG (fatal points) — tức là những vấn đề \
quyết định đúng/sai của response này.

20% tinh túy nhất — không liệt kê những điều không quan trọng.

Sau đó phán quyết:
- Nếu không có điểm chí mạng nào → approved = true
- Nếu có ≥ 1 điểm chí mạng → approved = false, viết revised_response

Return ONLY valid JSON (no markdown):
{
  "fatal_points": [
    "<điểm chí mạng 1>",
    ...
  ],   // tối đa 6, có thể rỗng nếu không có vấn đề
  "approved": true | false,
  "synthesis": "<phán quyết tổng thể 1-2 câu>",
  "revised_response": "<toàn bộ response đã viết lại nếu approved=false, ngôn ngữ giữ nguyên; chuỗi rỗng nếu approved=true>"
}"""


def _truncate(text: str, ratio: float) -> str:
    """Return approximately ratio% of the most important content.
    Simple heuristic: take the first ratio% of sentences, which tend to
    carry the main thesis before elaboration.
    """
    sentences = _re.split(r'(?<=[.!?])\s+', text.strip())
    keep = max(1, int(len(sentences) * ratio))
    return " ".join(sentences[:keep])


# ── Individual critic calls ───────────────────────────────────────────────────

async def _pos1_openai(context: str, draft: str) -> dict | None:
    """Position 1: OpenAI GPT-4o — 100% full review."""
    if not settings.critique_openai_key:
        return None
    payload: dict[str, Any] = {
        "model":    settings.critique_openai_model,
        "messages": [
            {"role": "system", "content": _SYS_POS1},
            {"role": "user",   "content": (
                f"STUDENT REQUEST:\n{context}\n\n"
                f"DRAFT RESPONSE (100% — full text):\n{draft}"
            )},
        ],
        "temperature": 0.3,
        "max_tokens":  1024,
        "stream":      False,
    }
    headers = {
        "Authorization": f"Bearer {settings.critique_openai_key}",
        "Content-Type":  "application/json",
    }
    try:
        async with httpx.AsyncClient(timeout=45) as client:
            resp = await client.post(OPENAI_CHAT_URL, headers=headers, json=payload)
            resp.raise_for_status()
            data = resp.json()
            raw = extract_text(data)
            return _parse_json_robust(raw)
    except Exception as e:
        log.warning("Critic 1 (OpenAI) failed: %s", e)
        return None


async def _pos2_groq(context: str, draft: str) -> dict | None:
    """Position 2: Groq — 50% core focus."""
    if not settings.critique_groq_key:
        return None
    core_draft = _truncate(draft, 0.5)
    payload: dict[str, Any] = {
        "model":    settings.critique_groq_model,
        "messages": [
            {"role": "system", "content": _SYS_POS2},
            {"role": "user",   "content": (
                f"STUDENT REQUEST:\n{context}\n\n"
                f"DRAFT RESPONSE (≈50% cốt lõi):\n{core_draft}"
            )},
        ],
        "temperature": 0.3,
        "max_tokens":  min(1024, 4096),
        "stream":      False,
    }
    headers = {
        "Authorization": f"Bearer {settings.critique_groq_key}",
        "Content-Type":  "application/json",
    }
    try:
        async with httpx.AsyncClient(timeout=30) as client:
            resp = await client.post(GROQ_CHAT_URL, headers=headers, json=payload)
            resp.raise_for_status()
            data = resp.json()
            raw = extract_text(data)
            return _parse_json_robust(raw)
    except Exception as e:
        log.warning("Critic 2 (Groq) failed: %s", e)
        return None


async def _pos3_coordinate(
    context: str,
    draft: str,
    c1: dict | None,
    c2: dict | None,
) -> dict | None:
    """Position 3: Google Gemini Pro 2.5 — 20% core distiller + coordinator."""
    if not settings.critique_google_key:
        return None

    essence = _truncate(draft, 0.2)
    c1_summary = _json.dumps(c1, ensure_ascii=False) if c1 else "(unavailable)"
    c2_summary = _json.dumps(c2, ensure_ascii=False) if c2 else "(unavailable)"

    payload: dict[str, Any] = {
        "model":    settings.critique_google_model,
        "messages": [
            {"role": "system", "content": _SYS_POS3_COORD},
            {"role": "user",   "content": (
                f"STUDENT REQUEST:\n{context}\n\n"
                f"DRAFT RESPONSE (20% tinh túy):\n{essence}\n\n"
                f"--- Ý KIẾN CRITIC 1 (OpenAI, 100%) ---\n{c1_summary}\n\n"
                f"--- Ý KIẾN CRITIC 2 (Groq, 50%) ---\n{c2_summary}\n\n"
                f"FULL DRAFT (để viết lại nếu cần):\n{draft}"
            )},
        ],
        "temperature": 0.3,
        "max_tokens":  1536,
        "stream":      False,
    }
    headers = {
        "Authorization": f"Bearer {settings.critique_google_key}",
        "Content-Type":  "application/json",
    }
    try:
        async with httpx.AsyncClient(timeout=60) as client:
            resp = await client.post(GOOGLE_CHAT_URL, headers=headers, json=payload)
            resp.raise_for_status()
            data = resp.json()
            raw = extract_text(data)
            return _parse_json_robust(raw)
    except Exception as e:
        log.warning("Critic 3 (Gemini Pro 2.5 coordinator) failed: %s", e)
        return None


# ── Public API ────────────────────────────────────────────────────────────────

async def review(
    draft_response: str,
    context: str = "",
    max_rounds: int = 2,
) -> str:
    """
    Đưa draft_response qua Team Phản Biện.
    Trả về response đã được approve (gốc nếu ok, viết lại nếu không pass).

    Parameters
    ----------
    draft_response : str  — response gốc của AI
    context        : str  — câu hỏi/context gốc của student
    max_rounds     : int  — số vòng revise tối đa (default 2)
    """
    if not draft_response.strip():
        return draft_response

    # Kiểm tra có key nào không — nếu không có gì thì pass through
    has_any_key = any([
        settings.critique_openai_key,
        settings.critique_groq_key,
        settings.critique_google_key,
    ])
    if not has_any_key:
        log.warning("critique: no keys configured, passing through")
        return draft_response

    current = draft_response

    for round_num in range(1, max_rounds + 1):
        log.info("critique round %d: running debate team", round_num)

        # ── Bước 1: Critic 1 & 2 chạy song song ─────────────────────────
        c1_result, c2_result = await asyncio.gather(
            _pos1_openai(context, current),
            _pos2_groq(context, current),
            return_exceptions=False,
        )

        # ── Bước 2: Critic 3 điều phối và chốt ─────────────────────────
        verdict = await _pos3_coordinate(context, current, c1_result, c2_result)

        if verdict is None:
            # Coordinator unavailable — try simple fallback: if both critics
            # said "pass", keep draft; if either said "revise" without coordinator,
            # keep draft too (no revision without the coordinator).
            c1_v = (c1_result or {}).get("verdict", "pass")
            c2_v = (c2_result or {}).get("verdict", "pass")
            log.warning(
                "critique round %d: coordinator unavailable. c1=%s c2=%s — passing through",
                round_num, c1_v, c2_v,
            )
            return current

        approved      = verdict.get("approved", True)
        fatal_points  = verdict.get("fatal_points", [])
        synthesis     = verdict.get("synthesis", "")
        revised       = (verdict.get("revised_response") or "").strip()

        log.info(
            "critique round %d: approved=%s fatal_points=%d synthesis=%r",
            round_num, approved, len(fatal_points), synthesis[:100],
        )

        if fatal_points:
            log.info("critique fatal points: %s", fatal_points)

        if approved:
            log.info("critique panel approved on round %d", round_num)
            return current

        if revised:
            log.info("critique panel revised on round %d (%d → %d chars)",
                     round_num, len(current), len(revised))
            current = revised
        else:
            # Not approved but no revision provided — accept current
            log.warning("critique: not approved but no revision provided, passing through")
            return current

    log.info("critique max_rounds=%d reached, returning final version", max_rounds)
    return current


async def routed_review(
    draft_response: str,
    context: str = "",
    difficulty: str = "medium",
) -> str:
    """
    Difficulty-based routing — chọn số critics dựa trên độ khó PDF.

    easy / medium_low  → Pos1 (OpenAI full) + Pos3 đóng gói   [nhanh]
    medium / hard      → Pos1 + Pos2 + Pos3 điều phối          [standard]
    very_hard          → Full 3-critic debate, max 2 rounds     [toàn bộ]

    difficulty values: "easy" | "medium" | "hard" | "very_hard"
    """
    if not draft_response.strip():
        return draft_response

    has_any_key = any([
        settings.critique_openai_key,
        settings.critique_groq_key,
        settings.critique_google_key,
    ])
    if not has_any_key:
        return draft_response

    d = difficulty.lower().strip()

    # ── Easy / Medium-low: Pos1 → Pos3 đóng gói ─────────────────────────────
    if d in ("easy",):
        log.info("routed_review: EASY path — Pos1 + Pos3 only")
        c1 = await _pos1_openai(context, draft_response)
        verdict = await _pos3_coordinate(context, draft_response, c1, None)
        if verdict is None:
            return draft_response
        if verdict.get("approved", True):
            return draft_response
        revised = (verdict.get("revised_response") or "").strip()
        return revised or draft_response

    # ── Medium / Hard: Pos1 + Pos2 → Pos3 ───────────────────────────────────
    if d in ("medium",):
        log.info("routed_review: MEDIUM path — Pos1 + Pos2 + Pos3")
        c1, c2 = await asyncio.gather(
            _pos1_openai(context, draft_response),
            _pos2_groq(context, draft_response),
        )
        verdict = await _pos3_coordinate(context, draft_response, c1, c2)
        if verdict is None:
            return draft_response
        if verdict.get("approved", True):
            return draft_response
        revised = (verdict.get("revised_response") or "").strip()
        return revised or draft_response

    # ── Hard / Very Hard: full 3-critic debate, up to 2 rounds ───────────────
    log.info("routed_review: HARD/VERY_HARD path — full debate")
    return await review(draft_response, context=context, max_rounds=2)


# ── Admin chat — talk directly to one critique position ──────────────────────
# Open-ended conversation with a single position's system prompt + model,
# NOT a run of the real review() pipeline. Session history kept exactly like
# support_chat.py's _sessions (per-session list, trimmed to _MAX_HISTORY).

_admin_sessions: dict[str, list[dict[str, str]]] = {}
_ADMIN_MAX_HISTORY = 20

_POS_CONFIG = {
    1: {"system": _SYS_POS1, "url": OPENAI_CHAT_URL, "key_attr": "critique_openai_key", "model_attr": "critique_openai_model"},
    2: {"system": _SYS_POS2, "url": GROQ_CHAT_URL, "key_attr": "critique_groq_key", "model_attr": "critique_groq_model"},
    3: {"system": _SYS_POS3_COORD, "url": GOOGLE_CHAT_URL, "key_attr": "critique_google_key", "model_attr": "critique_google_model"},
}


async def admin_chat(pos: int, session_id: str, message: str) -> str:
    """
    Open-ended admin chat with a single critique position (1, 2, or 3) —
    reuses that position's real system prompt and model, but as a normal
    conversation instead of the fixed draft/verdict JSON contract.
    """
    cfg = _POS_CONFIG.get(pos)
    if not cfg:
        return "Unknown position — use 1, 2, or 3."

    api_key = getattr(settings, cfg["key_attr"])
    if not api_key:
        return f"Position {pos} has no API key configured."

    history = _admin_sessions.setdefault(session_id, [])
    history.append({"role": "user", "content": message})
    if len(history) > _ADMIN_MAX_HISTORY:
        history[:] = history[-_ADMIN_MAX_HISTORY:]

    chat_system = (
        cfg["system"]
        + "\n\nNOTE: You are now talking directly with an admin, NOT reviewing "
        "a draft response. Answer their questions plainly and conversationally "
        "in the language they write in — do not return the JSON verdict format."
    )
    messages = [{"role": "system", "content": chat_system}] + history

    headers = {"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"}
    payload = {
        "model": getattr(settings, cfg["model_attr"]),
        "messages": messages,
        "temperature": 0.4,
        "max_tokens": 1024,
        "stream": False,
    }
    try:
        async with httpx.AsyncClient(timeout=45) as client:
            resp = await client.post(cfg["url"], headers=headers, json=payload)
            resp.raise_for_status()
            reply = extract_text(resp.json()) or "(no response)"
    except Exception as e:
        log.warning("admin_chat pos%d failed: %s", pos, e)
        return f"Sorry, Position {pos} is unavailable right now ({type(e).__name__})."

    history.append({"role": "assistant", "content": reply})
    return reply


async def review_dict_field(
    result: dict,
    field: str,
    context: str = "",
    max_rounds: int = 2,
) -> dict:
    """Critique một field cụ thể trong dict response."""
    if field not in result or not isinstance(result[field], str):
        return result
    approved = await review(result[field], context=context, max_rounds=max_rounds)
    return {**result, field: approved}
