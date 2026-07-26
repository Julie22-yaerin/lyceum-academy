"""
Error Spotting ("soi lỗi") — a deliberately flawed worked example. The
student is shown a problem and a step-by-step solution that LOOKS right,
finds which step is wrong, writes the corrected step and the correct final
answer, then commits — the AI grades the whole submission at once.

The correct step/answer are never sent to the client alongside the problem:
they're kept server-side, keyed by a session id, until grading. Same
in-memory-cache shape as services/game.py's per-subject content cache —
bounded, FIFO-evicted, not a database table, because this is scratch state
for one sitting, not something that needs to outlive the session.
"""

from __future__ import annotations

import json
import logging
import uuid
from typing import Any

log = logging.getLogger("pclick.error_spotting")

_MAX_SESSIONS = 500
_SESSIONS: dict[str, dict[str, Any]] = {}  # session_id -> {examples: {example_id: ground_truth}}


def _remember(session_id: str, data: dict[str, Any]) -> None:
    if len(_SESSIONS) >= _MAX_SESSIONS:
        # Evict oldest — dict preserves insertion order in Python 3.7+.
        _SESSIONS.pop(next(iter(_SESSIONS)))
    _SESSIONS[session_id] = data


GENERATE_SYSTEM = """You write deliberately flawed worked examples for a "spot the error" exercise.

For each example: pose a concrete problem, then write a step-by-step worked solution that contains
EXACTLY ONE mistake — a plausible one a real student would make (a sign error, a dropped term, a
misapplied rule, an off-by-one, a units slip), not something absurd or obviously wrong. Every step
before and after the mistake must be genuinely correct given the (wrong) value it's working from, so
the error only shows up if you actually check that specific step's logic — not because the final
answer looks weird.

Return ONLY JSON, no fences:
{"examples": [
  {"problem": "<the problem statement>",
   "steps": ["<step 1>", "<step 2>", ...],
   "wrong_step_index": <0-based index of the flawed step>,
   "correct_step": "<what that step should have said instead>",
   "correct_final_answer": "<the correct final answer, computed from the corrected step onward>"}
]}
Produce exactly {n} examples. Keep each to 4-7 steps. Mirror the language of the topic given."""

GRADE_SYSTEM = """You grade a "spot the error" submission. You are given the original flawed steps,
the ground truth (which step was wrong, what it should say, the correct final answer), and the
student's submission (which step they flagged, their corrected step, their final answer).

Judge leniently on phrasing — the student doesn't need the exact same words, just the same
mathematical/conceptual content. Return ONLY JSON, no fences:
{"step_correct": <bool>, "correction_correct": <bool>, "answer_correct": <bool>,
 "feedback": "<2-4 sentences, direct, name what they got right and wrong, in the student's language>"}"""


async def generate_examples(subject: str, topic: str, n: int = 2) -> dict[str, Any]:
    from app.services.ai_roles.providers import route_chat

    user = f"Subject: {subject or 'general'}\nTopic: {topic or '(pick something representative)'}"
    _, raw = await route_chat(
        [{"role": "user", "content": user}],
        provider="anthropic", model="claude-3-5-sonnet-20241022",
        system=GENERATE_SYSTEM.replace("{n}", str(n)), temperature=0.7, max_tokens=2000,
    )

    cleaned = raw.strip()
    if cleaned.startswith("```"):
        cleaned = cleaned.strip("`")
        cleaned = cleaned[cleaned.find("{"):]
    start, end = cleaned.find("{"), cleaned.rfind("}")
    parsed = json.loads(cleaned[start:end + 1])
    examples = parsed.get("examples", [])
    if not examples:
        raise RuntimeError("model returned no examples")

    session_id = uuid.uuid4().hex[:16]
    ground_truth: dict[str, Any] = {}
    public_examples = []
    for ex in examples:
        example_id = uuid.uuid4().hex[:12]
        ground_truth[example_id] = {
            "wrong_step_index": ex.get("wrong_step_index"),
            "correct_step": ex.get("correct_step", ""),
            "correct_final_answer": ex.get("correct_final_answer", ""),
            "problem": ex.get("problem", ""),
            "steps": ex.get("steps", []),
        }
        public_examples.append({
            "id": example_id,
            "problem": ex.get("problem", ""),
            "steps": ex.get("steps", []),
        })

    _remember(session_id, {"examples": ground_truth})
    return {"session_id": session_id, "examples": public_examples}


async def grade_submission(
    session_id: str, example_id: str, identified_step_index: int, user_correction: str, user_final_answer: str,
) -> dict[str, Any]:
    from app.services.ai_roles.providers import route_chat

    session = _SESSIONS.get(session_id)
    if not session or example_id not in session["examples"]:
        raise ValueError("unknown_or_expired_session")
    truth = session["examples"][example_id]

    user = (
        f"Problem: {truth['problem']}\n"
        f"Flawed steps: {json.dumps(truth['steps'], ensure_ascii=False)}\n\n"
        f"Ground truth — wrong step index: {truth['wrong_step_index']}, "
        f"correct step: {truth['correct_step']}, correct final answer: {truth['correct_final_answer']}\n\n"
        f"Student's submission — flagged step index: {identified_step_index}, "
        f"their correction: {user_correction}, their final answer: {user_final_answer}"
    )
    try:
        _, raw = await route_chat(
            [{"role": "user", "content": user}],
            provider="anthropic", model="claude-3-5-sonnet-20241022",
            system=GRADE_SYSTEM, temperature=0.2, max_tokens=500,
        )
        cleaned = raw.strip()
        if cleaned.startswith("```"):
            cleaned = cleaned.strip("`")
            cleaned = cleaned[cleaned.find("{"):]
        start, end = cleaned.find("{"), cleaned.rfind("}")
        result = json.loads(cleaned[start:end + 1])
    except Exception:
        log.warning("error_spotting grading fell back to exact-match", exc_info=True)
        # Fallback: at least the step index is checkable without AI.
        result = {
            "step_correct": identified_step_index == truth["wrong_step_index"],
            "correction_correct": False,
            "answer_correct": user_final_answer.strip() == truth["correct_final_answer"].strip(),
            "feedback": "Không chấm được bằng AI lúc này — chỉ so được vị trí bước sai. So sánh phần còn lại với đáp án đúng ở dưới.",
        }

    return {
        **result,
        "correct_step_index": truth["wrong_step_index"],
        "correct_step": truth["correct_step"],
        "correct_final_answer": truth["correct_final_answer"],
    }
