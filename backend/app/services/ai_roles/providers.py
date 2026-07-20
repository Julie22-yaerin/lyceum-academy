"""
Shared HTTP helpers for model providers (Anthropic, OpenAI, Google, Groq).

These bypass the standard chat() cascade in ai.py — each premium role
wants a specific model for latency/quality reasons, not a failover chain.

Includes a unified `route_chat()` that dispatches to the right provider
based on a ModelSpec from tier_router.py.
"""

from __future__ import annotations

import json
import logging
from typing import Any, AsyncIterator

import httpx

from app.core.config import settings

log = logging.getLogger("pclick.ai_roles")


# ── Anthropic Messages API (Claude 3.5 Sonnet / Claude 3 Opus) ────────────────

async def anthropic_chat(
    messages: list[dict],
    *,
    model: str | None = None,
    system: str = "",
    temperature: float = 0.7,
    max_tokens: int = 4096,
    stream: bool = False,
) -> dict | AsyncIterator[str]:
    """
    Call Anthropic's Messages API (https://docs.anthropic.com/en/api/messages).

    If stream=True, returns an async iterator of SSE lines (caller must
    consume). If stream=False, returns the parsed JSON response dict.

    Anthropic format differs from OpenAI:
      - system is a top-level param, not a message role
      - messages are [{"role": "user"|"assistant", "content": "..."}]
      - no "system" role in messages array
    """
    if not settings.anthropic_api_key:
        raise RuntimeError("ANTHROPIC_API_KEY not configured")

    model = model or settings.anthropic_claude_sonnet_model
    url = f"{settings.anthropic_base_url}/messages"

    # Separate system from conversation messages
    conv_messages = [m for m in messages if m.get("role") != "system"]
    if not system:
        sys_msgs = [m for m in messages if m.get("role") == "system"]
        system = "\n\n".join(m.get("content", "") for m in sys_msgs)

    payload: dict[str, Any] = {
        "model": model,
        "messages": conv_messages,
        "max_tokens": max_tokens,
        "temperature": temperature,
    }
    if system:
        payload["system"] = system

    headers = {
        "x-api-key": settings.anthropic_api_key,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
    }

    if stream:
        payload["stream"] = True

    async with httpx.AsyncClient(timeout=120) as client:
        resp = await client.post(url, headers=headers, json=payload)
        resp.raise_for_status()

        if stream:
            return _iter_sse(resp)
        data = resp.json()
        _record_anthropic_usage(data, model)
        return data


async def _iter_sse(resp: httpx.Response) -> AsyncIterator[str]:
    """Yield SSE data lines from an Anthropic streaming response."""
    async for line in resp.aiter_lines():
        if line.startswith("data: "):
            yield line[6:]


def extract_anthropic_text(response: dict) -> str:
    """Pull assistant text from an Anthropic Messages API response."""
    content_blocks = response.get("content", [])
    parts = []
    for block in content_blocks:
        if block.get("type") == "text":
            parts.append(block.get("text", ""))
    return "\n".join(parts).strip()


def _record_anthropic_usage(data: dict, model: str) -> None:
    """Record token usage for Anthropic calls into the activity log."""
    usage = data.get("usage", {})
    try:
        from app.services.ai import _record_usage
        # Synthesize an OpenAI-style usage dict for the shared recorder
        synthetic = {
            "usage": {
                "prompt_tokens": usage.get("input_tokens", 0),
                "completion_tokens": usage.get("output_tokens", 0),
            },
            "model": model,
        }
        _record_usage("anthropic", synthetic, model=model)
    except Exception:
        pass


# ── OpenAI (o1, GPT-4o, GPT-4o-mini) ──────────────────────────────────────────

async def openai_chat(
    messages: list[dict],
    *,
    model: str = "gpt-4o",
    system: str = "",
    temperature: float = 0.7,
    max_tokens: int = 4096,
    api_key: str = "",
) -> dict:
    """
    Standard OpenAI chat completions call.
    Supports system messages, temperature, all non-o1 models.
    If api_key is provided, uses that key (for paid tier routing).
    """
    key = api_key or settings.openai_api_key
    if not key:
        raise RuntimeError("OPENAI_API_KEY not configured")

    full_messages = list(messages)
    if system:
        has_system = any(m.get("role") == "system" for m in full_messages)
        if not has_system:
            full_messages.insert(0, {"role": "system", "content": system})

    payload: dict[str, Any] = {
        "model": model,
        "messages": full_messages,
        "temperature": temperature,
        "max_tokens": max_tokens,
    }

    headers = {
        "Authorization": f"Bearer {key}",
        "Content-Type": "application/json",
    }

    async with httpx.AsyncClient(timeout=120) as client:
        resp = await client.post("https://api.openai.com/v1/chat/completions", headers=headers, json=payload)
        resp.raise_for_status()
        data = resp.json()
        _record_openai_usage(data, model)
        return data


async def openai_o1_chat(
    messages: list[dict],
    *,
    model: str = "",
    system: str = "",
    temperature: float = 1.0,
    max_tokens: int = 32768,
    api_key: str = "",
) -> dict:
    """
    Call OpenAI o1 or o1-mini for deep Chain-of-Thought reasoning.

    o1 does NOT support system messages or temperature — they are stripped.
    The system prompt is prepended to the first user message instead.
    If api_key is provided, uses that key (for paid tier routing).
    """
    key = api_key or settings.openai_api_key
    if not key:
        raise RuntimeError("OPENAI_API_KEY not configured")

    model = model or settings.openai_o1_model

    # o1 rejects system role and temperature — merge system into first user msg
    conv = [m for m in messages if m.get("role") != "system"]
    if system and conv and conv[0].get("role") == "user":
        conv[0] = {**conv[0], "content": system + "\n\n" + conv[0].get("content", "")}

    payload: dict[str, Any] = {
        "model": model,
        "messages": conv,
        "max_tokens": max_tokens,
    }

    headers = {
        "Authorization": f"Bearer {key}",
        "Content-Type": "application/json",
    }

    async with httpx.AsyncClient(timeout=300) as client:  # o1 can be slow
        resp = await client.post("https://api.openai.com/v1/chat/completions", headers=headers, json=payload)
        resp.raise_for_status()
        data = resp.json()
        _record_openai_usage(data, model)
        return data


