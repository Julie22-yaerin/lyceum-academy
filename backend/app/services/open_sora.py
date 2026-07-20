"""
Open-Sora client — talks to a locally running Open-Sora inference server.

The Lyceum ships with Open-Sora running on the same machine (or LAN box) as
an HTTP service; this module is the only place that knows how to reach it.
Point OPEN_SORA_URL at the server (default http://127.0.0.1:8800). Two API
shapes are supported, in order:

  1. Native REST:  POST {base}/v1/video/generations
                   {"prompt": ..., "num_frames": ..., "resolution": ...}
                   → {"video": "<base64 mp4>"} or {"url": "..."}
  2. Gradio API:   POST {base}/api/predict {"data": [prompt]}
                   → {"data": [{"video": ...}]}

Generation is slow (minutes on CPU/small GPUs), so requests are serialized
with a semaphore and given a generous timeout — the caller must show an
honest progress state, same rule as local_image.py.
"""

from __future__ import annotations

import asyncio
import base64
import os
from typing import Any

import httpx

OPEN_SORA_URL = os.getenv("OPEN_SORA_URL", "http://127.0.0.1:8800").rstrip("/")
_TIMEOUT = float(os.getenv("OPEN_SORA_TIMEOUT_SECONDS", "600"))
_gen_lock = asyncio.Semaphore(1)


async def is_available() -> bool:
    try:
        async with httpx.AsyncClient(timeout=3) as client:
            r = await client.get(f"{OPEN_SORA_URL}/health")
            return r.status_code < 500
    except Exception:
        return False


async def generate_video(prompt: str, num_frames: int = 48, resolution: str = "360p") -> dict[str, Any]:
    """Returns {"video_base64": ...} or {"video_url": ...}. Raises RuntimeError
    with a user-showable message when the local server isn't reachable."""
    prompt = (prompt or "").strip()
    if not prompt:
        raise RuntimeError("Prompt is empty.")

    async with _gen_lock:
        async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
            # 1) Native REST shape
            try:
                r = await client.post(
                    f"{OPEN_SORA_URL}/v1/video/generations",
                    json={"prompt": prompt, "num_frames": num_frames, "resolution": resolution},
                )
                if r.status_code == 200:
                    data = r.json()
                    if data.get("video"):
                        return {"video_base64": data["video"]}
                    if data.get("url"):
                        return {"video_url": data["url"]}
            except httpx.HTTPError:
                pass

            # 2) Gradio fallback shape
            try:
                r = await client.post(f"{OPEN_SORA_URL}/api/predict", json={"data": [prompt]})
                if r.status_code == 200:
                    data = r.json().get("data") or []
                    if data:
                        item = data[0]
                        if isinstance(item, dict) and item.get("video"):
                            return {"video_url": f"{OPEN_SORA_URL}/file={item['video']}"}
                        if isinstance(item, str):
                            if os.path.exists(item):
                                with open(item, "rb") as f:
                                    return {"video_base64": base64.b64encode(f.read()).decode()}
                            return {"video_url": item}
            except httpx.HTTPError:
                pass

    raise RuntimeError(
        "Open-Sora local server is not reachable. Start it and set OPEN_SORA_URL "
        f"(currently {OPEN_SORA_URL})."
    )
