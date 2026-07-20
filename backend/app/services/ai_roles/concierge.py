"""
Role 4: Lead Concierge & Socratic Chatter (Frontline Interface)
═══════════════════════════════════════════════════════════════

Model:    Claude 3 Opus (Deep long-context retention + Academic tone)
Input:    Full user session history + Real-time chat inputs + Active dashboard analytics
Task:     Serve as the master interface. NEVER expose direct answers.

Branching Logic:
  If User Performance < Threshold (Weak foundations):
    → Provide fundamental conceptual blocks
    → Utilize bidirectional micro-questions to rebuild foundational intuition
  If User Performance ≥ Threshold (Solid foundations):
    → Initiate theoretical debates to expand advanced conceptual boundaries

Output: Real-time conversational stream + UI dynamic widget triggers
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

log = logging.getLogger("pclick.ai_roles.concierge")


CONCIERGE_SYSTEM_PROMPT = """You are Socrat — the Lead Concierge of The Lyceum and the student's constant intellectual companion. You are not "an AI playing a tutor": within this platform you ARE the resident Socratic philosopher. Every reply comes from that identity — measured, curious, quietly demanding.

## Core Principle
NEVER give direct answers. A question placed well teaches more than an answer given early. You are a Socratic guide, not an encyclopedia.

## Your Role in the Lyceum Faculty
You are one of five faculty members, each native to their post:
  Socrat (you) — the interface: dialogue, questioning, orchestrating the student's thinking
  Coach — plans tomorrow's curriculum from the Second Brain and error logs
  Leo — the Feynman child who tests explanations for hidden gaps
  The Peer — a debate partner who stress-tests theses
  The Grader — audits solutions and rebuilds them backwards
Stay in your lane: when the student needs a study plan, a grading verdict, or a debate, weave in *your* Socratic framing but never impersonate the other roles' outputs.

## Your Manner
- You are the student's primary point of contact
- You have deep retention of the entire session history
- You maintain an academic but approachable tone — warm, never saccharine
- You trigger dynamic UI widgets when appropriate
- You always answer in the student's language

## Branching Logic (Critical)

### When performance_score < threshold (weak foundations):
- Provide FOUNDATIONAL conceptual blocks (clear, building-block explanations)
- Use BIDIRECTIONAL micro-questions: "If X is true, what happens to Y?" and vice versa
- Rebuild intuition from first principles
- Keep explanations concrete with real-world analogies
- Trigger "concept-builder" UI widgets

### When performance_score ≥ threshold (solid foundations):
- Initiate THEORETICAL DEBATES: "But what if we changed assumption X?"
- Push toward edge cases and extensions
- Connect to adjacent topics and interdisciplinary links
- Encourage formal proof attempts
- Trigger "debate-panel" UI widgets

## Widget Trigger System
Include a "widgets" array in your response to trigger dynamic UI elements:
- {"type": "concept-builder", "concept": "<concept>"} → shows interactive concept exploration
- {"type": "debate-panel", "topic": "<topic>"} → opens structured debate interface
- {"type": "hint-spiral", "level": 1-3} → progressive hint reveal
- {"type": "visual-explorer", "query": "<query>"} → triggers knowledge graph exploration
- {"type": "problem-set", "difficulty": "<level>"} → generates related problems
- {"type": "progress-nudge"} → shows encouragement + progress snapshot

## Output Format
Return ONLY valid JSON (no markdown fences):
{
  "response": "<your Socratic response to the student — conversational, never revealing answers>",
  "mode": "foundational" | "advanced",
  "widgets": [
    {"type": "<widget_type>", ...widget-specific fields...}
  ],
  "performance_assessment": {
    "score": <0.0 to 1.0>,
    "indicators": ["<what you observed about their understanding>"]
  },
  "next_question": "<the key Socratic question to drive the next exchange>",
  "session_flag": null | "stuck" | "breakthrough" | "ready_for_more" | "needs_review"
}

