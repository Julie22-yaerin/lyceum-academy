"""
PII Filter Service (SOC-16 — Data Minimization)
══════════════════════════════════════════════════

Scans and strips personally identifiable information (PII) from user-uploaded
text content (PDFs, notes, problem sets) BEFORE it is sent to any AI provider.

Coverage:
  • Vietnamese student names     — "Sinh viên: Nguyễn Văn A"
  • English student names        — "Student: John Smith"
  • Student IDs / MSSV           — "MSSV: 20241234", "22001"
  • School/University names      — "Đại học Bách Khoa", "Harvard University"
  • Email addresses              — "student@example.com"
  • Phone numbers (VN + intl)    — "0123456789", "+84 123 456 789"
  • Physical addresses           — "123 Đường Nguyễn Huệ, Quận 1"
  • Date of birth patterns       — "DD/MM/YYYY", "Ngày sinh: 01/01/2000"
  • Class codes / course codes   — "CS 101", "MATH 241"
  • Instructor names             — "GV: Nguyễn Văn B", "Prof. Smith"

Design:
  - Compile all patterns once at module load (fast)
  - Replace matched PII with a safe placeholder like "[REDACTED]"
  - Preserve all educational content (LaTeX, equations, problem text)
  - Vietnamese and English optimized — easy to extend for other languages
"""

from __future__ import annotations

import re
import logging
from typing import Any

log = logging.getLogger("pclick.pii_filter")

# ── PII Patterns ──────────────────────────────────────────────────────────────
# Each pattern is compiled once at module import for performance.
# Patterns are ordered from specific → general to avoid false positives.

