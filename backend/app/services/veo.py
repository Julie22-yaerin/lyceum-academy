"""
Veo (Gemini API) — text-to-video generation.

Endpoint shape, all under one base:
    POST {BASE}/models/{model}:predictLongRunning?key=<api_key>
    body: {"instances": [{"prompt": "..."}],
           "parameters": {"aspectRatio": "9:16", "durationSeconds": 8,
                           "sampleCount": 1}}
    -> {"name": "models/{model}/operations/xxxx"}

    GET  {BASE}/{operation_name}?key=<api_key>
    -> {"done": false} while running, or
       {"done": true, "response": {...}} / {"done": true, "error": {...}}

The finished video is returned as a file URI under the operation's response
(`generateVideoResponse.generatedSamples[0].video.uri`); that URI itself needs
`?key=` appended to download, same as every other Gemini API call.

Confirmed empirically against the live API (2026-07-25):
  - duration must be 4-8 (inclusive) — there is no way to get a single clip
    past 8s. A 12-15s reel needs two generations concatenated, or one clip
    played forward-then-reversed (ping-pong) to double its length.
  - aspectRatio "9:16" is accepted (vertical, matches the reel format).
  - the key in use here has NO billing account attached and returns 429
    RESOURCE_EXHAUSTED with limit 0 — this is a hard "paid tier only" wall,
    not a transient rate limit. Nothing generates until billing is enabled
    on the Google Cloud project behind the key.

Raises on failure, same convention as cloudflare_ai.py — callers decide
whether/how to fall back.
"""

from __future__ import annotations

import asyncio
import logging

import httpx

from app.core.config import settings

log = logging.getLogger("pclick.veo")

_BASE = "https://generativelanguage.googleapis.com/v1beta"
_TIMEOUT = 60.0
_POLL_INTERVAL_S = 8.0
_POLL_TIMEOUT_S = 360.0  # Veo generations have taken several minutes in practice


def configured() -> bool:
    return bool(settings.veo_api_key)


class VeoQuotaError(RuntimeError):
    """Raised specifically for 429s so callers can tell 'no billing' apart
    from a real prompt/schema error instead of retrying a wall forever."""


async def _submit(prompt: str, *, aspect_ratio: str, duration_seconds: int, sample_count: int) -> str:
    if not configured():
        raise RuntimeError("Veo is not configured (VEO_API_KEY empty)")
    if not (4 <= duration_seconds <= 8):
        raise ValueError("durationSeconds must be between 4 and 8 inclusive")

    url = f"{_BASE}/models/{settings.veo_model}:predictLongRunning"
    body = {
        "instances": [{"prompt": prompt[:2000]}],
        "parameters": {
            "aspectRatio": aspect_ratio,
            "durationSeconds": duration_seconds,
            "sampleCount": sample_count,
        },
    }
    async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
        resp = await client.post(url, params={"key": settings.veo_api_key}, json=body)
    if resp.status_code == 429:
        raise VeoQuotaError(f"Veo quota exhausted: {resp.text[:300]}")
    if resp.status_code >= 400:
        raise RuntimeError(f"Veo submit failed: {resp.status_code} {resp.text[:300]}")
    name = resp.json().get("name")
    if not name:
        raise RuntimeError(f"Veo submit returned no operation name: {resp.text[:300]}")
    return name


async def _poll(operation_name: str) -> dict:
    """Polls until the operation is done. Returns the full operation body."""
    url = f"{_BASE}/{operation_name}"
    elapsed = 0.0
    async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
        while elapsed < _POLL_TIMEOUT_S:
            resp = await client.get(url, params={"key": settings.veo_api_key})
            if resp.status_code >= 400:
                raise RuntimeError(f"Veo poll failed: {resp.status_code} {resp.text[:300]}")
            op = resp.json()
            if op.get("done"):
                return op
            await asyncio.sleep(_POLL_INTERVAL_S)
            elapsed += _POLL_INTERVAL_S
    raise TimeoutError(f"Veo operation {operation_name} did not finish within {_POLL_TIMEOUT_S}s")


async def _download(file_uri: str) -> bytes:
    async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
        resp = await client.get(file_uri, params={"key": settings.veo_api_key})
    if resp.status_code >= 400:
        raise RuntimeError(f"Veo download failed: {resp.status_code} {resp.text[:300]}")
    return resp.content


async def generate_clip(
    prompt: str,
    *,
    aspect_ratio: str = "9:16",
    duration_seconds: int = 8,
) -> bytes:
    """
    Submits a Veo generation job, polls to completion, and returns the raw
    video bytes (mp4, with audio — callers that want a silent reel should
    strip the audio track themselves, e.g. `ffmpeg -an`).

    `prompt` should explicitly ask for no on-screen text: video models render
    embedded text and equations unreliably (worse for Vietnamese diacritics),
    which is why every caller in this codebase treats Veo output as
    background footage and draws its own captions/diagrams on top rather
    than trusting the model to render them.
    """
    op_name = await _submit(
        prompt, aspect_ratio=aspect_ratio, duration_seconds=duration_seconds, sample_count=1,
    )
    log.info("Veo job submitted: %s", op_name)
    op = await _poll(op_name)

    if op.get("error"):
        raise RuntimeError(f"Veo generation failed: {op['error']}")

    samples = (
        op.get("response", {})
        .get("generateVideoResponse", {})
        .get("generatedSamples", [])
    )
    if not samples:
        raise RuntimeError(f"Veo operation finished with no samples: {op}")

    uri = samples[0].get("video", {}).get("uri")
    if not uri:
        raise RuntimeError(f"Veo sample had no video uri: {samples[0]}")

    return await _download(uri)
