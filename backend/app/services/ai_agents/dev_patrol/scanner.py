"""
Code scanner utilities for Dev Patrol agents.

Reads actual source files from the codebase and prepares them
for AI analysis. Supports Python, TypeScript, and JSON config files.
"""

from __future__ import annotations

import os
import pathlib
from typing import Any

# Project root (3 levels up from this file: backend/app/services/ai_agents/dev_patrol/)
_PROJECT_ROOT = pathlib.Path(__file__).resolve().parents[5]
_BACKEND_ROOT = _PROJECT_ROOT / "backend"
_FRONTEND_ROOT = _PROJECT_ROOT / "the-lyceum-academy" / "src"
_SERVER_ROOT = _PROJECT_ROOT

# Max file size to send to AI (avoid huge files blowing token limits)
_MAX_FILE_BYTES = 32_000  # ~8k tokens
_MAX_TOTAL_BYTES = 80_000  # total budget for all files combined


def _read_file(path: pathlib.Path, max_bytes: int = _MAX_FILE_BYTES) -> str | None:
    """Read a text file, truncating if too large. Returns None on error."""
    try:
        if not path.exists() or not path.is_file():
            return None
        size = path.stat().st_size
        if size == 0:
            return None
        with open(path, "r", encoding="utf-8", errors="replace") as f:
            content = f.read(max_bytes)
        if size > max_bytes:
            content += f"\n... [truncated at {max_bytes} bytes, total {size}]"
        return content
    except Exception:
        return None


def scan_backend_files(patterns: list[str] | None = None) -> list[dict[str, Any]]:
    """
    Scan backend Python files.
    Returns list of {path, relative_path, content, size}.
    """
    if patterns is None:
        patterns = ["*.py"]

    results: list[dict[str, Any]] = []
    total_bytes = 0

    # Key directories to scan
    scan_dirs = [
        _BACKEND_ROOT / "app" / "routers",
        _BACKEND_ROOT / "app" / "services",
        _BACKEND_ROOT / "app" / "core",
        _BACKEND_ROOT / "app" / "api",
    ]

    for scan_dir in scan_dirs:
        if not scan_dir.exists():
            continue
        for pattern in patterns:
            for path in sorted(scan_dir.rglob(pattern)):
                # Skip __pycache__
                if "__pycache__" in str(path):
                    continue
                if total_bytes >= _MAX_TOTAL_BYTES:
                    break

                content = _read_file(path)
                if content is None:
                    continue

                results.append({
                    "path": str(path),
                    "relative_path": str(path.relative_to(_PROJECT_ROOT)),
                    "content": content,
                    "size": len(content.encode("utf-8")),
                })
                total_bytes += len(content.encode("utf-8"))

    return results


def scan_frontend_files(patterns: list[str] | None = None) -> list[dict[str, Any]]:
    """
    Scan frontend TypeScript/React files.
    Returns list of {path, relative_path, content, size}.
    """
    if patterns is None:
        patterns = ["*.ts", "*.tsx"]

    results: list[dict[str, Any]] = []
    total_bytes = 0

    if not _FRONTEND_ROOT.exists():
        return results

    for pattern in patterns:
        for path in sorted(_FRONTEND_ROOT.rglob(pattern)):
            if total_bytes >= _MAX_TOTAL_BYTES:
                break

            content = _read_file(path)
            if content is None:
                continue

            results.append({
                "path": str(path),
                "relative_path": str(path.relative_to(_PROJECT_ROOT)),
                "content": content,
                "size": len(content.encode("utf-8")),
            })
            total_bytes += len(content.encode("utf-8"))

    return results


def scan_config_files() -> list[dict[str, Any]]:
    """Scan key config files (main.py, config.py, package.json, vite.config)."""
    config_paths = [
        _BACKEND_ROOT / "app" / "main.py",
        _BACKEND_ROOT / "app" / "core" / "config.py",
        _PROJECT_ROOT / "the-lyceum-academy" / "package.json",
        _PROJECT_ROOT / "the-lyceum-academy" / "vite.config.ts",
    ]

    results: list[dict[str, Any]] = []
    for path in config_paths:
        content = _read_file(path)
        if content:
            results.append({
                "path": str(path),
                "relative_path": str(path.relative_to(_PROJECT_ROOT)),
                "content": content,
                "size": len(content.encode("utf-8")),
            })
    return results


def scan_single_file(file_path: str) -> dict[str, Any] | None:
    """Scan a single file by absolute or relative path."""
    path = pathlib.Path(file_path)
    if not path.is_absolute():
        path = _PROJECT_ROOT / file_path

    content = _read_file(path, max_bytes=_MAX_FILE_BYTES * 2)
    if content is None:
        return None

    return {
        "path": str(path),
        "relative_path": str(path.relative_to(_PROJECT_ROOT)) if path.is_relative_to(_PROJECT_ROOT) else str(path),
        "content": content,
        "size": len(content.encode("utf-8")),
    }


def format_files_for_prompt(files: list[dict[str, Any]], max_chars: int = 60000) -> str:
    """Format scanned files into a single string for the AI prompt."""
    parts: list[str] = []
    total = 0

    for f in files:
        header = f"=== FILE: {f['relative_path']} ({f['size']} bytes) ==="
        body = f["content"]
        chunk = header + "\n" + body + "\n"

        if total + len(chunk) > max_chars:
            remaining = max_chars - total
            if remaining > 200:
                parts.append(chunk[:remaining] + "\n... [truncated]")
            break

        parts.append(chunk)
        total += len(chunk)

    return "\n".join(parts)