_PII_PATTERNS: list[re.Pattern] = [
    # ── Email addresses ────────────────────────────────────────────────────────
    re.compile(
        r'\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b',
        re.IGNORECASE,
    ),
    # ── Phone numbers (Vietnamese + international) ─────────────────────────────
    re.compile(
        r'(?:\+?84|0)(?:[ -]?\d{1,3}){3,5}\b',
        re.IGNORECASE,
    ),
    re.compile(
        r'\b(?:\+?\d{1,3}[ -]?)?\(?\d{2,4}\)?[ -]?\d{3,4}[ -]?\d{3,4}\b',
    ),
    # ── Vietnamese student ID patterns ─────────────────────────────────────────
    # MSSV: 2 digits + 6-8 digits  e.g. 20241234, 22001001
    re.compile(
        r'\b(?:MSSV|MSV|Mã\s+SV|Mã\s+sinh\s+viên|Student\s+ID|Student\s+Code|SID)\s*[:;.]?\s*\d{6,10}\b',
        re.IGNORECASE,
    ),
    # Standalone student-number sequences (context-dependent — match after
    # roll-call markers like "Lớp:", "Khoa:", "Niên khóa:")
    re.compile(
        r'(?:Lớp|Khoa|Niên\s+khóa|MS\w*)\s*[:;.]?\s*[A-Za-z]{0,4}\d{4,8}',
        re.IGNORECASE,
    ),
    # ── Vietnamese ID / CCCD numbers ──────────────────────────────────────────
    re.compile(
        r'\b(?:CCCD|CMND|Căn\s+cước|Chứng\s+minh)[\s:;.]*\d{9,12}\b',
        re.IGNORECASE,
    ),
    # ── Date of birth patterns ────────────────────────────────────────────────
    re.compile(
        r'(?:Ngày\s+sinh|DOB|Date\s+of\s+birth|Sinh\s+ngày)\s*[:;.]?\s*\d{1,2}[/-]\d{1,2}[/-]\d{2,4}\b',
        re.IGNORECASE,
    ),
    # ── Vietnamese full name patterns ──────────────────────────────────────────
    # "Họ và tên: Nguyễn Văn A" / "Sinh viên: Trần Thị B"
    # Uses word boundaries and label prefixes to avoid flagging problem content
    re.compile(
        r'(?:Họ\s+và\s+tên|Họ\s+tên|Tên|Full\s+name|Name|Sinh\s+viên|Học\s+sinh)\s*[:;.]?\s*'
        r'[A-ZÀÁẢÃẠÂẤẦẨẪẬĂẮẰẲẴẶĐÈÉẺẼẸÊẾỀỂỄỆÌÍỈĨỊÒÓỎÕỌÔỐỒỔỖỘƠỚỜỞỠỢÙÚỦŨỤƯỨỪỬỮỰỲÝỶỸỴ]'
        r'[a-zàáảãạâấầẩẫậăắằẳẵặđèéẻẽẹêếềểễệìíỉĩịòóỏõọôốồổỗộơớờởỡợùúủũụưứừửữựỳýỷỹỵ]+'
        r'(?:\s+[A-ZÀÁẢÃẠÂẤẦẨẪẬĂẮẰẲẴẶĐÈÉẺẼẸÊẾỀỂỄỆÌÍỈĨỊÒÓỎÕỌÔỐỒỔỖỘƠỚỜỞỠỢÙÚỦŨỤƯỨỪỬỮỰỲÝỶỸỴ]'
        r'[a-zàáảãạâấầẩẫậăắằẳẵặđèéẻẽẹêếềểễệìíỉĩịòóỏõọôốồổỗộơớờởỡợùúủũụưứừửữựỳýỷỹỵ]*)*'
        r'(?:\s+[A-ZÀÁẢÃẠÂẤẦẨẪẬĂẮẰẲẴẶĐÈÉẺẼẸÊẾỀỂỄỆÌÍỈĨỊÒÓỎÕỌÔỐỒỔỖỘƠỚỜỞỠỢÙÚỦŨỤƯỨỪỬỮỰỲÝỶỸỴ])?',
        re.UNICODE,
    ),
    # ── School/University names (Vietnamese) ──────────────────────────────────
    re.compile(
        r'(?:Trường|Đại\s+học|Học\s+viện|Viện|Cao\s+đẳng|THPT|THCS|Trung\s+học)\s*'
        r'[:;.]?\s*["""]?[A-ZÀÁẢÃẠÂẤẦẨẪẬĂẮẰẲẴẶĐÈÉẺẼẸÊẾỀỂỄỆÌÍỈĨỊÒÓỎÕỌÔỐỒỔỖỘƠỚỜỞỠỢÙÚỦŨỤƯỨỪỬỮỰỲÝỶỸỴ]'
        r'[a-zàáảãạâấầẩẫậăắằẳẵặđèéẻẽẹêếềểễệìíỉĩịòóỏõọôốồổỗộơớờởỡợùúủũụưứừửữựỳýỷỹỵ\sA-ZÀÁẢÃẠÂẤẦẨẪẬĂẮẰẲẴẶĐÈÉẺẼẸÊẾỀỂỄỆÌÍỈĨỊÒÓỎÕỌÔỐỒỔỖỘƠỚỜỞỠỢÙÚỦŨỤƯỨỪỬỮỰỲÝỶỸỴa-zàáảãạâấầẩẫậăắằẳẵặđèéẻẽẹêếềểễệìíỉĩịòóỏõọôốồổỗộơớờởỡợùúủũụưứừửữựỳýỷỹỵ]+[""""]?',
        re.UNICODE,
    ),
    # ── School/University names (English) ─────────────────────────────────────
    re.compile(
        r'\b(?:University|College|Institute|School|Academy|High\s+School)\s+'
        r'(?:of\s+)?[A-Z][a-zA-Z\']+(?:\s+(?:of|and|the|at)\s+[A-Z][a-zA-Z\']+)*\b',
    ),
    re.compile(
        r'\b[A-Z][a-zA-Z]+(?:\s+[A-Z][a-zA-Z]+)*\s+(?:University|College|Institute)\b',
    ),
    # ── Instructor names ──────────────────────────────────────────────────────
    re.compile(
        r'(?:GV|Giảng\s+viên|Giáo\s+sư|Thầy|Cô|Prof|Professor|Dr|Teacher|Instructor)\s*'
        r'[:;.]?\s*[A-ZÀÁẢÃẠÂẤẦẨẪẬĂẮẰẲẴẶĐÈÉẺẼẸÊẾỀỂỄỆÌÍỈĨỊÒÓỎÕỌÔỐỒỔỖỘƠỚỜỞỠỢÙÚỦŨỤƯỨỪỬỮỰỲÝỶỸỴ]'
        r'[a-zàáảãạâấầẩẫậăắằẳẵặđèéẻẽẹêếềểễệìíỉĩịòóỏõọôốồổỗộơớờởỡợùúủũụưứừửữựỳýỷỹỵ]+'
        r'(?:\s+[A-ZÀÁẢÃẠÂẤẦẨẪẬĂẮẰẲẴẶĐÈÉẺẼẸÊẾỀỂỄỆÌÍỈĨỊÒÓỎÕỌÔỐỒỔỖỘƠỚỜỞỠỢÙÚỦŨỤƯỨỪỬỮỰỲÝỶỸỴ]'
        r'[a-zàáảãạâấầẩẫậăắằẳẵặđèéẻẽẹêếềểễệìíỉĩịòóỏõọôốồổỗộơớờởỡợùúủũụưứừửữựỳýỷỹỵ]*)*',
        re.UNICODE,
    ),
    # ── Course codes ──────────────────────────────────────────────────────────
    re.compile(
        r'\b(?:Môn|Course|Subject|Class|Lớp)\s*[:;.]?\s*[A-Z]{2,6}\s*\d{3,4}\b',
        re.IGNORECASE,
    ),
    re.compile(
        r'\b[A-Z]{2,6}\s*\d{3,4}\s*-\s*[A-Z][a-zA-Z\s/]+\b',
    ),
    # ── Physical addresses (Vietnamese) ──────────────────────────────────────
    re.compile(
        r'\b\d{1,5}\s*(?:Đường|Phố|Ngõ|Hẻm|Làng|Xóm|Thôn|Ấp)\s+'
        r'[A-ZÀÁẢÃẠÂẤẦẨẪẬĂẮẰẲẴẶĐÈÉẺẼẸÊẾỀỂỄỆÌÍỈĨỊÒÓỎÕỌÔỐỒỔỖỘƠỚỜỞỠỢÙÚỦŨỤƯỨỪỬỮỰỲÝỶỸỴ][a-zàáảãạâấầẩẫậăắằẳẵặđèéẻẽẹêếềểễệìíỉĩịòóỏõọôốồổỗộơớờởỡợùúủũụưứừửữựỳýỷỹỵ\sA-ZÀÁẢÃẠÂẤẦẨẪẬĂẮẰẲẴẶĐÈÉẺẼẸÊẾỀỂỄỆÌÍỈĨỊÒÓỎÕỌÔỐỒỔỖỘƠỚỜỞỠỢÙÚỦŨỤƯỨỪỬỮỰỲÝỶỸỴa-zàáảãạâấầẩẫậăắằẳẵặđèéẻẽẹêếềểễệìíỉĩịòóỏõọôốồổỗộơớờởỡợùúủũụưứừửữựỳýỷỹỵ]+'
        r'(?:,\s*(?:Phường|Xã|Quận|Huyện|Thành\s+phố|TP|Tỉnh)\s*[A-ZÀÁẢÃẠÂẤẦẨẪẬĂẮẰẲẴẶĐÈÉẺẼẸÊẾỀỂỄỆÌÍỈĨỊÒÓỎÕỌÔỐỒỔỖỘƠỚỜỞỠỢÙÚỦŨỤƯỨỪỬỮỰỲÝỶỸỴ][a-zàáảãạâấầẩẫậăắằẳẵặđèéẻẽẹêếềểễệìíỉĩịòóỏõọôốồổỗộơớờởỡợùúủũụưứừửữựỳýỷỹỵ]+)?',
        re.UNICODE,
    ),
    # ── Web URLs / Social media handles (may contain personal info in subdomain/path) ─
    re.compile(
        r'(?:https?://)?(?:www\.)?(?:facebook\.com|fb\.com|instagram\.com|twitter\.com|x\.com|'
        r'linkedin\.com|tiktok\.com|youtube\.com/@)[A-Za-z0-9._/-]+\b',
        re.IGNORECASE,
    ),
]

