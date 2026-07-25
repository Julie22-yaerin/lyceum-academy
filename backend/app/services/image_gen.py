"""
Image generation dispatcher — picks the best available backend.

Order:
  1. Cloudflare Workers AI (app.services.cloudflare_ai) when the account id
     and image token are configured. Fast, real quality, costs nothing local.
  2. The local CPU tiny-sd pipeline (app.services.local_image). Always
     available in principle, but genuinely slow (tens of seconds to minutes)
     and needs to have downloaded the model at least once.

Every caller in the product goes through here rather than importing a
specific backend, so switching providers is a config change instead of a
code change. Callers still get plain PNG/JPEG bytes either way.
"""

from __future__ import annotations

import logging

log = logging.getLogger("pclick.image_gen")


async def generate_illustration(
    full_prompt: str, negative_prompt: str = "", width: int = 512, height: int = 288,
) -> bytes:
    """Caller supplies the complete styled prompt. `width`/`height` only apply
    to the local fallback — Workers AI models use their own fixed output size."""
    from app.services import cloudflare_ai

    if cloudflare_ai.image_configured():
        try:
            return await cloudflare_ai.generate_image(full_prompt, negative_prompt)
        except Exception as exc:
            log.warning("Cloudflare image generation failed, falling back to local: %s", exc)

    from app.services import local_image
    return await local_image.generate_illustration(
        full_prompt, negative_prompt, width=width, height=height,
    )


async def generate_sprite(prompt: str, width: int = 384, height: int = 384) -> bytes:
    """2D-game-asset styled image (Game Builder). The style suffix is applied
    here so both backends produce the same look."""
    from app.services import cloudflare_ai

    styled = f"{prompt}, 2D game asset, pixel art style, simple flat background, game sprite"
    if cloudflare_ai.image_configured():
        try:
            return await cloudflare_ai.generate_image(styled)
        except Exception as exc:
            log.warning("Cloudflare sprite generation failed, falling back to local: %s", exc)

    from app.services import local_image
    return await local_image.generate_sprite(prompt, width=width, height=height)
