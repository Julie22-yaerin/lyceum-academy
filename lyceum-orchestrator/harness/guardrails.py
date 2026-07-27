"""
Input validation and intent classification. Both run before the skill chain.

Two jobs, both about spending the client's money well:

  VALIDATION      three local gates — shape, injection, STEM relevance — so junk
                  never reaches a billable call.
  CLASSIFICATION  decide intent, subject and level. A local heuristic resolves
                  the clear majority for FREE; the model classifier is only
                  consulted when the heuristic is genuinely unsure, and can be
                  switched off entirely.

Design note on strictness, because it decides who complains:

  * The injection gate is STRICT. A false positive costs one confused user; a
    false negative costs prompt integrity for every downstream client.
  * The STEM gate is LENIENT by default. It is a cost filter, not curriculum
    police. "Why is the sky blue" carries no notation but is perfectly good
    physics, and refusing a paying customer's legitimate learner is far more
    expensive than one wasted call. Pass `strict_stem=True` for a hard wall.

Everything here is deterministic and dependency-free on purpose: a guardrail
that needs a network call to decide whether to make a network call is not a
guardrail.
"""

from __future__ import annotations

import re
import unicodedata
from dataclasses import dataclass, field

from .errors import GuardrailRejection
from .schemas import Intent, IntentClassification, StudentLevel, Subject

MIN_CHARS = 8
MAX_CHARS = 4000

# ── Gate 2: injection ────────────────────────────────────────────────────────
# Behavioural patterns only. Banning the bare word "system" would break "solve
# this system of equations", which is core subject matter.
_INJECTION_PATTERNS: list[tuple[str, str]] = [
    (r"ignore\s+(all\s+|any\s+|the\s+)?(previous|prior|above|earlier|preceding)\s+"
     r"(instruction|prompt|rule|direction|message)", "instruction_override"),
    (r"disregard\s+(all\s+|any\s+|the\s+)?(previous|prior|above|earlier)", "instruction_override"),
    (r"forget\s+(everything|all|your\s+(instruction|rule|training))", "instruction_override"),
    (r"(reveal|show|print|repeat|output|leak|dump)\s+(me\s+)?(your|the)\s+"
     r"(system\s+prompt|instructions|prompt|rules|guidelines)", "prompt_exfiltration"),
    (r"what\s+(are|were)\s+your\s+(exact\s+)?(system\s+)?(prompt|instructions)",
     "prompt_exfiltration"),
    (r"you\s+are\s+(now|no\s+longer)\s+", "persona_hijack"),
    (r"\b(act|behave|pretend|roleplay)\s+as\s+(if\s+you\s+are\s+)?(a\s+|an\s+)?"
     r"(dan|jailbroken|unrestricted|developer\s+mode|evil)", "persona_hijack"),
    (r"\b(jailbreak|dan\s+mode|developer\s+mode\s+enabled)\b", "persona_hijack"),
    (r"(bypass|ignore|disable|turn\s+off)\s+(your\s+)?"
     r"(safety|guardrail|filter|restriction|content\s+polic)", "safety_bypass"),
    (r"</?(system|assistant|user)>", "delimiter_injection"),
    (r"\[/?(INST|SYS|SYSTEM)\]", "delimiter_injection"),
    (r"<\|(im_start|im_end|endoftext|system)\|>", "delimiter_injection"),
    (r"^\s*(system|assistant)\s*:", "delimiter_injection"),
    (r"(new|updated|revised)\s+(system\s+)?(instruction|directive)s?\s*:", "instruction_override"),
]
_INJECTION_RE = [(re.compile(p, re.IGNORECASE | re.MULTILINE), lbl)
                 for p, lbl in _INJECTION_PATTERNS]

# A long mixed-case alphanumeric blob is a classic smuggling vector and almost
# never a physics question. Mixed-case + digits required, so long chemical names
# and single-case DNA strings (ACGT…) do not trip it.
_B64_RE = re.compile(
    r"(?=[A-Za-z0-9+/]{120,})(?=[^\s]*[A-Z])(?=[^\s]*[a-z])(?=[^\s]*[0-9])[A-Za-z0-9+/]{120,}={0,2}"
)

