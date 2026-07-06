"""
Shared personalization store — every AI feature in the app reads from and
writes to this same per-user, per-concept profile. This is the single
source of truth "every AI can see," per the product requirement: instead of
each feature (dialogue, notes, problem sets, ARI) guessing at a student's
level independently, they all read the same measured signals here and
adapt consistently.

Two kinds of data:

1. RAW measured signals (concept_mastery, subject_affinity) — plain event
   counters, incremented as the student actually interacts with the app.
   Never inferred or guessed; only real interaction events.

2. DERIVED bars (1-20) and AI tuning parameters, computed FROM the raw
   signals on read. Nothing here is stored pre-computed, so the derivation
   formula can be tuned freely without a data migration.

Storage: same lightweight sqlite3 pattern as finetune_db.py/activity_log.py
(no ORM). Keyed by Firebase UID (from require_auth), not by the unused
Postgres UserProfile table — see the note in mastery_profile.py's sibling
services for why (no live endpoint actually resolves a Postgres user row
today; require_auth only verifies the Firebase token).
"""

from __future__ import annotations
import os
import sqlite3
from datetime import datetime, timezone

_HERE   = os.path.dirname(os.path.abspath(__file__))
DB_PATH = os.path.join(_HERE, "../../finetune.db")

DDL = """
CREATE TABLE IF NOT EXISTS concept_mastery (
    user_id                   TEXT NOT NULL,
    concept                   TEXT NOT NULL,
    subject                   TEXT NOT NULL DEFAULT 'other',
    baseline_proficiency      INTEGER,              -- 1-20, NULL until first measured
    confusion_count           INTEGER NOT NULL DEFAULT 0,
    not_understood_count      INTEGER NOT NULL DEFAULT 0,
    questions_asked_count     INTEGER NOT NULL DEFAULT 0,
    self_discovered_gap_count INTEGER NOT NULL DEFAULT 0,
    voiced_uncertainty_count  INTEGER NOT NULL DEFAULT 0,
    mistakes_count            INTEGER NOT NULL DEFAULT 0,   -- wrong attempts, for gap %
    attempts_count            INTEGER NOT NULL DEFAULT 0,   -- total graded attempts, for gap %
    created_at                TEXT NOT NULL,
    updated_at                TEXT NOT NULL,
    PRIMARY KEY (user_id, concept)
);
CREATE INDEX IF NOT EXISTS idx_concept_mastery_user ON concept_mastery(user_id);
CREATE INDEX IF NOT EXISTS idx_concept_mastery_subject ON concept_mastery(user_id, subject);

CREATE TABLE IF NOT EXISTS subject_affinity (
    user_id          TEXT NOT NULL,
    subject          TEXT NOT NULL,
    study_events     INTEGER NOT NULL DEFAULT 0,   -- time spent / sessions on this subject
    community_events INTEGER NOT NULL DEFAULT 0,   -- messages/interactions in community rooms tagged to this subject
    created_at       TEXT NOT NULL,
    updated_at       TEXT NOT NULL,
    PRIMARY KEY (user_id, subject)
);
"""

# Every recordable signal, named exactly after the metric it measures —
# kept 1:1 with the product spec so the mapping is obvious on read.
EVENT_COLUMNS = {
    "confusion":            "confusion_count",             # tần suất hiểu lầm
    "not_understood":       "not_understood_count",        # số lần bảo chưa hiểu khi được dạy
    "question_asked":       "questions_asked_count",        # số lần đặt câu hỏi trên 1 concept
    "self_discovered_gap":  "self_discovered_gap_count",    # số lần tự phát hiện lỗ hổng khi giảng lại
    "voiced_uncertainty":   "voiced_uncertainty_count",     # số lần nói ra lỗ hổng/điều chưa chắc
}

_BAR_MAX = 20


def _conn() -> sqlite3.Connection:
    c = sqlite3.connect(DB_PATH)
    c.row_factory = sqlite3.Row
    return c


