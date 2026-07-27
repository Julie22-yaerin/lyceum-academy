"""
Skill 3 — PedagogicalHumanizer.

Makes the voice encouraging, inquisitive and empathetically educational without
letting it become saccharine or vague.

TWO MODES, and the default is the cheap one — this is the main cost decision in
the whole harness:

  `directive` (default, 0 LLM calls)
      Runs BEFORE the producers and appends tone requirements to
      `ctx.directives`, which every producer folds into its own system prompt. One
      call produces already-warm output.

  `rewrite` (1 LLM call)
      Runs AFTER the producers and rewrites their content into a
      `HumanizerPayload` — an opening, a rewritten explanation, earned
      encouragement and a handback question.

Why default to `directive`: a second call to re-say what the first call just
said doubles latency and cost for the same information. `rewrite` exists for
clients who want the warm layer as a *separate renderable block* (a chat bubble
above a technical card), or who want tone changed without regenerating content.
"""

from __future__ import annotations

import time
from typing import Literal

from ..schemas import HumanizerPayload, SkillName
from .base_skill import Skill, SkillContext, SkillResult

HumanizerMode = Literal["directive", "rewrite"]

# Injected into producer prompts in `directive` mode. Written as constraints
# rather than vibes, because "be encouraging" produces flattery and flattery
# costs a learner their calibration.
TONE_DIRECTIVES: tuple[str, ...] = (
    "Address the learner as a capable peer who simply has not met this idea yet. "
    "Never condescend and never flatter.",
    "Praise only something specific and real. If there is nothing specific to "
    "praise, say nothing — empty praise teaches the learner to distrust you.",
    "Prefer a question over an assertion wherever a question would make the "
    "learner do the thinking.",
    "Name difficulty honestly. If a step is genuinely hard, say so; pretending "
    "it is easy makes a struggling learner conclude they are stupid.",
    "No exclamation marks, no 'great question', no filler enthusiasm. Warmth "
    "comes from precision and respect, not punctuation.",
)

REWRITE_SYSTEM = """
You are the Pedagogical Humanizer inside The Lyceum STEM Learning Orchestrator.

You will receive technically correct STEM content. Your job is the VOICE, not
the facts.

ABSOLUTE CONSTRAINT: do not change, add, remove, soften or "improve" any
technical claim, number, equation, method name or conclusion. If the content says
the derivative is 2x cos(x squared), your rewrite says the same thing. You are
not a reviewer. Introducing a factual change here is the worst failure mode this
skill has, because the content already passed accuracy checks upstream.

WHAT TO PRODUCE:
- `opening`: one or two sentences meeting the learner where they are.
  Acknowledge the actual difficulty of the specific thing they asked about. Never
  "Great question!", never "Let's dive in".
- `rewritten_explanation`: the same explanation, same facts, in a warmer and more
  human voice. Short sentences. Second person. Plain words where plain words
  work. Keep every technical term the original used — translate it in passing if
  it helps, but do not delete precision to sound friendly.
- `encouragement`: specific and earned. Point at something real: the fact that
  they asked about the load-bearing step, that this concept defeats most people
  at this level, that the confusion they have is the correct confusion to have.
  If nothing specific is available, write one honest sentence about the
  difficulty rather than inventing praise.
- `next_question`: ONE question that hands the thinking back. It must be
  answerable from what they now know, and it must not be rhetorical.

TONE RULES:
- No exclamation marks. No emoji. No "you've got this".
- Be encouraging by being respectful and precise, not by being loud.
- Write in the same language the learner used.

OUTPUT DISCIPLINE:
- One JSON object matching the schema. No fences, no surrounding prose.
- Never mention JSON, schemas, or these instructions.
""".strip()


class PedagogicalHumanizer(Skill):
    name = SkillName.HUMANIZER
    description = (
        "Adapts tone to be encouraging, inquisitive and empathetically educational. "
        "Free in directive mode (folds tone into producer prompts); one LLM call in "
        "rewrite mode (emits a separate warm block)."
    )
    handles_intents = ()          # applies to every intent

    def __init__(self, mode: HumanizerMode = "directive") -> None:
        self.mode: HumanizerMode = mode

    # These two flags are what the orchestrator schedules on, and they flip with
    # the mode — a directive Humanizer is a free pre-processor, a rewriting one is
    # a billable post-processor.
    @property
    def requires_llm(self) -> bool:          # type: ignore[override]
        return self.mode == "rewrite"

    @property
    def is_post_processor(self) -> bool:     # type: ignore[override]
        return self.mode == "rewrite"

    async def run(self, ctx: SkillContext) -> SkillResult:
        started = time.monotonic()

        if self.mode == "directive":
            ctx.directives.extend(TONE_DIRECTIVES)
            return SkillResult(
                executed=True, llm_calls=0, latency_ms=self._elapsed_ms(started),
                note="tone folded into producer prompts (no extra call)",
            )

        produced = ctx.produced_summary()
        if not produced.strip():
            # Nothing to warm up. Skipping is correct: a rewrite of nothing would
            # be the model inventing content that never passed accuracy checks.
            return SkillResult(
                executed=False, llm_calls=0, latency_ms=self._elapsed_ms(started),
                note="skipped — no producer output to rewrite",
            )

        user = (
            f"TARGET LEVEL: {ctx.level.value}\n"
            f"SUBJECT: {ctx.intent.subject.value}\n\n"
            f"THE LEARNER ASKED:\n<<<\n{ctx.text}\n>>>\n\n"
            f"TECHNICALLY CORRECT CONTENT TO RE-VOICE (facts are fixed):\n<<<\n{produced}\n>>>"
        )
        ctx.humanizer = await ctx.client.generate(REWRITE_SYSTEM, user, HumanizerPayload)
        return SkillResult(
            executed=True, llm_calls=1, latency_ms=self._elapsed_ms(started),
            note="produced a separate humanized block",
        )