# Use pattern list directly for clarity and easier debugging.
# Each pattern is applied independently so allowlist checking works correctly.
_PII_PATTERNS_LIST = _PII_PATTERNS


# ── Safe placeholders ─────────────────────────────────────────────────────────

PII_PLACEHOLDER = "[REDACTED]"
"""Replacement string for all detected PII."""


# ── Allowlist ─────────────────────────────────────────────────────────────────
# Certain words look like PII but are legitimate educational content.
# E.g. "University of Cambridge" in a physics textbook is content, not PII.
# These are checked AFTER pattern matching.

_EDUCATIONAL_CONTENT_KEYWORDS: set[str] = {
    # Famous institutions commonly referenced in problem sets
    "university of cambridge",
    "university of oxford",
    "massachusetts institute of technology",
    "stanford university",
    "harvard university",
    "princeton university",
    "yale university",
    "university of tokyo",
    "national university of singapore",
    "university of melbourne",
    "eth zurich",
    "imperial college london",
    "university college london",
    "california institute of technology",
    "carnegie mellon university",
    "university of california",
    "university of michigan",
    "cornell university",
    "university of toronto",
    "university of british columbia",
    "trinity college",
    "king's college",
    "london school of economics",
    "École polytechnique",
    "École normale supérieure",
    "sorbonne université",
    "university of amsterdam",
    "ku leuven",
    "university of copenhagen",
    "university of helsinki",
    "university of oslo",
    "university of stockholm",
    "university of aarhus",
    "university of zurich",
    "university of geneva",
    "university of basel",
    "university of bern",
    "university of lausanne",
    "peking university",
    "tsinghua university",
    "university of hong kong",
    "seoul national university",
    "kaist",
    "university of sydney",
    "australian national university",
    "university of queensland",
    "monash university",
    "university of auckland",
    "max planck institute",
    "weizmann institute",
    "indian institute of technology",
    "university of delhi",
    "cairo university",
    "university of the witwatersrand",
    "university of cape town",
    # Vietnamese institutions that appear in problem set content
    "đại học quốc gia hà nội",
    "đại học quốc gia tp hồ chí minh",
    "trường đại học bách khoa hà nội",
}