def init_db() -> None:
    with _conn() as c:
        c.executescript(DDL)


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _get_or_create_concept_row(c: sqlite3.Connection, user_id: str, concept: str, subject: str) -> None:
    now = _now()
    c.execute(
        """INSERT INTO concept_mastery (user_id, concept, subject, created_at, updated_at)
           VALUES (?,?,?,?,?)
           ON CONFLICT(user_id, concept) DO NOTHING""",
        (user_id, concept, subject, now, now),
    )


# ── Recording ──────────────────────────────────────────────────────────────

def record_event(user_id: str, concept: str, subject: str, event_type: str) -> None:
    """
    Increment one raw counter for (user_id, concept). Best-effort — a
    logging failure must never break the feature that triggered it.
    """
    column = EVENT_COLUMNS.get(event_type)
    if not column or not user_id or not concept:
        return
    try:
        with _conn() as c:
            _get_or_create_concept_row(c, user_id, concept, subject)
            c.execute(
                f"UPDATE concept_mastery SET {column} = {column} + 1, subject = ?, updated_at = ? "
                f"WHERE user_id = ? AND concept = ?",
                (subject, _now(), user_id, concept),
            )
    except Exception:
        pass


def record_baseline(user_id: str, concept: str, subject: str, score_1_20: int) -> None:
    """Set/refresh the pre-learning proficiency baseline for a concept (1-20)."""
    score = max(1, min(_BAR_MAX, round(score_1_20)))
    try:
        with _conn() as c:
            _get_or_create_concept_row(c, user_id, concept, subject)
            c.execute(
                "UPDATE concept_mastery SET baseline_proficiency = ?, subject = ?, updated_at = ? "
                "WHERE user_id = ? AND concept = ?",
                (score, subject, _now(), user_id, concept),
            )
    except Exception:
        pass


def record_attempt(user_id: str, concept: str, subject: str, passed: bool) -> None:
    """Record a graded attempt on a concept — feeds the knowledge-gap % bar."""
    try:
        with _conn() as c:
            _get_or_create_concept_row(c, user_id, concept, subject)
            c.execute(
                "UPDATE concept_mastery SET attempts_count = attempts_count + 1, "
                "mistakes_count = mistakes_count + ?, subject = ?, updated_at = ? "
                "WHERE user_id = ? AND concept = ?",
                (0 if passed else 1, subject, _now(), user_id, concept),
            )
    except Exception:
        pass


def record_subject_activity(user_id: str, subject: str, kind: str) -> None:
    """kind: 'study' or 'community'."""
    column = "study_events" if kind == "study" else "community_events" if kind == "community" else None
    if not column or not user_id or not subject:
        return
    try:
        now = _now()
        with _conn() as c:
            c.execute(
                """INSERT INTO subject_affinity (user_id, subject, created_at, updated_at)
                   VALUES (?,?,?,?)
                   ON CONFLICT(user_id, subject) DO NOTHING""",
                (user_id, subject, now, now),
            )
            c.execute(
                f"UPDATE subject_affinity SET {column} = {column} + 1, updated_at = ? "
                f"WHERE user_id = ? AND subject = ?",
                (now, user_id, subject),
            )
    except Exception:
        pass


# ── Derivation: raw counts -> 1-20 bars ─────────────────────────────────────

def _bar_from_count(count: int, saturate_at: int = 10) -> int:
    """Linear scale capped at _BAR_MAX; `saturate_at` events reach the max.
    Simple and transparent on purpose — tune `saturate_at` per metric below
    without touching storage."""
    return max(1, min(_BAR_MAX, round((count / saturate_at) * _BAR_MAX))) if count > 0 else 1


