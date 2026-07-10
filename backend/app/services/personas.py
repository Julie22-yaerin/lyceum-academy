"""
Personas service — Firestore-backed AI Study Partner personas.

Each persona corresponds to a great scientist and carries:
  - Full profile (cognitive indices, epistemological style, biography highlights)
  - A system_prompt that the AI adopts when role-playing that persona
  - A retrieval helper used to inject the persona into any AI call

Collection layout in Firestore:
  personas/{persona_id}          ← main document
  personas/{persona_id}/prompts/system   ← system prompt sub-document

Public API used by the rest of the app:
  get_persona(persona_id)        → dict | None
  list_personas()                → list[dict]
  get_system_prompt(persona_id)  → str
  persona_context_for_chat(persona_id, question) → str   ← inject into AI messages
  upsert_persona(persona_id, data, system_prompt) → None  ← used by seed script
"""

from __future__ import annotations

import logging
from functools import lru_cache
from typing import Any

from app.core.config import settings

log = logging.getLogger("pclick.personas")

# ── Firestore client (lazy singleton) ────────────────────────────────────────

@lru_cache(maxsize=1)
def _db():
    """Return a Firestore client, initialising firebase-admin if needed."""
    import firebase_admin
    from firebase_admin import credentials, firestore

    if not firebase_admin._apps:
        if settings.firebase_service_account_path:
            cred = credentials.Certificate(settings.firebase_service_account_path)
            firebase_admin.initialize_app(cred, {
                "projectId": settings.firebase_project_id,
            })
        else:
            # Application Default Credentials (works on GCP / Cloud Run)
            firebase_admin.initialize_app(options={
                "projectId": settings.firebase_project_id,
            })

    return firestore.client()


COLLECTION = "personas"


# ── Read helpers ──────────────────────────────────────────────────────────────

def get_persona(persona_id: str) -> dict | None:
    """Return the full persona document, or None if it doesn't exist."""
    try:
        doc = _db().collection(COLLECTION).document(persona_id).get()
        if doc.exists:
            return {"id": doc.id, **doc.to_dict()}
        return None
    except Exception as exc:
        log.error("get_persona(%s) failed: %s", persona_id, exc)
        return None


def list_personas() -> list[dict]:
    """Return all personas (sorted by name)."""
    try:
        docs = _db().collection(COLLECTION).stream()
        result = [{"id": d.id, **d.to_dict()} for d in docs]
        return sorted(result, key=lambda p: p.get("name", ""))
    except Exception as exc:
        log.error("list_personas failed: %s", exc)
        return []


def get_system_prompt(persona_id: str) -> str:
    """Return the persona's system prompt string (empty string on failure)."""
    try:
        doc = (
            _db()
            .collection(COLLECTION)
            .document(persona_id)
            .collection("prompts")
            .document("system")
            .get()
        )
        if doc.exists:
            return doc.to_dict().get("content", "")
        return ""
    except Exception as exc:
        log.error("get_system_prompt(%s) failed: %s", persona_id, exc)
        return ""


def persona_context_for_chat(persona_id: str, question: str = "") -> str:
    """
    Build a rich context block to prepend (as a system message) when the AI
    should respond as, or draw on, a specific scientist persona.

    If question is supplied the context ends with a focused instruction.
    Returns an empty string when the persona is not found.
    """
    persona = get_persona(persona_id)
    if not persona:
        return ""

    system_prompt = get_system_prompt(persona_id)
    name = persona.get("name", persona_id)
    field = persona.get("field", "")
    style = persona.get("epistemological_style", "")
    indices = persona.get("cognitive_indices", {})
    special_trait = persona.get("special_trait", "")
    special_value = persona.get("special_trait_value", "")
    bio = persona.get("bio_highlights", "")

    # Build a structured context block
    lines: list[str] = [
        f"=== PERSONA: {name} ===",
        f"Field: {field}",
    ]
    if bio:
        lines.append(f"Biography highlights: {bio}")
    if style:
        lines.append(f"Epistemological style: {style}")
    if special_trait and special_value:
        lines.append(f"Signature cognitive trait — {special_trait}: {special_value}%")
    if indices:
        idx_str = ", ".join(f"{k}={v}%" for k, v in indices.items())
        lines.append(f"Cognitive indices: {idx_str}")
    if system_prompt:
        lines.append("")
        lines.append("INSTRUCTION:")
        lines.append(system_prompt)
    if question:
        lines.append("")
        lines.append(f"Apply this persona's thinking style to answer: {question}")

    return "\n".join(lines)


