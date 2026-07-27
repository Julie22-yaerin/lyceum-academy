"""
The Lyceum STEM Learning Orchestrator.

A B2B AI harness that behaves as a pedagogical agent rather than a prompt
wrapper: it validates input, classifies what the learner actually needs, then
selects and CHAINS specialised skill plug-ins.

Every workspace tool — Feynman, Reverse Building, Humanizer, PersonalizeContext,
and anything you add — is just a Skill.

    from harness import STEMOrchestrator, StudentLevel

    orch = STEMOrchestrator(api_key=client_key, provider="anthropic")
    result = await orch.run(
        "Derive the Pythagorean theorem from first principles",
        level=StudentLevel.HIGH_SCHOOL,
    )
    result.plan                    # [personalize_context, reverse_building, feynman]
    result.reverse_building.derivation
    result.meta.total_llm_calls

BYOK: no key is ever read from the environment or persisted.
Every failure is a `HarnessError` subclass with a stable `.code`.
"""

from .config import (
    DEFAULT_CONFIG,
    DEFAULT_MODELS,
    OrchestratorConfig,
    Provider,
    RetryPolicy,
    Timeouts,
)
from .errors import (
    ContentBlocked,
    GuardrailRejection,
    HarnessError,
    InvalidCredentials,
    MalformedLLMOutput,
    MissingCredentials,
    SkillFailed,
    UnknownSkill,
    UnsupportedProvider,
    UpstreamRateLimited,
    UpstreamTimeout,
    UpstreamUnavailable,
)
from .guardrails import classify_heuristically, validate_input
from .llm_client import LLMClient
from .orchestrator import STEMOrchestrator, SkillRegistry, default_registry
from .schemas import (
    Analogy,
    BuildingBlock,
    ClassifyResponse,
    DerivationStep,
    FeynmanPayload,
    GoverningRule,
    HumanizerPayload,
    Intent,
    IntentClassification,
    KnowledgeGap,
    LearningResponse,
    Meta,
    ReverseBuildingPayload,
    SkillDescriptor,
    SkillName,
    SkillTrace,
    StudentLevel,
    Subject,
    Usage,
    VisualHint,
)
from .skills import (
    FeynmanEngine,
    PedagogicalHumanizer,
    PersonalizeContext,
    ReverseBuildingEngine,
    Skill,
    SkillContext,
    SkillResult,
)

__version__ = "1.0.0"

__all__ = [
    "__version__",
    # core
    "STEMOrchestrator", "SkillRegistry", "default_registry", "LLMClient",
    # skills
    "Skill", "SkillContext", "SkillResult",
    "FeynmanEngine", "ReverseBuildingEngine", "PedagogicalHumanizer",
    "PersonalizeContext",
    # config
    "Provider", "OrchestratorConfig", "RetryPolicy", "Timeouts",
    "DEFAULT_CONFIG", "DEFAULT_MODELS",
    # guardrails
    "validate_input", "classify_heuristically",
    # schemas
    "LearningResponse", "ClassifyResponse", "IntentClassification",
    "FeynmanPayload", "ReverseBuildingPayload", "HumanizerPayload",
    "Intent", "SkillName", "StudentLevel", "Subject",
    "Analogy", "KnowledgeGap", "BuildingBlock", "GoverningRule",
    "DerivationStep", "VisualHint", "SkillDescriptor", "SkillTrace",
    "Meta", "Usage",
    # errors
    "HarnessError", "GuardrailRejection", "MissingCredentials",
    "InvalidCredentials", "UnsupportedProvider", "UnknownSkill",
    "UpstreamRateLimited", "UpstreamUnavailable", "UpstreamTimeout",
    "MalformedLLMOutput", "ContentBlocked", "SkillFailed",
]
