"""
thelyceum.site/game — a standalone, no-login marketing quiz. The hook: an
AI examiner that roasts wrong answers and cop-outs, built to bait
screenshots and leaderboard bragging, ending with a redirect to the real
site. Completely separate from the Tool Dock / workspace product surface —
no auth, no Quanta, no Second Brain.

20 items per session, always in this fixed order:
  - 10 "spot_mistake"      — a worked answer with one deliberately planted
                             error; pick which candidate explanation names
                             the real flaw. Difficulty ramps 1 (easy) → 10.
  - 5  "concept_explain"   — explain a concept, by typed text or a browser
                             audio recording. Scoring here does not judge
                             correctness of content — only effort: a real
                             attempt (typed text that isn't a cop-out, or a
                             recording ≥30s) counts; giving up doesn't.
  - 5  "image_multiselect" — a generated illustration encodes 1-3 concepts;
                             pick exactly that many options.

Scoring: correct +1. Wrong or skipped on spot_mistake/image_multiselect:
0 (no penalty). On concept_explain specifically: skipping, typing a
cop-out phrase ("idk" etc.), or recording under 30s is -1 — the one place
giving up is punished harder than being wrong.

Session state is in-memory only (ephemeral quiz runs, no account behind
them) with a short TTL sweep. The leaderboard is the one thing that
outlives a session, in SQLite — same lightweight pattern as
app.services.library/exercise_cards.
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import random
import re
import sqlite3
import time
import uuid
from datetime import datetime, timezone
from typing import Any

log = logging.getLogger("pclick.game")

_HERE = os.path.dirname(os.path.abspath(__file__))
DB_PATH = os.path.join(_HERE, "../../finetune.db")

SUBJECTS = {"sinh", "toan", "hoa", "ly"}
SUBJECT_LABELS = {
    "sinh": "Biology (Sinh học)",
    "toan": "Mathematics (Toán học)",
    "hoa": "Chemistry (Hoá học)",
    "ly": "Physics (Vật lý)",
}

SESSION_TTL_SECONDS = 2 * 60 * 60  # 2h — plenty for one quiz run
CONCEPT_MIN_SECONDS = 30

_SESSIONS: dict[str, dict[str, Any]] = {}

# Unambiguous give-up phrases — safe to match anywhere in the text, since a
# real explanation would essentially never contain these exact turns of
# phrase incidentally.
_COPOUT_STRONG_PATTERNS = [
    r"\bidk\b", r"i\s*don'?t\s*know", r"i\s*dont\s*know", r"no\s*idea",
    r"not\s*sure(\s*(what|how)|\s*$)", r"\bdunno\b",
    r"kh[oô]ng\s*bi[eế]t", r"ko\s*bi[eế]t", r"k\s*bi[eế]t", r"b[oó]\s*tay",
    r"ch[aả]\s*bi[eế]t", r"ko\s*b[ií]t",
]
_COPOUT_STRONG_RE = re.compile("|".join(_COPOUT_STRONG_PATTERNS), re.IGNORECASE)

# Ambiguous single words ("pass", "skip", "chịu") — these are real words that
# can appear naturally inside a genuine Math/Science explanation ("light
# passes through the medium"), so they only count as giving up when they are
# essentially the WHOLE answer, not a word buried in a real attempt.
_COPOUT_WEAK_RE = re.compile(r"^\s*(pass|skip|idc|chịu|chiu|\?+)\s*[.!]?\s*$", re.IGNORECASE)


def is_copout(text: str) -> bool:
    text = (text or "").strip()
    if len(text) < 3:
        return True
    if _COPOUT_WEAK_RE.match(text):
        return True
    return bool(_COPOUT_STRONG_RE.search(text))


# ── Taunt / praise copy — hand-authored, not LLM-generated per-answer, so
# tone stays controlled (savage, ego-baiting, never identity-based). ───────

_SPOT_CORRECT = [
    "✅ Correct. You're not completely hopeless.",
    "✅ Right. Don't let it go to your head.",
    "🎯 Nailed it — beginner's luck or actual competence? We'll find out.",
    "✅ Correct. The bar was on the floor but hey, you stepped over it.",
    "✅ Yes. Basic pattern recognition — still counts.",
]
_SPOT_WRONG = [
    "❌ Wrong. That answer wouldn't survive a first read-through.",
    "💀 Nope. Confidently incorrect — the worst kind.",
    "❌ Wrong. Did you even read the question?",
    "😬 Incorrect. The mistake was staring right at you.",
    "❌ Nope. Back to basics for you.",
]
_SPOT_SKIP = [
    "🏃 Skipped. Coward's move, but at least it's honest.",
    "🙄 Skipped. Noted.",
    "🚪 Passed. We'll assume the worst.",
]
_IMAGE_CORRECT = [
    "✅ Correct set. You can actually see the concepts, not just the picture.",
    "👀 All correct. Sharp eyes, for once.",
    "🎯 Nailed the full set. Don't get used to it.",
]
_IMAGE_WRONG = [
    "❌ Wrong combination. You picked vibes, not concepts.",
    "🙃 Nope — that's not what's in the image, that's what you wish was in it.",
    "❌ Incorrect set. Look at it like it's on the exam, because it basically is.",
]
_CONCEPT_EFFORT = [
    "💪 Fine. At least you tried instead of folding.",
    "🙂 Acceptable effort. Doesn't mean you were right — just that you showed up.",
    "😮 You actually attempted it. Rare quality around here.",
]
_CONCEPT_COPOUT = [
    "💀 \"I don't know\"? That's not an answer, that's a surrender flag. Loser move.",
    "🤡 Congratulations, you just gave up on camera. Certified loser behavior.",
    "😭 That's the whole contribution? Pathetic.",
    "🥱 You had one job — talk for 30 seconds about something you supposedly learned. Couldn't even do that.",
    "🎱 Giving up this fast? A Magic 8-Ball tries harder than you.",
]


def _pick(pool: list[str]) -> str:
    return random.choice(pool)


# ── Score tiers ─────────────────────────────────────────────────────────

def score_tier(score: int) -> dict[str, str]:
    if score <= 0:
        return {
            "label": "NPC Tier",
            "copy": f"💀 You scored {score}. Statistically, a coin flip does better. "
                    "The Lyceum doesn't hand out participation trophies.",
        }
    if score <= 6:
        return {
            "label": "Casual Tier",
            "copy": f"🤷 You scored {score}. You know things exist. That isn't the same as knowing things.",
        }
    if score <= 12:
        return {
            "label": "Contender Tier",
            "copy": f"🙂 You scored {score}. Not bad, not good — the vast, forgettable middle.",
        }
    if score <= 17:
        return {
            "label": "Sharp Tier",
            "copy": f"🔥 You scored {score}. Actually respectable. You might survive a real curriculum.",
        }
    return {
        "label": "Lyceum Material",
        "copy": f"👑 You scored {score}. Rare. Most people fold before they get here. "
                "Come find out if you can keep it up.",
    }


# ── SQLite leaderboard ──────────────────────────────────────────────────

_DDL = """
CREATE TABLE IF NOT EXISTS game_leaderboard (
    id          TEXT PRIMARY KEY,
    player_name TEXT NOT NULL,
    subject     TEXT NOT NULL,
    curriculum  TEXT NOT NULL DEFAULT '',
    score       INTEGER NOT NULL,
    created_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_game_leaderboard_score ON game_leaderboard(score DESC);
"""


def _conn() -> sqlite3.Connection:
    c = sqlite3.connect(DB_PATH)
    c.row_factory = sqlite3.Row
    return c


def init_db() -> None:
    with _conn() as c:
        c.executescript(_DDL)


def _record_score(player_name: str, subject: str, curriculum: str, score: int) -> None:
    with _conn() as c:
        c.executescript(_DDL)
        c.execute(
            "INSERT INTO game_leaderboard (id, player_name, subject, curriculum, score, created_at) "
            "VALUES (?,?,?,?,?,?)",
            (uuid.uuid4().hex[:16], player_name[:60], subject, curriculum[:80], score,
             datetime.now(timezone.utc).isoformat()),
        )


def leaderboard(limit: int = 20) -> list[dict[str, Any]]:
    with _conn() as c:
        c.executescript(_DDL)
        rows = c.execute(
            "SELECT player_name, subject, curriculum, score, created_at FROM game_leaderboard "
            "ORDER BY score DESC, created_at ASC LIMIT ?", (limit,),
        ).fetchall()
    return [dict(r) for r in rows]


def _rank_for_score(score: int) -> int:
    with _conn() as c:
        c.executescript(_DDL)
        row = c.execute(
            "SELECT COUNT(*) + 1 AS rank FROM game_leaderboard WHERE score > ?", (score,),
        ).fetchone()
    return row["rank"] if row else 1


# ── LLM content generation ──────────────────────────────────────────────

def _extract_json(raw: str) -> dict[str, Any]:
    raw = raw.strip()
    if raw.startswith("```"):
        raw = raw.strip("`")
        if raw.startswith("json"):
            raw = raw[4:]
    start, end = raw.find("{"), raw.rfind("}")
    if start == -1 or end <= start:
        raise RuntimeError("generation returned no usable JSON")
    return json.loads(raw[start:end + 1])


_LEVEL = "grade 10 through first-year university"

_SPOT_SYSTEM = (
    "You write 10 'spot the mistake' items for a {subject} quiz aimed at students spanning {level}. "
    "Each item: a short question, then a worked answer ('shown_answer') "
    "that contains exactly ONE deliberately planted mistake (a wrong sign, a swapped formula, a "
    "misapplied rule, a unit error, a conceptual slip — vary the kind of mistake). Then give exactly "
    "4 short candidate statements ('choices') describing possible flaws in the answer — only ONE of "
    "them correctly names the actual planted mistake, the other 3 must be plausible-sounding but "
    "wrong. Order the 10 items from difficulty 1 (obvious, a beginner catches it instantly) to "
    "difficulty 10 (subtle, only a strong student catches it) — strictly increasing.\n\n"
    "Return ONLY JSON, no markdown fences:\n"
    '{{"items": [{{"difficulty": 1, "question": "...", "shown_answer": "...", '
    '"choices": ["...", "...", "...", "..."], "correct_choice_index": 0, '
    '"explanation": "what the real mistake is and the correct fix, 1-2 sentences"}}]}}\n\n'
    "Exactly 10 items, difficulties 1 through 10 in order, each with exactly 4 choices."
)

_CONCEPT_SYSTEM = (
    "You write 5 'explain this concept' prompts for a {subject} quiz aimed at students spanning "
    "{level}. Each asks the student to explain ONE named concept out loud or in "
    "writing, in their own words. Order them from difficulty 'medium' to 'very_hard' (use exactly "
    "these 5 difficulty labels in order: medium, medium, hard, hard, very_hard).\n\n"
    "Return ONLY JSON, no markdown fences:\n"
    '{{"items": [{{"difficulty": "medium", "concept": "<short concept name>", '
    '"prompt": "Explain <concept> — what it is and why it matters, in your own words."}}]}}\n\n'
    "Exactly 5 items."
)

_IMAGE_SYSTEM = (
    "You design 5 'spot the concepts in this image' items for a {subject} quiz aimed at students "
    "spanning {level}. Each item names 1-3 concepts that a simple illustration will depict (you "
    "don't draw it — you just describe what should be in the image and list the concepts). Then "
    "give 5-6 short answer options total, where exactly the concepts you listed are the correct "
    "ones and the rest are plausible-but-wrong distractor concepts from the same subject area.\n\n"
    "Return ONLY JSON, no markdown fences:\n"
    '{{"items": [{{"concepts": ["concept A", "concept B"], "image_prompt": "<a clear, literal '
    'visual description an illustrator could draw, depicting concept A and concept B together, '
    "no text/labels in the image itself>\", "
    '"options": ["concept A", "concept B", "concept C", "concept D", "concept E"]}}]}}\n\n'
    "Exactly 5 items, each with 1-3 concepts and 5-6 total options that fully include those concepts."
)


async def _generate_spot_mistakes(subject_label: str) -> list[dict[str, Any]]:
    from app.services import ai as ai_svc

    system = _SPOT_SYSTEM.format(subject=subject_label, level=_LEVEL)
    resp = await ai_svc.chat(
        [{"role": "system", "content": system}, {"role": "user", "content": "Generate the 10 items now."}],
        temperature=0.8, max_tokens=3000,
    )
    parsed = _extract_json(ai_svc.extract_text(resp))
    items = parsed.get("items") or []
    cleaned = []
    for i, it in enumerate(items[:10]):
        choices = list(it.get("choices") or [])[:4]
        while len(choices) < 4:
            choices.append("None of the above")
        idx = it.get("correct_choice_index", 0)
        if not isinstance(idx, int) or not (0 <= idx < len(choices)):
            idx = 0
        cleaned.append({
            "id": f"spot-{i + 1}",
            "type": "spot_mistake",
            "order": i,
            "difficulty": it.get("difficulty", i + 1),
            "question": it.get("question", ""),
            "shown_answer": it.get("shown_answer", ""),
            "choices": choices,
            "_correct_choice_index": idx,
            "_explanation": it.get("explanation", ""),
        })
    return cleaned


async def _generate_concept_explains(subject_label: str) -> list[dict[str, Any]]:
    from app.services import ai as ai_svc

    system = _CONCEPT_SYSTEM.format(subject=subject_label, level=_LEVEL)
    resp = await ai_svc.chat(
        [{"role": "system", "content": system}, {"role": "user", "content": "Generate the 5 items now."}],
        temperature=0.8, max_tokens=1200,
    )
    parsed = _extract_json(ai_svc.extract_text(resp))
    items = parsed.get("items") or []
    cleaned = []
    for i, it in enumerate(items[:5]):
        cleaned.append({
            "id": f"concept-{i + 1}",
            "type": "concept_explain",
            "order": 10 + i,
            "difficulty": it.get("difficulty", "medium"),
            "concept": it.get("concept", ""),
            "prompt": it.get("prompt", ""),
        })
    return cleaned


async def _generate_image_concepts(subject_label: str) -> list[dict[str, Any]]:
    from app.services import ai as ai_svc

    system = _IMAGE_SYSTEM.format(subject=subject_label, level=_LEVEL)
    resp = await ai_svc.chat(
        [{"role": "system", "content": system}, {"role": "user", "content": "Generate the 5 items now."}],
        temperature=0.8, max_tokens=1800,
    )
    parsed = _extract_json(ai_svc.extract_text(resp))
    items = parsed.get("items") or []
    cleaned = []
    for i, it in enumerate(items[:5]):
        concepts = list(it.get("concepts") or [])[:3] or ["concept"]
        options = list(it.get("options") or [])
        # make sure every concept is actually present among the options
        for c in concepts:
            if c not in options:
                options.append(c)
        options = options[:6]
        cleaned.append({
            "id": f"image-{i + 1}",
            "type": "image_multiselect",
            "order": 15 + i,
            "image_prompt": it.get("image_prompt", ", ".join(concepts)),
            "options": options,
            "max_select": len(concepts),
            "_correct_options": concepts,
            "_image_cache": None,
        })
    return cleaned


def _sweep_expired() -> None:
    now = time.time()
    expired = [sid for sid, s in _SESSIONS.items() if now - s["created"] > SESSION_TTL_SECONDS]
    for sid in expired:
        _SESSIONS.pop(sid, None)


# One canonical 20-item set per subject, generated once and reused by every
# player — curriculum is deliberately NOT a generation input, only a
# display label the player types in for the leaderboard. This also means
# each item's illustration (see get_image) is generated once total, not
# once per session, since the same shared item dicts are referenced by
# every session for that subject.
_SUBJECT_CONTENT: dict[str, list[dict[str, Any]]] = {}
_SUBJECT_LOCKS: dict[str, asyncio.Lock] = {s: asyncio.Lock() for s in SUBJECTS}


async def _get_subject_content(subject: str) -> list[dict[str, Any]]:
    cached = _SUBJECT_CONTENT.get(subject)
    if cached:
        return cached

    async with _SUBJECT_LOCKS[subject]:
        cached = _SUBJECT_CONTENT.get(subject)
        if cached:  # another request generated it while we waited for the lock
            return cached

        subject_label = SUBJECT_LABELS[subject]
        spot, concept, image = await asyncio.gather(
            _generate_spot_mistakes(subject_label),
            _generate_concept_explains(subject_label),
            _generate_image_concepts(subject_label),
        )
        items = spot + concept + image
        if len(items) < 15:
            raise RuntimeError("game generation came back too thin — try again")
        _SUBJECT_CONTENT[subject] = items
        return items


async def start_game(subject: str, curriculum: str, player_name: str) -> dict[str, Any]:
    subject = subject.strip().lower()
    if subject not in SUBJECTS:
        raise ValueError("unknown_subject")
    curriculum = (curriculum or "General").strip()[:60]
    player_name = (player_name or "Anonymous").strip()[:60] or "Anonymous"

    _sweep_expired()
    items = await _get_subject_content(subject)

    session_id = uuid.uuid4().hex
    _SESSIONS[session_id] = {
        "created": time.time(),
        "subject": subject,
        "curriculum": curriculum,
        "player_name": player_name,
        "items": {it["id"]: it for it in items},
        "order": [it["id"] for it in items],
        "score": 0,
        "answered": set(),
    }

    public_items = []
    for it in items:
        pub = {k: v for k, v in it.items() if not k.startswith("_")}
        public_items.append(pub)

    return {"session_id": session_id, "items": public_items}


def _get_session(session_id: str) -> dict[str, Any]:
    session = _SESSIONS.get(session_id)
    if not session:
        raise ValueError("session_not_found_or_expired")
    return session


def answer_item(session_id: str, item_id: str, selected: list[int], skipped: bool = False) -> dict[str, Any]:
    session = _get_session(session_id)
    item = session["items"].get(item_id)
    if not item:
        raise ValueError("item_not_found")
    if item_id in session["answered"]:
        raise ValueError("already_answered")
    session["answered"].add(item_id)

    if item["type"] == "spot_mistake":
        if skipped:
            delta, correct = 0, False
            taunt = _pick(_SPOT_SKIP)
        else:
            correct = len(selected) == 1 and selected[0] == item["_correct_choice_index"]
            delta = 1 if correct else 0
            taunt = _pick(_SPOT_CORRECT if correct else _SPOT_WRONG)
        session["score"] += delta
        return {
            "correct": correct, "delta": delta, "taunt": taunt,
            "correct_choice_index": item["_correct_choice_index"],
            "explanation": item["_explanation"],
        }

    if item["type"] == "image_multiselect":
        if skipped:
            delta, correct = 0, False
            taunt = _pick(_SPOT_SKIP)
        else:
            correct_set = set(item["_correct_options"])
            chosen_set = {item["options"][i] for i in selected if 0 <= i < len(item["options"])}
            correct = chosen_set == correct_set
            delta = 1 if correct else 0
            taunt = _pick(_IMAGE_CORRECT if correct else _IMAGE_WRONG)
        session["score"] += delta
        return {
            "correct": correct, "delta": delta, "taunt": taunt,
            "correct_options": item["_correct_options"],
        }

    raise ValueError("wrong_endpoint_for_item_type")


def concept_answer(
    session_id: str, item_id: str, mode: str, text: str = "", duration_seconds: float = 0,
) -> dict[str, Any]:
    session = _get_session(session_id)
    item = session["items"].get(item_id)
    if not item or item["type"] != "concept_explain":
        raise ValueError("item_not_found")
    if item_id in session["answered"]:
        raise ValueError("already_answered")
    session["answered"].add(item_id)

    gave_up = False
    if mode == "skip":
        gave_up = True
    elif mode == "text":
        gave_up = is_copout(text)
    elif mode == "audio":
        gave_up = duration_seconds < CONCEPT_MIN_SECONDS
    else:
        gave_up = True

    delta = -1 if gave_up else 1
    taunt = _pick(_CONCEPT_COPOUT if gave_up else _CONCEPT_EFFORT)
    session["score"] += delta
    return {"gave_up": gave_up, "delta": delta, "taunt": taunt}


async def get_image(session_id: str, item_id: str) -> bytes:
    from app.services import image_gen

    session = _get_session(session_id)
    item = session["items"].get(item_id)
    if not item or item["type"] != "image_multiselect":
        raise ValueError("item_not_found")

    if item["_image_cache"] is not None:
        return item["_image_cache"]

    prompt = (
        f"Simple clear educational illustration, plain background, clean lines, no text or labels: "
        f"{item['image_prompt']}"
    )
    negative = (
        "text, watermark, signature, cartoon mascot, photorealistic, gradient, blurry, cluttered"
    )
    png = await image_gen.generate_illustration(prompt, negative, width=512, height=384)
    item["_image_cache"] = png
    return png


def finish_game(session_id: str) -> dict[str, Any]:
    session = _get_session(session_id)
    score = session["score"]
    tier = score_tier(score)
    _record_score(session["player_name"], session["subject"], session["curriculum"], score)
    rank = _rank_for_score(score)
    board = leaderboard(10)
    _SESSIONS.pop(session_id, None)
    return {"score": score, "tier": tier, "rank": rank, "leaderboard": board}