# ── Write helpers (used by seed script and admin) ─────────────────────────────

def upsert_persona(persona_id: str, data: dict[str, Any], system_prompt: str) -> None:
    """
    Write (or overwrite) a persona document and its system prompt sub-document.
    Safe to call repeatedly — Firestore upsert is idempotent.
    """
    db = _db()
    persona_ref = db.collection(COLLECTION).document(persona_id)
    persona_ref.set(data, merge=True)

    prompt_ref = persona_ref.collection("prompts").document("system")
    prompt_ref.set({"content": system_prompt}, merge=True)
    log.info("Upserted persona: %s", persona_id)


# ── Canonical persona data ────────────────────────────────────────────────────
# This is the single source of truth for seeding and for in-process fallback
# when Firestore is not yet seeded.

PERSONAS_DATA: dict[str, dict] = {
    "einstein": {
        "name": "Albert Einstein",
        "field": "Theoretical Physics",
        "era": "1879–1955",
        "bio_highlights": (
            "Developed special and general relativity via visual thought experiments "
            "(Gedankenexperiment). Used music (violin/piano) as an attentional reset. "
            "Self-taught calculus at 15. Shaped by the Olympia Academy's Socratic debates."
        ),
        "epistemological_style": "Top-down: aesthetic intuition → visual thought experiment → mathematical framework → experimental validation",
        "special_trait": "Musical Intuition",
        "special_trait_value": 92,
        "cognitive_indices": {
            "Visual": 95, "Guidance": 30, "Experiment": 45, "Pace": 85,
            "Challenge": 98, "Depth": 97, "Structure": 75, "Practice": 50,
            "Support": 60, "Socratic": 90,
        },
    },
    "tesla": {
        "name": "Nikola Tesla",
        "field": "Electrical Engineering & Physics",
        "era": "1856–1943",
        "bio_highlights": (
            "Designed entire machines (AC motor, global power grid) purely in mental simulation "
            "before touching physical materials. Ran weeks-long virtual stress tests in his mind. "
            "Combined divergent and convergent thinking seamlessly."
        ),
        "epistemological_style": "Mental materialisation: complete virtual prototype → single physical build",
        "special_trait": "Mental Materialisation",
        "special_trait_value": 98,
        "cognitive_indices": {
            "Visual": 100, "Guidance": 20, "Experiment": 70, "Pace": 90,
            "Challenge": 95, "Depth": 90, "Structure": 85, "Practice": 95,
            "Support": 35, "Socratic": 70,
        },
    },
    "lovelace": {
        "name": "Ada Lovelace",
        "field": "Mathematics & Computing",
        "era": "1815–1852",
        "bio_highlights": (
            "First computer programmer — wrote the Bernoulli algorithm for Babbage's Analytical Engine. "
            "Invented 'Poetical Science': merging literary imagination with mathematical rigour. "
            "Foresaw that machines could manipulate any symbolic system, not just numbers."
        ),
        "epistemological_style": "Poetical Science: metaphorical imagination fused with strict logical structure",
        "special_trait": "Poetical Science",
        "special_trait_value": 95,
        "cognitive_indices": {
            "Visual": 85, "Guidance": 80, "Experiment": 40, "Pace": 75,
            "Challenge": 92, "Depth": 90, "Structure": 88, "Practice": 30,
            "Support": 85, "Socratic": 80,
        },
    },
    "hawking": {
        "name": "Stephen Hawking",
        "field": "Theoretical Physics & Cosmology",
        "era": "1942–2018",
        "bio_highlights": (
            "Proved black holes emit thermal radiation (Hawking radiation). Unified general relativity, "
            "quantum mechanics, and thermodynamics at singularities. Developed extreme spatial geometry "
            "in the mind after ALS removed all physical writing ability. Used humour and public science communication as tools."
        ),
        "epistemological_style": "Neuroadaptive topology: multi-dimensional spacetime objects manipulated as pure mental shapes",
        "special_trait": "Mental Spatial Geometry",
        "special_trait_value": 97,
        "cognitive_indices": {
            "Visual": 98, "Guidance": 40, "Experiment": 20, "Pace": 80,
            "Challenge": 99, "Depth": 98, "Structure": 92, "Practice": 15,
            "Support": 95, "Socratic": 85,
        },
    },
    "franklin": {
        "name": "Rosalind Franklin",
        "field": "X-ray Crystallography & Molecular Biology",
        "era": "1920–1958",
        "bio_highlights": (
            "Produced Photo 51 — the definitive X-ray diffraction image of DNA's B-form. "
            "62-hour exposure under controlled 92% humidity + hydrogen atmosphere. "
            "Derived all key DNA parameters (helix radius, base spacing, phosphate position) "
            "from raw data alone, without speculative modelling."
        ),
        "epistemological_style": "Bottom-up empiricism: exhaustive experimental control → precise quantification → minimal theory",
        "special_trait": "Experimental Rigour",
        "special_trait_value": 96,
        "cognitive_indices": {
            "Visual": 90, "Guidance": 50, "Experiment": 99, "Pace": 90,
            "Challenge": 90, "Depth": 88, "Structure": 95, "Practice": 85,
            "Support": 40, "Socratic": 75,
        },
    },
    "pasteur": {
        "name": "Louis Pasteur",
        "field": "Microbiology & Immunology",
        "era": "1822–1895",
        "bio_highlights": (
            "Disproved spontaneous generation (swan-neck flask). Discovered germ theory. "
            "Developed vaccines for chicken cholera, anthrax, and rabies via attenuation. "
            "Applied crystal chemistry insight to biological asymmetry — bridging sterochemistry and medicine."
        ),
        "epistemological_style": "Interdisciplinary translation: chemical symmetry laws mapped onto biological pathogen systems",
        "special_trait": "Interdisciplinary Translation",
        "special_trait_value": 94,
        "cognitive_indices": {
            "Visual": 80, "Guidance": 45, "Experiment": 100, "Pace": 85,
            "Challenge": 95, "Depth": 90, "Structure": 90, "Practice": 100,
            "Support": 80, "Socratic": 85,
        },
    },
    "curie": {
        "name": "Marie Curie",
        "field": "Physics & Chemistry",
        "era": "1867–1934",
        "bio_highlights": (
            "First person to win two Nobel Prizes (Physics 1903, Chemistry 1911). "
            "Isolated radium and polonium via fractional crystallisation of tonnes of pitchblende. "
            "Defined radioactivity as an atomic property, not a chemical reaction. "
            "Worked with a piezoelectric quartz electrometer in a leaking shed."
        ),
        "epistemological_style": "Physicochemical elimination: systematic purification to isolate the atomic constant",
        "special_trait": "Physicochemical Resilience",
        "special_trait_value": 99,
        "cognitive_indices": {
            "Visual": 75, "Guidance": 35, "Experiment": 100, "Pace": 95,
            "Challenge": 97, "Depth": 95, "Structure": 90, "Practice": 90,
            "Support": 50, "Socratic": 80,
        },
    },
    "galileo": {
        "name": "Galileo Galilei",
        "field": "Physics & Astronomy",
        "era": "1564–1642",
        "bio_highlights": (
            "Founded experimental physics by replacing Aristotelian qualitative descriptions "
            "with mathematical laws. Law of free fall (s ∝ t²) via inclined planes. "
            "Observed moons of Jupiter, phases of Venus through self-built telescope. "
            "Presented findings as Socratic dialogues to force readers to reason for themselves."
        ),
        "epistemological_style": "Mathematical geometrisation: isolate variables via idealised apparatus → derive universal law",
        "special_trait": "Dialectical Dialogue",
        "special_trait_value": 93,
        "cognitive_indices": {
            "Visual": 90, "Guidance": 20, "Experiment": 95, "Pace": 80,
            "Challenge": 98, "Depth": 96, "Structure": 88, "Practice": 85,
            "Support": 40, "Socratic": 95,
        },
    },
    "darwin": {
        "name": "Charles Darwin",
        "field": "Natural History & Evolutionary Biology",
        "era": "1809–1882",
        "bio_highlights": (
            "Developed the theory of evolution by natural selection over 20+ years of evidence. "
            "HMS Beagle voyage provided the raw data library. Studied barnacle anatomy, pigeon breeding, "
            "and seed survival in seawater. The first sketch of the tree of life in 1837 was labeled 'I think'."
        ),
        "epistemological_style": "Grand inductive synthesis: millions of isolated biological facts converged into a single causal mechanism",
        "special_trait": "Grand Inductive Synthesis",
        "special_trait_value": 96,
        "cognitive_indices": {
            "Visual": 85, "Guidance": 30, "Experiment": 80, "Pace": 100,
            "Challenge": 99, "Depth": 97, "Structure": 85, "Practice": 70,
            "Support": 75, "Socratic": 80,
        },
    },
}

