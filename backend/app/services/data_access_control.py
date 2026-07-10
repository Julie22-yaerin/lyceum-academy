"""
AI Data Access Control (SOC-16)
═══════════════════════════════

Implements fine-grained access control for AI models accessing student data.

Access Control Model:
  - Role-based: different AI roles have different access permissions
  - Purpose-based: data access limited to specific educational purposes
  - Consent-based: students explicitly consent to data usage
  - Audit-logged: all AI data access is logged for transparency

AI Roles & Permissions:
  1. GRADING: Can access problem prompts + student answers
  2. HINT_GENERATION: Can access problem prompts only (not student work)
  3. ANALYSIS: Can access aggregated/anonymized patterns only
  4. PERSONALIZATION: Can access learning history for adaptive recommendations
  5. CONTENT_SAFETY: Can access all content for moderation (special role)
"""

from __future__ import annotations

import enum
import logging
from datetime import datetime, timezone
from typing import Any

log = logging.getLogger("pclick.data_access")


class AIRole(str, enum.Enum):
    """AI model roles with different data access permissions."""

    GRADING = "grading"                      # Score student work
    HINT_GENERATION = "hint_generation"       # Generate Socratic hints
    ANALYSIS = "analysis"                     # Analyze problem difficulty
    PERSONALIZATION = "personalization"       # Adaptive learning recommendations
    CONTENT_SAFETY = "content_safety"         # Content moderation
    RESEARCH = "research"                     # Educational research (anonymized)
    ROADMAP_GENERATION = "roadmap_generation" # Learning path design
    FEYNMAN_EVAL = "feynman_eval"            # Evaluate explanations


class DataCategory(str, enum.Enum):
    """Categories of student data with different sensitivity levels."""

    PROBLEM_CONTENT = "problem_content"       # Problem statements (low sensitivity)
    STUDENT_WORK = "student_work"            # Student answers/solutions (high sensitivity)
    LEARNING_HISTORY = "learning_history"     # Past attempts/progress (medium sensitivity)
    PERSONAL_INFO = "personal_info"          # Name, email, school (high sensitivity)
    BEHAVIORAL_DATA = "behavioral_data"      # Time spent, struggle patterns (medium sensitivity)
    AGGREGATED_STATS = "aggregated_stats"    # Anonymous patterns (low sensitivity)


class AccessPurpose(str, enum.Enum):
    """Allowed purposes for AI data access."""

    IMMEDIATE_FEEDBACK = "immediate_feedback"   # Real-time grading/hints
    PERSONALIZATION = "personalization"         # Adapt to learning style
    QUALITY_IMPROVEMENT = "quality_improvement" # Improve AI models
    SAFETY_MODERATION = "safety_moderation"    # Content safety checks
    RESEARCH = "research"                      # Educational research (consent-gated)


# ── Access Control Rules ──────────────────────────────────────────────────────

# Role → allowed data categories
ROLE_PERMISSIONS: dict[AIRole, set[DataCategory]] = {
    AIRole.GRADING: {
        DataCategory.PROBLEM_CONTENT,
        DataCategory.STUDENT_WORK,
    },
    AIRole.HINT_GENERATION: {
        DataCategory.PROBLEM_CONTENT,
        # Explicitly NO access to student work (Socratic method)
    },
    AIRole.ANALYSIS: {
        DataCategory.PROBLEM_CONTENT,
        DataCategory.AGGREGATED_STATS,
    },
    AIRole.PERSONALIZATION: {
        DataCategory.LEARNING_HISTORY,
        DataCategory.BEHAVIORAL_DATA,
        DataCategory.AGGREGATED_STATS,
    },
    AIRole.CONTENT_SAFETY: {
        # Special role: can access all content for moderation
        DataCategory.PROBLEM_CONTENT,
        DataCategory.STUDENT_WORK,
        DataCategory.PERSONAL_INFO,
    },
    AIRole.RESEARCH: {
        DataCategory.AGGREGATED_STATS,
        # Personal data only if consent_research=True
    },
    AIRole.ROADMAP_GENERATION: {
        DataCategory.LEARNING_HISTORY,
        DataCategory.AGGREGATED_STATS,
    },
    AIRole.FEYNMAN_EVAL: {
        DataCategory.PROBLEM_CONTENT,
        DataCategory.STUDENT_WORK,  # Student's verbal explanation
    },
}


# ── Access Control Service ────────────────────────────────────────────────────

