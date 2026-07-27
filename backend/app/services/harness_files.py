"""
Harness file browser — lets an admin open and edit the skill/harness source
(lyceum-harness/, lyceum-orchestrator/) straight from the admin console,
instead of needing repo access.

Scope is deliberately narrow: two named roots, text files only, size-capped.
Every path is resolved and re-checked against the allowed roots before any
read or write — the admin UI sends a path, and a path is exactly the kind of
input that tries to walk out of its sandbox.
"""

from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

# repo_root/backend/app/services/harness_files.py -> repo_root
_REPO_ROOT = Path(__file__).resolve().parents[3]

ALLOWED_ROOTS: dict[str, Path] = {
    "lyceum-harness": _REPO_ROOT / "lyceum-harness",
    "lyceum-orchestrator": _REPO_ROOT / "lyceum-orchestrator",
}

# Directories never listed or descended into, wherever they appear.
_SKIP_DIRS = {"__pycache__", ".pytest_cache", ".git", "node_modules", ".venv", "venv", "site"}

# Extensions the editor will open. No dotfiles, no binaries.
_EDITABLE_EXT = {".py", ".md", ".toml", ".txt", ".json", ".cfg", ".ini", ".yaml", ".yml"}

MAX_FILE_BYTES = 2 * 1024 * 1024  # 2 MB — this is source code, not a data drop


class HarnessFileError(Exception):
    def __init__(self, message: str, status: int = 400):
        super().__init__(message)
        self.message = message
        self.status = status


@dataclass
class FileNode:
    path: str        # POSIX-style, relative to repo root, e.g. "lyceum-harness/harness/engines.py"
    name: str
    is_dir: bool
    size: int | None = None
    children: list["FileNode"] | None = None


def _resolve(rel_path: str) -> Path:
    """
    Resolve a client-supplied relative path and prove it stays inside one of
    ALLOWED_ROOTS. Raises rather than silently clamping — a path that needed
    clamping was already suspicious.
    """
    if not rel_path or rel_path.startswith("/") or ".." in Path(rel_path).parts:
        raise HarnessFileError("Invalid path", status=400)

    root_name = Path(rel_path).parts[0]
    root = ALLOWED_ROOTS.get(root_name)
    if root is None:
        raise HarnessFileError(f"Unknown root '{root_name}'", status=404)

    candidate = (_REPO_ROOT / rel_path).resolve()
    root_resolved = root.resolve()
    if candidate != root_resolved and root_resolved not in candidate.parents:
        raise HarnessFileError("Path escapes the allowed root", status=400)
    return candidate


def _build_tree(dir_path: Path, rel_prefix: str) -> list[FileNode]:
    nodes: list[FileNode] = []
    try:
        entries = sorted(dir_path.iterdir(), key=lambda p: (p.is_file(), p.name.lower()))
    except FileNotFoundError:
        return nodes

    for entry in entries:
        if entry.name.startswith("."):
            continue
        rel = f"{rel_prefix}/{entry.name}" if rel_prefix else entry.name
        if entry.is_dir():
            if entry.name in _SKIP_DIRS:
                continue
            nodes.append(FileNode(
                path=rel, name=entry.name, is_dir=True,
                children=_build_tree(entry, rel),
            ))
        elif entry.suffix in _EDITABLE_EXT:
            nodes.append(FileNode(
                path=rel, name=entry.name, is_dir=False,
                size=entry.stat().st_size,
            ))
    return nodes


def tree() -> list[FileNode]:
    """The two harness roots as one nested tree, editable files only."""
    return [
        FileNode(
            path=root_name, name=root_name, is_dir=True,
            children=_build_tree(root_path, root_name),
        )
        for root_name, root_path in ALLOWED_ROOTS.items()
    ]


def read_file(rel_path: str) -> str:
    full = _resolve(rel_path)
    if not full.is_file():
        raise HarnessFileError("Not a file", status=404)
    if full.suffix not in _EDITABLE_EXT:
        raise HarnessFileError("File type not editable here", status=400)
    if full.stat().st_size > MAX_FILE_BYTES:
        raise HarnessFileError("File too large to open in this editor", status=413)
    return full.read_text(encoding="utf-8", errors="replace")


def write_file(rel_path: str, content: str) -> int:
    full = _resolve(rel_path)
    if full.suffix not in _EDITABLE_EXT:
        raise HarnessFileError("File type not editable here", status=400)
    if len(content.encode("utf-8")) > MAX_FILE_BYTES:
        raise HarnessFileError("Content too large", status=413)
    if not full.parent.exists():
        raise HarnessFileError("Parent directory does not exist", status=404)
    full.write_text(content, encoding="utf-8")
    return full.stat().st_size
