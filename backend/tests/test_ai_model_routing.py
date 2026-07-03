import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.services import ai


def test_grade_model_prefers_gemini_when_available(monkeypatch):
    monkeypatch.setattr(ai, "_use_google", lambda: True)
    monkeypatch.setattr(ai.settings, "google_primary_model", "gemini-2.5-flash")

    assert ai._choose_grading_model() == "gemini-2.5-flash"


def test_research_model_uses_gemma_node_model(monkeypatch):
    monkeypatch.setattr(ai, "_use_nvidia", lambda: True)
    monkeypatch.setattr(ai.settings, "nvidia_node_model", "google/gemma-2-2b-it")

    assert ai._choose_research_model() == "google/gemma-2-2b-it"
