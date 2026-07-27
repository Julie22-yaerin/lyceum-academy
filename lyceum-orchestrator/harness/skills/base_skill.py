"""
The Skill plug-in contract.

Everything the workspace offers — Feynman, Reverse Building, Lotus Map, Exercise
Cards, Podcast — is *just a skill*. The orchestrator owns routing and cost; a
skill owns one pedagogical job and knows nothing about HTTP, retries, providers
or the other skills.

Three kinds, distinguished because they cost different amounts:

  PRODUCER       makes new content with an LLM call. `requires_llm = True`.
                 Feynman, ReverseBuilding.
  POST_PROCESSOR runs after producers and transforms what they made.
                 `is_post_processor = True`. Humanizer.
  LOCAL          shapes the run with no model call at all. `requires_llm = False`.
                 PersonalizeContext — it emits prompt directives, and charging a
                 round trip to say "explain this at A-level" would be waste.

To add a skill: subclass `Skill`, implement `run`, register it. Nothing in the
orchestrator needs editing — see `STEMOrchestrator.register`.
"""

from __future__ import annotations

import abc
import time
from dataclasses import dataclass, field
from typing import TYPE_CHECKING, Any

from ..schemas import (
    FeynmanPayload,
    HumanizerPayload,
    Intent,
    IntentClassification,
    ReverseBuildingPayload,
    SkillDescriptor,
    SkillName,
    StudentLevel,
)

if TYPE_CHECKING:                     # avoid a runtime import cycle
    from ..llm_client import LLMClient


@dataclass
class SkillContext:
    """
    The mutable state carried through the chain.

    Each skill reads what it needs and writes its own slot. That is how chaining
    works without skills importing one another: Humanizer looks for
    `feynman`/`reverse_building` in here, and does not care who filled them.
    """

    text: str
    """The validated, normalised learner input."""

    intent: IntentClassification
    client: LLMClient

    level: StudentLevel
    integrator_notes: str = ""

    # Directives contributed by LOCAL skills, injected into producer prompts.
    # This is the mechanism that lets PersonalizeContext and Humanizer influence
    # generation without spending a call of their own.
    directives: list[str] = field(default_factory=list)

    # Producer output slots.
    feynman: FeynmanPayload | None = None
    reverse_building: ReverseBuildingPayload | None = None
    humanizer: HumanizerPayload | None = None

    # Free-form scratch space for third-party skills.
    extras: dict[str, Any] = field(default_factory=dict)

    def directive_block(self) -> str:
        """Render accumulated directives for inclusion in a system prompt."""
        if not self.directives:
            return ""
        lines = "\n".join(f"- {d}" for d in self.directives)
        return f"\nACTIVE DIRECTIVES (from the orchestrator, obey all):\n{lines}\n"

    def produced_summary(self) -> str:
        """
        A compact text rendering of what producers have made so far.

        Used by post-processors that need the content but not the whole object
        graph — passing a full JSON dump into a prompt wastes tokens on braces.
        """
        parts: list[str] = []
        if self.feynman:
            parts.append(
                f"ONE-SENTENCE: {self.feynman.one_sentence}\n"
                f"EXPLANATION: {self.feynman.plain_explanation}"
            )
        if self.reverse_building:
            steps = "\n".join(
                f"  {s.index}. {s.statement} [{s.required_tool}]"
                for s in self.reverse_building.derivation
            )
            parts.append(f"SUMMARY: {self.reverse_building.summary}\nDERIVATION:\n{steps}")
        return "\n\n".join(parts)


@dataclass
class SkillResult:
    """What a skill reports back. The orchestrator turns this into a SkillTrace."""

    executed: bool
    llm_calls: int = 0
    latency_ms: int = 0
    note: str = ""


class Skill(abc.ABC):
    """Abstract base for every plug-in."""

    #: Stable identifier. Built-ins use the SkillName enum; third-party skills
    #: may use any unique string.
    name: SkillName | str

    #: One line, surfaced by GET /v1/skills for client discovery.
    description: str = ""

    #: False for local skills. The orchestrator uses this to enforce its
    #: per-request call budget before running anything.
    requires_llm: bool = True

    #: True if this transforms earlier output. Post-processors always run after
    #: producers, whatever order they were registered in.
    is_post_processor: bool = False

    #: Intents this skill handles. Empty means "any" (typical for
    #: post-processors and local skills).
    handles_intents: tuple[Intent, ...] = ()

    def applies_to(self, intent: Intent) -> bool:
        return not self.handles_intents or intent in self.handles_intents

    def descriptor(self) -> SkillDescriptor:
        return SkillDescriptor(
            name=str(getattr(self.name, "value", self.name)),
            description=self.description,
            requires_llm=self.requires_llm,
            handles_intents=list(self.handles_intents) or list(Intent),
            is_post_processor=self.is_post_processor,
        )

    @abc.abstractmethod
    async def run(self, ctx: SkillContext) -> SkillResult:
        """
        Do the work, mutating `ctx`.

        Contract: raise only `HarnessError` subclasses. The orchestrator will
        convert anything else into a `SkillFailed`, but a skill that leaks a
        provider exception has given the client a worse error message than it
        could have.
        """

    # Small helper so every skill times itself identically.
    @staticmethod
    def _elapsed_ms(started: float) -> int:
        return int((time.monotonic() - started) * 1000)