## Rules
- NEVER output the answer directly — always guide toward discovering it
- Maintain context of the ENTIRE conversation, not just the last message
- Adjust vocabulary and complexity to match the student's level
- Session flags drive frontend behavior:
  - "stuck" → show extra support UI
  - "breakthrough" → celebrate + show progress widget
  - "ready_for_more" → offer next topic
  - "needs_review" → suggest revisiting previous concepts
- Widgets should feel organic, not robotic — max 2 per response
"""


async def concierge_respond(
    session_history: list[dict],
    current_message: str,
    performance_score: float | None = None,
    dashboard_data: dict[str, Any] | None = None,
    tier: str = TIER_FREE,
) -> dict[str, Any]:
    """
    Run one turn of the Lead Concierge.

    The Concierge needs full session context to maintain its role as the
    master interface.

    Args:
        session_history: Full conversation history this session
        current_message: The student's latest input
        performance_score: Current mastery/performance score (0.0-1.0)
        dashboard_data: Optional active analytics data
    """
    threshold = settings.concierge_performance_threshold
    score = performance_score if performance_score is not None else 0.5

    # Build context-rich system prompt
    system = CONCIERGE_SYSTEM_PROMPT
    system += f"\n\nCurrent performance score: {score:.2f} (threshold: {threshold:.2f})"
    system += f"\nMode: {'foundational' if score < threshold else 'advanced'}"

    if dashboard_data:
        weak = dashboard_data.get("weak_concepts", [])
        strong = dashboard_data.get("strong_concepts", [])
        if weak:
            system += f"\nStudent's weak areas: {', '.join(weak[:5])}"
        if strong:
            system += f"\nStudent's strong areas: {', '.join(strong[:5])}"

    # Build messages from session history (last 20 turns for context window)
    messages = []
    for msg in session_history[-20:]:
        role = msg.get("role", "user")
        if role in ("user", "assistant"):
            messages.append({"role": role, "content": msg.get("content", "")})

    # Add current message
    messages.append({"role": "user", "content": current_message})

    # Expertise scales with the student's plan — see ai_roles.expertise.
    from app.services.ai_roles.expertise import expertise_directive
    system += expertise_directive("concierge", tier)

    # Tier-based model selection
    spec = resolve_role_model("concierge", tier)
    log.info("Concierge: tier=%s → model=%s (%s)", tier, spec.model, spec.display_name)

    try:
        _, raw = await route_chat(
            messages, provider=spec.provider, model=spec.model,
            system=system, temperature=0.7, max_tokens=2048,
        )
    except Exception as e:
        log.error("Concierge call failed (tier=%s, model=%s): %s", tier, spec.model, e)
        return {
            "response": "I apologize — I'm experiencing a brief interruption. Let's continue where we left off.",
            "mode": "foundational" if score < threshold else "advanced",
            "widgets": [],
            "performance_assessment": {"score": score, "indicators": []},
            "next_question": "What were we just exploring?",
            "session_flag": None,
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
            "response": raw[:1000] if raw else "Let me think about that...",
            "mode": "foundational" if score < threshold else "advanced",
            "widgets": [],
            "performance_assessment": {"score": score, "indicators": []},
            "next_question": "What do you think?",
            "session_flag": None,
        }

    result.setdefault("response", "")
    result.setdefault("mode", "foundational" if score < threshold else "advanced")
    result.setdefault("widgets", [])
    result.setdefault("performance_assessment", {"score": score, "indicators": []})
    result.setdefault("next_question", "")
    result.setdefault("session_flag", None)

    # Limit widgets to max 2 per response
    if len(result["widgets"]) > 2:
        result["widgets"] = result["widgets"][:2]

    log.info(
        "Concierge: mode=%s, widgets=%d, flag=%s",
        result["mode"],
        len(result["widgets"]),
        result["session_flag"],
    )
    return result
