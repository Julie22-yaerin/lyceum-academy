#!/usr/bin/env python3
"""
Generate one Veo background clip per subject and composite it under the
existing canvas captions/diagrams, replacing the flat gradient background in
tools/reels/scene.html with real generated footage.

WHY THIS IS SEPARATE FROM app.services.veo:
This runs standalone (no FastAPI app, no DB) so it can be pointed at
backend/.env directly and run as a one-shot CLI. It duplicates the small
submit/poll/download dance rather than importing the backend package, to
avoid dragging in the whole app's settings/DB wiring for a script that runs
maybe four times ever.

Usage:
    python3 tools/reels/veo_backgrounds.py            # all four subjects
    python3 tools/reels/veo_backgrounds.py math        # just one

Requires VEO_API_KEY in backend/.env (or the environment) with a Google
Cloud project that has billing enabled — the free tier's quota for Veo is 0
requests, so this fails with a 429 until billing is on. Each clip costs real
money once it *can* run: 1 subject = 1 generation, matching "first tạo 1
video/môn" — do not loop this into a batch of variations.

Output: tools/reels/veo/<subject>.mp4 (raw Veo footage, ~8s, with whatever
ambient audio Veo generated). Compositing that under the existing captions
is a second, separate step (see composite_veo.mjs next to this file) so a
failed/ugly generation for one subject doesn't force redoing the others.
"""
from __future__ import annotations

import json
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

HERE = Path(__file__).resolve().parent
ENV_FILE = HERE.parent.parent / "backend" / ".env"
OUT_DIR = HERE / "veo"
BASE = "https://generativelanguage.googleapis.com/v1beta"
POLL_INTERVAL_S = 8
POLL_TIMEOUT_S = 360

# Cinematic, mood-only prompts — deliberately free of equations, numbers, or
# any Vietnamese caption text, because video models render on-screen text
# unreliably (worse for combining diacritics). These clips are meant to be a
# background layer; scene.html still draws every word and diagram itself.
PROMPTS = {
    "math": (
        "Extreme close-up cinematic shot of a glowing violet mathematical "
        "spiral and abstract geometric shapes slowly rotating in dark space, "
        "soft purple and pink volumetric light, fine particles drifting, "
        "elegant slow camera drift, moody atmospheric lighting, shallow depth "
        "of field, high production value, vertical portrait framing. No "
        "text, no words, no numbers, no writing, no subtitles, no logos "
        "anywhere in the frame."
    ),
    "chemistry": (
        "Cinematic macro shot of a glowing cyan electron cloud swirling "
        "around a bright atomic nucleus suspended in dark space, soft "
        "particles orbiting, teal and turquoise volumetric light, slow "
        "elegant camera drift, moody atmosphere, shallow depth of field, "
        "high production value, vertical portrait framing. No text, no "
        "words, no numbers, no writing, no subtitles, no logos anywhere in "
        "the frame."
    ),
    "biology": (
        "Cinematic extreme close-up of a glowing emerald-green neuron firing "
        "an electrical pulse along its axon in darkness, bioluminescent "
        "light traveling like a spark through branching filaments, soft "
        "depth of field, slow elegant camera drift, moody atmosphere, high "
        "production value, vertical portrait framing. No text, no words, no "
        "numbers, no writing, no subtitles, no logos anywhere in the frame."
    ),
    "physics": (
        "Cinematic shot of a golden pendulum swinging in slow motion in a "
        "dark moody room, warm amber volumetric light beams, dust particles "
        "floating in the light, elegant slow camera drift, shallow depth of "
        "field, high production value, vertical portrait framing. No text, "
        "no words, no numbers, no writing, no subtitles, no logos anywhere "
        "in the frame."
    ),
}


def load_env(path: Path) -> dict:
    out = {}
    if not path.exists():
        return out
    for line in path.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, v = line.split("=", 1)
        out[k.strip()] = v.strip()
    return out


def api_key() -> str:
    return os.environ.get("VEO_API_KEY") or load_env(ENV_FILE).get("VEO_API_KEY", "")


