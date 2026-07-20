"""
Role 1: Coach (Backend Orchestrator)
═════════════════════════════════════

Model:    OpenAI o1 (Batch API / Off-peak execution)
Schedule: Runs at coach_batch_hour:coach_batch_minute UTC daily
Input:    User's Second Brain Vector DB + Historical Error Logs
Output:   JSON object — next-day personalized curriculum data

The Coach performs deep Chain-of-Thought (CoT) analysis to:
  1. Identify logical gaps in the student's understanding
  2. Generate structured learning materials (Markdown notes + progressive
     problem sets from conceptual to extreme difficulty)
  3. Output a JSON curriculum payload for the next study session
"""

from __future__ import annotations

import json
import logging
from typing import Any

from app.core.config import settings
from app.services.ai_roles.providers import openai_o1_chat, openai_chat, extract_text, extract_openai_text
from app.services.ai_roles.tier_router import resolve_role_model, get_openai_key_for_tier, TIER_FREE

log = logging.getLogger("pclick.ai_roles.coach")


COACH_SYSTEM_PROMPT = """You are the Coach — the Lyceum's curriculum orchestrator, and the only faculty member who thinks in weeks, not turns. You never chat with the student directly; your craft is the plan itself. Everything you produce is grounded in the student's own Second Brain — their notes, their mistakes, their mastery record — never in generic syllabus boilerplate.

Your job: analyze a student's knowledge state and generate tomorrow's study plan.

## Inputs You Receive
1. **Second Brain excerpts** — the student's own notes, summaries, and knowledge vault entries
2. **Error logs** — past mistakes, misconceptions, and weak concepts (from the mistake bank)
3. **Mastery profile** — per-concept scores and trend data

## Your Task (Chain-of-Thought)
Think step-by-step through the student's knowledge state:

Step 1 — DIAGNOSE: What logical gaps exist? Where does understanding break down?
Step 2 — PRIORITIZE: Which gaps are foundational (blocking other learning)?
Step 3 — SEQUENCE: What is the optimal order to address these gaps?
Step 4 — MATERIALIZE: Generate specific learning materials for each gap
Step 5 — CHALLENGE: Create progressive problem sets (conceptual → extreme)

## Output Format
Return ONLY valid JSON (no markdown fences, no extra text):
{
  "diagnosis": {
    "logical_gaps": ["<gap 1>", "<gap 2>", ...],
    "strengths": ["<what the student does well>"],
    "readiness_score": <0.0 to 1.0>
  },
  "curriculum": [
    {
      "day": 1,
      "theme": "<theme name>",
      "materials": [
        {
          "type": "note|conceptual|worked_example|analogy",
          "content": "<Markdown content with LaTeX math in $...$>",
          "source_concept": "<which gap this addresses>",
          "difficulty": "foundational|intermediate|advanced"
        }
      ],
      "problem_set": [
        {
          "difficulty": "conceptual|intermediate|hard|extreme",
          "prompt": "<the problem>",
          "hints": ["<hint 1>", "<hint 2>"],
          "concepts_tested": ["<concept>"],
          "estimated_minutes": <int>
        }
      ]
    }
  ],
  "metadata": {
    "total_estimated_minutes": <int>,
    "concepts_covered": ["<concept>"],
    "next_session_focus": "<one sentence summary>"
  }
}

## Rules
- Materials MUST address the diagnosed logical gaps specifically
- Problem sets MUST progress from conceptual → extreme within each day
- Use Unicode math symbols (not LaTeX backslashes) in JSON string values
- Include real-world analogies for abstract concepts
- Each day should be 25-45 minutes of study material
- Never skip foundational gaps to jump to advanced material
"""