def extract_openai_text(response: dict) -> str:
    """Pull assistant text from an OpenAI chat completions response."""
    try:
        return response["choices"][0]["message"]["content"] or ""
    except (KeyError, IndexError, TypeError):
        return ""


def _record_openai_usage(data: dict, model: str) -> None:
    """Record token usage for OpenAI calls into the activity log."""
    try:
        from app.services.ai import _record_usage
        _record_usage("openai", data, model=model)
    except Exception:
        pass


# ── Google Gemini 1.5 Pro (for Scientific Debate Partner) ─────────────────────

async def google_gemini_chat(
    messages: list[dict],
    *,
    model: str | None = None,
    system: str = "",
    temperature: float = 0.7,
    max_tokens: int = 8192,
    stream: bool = False,
) -> dict | AsyncIterator[str]:
    """
    Call Google Gemini 1.5 Pro via the OpenAI-compatible endpoint.
    Supports multimodal inputs (images via image_url content parts).
    """
    if not settings.google_api_key:
        raise RuntimeError("GOOGLE_API_KEY not configured")

    model = model or settings.google_gemini_pro_model
    url = "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions"

    # Prepend system to first user message if no system role support
    full_messages = list(messages)
    if system:
        # Google supports systemInstruction in some modes, but OpenAI-compat
        # handles system role messages natively
        has_system = any(m.get("role") == "system" for m in full_messages)
        if not has_system:
            full_messages.insert(0, {"role": "system", "content": system})

    payload: dict[str, Any] = {
        "model": model,
        "messages": full_messages,
        "temperature": temperature,
        "max_tokens": max_tokens,
        "stream": stream,
    }

    headers = {
        "Authorization": f"Bearer {settings.google_api_key}",
        "Content-Type": "application/json",
    }

    async with httpx.AsyncClient(timeout=120) as client:
        resp = await client.post(url, headers=headers, json=payload)
        resp.raise_for_status()

        if stream:
            return _iter_sse(resp)
        data = resp.json()
        _record_google_usage(data, model)
        return data


def extract_google_text(response: dict) -> str:
    """Pull assistant text from a Google Gemini OpenAI-compat response."""
    try:
        return response["choices"][0]["message"]["content"] or ""
    except (KeyError, IndexError, TypeError):
        return ""


def _record_google_usage(data: dict, model: str) -> None:
    try:
        from app.services.ai import _record_usage
        _record_usage("google", data, model=model)
    except Exception:
        pass


# ── Unified route_chat() — dispatches to the right provider ──────────────────

def extract_text(response: dict, provider: str = "") -> str:
    """Universal text extractor — works for any provider's response format."""
    # Ollama format
    content = (response.get("message") or {}).get("content", "")
    if content:
        return content
    # OpenAI / Google / Anthropic format
    try:
        return response["choices"][0]["message"]["content"] or ""
    except (KeyError, IndexError, TypeError):
        pass
    # Anthropic format
    for block in response.get("content", []):
        if block.get("type") == "text":
            return block.get("text", "")
    return ""


async def route_chat(
    messages: list[dict],
    *,
    provider: str,
    model: str,
    system: str = "",
    temperature: float = 0.7,
    max_tokens: int = 4096,
    api_key: str = "",
) -> tuple[dict, str]:
    """
    Unified chat dispatch. Routes to the right provider based on ModelSpec.

    If api_key is provided, it's used for OpenAI calls (paid tier routing).
    Returns (raw_response_dict, extracted_text).
    """
    if provider == "anthropic":
        data = await anthropic_chat(
            messages, model=model, system=system,
            temperature=temperature, max_tokens=max_tokens,
        )
        return data, extract_anthropic_text(data)

    elif provider == "openai":
        if model.startswith("o1"):
            data = await openai_o1_chat(
                messages, model=model, system=system,
                max_tokens=max_tokens, api_key=api_key,
            )
        else:
            data = await openai_chat(
                messages, model=model, system=system,
                temperature=temperature, max_tokens=max_tokens,
                api_key=api_key,
            )
        return data, extract_text(data)

    elif provider == "google":
        data = await google_gemini_chat(
            messages, model=model, system=system,
            temperature=temperature, max_tokens=max_tokens,
        )
        return data, extract_text(data)

    elif provider == "groq":
        from app.services.ai import _groq_call, extract_text as _ai_extract
        guarded = messages
        if system:
            guarded = [{"role": "system", "content": system}] + [m for m in messages if m.get("role") != "system"]
        data = await _groq_call(guarded, model, temperature, max_tokens)
        return data, _ai_extract(data)

    elif provider == "ollama":
        from app.services.ai import _ollama_call, extract_text as _ai_extract
        guarded = messages
        if system:
            guarded = [{"role": "system", "content": system}] + [m for m in messages if m.get("role") != "system"]
        data = await _ollama_call(guarded, model, temperature, max_tokens)
        return data, _ai_extract(data)

    else:
        raise ValueError(f"Unknown provider: {provider}")