def _concept_bars(row: dict) -> dict:
    gap_percent = (row["mistakes_count"] / row["attempts_count"] * 100) if row["attempts_count"] else 0
    return {
        "concept": row["concept"],
        "subject": row["subject"],
        "baseline_proficiency_bar": row["baseline_proficiency"] or 10,   # neutral midpoint until measured
        "confusion_frequency_bar":  _bar_from_count(row["confusion_count"], saturate_at=8),
        "knowledge_gap_bar":        max(1, min(_BAR_MAX, round(gap_percent / 5))),  # 100% gap -> bar 20
        "not_understood_bar":       _bar_from_count(row["not_understood_count"], saturate_at=6),
        "questions_asked_bar":      _bar_from_count(row["questions_asked_count"], saturate_at=10),
        "self_discovered_gap_bar":  _bar_from_count(row["self_discovered_gap_count"], saturate_at=6),
        "voiced_uncertainty_bar":   _bar_from_count(row["voiced_uncertainty_count"], saturate_at=6),
        "raw": {
            "baseline_proficiency": row["baseline_proficiency"],
            "confusion_count": row["confusion_count"],
            "not_understood_count": row["not_understood_count"],
            "questions_asked_count": row["questions_asked_count"],
            "self_discovered_gap_count": row["self_discovered_gap_count"],
            "voiced_uncertainty_count": row["voiced_uncertainty_count"],
            "mistakes_count": row["mistakes_count"],
            "attempts_count": row["attempts_count"],
            "gap_percent": round(gap_percent, 1),
        },
    }