async def generate_curriculum(
    user_id: str,
    second_brain_excerpts: list[str],
    error_logs: list[dict],
    mastery_profile: dict[str, Any],
    tier: str = TIER_FREE,
) -> dict[str, Any]:
    """
    Run the Coach role to generate a personalized next-day curriculum.

    This is designed for batch/off-peak execution (called by scheduler or
    admin trigger, not by the student directly).

    Returns the parsed curriculum JSON.
    """
    # Build the user message from all input sources
    parts = []

    if second_brain_excerpts:
        parts.append("## Student's Second Brain (notes & knowledge vault)")
        for i, excerpt in enumerate(second_brain_excerpts[:10], 1):
            parts.append(f"### Excerpt {i}\n{excerpt[:2000]}")

    if error_logs:
        parts.append("\n## Error Log (past mistakes & misconceptions)")
        for entry in error_logs[:15]:
            concept = entry.get("concept", "unknown")
            mistake = entry.get("mistake", entry.get("description", ""))
            frequency = entry.get("frequency", 1)
            parts.append(f"- **{concept}** (×{frequency}): {mistake[:200]}")

    if mastery_profile:
        parts.append("\n## Mastery Profile")
        for concept, score in mastery_profile.items():
            if isinstance(score, (int, float)):
                bar = "█" * int(score * 10) + "░" * (10 - int(score * 10))
                parts.append(f"- {concept}: [{bar}] {score:.0%}")

    if not parts:
        return {
            "error": "insufficient_data",
            "message": "No student data available for curriculum generation.",
        }

    user_msg = "\n\n".join(parts)
    user_msg += "\n\n---\nGenerate the personalized curriculum for tomorrow's study session."

    # Expertise scales with the student's plan (native-master on paid,
    # newly-credentialed senior on free) — see ai_roles.expertise.
    from app.services.ai_roles.expertise import expertise_directive
    system_prompt = COACH_SYSTEM_PROMPT + expertise_directive("coach", tier)

    messages = [
        {"role": "system", "content": system_prompt},
        {"role": "user", "content": user_msg},
    ]

    # Tier-based model selection
    spec = resolve_role_model("coach", tier)
    log.info("Coach: tier=%s → model=%s (%s)", tier, spec.model, spec.display_name)

    try:
        if spec.use_premium:
            from app.services.ai_roles.providers import route_chat
            api_key = get_openai_key_for_tier(tier) if spec.provider == "openai" else ""
            _, raw = await route_chat(
                messages, provider=spec.provider, model=spec.model,
                system=system_prompt, max_tokens=16384,
                api_key=api_key,
            )
        else:
            from app.services.ai import chat
            resp = await chat(messages, model=spec.model, max_tokens=4096, temperature=0.3)
            raw = extract_text(resp)
    except Exception as e:
        log.error("Coach call failed (tier=%s, model=%s): %s", tier, spec.model, e)
        return {"error": "provider_failed", "message": str(e)}

    # Parse JSON from o1 response (may have thinking traces to strip)
    import re
    cleaned = re.sub(r"<think(?:ing)?>[\s\S]*?</think(?:ing)?>", "", raw).strip()
    cleaned = re.sub(r"^```(?:json)?\s*", "", cleaned)
    cleaned = re.sub(r"\s*```$", "", cleaned).strip()

    try:
        result = json.loads(cleaned)
    except json.JSONDecodeError:
        # Try to find JSON object in the response
        match = re.search(r"\{[\s\S]*\}", cleaned)
        if match:
            try:
                result = json.loads(match.group())
            except json.JSONDecodeError:
                log.warning("Coach: could not parse o1 output as JSON")
                return {
                    "error": "parse_failed",
                    "raw": raw[:2000],
                    "message": "Coach generated non-JSON output.",
                }
        else:
            return {
                "error": "parse_failed",
                "raw": raw[:2000],
                "message": "Coach generated no JSON output.",
            }

    result.setdefault("diagnosis", {})
    result.setdefault("curriculum", [])
    result.setdefault("metadata", {})
    log.info(
        "Coach: generated curriculum for user %s — %d days, %d concepts",
        user_id,
        len(result["curriculum"]),
        len(result["metadata"].get("concepts_covered", [])),
    )
    return result