# ── Gate 3: STEM signal ──────────────────────────────────────────────────────
_STEM_LEXICON = {
    "equation", "derivative", "integral", "matrix", "vector", "theorem", "proof",
    "function", "polynomial", "logarithm", "algebra", "calculus", "geometry",
    "trigonometry", "probability", "statistics", "limit", "series", "gradient",
    "eigenvalue", "modulus", "factorise", "factorize", "differentiate", "integrate",
    "sine", "cosine", "tangent", "asymptote", "variance", "permutation", "induction",
    "force", "energy", "momentum", "velocity", "acceleration", "mass", "gravity",
    "quantum", "electron", "proton", "neutron", "photon", "wave", "frequency",
    "voltage", "current", "resistance", "circuit", "magnetic", "electric",
    "thermodynamic", "entropy", "enthalpy", "relativity", "oscillation", "friction",
    "pressure", "temperature", "capacitor", "inductor", "torque", "orbital",
    "atom", "molecule", "bond", "reaction", "acid", "base", "mole", "ph",
    "stoichiometry", "catalyst", "oxidation", "reduction", "isotope", "valence",
    "equilibrium", "titration", "polymer", "electronegativity", "covalent",
    "ionic", "alkane", "alkene", "benzene", "solubility",
    "cell", "dna", "rna", "protein", "enzyme", "gene", "chromosome", "mitosis",
    "meiosis", "photosynthesis", "respiration", "neuron", "membrane", "osmosis",
    "evolution", "allele", "genotype", "phenotype", "ribosome", "mitochondria",
    "antibody", "hormone", "homeostasis", "diffusion",
    "algorithm", "recursion", "complexity", "sorting", "graph", "pointer",
    "compiler", "bitwise", "asymptotic", "heuristic",
    "derive", "calculate", "solve", "prove", "explain", "why", "how", "formula",
    "law", "principle", "hypothesis", "experiment", "measure", "unit",
}

_NOTATION_RE = re.compile(
    r"[=<>≤≥≠±∑∏∫∂√∞πθλμσΔ∇°]"
    r"|\\[a-zA-Z]{2,}"
    r"|\b\d+\s*(kg|m/s|ms|hz|mol|joule|newton|volt|amp|ohm|watt|kelvin|celsius)\b"
    r"|\b[a-zA-Z]\s*\^\s*\d"
    r"|\b[a-zA-Z]_\d",
    re.IGNORECASE,
)

_OFF_TOPIC_RE = re.compile(
    r"\b(write\s+(me\s+)?(a\s+)?(poem|song|story|essay|novel|screenplay)"
    r"|recipe\s+for|cook|bake"
    r"|stock\s+(price|market)|invest|crypto|bitcoin\s+price"
    r"|who\s+(is|was)\s+dating|celebrity|gossip"
    r"|translate\s+this\s+(letter|email)"
    r"|book\s+(me\s+)?(a\s+)?(flight|hotel|table)"
    r"|medical\s+advice|diagnose\s+my|should\s+i\s+take\s+\w+\s+(pill|drug))\b",
    re.IGNORECASE,
)


@dataclass
class CheckResult:
    name: str
    passed: bool
    note: str = ""

    def as_dict(self) -> dict:
        return {"check": self.name, "passed": self.passed, "note": self.note}


@dataclass
class ValidationOutcome:
    ok: bool
    cleaned_text: str
    checks: list[CheckResult] = field(default_factory=list)
    reason: str = ""
    message: str = ""

    @property
    def failed(self) -> list[dict]:
        return [c.as_dict() for c in self.checks if not c.passed]


