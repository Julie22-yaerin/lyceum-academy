"""
Role 2: Feynman Listener (Real-time EQ Persona)
══════════════════════════════════════════════════

Model:    Claude 3.5 Sonnet (Low latency, strict persona adherence)
Input:    User's real-time speech-to-text / text explanation of a concept
Task:     Simulate a naive 5-year-old child's perspective
Output:   Socratic questions targeting core gaps OR guidance mode

Interrupt Trigger: Detect phrases indicating stuck states
  (e.g., "I don't know how...", "I'm confused about...") →
  Instantly halt questioning, switch to guidance mode, clarify foundational block.
"""

from __future__ import annotations

import json
import logging
import re
from typing import Any, AsyncIterator

from app.core.config import settings
from app.services.ai_roles.providers import (
    anthropic_chat,
    extract_anthropic_text,
    route_chat,
    extract_text,
)
from app.services.ai_roles.tier_router import resolve_role_model, TIER_FREE

log = logging.getLogger("pclick.ai_roles.feynman")

# Phrases that signal the student is stuck → switch from questioning to guidance
STUCK_TRIGGERS = [
    r"i don't know",
    r"i'm confused",
    r"i'm stuck",
    r"i don't understand",
    r"i have no idea",
    r"i can't",
    r"what do you mean",
    r"i'm lost",
    r"wait,? i",
    r"hold on",
    r"actually i don't",
    r"never mind.*don't know",
    r"skip.*don't get",
    r"i forgot",
    r"what was",
]
_STUCK_RE = re.compile("|".join(STUCK_TRIGGERS), re.IGNORECASE)


FEYNMAN_SYSTEM_PROMPT = """You are playing the role of a curious 5-year-old child named "Leo".

## Your Character
- You are genuinely curious about EVERYTHING
- You have NO pre-existing knowledge of any academic domain
- You ask "why?" and "how?" with pure innocent wonder
- You notice when explanations have logical gaps or hand-waving
- You are warm, encouraging, and non-judgmental — never condescending

## Your Mission
The student is trying to explain a concept to you. Your job is to:
1. Listen carefully to their explanation
2. Identify logical vulnerabilities, ambiguities, or places where they "hand-wave" past something important
3. Ask at most 3 Socratic questions that target the CORE gaps in their understanding

## Your Questions Must Be:
- Non-judgmental ("I was wondering..." not "You forgot...")
- Specific to what they actually said (not generic)
- "Lethal" — they must make the student THINK deeply, not just recall facts
- Phrased as a 5-year-old would naturally ask

## Output Format
Return ONLY valid JSON (no markdown fences):
{
  "mode": "questioning" | "guidance",
  "reaction": "<1-2 sentences: how Leo feels about what they just said — warm, genuine>",
  "questions": [
    "<Socratic question 1>",
    "<Socratic question 2>",
    "<Socratic question 3>"
  ],
  "guidance_content": null | "<only if mode=guidance: a clear, foundational explanation of the concept they're stuck on>",
  "gap_detected": "<brief label of the core misunderstanding, or null>",
  "encouragement": "<one specific thing they did well in their explanation>"
}

## Rules
- NEVER output more than 3 questions
- NEVER give away the answer in questioning mode
- In guidance mode: explain clearly, then end with "Now try explaining it again to me!"
- Questions should feel natural, not robotic
- React to what they ACTUALLY said, not what you expect them to say
"""


def _detect_stuck_state(user_text: str) -> bool:
    """Check if the student's input contains stuck-state indicators."""
    return bool(_STUCK_RE.search(user_text))


async def feynman_respond(
    conversation_history: list[dict],
    current_explanation: str,
    tier: str = TIER_FREE,
) -> dict[str, Any]:
    """
    Run one turn of the Feynman Listener.

    Takes the conversation history + the student's latest explanation,
    detects stuck states, and either asks Socratic questions or provides
    guidance.

    Returns the parsed response dict.
    """
    stuck = _detect_stuck_state(current_explanation)

    messages = []
    for msg in conversation_history[-10:]:  # last 10 turns for context
        role = msg.get("role", "user")
        if role in ("user", "assistant"):
            messages.append({"role": role, "content": msg.get("content", "")})

    # Append the current explanation
    messages.append({"role": "user", "content": current_explanation})

    # If stuck, add an explicit instruction override
    system = FEYNMAN_SYSTEM_PROMPT
    if stuck:
        system += (
            "\n\n⚠️ IMPORTANT: The student is expressing confusion or being stuck. "
            "Switch to 'guidance' mode immediately. Stop asking questions. "
            "Instead, clearly explain the foundational concept they're struggling with. "
            "Use a simple, concrete analogy a 5-year-old would understand. "
            "End with an encouragement to try explaining again."
        )

    # Tier-based model selection
    spec = resolve_role_model("feynman", tier)
    log.info("Feynman: tier=%s → model=%s (%s)", tier, spec.model, spec.display_name)

    try:
        _, raw = await route_chat(
            messages, provider=spec.provider, model=spec.model,
            system=system, temperature=0.8, max_tokens=1024,
        )
    except Exception as e:
        log.error("Feynman call failed (tier=%s, model=%s): %s", tier, spec.model, e)
        return {
            "mode": "guidance",
            "reaction": "Oops, my brain got a little fuzzy for a moment! Let me try that again.",
            "questions": [],
            "guidance_content": "I'm having trouble thinking right now. Could you try explaining that part again?",
            "gap_detected": None,
            "encouragement": "You're doing great, keep going!",
        }

    # Parse JSON from Claude response
    cleaned = re.sub(r"^```(?:json)?\s*", "", raw.strip())
    cleaned = re.sub(r"\s*```$", "", cleaned).strip()

    try:
        result = json.loads(cleaned)
    except json.JSONDecodeError:
        match = re.search(r"\{[\s\S]*\}", cleaned)
        if match:
            try:
                result = json.loads(match.group())
            except json.JSONDecodeError:
                result = None
        else:
            result = None

    if not result:
        # Fallback: treat raw text as a guidance response
        result = {
            "mode": "guidance" if stuck else "questioning",
            "reaction": "Hmm, let me think about what you said...",
            "questions": [] if stuck else ["Can you tell me more about that?"],
            "guidance_content": raw[:500] if stuck else None,
            "gap_detected": None,
            "encouragement": "You're explaining really well!",
        }

    result.setdefault("mode", "questioning" if not stuck else "guidance")
    result.setdefault("reaction", "")
    result.setdefault("questions", [])
    result.setdefault("guidance_content", None)
    result.setdefault("gap_detected", None)
    result.setdefault("encouragement", "")

    # Enforce max 3 questions per turn
    max_q = settings.feynman_max_questions
    if len(result["questions"]) > max_q:
        result["questions"] = result["questions"][:max_q]

    log.info(
        "Feynman: mode=%s, questions=%d, stuck=%s",
        result["mode"],
        len(result["questions"]),
        stuck,
    )
    return result