# Allowlisted email domains (educational resources likely to appear in content)
_EDUCATIONAL_EMAIL_DOMAINS: set[str] = {
    "cambridge.org",
    "oup.com",
    "springer.com",
    "ieee.org",
    "acm.org",
    "nature.com",
    "science.org",
    "wiley.com",
    "elsevier.com",
    "arxiv.org",
    "jstor.org",
    "pubmed.ncbi.nlm.nih.gov",
    "google.com",
    "wikipedia.org",
    "wikimedia.org",
    "youtube.com",
    "wolframalpha.com",
    "khanacademy.org",
    "coursera.org",
    "edx.org",
    "mit.edu",
    "stanford.edu",
    "harvard.edu",
}


# ── Public API ────────────────────────────────────────────────────────────────


def strip_pii(text: str, context: str | None = None) -> str:
    """
    Scan and strip PII from a text string.

    Args:
        text: The input text to scan (e.g. extracted from a PDF, note, or problem set).
        context: Optional context hint (e.g. 'pset', 'note', 'chat') to adjust
                 sensitivity. Currently unused, reserved for future refinement.

    Returns:
        Text with PII replaced by "[REDACTED]" placeholders.
    
    This is a best-effort filter — it will NOT catch every possible PII variant.
    It is designed to have LOW false-positive rate on educational content (LaTeX,
    math notation, scientific terminology should not be flagged).
    """
    if not text:
        return text

    original = text
    result = text

    for pattern in _PII_PATTERNS_LIST:
        result = _conditional_replace(result, pattern)

    # Log if anything was redacted
    if result != original:
        log.info(
            "strip_pii: redacted %d PII patterns from text (original length: %d, new: %d)",
            _count_redactions(result),
            len(original),
            len(result),
        )

    return result


