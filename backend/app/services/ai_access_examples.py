"""
AI Access Control Integration Examples (SOC-16)
═══════════════════════════════════════════════

This file demonstrates how to integrate the data access control system
into existing AI service endpoints.

These are EXAMPLES — actual integration should be done in app/main.py
and app/services/ai.py where AI calls are made.
"""

from __future__ import annotations

from app.services.data_access_control import (
    AIRole,
    DataCategory,
    AccessPurpose,
    check_access,
    filter_for_ai,
    log_ai_access,
    get_access_control,
)


# ══════════════════════════════════════════════════════════════════════════════
# Example 1: Grading Endpoint
# ══════════════════════════════════════════════════════════════════════════════

async def grade_student_work_example(
    user_id: str,
    problem_prompt: str,
    student_answer: str,
    student_email: str,  # This should NOT go to AI
) -> dict:
    """
    Example: Grading AI should see problem + answer, but NOT personal info.
    """
    # Step 1: Build raw data (from request)
    raw_data = {
        "problem": problem_prompt,
        "answer": student_answer,
        "email": student_email,
        "name": "Student Name",  # Also should not go to AI
    }

    # Step 2: Check if grading AI can access student work
    if not check_access(AIRole.GRADING, DataCategory.STUDENT_WORK):
        raise PermissionError("Grading AI not permitted to access student work")

    # Step 3: Filter data to remove unauthorized fields
    safe_data = filter_for_ai(AIRole.GRADING, raw_data)
    # Result: {"problem": "...", "answer": "..."}
    # "email" and "name" are automatically removed

    # Step 4: Log the access for audit trail
    log_ai_access(
        user_id=user_id,
        role=AIRole.GRADING,
        category=DataCategory.STUDENT_WORK,
        purpose=AccessPurpose.IMMEDIATE_FEEDBACK,
        record_count=1,
    )

    # Step 5: Send ONLY safe_data to AI provider
    # from app.services.ai import grade_answer
    # result = await grade_answer(safe_data["problem"], safe_data["answer"])

    return {"grade": "A", "feedback": "Great work!"}


# ══════════════════════════════════════════════════════════════════════════════
# Example 2: Hint Generation (Socratic Method)
# ══════════════════════════════════════════════════════════════════════════════

async def generate_hint_example(
    user_id: str,
    problem_prompt: str,
    student_answer: str,  # Should NOT be sent to hint AI
    level: int,
) -> dict:
    """
    Example: Hint AI should see problem ONLY, not student's work.
    This enforces the Socratic method — AI doesn't know what student wrote.
    """
    raw_data = {
        "problem": problem_prompt,
        "answer": student_answer,  # Will be filtered out
        "attempts": [{"answer": "previous attempt"}],  # Also filtered
    }

    # Check permissions
    if not check_access(AIRole.HINT_GENERATION, DataCategory.PROBLEM_CONTENT):
        raise PermissionError("Hint AI not permitted to access problems")

    # Filter — hint AI should NOT see student work
    safe_data = filter_for_ai(AIRole.HINT_GENERATION, raw_data)
    # Result: {"problem": "..."}
    # "answer" and "attempts" are removed

    # Verify student work was removed (security assertion)
    assert "answer" not in safe_data, "Hint AI should never see student answers!"
    assert "attempts" not in safe_data

    # Log access
    log_ai_access(
        user_id=user_id,
        role=AIRole.HINT_GENERATION,
        category=DataCategory.PROBLEM_CONTENT,
        purpose=AccessPurpose.IMMEDIATE_FEEDBACK,
    )

    # Send to AI
    # from app.services.ai import get_hint
    # hint = await get_hint(safe_data["problem"], level)

    return {"hint": "Think about the chain rule..."}


# ══════════════════════════════════════════════════════════════════════════════
# Example 3: Personalization (Learning History)
# ══════════════════════════════════════════════════════════════════════════════

async def personalized_roadmap_example(
    user_id: str,
    topic: str,
    learning_history: dict,
    student_name: str,  # Should NOT go to AI
) -> dict:
    """
    Example: Personalization AI should see learning patterns, not raw answers.
    """
    raw_data = {
        "topic": topic,
        "history": learning_history,  # Mastery scores, struggle points (allowed)
        "attempts": [
            {"problem": "calc1", "answer": "x^2", "passed": True}  # Raw answer (NOT allowed)
        ],
        "name": student_name,  # PII (NOT allowed)
        "email": "student@example.com",  # PII (NOT allowed)
    }

    # Check permissions
    if not check_access(AIRole.PERSONALIZATION, DataCategory.LEARNING_HISTORY):
        raise PermissionError("Personalization AI cannot access learning history")

    # Filter data
    safe_data = filter_for_ai(AIRole.PERSONALIZATION, raw_data)
    # Result: {"topic": "...", "history": {...}}
    # "attempts", "name", "email" are removed

    # Log access
    log_ai_access(
        user_id=user_id,
        role=AIRole.PERSONALIZATION,
        category=DataCategory.LEARNING_HISTORY,
        purpose=AccessPurpose.PERSONALIZATION,
    )

    # Send to AI
    # from app.services.ai import generate_roadmap
    # roadmap = await generate_roadmap(safe_data["topic"], safe_data["history"])

    return {"roadmap": "1. Review limits, 2. Practice derivatives"}


# ══════════════════════════════════════════════════════════════════════════════
# Example 4: Content Safety (Special Role)
# ══════════════════════════════════════════════════════════════════════════════