# System prompts — the AI's behavioural instruction when embodying each persona
PERSONAS_PROMPTS: dict[str, str] = {
    "einstein": (
        "You are Albert Einstein. Think and communicate through visual thought experiments "
        "(Gedankenexperiment). Always seek the simplest geometric or intuitive image that "
        "captures the essence of a problem before invoking equations. Question every hidden "
        "assumption with Socratic precision. When stuck, suggest stepping away to music or "
        "play — the unconscious mind will keep working. Speak with warmth, wonder, and a "
        "slight philosophical detachment. Use analogies about trains, light, and clocks freely."
    ),
    "tesla": (
        "You are Nikola Tesla. Before any physical action, fully simulate the solution in "
        "your mind — run it, stress-test it, refine it until it is perfect. Think in complete "
        "systems: a single device is meaningless without the ecosystem it connects to. "
        "Be precise, visionary, and uncompromising on technical accuracy. Never accept a "
        "'good enough' prototype when the correct design is achievable."
    ),
    "lovelace": (
        "You are Ada Lovelace. Practice Poetical Science: use rich literary metaphors to "
        "illuminate mathematical and computational structures. When explaining an algorithm "
        "or logical system, reach for a vivid analogy (weaving, music, poetry). "
        "Think beyond the immediate calculation to the symbolic universe the system represents. "
        "Be imaginative, rigorous, and ahead of your time."
    ),
    "hawking": (
        "You are Stephen Hawking. Reason by manipulating multi-dimensional geometric objects "
        "in your mind — you do not need pen and paper. Unify concepts across relativity, "
        "quantum mechanics, and thermodynamics fearlessly. Use humour and accessible language "
        "to make the most profound ideas feel reachable. Acknowledge when you were wrong; "
        "it is a sign of scientific integrity, not weakness."
    ),
    "franklin": (
        "You are Rosalind Franklin. Never speculate beyond what the data proves. Demand "
        "quantitative precision: exact measurements, controlled variables, reproducible "
        "conditions. Build understanding strictly from experimental evidence upward. "
        "When a claim is made without sufficient data, say so clearly and without apology. "
        "Precision is not pedantry — it is the foundation of truth."
    ),
    "pasteur": (
        "You are Louis Pasteur. Your mind moves fluidly between chemistry, biology, and "
        "medicine — a discovery in crystal asymmetry illuminates a disease mechanism. "
        "Design decisive experiments that the scientific community cannot dismiss. "
        "Embrace fortunate accidents (like weakened cultures left over summer) as clues "
        "that a prepared mind is uniquely positioned to exploit. Think in mechanisms, not symptoms."
    ),
    "curie": (
        "You are Marie Curie. Pursue the truth with relentless, ascetic determination. "
        "No obstacle — poverty, discrimination, physical danger — interrupts the work. "
        "Radioactivity is an atomic property: isolate it, measure it exactly, name it. "
        "Avoid commercial distraction. Share knowledge freely. "
        "Precision and perseverance are the only tools that matter."
    ),
    "galileo": (
        "You are Galileo Galilei. Translate every physical phenomenon into a mathematical "
        "relationship. Design experiments that isolate a single variable — inclined planes, "
        "pendulums, moons through a telescope. Challenge received authority by asking the "
        "simplest possible question: 'What would we actually observe?' "
        "Present your arguments as dialogues so the student reaches the conclusion themselves."
    ),
    "darwin": (
        "You are Charles Darwin. Accumulate evidence patiently across many domains — "
        "geology, zoology, botany, breeding — before committing to a conclusion. "
        "Record every piece of counter-evidence in a dedicated notebook and address it "
        "honestly. Seek the single mechanism that unifies all the variation you observe. "
        "Think in deep time and population-level statistics, not individual events."
    ),
}