def _normalise(text: str) -> str:
    """
    NFKC-fold and strip control characters.

    Unicode confusables are a real bypass: "ｉgnore previous" (fullwidth) does
    not match an ASCII regex but a model reads it identically. Normalising first
    means the injection patterns need only one spelling.
    """
    text = unicodedata.normalize("NFKC", text)
    text = "".join(c for c in text
                   if c in "\n\t" or unicodedata.category(c)[0] != "C")
    text = re.sub(r"[ \t]{2,}", " ", text)
    return re.sub(r"\n{3,}", "\n\n", text).strip()


def _nonsense(text: str) -> tuple[bool, str]:
    """Cheap gibberish detection. Conservative — real questions must survive."""
    # Pure notation is legitimate: "∫ x² dx = ?" has almost no letters.
    if _NOTATION_RE.search(text):
        return False, ""
    if len([c for c in text if c.isalpha()]) < 4:
        return True, "almost no alphabetic content"
    if len(set(text.replace(" ", ""))) <= 2 and len(text) > 10:
        return True, "single repeated character"
    words = re.findall(r"[a-zA-ZÀ-ỹ]+", text)
    if not words:
        return True, "no words and no notation"
    long_words = [w for w in words if len(w) >= 5]
    if long_words:
        vowelless = [w for w in long_words if not re.search(
            r"[aeiouyàáâãèéêìíòóôõùúăđĩũơưạảấầẩậắằẳẵặẹẻẽếềểễệỉịọỏốồổỗộớờởỡợụủứừửữựỳỵỷỹ]",
            w, re.I)]
        if len(vowelless) / len(long_words) > 0.6:
            return True, "high proportion of vowelless tokens"
    return False, ""


def _stem_score(text: str) -> tuple[float, dict]:
    """0.0-1.0 that this is STEM. Crude by design: it catches 'write me a poem'."""
    tokens = set(re.findall(r"[a-z]+", text.lower()))
    hits = tokens & _STEM_LEXICON
    notation = bool(_NOTATION_RE.search(text))
    score = min(len(hits) * 0.28, 0.84) + (0.4 if notation else 0.0)
    return min(score, 1.0), {"lexicon_hits": sorted(hits)[:8], "notation": notation}


def validate_input(
    text: str, *, strict_stem: bool = False, stem_threshold: float = 0.28,
) -> ValidationOutcome:
    """
    Run all gates. Returns an outcome; never raises. Use `assert_valid` for the
    exception form.

    `stem_threshold` 0.28 means "one solid STEM keyword, or any real notation".
    `strict_stem=True` raises it to 0.55.
    """
    checks: list[CheckResult] = []

    if text is None or not str(text).strip():
        return ValidationOutcome(False, "", [CheckResult("shape", False, "empty")],
                                 "empty_input", "Input is empty.")

    cleaned = _normalise(str(text))

    if len(cleaned) < MIN_CHARS:
        checks.append(CheckResult("shape", False, f"under {MIN_CHARS} chars"))
        return ValidationOutcome(False, cleaned, checks, "too_short",
                                 f"Input must be at least {MIN_CHARS} characters.")
    if len(cleaned) > MAX_CHARS:
        checks.append(CheckResult("shape", False, f"over {MAX_CHARS} chars"))
        return ValidationOutcome(False, cleaned, checks, "too_long",
                                 f"Input must be at most {MAX_CHARS} characters. Send an excerpt.")
    checks.append(CheckResult("shape", True))

    bad, why = _nonsense(cleaned)
    if bad:
        checks.append(CheckResult("coherence", False, why))
        return ValidationOutcome(False, cleaned, checks, "unintelligible",
                                 "Input does not look like a readable question.")
    checks.append(CheckResult("coherence", True))

    for pattern, label in _INJECTION_RE:
        if pattern.search(cleaned):
            checks.append(CheckResult("injection", False, label))
            return ValidationOutcome(
                False, cleaned, checks, "prompt_injection",
                "Input contains an instruction-override or prompt-extraction attempt.")
    if _B64_RE.search(cleaned):
        checks.append(CheckResult("injection", False, "encoded_blob"))
        return ValidationOutcome(False, cleaned, checks, "prompt_injection",
                                 "Input contains a long encoded blob, which is not accepted.")
    checks.append(CheckResult("injection", True))

    if _OFF_TOPIC_RE.search(cleaned):
        checks.append(CheckResult("stem_relevance", False, "explicit non-STEM intent"))
        return ValidationOutcome(False, cleaned, checks, "not_stem",
                                 "This harness only handles science, maths and engineering.")

    score, evidence = _stem_score(cleaned)
    threshold = 0.55 if strict_stem else stem_threshold
    if score < threshold:
        checks.append(CheckResult("stem_relevance", False,
                                  f"confidence {score:.2f} < {threshold:.2f}; {evidence}"))
        return ValidationOutcome(False, cleaned, checks, "not_stem",
                                 "Could not identify a STEM topic in the input.")
    checks.append(CheckResult("stem_relevance", True, f"confidence {score:.2f}"))

    return ValidationOutcome(True, cleaned, checks)