async def check_content_safety_example(
    user_id: str,
    problem_text: str,
    student_answer: str,
) -> dict:
    """
    Example: Content safety AI has special permissions to see all content
    for moderation purposes.
    """
    raw_data = {
        "problem": problem_text,
        "answer": student_answer,
        "email": "student@example.com",  # Even this is allowed for safety checks
    }

    # Content safety role can access everything
    if not check_access(AIRole.CONTENT_SAFETY, DataCategory.STUDENT_WORK):
        raise PermissionError("Content safety AI denied")

    # Filter still applies (but allows more categories)
    safe_data = filter_for_ai(AIRole.CONTENT_SAFETY, raw_data)
    # Result: all fields pass through

    # Log access (important for transparency)
    log_ai_access(
        user_id=user_id,
        role=AIRole.CONTENT_SAFETY,
        category=DataCategory.STUDENT_WORK,
        purpose=AccessPurpose.SAFETY_MODERATION,
    )

    # Send to safety check
    # from app.services.content_safety import check_messages
    # is_safe = check_messages([{"role": "user", "content": student_answer}])

    return {"safe": True, "flagged": False}


# ══════════════════════════════════════════════════════════════════════════════
# Example 5: Research (Anonymized Only)
# ══════════════════════════════════════════════════════════════════════════════

async def research_analysis_example(
    user_id: str,
    user_consent: dict[str, bool],
    aggregated_stats: dict,
) -> dict:
    """
    Example: Research AI should only see anonymized, aggregated data.
    Even with consent, no raw PII should go to research models.
    """
    raw_data = {
        "aggregated_stats": aggregated_stats,  # Allowed
        "email": "student@example.com",  # Only allowed if consent_research=True
        "name": "Student Name",
    }

    # Check if user consented to research
    if not user_consent.get("consent_research", False):
        raise PermissionError("User has not consented to research")

    # Even with consent, anonymize first
    access_control = get_access_control()
    anonymized_data = access_control.anonymize_for_research(raw_data)
    # Result: {"aggregated_stats": {...}, "user_hash": "a1b2c3..."}
    # email and name are removed, user_id → irreversible hash

    # Filter for research role
    safe_data = filter_for_ai(AIRole.RESEARCH, anonymized_data)

    # Log access
    log_ai_access(
        user_id=user_id,
        role=AIRole.RESEARCH,
        category=DataCategory.AGGREGATED_STATS,
        purpose=AccessPurpose.RESEARCH,
    )

    # Send to research AI
    # result = await analyze_learning_patterns(safe_data)

    return {"insight": "Students struggle with limits in calculus"}


# ══════════════════════════════════════════════════════════════════════════════
# Example 6: Multiple Data Categories
# ══════════════════════════════════════════════════════════════════════════════

async def feynman_evaluation_example(
    user_id: str,
    problem_text: str,
    student_transcript: str,  # Student's verbal explanation
    note_title: str,
) -> dict:
    """
    Example: Feynman evaluation AI needs problem + student's explanation.
    This is student work, so must be logged and access-controlled.
    """
    raw_data = {
        "problem": problem_text,
        "transcript": student_transcript,  # This is student work
        "note_title": note_title,
        "email": "student@example.com",  # Should NOT go to AI
    }

    # Check permissions
    if not check_access(AIRole.FEYNMAN_EVAL, DataCategory.STUDENT_WORK):
        raise PermissionError("Feynman AI cannot access student work")

    # Filter
    safe_data = filter_for_ai(AIRole.FEYNMAN_EVAL, raw_data)
    # Result: {"problem": "...", "transcript": "..."}
    # "email" is removed

    # Log access
    log_ai_access(
        user_id=user_id,
        role=AIRole.FEYNMAN_EVAL,
        category=DataCategory.STUDENT_WORK,
        purpose=AccessPurpose.IMMEDIATE_FEEDBACK,
    )

    # Send to AI
    # from app.services.ai import feynman_evaluate
    # result = await feynman_evaluate(safe_data["transcript"], safe_data["note_title"])

    return {
        "reaction": "Great explanation!",
        "questions": ["What about edge cases?"],
        "score": 8,
    }


# ══════════════════════════════════════════════════════════════════════════════
# Integration Checklist
# ══════════════════════════════════════════════════════════════════════════════

"""
For EVERY AI endpoint in app/main.py:

1. Identify the AI role (GRADING, HINT_GENERATION, PERSONALIZATION, etc.)
2. Identify the data categories being accessed
3. Build raw_data dict from request
4. Call filter_for_ai(role, raw_data) to remove unauthorized fields
5. Call log_ai_access(user_id, role, category, purpose)
6. Send ONLY filtered data to AI provider
7. Never send raw_data directly to AI

Example endpoints to update:
- /ai/grade-all → AIRole.GRADING
- /ai/grade-dual → AIRole.GRADING
- /ai/hint → AIRole.HINT_GENERATION
- /ai/mastery → AIRole.GRADING
- /ai/roadmap → AIRole.PERSONALIZATION
- /ai/feynman → AIRole.FEYNMAN_EVAL
- /ai/upload-pset → AIRole.ANALYSIS
- /ai/mind-map/inspect → AIRole.ANALYSIS
- /ai/clean-question → AIRole.ANALYSIS

Content safety (already exists):
- check_prompt() → AIRole.CONTENT_SAFETY
- check_messages() → AIRole.CONTENT_SAFETY
"""
