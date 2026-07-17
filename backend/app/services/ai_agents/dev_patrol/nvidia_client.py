"""
Shared NVIDIA NIM API client for Dev Patrol agents.

Each agent gets its own key + model pair. All calls go through the
same base URL but with different Authorization headers.
"""

from __future__ import annotations

import json
import logging
from typing import Any

import httpx

from app.core.config import settings

logger = logging.getLogger(__name__)

NVIDIA_BASE_URL = "https://integrate.api.nvidia.com/v1/chat/completions"


async def nvidia_completion(
    *,
    api_key: str,
    model: str,
    messages: list[dict[str, str]],
    temperature: float = 0.3,
    max_tokens: int = 4096,
    timeout: float = 120.0,
) -> str:
    """
    Call an NVIDIA NIM chat completion endpoint.
    Returns the assistant's text response.
    """
    if not api_key:
        raise ValueError(f"NVIDIA NIM API key not configured for model {model}")

    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    }
    payload = {
        "model": model,
        "messages": messages,
        "temperature": temperature,
        "top_p": 0.95,
        "max_tokens": max_tokens,
        "stream": False,
    }

    async with httpx.AsyncClient(timeout=timeout) as client:
        resp = await client.post(NVIDIA_BASE_URL, headers=headers, json=payload)
        resp.raise_for_status()
        data = resp.json()

    choices = data.get("choices", [])
    if not choices:
        raise ValueError(f"No choices returned from {model}")

    return choices[0].get("message", {}).get("content", "")


async def nvidia_completion_json(
    *,
    api_key: str,
    model: str,
    messages: list[dict[str, str]],
    temperature: float = 0.2,
    max_tokens: int = 4096,
) -> dict[str, Any]:
    """
    Call NVIDIA NIM and parse the response as JSON.
    Strips markdown fences if present.
    """
    raw = await nvidia_completion(
        api_key=api_key,
        model=model,
        messages=messages,
        temperature=temperature,
        max_tokens=max_tokens,
    )

    # Strip markdown code fences
    text = raw.strip()
    if text.startswith("```"):
        lines = text.split("\n")
        # Remove first and last fence lines
        start = 1 if lines[0].startswith("```") else 0
        end = -1 if lines[-1].strip() == "```" else len(lines)
        text = "\n".join(lines[start:end])

    try:
        return json.loads(text)
    except json.JSONDecodeError:
        return {"raw_response": raw[:2000], "_parse_error": True}