def model() -> str:
    return os.environ.get("VEO_MODEL") or load_env(ENV_FILE).get("VEO_MODEL", "veo-3.1-fast-generate-preview")


def _post(url: str, params: dict, body: dict) -> dict:
    full = url + "?" + urllib.parse.urlencode(params)
    req = urllib.request.Request(
        full, data=json.dumps(body).encode(), headers={"Content-Type": "application/json"}, method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            return json.loads(r.read())
    except urllib.error.HTTPError as e:
        raise RuntimeError(f"POST {url} -> {e.code}: {e.read().decode()[:400]}") from None


def _get(url: str, params: dict) -> tuple[dict, bytes]:
    full = url + "?" + urllib.parse.urlencode(params)
    req = urllib.request.Request(full, method="GET")
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            raw = r.read()
            ctype = r.headers.get("content-type", "")
    except urllib.error.HTTPError as e:
        raise RuntimeError(f"GET {url} -> {e.code}: {e.read().decode()[:400]}") from None
    if "json" in ctype:
        return json.loads(raw), b""
    return {}, raw


def generate_one(subject: str, key: str) -> Path:
    prompt = PROMPTS[subject]
    body = {
        "instances": [{"prompt": prompt}],
        "parameters": {"aspectRatio": "9:16", "durationSeconds": 8, "sampleCount": 1},
    }
    print(f"[{subject}] submitting…")
    op = _post(f"{BASE}/models/{model()}:predictLongRunning", {"key": key}, body)
    name = op.get("name")
    if not name:
        raise RuntimeError(f"[{subject}] no operation name in response: {op}")

    print(f"[{subject}] polling {name} …")
    elapsed = 0
    while elapsed < POLL_TIMEOUT_S:
        op, _ = _get(f"{BASE}/{name}", {"key": key})
        if op.get("done"):
            break
        time.sleep(POLL_INTERVAL_S)
        elapsed += POLL_INTERVAL_S
        print(f"[{subject}]   …{elapsed}s")
    else:
        raise TimeoutError(f"[{subject}] operation did not finish within {POLL_TIMEOUT_S}s")

    if op.get("error"):
        raise RuntimeError(f"[{subject}] generation failed: {op['error']}")

    samples = op.get("response", {}).get("generateVideoResponse", {}).get("generatedSamples", [])
    if not samples:
        raise RuntimeError(f"[{subject}] no samples in finished operation: {op}")
    uri = samples[0].get("video", {}).get("uri")
    if not uri:
        raise RuntimeError(f"[{subject}] sample had no video uri: {samples[0]}")

    print(f"[{subject}] downloading…")
    _, raw = _get(uri, {"key": key})
    if not raw:
        raise RuntimeError(f"[{subject}] download returned no bytes (was it JSON instead?)")

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    out_path = OUT_DIR / f"{subject}.mp4"
    out_path.write_bytes(raw)
    print(f"[{subject}] -> {out_path} ({len(raw)} bytes)")
    return out_path


def main():
    key = api_key()
    if not key:
        print("VEO_API_KEY not set (env or backend/.env) — nothing to do.", file=sys.stderr)
        sys.exit(1)

    wanted = sys.argv[1:] or list(PROMPTS)
    unknown = [s for s in wanted if s not in PROMPTS]
    if unknown:
        print(f"unknown subject(s): {unknown} — choose from {list(PROMPTS)}", file=sys.stderr)
        sys.exit(1)

    failures = []
    for subject in wanted:
        try:
            generate_one(subject, key)
        except Exception as exc:  # noqa: BLE001 — report and keep going
            print(f"[{subject}] FAILED: {exc}", file=sys.stderr)
            failures.append(subject)

    if failures:
        print(f"\n{len(failures)}/{len(wanted)} failed: {failures}", file=sys.stderr)
        sys.exit(1)
    print(f"\nAll {len(wanted)} clip(s) generated. Next: composite_veo.mjs to merge them under captions.")


if __name__ == "__main__":
    main()
