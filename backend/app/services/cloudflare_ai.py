"""
Cloudflare Workers AI — image generation and text-to-speech.

Endpoint shape for every model:
    POST https://api.cloudflare.com/client/v4/accounts/{account_id}/ai/run/{model}
    Authorization: Bearer <api_token>

Two separate tokens are configured (see core.config) because the two
capabilities are used by different parts of the product and the founder
issued them separately: images for illustrations / exercise diagrams / quiz
art, TTS for narrating the podcast script Coach writes.

Response shapes differ per model and are not consistent across Cloudflare's
catalogue — some return raw binary, others a JSON envelope with base64 in
`result.image` / `result.audio`. `_extract_binary` handles both so swapping
`cloudflare_image_model` / `cloudflare_tts_model` in .env doesn't break the
caller.

Every function raises on failure rather than returning a placeholder; the
callers decide whether to fall back to their local path (tiny-sd for images,
browser speechSynthesis for audio).
"""

from __future__ import annotations

import base64
import binascii
import logging

import httpx

from app.core.config import settings

log = logging.getLogger("pclick.cloudflare_ai")

_BASE = "https://api.cloudflare.com/client/v4/accounts"
_TIMEOUT = 120.0


def image_configured() -> bool:
    return bool(settings.cloudflare_account_id and settings.cloudflare_image_token)


def tts_configured() -> bool:
    return bool(settings.cloudflare_account_id and settings.cloudflare_tts_token)


def _extract_binary(resp: httpx.Response, json_keys: tuple[str, ...]) -> bytes:
    """Pull media bytes out of a Workers AI response, whichever shape it used.

    Raw-binary models (SDXL variants) send the bytes directly. JSON models
    (flux-1-schnell, melotts) wrap base64 under result.<key>.
    """
    content_type = resp.headers.get("content-type", "")
    if "application/json" not in content_type:
        return resp.content

    payload = resp.json()
    if not payload.get("success", True):
        raise RuntimeError(f"Workers AI reported failure: {payload.get('errors')}")

    result = payload.get("result") or {}
    for key in json_keys:
        value = result.get(key)
        if isinstance(value, str) and value:
            try:
                return base64.b64decode(value)
            except (binascii.Error, ValueError) as exc:
                raise RuntimeError(f"result.{key} was not decodable base64") from exc
    raise RuntimeError(
        f"no media found in Workers AI response (looked for {json_keys} in result)"
    )


async def _run(model: str, token: str, payload: dict, json_keys: tuple[str, ...]) -> bytes:
    url = f"{_BASE}/{settings.cloudflare_account_id}/ai/run/{model}"
    async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
        resp = await client.post(
            url,
            headers={"Authorization": f"Bearer {token}"},
            json=payload,
        )
    if resp.status_code >= 400:
        # Body carries Cloudflare's own error detail; truncate so a long HTML
        # error page can't flood the logs.
        raise RuntimeError(f"Workers AI {model} failed: {resp.status_code} {resp.text[:300]}")
    return _extract_binary(resp, json_keys)


async def generate_image(prompt: str, negative_prompt: str = "") -> bytes:
    """Returns image bytes (PNG/JPEG depending on model) for `prompt`."""
    if not image_configured():
        raise RuntimeError("Cloudflare image generation is not configured")
    payload: dict = {"prompt": prompt[:2000]}
    if negative_prompt:
        payload["negative_prompt"] = negative_prompt[:2000]
    return await _run(
        settings.cloudflare_image_model, settings.cloudflare_image_token,
        payload, ("image",),
    )


async def text_to_speech(text: str, lang: str = "en") -> bytes:
    """Returns audio bytes (MP3) narrating `text`."""
    if not tts_configured():
        raise RuntimeError("Cloudflare text-to-speech is not configured")
    return await _run(
        settings.cloudflare_tts_model, settings.cloudflare_tts_token,
        {"prompt": text[:4000], "lang": lang}, ("audio",),
    )
