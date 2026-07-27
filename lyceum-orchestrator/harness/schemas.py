"""
The JSON contract. These models ARE the product surface a client renders.

Two conventions hold everywhere:

  * **LaTeX fields carry BARE LaTeX** — no `$`, no `\\[`. The client wraps it,
    because a MathJax renderer and a Manim `MathTex` want different wrapping,
    and stripping delimiters the model inconsistently adds is worse than never
    adding them.
  * **Nothing is ever omitted.** Inapplicable fields are empty strings or empty
    arrays. A client can bind to a field without an existence check.

Treat every rename as a breaking change and version the endpoint instead.
"""

from __future__ import annotations

from enum import Enum
from typing import Any, Literal

from pydantic import BaseModel, Field

SCHEMA_VERSION = "1.0"


# ── Shared vocabulary ────────────────────────────────────────────────────────

class Subject(str, Enum):
    MATH = "math"
    PHYSICS = "physics"
    CHEMISTRY = "chemistry"
    BIOLOGY = "biology"
    CS = "computer_science"
    OTHER = "other"


class StudentLevel(str, Enum):
    """
    Audience band. Drives depth, not tone — tone is the Humanizer's job.

    `olympiad` is deliberately its own band rather than "hard undergraduate":
    competition problems reward a different toolkit (invariants, extremal
    arguments, clever constructions) than a first-year course does.
    """

    MIDDLE_SCHOOL = "middle_school"
    HIGH_SCHOOL = "high_school"
    A_LEVEL = "a_level"
    UNDERGRADUATE = "undergraduate"
    OLYMPIAD = "olympiad"


class Intent(str, Enum):
    """
    What the learner is actually asking for. The orchestrator routes on this.

    Kept small on purpose: every value must map to a materially different skill
    chain, or it is a label with no consequence.
    """

    EXPLAIN_CONCEPT = "explain_concept"        # "why does X happen"
    DECONSTRUCT_SYSTEM = "deconstruct_system"  # "derive X from first principles"
    SIMPLIFY_FURTHER = "simplify_further"      # "I still don't get it"
    COMPARE_CONCEPTS = "compare_concepts"      # "difference between X and Y"
    UNKNOWN = "unknown"                        # classifier abstained


class SkillName(str, Enum):
    FEYNMAN = "feynman"
    REVERSE_BUILDING = "reverse_building"
    HUMANIZER = "humanizer"
    PERSONALIZE_CONTEXT = "personalize_context"


# ── Renderable primitives ────────────────────────────────────────────────────

class VisualHint(BaseModel):
    """An animation/diagram suggestion. Advisory — never required to render."""

    kind: Literal["diagram", "graph", "number_line", "vector_field", "sequence", "table"]
    description: str = Field(..., description="What to draw, in one plain sentence.")
    latex: str = Field("", description="Optional bare LaTeX for the object drawn.")


class Analogy(BaseModel):
    """
    A concrete analogy plus — mandatorily — where it stops being true.

    `breaks_down_when` is required by design. An analogy taught without its
    limits installs a misconception that costs more to remove than the original
    ignorance, so the schema refuses to let the model skip it.
    """

    title: str
    body: str = Field(..., description="Plain language. No jargon, no equations.")
    breaks_down_when: str = Field(..., description="Where the analogy fails. Never empty.")


class KnowledgeGap(BaseModel):
    """A prerequisite the learner probably lacks, and the probe that proves it."""

    prerequisite: str
    why_it_matters: str
    diagnostic_question: str = Field(
        ..., description="One question whose wrong answer proves the gap is real.",
    )


class BuildingBlock(BaseModel):
    name: str
    role: str = Field(..., description="What this block contributes to the whole.")
    is_axiomatic: bool = Field(
        ..., description="True if assumed rather than derived — the honest floor.",
    )
    latex: str = ""


class GoverningRule(BaseModel):
    name: str
    statement: str
    latex: str = ""
    holds_when: str = Field(..., description="Domain of validity. Required — rules have limits.")


class DerivationStep(BaseModel):
    """
    One rung from primitives to target.

    `required_tool` carries the house rule: a step has a correct method, and
    reaching the answer with a lower-level dodge (counting rectangles instead
    of integrating) is not doing the step. Clients enforce this.
    """

    index: int = Field(..., ge=1)
    statement: str
    justification: str = Field(..., description="Why the previous step licenses this one.")
    required_tool: str = Field(
        ..., description="The method this step must use, e.g. 'chain rule'. Be specific.",
    )
    latex: str = ""


# ── Skill payloads ───────────────────────────────────────────────────────────

