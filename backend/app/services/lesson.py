"""
Coach Lesson Package — the standard content unit the Coach hands the
student for one topic, grounded entirely in the Second Brain.

A lesson package is:
  - 1 study note: key concepts + summary, each concept illustrated with a
    real image (Wikipedia/Knowledge Graph media — diverse, not repeated),
    plus 1-2 cited reference sources
  - 2 exercise card sets (each capped at 15 cards):
      * daily      — everyday practice questions
      * past_paper — suggested past-paper-style questions, optional extra
  - 1-2 short-break games: lightweight 2D game concepts themed on the
    lesson, meant for the Game Builder (each concept becomes a sprite)

Quanta economics are NOT this module's concern — cards are graded through
the existing /ai/grade-dual and /ai/grade-all paths once the student
answers them, which is where correct-answer Quanta (1-2 per card,
difficulty-scaled) gets awarded (see app.services.quanta).
"""

from __future__ import annotations

import asyncio
import json
import logging
import re

from app.services import ai as ai_svc
from app.services import rag as rag_svc

log = logging.getLogger("pclick.lesson")

MAX_CARDS_PER_SET = 15
MAX_REFERENCES = 2
MAX_BREAK_GAMES = 2
_CONCEPTS_TO_ILLUSTRATE = 4


def _extract_json_object(text: str) -> dict:
    raw = (text or "").strip()
    if raw.startswith("```"):
        raw = raw.strip("`")
        raw = raw[raw.find("{"):] if "{" in raw else raw
    start, end = raw.find("{"), raw.rfind("}")
    if start != -1 and end > start:
        try:
            return json.loads(raw[start:end + 1])
        except Exception:
            pass
    return {}


async def _generate_note(subject: str, topic: str, rag_context: str, language: str, expertise: str) -> dict:
    system = (
        "You are the Lyceum's Note Synthesist. Build a rich study note grounded ONLY in the "
        "provided Second Brain curriculum material (plus universally standard knowledge of the topic). "
        "Respond with ONLY a JSON object, no markdown fences, with keys: "
        "title (string), tldr (string, 1-2 sentences), summary (markdown string, 300-500 words), "
        "key_concepts (array of {concept, definition, equation (LaTeX or ''), explanation (fun analogy), emoji}, "
        "3-5 items — pick the concepts most worth illustrating with a real image), "
        "socratic_questions (array of 3 strings), key_insight (string). "
        f"Write in language code '{language}'."
    )
    if expertise:
        system += expertise
    user = (
        f"Topic: {topic}\nSubject: {subject or 'general'}\n\n"
        f"Second Brain material:\n{rag_context or '(no matching vault notes — rely on standard curriculum knowledge)'}"
    )
    try:
        resp = await ai_svc.chat(
            [{"role": "system", "content": system}, {"role": "user", "content": user}],
            temperature=0.5, max_tokens=3000,
        )
        text = ai_svc.extract_text(resp)
    except Exception as e:
        log.error("lesson note generation failed: %s", e)
        text = ""

    note = _extract_json_object(text)
    if not note.get("title"):
        note = {"title": topic.title() or subject.title(), "tldr": "", "summary": text,
                "key_concepts": [], "socratic_questions": [], "key_insight": ""}
    note["source_type"] = "second-brain"
    return note


async def _illustrate_note(note: dict, subject: str, topic: str) -> None:
    """Attach diverse real images per concept + 1-2 cited references.
    Mutates `note` in place. Best-effort — a media lookup failure just
    means that concept goes unillustrated, never blocks the note."""
    concepts = note.get("key_concepts") or []
    labels = [c.get("concept", "") for c in concepts[:_CONCEPTS_TO_ILLUSTRATE] if c.get("concept")]
    if not labels:
        labels = [topic or subject]

    results = await asyncio.gather(
        *(ai_svc._fetch_node_media(label) for label in labels),
        return_exceptions=True,
    )

    seen_images: set[str] = set()
    references: list[dict] = []
    for label, result in zip(labels, results):
        if isinstance(result, Exception) or not isinstance(result, dict):
            continue
        images = [img for img in (result.get("images") or []) if img not in seen_images]
        if images:
            seen_images.update(images)
            for c in concepts:
                if c.get("concept") == label:
                    c["image_url"] = images[0]
                    c["image_urls"] = images[:2]
        src = result.get("source_url")
        if src and len(references) < MAX_REFERENCES and not any(r["url"] == src for r in references):
            references.append({"title": label, "url": src})

    note["key_concepts"] = concepts
    note["image_urls"] = list(seen_images)[:4]
    note["references"] = references[:MAX_REFERENCES]


async def _generate_break_games(subject: str, topic: str, concepts: list[str], language: str) -> list[dict]:
    """1-2 lightweight break-game concepts themed on the lesson — handed to
    the Game Builder, which turns `concepts` into sprites the student drags
    onto a stage. No asset generation happens here (that's slow/on-demand)."""
    concept_hint = ", ".join(concepts[:6]) or topic or subject
    system = (
        "You design short, playful 2D game concepts for students to enjoy during a 5-10 minute study "
        "break, themed on what they just studied. Return ONLY a JSON array (1-2 items), no markdown fences. "
        "Each item: {\"title\": \"...\", \"description\": \"one playful sentence\", "
        "\"concepts\": [\"sprite idea 1\", \"sprite idea 2\", \"sprite idea 3\"]}. "
        f"Write in language code '{language}'."
    )
    user = f"Lesson topic: {topic or subject}\nKey ideas to riff on: {concept_hint}"
    try:
        resp = await ai_svc.chat(
            [{"role": "system", "content": system}, {"role": "user", "content": user}],
            temperature=0.8, max_tokens=600,
        )
        text = ai_svc.extract_text(resp)
    except Exception as e:
        log.warning("lesson break-game generation failed: %s", e)
        return []

    raw = text.strip()
    m = re.search(r"\[[\s\S]*\]", raw)
    if not m:
        return []
    try:
        games = json.loads(m.group(0))
    except Exception:
        return []
    if not isinstance(games, list):
        return []

    out = []
    for g in games[:MAX_BREAK_GAMES]:
        if not isinstance(g, dict) or not g.get("title"):
            continue
        out.append({
            "title": str(g.get("title", ""))[:80],
            "description": str(g.get("description", ""))[:200],
            "concepts": [str(c)[:60] for c in (g.get("concepts") or [])][:6],
        })
    return out


async def generate_lesson_package(subject: str, topic: str, language: str = "en", expertise: str = "") -> dict:
    """Assemble the full standard Coach lesson package for one topic."""
    query = f"{subject} {topic}".strip() or subject
    try:
        rag_context = rag_svc.context_for(query, n=8)
    except Exception:
        rag_context = ""

    note = await _generate_note(subject, topic, rag_context, language, expertise)
    concept_labels = [c.get("concept", "") for c in (note.get("key_concepts") or []) if c.get("concept")]

    # Images/references + both card sets + break games run concurrently —
    # independent AI/network calls, no reason to serialize them.
    _, daily, past_paper, break_games = await asyncio.gather(
        _illustrate_note(note, subject, topic),
        ai_svc.generate_exercises(subject, topic, count=MAX_CARDS_PER_SET, expertise=expertise),
        ai_svc.generate_exercises(subject, topic, count=MAX_CARDS_PER_SET, expertise=expertise, past_paper=True),
        _generate_break_games(subject, topic, concept_labels, language),
    )

    return {
        "note": note,
        "daily_cards": daily.get("cards", []),
        "past_paper_cards": past_paper.get("cards", []),
        "break_games": break_games,
    }
