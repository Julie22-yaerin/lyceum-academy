"""
Skill 4 — PersonalizeContext.

Tailors difficulty to the student's level. Runs FIRST and makes **no LLM call**.

Why local: turning "this learner is at A-level" into "assume calculus, do not
assume multivariable, cite 9701 conventions" is a lookup, not a reasoning task.
Spending a model round trip on it would add latency and cost to every request and
produce a less consistent answer than a table does. The orchestrator's job is to
spend the client's tokens only where a model is actually required — this skill is
where that principle is most visible.

It contributes prompt directives, which every producer folds into its own system
prompt via `ctx.directive_block()`.
"""

from __future__ import annotations

import time

from ..schemas import Intent, SkillName, StudentLevel, Subject
from .base_skill import Skill, SkillContext, SkillResult

# What each band may be assumed to know, what to avoid, and how to pitch it.
# Stated as directives a model can obey, not adjectives it must interpret.
LEVEL_PROFILES: dict[StudentLevel, tuple[str, ...]] = {
    StudentLevel.MIDDLE_SCHOOL: (
        "Assume arithmetic, fractions, basic ratios and simple algebra only. "
        "Do NOT use calculus, logarithms, trigonometry or vectors.",
        "Keep every sentence under about 18 words.",
        "Use one concrete everyday object per idea. Abstraction must arrive only "
        "after the concrete case has landed.",
        "An equation is allowed only if every symbol in it is defined on the spot.",
    ),
    StudentLevel.HIGH_SCHOOL: (
        "Assume algebra, basic trigonometry, graphs and proportional reasoning. "
        "Do NOT assume calculus.",
        "Rates of change may be described qualitatively (steepness, how fast) but "
        "not via derivatives.",
        "Introduce at most two new technical terms, and define both.",
    ),
    StudentLevel.A_LEVEL: (
        "Assume single-variable calculus, logarithms, vectors, and standard "
        "A-level notation. Do NOT assume multivariable calculus, linear algebra "
        "or differential equations beyond separable first-order.",
        "Use the conventions and symbols a Cambridge A-level syllabus uses.",
        "Rigour is expected: state assumptions, and flag where a result is quoted "
        "rather than derived.",
    ),
    StudentLevel.UNDERGRADUATE: (
        "Assume multivariable calculus, linear algebra, basic differential "
        "equations, and comfort with formal definitions.",
        "Full rigour is expected. Quantify claims and state conditions precisely.",
        "Name the standard results you invoke, and be explicit about their "
        "hypotheses.",
    ),
    StudentLevel.OLYMPIAD: (
        "Assume strong problem-solving fluency: invariants, extremal arguments, "
        "bounding, symmetry, clever constructions, and full induction technique.",
        "Prefer the insight that collapses the problem over a routine grind. Say "
        "explicitly what the key idea is and why it is the key idea.",
        "Where a standard inequality or lemma applies (AM-GM, Cauchy-Schwarz, "
        "pigeonhole), name it and state its exact conditions.",
        "Do not pad with textbook exposition — this reader wants the mechanism.",
    ),
}

# Subject-specific conventions worth stating once rather than hoping for.
SUBJECT_PROFILES: dict[Subject, tuple[str, ...]] = {
    Subject.MATH: ("Quantify claims. Distinguish 'for all' from 'there exists' "
                   "explicitly when it matters to the argument.",),
    Subject.PHYSICS: ("Carry units through every quantity, and state the sign "
                      "convention when direction matters.",),
    Subject.CHEMISTRY: ("State physical conditions (temperature, pressure, "
                        "solvent, concentration) whenever they change the answer.",),
    Subject.BIOLOGY: ("Name the scale you are working at — molecular, cellular, "
                      "organism, population — and do not silently switch.",),
    Subject.CS: ("Give complexity in Θ or O with the variable named, and say what "
                 "the input size actually measures.",),
}


class PersonalizeContext(Skill):
    name = SkillName.PERSONALIZE_CONTEXT
    description = (
        "Tailors difficulty, assumed prior knowledge and notation to the student "
        "level and subject. Local — makes no LLM call."
    )
    requires_llm = False
    is_post_processor = False
    handles_intents = ()          # applies to every intent

    async def run(self, ctx: SkillContext) -> SkillResult:
        started = time.monotonic()

        ctx.directives.append(
            f"The learner is at {ctx.level.value.replace('_', ' ')} level. "
            "Pitch every explanation there — not above it, and not below it."
        )
        ctx.directives.extend(LEVEL_PROFILES.get(ctx.level, ()))
        ctx.directives.extend(SUBJECT_PROFILES.get(ctx.intent.subject, ()))

        if ctx.intent.intent is Intent.SIMPLIFY_FURTHER:
            # They already read an explanation and it did not land. Repeating the
            # same register louder is the standard failure here.
            ctx.directives.append(
                "The learner has ALREADY seen a standard explanation and it did "
                "not land. Do not restate it in the same register. Change the "
                "entry point: start from a different concrete case, or from the "
                "prerequisite they are most likely missing."
            )
        if ctx.intent.intent is Intent.COMPARE_CONCEPTS:
            ctx.directives.append(
                "The learner is comparing two things. Make the DIFFERENCE the "
                "spine of the answer, and state the one case where the two would "
                "give different predictions."
            )

        return SkillResult(
            executed=True,
            llm_calls=0,
            latency_ms=self._elapsed_ms(started),
            note=f"{len(ctx.directives)} directives for {ctx.level.value}",
        )