class FeynmanPayload(BaseModel):
    """Output of the Feynman skill."""

    one_sentence: str = Field(..., description="The whole idea in one jargon-free sentence.")
    plain_explanation: str = Field(
        ..., description="Every term either ordinary English or defined in jargon_translated.",
    )
    analogies: list[Analogy] = Field(..., min_length=1, max_length=3)
    jargon_translated: dict[str, str] = Field(default_factory=dict)
    knowledge_gaps: list[KnowledgeGap] = Field(
        ..., min_length=1, max_length=5,
        description="What must be understood first. The highest-value field for a tutor.",
    )
    common_misconception: str = Field(..., description="The usual wrong model, then corrected.")
    equations: list[str] = Field(default_factory=list, description="Bare LaTeX, no delimiters.")
    visual_hints: list[VisualHint] = Field(default_factory=list)


class ReverseBuildingPayload(BaseModel):
    """Output of the Reverse Building skill."""

    summary: str = Field(..., description="What this system is, in two sentences.")
    building_blocks: list[BuildingBlock] = Field(..., min_length=2, max_length=10)
    governing_rules: list[GoverningRule] = Field(..., min_length=1, max_length=8)
    derivation: list[DerivationStep] = Field(
        ..., min_length=2, max_length=12, description="Primitives -> target, in order.",
    )
    collapses_if: list[str] = Field(
        ..., min_length=1, max_length=5,
        description="Remove which assumption and the structure fails? The load-bearing test.",
    )
    prerequisites: list[str] = Field(default_factory=list)
    visual_hints: list[VisualHint] = Field(default_factory=list)


class HumanizerPayload(BaseModel):
    """
    Output of the Humanizer when it runs in `rewrite` mode.

    In the default `directive` mode the Humanizer makes no LLM call at all — it
    folds its tone requirements into the producing skill's prompt instead, so
    warmth costs nothing extra. See harness/skills/humanizer.py.
    """

    opening: str = Field(..., description="One or two sentences that meet the learner where they are.")
    rewritten_explanation: str = Field(..., description="The explanation, same facts, warmer voice.")
    encouragement: str = Field(..., description="Specific, earned. Never generic praise.")
    next_question: str = Field(
        ..., description="One question that hands the thinking back to the learner.",
    )


# ── Intent classification ────────────────────────────────────────────────────

class IntentClassification(BaseModel):
    intent: Intent
    subject: Subject
    level: StudentLevel
    target: str = Field(
        ..., description="The concept/system extracted from the input, cleanly restated.",
    )
    confidence: float = Field(..., ge=0.0, le=1.0)
    rationale: str = Field("", description="One line. Why this intent.")
    source: Literal["heuristic", "model"] = Field(
        "heuristic",
        description="`heuristic` means no LLM call was made — the cheap path resolved it.",
    )


# ── Orchestration result ─────────────────────────────────────────────────────

class SkillTrace(BaseModel):
    """
    One executed step in the chain. Present for every skill in the plan,
    including skipped ones, so a client can show or debug the whole route.
    """

    skill: SkillName
    executed: bool
    llm_calls: int = Field(0, description="0 for local skills like personalize_context.")
    latency_ms: int = 0
    note: str = Field("", description="Why skipped, or what it contributed.")


class Usage(BaseModel):
    input_tokens: int | None = None
    output_tokens: int | None = None


class Meta(BaseModel):
    request_id: str
    provider: str
    model: str
    latency_ms: int
    total_llm_calls: int
    schema_version: str = SCHEMA_VERSION
    usage: Usage = Field(default_factory=Usage)
    trace: list[SkillTrace] = Field(default_factory=list)


class LearningResponse(BaseModel):
    """
    The orchestrator's single response shape.

    Payloads are optional because the chain is dynamic: an `explain_concept`
    request fills `feynman`, a `deconstruct_system` request fills
    `reverse_building`, and a chained request fills both. `plan` tells the
    client which to expect, so the UI never guesses.
    """

    schema_version: Literal["1.0"] = SCHEMA_VERSION
    request_id: str

    intent: IntentClassification
    plan: list[SkillName] = Field(..., description="Skills selected, in execution order.")

    title: str = Field(..., description="Short heading for the whole response.")
    feynman: FeynmanPayload | None = None
    reverse_building: ReverseBuildingPayload | None = None
    humanizer: HumanizerPayload | None = None

    level_applied: StudentLevel = Field(
        ..., description="The band actually used, after PersonalizeContext resolved it.",
    )
    meta: Meta


class ClassifyResponse(BaseModel):
    """Response for the free classification endpoint."""

    intent: IntentClassification
    would_run: list[SkillName] = Field(..., description="The plan this input would trigger.")
    estimated_llm_calls: int
    request_id: str


class SkillDescriptor(BaseModel):
    """Self-description of a registered skill, for discovery."""

    name: str
    description: str
    requires_llm: bool
    handles_intents: list[Intent]
    is_post_processor: bool = Field(
        False, description="True if it transforms earlier output rather than producing its own.",
    )


def json_schema_of(model: type[BaseModel]) -> dict[str, Any]:
    """Convenience for clients that want to codegen against the contract."""
    return model.model_json_schema()
