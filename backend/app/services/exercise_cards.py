"""
Exercise Cards — build a practice deck straight from a chopped-up past
paper or a textbook excerpt the student pastes in, rather than generating
questions from scratch against the Second Brain (see app.services.ai's
generate_exercises for that path).

House rule for this deck specifically: cards are always presented
medium → hard → easy — not the usual easy-to-hard ramp. The student meets
the real difficulty first, gets tested at the hardest point second, and
only then gets the confidence-building easy card. `_DIFFICULTY_ORDER`
below enforces this server-side (never trust the client to re-sort).

Assists on these cards are deliberately limited to exactly three, and only
these three are allowed to exist here:
  - Reverse Building  — 20 Quanta  (reveal + rebuild-from-scratch, reusing
                         app.services.ai.reveal_solution / evaluate_reverse_build)
  - Image Generator   — 150 Quanta (app.services.exercise_cards.generate_problem_image
                         below) — draws the concrete SCENARIO the problem
                         describes, never the underlying theory/formula.
  - Lotus Map         — free (opens the Lotus Map tool client-side, seeded
                         with the problem text; no backend call of its own)
"""

from __future__ import annotations

import json
import logging
from typing import Any

log = logging.getLogger("pclick.exercise_cards")

MAX_CARDS = 10
DEFAULT_CARDS = 6

_DIFFICULTY_ORDER = {"medium": 0, "hard": 1, "easy": 2}

_CARD_SYSTEM = (
    "You extract individual exercise questions from raw source material a student pasted in — "
    "either a chopped-up past exam paper or a textbook excerpt. Do not invent new questions from "
    "thin air; find and clean up the ones actually present in the text (fix OCR noise, split "
    "multi-part questions apart if they're genuinely separate problems, drop non-question text "
    "like headers/instructions/answer keys).\n\n"
    "Classify each into EXACTLY one difficulty: easy, medium, or hard (no other labels).\n\n"
    "Return ONLY a JSON object, no markdown fences:\n"
    '{"cards": [{"question": "<the exercise, cleaned up>", "difficulty": "easy|medium|hard", '
    '"subject": "<short subject label>", "concepts": ["<1-3 short concept tags>"]}]}\n\n'
    "If the source has fewer distinct questions than requested, return only what's genuinely "
    "there — never pad with invented questions."
)

_PROBLEM_SCENE_SYSTEM = (
    "Given one exercise question, describe ONLY the concrete physical scenario it sets up — the "
    "objects, their arrangement, and what's happening — in under 40 words, plain visual language. "
    "Do NOT name the underlying theory, formula, law, or concept being tested. Do NOT solve it. "
    "If the question has no concrete physical scenario (e.g. it's pure symbol manipulation), "
    "describe the closest literal visual reading of its setup instead. English only, one sentence."
)


async def generate_cards(source_text: str, max_cards: int = DEFAULT_CARDS) -> list[dict[str, Any]]:
    """LLM step: pull real questions out of pasted source material, tag
    difficulty, and return them pre-sorted medium → hard → easy."""
    from app.services import ai as ai_svc

    max_cards = min(max(max_cards, 1), MAX_CARDS)
    user = f"Extract up to {max_cards} distinct exercise questions.\n\nSource material:\n{source_text[:10000]}"

    resp = await ai_svc.chat(
        [
            {"role": "system", "content": _CARD_SYSTEM},
            {"role": "user", "content": user},
        ],
        temperature=0.4, max_tokens=2048,
    )
    raw = ai_svc.extract_text(resp).strip()
    if raw.startswith("```"):
        raw = raw.strip("`")
        if raw.startswith("json"):
            raw = raw[4:]
    start, end = raw.find("{"), raw.rfind("}")
    if start == -1 or end <= start:
        raise RuntimeError("card extraction returned no usable JSON")
    parsed = json.loads(raw[start:end + 1])
    cards = parsed.get("cards") or []
    if not cards:
        raise RuntimeError("no exercise questions were found in the pasted material")

    for c in cards:
        if c.get("difficulty") not in _DIFFICULTY_ORDER:
            c["difficulty"] = "medium"

    cards.sort(key=lambda c: _DIFFICULTY_ORDER.get(c.get("difficulty"), 0))
    cards = cards[:max_cards]
    for i, c in enumerate(cards):
        c["id"] = f"ec-{i + 1}"
    return cards


async def generate_problem_image(problem_text: str) -> bytes:
    """Image Generator assist (150 Quanta): a diagram of THIS problem's
    concrete scenario, not the theory behind it. Two steps — an LLM
    distills the literal visual setup (diffusion prompts don't parse long
    exam-question text well), then the local CPU pipeline renders it."""
    from app.services import ai as ai_svc
    from app.services import local_image

    resp = await ai_svc.chat(
        [
            {"role": "system", "content": _PROBLEM_SCENE_SYSTEM},
            {"role": "user", "content": problem_text[:2000]},
        ],
        temperature=0.3, max_tokens=200,
    )
    scene = ai_svc.extract_text(resp).strip() or problem_text[:200]

    prompt = (
        f"A clear, literal technical diagram illustrating: {scene}. "
        "Simple labeled diagram style, plain white background, clean lines, no text captions "
        "beyond simple labels, no decorative elements, no artistic embellishment — depict exactly "
        "the physical setup described, nothing more."
    )
    negative = (
        "cute mascot, cartoon character, watermark, signature, photorealistic, gradient, shadow, "
        "paper texture, blurry, abstract art, decorative border"
    )
    return await local_image.generate_illustration(prompt, negative, width=512, height=384)
