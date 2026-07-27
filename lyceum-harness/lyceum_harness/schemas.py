"""
The JSON contract.

These models ARE the product surface. A client's UI (and their Manim scene
generator) binds to these field names, so treat every rename as a breaking
change and version the endpoint instead.

Two deliberate choices:

  * Every equation field is LaTeX **without** surrounding delimiters ($, \\[).
    Clients wrap it themselves — a renderer that wants MathJax and one that
    wants Manim's MathTex need different wrapping, and stripping delimiters
    that the model inconsistently adds is worse than never adding them.

  * `visual_hints` exists because the whole point of a structured
    deconstruction is that it can be animated. It is advisory: a client that
    only renders text can ignore it entirely.
"""

from __future__ import annotations

from enum import Enum
from typing import Literal

from pydantic import BaseModel, Field


class Subject(str, Enum):
    MATH = "math"
    PHYSICS = "physics"
    CHEMISTRY = "chemistry"
    BIOLOGY = "biology"
    CS = "computer_science"
    OTHER = "other"


class Difficulty(str, Enum):
    """Rough audience band. Mirrors how tutoring centres brief a tutor."""

    MIDDLE_SCHOOL = "middle_school"
    HIGH_SCHOOL = "high_school"
    A_LEVEL = "a_level"
    UNDERGRAD = "undergraduate"


class VisualHint(BaseModel):
    """An animation suggestion. Advisory — never required to render."""

    kind: Literal["diagram", "graph", "number_line", "vector_field", "sequence", "table"]
    description: str = Field(..., description="What to draw, in one plain sentence.")
    latex: str = Field("", description="Optional LaTeX for the object being drawn.")


# ── Feynman engine ───────────────────────────────────────────────────────────

class Analogy(BaseModel):
    """
    A concrete analogy plus — critically — where it breaks.

    The `breaks_down_when` field is not decoration. An analogy taught without
    its limits is how misconceptions get installed, so the schema makes the
    limit mandatory rather than optional prose the model may skip.
    """

    title: str
    body: str = Field(..., description="Plain language. No jargon, no equations.")
    breaks_down_when: str = Field(
        ..., description="Where the analogy stops being true. Required, never empty."
    )


class KnowledgeGap(BaseModel):
    """A prerequisite the learner probably lacks, and the question that reveals it."""

    prerequisite: str
    why_it_matters: str
    diagnostic_question: str = Field(
        ..., description="One question whose wrong answer proves the gap is real."
    )


class FeynmanExplanation(BaseModel):
    schema_version: Literal["1.0"] = "1.0"
    engine: Literal["feynman"] = "feynman"

    concept: str = Field(..., description="The concept, restated cleanly.")
    subject: Subject
    difficulty: Difficulty

    one_sentence: str = Field(
        ..., description="The whole idea in one sentence a 12-year-old parses."
    )
    plain_explanation: str = Field(
        ..., description="Jargon-free walkthrough. Every term either common or defined here."
    )
    analogies: list[Analogy] = Field(..., min_length=1, max_length=3)
    jargon_translated: dict[str, str] = Field(
        default_factory=dict,
        description="term -> plain-language meaning. The words a textbook uses without defining.",
    )
    knowledge_gaps: list[KnowledgeGap] = Field(
        ..., min_length=1, max_length=5,
        description="What must already be understood. The Feynman payload.",
    )
    common_misconception: str = Field(
        ..., description="The single most common wrong mental model, stated then corrected."
    )
    equations: list[str] = Field(
        default_factory=list,
        description="Bare LaTeX, no delimiters. Empty for non-mathematical concepts.",
    )
    visual_hints: list[VisualHint] = Field(default_factory=list)


# ── Reverse Building (deconstruction) engine ──────────────────────────────────

class BuildingBlock(BaseModel):
    """One irreducible piece the target system is assembled from."""

    name: str
    role: str = Field(..., description="What this block contributes to the whole.")
    is_axiomatic: bool = Field(
        ...,
        description="True if assumed rather than derived — the honest floor of the derivation.",
    )
    latex: str = Field("", description="Bare LaTeX if the block is a formal object.")


class DerivationStep(BaseModel):
    """
    One rung from the primitives up to the target.

    `required_tool` carries the house rule from The Lyceum's tutoring engine:
    a step has a *correct* tool, and solving it with a lower-level dodge (
    algebra where calculus is the lesson) is not a pass. Clients use this to
    stop learners from bypassing the very method being taught.
    """

    index: int = Field(..., ge=1)
    statement: str
    justification: str = Field(..., description="Why this step is licensed by the previous one.")
    required_tool: str = Field(
        ...,
        description="The method this step must use, e.g. 'chain rule', "
                    "'conservation of momentum'. Substituting a lower-level "
                    "method is not an acceptable solution.",
    )
    latex: str = Field("", description="Bare LaTeX for the step's result.")


class GoverningRule(BaseModel):
    """A law/constraint the system obeys, and the conditions under which it holds."""

    name: str
    statement: str
    latex: str = ""
    holds_when: str = Field(..., description="Domain of validity. Required — rules have limits.")


class Deconstruction(BaseModel):
    schema_version: Literal["1.0"] = "1.0"
    engine: Literal["reverse_building"] = "reverse_building"

    target: str = Field(..., description="The system/theorem being taken apart.")
    subject: Subject
    difficulty: Difficulty

    summary: str = Field(..., description="What this system is, in two sentences.")
    building_blocks: list[BuildingBlock] = Field(..., min_length=2, max_length=10)
    governing_rules: list[GoverningRule] = Field(..., min_length=1, max_length=8)
    derivation: list[DerivationStep] = Field(
        ..., min_length=2, max_length=12,
        description="Primitives -> target, in order. Each step licensed by the last.",
    )
    collapses_if: list[str] = Field(
        ..., min_length=1, max_length=5,
        description="Remove which assumption and the whole structure fails? "
                    "This is the load-bearing-wall test.",
    )
    prerequisites: list[str] = Field(default_factory=list)
    visual_hints: list[VisualHint] = Field(default_factory=list)


# ── Envelope ─────────────────────────────────────────────────────────────────

class Usage(BaseModel):
    """Token accounting, when the provider reports it. Billing is the client's."""

    input_tokens: int | None = None
    output_tokens: int | None = None


class Meta(BaseModel):
    request_id: str
    provider: str
    model: str
    latency_ms: int
    attempts: int = Field(1, description="LLM calls made, including retries and any repair pass.")
    usage: Usage = Field(default_factory=Usage)


class FeynmanResponse(BaseModel):
    data: FeynmanExplanation
    meta: Meta


class DeconstructionResponse(BaseModel):
    data: Deconstruction
    meta: Meta