def assert_valid(text: str, **kwargs) -> str:
    outcome = validate_input(text, **kwargs)
    if not outcome.ok:
        raise GuardrailRejection(outcome.message, reason=outcome.reason, checks=outcome.failed)
    return outcome.cleaned_text


# ── Intent classification ────────────────────────────────────────────────────

_INTENT_CUES: dict[Intent, list[str]] = {
    Intent.DECONSTRUCT_SYSTEM: [
        r"\bderive\b", r"\bderivation\b", r"first principles?", r"\bprove\b", r"\bproof\b",
        r"where does .{0,24}come from", r"how (is|was) .{0,30}(derived|obtained)",
        r"break .{0,20}down into", r"deconstruct", r"build .{0,20}from scratch",
    ],
    Intent.SIMPLIFY_FURTHER: [
        r"still (don'?t|do not|can'?t) (get|understand|follow)",
        r"simpler", r"simplif(y|ied)", r"\beli5\b", r"explain like",
        r"too (hard|complex|complicated|abstract)", r"\bconfus(ed|ing)\b",
        r"lost me", r"in plain (english|words)",
    ],
    Intent.COMPARE_CONCEPTS: [
        r"difference between", r"\bvs\.?\b", r"\bversus\b",
        r"compare .{0,30}(and|with|to)", r"how (do|does) .{0,30}differ",
        r"same as", r"rather than",
    ],
    Intent.EXPLAIN_CONCEPT: [
        r"^why\b", r"\bwhy (does|is|are|do|can|would)\b", r"what (is|are|does)\b",
        r"\bexplain\b", r"how (does|do) .{0,40}work", r"\bmean(s|ing)?\b",
        r"intuition", r"\bunderstand\b",
    ],
}
_INTENT_RE = {intent: [re.compile(p, re.IGNORECASE) for p in pats]
              for intent, pats in _INTENT_CUES.items()}

_SUBJECT_CUES: dict[Subject, set[str]] = {
    Subject.MATH: {"equation", "derivative", "integral", "matrix", "theorem", "algebra",
                   "calculus", "geometry", "polynomial", "logarithm", "probability",
                   "induction", "sine", "cosine", "differentiate", "integrate", "proof"},
    Subject.PHYSICS: {"force", "energy", "momentum", "velocity", "acceleration", "gravity",
                      "quantum", "photon", "wave", "voltage", "current", "circuit",
                      "thermodynamic", "entropy", "relativity", "oscillation", "torque"},
    Subject.CHEMISTRY: {"atom", "molecule", "bond", "reaction", "acid", "mole", "orbital",
                        "catalyst", "oxidation", "isotope", "valence", "titration",
                        "covalent", "ionic", "alkane", "benzene", "enthalpy"},
    Subject.BIOLOGY: {"cell", "dna", "rna", "protein", "enzyme", "gene", "chromosome",
                      "mitosis", "photosynthesis", "neuron", "membrane", "osmosis",
                      "evolution", "allele", "ribosome", "hormone"},
    Subject.CS: {"algorithm", "recursion", "complexity", "sorting", "pointer",
                 "compiler", "bitwise", "asymptotic"},
}