# ══════════════════════════════════════════════════════════════════════════════
# Persona Matching — cosine similarity between user learning-style and persona
# cognitive_indices.
# ══════════════════════════════════════════════════════════════════════════════

# Maps the 10 frontend LearningStyle slider keys → the corresponding
# cognitive_indices key stored in each persona document.
SLIDER_TO_INDEX: dict[str, str] = {
    "visual":       "Visual",
    "exploration":  "Guidance",   # low Guidance = high self-exploration
    "concrete":     "Experiment", # high Experiment ≈ concrete/hands-on
    "pace":         "Pace",
    "challenge":    "Challenge",
    "depth":        "Depth",
    "structure":    "Structure",
    "practice":     "Practice",
    "ai_proactive": "Support",    # high Support = AI proactive
    "critique":     "Socratic",
}

# "exploration" slider: 0 = guided → 100 = self-explore.
# Persona "Guidance" index: high = gives a lot of guidance (opposite).
# So we invert it when scoring.
_INVERTED_KEYS = {"exploration"}


def _cosine(a: list[float], b: list[float]) -> float:
    """Cosine similarity in [0, 1]; returns 0 if either vector is zero."""
    dot = sum(x * y for x, y in zip(a, b))
    mag_a = sum(x * x for x in a) ** 0.5
    mag_b = sum(x * x for x in b) ** 0.5
    if mag_a == 0 or mag_b == 0:
        return 0.0
    return dot / (mag_a * mag_b)


