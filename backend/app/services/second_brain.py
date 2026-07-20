"""
Second Brain — the shared curriculum knowledge base for the whole Lyceum
AI system (231-note Obsidian vault: IGCSE/GCSE/A-Level/IB/AP, YAML
frontmatter + [[wikilinks]], at backend/data/second_brain/).

Ingestion does two independent things with each note:
  1. Chunks + embeds it into the existing RAG index (app.services.rag) —
     this is what /ai/chat already draws on via rag_svc.context_for(),
     so the AI now has real curriculum content instead of an empty index
     (reducing both re-reading raw files and reaching for external
     search — no new call sites needed on that side).
  2. Records it (and its wikilinks, resolved by title) as nodes/edges in
     a small SQLite graph, purely for the admin "Second Brain" graph view
     — this has nothing to do with retrieval.
"""

from __future__ import annotations

import os
import re
import sqlite3
from typing import Any

import yaml

from app.services import rag as rag_svc

_HERE = os.path.dirname(os.path.abspath(__file__))
VAULT_PATH = os.path.join(_HERE, "../../data/second_brain")
DB_PATH = os.path.join(_HERE, "../../finetune.db")

_WIKILINK_RE = re.compile(r"\[\[([^\]|#]+)")
_FRONTMATTER_RE = re.compile(r"^---\n(.*?)\n---\n?(.*)$", re.DOTALL)

_DDL = """
CREATE TABLE IF NOT EXISTS second_brain_nodes (
    id            TEXT PRIMARY KEY,
    title         TEXT NOT NULL DEFAULT '',
    subject       TEXT NOT NULL DEFAULT '',
    code          TEXT NOT NULL DEFAULT '',
    board         TEXT NOT NULL DEFAULT '',
    level         TEXT NOT NULL DEFAULT '',
    type          TEXT NOT NULL DEFAULT '',
    relative_path TEXT NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS second_brain_edges (
    from_id TEXT NOT NULL,
    to_id   TEXT NOT NULL,
    PRIMARY KEY (from_id, to_id)
);
"""


def _conn() -> sqlite3.Connection:
    c = sqlite3.connect(DB_PATH)
    c.row_factory = sqlite3.Row
    return c


def init_db() -> None:
    with _conn() as c:
        c.executescript(_DDL)


def _slug(relative_path: str) -> str:
    """Stable id derived from the note's path within the vault."""
    stem = relative_path.rsplit(".", 1)[0]
    slug = re.sub(r"[^a-z0-9]+", "-", stem.lower()).strip("-")
    return slug


def _parse_note(path: str, relative_path: str) -> dict[str, Any] | None:
    try:
        with open(path, "r", encoding="utf-8", errors="replace") as f:
            raw = f.read()
    except Exception:
        return None

    m = _FRONTMATTER_RE.match(raw)
    meta: dict[str, Any] = {}
    body = raw
    if m:
        try:
            meta = yaml.safe_load(m.group(1)) or {}
        except Exception:
            meta = {}
        body = m.group(2)

    file_stem = os.path.splitext(os.path.basename(path))[0]
    title = str(meta.get("title") or file_stem)
    tags = meta.get("tags") or []
    if not isinstance(tags, list):
        tags = [str(tags)]

    link_titles = sorted(set(_WIKILINK_RE.findall(body)))

    return {
        "id": _slug(relative_path),
        "file_stem": file_stem,
        "title": title,
        "subject": str(meta.get("subject") or ""),
        "code": str(meta.get("code") or ""),
        "board": str(meta.get("board") or ""),
        "level": str(meta.get("level") or ""),
        "type": str(meta.get("type") or ""),
        "tags": tags,
        "relative_path": relative_path,
        "body": body.strip(),
        "link_titles": link_titles,
    }


def _walk_vault() -> list[dict[str, Any]]:
    notes: list[dict[str, Any]] = []
    for root, dirs, files in os.walk(VAULT_PATH):
        dirs[:] = [d for d in dirs if not d.startswith(".")]
        for fname in files:
            if not fname.endswith(".md") or fname.startswith("."):
                continue
            path = os.path.join(root, fname)
            rel = os.path.relpath(path, VAULT_PATH)
            note = _parse_note(path, rel)
            if note:
                notes.append(note)
    return notes