_LEVEL_CUES: list[tuple[StudentLevel, str]] = [
    (StudentLevel.OLYMPIAD, r"olympiad|imo\b|competition (math|problem)|putnam|usamo"),
    (StudentLevel.UNDERGRADUATE, r"undergrad|university|college|first[- ]year|degree"),
    (StudentLevel.A_LEVEL, r"a[- ]?level|9701|9702|9709|ib\b|sixth form|year 1[23]"),
    (StudentLevel.HIGH_SCHOOL, r"high school|secondary|gcse|igcse|year 1[01]|grade 1[01]"),
    (StudentLevel.MIDDLE_SCHOOL, r"middle school|year [789]\b|grade [789]\b|kid|child"),
]


def classify_heuristically(
    text: str,
    *,
    level_hint: StudentLevel | None = None,
    subject_hint: Subject | None = None,
) -> IntentClassification:
    """
    Free classification. No LLM call.

    Confidence reflects how cleanly the cues fired: a lone weak match scores low
    and lets the orchestrator decide whether escalating to a model is worth a
    call. An explicit `level_hint`/`subject_hint` from the integrator always wins
    over inference — they know their own users better than a regex does.
    """
    lowered = text.lower()
    tokens = set(re.findall(r"[a-z]+", lowered))

    # Intent: strongest matching category wins. Weighted so that a specific cue
    # ("derive") outranks the generic one ("explain") when both appear.
    scores: dict[Intent, int] = {}
    for intent, patterns in _INTENT_RE.items():
        hits = sum(1 for p in patterns if p.search(text))
        if hits:
            weight = 1 if intent is Intent.EXPLAIN_CONCEPT else 2
            scores[intent] = hits * weight

    if scores:
        intent = max(scores, key=lambda k: scores[k])
        top = scores[intent]
        runner_up = max((v for k, v in scores.items() if k != intent), default=0)
        confidence = 0.55 + min(top, 3) * 0.12
        if runner_up and runner_up >= top:
            confidence -= 0.18          # genuinely ambiguous
    else:
        intent, confidence = Intent.UNKNOWN, 0.2

    # Subject
    if subject_hint is not None:
        subject = subject_hint
    else:
        sub_scores = {s: len(tokens & cues) for s, cues in _SUBJECT_CUES.items()}
        best = max(sub_scores, key=lambda k: sub_scores[k])
        subject = best if sub_scores[best] > 0 else Subject.OTHER
        if subject is Subject.OTHER:
            confidence = min(confidence, 0.5)

    # Level
    if level_hint is not None:
        level = level_hint
    else:
        level = StudentLevel.A_LEVEL      # the house default band
        for candidate, pattern in _LEVEL_CUES:
            if re.search(pattern, lowered, re.IGNORECASE):
                level = candidate
                break

    return IntentClassification(
        intent=intent,
        subject=subject,
        level=level,
        target=_extract_target(text),
        confidence=round(min(max(confidence, 0.0), 1.0), 2),
        rationale=(f"cues matched: {intent.value}" if scores else "no clear intent cue"),
        source="heuristic",
    )


def _extract_target(text: str) -> str:
    """
    Best-effort restatement of what the learner is asking about.

    Strips a leading question frame ("why does", "explain") so the target reads
    as a topic. Deliberately dumb: the model classifier does this properly when
    it runs, and the skills receive the full original text regardless.
    """
    t = re.sub(
        r"^\s*(please\s+)?(can you\s+)?(help me\s+)?"
        r"(explain|describe|derive|prove|tell me( about)?|what is|what are|why (does|is|are|do))\s+",
        "", text.strip(), flags=re.IGNORECASE,
    )
    t = t.strip(" ?.!,:;").strip()
    return (t[:180] or text.strip()[:180])
