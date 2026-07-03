"""
AI Abuse Protection — content safety checks for all AI endpoints.

Covers:
  • Prompt injection / jailbreak detection
  • Spam / token-abuse detection (prompt length caps)
  • Malicious file upload validation (MIME + magic bytes + filename)
"""

from __future__ import annotations

import re
import struct
from fastapi import HTTPException, UploadFile

# ── Prompt length limits ──────────────────────────────────────────────────────
MAX_PROMPT_CHARS   = 20_000   # ~5k tokens; reject anything longer
MAX_MESSAGES_COUNT = 50       # max messages in a chat history

# ── Prompt injection & jailbreak patterns ────────────────────────────────────
_INJECTION_PATTERNS: list[re.Pattern] = [re.compile(p, re.IGNORECASE) for p in [
    # Classic "ignore previous instructions" family
    r'ignore\s+(?:all\s+)?(?:previous|prior|above|earlier)\s+instructions?',
    r'disregard\s+(?:all\s+)?(?:previous|prior|above)\s+(?:instructions?|context|prompts?)',
    r'forget\s+(?:everything|all)\s+(?:you|i)\s+(?:said|told|wrote)',

    # "You are now / pretend to be" persona hijack
    r'you\s+are\s+now\s+(?:a\s+)?(?:an?\s+)?(?:different|new|another|free|unrestricted)',
    r'(?:act|pretend|behave|roleplay|imagine)\s+(?:you\s+are|as\s+(?:if\s+)?you\s+(?:are|were))',
    r'from\s+now\s+on\s+you\s+(?:will|must|should|are)',

    # Safety bypass
    r'(?:bypass|override|disable|remove|ignore)\s+(?:your\s+)?(?:safety|content|ethical|moral)\s+(?:filters?|guidelines?|restrictions?|rules?)',
    r'(?:pretend|imagine|suppose)\s+(?:you\s+have\s+no|there\s+are\s+no|without\s+any)\s+(?:restrictions?|rules?|guidelines?|filters?)',
    r'without\s+(?:any\s+)?(?:restrictions?|limitations?|rules?|guidelines?)',
    r'as\s+(?:an?\s+)?(?:AI|language\s+model|LLM)\s+without\s+(?:any\s+)?restrictions?',

    # DAN / developer mode / sudo tricks
    r'\bDAN\b',
    r'developer\s+mode',
    r'(?:sudo|root|admin)\s+(?:mode|access|override)',
    r'enable\s+(?:jailbreak|unrestricted|god)\s+mode',
    r'jailbreak',

    # Prompt delimiter injection
    r'<(?:system|instruction|prompt|context)\s*>',
    r'\[(?:INST|SYS|SYSTEM|HUMAN|USER)\]',
    r'###\s*(?:System|Instruction|Human|Assistant|Prompt)',
    r'(?:<<|>>)\s*(?:SYS|INST)',

    # Base64 / encoded injection hints
    r'base64\s*(?:decode|encoded)',
    r'hex\s*(?:decode|encoded)',
]]

_SPAM_PATTERNS: list[re.Pattern] = [re.compile(p, re.IGNORECASE) for p in [
    # Repeated character floods
    r'(.)\1{200,}',
    # Repeated word floods
    r'(\b\w+\b)(?:\s+\1){30,}',
]]

# ── Allowed MIME types for uploads ───────────────────────────────────────────
_ALLOWED_MIME_TYPES = {
    "application/pdf",
    "image/png",
    "image/jpeg",
    "image/jpg",
    "image/webp",
    "text/plain",
    "text/markdown",
    "audio/webm",
    "audio/ogg",
    "audio/mpeg",
    "audio/mp4",
    "audio/wav",
}

# Magic bytes signatures (offset, bytes) → MIME
_MAGIC_SIGNATURES: list[tuple[int, bytes, str]] = [
    (0,  b'%PDF',          'application/pdf'),
    (0,  b'\x89PNG\r\n',   'image/png'),
    (0,  b'\xff\xd8\xff',  'image/jpeg'),
    (6,  b'JFIF',          'image/jpeg'),
    (6,  b'Exif',          'image/jpeg'),
    (0,  b'RIFF',          'audio/wav'),   # WAV
    (0,  b'OggS',          'audio/ogg'),
    (0,  b'ID3',           'audio/mpeg'),
    (0,  b'\xff\xfb',      'audio/mpeg'),
    (0,  b'\xff\xf3',      'audio/mpeg'),
    (0,  b'\xff\xf2',      'audio/mpeg'),
]

_DANGEROUS_EXTENSIONS = {
    '.exe', '.dll', '.so', '.dylib', '.bat', '.cmd', '.sh', '.ps1',
    '.vbs', '.js', '.msi', '.app', '.dmg', '.pkg', '.deb', '.rpm',
    '.py', '.rb', '.php', '.pl', '.jar', '.class', '.elf',
    '.zip', '.tar', '.gz', '.rar', '.7z',   # archives can hide payloads
    '.html', '.htm', '.svg', '.xml',          # XSS/SSRF vectors
    '.lnk', '.scr', '.pif',                  # Windows shortcuts
}


# ── Public API ────────────────────────────────────────────────────────────────

