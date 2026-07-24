"""
One-time content seed — NOT a general pattern, just the delivery mechanism
for a single piece of requested content that has nowhere else to reach the
live database from (this repo has no direct production DB/deploy access;
`finetune.db` is gitignored and lives on the server's own volume). Runs
once at startup, guarded by a title/user check so redeploys never
duplicate it. Safe to delete this whole file (and its one call site in
app/main.py) once the post has landed for real.
"""

from __future__ import annotations

import base64
import logging
import os

log = logging.getLogger("pclick.seed_content")

_HERE = os.path.dirname(os.path.abspath(__file__))
_ASSETS = os.path.join(_HERE, "..", "data", "seed_content")

_TITLE = "Electron ở đâu quanh hạt nhân? (Atomic Orbitals — Hoá 9701)"
_SEEDED_FOR_USER = "huongnoiichuche@gmail.com"


def seed_atomic_orbitals_note() -> None:
    from app.services import library, user_brain

    try:
        with open(os.path.join(_ASSETS, "atomic_orbitals_note.txt"), encoding="utf-8") as f:
            body = f.read().strip()
        with open(os.path.join(_ASSETS, "atomic_orbitals.png"), "rb") as f:
            image_data_url = "data:image/png;base64," + base64.b64encode(f.read()).decode("ascii")
    except FileNotFoundError:
        return  # assets not present in this environment — nothing to seed

    if not library.find_post_by_title(_TITLE):
        library.create_post(
            uid="coach-ai", author_name="Coach — The Lyceum",
            title=_TITLE, body=body, post_type="blog", image_data_url=image_data_url,
        )
        log.info("seed_content: published Library post %r", _TITLE)

    existing = user_brain.list_notes(_SEEDED_FOR_USER)
    if not any(n.get("title") == _TITLE for n in existing):
        user_brain.add_note(
            user_key=_SEEDED_FOR_USER, title=_TITLE,
            content=body + "\n\n[Minh hoạ: xem bản đầy đủ có hình trong The Library trên web]",
            subject="Chemistry", source="admin",
        )
        log.info("seed_content: added Second Brain note for %s", _SEEDED_FOR_USER)
