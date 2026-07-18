"""
Safety Guard — content intake gate (formerly half of commander.py).

Blocks harmful content BEFORE it enters the pipeline:
  - Profanity / offensive language
  - Virus / malware in uploads
  - Unauthorized file extensions

Powered by: nvidia/nemotron-3.5-content-safety

Not to be confused with:
  - app.services.safety_guard   — scans OUTGOING AI responses (final gate)
  - app.services.content_safety — prompt/upload size + type validation
This module is a third, distinct gate: user-submitted text/file INTAKE.
"""

from __future__ import annotations

import json
import re as _re
import time
from typing import Any

import httpx

from app.core.config import settings

NVIDIA_URL = "https://integrate.api.nvidia.com/v1/chat/completions"

# ── Content safety log ─────────────────────────────────────────────────────
_blocked_content: list[dict[str, Any]] = []
_MAX_BLOCKED = 300

# Profanity patterns (Vietnamese + English)
_PROFANITY_PATTERNS = [
    # English
    r'(?i)\b(f+u+c+k|s+h+i+t|a+s+s|h+e+l+l|d+a+m+n|b+i+t+c+h|d+i+c+k|c+r+a+p)\b',
    r'(?i)\b(bullshit|asshole|motherfucker|dumbass|jackass|bastard)\b',
    # Vietnamese (common offensive)
    r'(?i)\b(ch+ử+ [+f]+ụ+|đ+m+|l+ụ+|c+ặ+c|đ+i+ê+n|ch+ó+|l+ợ+n)\b',
    r'(?i)\b(cl+|đ*m|ocl|lol|dm|vc|cc|l+c)\b',
]
_PROFANITY_RE = [_re.compile(p) for p in _PROFANITY_PATTERNS]

# Dangerous file indicators in content
_DANGEROUS_CONTENT_MARKERS = [
    b'X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR',  # EICAR test
    b'MZ\x90\x00',   # PE header
    b'\x7fELF',      # ELF binary
    b'#!/bin/sh',     # Shell script
    b'#!/bin/bash',
    b'<script',       # XSS
    b'javascript:',   # JS URI
]


async def check_text_safety(text: str, context: str = "") -> dict[str, Any]:
    """
    AI-powered text safety check.
    Returns { safe: bool, reason: str, category: str }
    """
    if not text or not text.strip():
        return {"safe": True, "reason": "empty", "category": "none"}

    # Quick regex profanity check first (no API call needed)
    for pattern in _PROFANITY_RE:
        if pattern.search(text):
            return {
                "safe": False,
                "reason": "Content contains offensive language",
                "category": "profanity",
            }

    # AI deep check for subtle harmful content
    api_key = settings.content_guard_key or settings.nvidia_api_key
    model = settings.content_guard_model

    if not api_key:
        return {"safe": True, "reason": "no-api-key", "category": "none"}

    system = """You are a content safety classifier. Analyze the text and determine if it's safe.

Check for:
- Profanity, hate speech, harassment
- Harmful instructions (how to harm self/others)
- Inappropriate sexual content
- Discrimination / hate targeting groups
- Threats or intimidation

Return JSON:
{
  "safe": true/false,
  "category": "none|profanity|hate|harmful|sexual|discrimination|threat",
  "reason": "brief explanation if unsafe",
  "confidence": 0.0-1.0
}"""

    messages = [
        {"role": "system", "content": system},
        {"role": "user", "content": f"Check this text for safety:\n\n{text[:2000]}"},
    ]

    try:
        result = await _nvidia_call(api_key, model, messages, temperature=0.1, max_tokens=256)
        if not result.get("safe", True):
            _log_blocked("text", result.get("category", "unknown"), text[:200], context)
        return result
    except Exception:
        # If AI fails, let it through (fail-open for text, but log it)
        return {"safe": True, "reason": "ai-unavailable", "category": "none"}


def check_file_safety(filename: str, content: bytes, mime: str) -> dict[str, Any]:
    """
    Synchronous file safety check — virus/malware indicators.
    Returns { safe: bool, reason: str, category: str }
    """
    import os

    # Check extension
    ext = os.path.splitext(filename or "")[1].lower()
    dangerous_exts = {
        '.exe', '.dll', '.so', '.dylib', '.bat', '.cmd', '.sh', '.ps1',
        '.vbs', '.js', '.msi', '.app', '.dmg', '.pkg', '.deb', '.rpm',
        '.py', '.rb', '.php', '.pl', '.jar', '.class', '.elf',
        '.zip', '.tar', '.gz', '.rar', '.7z',
        '.html', '.htm', '.svg', '.xml',
        '.lnk', '.scr', '.pif',
    }
    if ext in dangerous_exts:
        _log_blocked("file", "unauthorized-extension", filename, "")
        return {
            "safe": False,
            "reason": f"File extension '{ext}' is not authorized",
            "category": "unauthorized-extension",
        }

    # Check for dangerous content markers
    for marker in _DANGEROUS_CONTENT_MARKERS:
        if marker in content[:4096]:
            _log_blocked("file", "malware-indicator", filename, f"Contains {marker[:20]}")
            return {
                "safe": False,
                "reason": "File contains potentially dangerous content",
                "category": "malware",
            }

    # Check for suspiciously large executables disguised as other types
    if mime and not mime.startswith(('image/', 'audio/', 'application/pdf', 'text/')):
        if len(content) > 1024 * 1024:  # >1MB non-standard type
            _log_blocked("file", "suspicious-upload", filename, f"MIME: {mime}, Size: {len(content)}")
            return {
                "safe": False,
                "reason": f"Unusual file type ({mime}) with large size",
                "category": "suspicious",
            }

    return {"safe": True, "reason": "passed", "category": "none"}


def _log_blocked(content_type: str, category: str, content_preview: str, context: str) -> None:
    """Log a blocked content event."""
    entry = {
        "content_type": content_type,
        "category": category,
        "preview": content_preview[:200],
        "context": context,
        "timestamp": time.time(),
    }
    _blocked_content.append(entry)
    if len(_blocked_content) > _MAX_BLOCKED:
        _blocked_content.pop(0)


def get_blocked_content(limit: int = 50) -> list[dict[str, Any]]:
    """Return recent blocked content for admin review."""
    return list(reversed(_blocked_content[-limit:]))


# ── Shared NVIDIA NIM call ─────────────────────────────────────────────────

async def _nvidia_call(
    api_key: str,
    model: str,
    messages: list[dict[str, str]],
    temperature: float = 0.1,
    max_tokens: int = 512,
) -> dict[str, Any]:
    """Call NVIDIA NIM and parse JSON response."""
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    }
    payload = {
        "model": model,
        "messages": messages,
        "temperature": temperature,
        "top_p": 0.95,
        "max_tokens": max_tokens,
        "stream": False,
    }

    async with httpx.AsyncClient(timeout=30.0) as client:
        resp = await client.post(NVIDIA_URL, headers=headers, json=payload)
        resp.raise_for_status()
        data = resp.json()

    choices = data.get("choices", [])
    if not choices:
        return {"error": "no choices"}

    raw = choices[0].get("message", {}).get("content", "")

    # Parse JSON, strip markdown fences if present
    text = raw.strip()
    if text.startswith("```"):
        lines = text.split("\n")
        start = 1 if lines[0].startswith("```") else 0
        end = -1 if lines[-1].strip() == "```" else len(lines)
        text = "\n".join(lines[start:end])

    try:
        return json.loads(text)
    except json.JSONDecodeError:
        return {"raw": raw[:1000], "_parse_error": True}