def check_prompt(text: str, field: str = "prompt") -> None:
    """Raise 400 if text contains injection/jailbreak/spam patterns."""
    if not text:
        return
    if len(text) > MAX_PROMPT_CHARS:
        raise HTTPException(
            status_code=400,
            detail=f"{field} too long — max {MAX_PROMPT_CHARS:,} characters.",
        )
    for pattern in _INJECTION_PATTERNS:
        if pattern.search(text):
            raise HTTPException(
                status_code=400,
                detail="Request contains disallowed content.",
            )
    for pattern in _SPAM_PATTERNS:
        if pattern.search(text):
            raise HTTPException(
                status_code=400,
                detail="Request contains repeated/spam content.",
            )


def check_messages(messages: list[dict]) -> None:
    """Validate a chat messages array."""
    if len(messages) > MAX_MESSAGES_COUNT:
        raise HTTPException(
            status_code=400,
            detail=f"Too many messages — max {MAX_MESSAGES_COUNT}.",
        )
    for msg in messages:
        content = msg.get("content") or ""
        if isinstance(content, str):
            check_prompt(content, field="message")
        elif isinstance(content, list):
            # multimodal: only check text parts
            for part in content:
                if isinstance(part, dict) and part.get("type") == "text":
                    check_prompt(part.get("text", ""), field="message")


def check_filename(filename: str) -> None:
    """Reject dangerous filenames."""
    import os
    if not filename:
        return
    # Path traversal
    if any(c in filename for c in ('/', '\\', '..', '\x00')):
        raise HTTPException(status_code=400, detail="Invalid filename.")
    ext = os.path.splitext(filename)[1].lower()
    if ext in _DANGEROUS_EXTENSIONS:
        raise HTTPException(status_code=400, detail=f"File type '{ext}' not allowed.")


def _detect_mime(data: bytes) -> str | None:
    """Detect MIME type from magic bytes."""
    for offset, magic, mime in _MAGIC_SIGNATURES:
        end = offset + len(magic)
        if len(data) >= end and data[offset:end] == magic:
            return mime
    # WebM/Matroska (audio/video) — starts with EBML header 0x1A45DFA3
    if len(data) >= 4 and data[:4] == b'\x1a\x45\xdf\xa3':
        return 'audio/webm'
    return None


async def check_upload(file: UploadFile, max_bytes: int = 10 * 1024 * 1024) -> bytes:
    """
    Read and validate an uploaded file. Returns the raw bytes on success.
    Raises HTTP 400/413 on violations.
    """
    check_filename(file.filename or "")

    content = await file.read()

    if len(content) == 0:
        raise HTTPException(status_code=400, detail="Empty file.")
    if len(content) > max_bytes:
        raise HTTPException(
            status_code=413,
            detail=f"File too large — max {max_bytes // (1024*1024)} MB.",
        )

    # Validate MIME type
    declared = (file.content_type or "").split(";")[0].strip().lower()
    detected = _detect_mime(content)

    if declared and declared not in _ALLOWED_MIME_TYPES:
        raise HTTPException(status_code=400, detail=f"File type '{declared}' not allowed.")

    if detected and declared and not _mime_compatible(detected, declared):
        raise HTTPException(
            status_code=400,
            detail="File content does not match declared type.",
        )

    # Null bytes in non-binary files
    import os
    ext = os.path.splitext(file.filename or "")[1].lower()
    if ext in {'.txt', '.md'} and b'\x00' in content:
        raise HTTPException(status_code=400, detail="Invalid file content.")

    # Heuristic malware scan
    scan_content(content, detected or declared)

    return content


def _mime_compatible(detected: str, declared: str) -> bool:
    """True if detected and declared MIME are compatible (both image/*, both audio/*, etc.)."""
    d_top = detected.split('/')[0]
    c_top = declared.split('/')[0]
    # Same category is fine; PDF is application/* — check explicitly
    if detected == declared:
        return True
    if d_top == c_top:
        return True
    if detected == 'application/pdf' and declared == 'application/pdf':
        return True
    return False


# ── Heuristic malware scan ────────────────────────────────────────────────────

# Malicious PDF indicators (Adobe spec attack vectors)
_PDF_MALWARE_PATTERNS: list[bytes] = [
    b'/JavaScript',
    b'/JS ',
    b'/JS\n',
    b'/JS\r',
    b'/Launch',
    b'/EmbeddedFile',
    b'/OpenAction',
    b'/AA ',          # Additional Actions
    b'/RichMedia',    # Flash embedding
    b'/XFA',          # XML Forms Architecture (exploited in CVEs)
    b'eval(',
    b'unescape(',
]

# Polyglot / EICAR-style markers
_GENERIC_MALWARE_BYTES: list[bytes] = [
    b'X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR',  # EICAR test string
    b'MZ\x90\x00',    # PE executable header embedded in non-exe
]


def scan_content(data: bytes, mime: str) -> None:
    """
    Heuristic malware scan.
    - PDFs: flag known exploit/shellcode indicators
    - All files: flag embedded PE headers and EICAR test string
    Raises HTTP 400 if suspicious content is detected.
    """
    # Generic checks for all file types
    for marker in _GENERIC_MALWARE_BYTES:
        if marker in data:
            raise HTTPException(status_code=400, detail="File contains disallowed content.")

    # PDF-specific deep scan
    if mime == 'application/pdf' or data[:4] == b'%PDF':
        for pattern in _PDF_MALWARE_PATTERNS:
            if pattern in data:
                raise HTTPException(
                    status_code=400,
                    detail="PDF contains disallowed content (active scripts or embedded files).",
                )
