"""
Skill plug-ins. Every workspace tool is one of these.

Import order matters only for readability; the orchestrator's registry is what
decides what runs and when.
"""

from .base_skill import Skill, SkillContext, SkillResult
from .feynman import FeynmanEngine
from .humanizer import PedagogicalHumanizer
from .personalize import PersonalizeContext
from .reverse_building import ReverseBuildingEngine

__all__ = [
    "Skill", "SkillContext", "SkillResult",
    "FeynmanEngine", "ReverseBuildingEngine",
    "PedagogicalHumanizer", "PersonalizeContext",
]