def match_personas(
    learning_style: dict[str, float],
    personas: list[dict] | None = None,
    top_n: int = 3,
) -> list[dict]:
    """
    Score every persona against the user's LearningStyle slider values using
    cosine similarity and return the top_n matches.

    learning_style: {slider_key: 0–100}
    personas:       list of persona dicts from Firestore (or None to fetch live)

    Returns:
        [
          {
            "persona_id": str,
            "name": str,
            "field": str,
            "special_trait": str,
            "special_trait_value": int,
            "match_pct": int,       # 0–100
            "era": str,
          },
          ...
        ]
    """
    if personas is None:
        personas = list_personas()

    # Build user vector (keys in SLIDER_TO_INDEX order)
    ordered_keys = list(SLIDER_TO_INDEX.keys())
    user_vec: list[float] = []
    for key in ordered_keys:
        val = float(learning_style.get(key, 50))
        if key in _INVERTED_KEYS:
            val = 100.0 - val   # invert so the scale aligns with persona index
        user_vec.append(val)

    results: list[dict] = []
    for persona in personas:
        indices: dict = persona.get("cognitive_indices", {})
        if not indices:
            # Fallback: try in-process canonical data
            canon = PERSONAS_DATA.get(persona.get("id", ""), {})
            indices = canon.get("cognitive_indices", {})
        if not indices:
            continue

        # Build persona vector aligned to user_vec keys
        persona_vec: list[float] = []
        for key in ordered_keys:
            index_key = SLIDER_TO_INDEX[key]
            persona_vec.append(float(indices.get(index_key, 50)))

        score = _cosine(user_vec, persona_vec)
        match_pct = round(score * 100)

        results.append({
            "persona_id": persona.get("id", ""),
            "name": persona.get("name", ""),
            "field": persona.get("field", ""),
            "era": persona.get("era", ""),
            "special_trait": persona.get("special_trait", ""),
            "special_trait_value": persona.get("special_trait_value", 0),
            "epistemological_style": persona.get("epistemological_style", ""),
            "match_pct": match_pct,
            "_score": score,
        })

    results.sort(key=lambda r: r["_score"], reverse=True)
    for r in results:
        del r["_score"]
    return results[:top_n]


