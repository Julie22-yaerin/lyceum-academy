"""
Role 5: Solution Grader & Reverse Builder
══════════════════════════════════════════

Model:    GPT-4o + Wolfram Alpha API (Hybrid Verification Engine)
Input:    User's step-by-step solution string + Graph-based "Tool Map" of execution process
Task:     Grade process correctness, validate math with Wolfram, evaluate reverse building
Output:   Structured JSON schema
"""

from __future__ import annotations

import json
import logging
import re
from typing import Any

from app.core.config import settings
from app.services.ai_roles.providers import (
    openai_o1_chat,
    openai_chat,
    extract_openai_text,
    route_chat,
    extract_text,
)
from app.services.ai_roles.tier_router import resolve_role_model, get_openai_key_for_tier, TIER_FREE
from app.services import wolfram as wolfram_svc
from app.services.ai import _parse_json_robust

log = logging.getLogger("pclick.ai_roles.grader")


GRADER_SYSTEM_PROMPT = """You are an expert Solution Grader & Reverse Builder for math and science problems.

## Your Role
You receive a student's step-by-step solution AND a "Tool Map" showing their
execution process (INPUT → TOOL → OUTPUT flow).

## Grading Protocol

### 1. Process Grading (Tool Map Analysis)
Analyze the logical execution path:
- Are the tools (methods/formulas) applied in the correct ORDER?
- Is each tool applied to the correct INPUT?
- Are there missing steps in the execution chain?
- Does the output of each step correctly feed into the next?

### 2. Mathematical Validation (Wolfram-Assisted)
For each computational step:
- Extract mathematical expressions
- Flag any arithmetic, algebraic, or calculus errors
- Verify final numerical answers where applicable

### 3. Reverse Building
Given the KNOWN CORRECT final answer, assess cognitive muscle memory:
- Can the student reconstruct the path from answer → question?
- What alternative paths exist?
- Which path is most efficient?

## Output Format
Return ONLY valid JSON (no markdown fences):
{
  "is_correct": true | false,
  "score": <0.0 to 1.0>,
  "error_step": null | <1-indexed step number where the first error occurs>,
  "concept_failed": null | "<name of the concept/skill the student failed to apply correctly>",
  "step_grades": [
    {
      "step": <int>,
      "correct": true | false,
      "tool_used": "<name of the tool/method applied>",
      "explanation": "<why this step is correct or incorrect>",
      "wolfram_verified": true | false | null
    }
  ],
  "tool_map_feedback": {
    "verdict": "optimal" | "suboptimal" | "incorrect",
    "missing_tools": ["<tools that should have been used but weren't>"],
    "unnecessary_tools": ["<tools that were used but weren't needed>"],
    "reordering_suggestion": null | "<if a different order would be better>"
  },
  "reverse_build": {
    "alternative_paths": [
      {
        "description": "<alternative solution path>",
        "tools_needed": ["<tool1>", "<tool2>"],
        "efficiency": "more_efficient" | "same" | "less_efficient"
      }
    ],
    "key_insight": "<the single insight that makes this problem easy>",
    "muscle_memory_score": <0.0 to 1.0 — how well could they rebuild from the answer?>
  },
  "feedback": "<2-3 sentences: overall assessment, encouraging but honest>",
  "next_steps": ["<specific practice recommendation>"]
}

## Rules
- Grade the PROCESS, not just the final answer
- A correct answer reached via wrong reasoning gets partial credit
- A wrong answer reached via correct reasoning gets significant partial credit
- Wolfram verification is for NUMERIC computation only — conceptual steps are graded by logic
- Be specific about WHERE errors occur (step number + what went wrong)
- Reverse building alternatives should be genuinely different approaches, not trivial variations
"""