def ingest_vault() -> dict[str, Any]:
    """Parse every note, index it into RAG, and rebuild the graph tables.
    Safe to re-run any time (upserts by id, graph tables are cleared and
    rebuilt fresh each call) — called both from the admin "Re-index"
    button and automatically at backend startup, since no persistent
    volume backs chroma_db/finetune.db on this service."""
    notes = _walk_vault()
    # Obsidian resolves [[wikilinks]] by filename, not by the frontmatter
    # `title` field (notes often use a shorter title than their filename,
    # e.g. file "Reaction Kinetics & Rates (9701).md" has title "Reaction
    # Kinetics & Rates" — links use the filename). Filename takes priority;
    # frontmatter title is kept only as a fallback alias.
    name_to_id: dict[str, str] = {}
    for n in notes:
        name_to_id.setdefault(n["file_stem"], n["id"])
    for n in notes:
        name_to_id.setdefault(n["title"], n["id"])

    chunks_indexed = 0
    edges = 0
    unresolved = 0

    with _conn() as c:
        c.executescript(_DDL)
        c.execute("DELETE FROM second_brain_nodes")
        c.execute("DELETE FROM second_brain_edges")

        for note in notes:
            meta = {
                "title": note["title"],
                "subject": note["subject"],
                "code": note["code"],
                "board": note["board"],
                "level": note["level"],
                "type": note["type"],
                "file_type": "md",
            }
            chunks_indexed += rag_svc.add_document(note["id"], note["body"], meta)

            c.execute(
                "INSERT OR REPLACE INTO second_brain_nodes "
                "(id, title, subject, code, board, level, type, relative_path) "
                "VALUES (?,?,?,?,?,?,?,?)",
                (
                    note["id"], note["title"], note["subject"], note["code"],
                    note["board"], note["level"], note["type"], note["relative_path"],
                ),
            )

            for link_title in note["link_titles"]:
                target_id = name_to_id.get(link_title)
                if not target_id or target_id == note["id"]:
                    if link_title != note["title"]:
                        unresolved += 1
                    continue
                c.execute(
                    "INSERT OR IGNORE INTO second_brain_edges (from_id, to_id) VALUES (?,?)",
                    (note["id"], target_id),
                )
                edges += 1

    return {
        "notes_indexed": len(notes),
        "chunks_indexed": chunks_indexed,
        "nodes": len(notes),
        "edges": edges,
        "unresolved_links": unresolved,
    }


def list_graph() -> dict[str, Any]:
    with _conn() as c:
        c.executescript(_DDL)
        nodes = [dict(r) for r in c.execute("SELECT * FROM second_brain_nodes").fetchall()]
        edges = [dict(r) for r in c.execute("SELECT * FROM second_brain_edges").fetchall()]
    return {"nodes": nodes, "edges": edges}


def add_custom_note(title: str, content: str, subject: str = "", uploader_uid: str = "") -> dict[str, Any]:
    """Second Brain customization (Settings → Customize Second Brain).

    The regular product flows no longer accept external documents; this is
    the one deliberate door left: write the material into the vault's
    custom/ folder and index it immediately, so exercises/notes generated
    from the Second Brain can draw on it.
    """
    title = (title or "Untitled").strip()[:120]
    safe_stem = re.sub(r"[^A-Za-z0-9 _-]+", "", title).strip() or "custom-note"
    rel = os.path.join("custom", f"{safe_stem}.md")
    path = os.path.join(VAULT_PATH, rel)
    os.makedirs(os.path.dirname(path), exist_ok=True)

    frontmatter = f"---\ntitle: {title}\nsubject: {subject}\ntype: custom\nuploaded_by: {uploader_uid}\n---\n"
    with open(path, "w", encoding="utf-8") as f:
        f.write(frontmatter + (content or ""))

    note = _parse_note(path, rel)
    if not note:
        return {"ok": False, "error": "parse_failed"}

    chunks = rag_svc.add_document(note["id"], note["body"], {
        "title": note["title"], "subject": note["subject"], "code": "",
        "board": "", "level": "", "type": "custom", "file_type": "md",
    })
    with _conn() as c:
        c.executescript(_DDL)
        c.execute(
            "INSERT OR REPLACE INTO second_brain_nodes "
            "(id, title, subject, code, board, level, type, relative_path) VALUES (?,?,?,?,?,?,?,?)",
            (note["id"], note["title"], note["subject"], "", "", "", "custom", rel),
        )
    return {"ok": True, "id": note["id"], "chunks_indexed": chunks}


def list_custom_notes() -> list[dict[str, Any]]:
    with _conn() as c:
        c.executescript(_DDL)
        rows = c.execute(
            "SELECT id, title, subject, relative_path FROM second_brain_nodes WHERE type='custom'"
        ).fetchall()
    return [dict(r) for r in rows]


def get_note(note_id: str) -> dict[str, Any] | None:
    with _conn() as c:
        row = c.execute("SELECT * FROM second_brain_nodes WHERE id = ?", (note_id,)).fetchone()
    if not row:
        return None
    node = dict(row)
    path = os.path.join(VAULT_PATH, node["relative_path"])
    parsed = _parse_note(path, node["relative_path"])
    if parsed:
        node["body"] = parsed["body"]
        node["tags"] = parsed["tags"]
    return node
