"""
Local CPU Image Generation — Playground Game-Asset Sprite Generator
════════════════════════════════════════════════════════════════════

No paid image API, no GPU — runs a small distilled Stable Diffusion model
("segmind/tiny-sd") on the backend server's own CPU. This is genuinely slow
(tens of seconds to a couple of minutes per image on a modest CPU box) —
callers must show an honest loading state, not a fast-spinner.

Two guards keep this from taking down a resource-constrained deployment:
  - The pipeline is lazy-loaded (only paid for in memory/load-time once the
    feature is actually used, not at app startup).
  - A process-wide semaphore serializes generations — running two diffusion
    inferences concurrently on a 2-4 core box would thrash and risk OOM, so
    requests queue instead of running in parallel.
"""

from __future__ import annotations

import asyncio
import io
import logging

log = logging.getLogger("pclick")

_MODEL_ID = "segmind/tiny-sd"
_MAX_WIDTH = 512
_MAX_HEIGHT = 512
_MAX_STEPS = 25

_pipeline = None
_gen_lock = asyncio.Semaphore(1)


def _load_pipeline():
    global _pipeline
    if _pipeline is not None:
        return _pipeline

    import torch
    from diffusers import StableDiffusionPipeline

    log.info("local_image: loading %s (CPU, first use — this can take a while)", _MODEL_ID)
    pipe = StableDiffusionPipeline.from_pretrained(
        _MODEL_ID, torch_dtype=torch.float32, safety_checker=None,
    )
    pipe.to("cpu")
    _pipeline = pipe
    log.info("local_image: pipeline ready")
    return _pipeline


def _run_generation(prompt: str, width: int, height: int, steps: int) -> bytes:
    pipe = _load_pipeline()
    styled_prompt = f"{prompt}, 2D game asset, pixel art style, simple flat background, game sprite"
    result = pipe(
        styled_prompt,
        width=width,
        height=height,
        num_inference_steps=steps,
        guidance_scale=7.0,
    )
    image = result.images[0]
    buf = io.BytesIO()
    image.save(buf, format="PNG")
    return buf.getvalue()


async def generate_sprite(prompt: str, width: int = 384, height: int = 384, steps: int = 18) -> bytes:
    """Returns PNG bytes for a 2D-game-asset-styled image generated from `prompt`."""
    width = min(max(width, 64), _MAX_WIDTH)
    height = min(max(height, 64), _MAX_HEIGHT)
    steps = min(max(steps, 4), _MAX_STEPS)

    async with _gen_lock:
        return await asyncio.to_thread(_run_generation, prompt, width, height, steps)