def strip_pii_from_dict(
    data: dict[str, Any],
    *,
    skip_keys: set[str] | None = None,
    in_place: bool = False,
) -> dict[str, Any]:
    """
    Recursively strip PII from all string values in a dict.

    Args:
        data: The dict to process (e.g. problem/answer payload).
        skip_keys: Optional set of keys to skip (e.g. math content that shouldn't
                   be scanned).
        in_place: If True, modifies the original dict. If False, returns a copy.

    Returns:
        The processed dict (same object if in_place=True, else a new copy).
    """
    if skip_keys is None:
        skip_keys = set()

    result = data if in_place else data.copy()

    for key, value in result.items():
        if key in skip_keys:
            continue

        if isinstance(value, str):
            result[key] = strip_pii(value)
        elif isinstance(value, dict):
            # Recursively process nested dicts
            if in_place:
                strip_pii_from_dict(value, skip_keys=skip_keys, in_place=True)
            else:
                result[key] = strip_pii_from_dict(value, skip_keys=skip_keys, in_place=False)
        elif isinstance(value, list):
            result[key] = _process_list(value, skip_keys=skip_keys)

    return result


def _process_list(
    items: list[Any],
    *,
    skip_keys: set[str] | None = None,
) -> list[Any]:
    """Recursively strip PII from all items in a list."""
    result = []
    for item in items:
        if isinstance(item, str):
            result.append(strip_pii(item))
        elif isinstance(item, dict):
            result.append(strip_pii_from_dict(item, skip_keys=skip_keys, in_place=False))
        elif isinstance(item, list):
            result.append(_process_list(item, skip_keys=skip_keys))
        else:
            result.append(item)
    return result


def _conditional_replace(text: str, pattern: re.Pattern) -> str:
    """
    Apply pattern replacement while respecting the educational-content allowlist.
    
    For each match, checks if the matched text (lowercased) is in the
    educational content allowlist. If so, keeps it unchanged.
    """
    def _replacer(match: re.Match) -> str:
        matched_text = match.group(0).strip().lower()
        # Check allowlist for full matched text
        if matched_text in _EDUCATIONAL_CONTENT_KEYWORDS:
            return match.group(0)
        # Check if matched text contains an allowlisted domain
        for domain in _EDUCATIONAL_EMAIL_DOMAINS:
            if domain in matched_text:
                return match.group(0)
        return PII_PLACEHOLDER

    return pattern.sub(_replacer, text)


def _count_redactions(text: str) -> int:
    """Count how many [REDACTED] placeholders are in the text."""
    return len(re.findall(re.escape(PII_PLACEHOLDER), text))


def has_pii(text: str) -> bool:
    """
    Quick check: does this text contain any PII?

    Useful for logging and metrics without performing the full replacement.
    Consistent with _conditional_replace — checks both educational keywords
    AND educational email domains before flagging a match.
    """
    if not text:
        return False
    for pattern in _PII_PATTERNS_LIST:
        for m in pattern.finditer(text):
            matched = m.group(0).strip().lower()
            # Check educational content allowlist
            if matched in _EDUCATIONAL_CONTENT_KEYWORDS:
                continue
            # Check educational email domains
            is_educational = any(
                domain in matched for domain in _EDUCATIONAL_EMAIL_DOMAINS
            )
            if not is_educational:
                return True
    return False