async def grade_solution(
    solution_text: str,
    tool_map: dict[str, Any] | None = None,
    problem_context: str = "",
    known_answer: str | None = None,
    tier: str = TIER_FREE,
) -> dict[str, Any]:
    """
    Grade a student's solution using GPT-4o analysis + Wolfram verification.

    Args:
        solution_text: The student's step-by-step solution
        tool_map: Optional INPUT → TOOL → OUTPUT flow graph
        problem_context: The original problem statement
        known_answer: The correct answer (for reverse building)

    Returns the parsed grading JSON.
    """
    # Build the user message
    parts = []
    if problem_context:
        parts.append(f"## Problem\n{problem_context}")

    parts.append(f"## Student's Solution\n{solution_text}")

    if tool_map:
        tools_str = json.dumps(tool_map, indent=2, ensure_ascii=False)
        parts.append(f"## Tool Map (Execution Process)\n```json\n{tools_str}\n```")

    if known_answer:
        parts.append(f"## Known Correct Answer\n{known_answer}")

    # Step 1: Wolfram verification of computational expressions
    wolfram_results = await _wolfram_verify_solution(solution_text)

    if wolfram_results:
        parts.append("\n## Wolfram Alpha Verification Results")
        for wr in wolfram_results:
            parts.append(f"- Expression: `{wr['expression']}` → Result: `{wr['result']}`")

    user_msg = "\n\n".join(parts)
    user_msg += "\n\n---\nGrade this solution thoroughly. Analyze the process, not just the answer."

    messages = [
        {"role": "system", "content": GRADER_SYSTEM_PROMPT},
        {"role": "user", "content": user_msg},
    ]

    # Tier-based model selection
    spec = resolve_role_model("grader", tier)
    log.info("Grader: tier=%s → model=%s (%s)", tier, spec.model, spec.display_name)

    try:
        api_key = get_openai_key_for_tier(tier) if spec.provider == "openai" else ""
        _, raw = await route_chat(
            messages, provider=spec.provider, model=spec.model,
            system=GRADER_SYSTEM_PROMPT, max_tokens=8192,
            api_key=api_key,
        )
    except Exception as e:
        log.error("Grader call failed (tier=%s, model=%s): %s", tier, spec.model, e)
        return {
            "is_correct": False,
            "score": 0.0,
            "error_step": None,
            "concept_failed": None,
            "step_grades": [],
            "tool_map_feedback": {
                "verdict": "unknown",
                "missing_tools": [],
                "unnecessary_tools": [],
                "reordering_suggestion": None,
            },
            "reverse_build": {
                "alternative_paths": [],
                "key_insight": "",
                "muscle_memory_score": 0.0,
            },
            "feedback": "Grading service temporarily unavailable. Please try again.",
            "next_steps": [],
        }

    # Parse JSON from o1 response
    cleaned = re.sub(r"<think(?:ing)?>[\s\S]*?</think(?:ing)?>", "", raw).strip()
    cleaned = re.sub(r"^```(?:json)?\s*", "", cleaned)
    cleaned = re.sub(r"\s*```$", "", cleaned).strip()

    result = _parse_json_robust(cleaned)

    if not result:
        log.warning("Grader: could not parse o1 output as JSON")
        return {
            "is_correct": False,
            "score": 0.0,
            "error_step": None,
            "concept_failed": None,
            "step_grades": [],
            "tool_map_feedback": {
                "verdict": "unknown",
                "missing_tools": [],
                "unnecessary_tools": [],
                "reordering_suggestion": None,
            },
            "reverse_build": {
                "alternative_paths": [],
                "key_insight": "",
                "muscle_memory_score": 0.0,
            },
            "feedback": raw[:500] if raw else "Could not parse grading result.",
            "next_steps": [],
        }

    # Ensure all required fields
    result.setdefault("is_correct", False)
    result.setdefault("score", 0.0)
    result.setdefault("error_step", None)
    result.setdefault("concept_failed", None)
    result.setdefault("step_grades", [])
    result.setdefault("tool_map_feedback", {
        "verdict": "unknown",
        "missing_tools": [],
        "unnecessary_tools": [],
        "reordering_suggestion": None,
    })
    result.setdefault("reverse_build", {
        "alternative_paths": [],
        "key_insight": "",
        "muscle_memory_score": 0.0,
    })
    result.setdefault("feedback", "")
    result.setdefault("next_steps", [])

    log.info(
        "Grader: correct=%s, score=%.2f, error_step=%s, concept=%s",
        result["is_correct"],
        result["score"],
        result["error_step"],
        result["concept_failed"],
    )
    return result


async def _wolfram_verify_solution(solution_text: str) -> list[dict[str, str]]:
    """
    Extract computational expressions from the solution and verify via WolframAlpha.
    Returns list of {expression, result, correct} dicts.
    """
    if not wolfram_svc.is_configured():
        return []

    # Heuristic: extract lines that look like computations
    compute_patterns = [
        r"=\s*[\d\.\-]+",          # "= 42", "= 3.14"
        r"\d+\s*[\+\-\*/\^]\s*\d+", # "3 + 4", "2 * 5"
        r"solve|calculate|compute",  # explicit computation keywords
    ]
    combined = re.compile("|".join(compute_patterns), re.IGNORECASE)

    results = []
    for line in solution_text.split("\n"):
        line = line.strip()
        if not line or len(line) > 200:
            continue
        if combined.search(line):
            try:
                answer = await wolfram_svc.compute(line)
                if answer:
                    results.append({
                        "expression": line,
                        "result": answer,
                    })
            except Exception:
                pass
            if len(results) >= 5:  # limit Wolfram calls per grading
                break

    return results