def derive_teaching_style(bars: dict) -> dict:
    """
    Teaching-style mix (weights sum to 100), per the product spec: ALWAYS
    start from "explain like a 5-year-old" as the dominant mode, then blend
    in more advanced techniques as the student demonstrates they're ready
    for them (rising baseline proficiency + more self-discovered gaps,
    which shows they can already introspect their own understanding).

    - baby_mode: never drops below a floor (30) — it's the foundation, not
      a phase to graduate out of entirely.
    - cross_subject_link: rises with baseline proficiency (a student who
      already gets the basics benefits more from analogies to other fields,
      especially math per the spec).
    - reverse_hypothesis: rises with self_discovered_gap + questions_asked —
      a student who already probes and self-corrects is ready to be
      challenged with "argue the opposite" style debate.
    """
    prof = bars["baseline_proficiency_bar"]
    self_gap = bars["self_discovered_gap_bar"]
    questions = bars["questions_asked_bar"]

    readiness = (prof + self_gap + questions) / 3   # 1-20
    advanced_pool = max(0, min(70, round((readiness - 5) * 4)))  # 0 at low readiness, up to 70 at max

    cross_subject = round(advanced_pool * 0.55)
    reverse_hypothesis = advanced_pool - cross_subject
    baby_mode = 100 - cross_subject - reverse_hypothesis
    baby_mode = max(30, baby_mode)
    # Renormalize in case the floor pushed the total over 100
    overflow = (baby_mode + cross_subject + reverse_hypothesis) - 100
    if overflow > 0:
        cross_subject = max(0, cross_subject - overflow // 2)
        reverse_hypothesis = max(0, reverse_hypothesis - (overflow - overflow // 2))

    return {
        "baby_mode_pct": baby_mode,
        "cross_subject_link_pct": cross_subject,
        "reverse_hypothesis_pct": reverse_hypothesis,
    }


def derive_question_frequency(bars: dict) -> int:
    """
    How often the AI should proactively probe/ask questions on this
    concept (1-20). Higher when the student is confused/uncertain often
    (needs more checking-in) or already engaged (asks their own questions
    — reciprocate with more).
    """
    signal = (bars["confusion_frequency_bar"] + bars["not_understood_bar"] +
              bars["voiced_uncertainty_bar"] + bars["questions_asked_bar"]) / 4
    return max(1, min(_BAR_MAX, round(signal)))


def get_concept_profile(user_id: str, concept: str) -> dict | None:
    with _conn() as c:
        row = c.execute(
            "SELECT * FROM concept_mastery WHERE user_id = ? AND concept = ?",
            (user_id, concept),
        ).fetchone()
    if not row:
        return None
    bars = _concept_bars(dict(row))
    bars["teaching_style"] = derive_teaching_style(bars)
    bars["question_frequency_bar"] = derive_question_frequency(bars)
    return bars


def get_all_concepts(user_id: str) -> list[dict]:
    with _conn() as c:
        rows = c.execute("SELECT * FROM concept_mastery WHERE user_id = ?", (user_id,)).fetchall()
    out = []
    for row in rows:
        bars = _concept_bars(dict(row))
        bars["teaching_style"] = derive_teaching_style(bars)
        bars["question_frequency_bar"] = derive_question_frequency(bars)
        out.append(bars)
    return out


def _subject_bars(row: dict) -> dict:
    study = row["study_events"]
    community = row["community_events"]
    # Love: sustained voluntary engagement — studying it often AND talking
    # about it with peers (per spec: "đánh giá theo tần suất học các môn và
    # tương tác trên community với bạn bè").
    love_bar = _bar_from_count(study + community * 2, saturate_at=20)
    return {
        "subject": row["subject"],
        "love_bar": love_bar,
        "study_events": study,
        "community_events": community,
    }


def _subject_fear_bar(user_id: str, subject: str, c: sqlite3.Connection) -> int:
    """
    Fear: high confusion/not-understood/uncertainty signals aggregated
    across this subject's concepts, discounted by voluntary engagement
    (asking questions is active coping, not avoidance, so it doesn't count
    toward fear even though it co-occurs with confusion).
    """
    rows = c.execute(
        "SELECT confusion_count, not_understood_count, voiced_uncertainty_count, questions_asked_count "
        "FROM concept_mastery WHERE user_id = ? AND subject = ?",
        (user_id, subject),
    ).fetchall()
    if not rows:
        return 1
    avoidance_signal = sum(r["confusion_count"] + r["not_understood_count"] + r["voiced_uncertainty_count"] for r in rows)
    coping_signal = sum(r["questions_asked_count"] for r in rows)
    net = max(0, avoidance_signal - coping_signal * 0.5)
    return _bar_from_count(round(net), saturate_at=15)


def get_subject_affinity(user_id: str, subject: str) -> dict:
    with _conn() as c:
        row = c.execute(
            "SELECT * FROM subject_affinity WHERE user_id = ? AND subject = ?",
            (user_id, subject),
        ).fetchone()
        fear_bar = _subject_fear_bar(user_id, subject, c)
    bars = _subject_bars(dict(row)) if row else {"subject": subject, "love_bar": 1, "study_events": 0, "community_events": 0}
    bars["fear_bar"] = fear_bar
    return bars


def get_all_subject_affinity(user_id: str) -> list[dict]:
    with _conn() as c:
        subjects = {r["subject"] for r in c.execute(
            "SELECT DISTINCT subject FROM subject_affinity WHERE user_id = ? "
            "UNION SELECT DISTINCT subject FROM concept_mastery WHERE user_id = ?",
            (user_id, user_id),
        ).fetchall()}
    return [get_subject_affinity(user_id, s) for s in sorted(subjects)]


def get_full_profile(user_id: str) -> dict:
    """
    The complete shared personalization store for one user — every AI
    feature in the app should fetch this before responding, so behavior
    stays consistent across dialogue, ARI, notes, and problem sets instead
    of each one guessing independently.
    """
    concepts = get_all_concepts(user_id)
    subjects = get_all_subject_affinity(user_id)
    # Surface the concepts that most need attention right now, so callers
    # don't have to re-derive this themselves.
    needs_attention = sorted(
        concepts,
        key=lambda c: c["confusion_frequency_bar"] + c["not_understood_bar"] + c["knowledge_gap_bar"],
        reverse=True,
    )[:5]
    discovery_candidates = [
        s["subject"] for s in subjects
        if s["love_bar"] >= 12 and s["study_events"] >= 3
    ]
    return {
        "concepts": concepts,
        "subjects": subjects,
        "needs_attention": [{"concept": c["concept"], "subject": c["subject"]} for c in needs_attention],
        "discovery_interest_subjects": discovery_candidates,
    }
