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


# ── Reverse Building: answer evaluation ──────────────────────────────────────
# The deconstruction engine above takes a theorem apart. This one goes the
# other way: a learner has produced an answer, and we audit it.

class Verdict(str, Enum):
    PASS = "pass"
    PARTIAL = "partial"
    FAIL = "fail"


class NextState(str, Enum):
    """
    What the client's app should do next. This is the field a tutoring product
    actually branches on, so the mapping is fixed and stated in the prompt:

      tool_fidelity.ok = false      -> HINTING          (hard gate, overrides all)
      any criterion  = fail         -> HINTING
      all criteria   = pass         -> TRANSFER_TEST
      otherwise (a partial present) -> REVERSE_BUILD_RETRY
    """

    HINTING = "HINTING"
    REVERSE_BUILD_RETRY = "REVERSE_BUILD_RETRY"
    TRANSFER_TEST = "TRANSFER_TEST"


class ToolFidelity(BaseModel):
    """
    Did the learner use the method the lesson is teaching?

    The house rule: reaching the right number by substituting a LOWER-LEVEL
    method is not a pass — counting rectangles instead of integrating, testing
    n=1,2,3 instead of proving by induction, enumerating cases instead of
    applying Bayes. The learner is there to practise the method.

    The rule is about level, not conformity: a different method of EQUAL OR
    GREATER sophistication is a pass, and `mismatch_note` should say so. An
    evaluator that fails elegant alternative solutions teaches learners to
    stop thinking.
    """

    required_tools: list[str] = Field(..., description="What the lesson demanded.")
    used_tools: list[str] = Field(..., description="What the learner actually used.")
    ok: bool = Field(..., description="False only for a lower-level substitution.")
    mismatch_note: str = Field(
        "", description="If ok=false, which dodge was taken. If an alternative "
                        "method of equal rigour was used, say that here and keep ok=true.",
    )


class LogicalFlaw(BaseModel):
    """One specific break in the reasoning, located precisely."""

    kind: Literal[
        "non_sequitur",          # step does not follow from the previous one
        "circular",              # assumes what it is trying to show
        "unjustified_leap",      # true, but a step is missing
        "wrong_concept",         # applied a rule that does not govern this case
        "sign_or_algebra_slip",  # mechanical, not conceptual
        "unit_error",
        "scope_error",           # used a rule outside its domain of validity
    ]
    where: str = Field(..., description="Quote or paraphrase the exact offending step.")
    why: str = Field(..., description="Why it is wrong, in one or two sentences.")
    is_fatal: bool = Field(
        ..., description="True if the conclusion does not survive this flaw.",
    )


class ReverseBuildEvaluation(BaseModel):
    """
    The audit of a learner's explanation.

    Designed so a right answer reached by wrong reasoning CANNOT score a pass:
    `answer_correct` and `reasoning_sound` are separate fields, and `verdict`
    is driven by the reasoning. A product that rewards the number teaches
    learners to guess.
    """

    schema_version: Literal["1.0"] = "1.0"
    engine: Literal["reverse_build_eval"] = "reverse_build_eval"

    subject: Subject
    concept_under_test: str = Field(
        ..., description="The lesson concept this answer was supposed to exercise.",
    )

    # Deliberately separate. Both are reported; only reasoning drives verdict.
    answer_correct: bool = Field(..., description="Is the final answer right?")
    reasoning_sound: bool = Field(
        ..., description="Is the reasoning valid end to end, independent of the answer?",
    )

    tool_fidelity: ToolFidelity
    concept_applied_correctly: Verdict = Field(
        ..., description="Did they apply the lesson's concept, correctly, where it belongs?",
    )
    logical_flow: Verdict = Field(..., description="Does each step follow from the last?")
    completeness: Verdict = Field(..., description="Are the load-bearing steps all present?")

    flaws: list[LogicalFlaw] = Field(
        default_factory=list, max_length=8,
        description="Empty when the reasoning is sound. Ordered most serious first.",
    )

    verdict: Verdict
    next_state: NextState

    feedback: str = Field(
        ...,
        description="Addressed to the learner, in the language they wrote in. Names the "
                    "gap without giving the answer away. Never says 'wrong' about a "
                    "tool mismatch — says which method to practise.",
    )
    hint: str = Field(
        "", description="One nudge toward the next step. Never the answer. "
                        "Populated when next_state is HINTING or REVERSE_BUILD_RETRY.",
    )


# ── Podcast engine ───────────────────────────────────────────────────────────

class PodcastFormat(str, Enum):
    """
    Matches the three formats the Lyceum app already ships, so a client can
    switch between the app and the API without re-teaching their users.
    """

    STORYTELLER = "storyteller"   # 1 voice, monologue
    EXPLORERS = "explorers"       # 2 voices, expert + student
    GLADIATORS = "gladiators"     # 2 voices, structured disagreement


class PodcastSegment(BaseModel):
    """
    One speaker turn, ready to hand straight to a TTS engine.

    `spoken_text` is the hard constraint of this whole schema: it must contain
    NO LaTeX, no markdown, no stage directions and no symbols a voice cannot
    say. A TTS engine reads "\\frac{dy}{dx}" literally as backslash-f-r-a-c,
    which ruins the audio — so maths is spelled out in words here, and the
    display form travels separately in `on_screen_latex`.
    """

    speaker: str = Field(..., description="Speaker label, e.g. 'Host', 'Expert', 'Student'.")
    spoken_text: str = Field(
        ...,
        description="Exactly what the voice says. Plain prose, no LaTeX, no markdown, "
                    "no bracketed directions. Maths verbalised: 'd y by d x equals two x'.",
    )
    on_screen_latex: str = Field(
        "", description="Optional bare LaTeX to display while this line plays.",
    )
    is_note_cue: bool = Field(
        False,
        description="True if the learner should be writing during this segment. Drives "
                    "the listen-and-write flow: clients pause or flash a prompt here.",
    )


class PodcastScript(BaseModel):
    schema_version: Literal["1.0"] = "1.0"
    engine: Literal["podcast"] = "podcast"

    title: str
    subject: Subject
    difficulty: Difficulty
    format: PodcastFormat
    speakers: list[str] = Field(
        ..., min_length=1, max_length=2,
        description="One name for storyteller, two for explorers/gladiators.",
    )

    hook: str = Field(
        ..., description="The first 15 seconds. Earns the next minute or loses the listener.",
    )
    segments: list[PodcastSegment] = Field(..., min_length=3, max_length=60)
    takeaways: list[str] = Field(
        ..., min_length=1, max_length=5, description="What to remember, if nothing else.",
    )
    note_prompts: list[str] = Field(
        default_factory=list, max_length=8,
        description="What the learner should have written by the end — the "
                    "listen-and-write checklist.",
    )
    key_terms: dict[str, str] = Field(
        default_factory=dict, description="term -> plain meaning, spoken at least once.",
    )
    estimated_seconds: int = Field(
        ..., ge=30, le=1800, description="Rough runtime at normal speaking pace.",
    )


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


class ReverseBuildEvaluationResponse(BaseModel):
    data: ReverseBuildEvaluation
    meta: Meta


class PodcastResponse(BaseModel):
    data: PodcastScript
    meta: Meta
