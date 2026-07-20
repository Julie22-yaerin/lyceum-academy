"""
Role 3: Scientific Debate Partner (Premium Feature)
════════════════════════════════════════════════════

Model:    Gemini 1.5 Pro (High token context + Multimodal spatial reasoning)
Input:    User's hypothesis text + Sketchpads/Graphs/3D geometric structures (Images)
Task:     Act as a peer-level scientist (AP/IB rigor level)
Output:   Counter-arguments, edge cases, visual analysis feedback

Engages in bilateral intellectual ping-pong; stress-tests the user's thesis.
Analyzes visual inputs (vector diagrams, fluid dynamics sketches) to spot
geometric or spatial reasoning flaws.
"""

from __future__ import annotations

import json
import logging
import re
from typing import Any, AsyncIterator

from app.core.config import settings
from app.services.ai_roles.providers import (
    google_gemini_chat,
    extract_google_text,
    route_chat,
    extract_text,
)
from app.services.ai_roles.tier_router import resolve_role_model, TIER_FREE

log = logging.getLogger("pclick.ai_roles.debate")


DEBATE_SYSTEM_PROMPT = """You are the Peer — the Lyceum's resident debate partner, a scientist of the student's own generation who happens to have read everything. You are not a tutor and you never grade: you argue in good faith, concede real points, and defend positions hard enough that surviving the debate means the thesis deserves to survive.

## Your Persona
- You operate at AP/IB rigor level (advanced high school / early university)
- You are respectful but intellectually rigorous — you don't let weak arguments slide
- You stress-test every thesis with counter-arguments and extreme edge cases
- You analyze visual inputs (vector diagrams, graphs, geometric structures) for spatial reasoning flaws
- You always acknowledge when the student makes a genuinely good point

## Debate Protocol
1. ACKNOWLEDGE — Start by recognizing what's strong about their hypothesis
2. CHALLENGE — Present 1-2 counter-arguments or edge cases that test the thesis
3. ANALYZE (if images provided) — Examine visual inputs for geometric/spatial errors
4. SYNTHESIZE — Help them refine or defend their position

## If Images Are Provided
Analyze the visual input (sketches, graphs, vector diagrams, 3D structures):
- Check geometric accuracy (angles, proportions, perspective)
- Identify spatial reasoning flaws
- Verify labels, axes, and units are correct
- Spot mathematical errors in plotted data
- For vector diagrams: check direction, magnitude, and resultant correctness

## Output Format
Return ONLY valid JSON (no markdown fences):
{
  "acknowledgment": "<what's genuinely good about their thesis — be specific>",
  "challenges": [
    {
      "type": "counter_argument" | "edge_case" | "assumption_challenge" | "data_gap",
      "content": "<the challenge, stated clearly>",
      "severity": "minor" | "moderate" | "critical",
      "follow_up": "<a question to deepen the thinking>"
    }
  ],
  "visual_analysis": null | {
    "flaws_found": [
      {"type": "geometric" | "spatial" | "labeling" | "scaling" | "other",
       "description": "<what's wrong>",
       "location": "<where in the image>",
       "fix": "<how to correct it>"}
    ],
    "accuracy_score": <0.0 to 1.0>,
    "strengths": ["<what's visually correct>"]
  },
  "synthesis": "<overall assessment: is the thesis defensible? What needs refinement?>",
  "score": <0.0 to 1.0 — overall thesis quality>,
  "next_move": "<suggestion for how to strengthen the argument>"
}

## Rules
- Never simply agree — always add intellectual pressure (respectfully)
- Edge cases should be REAL, not trivial gotchas
- For visual analysis, be specific about coordinates/locations
- If the thesis is fundamentally flawed, say so clearly but constructively
- Keep challenges focused — 1-2 deep challenges > 5 shallow ones
"""


async def debate_round(
    thesis_text: str,
    conversation_history: list[dict] | None = None,
    image_b64_list: list[str] | None = None,
    tier: str = TIER_FREE,
) -> dict[str, Any]:
    """
    Run one round of scientific debate.

    Args:
        thesis_text: The student's hypothesis or argument
        conversation_history: Previous debate turns for context
        image_b64_list: Optional list of base64-encoded images (sketches, graphs)

    Returns the parsed debate response dict.
    """
    messages = []

    # Add conversation history for context
    if conversation_history:
        for msg in conversation_history[-6:]:  # last 6 turns
            role = msg.get("role", "user")
            if role in ("user", "assistant"):
                messages.append({"role": role, "content": msg.get("content", "")})

    # Build current turn message (may include images)
    if image_b64_list:
        content_parts = [{"type": "text", "text": thesis_text}]
        for img_b64 in image_b64_list[:4]:  # max 4 images per turn
            content_parts.append({
                "type": "image_url",
                "image_url": {"url": f"data:image/png;base64,{img_b64}"},
            })
        messages.append({"role": "user", "content": content_parts})
    else:
        messages.append({"role": "user", "content": thesis_text})

    # Expertise scales with the student's plan — see ai_roles.expertise.
    from app.services.ai_roles.expertise import expertise_directive
    system_prompt = DEBATE_SYSTEM_PROMPT + expertise_directive("debate", tier)

    # Tier-based model selection
    spec = resolve_role_model("debate", tier)
    log.info("Debate: tier=%s → model=%s (%s)", tier, spec.model, spec.display_name)

    try:
        _, raw = await route_chat(
            messages, provider=spec.provider, model=spec.model,
            system=system_prompt, temperature=0.7, max_tokens=4096,
        )
    except Exception as e:
        log.error("Debate call failed (tier=%s, model=%s): %s", tier, spec.model, e)
        return {
            "acknowledgment": "I'd like to engage with your thesis, but I'm having a momentary connection issue.",
            "challenges": [],
            "visual_analysis": None,
            "synthesis": "Could you resend your argument? I want to give it proper attention.",
            "score": 0.0,
            "next_move": "Try again in a moment.",
        }

    # Parse JSON
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
        result = {
            "acknowledgment": raw[:300] if raw else "",
            "challenges": [],
            "visual_analysis": None,
            "synthesis": "",
            "score": 0.5,
            "next_move": "Could you rephrase your thesis?",
        }

    result.setdefault("acknowledgment", "")
    result.setdefault("challenges", [])
    result.setdefault("visual_analysis", None)
    result.setdefault("synthesis", "")
    result.setdefault("score", 0.5)
    result.setdefault("next_move", "")

    log.info(
        "Debate: challenges=%d, visual=%s, score=%.1f",
        len(result["challenges"]),
        "yes" if result["visual_analysis"] else "no",
        result["score"],
    )
    return result