class DataAccessControl:
    """
    Controls what data AI models can access.

    Usage:
        ac = DataAccessControl()

        # Check if role can access category
        if ac.can_access(AIRole.GRADING, DataCategory.STUDENT_WORK):
            data = get_student_work()

        # Filter data dict to only allowed fields
        safe_data = ac.filter_data(AIRole.HINT_GENERATION, raw_data)

        # Log access for audit trail
        ac.log_access(user_id, AIRole.GRADING, DataCategory.STUDENT_WORK, purpose)
    """

    def can_access(
        self,
        role: AIRole,
        category: DataCategory,
        user_consent: dict[str, bool] | None = None,
    ) -> bool:
        """
        Check if an AI role can access a data category.

        Args:
            role: The AI model's role
            category: The data category being accessed
            user_consent: Optional user consent flags (e.g., consent_research)

        Returns:
            True if access is allowed, False otherwise
        """
        # Check base permissions
        allowed_categories = ROLE_PERMISSIONS.get(role, set())
        if category not in allowed_categories:
            # Special case: research role needs explicit consent
            if role == AIRole.RESEARCH and category == DataCategory.PERSONAL_INFO:
                consent = user_consent or {}
                return consent.get("consent_research", False)
            return False

        return True

    def filter_data(
        self,
        role: AIRole,
        data: dict[str, Any],
        user_consent: dict[str, bool] | None = None,
    ) -> dict[str, Any]:
        """
        Filter a data dict to only include fields the role can access.

        Field → category mapping:
            - problem/prompt → PROBLEM_CONTENT
            - answer/solution/student_work → STUDENT_WORK
            - attempts/history/progress → LEARNING_HISTORY
            - email/name/school → PERSONAL_INFO
            - time_spent/hints_used → BEHAVIORAL_DATA
        """
        # Map field names to categories
        field_categories = {
            "problem": DataCategory.PROBLEM_CONTENT,
            "prompt": DataCategory.PROBLEM_CONTENT,
            "title": DataCategory.PROBLEM_CONTENT,
            "answer": DataCategory.STUDENT_WORK,
            "solution": DataCategory.STUDENT_WORK,
            "student_work": DataCategory.STUDENT_WORK,
            "response": DataCategory.STUDENT_WORK,
            "explanation": DataCategory.STUDENT_WORK,
            "transcript": DataCategory.STUDENT_WORK,
            "attempts": DataCategory.LEARNING_HISTORY,
            "history": DataCategory.LEARNING_HISTORY,
            "progress": DataCategory.LEARNING_HISTORY,
            "mastery": DataCategory.LEARNING_HISTORY,
            "email": DataCategory.PERSONAL_INFO,
            "name": DataCategory.PERSONAL_INFO,
            "full_name": DataCategory.PERSONAL_INFO,
            "school": DataCategory.PERSONAL_INFO,
            "university": DataCategory.PERSONAL_INFO,
            "time_spent": DataCategory.BEHAVIORAL_DATA,
            "hints_used": DataCategory.BEHAVIORAL_DATA,
            "struggle_points": DataCategory.BEHAVIORAL_DATA,
        }

        filtered = {}
        for key, value in data.items():
            category = field_categories.get(key)
            # If field not mapped, assume low sensitivity (allow)
            if category is None or self.can_access(role, category, user_consent):
                filtered[key] = value
            else:
                log.info(f"Filtered {key} for role {role.value} (category: {category.value})")

        return filtered

    def log_access(
        self,
        user_id: str,
        role: AIRole,
        category: DataCategory,
        purpose: AccessPurpose,
        record_count: int = 1,
    ) -> None:
        """
        Log AI data access for audit trail.

        This creates a transparent record of what data was accessed by which AI
        model for what purpose. Logged to activity_log service.
        """
        try:
            from app.services import activity_log
            activity_log.record(
                provider="data_access_control",
                task=f"{role.value}:{purpose.value}",
                model=f"access_log:{category.value}",
                prompt_tokens=record_count,  # Reuse field for record count
                completion_tokens=0,
            )
            log.info(
                "AI data access: user=%s role=%s category=%s purpose=%s records=%d",
                user_id[:8] + "...", role.value, category.value, purpose.value, record_count,
            )
        except Exception as e:
            log.warning("Failed to log data access: %s", e)

    def anonymize_for_research(self, data: dict[str, Any]) -> dict[str, Any]:
        """
        Anonymize data for research purposes.

        Removes all personally identifiable information while preserving
        learning patterns and educational insights.
        """
        anonymized = data.copy()

        # Remove PII fields
        pii_fields = {"email", "name", "full_name", "school", "university", "user_id", "auth_subject"}
        for field in pii_fields:
            anonymized.pop(field, None)

        # Hash user_id if present (for linking records while preserving privacy)
        if "user_id" in data:
            import hashlib
            anonymized["user_hash"] = hashlib.sha256(
                str(data["user_id"]).encode()
            ).hexdigest()[:16]

        return anonymized


# ── Global instance ───────────────────────────────────────────────────────────

_access_control: DataAccessControl | None = None


def get_access_control() -> DataAccessControl:
    """Get or create the global access control instance."""
    global _access_control
    if _access_control is None:
        _access_control = DataAccessControl()
    return _access_control


# ── Helper functions ──────────────────────────────────────────────────────────

def check_access(role: AIRole, category: DataCategory) -> bool:
    """Shorthand: check if role can access category."""
    return get_access_control().can_access(role, category)


def filter_for_ai(role: AIRole, data: dict) -> dict:
    """Shorthand: filter data for AI role."""
    return get_access_control().filter_data(role, data)


def log_ai_access(user_id: str, role: AIRole, category: DataCategory, purpose: AccessPurpose) -> None:
    """Shorthand: log AI data access."""
    get_access_control().log_access(user_id, role, category, purpose)