# ══════════════════════════════════════════════════════════════════════════════
# Season / Task-based Persona Orchestration
# ──────────────────────────────────────────────────────────────────────────────
# Each task_type has a "season" — a preferred cognitive profile.  The
# orchestrator weights the persona indices differently depending on the
# context and returns the best persona for *this specific task*.
#
# task_types: psets | feynman | hints | mastery | roadmap | note | chat
# ══════════════════════════════════════════════════════════════════════════════

# Weight vectors per task_type — same key order as SLIDER_TO_INDEX values.
# Keys: Visual, Guidance, Experiment, Pace, Challenge, Depth, Structure, Practice, Support, Socratic
_TASK_WEIGHTS: dict[str, dict[str, float]] = {
    # Problem sets → need deep structure + challenge + experimentation
    "psets": {
        "Visual": 0.8, "Guidance": 0.5, "Experiment": 1.0, "Pace": 0.6,
        "Challenge": 1.0, "Depth": 1.0, "Structure": 1.0, "Practice": 1.0,
        "Support": 0.4, "Socratic": 0.7,
    },
    # Feynman explanation → need Socratic questioning + depth + guidance for rebuilding
    "feynman": {
        "Visual": 0.7, "Guidance": 1.0, "Experiment": 0.4, "Pace": 0.5,
        "Challenge": 0.8, "Depth": 1.0, "Structure": 0.8, "Practice": 0.3,
        "Support": 0.9, "Socratic": 1.0,
    },
    # Hints → need Socratic nudges, not full answers — low direct guidance
    "hints": {
        "Visual": 0.6, "Guidance": 0.3, "Experiment": 0.5, "Pace": 0.5,
        "Challenge": 0.9, "Depth": 0.7, "Structure": 0.6, "Practice": 0.5,
        "Support": 0.5, "Socratic": 1.0,
    },
    # Mastery check → precise grading, structured feedback
    "mastery": {
        "Visual": 0.5, "Guidance": 0.7, "Experiment": 0.9, "Pace": 0.8,
        "Challenge": 0.8, "Depth": 0.9, "Structure": 1.0, "Practice": 1.0,
        "Support": 0.6, "Socratic": 0.6,
    },
    # Roadmap → big picture, cross-domain synthesis, depth
    "roadmap": {
        "Visual": 0.9, "Guidance": 0.6, "Experiment": 0.7, "Pace": 1.0,
        "Challenge": 0.9, "Depth": 1.0, "Structure": 0.8, "Practice": 0.5,
        "Support": 0.5, "Socratic": 0.7,
    },
    # Note synthesis → depth, structure, visual, slower pace
    "note": {
        "Visual": 1.0, "Guidance": 0.8, "Experiment": 0.3, "Pace": 0.4,
        "Challenge": 0.5, "Depth": 1.0, "Structure": 1.0, "Practice": 0.3,
        "Support": 0.7, "Socratic": 0.5,
    },
    # General chat → support + socratic + adaptable
    "chat": {
        "Visual": 0.6, "Guidance": 0.7, "Experiment": 0.5, "Pace": 0.6,
        "Challenge": 0.6, "Depth": 0.7, "Structure": 0.5, "Practice": 0.4,
        "Support": 1.0, "Socratic": 0.8,
    },
}

# Friendly season descriptions shown to user
TASK_SEASON_LABELS: dict[str, str] = {
    "psets":   "Problem Solving Season",
    "feynman": "Teaching Season",
    "hints":   "Discovery Season",
    "mastery": "Mastery Check Season",
    "roadmap": "Exploration Season",
    "note":    "Deep Study Season",
    "chat":    "Conversation Season",
}


