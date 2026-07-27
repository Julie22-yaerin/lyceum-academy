"""
The Lyceum — STEM Deconstruction Harness.

An LLM application harness packaging two prompt-engineered engines behind a
strict JSON contract, for EdTech products that want the pedagogy without
building the prompt layer themselves.

Library use (no HTTP):

    from lyceum_harness import FeynmanEngine, Subject, Difficulty

    engine = FeynmanEngine(api_key=user_key, provider="gemini")
    explanation, meta = await engine.run(
        "Why does a photon have momentum if it has no mass?",
        subject=Subject.PHYSICS,
        difficulty=Difficulty.A_LEVEL,
    )

Every failure is a `HarnessError` subclass with a stable `.code`.
"""

from .config import DEFAULT_CONFIG, HarnessConfig, Provider, RetryPolicy, Timeouts
from .engines import FeynmanEngine, ReverseBuildingEngine
from .errors import (
    ContentBlocked,
    GuardrailRejection,
    HarnessError,
    InvalidCredentials,
    MalformedLLMOutput,
    MissingCredentials,
    UnsupportedProvider,
    UpstreamRateLimited,
    UpstreamTimeout,
    UpstreamUnavailable,
)
from .guardrails import validate_input
from .schemas import (
    Analogy,
    BuildingBlock,
    Deconstruction,
    DerivationStep,
    Difficulty,
    FeynmanExplanation,
    GoverningRule,
    KnowledgeGap,
    Meta,
    Subject,
    VisualHint,
)

__version__ = "1.0.0"

__all__ = [
    "__version__",
    # engines
    "FeynmanEngine", "ReverseBuildingEngine",
    # config
    "Provider", "HarnessConfig", "RetryPolicy", "Timeouts", "DEFAULT_CONFIG",
    # guardrails
    "validate_input",
    # schemas
    "FeynmanExplanation", "Deconstruction", "Subject", "Difficulty", "Meta",
    "Analogy", "KnowledgeGap", "BuildingBlock", "GoverningRule",
    "DerivationStep", "VisualHint",
    # errors
    "HarnessError", "GuardrailRejection", "MissingCredentials",
    "InvalidCredentials", "UnsupportedProvider", "UpstreamRateLimited",
    "UpstreamUnavailable", "UpstreamTimeout", "MalformedLLMOutput",
    "ContentBlocked",
]