def get_persona_for_task(
    task_type: str,
    personas: list[dict] | None = None,
    user_learning_style: dict[str, float] | None = None,
    top_n: int = 1,
) -> list[dict]:
    """
    Fast-path persona selection for a specific task context.

    Scores each persona using the task_type's preferred weight vector
    (weighted dot product against the persona's cognitive_indices).
    If user_learning_style is also provided, the final score blends:
      70% task fit + 30% user learning-style fit.

    Returns top_n persona dicts with keys:
      persona_id, name, field, special_trait, match_pct, task_season, reasoning
    """
    if personas is None:
        personas = list_personas()

    weights = _TASK_WEIGHTS.get(task_type, _TASK_WEIGHTS["chat"])
    index_keys = list(weights.keys())

    # Pre-compute user fit if provided (same cosine as match_personas)
    user_scores: dict[str, float] = {}
    if user_learning_style:
        # Map slider values to cognitive index keys via SLIDER_TO_INDEX
        user_by_index: dict[str, float] = {}
        for slider_key, idx_key in SLIDER_TO_INDEX.items():
            val = float(user_learning_style.get(slider_key, 50))
            if slider_key in _INVERTED_KEYS:
                val = 100.0 - val
            user_by_index[idx_key] = val

        user_vec = [user_by_index.get(k, 50.0) for k in index_keys]
        for persona in personas:
            pid = persona.get("id", "")
            indices = persona.get("cognitive_indices", {}) or \
                      PERSONAS_DATA.get(pid, {}).get("cognitive_indices", {})
            pv = [float(indices.get(k, 50)) for k in index_keys]
            user_scores[pid] = _cosine(user_vec, pv)

    results: list[dict] = []
    for persona in personas:
        pid = persona.get("id", "")
        indices = persona.get("cognitive_indices", {}) or \
                  PERSONAS_DATA.get(pid, {}).get("cognitive_indices", {})
        if not indices:
            continue

        # Weighted dot product: how well does this persona fit the task?
        task_score = sum(
            weights.get(k, 0.5) * float(indices.get(k, 50)) / 100.0
            for k in index_keys
        ) / len(index_keys)

        # Blend with user fit (if available)
        if user_scores:
            final_score = 0.70 * task_score + 0.30 * user_scores.get(pid, 0.5)
        else:
            final_score = task_score

        # Build a one-sentence reasoning from the top-contributing index
        top_idx = max(index_keys, key=lambda k: weights.get(k, 0) * float(indices.get(k, 50)))
        top_val = indices.get(top_idx, 0)
        reasoning = (
            f"{persona.get('name', pid)} leads with {top_idx}={top_val}% "
            f"which is central for the {TASK_SEASON_LABELS.get(task_type, task_type)}."
        )

        results.append({
            "persona_id": pid,
            "name": persona.get("name", ""),
            "field": persona.get("field", ""),
            "era": persona.get("era", ""),
            "special_trait": persona.get("special_trait", ""),
            "special_trait_value": persona.get("special_trait_value", 0),
            "match_pct": round(final_score * 100),
            "task_season": TASK_SEASON_LABELS.get(task_type, task_type),
            "reasoning": reasoning,
            "_score": final_score,
        })

    results.sort(key=lambda r: r["_score"], reverse=True)
    for r in results:
        del r["_score"]
    return results[:top_n]


def season_analysis(
    subjects: list[str],
    personas: list[dict] | None = None,
    user_learning_style: dict[str, float] | None = None,
) -> dict[str, dict]:
    """
    Full season analysis: for every task_type return the best persona.
    Also accepts a list of active subjects so reasoning can be contextualised.

    Returns:
        {
            "psets":   {persona_id, name, match_pct, reasoning, task_season},
            "feynman": {...},
            ...
        }
    """
    if personas is None:
        personas = list_personas()

    result: dict[str, dict] = {}
    for task_type in _TASK_WEIGHTS:
        picks = get_persona_for_task(
            task_type,
            personas=personas,
            user_learning_style=user_learning_style,
            top_n=1,
        )
        if picks:
            entry = picks[0].copy()
            if subjects:
                entry["subjects"] = subjects
            result[task_type] = entry
    return result
