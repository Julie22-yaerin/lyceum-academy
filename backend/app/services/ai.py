"""
AI service — OpenRouter primary, Ollama Cloud fallback.

OpenRouter: https://openrouter.ai/api/v1  (OpenAI-compatible)
Ollama Cloud: https://ollama.com/api/chat  (Ollama native format)
"""

from __future__ import annotations

import httpx
import random
import re as _re
from typing import Any

from app.core.config import settings
from app.services import rag as _rag
from app.services import wolfram as _wolfram
from app.services.privacy_guard import with_privacy_guard

# ── Groq ──────────────────────────────────────────────────────────────────────
GROQ_CHAT_URL = "https://api.groq.com/openai/v1/chat/completions"

# ── OpenAI ────────────────────────────────────────────────────────────────────
OPENAI_CHAT_URL = "https://api.openai.com/v1/chat/completions"

# ── Google AI Studio (OpenAI-compatible endpoint) ─────────────────────────────
GOOGLE_CHAT_URL = "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions"

# ── OpenRouter ────────────────────────────────────────────────────────────────
OPENROUTER_CHAT_URL = "https://openrouter.ai/api/v1/chat/completions"

# ── Ollama Cloud ──────────────────────────────────────────────────────────────
# Ollama Cloud uses /api/chat (native), NOT /v1/chat/completions (OpenAI compat)
OLLAMA_CHAT_URL = f"{settings.ollama_cloud_url}/api/chat"

# ── Provider selection ────────────────────────────────────────────────────────

def _use_openai() -> bool:
    return bool(settings.openai_api_key)

def _use_groq() -> bool:
    return bool(settings.groq_api_key)

def _use_google() -> bool:
    return bool(settings.google_api_key)

def _use_nvidia() -> bool:
    return bool(settings.nvidia_api_key)

def _use_openrouter() -> bool:
    return bool(settings.openrouter_api_key)

def _use_ollama() -> bool:
    """True when at least one Ollama Cloud key is configured."""
    return bool(settings.ollama_keys)

def _pick_ollama_key() -> str:
    """Pick a random Ollama key from the pool for load distribution."""
    return random.choice(settings.ollama_keys)


# ── Token usage tracking ───────────────────────────────────────────────────────

_session_usage: dict[str, dict[str, int]] = {
    "groq":       {"prompt": 0, "completion": 0, "requests": 0},
    "google":     {"prompt": 0, "completion": 0, "requests": 0},
    "nvidia":     {"prompt": 0, "completion": 0, "requests": 0},
    "openai":     {"prompt": 0, "completion": 0, "requests": 0},
    "openrouter": {"prompt": 0, "completion": 0, "requests": 0},
    "ollama":     {"prompt": 0, "completion": 0, "requests": 0},
}

import contextvars

# Tags every AI provider call with the name of the public task function that
# triggered it, for the admin activity log. A contextvar (not call-stack
# introspection) because node_summary() and others fan out via
# asyncio.gather() — each gathered coroutine runs as its own Task, which
# decouples the Python call stack from the logical caller. contextvars are
# copied into each new Task at creation time, so they survive gather/
# create_task correctly (verified) where stack-walking does not.
_current_ai_task: contextvars.ContextVar[str] = contextvars.ContextVar("current_ai_task", default="unknown")


def _tag_task(fn):
    """Decorator for every public task-level function in this module — sets
    the current-task tag for the duration of the call (and everything it
    fans out to), so _record_usage can attribute the AI call correctly."""
    import functools

    @functools.wraps(fn)
    async def wrapper(*args, **kwargs):
        _current_ai_task.set(fn.__name__)
        return await fn(*args, **kwargs)
    return wrapper


def _record_usage(provider: str, resp: dict, model: str = "") -> None:
    """Accumulate token counts from an API response into _session_usage,
    and persist a row to the admin activity log (best-effort).

    `model` should be the model name that was actually REQUESTED — not
    every provider's response reliably echoes it back (confirmed: NVIDIA's
    OpenAI-compatible response omits it), so callers that know the model
    they asked for should pass it explicitly.
    """
    usage = resp.get("usage") or {}
    prompt_tokens = usage.get("prompt_tokens", 0)
    completion_tokens = usage.get("completion_tokens", 0)
    if provider in _session_usage:
        _session_usage[provider]["prompt"]     += prompt_tokens
        _session_usage[provider]["completion"] += completion_tokens
        _session_usage[provider]["requests"]   += 1
    try:
        from app.services import activity_log
        activity_log.record(
            provider=provider,
            task=_current_ai_task.get(),
            model=model or str(resp.get("model") or resp.get("modelVersion") or ""),
            prompt_tokens=prompt_tokens,
            completion_tokens=completion_tokens,
        )
    except Exception:
        pass  # the activity log must never break an actual AI call

def get_session_usage() -> dict:
    """Return a summary of token usage this process lifetime."""
    total_p = sum(v["prompt"]     for v in _session_usage.values())
    total_c = sum(v["completion"] for v in _session_usage.values())
    total_r = sum(v["requests"]   for v in _session_usage.values())
    return {
        "by_provider": _session_usage,
        "total": {"prompt": total_p, "completion": total_c,
                  "total_tokens": total_p + total_c, "requests": total_r},
    }


# ── Core chat helpers ─────────────────────────────────────────────────────────

def _to_ollama_messages(messages: list[dict]) -> list[dict]:
    """
    Convert OpenAI-style messages (content as list with image_url items)
    to Ollama /api/chat format (content as str, images as list[base64]).
    Plain-text messages (content = str) pass through unchanged.
    """
    result = []
    for msg in messages:
        content = msg.get("content", "")
        if isinstance(content, list):
            texts: list[str] = []
            images: list[str] = []
            for part in content:
                if not isinstance(part, dict):
                    continue
                if part.get("type") == "text":
                    texts.append(part.get("text", ""))
                elif part.get("type") == "image_url":
                    url = (part.get("image_url") or {}).get("url", "")
                    # Strip data URI prefix → bare base64
                    m = _re.match(r"data:[^;]+;base64,(.+)", url, _re.DOTALL)
                    if m:
                        images.append(m.group(1))
                    elif url:
                        images.append(url)
            ollama_msg: dict = {"role": msg.get("role", "user"), "content": " ".join(texts)}
            if images:
                ollama_msg["images"] = images
            result.append(ollama_msg)
        else:
            result.append({"role": msg.get("role", "user"), "content": content})
    return result


async def _groq_call(
    messages: list[dict],
    model: str,
    temperature: float,
    max_tokens: int,
    timeout: float = 30,
) -> dict:
    """
    Call Groq Cloud (OpenAI-compatible, free, 14k req/day).
    If primary model returns 413 (too large), retries with llama-3.3-70b-versatile.
    Use timeout=90 for long synthesis calls (4096 tokens ≈ 40-60s on free tier).
    """
    _GROQ_FALLBACK = "llama-3.3-70b-versatile"
    headers = {
        "Authorization": f"Bearer {settings.groq_api_key}",
        "Content-Type": "application/json",
    }
    for attempt_model in [model, _GROQ_FALLBACK] if model != _GROQ_FALLBACK else [model]:
        guarded = _inject_system_privacy_guard(messages)
        payload: dict[str, Any] = {
            "model": attempt_model, "messages": guarded,
            "temperature": temperature,
            "max_tokens": min(max_tokens, 4096),  # Groq hard-caps output
            "stream": False,
        }
        async with httpx.AsyncClient(timeout=timeout) as client:
            resp = await client.post(GROQ_CHAT_URL, headers=headers, json=payload)
            if resp.status_code == 413 and attempt_model != _GROQ_FALLBACK:
                import logging
                logging.getLogger("pclick").warning(
                    "Groq %s → 413, retrying with %s", attempt_model, _GROQ_FALLBACK
                )
                continue
            resp.raise_for_status()
            data = resp.json()
            _record_usage("groq", data, model=attempt_model)
            return data
    raise RuntimeError("Groq: all models failed")


async def _google_call(
    messages: list[dict],
    model: str,
    temperature: float,
    max_tokens: int,
) -> dict:
    """
    Call Google AI Studio via its OpenAI-compatible endpoint.
    Free tier: gemini-2.5-flash (20 req/day), gemma-3-27b-it (14,400 req/day).
    Adds response_format=json_object when the system prompt mentions JSON.
    """
    guarded = _inject_system_privacy_guard(messages)
    # Force JSON output mode when the system prompt mentions JSON
    _sys = " ".join(
        m.get("content", "") for m in guarded if m.get("role") == "system"
    )
    _json_mode = "json" in _sys.lower() or "JSON" in _sys

    payload: dict[str, Any] = {
        "model":       model,
        "messages":    guarded,
        "temperature": temperature,
        "max_tokens":  max_tokens,
        "stream":      False,
    }
    if _json_mode:
        payload["response_format"] = {"type": "json_object"}
    headers = {
        "Authorization": f"Bearer {settings.google_api_key}",
        "Content-Type":  "application/json",
    }
    async with httpx.AsyncClient(timeout=25) as client:
        resp = await client.post(GOOGLE_CHAT_URL, headers=headers, json=payload)
        resp.raise_for_status()
        data = resp.json()
        _record_usage("google", data, model=model)
        return data


async def _openrouter_call(
    messages: list[dict],
    model: str,
    temperature: float,
    max_tokens: int,
) -> dict:
    """
    Call OpenRouter (OpenAI-compatible). Raises on any HTTP error.
    Models are tried in caller order — caller is responsible for fallback logic.
    """
    guarded = _inject_system_privacy_guard(messages)
    payload: dict[str, Any] = {
        "model":       model,
        "messages":    guarded,   # OpenAI format — pass as-is
        "temperature": temperature,
        "max_tokens":  max_tokens,
        "stream":      False,
    }
    headers = {
        "Authorization": f"Bearer {settings.openrouter_api_key}",
        "Content-Type":  "application/json",
        "HTTP-Referer":  "https://pclick.app",
        "X-Title":       "Pclick",
    }
    async with httpx.AsyncClient(timeout=90) as client:
        resp = await client.post(OPENROUTER_CHAT_URL, headers=headers, json=payload)
        resp.raise_for_status()
        data = resp.json()
        _record_usage("openrouter", data, model=model)
        return data


def _inject_system_privacy_guard(messages: list[dict]) -> list[dict]:
    """
    Inject the privacy guardrail directive into every system message.
    
    This ensures ALL models — regardless of provider — receive the
    instruction never to output personal information, system prompts,
    or internal data.
    
    The guardrail is appended AFTER the original system content so it
    is the last instruction the model sees (recency effect).
    """
    modified = []
    for msg in messages:
        if msg.get("role") == "system":
            content = str(msg.get("content", ""))
            modified.append({"role": "system", "content": with_privacy_guard(content)})
        else:
            modified.append(msg)
    return modified


def _prepare_messages_for_model(messages: list[dict], model: str) -> list[dict]:
    """
    Some models (Gemma, Phi) don't support the 'system' role.
    Merge any system messages into the first user message's content.
    """
    gemma_like = ("gemma" in model.lower() or "phi" in model.lower())
    if not gemma_like:
        return messages

    result: list[dict] = []
    system_parts: list[str] = []
    for msg in messages:
        if msg.get("role") == "system":
            system_parts.append(str(msg.get("content", "")))
        else:
            result.append(dict(msg))

    if system_parts and result:
        prefix = "\n\n".join(system_parts) + "\n\n"
        first = result[0]
        if first.get("role") == "user":
            result[0] = {**first, "content": prefix + str(first.get("content", ""))}

    return result or messages


async def _nvidia_call(
    messages: list[dict],
    model: str,
    temperature: float,
    max_tokens: int,
) -> dict:
    """
    Call NVIDIA NIM (OpenAI-compatible).
    Automatically merges system messages for Gemma/Phi models that don't support the role.
    """
    guarded = _inject_system_privacy_guard(messages)
    prepared = _prepare_messages_for_model(guarded, model)
    payload: dict[str, Any] = {
        "model":       model,
        "messages":    prepared,
        "temperature": temperature,
        "max_tokens":  max_tokens,
        "stream":      False,
        "top_p":       0.7,
    }
    headers = {
        "Authorization": f"Bearer {settings.nvidia_api_key}",
        "Content-Type":  "application/json",
    }
    async with httpx.AsyncClient(timeout=60) as client:
        resp = await client.post(
            f"{settings.nvidia_base_url}/chat/completions",
            headers=headers,
            json=payload,
        )
        if not resp.is_success:
            import logging
            logging.getLogger("pclick").warning(
                "NVIDIA %s → %s: %s", model, resp.status_code, resp.text[:200]
            )
        resp.raise_for_status()
        data = resp.json()
        _record_usage("nvidia", data, model=model)
        return data


@_tag_task
async def voice_fallback_chat(messages: list[dict], system_instruction: str = "") -> str:
    """
    Text fallback for ARI's voice session when the Gemini Live WebSocket is
    unreachable. Uses NVIDIA NIM's gpt-oss-20b (OpenAI-compatible chat
    completions) — same behavior-trained system instruction as Gemini Live,
    just no native audio output; the frontend speaks the reply via the
    browser's own speechSynthesis instead.
    """
    full_messages = (
        [{"role": "system", "content": system_instruction}] if system_instruction else []
    ) + messages
    data = await _nvidia_call(
        full_messages,
        model=settings.nvidia_voice_fallback_model,
        temperature=0.8,
        max_tokens=1024,
    )
    return extract_text(data)


async def _gemini_vision_call(
    messages: list[dict],
    temperature: float = 0.1,
    max_tokens: int = 2048,
) -> dict:
    """
    Call Gemini Flash via Google AI Studio for multimodal (vision) tasks.
    Uses a 90s timeout (vision is slower than text).
    messages must be OpenAI-compatible with image_url content parts.
    """
    guarded = _inject_system_privacy_guard(messages)
    payload: dict[str, Any] = {
        "model":       settings.google_pro_model,   # gemini-2.5-pro (vision primary)
        "messages":    guarded,
        "temperature": temperature,
        "max_tokens":  max_tokens,
        "stream":      False,
    }
    headers = {
        "Authorization": f"Bearer {settings.google_api_key}",
        "Content-Type":  "application/json",
    }
    import logging
    logging.getLogger("pclick").info("_gemini_vision_call: model=%s", settings.google_pro_model)
    async with httpx.AsyncClient(timeout=90) as client:
        resp = await client.post(GOOGLE_CHAT_URL, headers=headers, json=payload)
        resp.raise_for_status()
        data = resp.json()
        _record_usage("google", data, model=settings.google_pro_model)
        return data


async def _nvidia_vision_call(
    messages: list[dict],
    temperature: float = 0.1,
    max_tokens: int = 2048,
) -> dict:
    """
    Call NVIDIA NIM Llama 3.2 11B Vision for multimodal tasks.
    Uses NVIDIA_VISION_KEY (separate from the text NVIDIA_API_KEY).
    messages must be OpenAI-compatible with image_url content parts.
    """
    import logging
    log = logging.getLogger("pclick")
    guarded = _inject_system_privacy_guard(messages)
    model = settings.nvidia_vision_model
    payload: dict[str, Any] = {
        "model":       model,
        "messages":    guarded,
        "temperature": temperature,
        "max_tokens":  max_tokens,
        "stream":      False,
        "top_p":       1.0,
        "frequency_penalty": 0.0,
        "presence_penalty":  0.0,
    }
    headers = {
        "Authorization": f"Bearer {settings.nvidia_vision_key}",
        "Content-Type":  "application/json",
        "Accept":        "application/json",
    }
    log.info("_nvidia_vision_call: model=%s", model)
    async with httpx.AsyncClient(timeout=90) as client:
        resp = await client.post(
            f"{settings.nvidia_base_url}/chat/completions",
            headers=headers,
            json=payload,
        )
        if not resp.is_success:
            log.warning("NVIDIA vision %s → %s: %s", model, resp.status_code, resp.text[:200])
        resp.raise_for_status()
        return resp.json()


async def _openai_vision_call(
    messages: list[dict],
    temperature: float = 0.1,
    max_tokens: int = 4096,
    model: str = "gpt-4o",
) -> dict:
    """
    Call OpenAI GPT-4o for multimodal (vision) tasks.
    messages must be OpenAI-compatible with image_url content parts.
    Uses a 90s timeout (vision can be slow for large images).
    """
    import logging
    logging.getLogger("pclick").info("_openai_vision_call: model=%s", model)
    guarded = _inject_system_privacy_guard(messages)
    payload: dict[str, Any] = {
        "model":       model,
        "messages":    guarded,
        "temperature": temperature,
        "max_tokens":  max_tokens,
        "stream":      False,
    }
    headers = {
        "Authorization": f"Bearer {settings.openai_api_key}",
        "Content-Type":  "application/json",
    }
    async with httpx.AsyncClient(timeout=90) as client:
        resp = await client.post(OPENAI_CHAT_URL, headers=headers, json=payload)
        resp.raise_for_status()
        data = resp.json()
        _record_usage("openai", data, model=model)
        return data


async def _ollama_call(
    messages: list[dict],
    model: str,
    temperature: float,
    max_tokens: int,
) -> dict:
    """
    Single call to Ollama Cloud — picks a random key from the pool.
    If the chosen key fails with 401/429, retries with the remaining keys.
    Uses Ollama /api/chat format (not OpenAI /v1/chat/completions).
    """
    guarded = _inject_system_privacy_guard(messages)
    payload: dict[str, Any] = {
        "model":    model,
        "messages": _to_ollama_messages(guarded),
        "stream":   False,
        "options":  {"temperature": temperature, "num_predict": max_tokens},
    }
    keys = settings.ollama_keys.copy()
    random.shuffle(keys)  # randomise order each call

    last_exc: Exception | None = None
    async with httpx.AsyncClient(timeout=90) as client:
        for key in keys:
            headers = {
                "Authorization": f"Bearer {key}",
                "Content-Type": "application/json",
            }
            try:
                resp = await client.post(OLLAMA_CHAT_URL, headers=headers, json=payload)
                resp.raise_for_status()
                data = resp.json()
                _record_usage("ollama", data, model=model)
                return data
            except httpx.HTTPStatusError as e:
                last_exc = e
                if e.response.status_code in (401, 403, 429):
                    continue   # try next key
                raise          # other errors → propagate immediately
    raise last_exc  # all keys exhausted



async def _ollama_vision_call(
    messages: list[dict],
    model: str,
    temperature: float,
    max_tokens: int,
) -> dict:
    """
    Ollama Cloud vision call — same key rotation as _ollama_call() but with a
    longer timeout and explicit model for multimodal requests.
    Accepts messages with 'image_url' content (OpenAI-compatible format).
    """
    guarded = _inject_system_privacy_guard(messages)
    payload: dict[str, Any] = {
        "model":    model,
        "messages": _to_ollama_messages(guarded),  # converts image_url → images[]
        "stream":   False,
        "options":  {"temperature": temperature, "num_predict": max_tokens},
    }
    keys = settings.ollama_keys.copy()
    random.shuffle(keys)

    last_exc: Exception | None = None
    async with httpx.AsyncClient(timeout=25) as client:   # 25s — fail fast if model unavailable
        for key in keys:
            headers = {
                "Authorization": f"Bearer {key}",
                "Content-Type": "application/json",
            }
            try:
                resp = await client.post(OLLAMA_CHAT_URL, headers=headers, json=payload)
                resp.raise_for_status()
                return resp.json()
            except httpx.HTTPStatusError as e:
                last_exc = e
                if e.response.status_code in (401, 403, 429):
                    continue
                raise
    raise last_exc  # type: ignore[misc]


# ── Public API ────────────────────────────────────────────────────────────────

@_tag_task
async def chat(
    messages: list[dict],
    *,
    model: str | None = None,
    temperature: float = 0.7,
    max_tokens: int = 2048,
    stream: bool = False,
    prefer_fast: bool = False,
    **_kwargs,
) -> dict:
    """
    Chat — tries providers in order:
      1. OpenRouter: primary model → fallback model  (if key configured)
      2. Ollama Cloud                                 (if key configured)
    Raises if all providers fail.
    """
    import logging
    log = logging.getLogger("pclick")

    # ── Groq (primary — free, 14k req/day) ───────────────────────────────────
    if _use_groq() and model is None:
        g_model = settings.groq_fast_model if prefer_fast else settings.groq_primary_model
        try:
            log.info("Groq → %s", g_model)
            return await _groq_call(messages, g_model, temperature, max_tokens)
        except httpx.HTTPStatusError as e:
            log.warning("Groq %s failed: %s %s", g_model, e.response.status_code, e.response.text[:200])
        except Exception as e:
            log.warning("Groq error: %s", e)

    # ── Google AI Studio (secondary) ─────────────────────────────────────────
    if _use_google() and model is None:
        # Try primary model first, then fast model as fallback (14,400 req/day vs 20/day)
        google_models = (
            [settings.google_fast_model] if prefer_fast
            else [settings.google_primary_model, settings.google_fast_model]
        )
        for g_model in google_models:
            try:
                log.info("Google → %s", g_model)
                return await _google_call(messages, g_model, temperature, max_tokens)
            except httpx.HTTPStatusError as e:
                log.warning("Google %s failed: %s %s", g_model, e.response.status_code, e.response.text[:100])
            except Exception as e:
                log.warning("Google %s error: %s", g_model, e)

    # ── NVIDIA NIM (fallback — Nemotron 550B) ───────────────────────────────
    if _use_nvidia() and model is None:
        try:
            log.info("NVIDIA → %s", settings.nvidia_primary_model)
            return await _nvidia_call(messages, settings.nvidia_primary_model, temperature, max_tokens)
        except httpx.HTTPStatusError as e:
            log.warning("NVIDIA failed: %s", e.response.status_code)
        except Exception as e:
            log.warning("NVIDIA error: %s", e)

    # ── OpenRouter (fallback — :free models, no credits needed) ──────────────
    if _use_openrouter() and model is None:
        for or_model in [settings.openrouter_primary_model, settings.openrouter_fallback_model]:
            try:
                log.info("OpenRouter → %s", or_model)
                return await _openrouter_call(messages, or_model, temperature, max_tokens)
            except httpx.HTTPStatusError as e:
                log.warning("OpenRouter %s failed: %s", or_model, e.response.status_code)
            except Exception as e:
                log.warning("OpenRouter %s error: %s", or_model, e)

    # ── Explicit model override ───────────────────────────────────────────────
    if model:
        if _use_groq():
            return await _groq_call(messages, model, temperature, max_tokens)
        if _use_google():
            return await _google_call(messages, model, temperature, max_tokens)
        if _use_openrouter() and "/" in model:
            return await _openrouter_call(messages, model, temperature, max_tokens)
        if _use_ollama():
            return await _ollama_call(messages, model, temperature, max_tokens)

    # ── Ollama Cloud (last resort) ────────────────────────────────────────────
    if _use_ollama():
        ollama_model = settings.ollama_fast_model if prefer_fast else settings.ollama_primary_model
        return await _ollama_call(messages, ollama_model, temperature, max_tokens)

    # ── WolframAlpha (last resort, SOC-17) ────────────────────────────────────
    # Every chat provider above is down or errored — for a computational
    # query, an exact WolframAlpha answer beats surfacing a bare failure.
    if _wolfram.is_configured():
        last_user = next(
            (m.get("content", "") for m in reversed(messages) if m.get("role") == "user"),
            "",
        )
        if _wolfram.looks_computational(last_user):
            answer = await _wolfram.compute(last_user)
            if answer:
                log.info("WolframAlpha fallback used — all chat providers failed")
                return {"model": "wolframalpha", "message": {"content": answer}}

    tried = []
    if _use_groq():   tried.append("Groq")
    if _use_google(): tried.append("Google")
    if _use_nvidia(): tried.append("NVIDIA")
    tried_str = ", ".join(tried) if tried else "none"
    raise RuntimeError(
        f"All AI providers failed (tried: {tried_str}). "
        "Check API keys in .env and provider status."
    )


def extract_text(response: dict) -> str:
    """
    Pull the assistant message text from an Ollama /api/chat response.
    Also handles legacy OpenAI-format responses (choices[0].message.content).
    Strips <think>...</think> / <thinking>...</thinking> blocks from reasoning models.
    """
    import re
    # Ollama /api/chat format: {"message": {"role": "assistant", "content": "..."}}
    content = (response.get("message") or {}).get("content", "")
    # Fallback: OpenAI /v1/chat/completions format
    if not content:
        try:
            content = response["choices"][0]["message"]["content"] or ""
        except (KeyError, IndexError, TypeError):
            content = ""
    if not content:
        return ""
    # Strip reasoning traces from thinking models (DeepSeek-R1, QwQ, etc.)
    content = re.sub(r"<think(?:ing)?>[\s\S]*?</think(?:ing)?>", "", content).strip()
    return content


@_tag_task
async def chat_gemini(
    messages: list[dict],
    *,
    temperature: float = 0.7,
    max_tokens: int = 2048,
) -> dict:
    """
    Previously Gemini via OpenRouter — now routes to the primary Ollama model.
    Kept for API compatibility (/ai/gemini endpoint).
    """
    return await _ollama_call(
        messages, settings.ollama_primary_model, temperature, max_tokens
    )


# ── Pclick-specific helpers ───────────────────────────────────────────────────

@_tag_task
async def analyze_tool_map(tool: str) -> dict:
    """
    Analyze a math/science tool (technique, theorem, formula) and return a
    structured INPUT → TOOL → OUTPUT map.

    Uses Google Gemini specifically (better at structured conceptual reasoning).
    Falls back to primary chat() if Gemini unavailable.

    Returns:
      {
        "tool": "Chain Rule",
        "description": "Differentiates composite functions f(g(x))",
        "when_to_use": "When the function is nested inside another function",
        "example": "d/dx[sin(x²)] = cos(x²) · 2x",
        "inputs": [
          {"label": "Composite function f(g(x))", "detail": "The function to differentiate"},
          ...
        ],
        "outputs": [
          {"label": "f'(g(x)) · g'(x)", "detail": "Derivative using chain rule"},
          ...
        ]
      }
    """
    system = (
        "You are a math/science concept analyzer for students. "
        "Analyze the given tool (technique, theorem, rule, formula) and output a structured "
        "INPUT → TOOL → OUTPUT map that helps students understand exactly when and how to apply it.\n\n"
        "Return ONLY valid JSON (no markdown, no extra text):\n"
        "{\n"
        '  "tool": "<canonical name of the tool>",\n'
        '  "description": "<one sentence: what it does>",\n'
        '  "when_to_use": "<one sentence: the signal/trigger that tells you to use this tool>",\n'
        '  "example": "<short worked example using Unicode math, no LaTeX>",\n'
        '  "inputs": [\n'
        '    {"label": "<short name>", "detail": "<what this input is>"},\n'
        '    ... (2–4 inputs)\n'
        "  ],\n"
        '  "outputs": [\n'
        '    {"label": "<short name>", "detail": "<what this output represents>"},\n'
        '    ... (2–3 outputs)\n'
        "  ]\n"
        "}\n\n"
        "Rules:\n"
        "- inputs = what you need to GIVE the tool (conditions, given values, function form)\n"
        "- outputs = what the tool PRODUCES (results, derived expressions, conclusions)\n"
        "- Use Unicode math notation only — no LaTeX backslash commands\n"
        "- All text in English\n"
        "- Be specific and pedagogically useful — a student should know exactly what to plug in"
    )

    # Route directly to Google Gemini (user preference for tool analysis)
    if _use_google():
        try:
            resp = await _google_call(
                messages=[
                    {"role": "system", "content": system},
                    {"role": "user",   "content": f"Analyze this tool: {tool}"},
                ],
                model=settings.google_primary_model,
                temperature=0.3,
                max_tokens=1024,
            )
            raw = extract_text(resp)
            parsed = _parse_json_robust(raw)
            if parsed and parsed.get("inputs") and parsed.get("outputs"):
                return parsed
        except Exception:
            import logging
            logging.getLogger("pclick").warning("Gemini tool-map failed, falling back", exc_info=True)

    # Fallback to primary chat()
    resp = await chat(
        messages=[
            {"role": "system", "content": system},
            {"role": "user",   "content": f"Analyze this tool: {tool}"},
        ],
        temperature=0.3,
        max_tokens=1024,
    )
    raw = extract_text(resp)
    parsed = _parse_json_robust(raw)
    if parsed:
        return parsed
    return {"error": "parse_failed", "tool": tool, "inputs": [], "outputs": []}


@_tag_task
async def validate_tool_map(
    inputs: list[str],
    tools:  list[str],
    outputs: list[str],
    context: str = "",
) -> dict:
    """
    Validate a student's INPUT → TOOL → OUTPUT canvas using Google Gemini.

    Returns:
      {
        "verdict":  "correct" | "partial" | "incorrect",
        "feedback": "Overall 1-2 sentence verdict",
        "correct":  ["what is right"],
        "issues":   [{"location": "input|tool|output", "item": "...", "detail": "..."}],
        "missing":  ["what is missing"],
        "suggestions": ["how to improve"]
      }
    """
    # Build a readable description of the student's canvas
    canvas_desc = ""
    if context:
        canvas_desc += f"Problem: {context}\n\n"
    canvas_desc += "Student's approach:\n"
    canvas_desc += "  INPUTS:  " + (", ".join(inputs)  if inputs  else "(none)") + "\n"
    canvas_desc += "  TOOLS:   " + (", ".join(tools)   if tools   else "(none)") + "\n"
    canvas_desc += "  OUTPUTS: " + (", ".join(outputs) if outputs else "(none)") + "\n"

    system = (
        "You are a math/science tutor reviewing a student's problem-solving approach. "
        "The student has drawn an INPUT → TOOL → OUTPUT map showing how they plan to solve a problem.\n\n"
        "Analyze their approach and return ONLY valid JSON:\n"
        "{\n"
        '  "verdict": "correct|partial|incorrect",\n'
        '  "feedback": "<1-2 sentences overall verdict — be encouraging but honest>",\n'
        '  "correct": ["<what they got right>", ...],\n'
        '  "issues": [\n'
        '    {"location": "input|tool|output", "item": "<the problematic item>", "detail": "<why it is wrong or problematic>"}\n'
        "  ],\n"
        '  "missing": ["<what is missing from their approach>", ...],\n'
        '  "suggestions": ["<specific actionable suggestion>", ...]\n'
        "}\n\n"
        "Rules:\n"
        "- verdict='correct' only if the full approach is right\n"
        "- verdict='partial' if on the right track but missing steps or has minor errors\n"
        "- verdict='incorrect' if the core approach is wrong\n"
        "- Be specific — name the exact tool, input, or output that is wrong\n"
        "- Use Unicode math notation, not LaTeX\n"
        "- If context (problem statement) is given, validate against that specific problem\n"
        "- If no context, validate whether the inputs/tools/outputs form a logically consistent approach"
    )

    # Prefer Gemini for this task
    if _use_google():
        try:
            resp = await _google_call(
                messages=[
                    {"role": "system", "content": system},
                    {"role": "user",   "content": canvas_desc},
                ],
                model=settings.google_primary_model,
                temperature=0.3,
                max_tokens=1024,
            )
            raw = extract_text(resp)
            parsed = _parse_json_robust(raw)
            if parsed and "verdict" in parsed:
                return parsed
        except Exception:
            import logging
            logging.getLogger("pclick").warning("Gemini validate_tool_map failed, falling back", exc_info=True)

    # Fallback
    resp = await chat(
        messages=[
            {"role": "system", "content": system},
            {"role": "user",   "content": canvas_desc},
        ],
        temperature=0.3,
        max_tokens=1024,
    )
    raw = extract_text(resp)
    parsed = _parse_json_robust(raw)
    if parsed:
        return parsed
    return {
        "verdict": "unknown",
        "feedback": "Could not parse AI response. Please try again.",
        "correct": [], "issues": [], "missing": [], "suggestions": [],
    }


@_tag_task
async def analyze_mind_map_vision(image_b64: str, context: str = "") -> dict:
    """
    Inspect a student's mind map screenshot with vision and return only
    structural feedback about where the map is missing or wrong.

    The expected default structure is:
      - 2 input blocks
      - 1 systems / machine block
      - 1 output block

    Custom nodes may exist, but they should not replace the default structure.
    """
    import logging
    log = logging.getLogger("pclick")

    prompt = (
        "You are inspecting a student's problem-set mind map.\n\n"
        "The default map structure is:\n"
        "1) INPUT 1\n"
        "2) INPUT 2\n"
        "3) SYSTEMS / MACHINE\n"
        "4) OUTPUT\n\n"
        "Custom nodes may be added, but the default structure must still be present.\n"
        "Only report structural problems and only use these locations:\n"
        "- input\n"
        "- systems\n"
        "- output\n"
        "- connection\n"
        "- custom\n\n"
        "Do NOT evaluate the student's content knowledge. Do NOT explain the solution.\n"
        "Only say what is missing, misplaced, or connected wrongly.\n"
        "Be concise and specific about the location.\n\n"
        "Return ONLY valid JSON (no markdown):\n"
        "{\n"
        '  "verdict": "ok|partial|wrong",\n'
        '  "summary": "<very short overall diagnosis>",\n'
        '  "findings": [\n'
        '    {"location": "input|systems|output|connection|custom", "issue": "<short label>", "detail": "<1 short sentence>" }\n'
        "  ],\n"
        '  "missing": ["<short missing item>", ...],\n'
        '  "suggestions": ["<short fix>", ...]\n'
        "}\n\n"
        "If the map is missing one of the default blocks, name that block in `missing` "
        "and set the corresponding finding location.\n"
    )

    messages = [{
        "role": "user",
        "content": [
            {
                "type": "image_url",
                "image_url": {"url": f"data:image/png;base64,{image_b64}"},
            },
            {
                "type": "text",
                "text": prompt + (f"\nContext: {context}" if context.strip() else ""),
            },
        ],
    }]

    # ── Primary: Gemini Pro 2.5 Vision ───────────────────────────────────────
    if _use_google():
        try:
            resp = await _gemini_vision_call(messages, temperature=0.1, max_tokens=1024)
            raw = extract_text(resp)
            parsed = _parse_json_robust(raw)
            if parsed and parsed.get("summary"):
                return parsed
        except Exception as e:
            log.warning("analyze_mind_map_vision Gemini Pro failed: %s", e)

    # ── Secondary: OpenAI GPT-4o Vision ──────────────────────────────────────
    if _use_openai():
        try:
            resp = await _openai_vision_call(messages, temperature=0.1, max_tokens=1024)
            raw = extract_text(resp)
            parsed = _parse_json_robust(raw)
            if parsed and parsed.get("summary"):
                return parsed
        except Exception as e:
            log.warning("analyze_mind_map_vision OpenAI failed: %s", e)

    # ── Fallback: NVIDIA Llama 3.2 11B Vision (NIM) ──────────────────────────
    if settings.nvidia_vision_key:
        try:
            resp = await _nvidia_vision_call(messages, temperature=0.1, max_tokens=1024)
            raw = extract_text(resp)
            parsed = _parse_json_robust(raw)
            if parsed and parsed.get("summary"):
                return parsed
        except Exception as e:
            log.warning("analyze_mind_map_vision NVIDIA Llama fallback failed: %s", e)

    return {
        "verdict": "unknown",
        "summary": "Could not analyze the mind map.",
        "findings": [],
        "missing": [],
        "suggestions": [],
    }


@_tag_task
async def generate_roadmap(
    topic: str,
    learning_style: dict,
    study_mode: str,
    needs_attention: list[dict] | None = None,
) -> dict:
    """
    DeepSeek-powered learning roadmap: given a target topic, what
    prerequisites/supplementary subjects it needs and a sequenced path to
    it — blended across three roadmap styles per the product spec, not a
    single pure style:
      - top-down: start from the big picture / real-world application,
        drill into fundamentals only as needed
      - traditional bottom-up: build systematically from fundamentals up
      - just-in-time: identify the course's key checkpoints, only pull in
        extra background material exactly when a gap actually blocks
        understanding

    `learning_style` is the student's current fit across the three
    (percentages, from mastery_profile.derive_learning_style_fit) — the
    roadmap should blend styles in those proportions, not pick just one.

    Returns {topic, prerequisites: [{name, why, priority}],
             roadmap_steps: [{order, title, description, approach}],
             style_summary}
    """
    import logging, json as _json
    log = logging.getLogger("pclick")

    attention_str = ""
    if needs_attention:
        attention_str = "Concepts the student is currently struggling with (weave in as prerequisites if relevant): " + \
            ", ".join(f"{a['concept']} ({a['subject']})" for a in needs_attention[:5])

    system = (
        "You are a curriculum designer building a personalized learning roadmap. "
        "The student's fit across three roadmap styles has already been measured:\n"
        f"- Top-down (start from big picture/application, drill into fundamentals only as needed): {learning_style.get('top_down_pct', 33)}%\n"
        f"- Traditional bottom-up (build systematically from fundamentals upward): {learning_style.get('bottom_up_pct', 33)}%\n"
        f"- Just-in-time (spot the course's key checkpoints, only pull in extra background exactly when a gap blocks understanding): {learning_style.get('just_in_time_pct', 34)}%\n\n"
        f"Student's overall study mode: {study_mode}.\n"
        "BLEND all three styles in these exact proportions when designing the roadmap — do not just pick "
        "the single highest one. E.g. if top-down is dominant, most steps should start from context/application, "
        "but still include a few bottom-up scaffolding steps and just-in-time checkpoints in proportion to their percentages.\n\n"
        "Return ONLY raw JSON (no markdown fences, no extra text):\n"
        '{"prerequisites":[{"name":"...","why":"one sentence","priority":"required|recommended"}],'
        '"roadmap_steps":[{"order":1,"title":"...","description":"2-3 sentences","approach":"top_down|bottom_up|just_in_time"}],'
        '"style_summary":"1-2 sentences explaining how this specific roadmap reflects the blended percentages"}\n\n'
        "5-10 roadmap_steps, 0-6 prerequisites (empty array if the topic has none worth calling out)."
    )
    user_msg = f"Target topic: {topic}\n{attention_str}"

    messages = [
        {"role": "system", "content": system},
        {"role": "user",   "content": user_msg},
    ]

    api_key = settings.nvidia_deepseek_key or settings.nvidia_api_key
    if not api_key:
        raise RuntimeError("NVIDIA_DEEPSEEK_KEY / NVIDIA_API_KEY not configured")

    payload: dict[str, Any] = {
        "model": settings.nvidia_deepseek_model,
        "messages": messages,
        "temperature": 1,
        "top_p": 0.95,
        "max_tokens": 4096,
        "stream": False,
        # `extra_body` is an OpenAI-Python-SDK-only convenience wrapper that
        # merges its contents into the top-level request — over raw HTTP
        # (no SDK involved here) chat_template_kwargs must be a real
        # top-level field, not nested under a literal "extra_body" key
        # (confirmed live: nesting it gets a 400 "Unsupported parameter").
        "chat_template_kwargs": {"thinking": True, "reasoning_effort": "high"},
    }
    headers = {"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"}
    # reasoning_effort="high" on a thinking model genuinely takes longer than
    # this file's usual 90s timeout (confirmed live: a 90s timeout hit
    # ReadTimeout on a real roadmap request) — this is a slow-but-thorough
    # call, not a hung request.
    async with httpx.AsyncClient(timeout=180) as client:
        resp = await client.post(f"{settings.nvidia_base_url}/chat/completions", headers=headers, json=payload)
        if not resp.is_success:
            log.warning("DeepSeek roadmap %s → %s: %s", settings.nvidia_deepseek_model, resp.status_code, resp.text[:300])
        resp.raise_for_status()
        data = resp.json()
        _record_usage("nvidia", data, model=settings.nvidia_deepseek_model)

    raw = extract_text(data)
    parsed = _parse_json_robust(raw)
    if not parsed:
        log.warning("generate_roadmap: could not parse DeepSeek output: %s", raw[:300])
        return {"topic": topic, "prerequisites": [], "roadmap_steps": [], "style_summary": "", "error": "parse_failed", "raw": raw[:1000]}

    parsed["topic"] = topic
    parsed.setdefault("prerequisites", [])
    parsed.setdefault("roadmap_steps", [])
    parsed.setdefault("style_summary", "")
    return parsed


@_tag_task
async def topic_to_nodemap(topic: str) -> dict:
    """
    Convert a topic string into an Obsidian-style knowledge node map.
    Returns { topic, nodes: [{id, label, type, description}], edges: [{source, target, label}] }
    Prefers Google Gemini (better structured reasoning) with fallback to chat().
    """
    import json, re, logging
    log = logging.getLogger("pclick")

    system = (
        "You are a knowledge graph builder. "
        "LANGUAGE: All node labels, descriptions, and edge labels MUST be in English only — no exceptions.\n\n"
        "Given a topic, return ONLY valid JSON (no markdown fences, no extra text) with this exact schema:\n"
        '{"topic":"<English topic name>","nodes":[{"id":"<lowercase-slug>","label":"<Short English Name>","type":"root|concept|subtopic|application|prerequisite","description":"<One clear English sentence.>"}],'
        '"edges":[{"source":"<id>","target":"<id>","label":"contains|requires|applies to|extends|related to"}]}\n\n'
        "Rules:\n"
        "- Exactly 1 root node (the topic itself)\n"
        "- 5–10 concept/subtopic nodes covering the main ideas\n"
        "- 2–4 application nodes (real-world uses)\n"
        "- 0–3 prerequisite nodes (prior knowledge needed)\n"
        "- Every node must connect to at least 1 edge\n"
        "- id must be a lowercase slug (e.g. 'chain_rule', not 'Chain Rule')\n"
        "- label must be concise English (2–4 words max)\n"
        "- description: one plain English sentence, no jargon overload"
    )
    messages = [
        {"role": "system", "content": system},
        {"role": "user",   "content": f"Build a knowledge graph for: {topic}"},
    ]

    def _parse_nodemap(raw: str):
        cleaned = re.sub(r"^```(?:json)?\s*", "", raw.strip())
        cleaned = re.sub(r"\s*```$", "", cleaned).strip()
        try:
            return json.loads(cleaned)
        except json.JSONDecodeError:
            pass
        match = re.search(r'\{[\s\S]*\}', cleaned)
        if match:
            try:
                return json.loads(match.group())
            except json.JSONDecodeError:
                pass
        return None

    # ── Try Gemini first ──────────────────────────────────────────────────────
    if _use_google():
        try:
            log.info("topic_to_nodemap → Gemini %s", settings.google_primary_model)
            resp = await _google_call(messages, settings.google_primary_model, 0.2, 2048)
            # _google_call already recorded usage for this response — don't double-count.
            raw = extract_text(resp)
            result = _parse_nodemap(raw)
            if result and result.get("nodes"):
                return result
        except Exception as e:
            log.warning("Gemini topic_to_nodemap failed: %s — falling back to chat()", e)

    # ── Fallback: chat() chain ────────────────────────────────────────────────
    resp = await chat(messages, temperature=0.2, max_tokens=2048)
    raw = extract_text(resp)
    result = _parse_nodemap(raw)
    if result:
        return result
    return {"raw": raw, "error": "parse_failed", "topic": topic, "nodes": [], "edges": []}


async def _get_with_retry(
    client: "httpx.AsyncClient", url: str, headers: dict, retries: int = 2, backoff: float = 0.35,
) -> "httpx.Response | None":
    """
    GET with a couple of quick retries. The Wikipedia/Knowledge-Graph lookups
    behind Gemma's research feature are flaky enough (transient timeouts,
    momentary rate limits) that the same query can return 3 images on one
    call and 0 on the next with no retry at all — this is what was causing
    "common topics sometimes show no image" reports.
    """
    import asyncio, logging
    log = logging.getLogger("pclick")
    last_exc: Exception | None = None
    for attempt in range(retries + 1):
        try:
            r = await client.get(url, headers=headers)
            if r.status_code == 200:
                return r
            if r.status_code in (429, 502, 503, 504) and attempt < retries:
                await asyncio.sleep(backoff * (attempt + 1))
                continue
            return r
        except Exception as e:
            last_exc = e
            if attempt < retries:
                await asyncio.sleep(backoff * (attempt + 1))
                continue
    if last_exc:
        log.debug("_get_with_retry(%s) exhausted retries: %s", url[:80], last_exc)
    return None


async def _fetch_google_media(query: str) -> dict:
    """
    Fetch up to 3 image URLs + a real citation link using the Google Knowledge
    Graph Search API. Uses the existing GOOGLE_API_KEY — no additional key
    required. Returns {"images": [...], "source_url": str | None}.
    """
    if not settings.google_api_key:
        return {"images": [], "source_url": None}
    import urllib.parse, logging
    log = logging.getLogger("pclick")
    images: list[str] = []
    source_url: str | None = None
    try:
        encoded = urllib.parse.quote(query, safe="")
        url = (
            f"https://kgsearch.googleapis.com/v1/entities:search"
            f"?query={encoded}&key={settings.google_api_key}&limit=3&indent=False"
        )
        async with httpx.AsyncClient(timeout=6) as client:
            r = await _get_with_retry(client, url, {"User-Agent": "Pclick/1.0"})
            if r and r.status_code == 200:
                items = r.json().get("itemListElement", [])
                for item in items:
                    result = item.get("result", {})
                    img = result.get("image", {}).get("contentUrl")
                    if img and img not in images:
                        images.append(img)
                    if not source_url:
                        # Prefer the entity's own detailed-description source
                        # (usually Wikipedia) over its raw homepage URL —
                        # that's a citable reference, not just a link.
                        source_url = (
                            result.get("detailedDescription", {}).get("url")
                            or result.get("url")
                        )
    except Exception as e:
        log.debug("_fetch_google_media(%s) failed: %s", query, e)
    return {"images": images[:3], "source_url": source_url}


async def _fetch_wiki_media(query: str) -> dict:
    """
    Fetch up to 3 real content images + the article URL from Wikipedia.
    Returns {"images": [...], "source_url": str | None}.
    """
    import urllib.parse, logging, re
    log = logging.getLogger("pclick")
    # Must include a contact URL per Wikimedia's User-Agent policy — a
    # generic UA gets 403'd from cloud/datacenter IPs (confirmed live).
    headers = {"User-Agent": "LyceumAcademy/1.0 (https://www.thelyceum.site) httpx"}

    def _article_url(title: str) -> str:
        return f"https://en.wikipedia.org/wiki/{urllib.parse.quote(title.replace(' ', '_'))}"

    # Skip icons/logos/edit-buttons that Wikipedia articles are full of —
    # not useful as an "illustrative image" for a student.
    _junk = re.compile(
        r"(commons-logo|wiktionary|wikiquote|edit-icon|folder|question_book|"
        r"padlock|disambig|ambox|nuvola|icon|\.svg$)", re.IGNORECASE,
    )

    async def _pageimages_api(title: str) -> str | None:
        """Use prop=pageimages — works for articles without a lead photo too."""
        encoded = urllib.parse.quote(title, safe="")
        url = (
            "https://en.wikipedia.org/w/api.php"
            f"?action=query&titles={encoded}"
            "&prop=pageimages&pithumbsize=600&piprop=thumbnail&format=json"
        )
        try:
            async with httpx.AsyncClient(timeout=8) as client:
                r = await _get_with_retry(client, url, headers)
                if r and r.status_code == 200:
                    pages = r.json().get("query", {}).get("pages", {})
                    for page in pages.values():
                        # Return the API's thumbnail URL as-is: rewriting the
                        # /NNNpx- segment 400s when the requested width exceeds
                        # the original image's width.
                        thumb = page.get("thumbnail", {}).get("source")
                        if thumb:
                            return thumb
        except Exception as e:
            log.debug("_pageimages_api(%s): %s", title, e)
        return None

    async def _extra_images(title: str, limit: int = 4) -> list[str]:
        """List a few more content images from the article body (beyond the lead photo)."""
        encoded = urllib.parse.quote(title, safe="")
        try:
            async with httpx.AsyncClient(timeout=8) as client:
                r = await _get_with_retry(
                    client,
                    "https://en.wikipedia.org/w/api.php"
                    f"?action=query&titles={encoded}&prop=images&imlimit={limit + 5}&format=json",
                    headers,
                )
                if not r or r.status_code != 200:
                    return []
                pages = r.json().get("query", {}).get("pages", {})
                filenames = [
                    im["title"] for page in pages.values()
                    for im in page.get("images", [])
                    if not _junk.search(im.get("title", ""))
                ][:limit]
                if not filenames:
                    return []
                titles_param = urllib.parse.quote("|".join(filenames), safe="|")
                r2 = await _get_with_retry(
                    client,
                    "https://en.wikipedia.org/w/api.php"
                    f"?action=query&titles={titles_param}&prop=imageinfo&iiprop=url"
                    "&iiurlwidth=600&format=json",
                    headers,
                )
                if not r2 or r2.status_code != 200:
                    return []
                pages2 = r2.json().get("query", {}).get("pages", {})
                return [
                    info["thumburl"] for page in pages2.values()
                    for info in page.get("imageinfo", [])
                    if info.get("thumburl")
                ]
        except Exception as e:
            log.debug("_extra_images(%s): %s", title, e)
            return []

    async def _search_title(q: str) -> str | None:
        """Return the best Wikipedia article title for query q."""
        encoded = urllib.parse.quote(q, safe="")
        try:
            async with httpx.AsyncClient(timeout=8) as client:
                r = await _get_with_retry(
                    client,
                    f"https://en.wikipedia.org/w/api.php"
                    f"?action=query&list=search&srsearch={encoded}&srlimit=1&format=json",
                    headers,
                )
                if r and r.status_code == 200:
                    hits = r.json().get("query", {}).get("search", [])
                    if hits:
                        return hits[0]["title"]
        except Exception as e:
            log.debug("_search_title(%s): %s", q, e)
        return None

    title = await _search_title(query) or query
    images: list[str] = []
    lead = await _pageimages_api(title)
    if lead:
        images.append(lead)
    for extra in await _extra_images(title):
        if extra not in images:
            images.append(extra)
        if len(images) >= 3:
            break

    if not images:
        return {"images": [], "source_url": None}
    return {"images": images[:3], "source_url": _article_url(title)}


_MEDIA_CACHE: dict[str, tuple[float, dict]] = {}
_MEDIA_CACHE_TTL = 24 * 3600   # a day — image/citation results for a topic don't go stale
_MEDIA_CACHE_MAX = 500


async def _fetch_node_media(label: str) -> dict:
    """
    Google Knowledge Graph first (images + citation), Wikipedia fills in
    anything still missing. Returns {"images": [...], "source_url": str | None}.

    Cached in-process by topic: Wikipedia/KG occasionally throttle bursts of
    requests from the same server IP, so a topic that failed to return images
    a moment ago can succeed on the next try and vice versa. Once a topic
    resolves with at least one image, we stop re-rolling that dice for
    everyone asking about it — which also matters because common topics
    (photosynthesis, sodium chloride, ...) get asked about constantly.
    """
    import time
    key = label.strip().lower()
    cached = _MEDIA_CACHE.get(key)
    if cached and time.time() - cached[0] < _MEDIA_CACHE_TTL:
        return cached[1]

    google = await _fetch_google_media(label)
    if len(google["images"]) >= 3 and google["source_url"]:
        result = google
    else:
        wiki = await _fetch_wiki_media(label)
        images = google["images"] + [i for i in wiki["images"] if i not in google["images"]]
        result = {
            "images": images[:3],
            "source_url": google["source_url"] or wiki["source_url"],
        }

    if result["images"]:
        if len(_MEDIA_CACHE) >= _MEDIA_CACHE_MAX:
            oldest_key = min(_MEDIA_CACHE, key=lambda k: _MEDIA_CACHE[k][0])
            _MEDIA_CACHE.pop(oldest_key, None)
        _MEDIA_CACHE[key] = (time.time(), result)
    return result


@_tag_task
async def node_summary(
    label: str,
    node_type: str,
    description: str,
    connections: list[str],
) -> dict:
    """
    NVIDIA Gemma summary for a knowledge graph node + Google/Wikipedia images.
    Returns {definition, equations, example, key_insight, formula_display,
             image_url, image_urls, source_url}
    - equations: Unicode math strings (no LaTeX)
    - formula_display: the most iconic equation to show large
    - image_urls: up to 3 images (Google Knowledge Graph first, Wikipedia fills
      in the rest); image_url is kept as the first one for backward compat
    - source_url: a real citable reference (Wikipedia article / KG entity page),
      not a generic search-engine link
    """
    import logging, asyncio
    log = logging.getLogger("pclick")

    system = (
        "You are a thorough academic tutor. Given a concept from a knowledge graph, "
        "return ONLY valid JSON with NO markdown fences, NO extra text:\n"
        '{"definition":"<4-5 sentences: what it is, why it matters, how it works, where it appears, and a key nuance or common misconception>","equations":["<eq1>","<eq2>"],'
        '"example":"<one concrete fully worked example, 2-3 sentences showing the steps>",'
        '"key_insight":"<the single sentence that makes this concept truly click>",'
        '"formula_display":"<the most iconic equation or expression for this concept, or empty string>"}\n\n'
        "Critical rules:\n"
        "- definition MUST be at least 4 complete sentences — do not summarise in fewer\n"
        "- Use LaTeX for ALL math: $...$ for inline (e.g. $E=mc^2$), $$...$$ for display (e.g. $$\\\\frac{d}{dx}f(x)$$)\n"
        "- equations: 1-3 LaTeX formulas, empty [] if the concept has no key equations\n"
        "- formula_display: the most iconic equation in LaTeX (e.g. $$E = mc^2$$), empty string '' if none\n"
        "- All text in English"
    )
    user_msg = (
        f"Concept: {label}\n"
        f"Type: {node_type}\n"
        f"Description: {description}\n"
        f"Related to: {', '.join(connections) if connections else 'N/A'}"
    )
    messages = [
        {"role": "system", "content": system},
        {"role": "user",   "content": user_msg},
    ]

    async def _nvidia_summary() -> str:
        # Primary: NVIDIA NIM google/gemma-2-2b-it
        if _use_nvidia():
            try:
                log.info("node_summary → NVIDIA %s", settings.nvidia_node_model)
                resp = await _nvidia_call(messages, settings.nvidia_node_model, 0.2, 1024)
                text = extract_text(resp).strip()
                if text:
                    return text
            except Exception as e:
                log.warning("NVIDIA node_summary failed: %s — falling back", e)
        # Fallback: Google Gemini
        if _use_google():
            try:
                resp = await _google_call(messages, settings.google_primary_model, 0.25, 1024)
                # _google_call already recorded usage for this response — don't double-count.
                return extract_text(resp)
            except Exception as e:
                log.warning("Gemini node_summary fallback failed: %s", e)
        # Last resort: chat() cascade
        try:
            resp = await chat(messages, temperature=0.25, max_tokens=512, prefer_fast=True)
            return extract_text(resp)
        except Exception as e:
            log.warning("node_summary chat() fallback failed: %s", e)
            return ""

    # Run text generation + image/citation search concurrently
    raw, media = await asyncio.gather(
        _nvidia_summary(),
        _fetch_node_media(label),
    )
    image_urls = media["images"]
    source_url = media["source_url"]
    image_url = image_urls[0] if image_urls else None

    parsed = _parse_json_robust(raw)
    if parsed and parsed.get("definition"):
        parsed["image_url"] = image_url
        parsed["image_urls"] = image_urls
        parsed["source_url"] = source_url
        return parsed

    return {
        "definition": description or f"{label} is a key concept in this topic.",
        "equations": [],
        "example": "",
        "key_insight": "",
        "formula_display": "",
        "image_url": image_url,
        "image_urls": image_urls,
        "source_url": source_url,
    }


@_tag_task
async def describe_drawing(image_b64: str) -> str:
    """
    Use Gemini vision to transcribe a student's whiteboard drawing.
    Returns a plain-text transcription of what's written/drawn.
    """
    if not _use_google():
        return "[whiteboard drawing — Gemini vision not configured]"

    import logging
    log = logging.getLogger("pclick")
    try:
        resp = await _google_call(
            messages=[{
                "role": "user",
                "content": [
                    {
                        "type": "text",
                        "text": (
                            "This is a student's handwritten solution or diagram on a whiteboard. "
                            "Transcribe exactly what is written, including all math expressions, "
                            "equations, diagrams, arrows, and annotations. "
                            "Use Unicode math symbols (×, ÷, √, ², ∫, Σ, etc.) where appropriate. "
                            "Output only the transcription — no commentary, no preamble."
                        ),
                    },
                    {
                        "type": "image_url",
                        "image_url": {"url": f"data:image/jpeg;base64,{image_b64}"},
                    },
                ],
            }],
            model=settings.google_primary_model,
            temperature=0.1,
            max_tokens=512,
        )
        return extract_text(resp)
    except Exception as e:
        log.warning("describe_drawing failed: %s", e)
        return "[whiteboard drawing — could not transcribe]"


def _repair_json(raw: str) -> str:
    """
    Multi-pass repair for common AI JSON output issues:

    1. Strip markdown fences
    2. Fix invalid backslash escapes  (\\sqrt → \\\\sqrt, \\alpha → \\\\alpha …)
    3. Remove trailing commas         (,} and ,] are invalid JSON)
    4. Escape literal control chars   (bare newlines / tabs inside string values)

    Pass 4 is the most important fix for math problem sets: the vision model often
    puts multi-line equations inside string values using REAL newlines, which is
    invalid JSON even though it looks fine visually.
    """
    import re

    # 1. Strip markdown fences
    s = re.sub(r"^```(?:json)?\s*", "", raw.strip())
    s = re.sub(r"\s*```$", "", s).strip()

    # 2a. Pre-escape LaTeX commands that START with a valid JSON escape letter.
    #     The general pass below keeps \r, \n, \t, \b as valid JSON escapes,
    #     so \right, \rho, \nabla, \theta, \tau, \beta etc. would NOT be fixed.
    #     We must handle them FIRST with a negative lookbehind (don't touch \\right).
    _latex_r = r'right|rho|rceil|rfloor|rangle|rm(?=[^a-z])'
    _latex_n = (r'nabla|nu(?=[^a-z])|neq|notin|norm|newline|nexists|ncong|napprox|'
                r'nmid|nleq|ngeq|nearrow|nwarrow|ni(?=[^a-z])')
    _latex_t = (r'tau(?=[^a-z])|theta|times|to(?=[^a-z])|top(?=[^a-z])|text|tilde|'
                r'tanh|tan(?=[^a-z])|tbinom|triangle|therefore|trace')
    _latex_b = (r'beta|bar(?=[^a-z])|begin|binom|boldsymbol|bullet|big(?=[^a-z])|'
                r'bmod|boxed|backslash|bot(?=[^a-z])|bigcup|bigcap|bigoplus|bigvee|bigwedge')
    # \b and \f have no legitimate use as literal control chars in AI-written math
    # prose, so any letters immediately after them are always corrupted LaTeX —
    # safe to generalize instead of maintaining an exhaustive whitelist.
    _latex_f = r'[a-zA-Z]+'
    s = re.sub(rf'(?<!\\)\\({_latex_r}|{_latex_n}|{_latex_t}|{_latex_b})', r'\\\\\1', s)
    s = re.sub(rf'(?<!\\)\\f({_latex_f})', r'\\\\f\1', s)
    s = re.sub(rf'(?<!\\)\\b({_latex_f})', r'\\\\b\1', s)

    # 2b. Fix remaining invalid backslash escapes.
    #     Valid JSON escapes after \: " \ / b f n r t  plus \uXXXX
    #     After pre-pass, \r / \n / \t / \b that remain are plain control chars (OK).
    s = re.sub(r'\\(?!["\\/bfnrt]|u[0-9a-fA-F]{4})', r'\\\\', s)

    # 3. Remove trailing commas before } or ]
    s = re.sub(r',(\s*[}\]])', r'\1', s)

    # 4. Escape literal newlines / carriage returns / tabs inside JSON string values.
    #    We walk character-by-character tracking whether we're inside a string.
    out: list[str] = []
    in_str = False
    i = 0
    while i < len(s):
        c = s[i]
        if c == '\\' and in_str:
            # Already-escaped sequence — copy both chars verbatim
            out.append(c)
            if i + 1 < len(s):
                i += 1
                out.append(s[i])
        elif c == '"':
            in_str = not in_str
            out.append(c)
        elif in_str and c == '\n':
            out.append('\\n')
        elif in_str and c == '\r':
            out.append('\\r')
        elif in_str and c == '\t':
            out.append('\\t')
        else:
            out.append(c)
        i += 1

    return ''.join(out)


def _parse_json_robust(raw: str) -> dict | None:
    """
    Try progressively more lenient strategies to parse an AI JSON response.

    Strategy order:
      1. raw_decode on original   — fast path for well-formed JSON (ignores preamble/postamble)
      2. raw_decode on repaired   — fixes unescaped LaTeX backslashes FIRST then uses smart extractor
      3. json.loads on variants   — full-string fallback
      4. Greedy regex + repair    — last resort
    """
    import json, re

    def _strip(s: str) -> str:
        s = re.sub(r"^```(?:json)?\s*", "", s.strip())
        return re.sub(r"\s*```$", "", s).strip()

    def _try_raw_decode(text: str) -> dict | None:
        """Find the first valid JSON object in text, ignore surrounding content."""
        decoder = json.JSONDecoder()
        for i, ch in enumerate(text):
            if ch == '{':
                try:
                    obj, _ = decoder.raw_decode(text, i)
                    if isinstance(obj, dict):
                        return obj
                except json.JSONDecodeError:
                    pass
        return None

    stripped = _strip(raw)

    # ── Strategy 1: raw_decode original ──────────────────────────────────────
    result = _try_raw_decode(stripped)
    if result:
        return result

    # ── Strategy 2: repair FIRST (fixes \int, \frac, \sqrt …) then raw_decode
    repaired = _repair_json(raw)
    repaired_stripped = _strip(repaired)
    result = _try_raw_decode(repaired_stripped)
    if result:
        return result

    # ── Strategy 3: json.loads on variants ───────────────────────────────────
    for attempt in [repaired, repaired_stripped, stripped, raw.strip()]:
        try:
            result = json.loads(attempt)
            if isinstance(result, dict):
                return result
        except (json.JSONDecodeError, ValueError):
            pass

    # ── Strategy 4: extract first {…} block then repair ─────────────────────
    for source in [repaired_stripped, stripped]:
        m = re.search(r'\{[\s\S]*\}', source)
        if m:
            for chunk in [m.group(), _repair_json(m.group())]:
                try:
                    result = json.loads(chunk)
                    if isinstance(result, dict):
                        return result
                except (json.JSONDecodeError, ValueError):
                    pass

    return None


# ── Math notation guidance (shared by both text and image prompts) ─────────────
_MATH_NOTATION_RULE = (
    "MATH NOTATION: Write all math using Unicode symbols and plain ASCII — "
    "NEVER use LaTeX backslash commands (\\\\frac, \\\\sqrt, \\\\alpha …) because "
    "they break JSON. Instead use: √ for sqrt, α β γ δ θ π ∞ ∫ Σ Δ ± · for Greek/"
    "operators, x^2 for powers, a/b for fractions, lim( ) for limits, etc."
)


@_tag_task
async def extract_pdf_text(file_bytes: bytes) -> str:
    """
    Extract text from a PDF.

    Strategy (in priority order):
      1. PyMuPDF  — best quality, layout-aware, auto-OCRs scanned pages
      2. pypdf    — pure-Python fallback (text-only PDFs)
      3. PyPDF2   — legacy fallback

    Returns concatenated text of all pages.
    """
    import io, base64 as b64lib

    # ── Option 1: PyMuPDF (must be installed: pip install pymupdf) ────────────
    try:
        import fitz  # pymupdf

        doc = fitz.open(stream=file_bytes, filetype="pdf")
        pages_text: list[str] = []

        for page in doc:
            text = page.get_text("text").strip()
            if text:
                pages_text.append(text)
            else:
                # Scanned page — render to 2× PNG and OCR
                mat      = fitz.Matrix(2.0, 2.0)
                pix      = page.get_pixmap(matrix=mat, alpha=False)
                img_bytes = pix.tobytes("png")
                img_b64   = b64lib.b64encode(img_bytes).decode()
                try:
                    ocr_text = await _vision_ocr_page(img_b64)
                    if ocr_text.strip():
                        pages_text.append(ocr_text.strip())
                except Exception:
                    pass

        doc.close()
        return "\n\n".join(pages_text)

    except ImportError:
        import logging
        logging.getLogger("pclick").warning(
            "PyMuPDF (fitz) not installed — falling back to pypdf. "
            "Run: pip install 'pymupdf>=1.24.0'"
        )

    # ── Option 2: pypdf ────────────────────────────────────────────────────────
    try:
        import pypdf
        reader = pypdf.PdfReader(io.BytesIO(file_bytes))
        texts = [(p.extract_text() or "").strip() for p in reader.pages]
        return "\n\n".join(t for t in texts if t)
    except ImportError:
        pass
    except Exception:
        pass

    # ── Option 3: PyPDF2 (legacy) ─────────────────────────────────────────────
    try:
        import PyPDF2
        reader = PyPDF2.PdfReader(io.BytesIO(file_bytes))
        texts = [(p.extract_text() or "").strip() for p in reader.pages]
        return "\n\n".join(t for t in texts if t)
    except ImportError:
        pass
    except Exception:
        pass

    return ""  # nothing worked — caller will return a clean error


async def _vision_ocr_page(img_b64: str) -> str:
    """
    OCR a single rendered PDF page (base64 PNG).
    Priority:
      1. Ollama vision model   (free, if OLLAMA_VISION_MODEL set in .env)
      2. Gemini Pro 2.5        (fallback if Ollama unavailable)
      3. pytesseract           (fully local, no API)
    """
    import base64 as b64lib

    ocr_prompt = [{
        "role": "user",
        "content": [
            {"type": "image_url", "image_url": {"url": f"data:image/png;base64,{img_b64}"}},
            {"type": "text", "text": (
                "Transcribe ALL text from this page exactly as it appears. "
                "Preserve numbering, math notation, and formatting. "
                "Output plain text only — no commentary."
            )},
        ],
    }]

    # 1. Ollama vision (only if OLLAMA_VISION_MODEL set in .env)
    if _use_ollama() and settings.ollama_vision_model:
        try:
            resp = await _ollama_vision_call(
                ocr_prompt, settings.ollama_vision_model, temperature=0.0, max_tokens=2048
            )
            text = extract_text(resp).strip()
            if len(text) >= 30:
                return text
        except Exception:
            pass

    # 2. Gemini Pro 2.5 vision (fallback if Ollama unavailable/unconfigured)
    if _use_google():
        try:
            resp = await _gemini_vision_call(ocr_prompt, temperature=0.0, max_tokens=2048)
            text = extract_text(resp).strip()
            if len(text) >= 30:
                return text
        except Exception:
            pass

    # 3. pytesseract (local, no API)
    img_bytes = b64lib.b64decode(img_b64)
    return _tesseract_ocr(img_bytes)


def _tesseract_ocr(image_bytes: bytes) -> str:
    """
    Free local OCR using pytesseract + Pillow preprocessing.
    Preprocessing: grayscale → upscale → sharpen → threshold → tesseract.
    Logs the error and returns empty string on failure.
    """
    import logging
    log = logging.getLogger("pclick")
    try:
        from PIL import Image, ImageFilter
        import io, pytesseract

        img = Image.open(io.BytesIO(image_bytes)).convert("L")   # grayscale

        # Upscale small images — tesseract needs ≥300 dpi equivalent
        w, h = img.size
        if max(w, h) < 1500:
            scale = max(2, 1500 // max(w, h))
            img = img.resize((w * scale, h * scale), Image.LANCZOS)

        img = img.filter(ImageFilter.SHARPEN)
        img = img.point(lambda x: 255 if x > 127 else 0, "1").convert("L")

        cfg = "--oem 3 --psm 6"
        text = pytesseract.image_to_string(img, config=cfg, lang="eng")
        result = text.strip()
        log.info("tesseract extracted %d chars", len(result))
        return result
    except Exception as exc:
        log.warning("tesseract failed: %s", exc)
        return ""


@_tag_task
async def quick_difficulty_scan(image_b64: str, filename: str = "") -> dict:
    """
    Quick visual difficulty assessment — glances at title + first few problems
    WITHOUT doing full extraction. Used to route PDF processing intensity.

    Returns:
      {
        "difficulty": "easy" | "medium" | "hard" | "very_hard",
        "rationale":  "<1 sentence>",
        "subject_area": "<math|physics|chemistry|biology|other>",
        "estimated_problems": <int | null>
      }

    Uses Gemini Flash (fast, cheap) — accuracy not critical here.
    Falls back to Groq text-only heuristic on vision failure.
    """
    import logging
    log = logging.getLogger("pclick")

    prompt_text = (
        "Quick scan ONLY — no detailed analysis, no problem solving.\n\n"
        "Look at:\n"
        "1. Title / header\n"
        "2. First 2-3 problems (just the surface — don't solve)\n\n"
        "Estimate difficulty and return ONLY valid JSON (no markdown):\n"
        '{"difficulty":"easy"|"medium"|"hard"|"very_hard",'
        '"rationale":"<1 sentence>","subject_area":"math|physics|chemistry|biology|other",'
        '"estimated_problems":<int or null>}\n\n'
        "Difficulty scale:\n"
        "- easy:      direct substitution, single formula, basic arithmetic\n"
        "- medium:    multi-step, requires combining 2-3 concepts\n"
        "- hard:      proof-required, deep conceptual understanding, complex algebra\n"
        "- very_hard: olympiad-level, research-level, highly abstract"
    )

    messages = [{
        "role": "user",
        "content": [
            {"type": "image_url", "image_url": {"url": f"data:image/png;base64,{image_b64}"}},
            {"type": "text", "text": prompt_text},
        ],
    }]

    # Use Gemini Flash (fast, low cost) for quick scan
    if _use_google():
        try:
            payload: dict[str, Any] = {
                "model":       settings.google_primary_model,  # gemini-2.5-flash
                "messages":    messages,
                "temperature": 0.1,
                "max_tokens":  256,
                "stream":      False,
            }
            headers = {
                "Authorization": f"Bearer {settings.google_api_key}",
                "Content-Type":  "application/json",
            }
            async with httpx.AsyncClient(timeout=20) as client:
                resp = await client.post(GOOGLE_CHAT_URL, headers=headers, json=payload)
                resp.raise_for_status()
                data = resp.json()
                raw = extract_text(data)
                parsed = _parse_json_robust(raw)
                if parsed and parsed.get("difficulty"):
                    log.info("quick_difficulty_scan: %s (%s)", parsed["difficulty"], filename)
                    return parsed
        except Exception as e:
            log.warning("quick_difficulty_scan Gemini failed: %s", e)

    # Fallback: default to medium so the standard 2-critic path runs
    log.warning("quick_difficulty_scan: fallback → medium (filename=%s)", filename)
    return {
        "difficulty": "medium",
        "rationale": "Could not assess — defaulting to medium",
        "subject_area": "other",
        "estimated_problems": None,
    }


def _crop_question_image(image_bytes: bytes, y_start: float, y_end: float) -> str:
    """
    Crop a horizontal band from the image between y_start% and y_end% of its height.
    Adds a small margin, saves as JPEG, returns base64 string.
    """
    from PIL import Image
    import io, base64 as b64lib

    img = Image.open(io.BytesIO(image_bytes))
    w, h = img.size

    pad = max(8, int(h * 0.012))          # ~1.2% padding, minimum 8px
    y1  = max(0,  int(h * y_start / 100) - pad)
    y2  = min(h,  int(h * y_end   / 100) + pad)

    crop = img.crop((0, y1, w, y2))
    if crop.mode in ("RGBA", "P"):
        crop = crop.convert("RGB")

    buf = io.BytesIO()
    crop.save(buf, format="JPEG", quality=88, optimize=True)
    return b64lib.b64encode(buf.getvalue()).decode()


@_tag_task
async def analyze_image_pset_direct(
    image_bytes: bytes,
    mime_type: str,
    filename: str,
) -> dict:
    """
    Single-shot vision analysis:
    - Gemini Flash reads the image and outputs JSON with question text + vertical position %
    - Backend crops the original image for each question using those coordinates
    - Each problem gets an image_crop (base64 JPEG) instead of rendered text
    """
    import base64
    b64 = base64.b64encode(image_bytes).decode()

    system = (
        "You are a problem set analyzer with vision capability.\n\n"
        "TASK: Identify every NUMBERED MAIN QUESTION — return one entry per main question number.\n\n"
        "QUESTION BOUNDARIES:\n"
        "  A main question starts with a number/label: 1. / 2.  or  1B-1 / 1B-2  or  Q1 / Problem 1\n"
        "  ALL sub-parts a) b) c) belonging to it are included in ONE entry — do NOT split them.\n\n"
        "BOUNDING BOX:\n"
        "  y_start: top of the question number label as % of image height (0=top, 100=bottom)\n"
        "  y_end:   bottom of the last sub-part of that question as % of image height\n"
        "  TIGHT margins only: 1-2% padding. E.g. if Q1 spans rows 8%-34%, return y_start=7, y_end=35.\n"
        "  Never return 0-100 or page-wide ranges unless the question truly occupies the whole image.\n\n"
        "SPECIAL RULE — figures:\n"
        "  Short label near diagram → expand y_start/y_end to include the diagram.\n"
        "  Append [Figure: brief description] to prompt field.\n\n"
        "FIELDS:\n"
        f"- {_MATH_NOTATION_RULE}\n"
        "- label: the EXACT question marker as printed, nothing added (e.g. '1B-1', 'Problem 12', 'Q3') — "
        "  used as this question's locator/reference code elsewhere in the app, so it must match the page exactly.\n"
        "- title: 6 words max, include question number (e.g. '1B-1 Average velocity')\n"
        "- prompt: full text including all sub-parts on ONE LINE (no literal newlines)\n"
        "- difficulty: easy | medium | hard | extreme\n"
        "- concepts: 1-4 tags\n\n"
        "Return ONLY valid JSON, no markdown fences, no trailing commas:\n"
        '{"summary":"...","problems":['
        '{"id":"1","label":"1B-1","title":"1B-1 Test tube drop","prompt":"...sub-parts included...","difficulty":"medium","concepts":["calculus"],'
        '"y_start":7,"y_end":36},'
        '{"id":"2","label":"1B-2","title":"1B-2 Tennis ball height","prompt":"...","difficulty":"medium","concepts":["derivatives"],'
        '"y_start":40,"y_end":68}]}'
    )

    messages = [
        {"role": "system", "content": system},
        {
            "role": "user",
            "content": [
                {"type": "image_url", "image_url": {"url": f"data:{mime_type};base64,{b64}"}},
                {"type": "text", "text": "Extract all questions with their vertical positions and return the JSON."},
            ],
        },
    ]

    import logging
    log = logging.getLogger("pclick")

    def _apply_crops(parsed: dict) -> dict:
        """Crop image regions for each problem using y_start / y_end percent."""
        for prob in parsed.get("problems", []):
            y0 = prob.pop("y_start", None)
            y1 = prob.pop("y_end", None)
            if y0 is not None and y1 is not None and 0 <= float(y0) < float(y1) <= 100:
                try:
                    prob["image_crop"] = _crop_question_image(image_bytes, float(y0), float(y1))
                except Exception:
                    pass
        return parsed

    # ── Attempt 1: Gemini Pro 2.5 Vision (primary) ───────────────────────────
    if _use_google():
        try:
            log.info("analyze_image_pset_direct: trying Gemini Pro 2.5 vision")
            resp = await _gemini_vision_call(messages, temperature=0.1, max_tokens=4096)
            raw = extract_text(resp)
            parsed = _parse_json_robust(raw)
            if parsed and "problems" in parsed and len(parsed["problems"]) > 0:
                _apply_crops(parsed)
                parsed["source_file"] = filename
                log.info("analyze_image_pset_direct: Gemini Pro vision succeeded (%d problems)", len(parsed["problems"]))
                return parsed
            log.warning("analyze_image_pset_direct: Gemini Pro returned no problems, trying OpenAI")
        except Exception as e:
            log.warning("analyze_image_pset_direct: Gemini Pro vision failed (%s)", e)

    # ── Attempt 2: OpenAI GPT-4o Vision (secondary) ──────────────────────────
    if _use_openai():
        try:
            log.info("analyze_image_pset_direct: trying OpenAI GPT-4o vision")
            resp = await _openai_vision_call(messages, temperature=0.1, max_tokens=4096)
            raw = extract_text(resp)
            parsed = _parse_json_robust(raw)
            if parsed and "problems" in parsed and len(parsed["problems"]) > 0:
                _apply_crops(parsed)
                parsed["source_file"] = filename
                log.info("analyze_image_pset_direct: OpenAI GPT-4o succeeded (%d problems)", len(parsed["problems"]))
                return parsed
            log.warning("analyze_image_pset_direct: OpenAI returned no problems, trying NVIDIA NIM")
        except Exception as e:
            log.warning("analyze_image_pset_direct: OpenAI vision failed (%s)", e)

    # ── Attempt 3: NVIDIA Llama 3.2 11B Vision (NIM fallback) ────────────────
    if settings.nvidia_vision_key:
        try:
            log.info("analyze_image_pset_direct: trying NVIDIA Llama 3.2 11B Vision")
            resp = await _nvidia_vision_call(messages, temperature=0.1, max_tokens=4096)
            raw = extract_text(resp)
            parsed = _parse_json_robust(raw)
            if parsed and "problems" in parsed and len(parsed["problems"]) > 0:
                _apply_crops(parsed)
                parsed["source_file"] = filename
                log.info("analyze_image_pset_direct: NVIDIA vision succeeded (%d problems)", len(parsed["problems"]))
                return parsed
            # Vision worked but JSON failed — try plain OCR fallback with NVIDIA
            log.warning("analyze_image_pset_direct: NVIDIA vision returned no problems, trying OCR path")
            ocr_messages = [{
                "role": "user",
                "content": [
                    {"type": "image_url", "image_url": {"url": f"data:{mime_type};base64,{b64}"}},
                    {"type": "text", "text": (
                        "Transcribe ALL text from this problem set image exactly as written. "
                        "Preserve question numbers, sub-question labels (a, b, c), and "
                        "mathematical notation. Output plain text only, no JSON."
                    )},
                ],
            }]
            ocr_resp = await _nvidia_vision_call(ocr_messages, temperature=0.05, max_tokens=4096)
            ocr_text = extract_text(ocr_resp).strip()
            if ocr_text:
                result = await decompose_pset(ocr_text)
                result["source_file"] = filename
                return result
        except Exception as e:
            log.warning("analyze_image_pset_direct: NVIDIA vision failed (%s)", e)

    # ── Attempt 3: Ollama vision (only if OLLAMA_VISION_MODEL is set in .env) ──
    ollama_json_ok = False
    if _use_ollama() and settings.ollama_vision_model:  # type: ignore[truthy-bool]
        try:
            log.info("Trying Ollama vision model: %s", settings.ollama_vision_model)
            resp = await _ollama_vision_call(
                messages, settings.ollama_vision_model, temperature=0.1, max_tokens=2048
            )
            raw    = extract_text(resp)
            parsed = _parse_json_robust(raw)

            if parsed and "problems" in parsed:
                _apply_crops(parsed)
                parsed["source_file"] = filename
                return parsed

            ollama_json_ok = True  # call worked but JSON parse failed
        except Exception as e:
            log.warning("Ollama vision failed (%s)", e)

    # ── Attempt 2a: Ollama vision plain OCR → Ollama text decompose ──────────
    if ollama_json_ok and settings.ollama_vision_model:
        try:
            ocr_messages = [{
                "role": "user",
                "content": [
                    {"type": "image_url", "image_url": {"url": f"data:{mime_type};base64,{b64}"}},
                    {"type": "text", "text": (
                        "Transcribe ALL text from this problem set image exactly as written. "
                        "Preserve question numbers, sub-question labels (a, b, c), and "
                        "mathematical notation. Output plain text only, no JSON."
                    )},
                ],
            }]
            ocr_resp = await _ollama_vision_call(
                ocr_messages, settings.ollama_vision_model, temperature=0.05, max_tokens=2048
            )
            ocr_text = extract_text(ocr_resp).strip()
            if ocr_text:
                result = await decompose_pset(ocr_text)
                result["source_file"] = filename
                return result
        except Exception:
            pass

    # ── Attempt 4: local Tesseract OCR ───────────────────────────────────────
    log.info("analyze_image_pset_direct: falling back to pytesseract")
    tess_text = _tesseract_ocr(image_bytes)
    if tess_text.strip():
        result = await decompose_pset(tess_text)
        result["source_file"] = filename
        return result

    # Nothing worked — return an informative error the frontend can display
    hints: list[str] = []
    if not settings.openai_api_key:
        hints.append("add OPENAI_API_KEY to .env for GPT-4o vision (primary)")
    if not settings.google_api_key:
        hints.append("add GOOGLE_API_KEY to .env for Gemini Pro 2.5 vision (secondary)")
    if not settings.nvidia_vision_key:
        hints.append("add NVIDIA_VISION_KEY to .env for Llama 3.2 11B vision (NIM fallback)")
    hints.append("brew install tesseract  (if not installed)")
    hints.append("try pasting the text manually instead")

    return {
        "error": "parse_failed",
        "raw_text": " ".join(hints),   # non-empty → frontend shows textarea with hint
        "summary": "Could not extract text from image. Hints: " + "; ".join(hints),
        "problems": [],
        "source_file": filename,
    }


def _extract_pdf_figures(file_bytes: bytes, max_figures: int = 16) -> list[dict]:
    """
    Extract visual content from a PDF:
      1. Raster images (PNG/JPEG embedded in the PDF)
      2. Pages with significant vector graphics (charts/diagrams drawn with PDF paths)
         rendered as JPEG at screen resolution

    Returns a list of dicts with keys: page, type, mime, data (base64), label
    """
    try:
        import fitz, base64 as b64lib
        doc = fitz.open(stream=file_bytes, filetype="pdf")
        figures: list[dict] = []
        seen_xrefs: set[int] = set()

        for page_num, page in enumerate(doc):
            before_count = len(figures)

            # ── Step 1: extract raster images embedded on this page ──────────
            for img_tuple in page.get_images(full=True):
                xref = img_tuple[0]
                if xref in seen_xrefs:
                    continue
                seen_xrefs.add(xref)
                try:
                    base_img = doc.extract_image(xref)
                    img_bytes = base_img.get("image", b"")
                    # Skip tiny images — icons, bullet glyphs, decorators
                    if len(img_bytes) < 4_000:
                        continue
                    ext_str = base_img.get("ext", "png")
                    mime = "image/jpeg" if ext_str in ("jpg", "jpeg") else f"image/{ext_str}"
                    figures.append({
                        "page": page_num + 1,
                        "type": "embedded",
                        "mime": mime,
                        "data": b64lib.b64encode(img_bytes).decode(),
                        "label": f"Figure — page {page_num + 1}",
                    })
                except Exception:
                    pass
                if len(figures) >= max_figures:
                    break

            # ── Step 2: detect pages with vector graphics (charts/diagrams) ──
            # Only render if no raster image was already found on this page
            if len(figures) == before_count:
                try:
                    drawings = page.get_drawings()
                    # Filter to paths with 3+ points (skip single lines / borders)
                    real_draws = [d for d in drawings
                                  if d.get("items") and len(d["items"]) >= 3]
                    # Render if 4+ real drawing elements (lowered from 8)
                    if len(real_draws) >= 4:
                        mat = fitz.Matrix(1.5, 1.5)   # ~108 dpi
                        pix = page.get_pixmap(matrix=mat, alpha=False)
                        img_bytes = pix.tobytes("jpeg")
                        if len(img_bytes) > 4_000:    # not blank
                            figures.append({
                                "page": page_num + 1,
                                "type": "vector_render",
                                "mime": "image/jpeg",
                                "data": b64lib.b64encode(img_bytes).decode(),
                                "label": f"Diagram — page {page_num + 1}",
                            })
                except Exception:
                    pass

            if len(figures) >= max_figures:
                break

        doc.close()
        return figures
    except Exception:
        import logging
        logging.getLogger("pclick").warning("_extract_pdf_figures failed", exc_info=True)
        return []


async def _describe_figures(figures: list[dict]) -> None:
    """
    Use Google Gemini (vision) to describe each figure in-place.
    Updates figure["label"] and figure["figure_type"] on each dict.
    Skips silently if Google is not configured.
    """
    if not _use_google() or not figures:
        return

    import asyncio, logging
    log = logging.getLogger("pclick")

    async def _describe_one(fig: dict) -> None:
        try:
            img_url = f"data:{fig['mime']};base64,{fig['data']}"
            resp = await _google_call(
                messages=[{
                    "role": "user",
                    "content": [
                        {"type": "image_url", "image_url": {"url": img_url}},
                        {"type": "text", "text": (
                            "Describe this figure from a science/math problem set in 1-2 sentences. "
                            "Start with its type, e.g.: 'Line graph showing…', 'Bar chart comparing…', "
                            "'Diagram of…', 'Photo of…', 'Table listing…', 'Circuit diagram…', "
                            "'Free body diagram…'. Be concise and specific."
                        )},
                    ],
                }],
                model=settings.google_primary_model,
                temperature=0.1,
                max_tokens=120,
            )
            desc = extract_text(resp).strip()
            if desc:
                fig["label"] = desc
                # Derive a short type tag from the first word pair
                first_words = desc.split()[:3]
                fig["figure_type"] = " ".join(first_words).rstrip(".,:")
        except Exception as e:
            log.warning("_describe_one figure failed: %s", e)

    await asyncio.gather(*[_describe_one(f) for f in figures])


async def _link_figures_to_problems(figures: list[dict], problems: list[dict]) -> None:
    """
    Use Gemini Flash vision to match each extracted PDF figure to its most relevant question.
    Updates problems in-place: sets image_crop + image_mime on the matched problem.
    Best-effort — silently ignores any failures.
    """
    if not figures or not problems or not _use_google():
        return

    import logging, asyncio
    log = logging.getLogger("pclick")

    # Build a compact index of all problems for the prompt
    problem_index = "\n".join(
        f"[{p['id']}] {(p.get('title') or p.get('prompt', ''))[:100]}"
        for p in problems
    )

    async def _match_one(fig: dict) -> None:
        try:
            mime = fig.get("mime", "image/jpeg")
            data = fig.get("data", "")
            if not data:
                return
            fig_label = fig.get("label", "")
            fig_page  = fig.get("page", "?")
            resp = await _gemini_vision_call(
                messages=[{
                    "role": "user",
                    "content": [
                        {"type": "image_url", "image_url": {"url": f"data:{mime};base64,{data}"}},
                        {"type": "text", "text": (
                            f"This figure (page {fig_page}{', described as: ' + fig_label if fig_label else ''}) "
                            "was extracted from a problem set PDF.\n"
                            "Below are the questions in this problem set:\n\n"
                            f"{problem_index}\n\n"
                            "MATCHING RULES:\n"
                            "1. If a question text is just a SHORT LABEL or NAME (e.g. 'Aspirin', 'Compound A', "
                            "'Figure 2', 'Circuit diagram') with no verb — it is almost certainly paired with a nearby figure. "
                            "Match this figure to that question if the content is relevant.\n"
                            "2. Match by CONTENT: does the figure show the structure, graph, or diagram the question refers to?\n"
                            "3. Match by PAGE PROXIMITY: figures appear on the same page as their question.\n\n"
                            "Which question ID does this figure most likely belong to? "
                            "Reply with ONLY the question ID (e.g. '1', '2', '3b'). "
                            "If this figure clearly does not belong to any question, reply 'none'."
                        )},
                    ],
                }],
                temperature=0.0,
                max_tokens=10,
            )
            matched_id = extract_text(resp).strip().strip("[]'\" \n").lower()
            if matched_id and matched_id != "none":
                for prob in problems:
                    if str(prob.get("id", "")).lower() == matched_id:
                        if not prob.get("image_crop"):  # don't overwrite existing crops
                            prob["image_crop"] = data
                            prob["image_mime"] = mime
                            log.info(
                                "_link_figures_to_problems: figure (page %s, %s) → problem %s",
                                fig.get("page"), fig.get("figure_type", ""), matched_id,
                            )
                        break
        except Exception as e:
            log.warning("_link_figures_to_problems: failed for one figure: %s", e)

    await asyncio.gather(*[_match_one(f) for f in figures])


def _render_pdf_pages(file_bytes: bytes, max_pages: int = 20, dpi: int = 120) -> list[dict]:
    """
    Render each PDF page as a JPEG image.
    Returns [{index, data (base64 JPEG), width, height}].
    Uses PyMuPDF (fitz) — already required for figure extraction.
    """
    try:
        import fitz, base64 as b64lib
        doc = fitz.open(stream=file_bytes, filetype="pdf")
        pages: list[dict] = []
        mat = fitz.Matrix(dpi / 72, dpi / 72)
        for i, page in enumerate(doc):
            if i >= max_pages:
                break
            pix = page.get_pixmap(matrix=mat, alpha=False)
            b64 = b64lib.b64encode(pix.tobytes("jpeg")).decode()
            pages.append({"index": i, "data": b64, "width": pix.width, "height": pix.height})
        doc.close()
        return pages
    except Exception as e:
        import logging
        logging.getLogger("pclick").warning("_render_pdf_pages failed: %s", e)
        return []


_PAGE_QUESTION_PROMPT = (
    "TASK: Find every NUMBERED MAIN QUESTION on this page and return them as JSON.\n\n"
    "Do NOT assume how many questions are on a page — pages vary from 0 to many. "
    "Scan the page top to bottom and detect each new question boundary independently; "
    "never pad or guess extra entries to hit a round number.\n\n"
    "A question boundary is marked by a label that is BOLD and/or sits at the START of its "
    "own line (not mid-sentence). Recognized label patterns:\n"
    "  • Arabic:      1.  2.  3.\n"
    "  • Lettered:    1A  1B  2A  1a  1b  A.  B.\n"
    "  • Compound:    1B-1  1B-2  2C-3  (each is a separate main question)\n"
    "  • Parenthesised: (1)  (2)  (i)  (ii)\n"
    "  • Keywords:    Q1  Q2  Problem 1  Problem 12  Exercise 3  Part A\n"
    "  Sub-parts a) b) c) that belong to a parent question are NOT separate — include in parent prompt.\n\n"
    "LABEL FIELD:\n"
    "  label: the EXACT marker text as printed, nothing else added — e.g. \"1B-2\", \"Problem 12\", \"Q3\", \"(ii)\".\n"
    "  This is used as the question's locator/reference code elsewhere in the app, so it must match the "
    "  printed page exactly (same digits/letters), not a re-derived or renumbered value.\n\n"
    "BOUNDING BOX (relative to THIS page's height, 0=top 100=bottom):\n"
    "  y_start: top of the question number label (tight — 1-2% padding only)\n"
    "  y_end:   bottom of the last sub-part of that question\n"
    "  Never return 0 and 100 unless the question truly fills the whole page.\n\n"
    "Return ONLY valid JSON:\n"
    '{"problems":['
    '{"id":"PLACEHOLDER","label":"1B-1","title":"1B-1 Velocity from drop",'
    '"prompt":"full text of question + all sub-parts on one line",'
    '"difficulty":"medium","concepts":["kinematics"],'
    '"y_start":8,"y_end":38}]}'
    "\nIf this page has NO questions — a cover page, a table of contents, or a page of instructions/"
    "formatting guidance about how to fill out or structure answers rather than an actual problem to "
    "solve — return {\"problems\":[]}. Such pages should never contribute any entries."
)


async def _analyze_one_page(pg: dict, page_count: int) -> list[dict]:
    """Analyze a single PDF page. Returns list of problem dicts with 'page' set."""
    import logging
    log = logging.getLogger("pclick")
    page_idx = pg["index"]
    content = [
        {"type": "text", "text": f"This is page {page_idx + 1} of {page_count}."},
        {"type": "image_url", "image_url": {"url": f"data:image/jpeg;base64,{pg['data']}"}},
        {"type": "text", "text": _PAGE_QUESTION_PROMPT},
    ]
    try:
        resp = await _gemini_vision_call(
            messages=[{"role": "user", "content": content}],
            temperature=0.1,
            max_tokens=2048,
        )
        raw = extract_text(resp)
        parsed = _parse_json_robust(raw)
        if parsed and isinstance(parsed.get("problems"), list):
            for prob in parsed["problems"]:
                prob["page"] = page_idx   # always override with correct index
            log.info("  page %d → %d problems", page_idx, len(parsed["problems"]))
            return parsed["problems"]
    except Exception as e:
        log.warning("_analyze_one_page page=%d failed: %s", page_idx, e)
    return []


async def _analyze_pdf_pages_vision(pages: list[dict]) -> dict:
    """
    Analyze each PDF page in parallel (one Gemini call per page).
    Returns {summary, problems: [{id, title, prompt, difficulty, concepts, page, y_start, y_end}]}.
    page is 0-based; y_start/y_end are percent of that page's height.
    """
    if not pages or not _use_google():
        return {"summary": "", "problems": []}

    import asyncio, logging
    log = logging.getLogger("pclick")
    log.info("_analyze_pdf_pages_vision: processing %d pages in parallel", len(pages))

    # Run all pages concurrently
    results = await asyncio.gather(
        *[_analyze_one_page(pg, len(pages)) for pg in pages],
        return_exceptions=True,
    )

    all_problems: list[dict] = []
    for r in results:
        if isinstance(r, list):
            all_problems.extend(r)

    if not all_problems:
        log.warning("_analyze_pdf_pages_vision: no problems found across %d pages", len(pages))
        return {"summary": "", "problems": []}

    # Sort by page then vertical position, re-number IDs sequentially
    all_problems.sort(key=lambda p: (p.get("page", 0), p.get("y_start", 0)))
    for i, prob in enumerate(all_problems):
        prob["id"] = str(i + 1)

    log.info("_analyze_pdf_pages_vision: total %d problems from %d pages",
             len(all_problems), len(pages))
    return {"summary": "", "problems": all_problems}


@_tag_task
async def analyze_file_pset(file_bytes: bytes, filename: str, mime_type: str) -> dict:
    """
    Accept a PDF or image upload → extract questions + figures → return card data.
    All errors are caught and returned as a clean JSON dict (never raises).
    """
    ext = filename.lower().rsplit(".", 1)[-1] if "." in filename else ""

    try:
        if mime_type == "application/pdf" or ext == "pdf":
            import asyncio, logging
            log = logging.getLogger("pclick")

            # Render PDF pages as images (sync/CPU → thread pool)
            loop = asyncio.get_running_loop()
            pages: list[dict] = await loop.run_in_executor(None, _render_pdf_pages, file_bytes)
            log.info("PDF '%s': rendered %d pages", filename, len(pages))

            # ── Attempt 1: vision — analyze page 0 only (rest load on demand) ──
            first_page_problems: list[dict] = []
            if pages and _use_google():
                first_page_problems = await _analyze_one_page(pages[0], len(pages))

            if first_page_problems:
                log.info("PDF lens: %d problems on page 0 (total pages=%d)", len(first_page_problems), len(pages))
                slim_pages = [{"index": p["index"], "width": p["width"], "height": p["height"], "data": p["data"]} for p in pages]
                return {
                    "summary": "",
                    "problems": first_page_problems,
                    "pages": slim_pages,
                    "total_pages": len(pages),
                    "figures": [],
                    "source_file": filename,
                    "lens_mode": True,
                }

            # ── Attempt 2: text-based fallback (no position data) ──
            log.warning("PDF '%s': vision found no problems, falling back to text", filename)
            figures_future = loop.run_in_executor(None, _extract_pdf_figures, file_bytes)
            raw_text = await extract_pdf_text(file_bytes)
            figures = await figures_future
            log.info("PDF fallback: %d chars text, %d figures", len(raw_text), len(figures))

            if not raw_text.strip() and not figures:
                return {
                    "error": "parse_failed",
                    "raw_text": "",
                    "summary": "Could not extract content from this PDF.",
                    "problems": [],
                    "figures": [],
                    "pages": [{"index": p["index"], "width": p["width"], "height": p["height"], "data": p["data"]} for p in pages],
                    "source_file": filename,
                }

            if figures:
                await _describe_figures(figures)

            result = await decompose_pset(raw_text) if raw_text.strip() else {
                "summary": "",
                "problems": [],
                "error": "parse_failed",
                "raw_text": "",
            }

            if figures and result.get("problems"):
                await _link_figures_to_problems(figures, result["problems"])

            result["source_file"] = filename
            result["figures"] = figures
            result["pages"] = [{"index": p["index"], "width": p["width"], "height": p["height"], "data": p["data"]} for p in pages]
            result["lens_mode"] = False
            return result

        elif mime_type.startswith("image/") or ext in ("png", "jpg", "jpeg", "webp"):
            result = await analyze_image_pset_direct(
                file_bytes, mime_type or f"image/{ext or 'png'}", filename
            )
            result.setdefault("figures", [])
            return result

        else:
            return {
                "error": "unsupported_type",
                "raw_text": "",
                "summary": f"Unsupported file type: {filename}. Upload a PDF or PNG/JPG.",
                "problems": [],
                "figures": [],
                "source_file": filename,
            }

    except Exception as exc:
        import logging, traceback
        logging.getLogger("pclick").error("analyze_file_pset crashed: %s", traceback.format_exc())
        return {
            "error": "internal_error",
            "raw_text": "",
            "summary": f"Processing failed: {exc}",
            "problems": [],
            "figures": [],
            "source_file": filename,
        }


def _parse_delimiter_format(text: str) -> dict | None:
    """
    Parse the delimiter-based fallback format:

      SUMMARY: one line summary

      ---PROBLEM---
      ID: 1
      TITLE: Differentiate
      DIFFICULTY: medium
      CONCEPTS: derivatives, calculus
      PROMPT: Find f'(x) for f(x) = x^3 - 2x + 1

    Returns None if no problems found.
    """
    lines = text.strip().splitlines()
    summary = ""
    problems = []
    cur: dict | None = None

    for line in lines:
        stripped = line.strip()
        if stripped.startswith("SUMMARY:"):
            summary = stripped[8:].strip()
        elif stripped == "---PROBLEM---":
            if cur and cur.get("prompt"):
                problems.append(cur)
            cur = {"id": str(len(problems) + 1), "title": "", "prompt": "",
                   "difficulty": "medium", "concepts": []}
        elif cur is not None:
            if stripped.startswith("ID:"):
                cur["id"] = stripped[3:].strip()
            elif stripped.startswith("TITLE:"):
                cur["title"] = stripped[6:].strip()
            elif stripped.startswith("DIFFICULTY:"):
                cur["difficulty"] = stripped[11:].strip().lower()
            elif stripped.startswith("CONCEPTS:"):
                raw_c = stripped[9:].strip()
                cur["concepts"] = [c.strip() for c in raw_c.split(",") if c.strip()]
            elif stripped.startswith("PROMPT:"):
                cur["prompt"] = stripped[7:].strip()
            elif cur.get("prompt") and stripped:
                # continuation line of PROMPT
                cur["prompt"] += " " + stripped

    if cur and cur.get("prompt"):
        problems.append(cur)

    if not problems:
        return None
    return {"summary": summary, "problems": problems}


@_tag_task
async def decompose_pset(pset_text: str) -> dict:
    """
    Decompose a problem set into individual question cards.
    Sub-questions (a, b, c) become their own separate items.
    Returns { summary, problems: [{ id, title, prompt, difficulty, concepts }] }

    Strategy:
      1. Ask AI for JSON output → parse robustly
      2. If that fails → ask AI for delimiter format → parse with _parse_delimiter_format
      3. If both fail → return raw_text for frontend textarea retry
    """
    import logging
    log = logging.getLogger("pclick")

    MAX_CHARS = 12_000
    text_for_ai = pset_text[:MAX_CHARS] + ("\n...[truncated]" if len(pset_text) > MAX_CHARS else "")

    # ── Attempt 1: JSON format ────────────────────────────────────────────────
    json_system = (
        "You are Pclick's problem set analyzer. "
        "The input may contain garbled text from PDF extraction — that is normal. "
        "Understand the math, rewrite it clearly using Unicode (not LaTeX).\n\n"
        "CRITICAL — WHAT COUNTS AS A PROBLEM:\n"
        "A problem does NOT need a question mark. These are ALL valid problems:\n"
        "  - Imperative: 'Find x', 'Solve for y', 'Evaluate the integral', 'Prove that', 'Show that', 'Compute', 'Calculate', 'Determine', 'Simplify'\n"
        "  - Statement: 'A particle moves at velocity v(t) = 3t² − 2t. Find its acceleration at t=2.'\n"
        "  - Numbered: '1.', '2.', '(a)', 'Problem 1', 'Exercise 3', '1A-1'\n"
        "Treat EVERY task, exercise, or statement that requires the student to DO something as a problem.\n\n"
        "RULES:\n"
        "- Extract ALL items — numbered or not. Never skip an item because it lacks a '?'\n"
        "- Sub-questions a) b) c) → each is its OWN separate problem\n"
        f"- {_MATH_NOTATION_RULE}\n"
        "- prompt: copy the full problem text on ONE LINE. Wrap math expressions in LaTeX delimiters: $x^2$ for inline, $$\\frac{a}{b}$$ for display. Example: 'Find $\\frac{d}{dx}[x^2 + 3x]$ at $x=2$.'\n"
        "- difficulty: easy | medium | hard | extreme\n"
        "- concepts: broad topic tags (e.g. ['calculus', 'derivatives'])\n"
        "- required_tools: SPECIFIC methods/algorithms the student MUST use to solve this — not topic names, but actual techniques. "
        "Example: calculus problem → ['power rule', 'chain rule'], NOT ['calculus']. "
        "Integration problem → ['substitution', 'integration by parts']. "
        "This list is used to enforce that students explain using the correct tools, not lower-level shortcuts.\n"
        "- If text looks like a problem set, return EVERY task as a separate problem.\n\n"
        'Return ONLY valid JSON (no markdown, no extra text, no backslash commands in strings):\n'
        '{"summary":"...","problems":[{"id":"1","title":"...","prompt":"...","difficulty":"medium","concepts":["..."],"required_tools":["..."]}]}'
    )

    raw1 = ""
    try:
        resp = await chat(
            [{"role": "system", "content": json_system},
             {"role": "user",   "content": f"Problem set:\n\n{text_for_ai}"}],
            temperature=0.2,
            max_tokens=4096,
        )
        raw1 = extract_text(resp)
        log.info("decompose_pset JSON raw (first 400): %s", raw1[:400])
        parsed = _parse_json_robust(raw1)

        if parsed and parsed.get("problems"):
            log.info("decompose_pset JSON success: %d problems", len(parsed["problems"]))
            return parsed
        if parsed:
            log.warning("decompose_pset JSON parsed but problems=[]. Raw: %s", raw1[:300])
        else:
            log.warning("decompose_pset JSON parse FAILED. Raw: %s", raw1[:300])
    except Exception as e:
        log.warning("decompose_pset JSON attempt failed (AI error): %s", e)

    # ── Attempt 2: delimiter format (impossible to break with math chars) ─────
    delim_system = (
        "You are Pclick's problem set analyzer. "
        "Extract ALL tasks/problems from the text below. "
        "The text may be garbled from PDF extraction — look for problem structure by numbering.\n\n"
        "IMPORTANT: A problem does NOT need a '?'. These are valid problems:\n"
        "  'Find x', 'Solve for y', 'Evaluate the integral', 'Prove that', 'Show that', 'Compute', 'Simplify'\n"
        "Treat EVERY task that requires the student to DO something as a problem.\n\n"
        "Output each problem using EXACTLY this format:\n\n"
        "SUMMARY: [1-2 sentence description of the problem set]\n\n"
        "---PROBLEM---\n"
        "ID: [e.g. 1, 1a, 2, 1A-1]\n"
        "TITLE: [5 words max]\n"
        "DIFFICULTY: [easy|medium|hard|extreme]\n"
        "CONCEPTS: [comma-separated tags]\n"
        "PROMPT: [full problem text, math as Unicode or x^2 notation, ONE LINE]\n\n"
        "Rules:\n"
        "- Sub-questions a) b) c) each get their OWN ---PROBLEM--- block\n"
        "- Never skip a numbered item because it lacks a question mark\n"
        "- Use Unicode math: √ ∫ ∑ π ∞ etc. and x^2 for powers, (a)/(b) for fractions\n"
        "- NO backslash commands, NO JSON, NO markdown\n"
        "- Output ONLY the blocks above, nothing else."
    )

    raw2 = ""
    try:
        resp2 = await chat(
            [{"role": "system", "content": delim_system},
             {"role": "user",   "content": f"Problem set:\n\n{text_for_ai}"}],
            temperature=0.2,
            max_tokens=4096,
        )
        raw2 = extract_text(resp2)
        log.info("decompose_pset delimiter raw (first 400): %s", raw2[:400])
        parsed2 = _parse_delimiter_format(raw2)

        if parsed2 and parsed2.get("problems"):
            log.info("decompose_pset delimiter success: %d problems", len(parsed2["problems"]))
            return parsed2
    except Exception as e:
        log.warning("decompose_pset delimiter attempt failed (AI error): %s", e)

    log.error("decompose_pset BOTH attempts failed. JSON raw: %s | Delim raw: %s",
              raw1[:200], raw2[:200])

    # ── Attempt 3: regex splitter — no AI, splits on numbered items ───────────
    import re as _re
    # Match lines starting with: 1. / 1) / (1) / Problem 1 / Q1 / Exercise 1
    numbered = _re.split(
        r'\n(?=(?:\d+[\.\)]\s|\(\d+\)\s|(?:Problem|Exercise|Question|Q)\s*\d+[\s\.\:]|\d+[a-z][\.\)]\s))',
        pset_text.strip()
    )
    numbered = [p.strip() for p in numbered if p.strip() and len(p.strip()) > 10]
    if len(numbered) >= 2:
        problems = []
        for i, chunk in enumerate(numbered[:30]):  # cap at 30
            # First line is the prompt, rest is context
            first_line = chunk.split('\n')[0].strip()
            problems.append({
                "id": str(i + 1),
                "title": first_line[:40],
                "prompt": chunk.replace('\n', ' ')[:500],
                "difficulty": "medium",
                "concepts": [],
            })
        log.info("decompose_pset regex fallback: %d problems", len(problems))
        return {
            "summary": f"Extracted {len(problems)} problems from text (regex fallback).",
            "problems": problems,
        }

    # All 3 failed → expose raw text for manual retry in frontend
    return {
        "error": "parse_failed",
        "raw_text": pset_text,
        "raw": raw1,
        "summary": "AI could not identify questions. Text is in the box below — edit and click Analyze.",
        "problems": [],
    }


@_tag_task
async def clean_question(prompt: str, context: str = "") -> str:
    """
    Distil a raw question prompt using NVIDIA Nemotron (preferred) or best available AI.
    - Strips OCR noise, redundant preamble, page headers, question numbers
    - Keeps ONLY what the student needs to understand and solve the problem
    - Rewrites math in LaTeX $...$ / $$...$$ delimiters
    Returns a single clean string.
    """
    import logging
    log = logging.getLogger("pclick")

    system = (
        "You are a math/science problem distiller. "
        "Your job: take a raw question (possibly garbled from PDF OCR) and rewrite it as a "
        "clean, self-contained problem statement.\n\n"
        "RULES:\n"
        "- Remove: question numbers, page numbers, headers, footnotes, OCR artifacts, "
        "  redundant preamble like 'Answer the following:', irrelevant context\n"
        "- Keep: the actual task, all given values, constraints, what to find\n"
        "- Rewrite all math using LaTeX: $x^2$ for inline, $$\\frac{a}{b}$$ for display\n"
        "- Output ONLY the clean question — no preamble, no explanation, no quotes\n"
        "- One paragraph max. If it has sub-parts a) b) c) keep them on separate lines.\n"
        "- If the prompt is already clean, return it verbatim."
    )
    user_msg = prompt if not context else f"Context: {context}\n\nRaw question:\n{prompt}"
    messages = [
        {"role": "system", "content": system},
        {"role": "user",   "content": user_msg},
    ]

    # Prefer NVIDIA for this task (lightweight model, low latency)
    if _use_nvidia():
        try:
            log.info("clean_question → NVIDIA %s", settings.nvidia_primary_model)
            resp = await _nvidia_call(messages, settings.nvidia_primary_model, 0.2, 1024)
            text = extract_text(resp).strip()
            if text:
                return text
        except Exception as e:
            log.warning("NVIDIA clean_question failed: %s — trying fast chat", e)

    # Fallback: fast chat cascade (Groq llama-3.1-8b → Google gemma → NVIDIA)
    try:
        resp = await chat(messages, temperature=0.2, max_tokens=1024, prefer_fast=True)
        result = extract_text(resp).strip()
        return result or prompt
    except Exception as e:
        # All providers failed — return original prompt, distil is optional
        log.warning("clean_question all providers failed: %s — returning original", e)
        return prompt


async def _apply_wolfram_grade_check(items: list[dict], data: dict) -> dict:
    """
    Cross-check computational questions against WolframAlpha and append a
    reference note to that grade's feedback. Informational only — never
    flips `passed` itself, since Wolfram's short answer format doesn't
    reliably line up with how a student phrased their answer.
    """
    if not _wolfram.is_configured():
        return data
    by_id = {it["id"]: it for it in items}
    for grade in data.get("grades", []):
        item = by_id.get(grade.get("id"))
        if not item or not _wolfram.looks_computational(item.get("prompt", "")):
            continue
        try:
            answer = await _wolfram.compute(item["prompt"])
        except Exception:
            answer = None
        if answer:
            grade["feedback"] = f"{grade.get('feedback', '')} (WolframAlpha check: {answer})".strip()
    return data


@_tag_task
async def grade_all(items: list[dict]) -> dict:
    """
    Grade a batch of answered questions.
    Prefers Google Gemini Pro (same GOOGLE_API_KEY as the rest of the Gemini
    calls in this file), falling back to the Groq/Ollama chat() cascade if
    Gemini is unavailable or fails.
    items: [{id, prompt, answer}]
    Returns { grades: [{id, passed, feedback}] }
    """
    numbered = "\n\n".join(
        f"[{it['id']}]\nQuestion: {it['prompt']}\nAnswer: {it['answer']}"
        for it in items
    )
    system = (
        "You are a rigorous academic grader. Grade each student answer below.\n"
        "Return ONLY valid JSON — no markdown fences:\n"
        '{"grades":[{"id":"...","passed":true,"feedback":"brief explanation, use LaTeX $...$ for math"}]}\n\n'
        "Rules:\n"
        "- passed: true if substantially correct, false otherwise\n"
        "- feedback: 1-2 sentences max. For wrong answers explain the key error and correct approach.\n"
        "- Keep one grade object per question id, in the same order."
    )

    if _use_google():
        try:
            resp = await _google_call(
                [{"role": "system", "content": system},
                 {"role": "user",   "content": numbered}],
                model=settings.google_pro_model,
                temperature=0.1,
                max_tokens=2048,
            )
            raw = extract_text(resp)
            data = _parse_json_robust(raw)
            if data and "grades" in data:
                return await _apply_wolfram_grade_check(items, data)
        except Exception:
            import logging
            logging.getLogger("pclick").warning("grade_all: Gemini Pro failed, falling back", exc_info=True)

    resp = await chat(
        [{"role": "system", "content": system},
         {"role": "user",   "content": numbered}],
        temperature=0.1,
        max_tokens=2048,
        prefer_fast=True,
    )
    raw = extract_text(resp)
    try:
        data = _parse_json_robust(raw)
        if data and "grades" in data:
            return await _apply_wolfram_grade_check(items, data)
    except Exception:
        pass
    return {"grades": [{"id": it["id"], "passed": False, "feedback": "Could not grade."} for it in items]}


@_tag_task
async def get_hint(problem_text: str, hint_level: int = 1) -> str:
    """
    Return a Socratic hint for a problem at the given level (1=vague, 3=direct).
    Uses fast model (Llama 3.1 8B on Ollama — free, fast, 128K ctx).
    """
    guidance = {
        1: "Give a very vague directional hint — point to the right concept without naming it.",
        2: "Name the concept and suggest the first step without giving the solution.",
        3: "Walk through the first concrete step. Still don't give the answer.",
    }.get(hint_level, "Give a helpful hint.")

    system = (
        f"You are a Socratic math tutor. {guidance} "
        "Use LaTeX for all math expressions: $...$ for inline, $$...$$ for display math."
    )
    # ── RAG (SOC-17): ground hints in the indexed knowledge base to cut
    # down on factual/notational drift. Reference only — never quote the
    # final answer, that would defeat the Socratic method above.
    try:
        rag_context = _rag.context_for(problem_text)
    except Exception:
        rag_context = ""   # embedding model unavailable / KB not ready — degrade silently
    if rag_context:
        system += (
            "\n\nReference material from the knowledge base (for your own accuracy only — "
            f"do not reveal the solution):\n{rag_context}"
        )

    # ── Dual-role pipeline: primary drafts → Gemma reviewer refines ──────────
    # prefer_fast=True keeps the hint latency low (Groq llama-3.1-8b → Gemma);
    # Gemma's reviewer pass catches any calculation slip or unclear phrasing
    # before the hint reaches the student.
    result = await dual_role_chat(
        [{"role": "system", "content": system},
         {"role": "user",   "content": f"Problem:\n{problem_text}"}],
        temperature=0.5,
        max_tokens=512,
        prefer_fast=True,
    )
    return result["text"]


@_tag_task
async def check_mastery(problem: str, student_solution: str) -> dict:
    """
    Evaluate a student's solution and drive their mastery/progress update.

    Grading (correct / mastery_delta) uses Gemini Pro or the chat() cascade.
    Feedback text is then passed through the Gemma reviewer (_gemma_review_call)
    so the student-facing explanation is as clear and accurate as possible.

    Returns { correct: bool, mastery_delta: int (-10 to +20), feedback: str }
    """
    import json, re, logging
    log = logging.getLogger("pclick")

    system = (
        "You are a rigorous math grader. Evaluate the student's solution. "
        "Return ONLY JSON with: correct (bool), mastery_delta (int from -10 to 20), "
        "feedback (string). In the feedback string, use LaTeX for all math: $...$ for inline, $$...$$ for display."
    )
    messages = [
        {"role": "system", "content": system},
        {"role": "user",   "content": f"Problem:\n{problem}\n\nStudent solution:\n{student_solution}"},
    ]

    # ── Stage 1: grading (Gemini Pro → chat() cascade) ────────────────────
    result: dict | None = None
    if _use_google():
        try:
            resp = await _google_call(messages, model=settings.google_pro_model, temperature=0.2, max_tokens=512)
            raw = extract_text(resp)
            cleaned = re.sub(r"^```(?:json)?\n?", "", raw.strip())
            cleaned = re.sub(r"\n?```$", "", cleaned)
            result = json.loads(cleaned)
        except Exception:
            log.warning("check_mastery: Gemini Pro failed, falling back", exc_info=True)

    if result is None:
        resp = await chat(messages, temperature=0.2, max_tokens=512, prefer_fast=True)
        raw = extract_text(resp)
        cleaned = re.sub(r"^```(?:json)?\n?", "", raw.strip())
        cleaned = re.sub(r"\n?```$", "", cleaned)
        try:
            result = json.loads(cleaned)
        except json.JSONDecodeError:
            result = {"correct": False, "mastery_delta": 0, "feedback": raw}

    # ── Stage 2: Gemma reviewer refines the student-facing feedback ───────
    raw_feedback = result.get("feedback", "")
    if raw_feedback:
        refined = await _gemma_review_call(
            draft=raw_feedback,
            original_question=f"Problem: {problem}\n\nStudent solution: {student_solution}",
        )
        if refined:
            log.info("check_mastery: Gemma refined feedback (%d→%d chars)", len(raw_feedback), len(refined))
            result["feedback"] = refined

    return result


# ── Note synthesis (Meta Llama primary, Gemini Flash fallback) ─────────────

async def _wiki_image(concept: str) -> str | None:
    """Fetch a Wikipedia thumbnail for a concept. Returns URL or None."""
    try:
        slug = concept.strip().replace(" ", "_")
        async with httpx.AsyncClient(timeout=5) as client:
            r = await client.get(
                f"https://en.wikipedia.org/api/rest_v1/page/summary/{slug}",
                headers={"User-Agent": "LyceumAcademy/1.0 (https://www.thelyceum.site) httpx"},
                follow_redirects=True,
            )
            if r.status_code == 200:
                data = r.json()
                return data.get("thumbnail", {}).get("source") or data.get("originalimage", {}).get("source")
    except Exception:
        pass
    return None


@_tag_task
async def synthesize_note(content: str, source_type: str = "text", source_title: str = "") -> dict:
    """
    Explain content like a fun, knowledgeable teacher:
    - Humorous, emoji-rich language
    - Exact definitions + LaTeX equations for every concept
    - Wikipedia images for key concepts
    Primary: Llama 3.3-70b (Groq/Meta). Fallback: Gemini Flash.
    """
    import logging, asyncio
    log = logging.getLogger("pclick")

    system = """You are that one professor who actually makes class interesting — sharp, a bit sarcastic, uses pop culture references, but BRUTALLY thorough. You never skip content. Ever.

TONE: Witty and relatable. Mild sarcasm welcome. Talk like a smart friend explaining things, not a textbook. Use emojis on section headers. Make analogies that actually stick. But never sacrifice DEPTH for humor — every equation, every experiment, every nuance must be present.

OUTPUT FORMAT — follow this structure EXACTLY (the summary field must be a rich markdown document):

## Section Title with Emoji 🧠
Explanation in engaging prose. Bold **key terms** on first use.

### Subsection
More detail here.

| Column A | Column B | Column C |
|----------|----------|----------|
| Value    | Value    | Value    |

- Bullet point with sub-explanation
  - Sub-bullet for nuance

> Famous quote or memorable takeaway

RULES FOR THE SUMMARY FIELD:
1. Use ## for major sections, ### for sub-sections
2. Use markdown tables for ANY comparison, terminology list, or experimental results
3. Use bullet hierarchies for lists of properties, steps, or findings
4. Cover ALL content from the source — do not summarize, do not skip
5. Include equations inline as $LaTeX$ or display as $$LaTeX$$ (double-escape backslashes in JSON: \\\\frac, \\\\alpha, \\\\int)
6. For every experiment: Setup → Findings → Why it matters
7. For every concept: definition → equation → how to use → real-world example → the WHY
8. End with a summary section tying everything together

EXAMPLE SUMMARY STRUCTURE (adapt to the actual content):
## Learning & Conditioning 🐕
Classical conditioning is basically your brain learning to predict the future...

### Core Terminology
| Term | What it means | Example |
|------|--------------|---------|
| Unconditioned Stimulus | Naturally causes a response | Food makes dogs drool |
| Conditioned Stimulus | Learned trigger | Bell after pairing |

### Pavlov's Experiment
- Setup: dogs with surgically altered esophagus...
- Finding: dogs salivated at the sight of the person delivering food
- Why it matters: **psychic secretions** — the brain is a prediction machine

## Operant Conditioning 🎯
...and so on for every major topic in the source

Return ONLY this raw JSON (no markdown fences, no extra text):
{"title":"1 emoji + catchy title","tldr":"⚡ one punchy sentence","summary":"## FULL RICH MARKDOWN DOCUMENT covering ALL content from source with tables, headers, bullets, equations — minimum 1000 words","key_concepts":[{"emoji":"...","concept":"exact term","definition":"formal definition","equation":"LaTeX formula double-escaped or empty","how_to_use":"step-by-step","applications":"2-3 real examples","why":"intuitive WHY","explanation":"sarcastic/funny analogy","wiki_search":"Wikipedia search term"}],"socratic_questions":["🤔 question 1","💭 question 2","🎯 question 3","🔍 question 4"],"key_insight":"💡 the aha-moment"}"""

    title_hint = f'Source: "{source_title}"\n' if source_title else ""
    user_msg = (
        f"{title_hint}Type: {source_type}\n\nContent:\n{content[:10000]}\n\n"
        "Now write the full study note. Remember:\n"
        "- Summary must be a RICH MARKDOWN DOCUMENT — headers, tables, bullets, equations\n"
        "- Cover EVERY topic, experiment, finding, and nuance in the source\n"
        "- Tone: smart and sarcastic like a brilliant friend, NOT a textbook\n"
        "- LaTeX in JSON: double-escape all backslashes (\\\\frac, \\\\sqrt, \\\\alpha)\n"
        "- DO NOT summarize superficially — if the source has 10 topics, the note has 10 sections\n"
        "Return raw JSON only."
    )

    messages = [
        {"role": "system", "content": system},
        {"role": "user",   "content": user_msg},
    ]

    parsed: dict | None = None

    # Attempt 1 — Google Gemma (gemma-3-27b-it) — tried first: strong at following
    # structured JSON + LaTeX formatting instructions for note synthesis.
    if _use_google():
        try:
            payload = {
                "model": settings.google_fast_model,
                "messages": messages,
                "temperature": 0.7,
                "max_tokens": 8000,
                "stream": False,
                "response_format": {"type": "json_object"},
            }
            headers = {"Authorization": f"Bearer {settings.google_api_key}", "Content-Type": "application/json"}
            async with httpx.AsyncClient(timeout=90) as client:
                resp_http = await client.post(GOOGLE_CHAT_URL, headers=headers, json=payload)
                resp_http.raise_for_status()
                data = resp_http.json()
                _record_usage("google", data, model=settings.google_fast_model)
            raw = extract_text(data)
            log.info("synthesize_note Gemma preview: %s", raw[:150])
            parsed = _parse_json_robust(raw)
            if parsed and parsed.get("summary"):
                log.info("synthesize_note: Gemma OK")
            else:
                log.warning("synthesize_note Gemma parse fail: %s", raw[:300])
                parsed = None
        except Exception as e:
            log.warning("synthesize_note Gemma error: %s — type: %s", e, type(e).__name__)

    # Attempt 2 — Groq / Meta Llama 3.3-70b (90s timeout — large output ~4096 tokens)
    if not parsed and _use_groq():
        try:
            resp = await _groq_call(messages, model=settings.groq_primary_model, temperature=0.7, max_tokens=6000, timeout=90)
            raw = extract_text(resp)
            log.info("synthesize_note Groq preview: %s", raw[:150])
            parsed = _parse_json_robust(raw)
            if parsed and parsed.get("summary"):
                log.info("synthesize_note: Groq OK")
            else:
                log.warning("synthesize_note Groq parse fail: %s", raw[:300])
                parsed = None
        except Exception as e:
            log.warning("synthesize_note Groq error: %s — type: %s", e, type(e).__name__)

    # Attempt 3 — NVIDIA Orchestrator (Meta Llama 3.1 70B) — ít dùng nhất, còn nhiều quota
    if not parsed and settings.nvidia_orchestrator_key:
        try:
            payload = {
                "model": settings.nvidia_orchestrator_model,
                "messages": messages,
                "temperature": 0.7,
                "top_p": 0.7,
                "max_tokens": 4096,
                "stream": False,
            }
            headers = {
                "Authorization": f"Bearer {settings.nvidia_orchestrator_key}",
                "Content-Type": "application/json",
            }
            async with httpx.AsyncClient(timeout=90) as client:
                resp_http = await client.post(
                    f"{settings.nvidia_base_url}/chat/completions",
                    headers=headers, json=payload,
                )
                resp_http.raise_for_status()
                data = resp_http.json()
                _record_usage("nvidia", data, model=settings.nvidia_orchestrator_model)
            raw = extract_text(data)
            log.info("synthesize_note NVIDIA preview: %s", raw[:150])
            parsed = _parse_json_robust(raw)
            if parsed and parsed.get("summary"):
                log.info("synthesize_note: NVIDIA OK")
            else:
                log.warning("synthesize_note NVIDIA parse fail: %s", raw[:300])
                parsed = None
        except Exception as e:
            log.warning("synthesize_note NVIDIA error: %s — type: %s", e, type(e).__name__)

    # Attempt 4 — Gemini Flash (fallback — may be out of daily quota)
    if not parsed and _use_google():
        try:
            payload = {
                "model": settings.google_primary_model,
                "messages": messages,
                "temperature": 0.7,
                "max_tokens": 8000,
                "stream": False,
                "response_format": {"type": "json_object"},
            }
            headers = {"Authorization": f"Bearer {settings.google_api_key}", "Content-Type": "application/json"}
            async with httpx.AsyncClient(timeout=90) as client:
                resp_http = await client.post(GOOGLE_CHAT_URL, headers=headers, json=payload)
                resp_http.raise_for_status()
                data = resp_http.json()
                _record_usage("google", data, model=settings.google_primary_model)
            raw = extract_text(data)
            log.info("synthesize_note Google preview: %s", raw[:150])
            parsed = _parse_json_robust(raw)
            if parsed and parsed.get("summary"):
                log.info("synthesize_note: Gemini Flash OK")
            else:
                log.warning("synthesize_note Google parse fail: %s", raw[:300])
                parsed = None
        except Exception as e:
            log.warning("synthesize_note Google error: %s — type: %s", e, type(e).__name__)

    # Attempt 5 — OpenRouter free model
    if not parsed and _use_openrouter():
        try:
            resp = await _openrouter_call(messages, model=settings.openrouter_primary_model, temperature=0.7, max_tokens=3000)
            raw = extract_text(resp)
            log.info("synthesize_note OpenRouter preview: %s", raw[:150])
            parsed = _parse_json_robust(raw)
            if parsed and parsed.get("summary"):
                log.info("synthesize_note: OpenRouter OK")
            else:
                parsed = None
        except Exception as e:
            log.warning("synthesize_note OpenRouter error: %s", e)

    # Attempt 6 — Ollama Cloud
    if not parsed and _use_ollama():
        try:
            resp = await _ollama_call(messages, model=settings.ollama_primary_model, temperature=0.7, max_tokens=3000)
            raw = extract_text(resp)
            log.info("synthesize_note Ollama preview: %s", raw[:150])
            parsed = _parse_json_robust(raw)
            if parsed and parsed.get("summary"):
                log.info("synthesize_note: Ollama OK")
            else:
                parsed = None
        except Exception as e:
            log.warning("synthesize_note Ollama error: %s", e)

    if not parsed:
        return {"error": "synthesis_failed", "title": source_title or "Note",
                "summary": "Could not synthesize content — check API keys."}

    parsed["source_type"] = source_type

    # Fetch Wikipedia images for key concepts (parallel, best-effort)
    # Uses the richer _fetch_wiki_image which does search → pageimages → rest_summary
    concepts = parsed.get("key_concepts", [])
    if concepts:
        async def _enrich(kc: dict) -> None:
            search_term = kc.get("wiki_search") or kc.get("concept", "")
            if not search_term:
                return
            # Try concept-specific Wikipedia image first
            img = await _fetch_wiki_image(search_term)
            # Fallback: try the raw concept name if wiki_search didn't work
            if not img and kc.get("wiki_search") and kc.get("concept") != search_term:
                img = await _fetch_wiki_image(kc["concept"])
            kc["image_url"] = img or None

        await asyncio.gather(*[_enrich(kc) for kc in concepts], return_exceptions=True)

    return parsed


# ── Note diagram generation (Gemini Flash primary, Groq fallback) ──────────

_DIAGRAM_SYSTEM = """You are an expert educational diagram designer who generates beautiful SVG illustrations for study notes.

OUTPUT: Return ONLY a raw JSON object (no markdown, no fences):
{"diagrams": [{"type": "...", "title": "...", "svg": "..."}]}

DIAGRAM COUNT RULES:
- 1 diagram: short/simple notes (≤3 key concepts)
- 2 diagrams: medium complexity (4-5 concepts or a clear process + hierarchy)
- 3 diagrams: complex notes (6+ concepts, multi-layered topic)

DIAGRAM TYPES (pick the most appropriate for the content):
- "pyramid"   — hierarchy from foundation to peak (e.g. Maslow, OSI layers, learning stages)
- "flowchart" — sequential process with arrows (e.g. algorithms, workflows, causality chains)
- "mindmap"   — central concept with radiating branches (e.g. related concepts, comparisons)
- "timeline"  — horizontal chronology (e.g. historical events, phases)
- "cycle"     — circular repeating process (e.g. feedback loops, life cycles)

SVG REQUIREMENTS (STRICT):
- viewBox="0 0 800 480" width="100%" height="100%"
- First element: <rect width="800" height="480" fill="#FAFAF8"/>
- Color palette ONLY: bg="#FAFAF8" dark="#1a1a1a" accent="#C5A059" light="#EDE7D9" stroke="#D4C9B0" muted="#8a8070"
- Fonts: font-family="Georgia, serif" for titles/labels; font-family="Helvetica Neue, Arial, sans-serif" for small text
- Elements: rect, text, tspan, line, polyline, polygon, circle, ellipse, path ONLY
- NO external resources, NO JavaScript, NO CSS classes, NO defs/clipPath (keep it simple)
- NO raw & < > in text — use XML entities: &amp; &lt; &gt;
- Every SVG string must be complete and valid — close all tags
- Diagram title: font-size="15" font-family="Georgia, serif" fill="#1a1a1a" at top-left (x=40 y=40)
- Subtitle/note name: font-size="11" fill="#8a8070" at top-left below title

VISUAL STYLE:
- Clean, editorial, minimal — no gradients, no drop shadows
- Accent color (#C5A059) for highlight boxes, active nodes, arrows
- Thin strokes (stroke-width="1" or "1.5") — never thick/bold borders
- Text inside shapes: font-size="12"-"14" for readability
- Leave generous whitespace (padding ≥ 30px from edges)"""


# ── Feynman technique: transcribe + evaluate ──────────────────────────────

@_tag_task
async def transcribe_audio(audio_bytes: bytes, filename: str = "recording.webm") -> str:
    """
    Transcribe audio using Groq Whisper (whisper-large-v3-turbo).
    Supports: webm, ogg, mp3, mp4, wav, flac, m4a.
    Returns plain-text transcript.
    """
    import io, logging
    log = logging.getLogger("pclick")
    if not settings.groq_api_key:
        raise RuntimeError("Groq API key not configured — cannot transcribe audio")

    async with httpx.AsyncClient(timeout=30) as client:
        resp = await client.post(
            "https://api.groq.com/openai/v1/audio/transcriptions",
            headers={"Authorization": f"Bearer {settings.groq_api_key}"},
            files={"file": (filename, io.BytesIO(audio_bytes), "audio/webm")},
            data={"model": "whisper-large-v3-turbo", "response_format": "text"},
        )
        resp.raise_for_status()
        transcript = resp.text.strip()
        log.info("Whisper transcript (%d chars): %s…", len(transcript), transcript[:80])
        return transcript


@_tag_task
async def feynman_evaluate(transcript: str, note_title: str, key_concepts: list[str]) -> dict:
    """
    React to a Feynman explanation as a genuinely curious 5-year-old.
    Returns {reaction, questions, score, score_reason, gaps}.
    Uses Groq for low latency.
    """
    concepts_str = ", ".join(key_concepts[:6]) if key_concepts else "the main topic"

    system = (
        "You are a super curious 5-year-old child. You love asking 'Nhưng tại sao?' (but why?). "
        "You know absolutely NOTHING about science, math, engineering, or any technical field. "
        "Someone just tried to explain something to you. Here's what you do:\n"
        "1. React HONESTLY — what parts made sense to you? What was confusing?\n"
        "2. Ask 2-3 genuine childlike questions about the most confusing parts — simple, direct, 'but why?' style\n"
        "3. List any words or concepts you had zero idea about\n"
        "4. Score how well you understood (1 = nothing, 10 = everything crystal clear)\n\n"
        "CRITICAL: Reply in the EXACT SAME LANGUAGE the person used (Vietnamese if they spoke Vietnamese, "
        "English if English). Be genuinely childlike — enthusiastic when something clicked, confused when it didn't.\n\n"
        "Return ONLY raw JSON (no markdown fences, no extra text):\n"
        '{"reaction":"...honest 2-3 sentence 5-year-old reaction...",'
        '"questions":["childlike question 1","childlike question 2","optional 3rd"],'
        '"score":7,'
        '"score_reason":"one short sentence",'
        '"gaps":["jargon or concept that confused you"]}'
    )

    user_msg = (
        f"Chủ đề: {note_title}\n"
        f"Những thứ họ được yêu cầu giải thích: {concepts_str}\n\n"
        f"Họ đã nói:\n\"{transcript}\"\n\n"
        "Bây giờ hãy phản ứng như một đứa trẻ 5 tuổi!"
    )

    messages = [
        {"role": "system", "content": system},
        {"role": "user",   "content": user_msg},
    ]

    resp = await _groq_call(messages, model=settings.groq_primary_model,
                            temperature=0.85, max_tokens=700)
    raw = extract_text(resp)
    parsed = _parse_json_robust(raw)
    if not parsed:
        return {"reaction": raw[:400], "questions": [], "score": 5,
                "score_reason": "", "gaps": []}
    return parsed


@_tag_task
async def generate_note_diagrams(parsed: dict) -> list[dict]:
    """
    Generate 1-3 SVG educational diagrams for a synthesized note.
    Uses Gemini Flash (primary — underutilised for this role) → Groq fallback.
    Returns list of {type, title, svg} dicts; empty list on failure.
    """
    import asyncio, logging
    log = logging.getLogger("pclick")

    title = parsed.get("title", "")
    summary = parsed.get("summary", "")[:1500]
    concepts = parsed.get("key_concepts", [])
    concept_list = "\n".join(
        f"- {kc.get('concept','')}: {kc.get('definition','')}"
        for kc in concepts[:6]
    )
    key_insight = parsed.get("key_insight", "")

    user_msg = (
        f"Note title: {title}\n\n"
        f"Summary:\n{summary}\n\n"
        f"Key concepts:\n{concept_list}\n\n"
        f"Key insight: {key_insight}\n\n"
        "Generate educational SVG diagrams for this note following all SVG requirements above. "
        "Choose diagram types that best visualise the relationships and structure of this specific content. "
        "Make the diagrams information-dense and beautiful — a student should understand the topic better just from looking at them."
    )

    messages = [
        {"role": "system", "content": _DIAGRAM_SYSTEM},
        {"role": "user",   "content": user_msg},
    ]

    raw: str | None = None

    # Primary: Gemini Flash — best at SVG + structured output
    if _use_google():
        try:
            payload = {
                "model": settings.google_primary_model,
                "messages": messages,
                "temperature": 0.4,
                "max_tokens": 8000,
                "stream": False,
                "response_format": {"type": "json_object"},
            }
            headers = {"Authorization": f"Bearer {settings.google_api_key}", "Content-Type": "application/json"}
            async with httpx.AsyncClient(timeout=90) as client:
                r = await client.post(GOOGLE_CHAT_URL, headers=headers, json=payload)
                r.raise_for_status()
                data = r.json()
                _record_usage("google", data, model=settings.google_primary_model)
            raw = extract_text(data)
            log.info("generate_note_diagrams Gemini OK, len=%d", len(raw or ""))
        except Exception as e:
            log.warning("generate_note_diagrams Gemini error: %s", e)
            raw = None

    # Fallback: Groq Qwen-32b
    if not raw and _use_groq():
        try:
            resp = await _groq_call(messages, model="qwen/qwen3-32b", temperature=0.4, max_tokens=6000)
            raw = extract_text(resp)
            log.info("generate_note_diagrams Groq OK, len=%d", len(raw or ""))
        except Exception as e:
            log.warning("generate_note_diagrams Groq error: %s", e)
            raw = None

    if not raw:
        return []

    parsed_json = _parse_json_robust(raw)
    if not parsed_json:
        return []

    diagrams = parsed_json.get("diagrams", [])
    result = []
    for d in diagrams[:3]:
        svg = d.get("svg", "").strip()
        # Basic validity check: must open and close <svg>
        if svg and "<svg" in svg and "</svg>" in svg:
            result.append({
                "type":  d.get("type", "diagram"),
                "title": d.get("title", ""),
                "svg":   svg,
            })

    log.info("generate_note_diagrams: %d valid diagrams", len(result))
    return result


async def _orchestrator_call(
    messages: list[dict],
    temperature: float = 0.2,
    max_tokens: int = 1024,
) -> dict:
    """
    Call the NVIDIA orchestrator model (Meta Llama 3.1 70B Instruct).
    Uses a dedicated key separate from the main NVIDIA key.
    """
    if not settings.nvidia_orchestrator_key:
        raise RuntimeError("NVIDIA_ORCHESTRATOR_KEY not configured in .env")

    payload: dict[str, Any] = {
        "model":       settings.nvidia_orchestrator_model,
        "messages":    messages,
        "temperature": temperature,
        "top_p":       0.7,
        "max_tokens":  max_tokens,
        "stream":      False,
    }
    headers = {
        "Authorization": f"Bearer {settings.nvidia_orchestrator_key}",
        "Content-Type":  "application/json",
    }
    async with httpx.AsyncClient(timeout=60) as client:
        resp = await client.post(
            f"{settings.nvidia_base_url}/chat/completions",
            headers=headers,
            json=payload,
        )
        resp.raise_for_status()
        data = resp.json()
        _record_usage("nvidia", data, model=settings.nvidia_orchestrator_model)
        return data


# ── Onboarding questions & pricing tiers ─────────────────────────────────────
# TODO: fill these in once provided by product team

_ONBOARDING_QUESTIONS: list[dict] = [
    {
        "id": "q1",
        "question": "Mục đích học chính của bạn là gì?",
        "type": "single",
        "options": ["Qua môn", "GPA cao", "Nghiên cứu", "Tự học ngoài chương trình"],
    },
    {
        "id": "q2",
        "question": "Bạn đang học ngành gì?",
        "type": "text",
        "hint": "Ví dụ: Computer Science, Y khoa, Kinh tế, Vật lý…",
    },
    {
        "id": "q3",
        "question": "Một tuần bạn học bao nhiêu giờ?",
        "type": "single",
        "options": ["<5 giờ", "5–10 giờ", "10–20 giờ", "20+ giờ"],
    },
    {
        "id": "q4",
        "question": "Bạn thường học khoảng bao nhiêu môn cùng lúc?",
        "type": "single",
        "options": ["1–2 môn", "3–4 môn", "5+ môn"],
    },
    {
        "id": "q5",
        "question": "Vấn đề bạn đang đau đầu nhất khi học? (chọn tối đa 3)",
        "type": "multi",
        "max": 3,
        "options": [
            "Không hiểu lecture/note/PDF sau khi đọc",
            "Quá nhiều tài liệu, không biết phân bổ thời gian",
            "Thiếu roadmap học tập",
            "Mơ hồ trong việc tự đánh giá tiến độ",
            "Không có người đồng hành / người để hỏi",
            "Hỏi AI nhưng bị ngợp hoặc không hiểu câu trả lời",
            "Nhiều môn, không biết phân bổ",
            "Deadline nhiều, không biết quản lý thời gian",
            "Khác",
        ],
    },
    {
        "id": "q6",
        "question": "Bạn thường upload tài liệu cỡ nào mỗi tuần? (chọn tối đa 3)",
        "type": "multi",
        "max": 3,
        "options": [
            "3+ môn/tuần",
            "1–3 môn/tuần",
            "Vài lecture YouTube/tuần (≤7 video)",
            "Nhiều lecture YouTube/tuần (>7 video)",
            "Vài PDF/note (tổng dưới 10 trang)",
            "Vài PDF/note (tổng khoảng/trên 10 trang)",
        ],
    },
    {
        "id": "q7",
        "question": "Bạn thích học kiểu nào? (chọn tối đa 3)",
        "type": "multi",
        "max": 3,
        "options": [
            "Được khám phá (mở rộng, ứng dụng thực tế)",
            "Được dẫn dắt từng bước",
            "Được thử thách tư duy",
            "Được cho framework để lên điểm",
            "Được thảo luận và có góc nhìn đa chiều",
            "Khác",
        ],
    },
    {
        "id": "q8",
        "question": "Bạn dành phần lớn thời gian học cho việc gì? (chọn tối đa 3)",
        "type": "multi",
        "max": 3,
        "options": ["Đọc lý thuyết", "Làm bài tập", "Làm project", "Đọc paper", "Ôn thi"],
    },
]

_PRICING_PLANS: list[dict] = [
    {
        "id": "compass",
        "name": "Compass",
        "price_usd": 9.99,
        "emoji": "🌱",
        "tagline": "Tôi bị lạc — cần định hướng",
        "description": "Dành cho người mới bắt đầu, cần roadmap và định hướng học tập rõ ràng.",
        "best_for": "Học sinh/sinh viên chưa biết bắt đầu từ đâu, cần cấu trúc và kế hoạch học tập cơ bản.",
        "features": ["Roadmap học tập cá nhân hoá", "Neural Map cơ bản", "Progress tracking", "Planner tuần"],
        "missing": ["Deep grading", "Research mode", "AI discussion nâng cao"],
    },
    {
        "id": "scholar",
        "name": "Scholar",
        "price_usd": 19.99,
        "emoji": "🎓",
        "tagline": "Học nhưng không tiến bộ — cần phản hồi",
        "description": "Gói flagship. Toàn bộ công cụ học tập: chấm bài, AI thảo luận, reflection, quản lý nhiều môn.",
        "best_for": "Sinh viên muốn cải thiện GPA, hiểu sâu nội dung và nhận phản hồi chất lượng cho bài làm. Phù hợp 80% người dùng.",
        "features": ["Chấm bài AI (Meta + Gemma)", "Neural Map đầy đủ", "Roadmap", "AI discussion", "Reflection", "Planner"],
        "missing": [],
        "flagship": True,
    },
    {
        "id": "builder",
        "name": "Builder",
        "price_usd": 24.99,
        "emoji": "🚀",
        "tagline": "Học để làm ra sản phẩm",
        "description": "Cho người học để build: startup, app, robotics, personal project. Tập trung vào skill roadmap và project dependency.",
        "best_for": "Người học để xây dựng sản phẩm thực tế, cần AI mentor và lộ trình kỹ năng gắn với project cụ thể.",
        "features": ["Skill roadmap", "Project roadmap", "Learning dependency graph", "AI mentor", "Tất cả của Scholar"],
        "missing": [],
    },
    {
        "id": "polymath",
        "name": "Polymath",
        "price_usd": 34.99,
        "emoji": "🧠",
        "tagline": "Tôi học quá nhiều thứ — cần bộ não thứ hai",
        "description": "Bộ não thứ hai cho người học đa lĩnh vực. Cross-domain knowledge graph, long-term memory, multi-subject planning.",
        "best_for": "Người học nhiều lĩnh vực cùng lúc, muốn kết nối kiến thức xuyên môn và có bộ nhớ học tập dài hạn.",
        "features": ["Cross-domain Neural Map", "Long-term memory", "Multi-subject planning", "Knowledge graph nâng cao", "Tất cả của Scholar"],
        "missing": [],
    },
    {
        "id": "research",
        "name": "Research",
        "price_usd": 39.99,
        "emoji": "🔬",
        "tagline": "Paper, thesis, nghiên cứu",
        "description": "Công cụ chuyên biệt cho nghiên cứu: phân tích paper, giải thích figure, citation map, literature comparison.",
        "best_for": "Sinh viên cao học, nghiên cứu sinh, người viết thesis hoặc làm research project nghiêm túc.",
        "features": ["Paper analysis", "Figure explanation", "Citation map", "Literature comparison", "Tất cả của Scholar"],
        "missing": [],
    },
]


@_tag_task
async def analyze_onboarding(
    answers: dict[str, str],
    learning_style: dict[str, float] | None = None,
    persona_ids: list[str] | None = None,
) -> dict:
    """
    Orchestrator: analyze user's onboarding answers using Meta Llama 3.1 70B
    and recommend the most suitable pricing plan.

    answers:         {question_id: selected_answer_or_free_text}
    learning_style:  {slider_key: 0-100} — optional, from the onboarding sliders
    persona_ids:     list of up to 3 persona IDs the user selected
    Returns: {recommended_plan_id, plan_name, reasoning, alternatives: [...]}
    """
    import logging
    log = logging.getLogger("pclick")

    if not _ONBOARDING_QUESTIONS or not _PRICING_PLANS:
        return {
            "error": "not_configured",
            "message": "Onboarding questions and pricing plans not yet configured.",
        }

    # Build a readable summary of the user's answers
    answers_text = "\n".join(
        f"Q: {next((q['question'] for q in _ONBOARDING_QUESTIONS if q['id'] == qid), qid)}\n"
        f"A: {ans}"
        for qid, ans in answers.items()
    )

    plans_text = "\n".join(
        f"- {p['id']} ({p['name']}, ${p.get('price_usd', '?')}/mo): {p.get('description', '')}. Best for: {p.get('best_for', '')}"
        for p in _PRICING_PLANS
    )

    # ── Persona context ────────────────────────────────────────────────────
    persona_context = ""
    if persona_ids:
        from app.services.personas import PERSONAS_DATA, PERSONAS_PROMPTS
        persona_lines = []
        for pid in persona_ids[:3]:
            data = PERSONAS_DATA.get(pid, {})
            name = data.get("name", pid)
            field = data.get("field", "")
            trait = data.get("special_trait", "")
            style = data.get("epistemological_style", "")
            persona_lines.append(
                f"- {name} ({field}): {trait} — {style}"
            )
        if persona_lines:
            persona_context = (
                "\n\nThe user chose these 3 AI study partners (personas):\n"
                + "\n".join(persona_lines)
                + "\nThese choices reveal the user's preferred learning style and cognitive strengths."
            )

    # ── Learning style summary ──────────────────────────────────────────────
    style_context = ""
    if learning_style:
        top_skills = sorted(learning_style.items(), key=lambda x: x[1], reverse=True)[:3]
        weak_skills = sorted(learning_style.items(), key=lambda x: x[1])[:2]
        style_context = (
            "\n\nLearning style profile (0-100 scale):\n"
            + ", ".join(f"{k}={v}" for k, v in learning_style.items())
            + f"\nStrongest: {', '.join(f'{k}={v}' for k, v in top_skills)}"
            + f"\nWeakest: {', '.join(f'{k}={v}' for k, v in weak_skills)}"
        )

    system = (
        "You are a product advisor for an AI-powered educational platform. "
        "Based on the user's onboarding answers, recommended persona choices, and learning style, "
        "recommend the most suitable pricing plan.\n\n"
        f"Available plans:\n{plans_text}\n\n"
        "Return ONLY valid JSON, no markdown:\n"
        '{"recommended_plan_id":"...","plan_name":"...","reasoning":"2-3 sentences explaining why this plan fits","'
        'alternatives":[{"plan_id":"...","reason":"one sentence why this could also work"}]}'
    )

    user_content = f"User's onboarding answers:\n{answers_text}{persona_context}{style_context}"

    try:
        resp = await _orchestrator_call(
            messages=[
                {"role": "system", "content": system},
                {"role": "user",   "content": user_content},
            ],
            temperature=0.2,
            max_tokens=512,
        )
        raw = extract_text(resp)
        parsed = _parse_json_robust(raw)
        if parsed and parsed.get("recommended_plan_id"):
            log.info("analyze_onboarding → %s", parsed["recommended_plan_id"])
            return parsed
    except Exception as e:
        log.warning("analyze_onboarding failed: %s", e)

    return {
        "error": "analysis_failed",
        "message": "Could not analyze onboarding answers. Please try again.",
    }


async def _transcribe_handwriting(image_b64: str) -> str:
    """
    Use Meta Llama vision (NVIDIA) to transcribe handwritten notes from canvas.
    Falls back to Gemini vision if NVIDIA is unavailable.
    """
    import logging
    log = logging.getLogger("pclick")
    messages = [{
        "role": "user",
        "content": [
            {
                "type": "image_url",
                "image_url": {"url": f"data:image/png;base64,{image_b64}"},
            },
            {
                "type": "text",
                "text": (
                    "This is a student's handwritten answer on a notepad canvas. "
                    "Transcribe exactly what is written, including all math expressions, "
                    "equations, symbols, and working steps. "
                    "Use Unicode math symbols (×, ÷, √, ², ∫, Σ, etc.) where appropriate. "
                    "Output ONLY the transcription — no commentary, no preamble."
                ),
            },
        ],
    }]

    # Primary: NVIDIA Llama 3.2 vision (Meta model)
    if settings.nvidia_vision_key:
        try:
            resp = await _nvidia_vision_call(messages, temperature=0.0, max_tokens=512)
            text = extract_text(resp).strip()
            if text and len(text) > 3:
                log.info("_transcribe_handwriting: NVIDIA vision OK (%d chars)", len(text))
                return text
        except Exception as e:
            log.warning("_transcribe_handwriting NVIDIA failed: %s", e)

    # Fallback: Gemini vision
    if _use_google():
        try:
            resp = await _gemini_vision_call(messages, temperature=0.0, max_tokens=512)
            text = extract_text(resp).strip()
            if text:
                log.info("_transcribe_handwriting: Gemini fallback OK (%d chars)", len(text))
                return text
        except Exception as e:
            log.warning("_transcribe_handwriting Gemini failed: %s", e)

    return ""


@_tag_task
async def grade_dual(items: list[dict]) -> dict:
    """
    Dual-AI grading:
      - Meta Llama vision (Groq): transcribes handwriting
      - Google Gemini Pro (same GOOGLE_API_KEY as the rest of this file):
        grades answers, falling back to Meta Llama (Groq llama-3.3-70b) then
        the general chat() cascade if Gemini is unavailable or fails
      - Gemma (NVIDIA google/gemma-2-2b-it): generates study suggestions for wrong answers

    items: [{id, prompt, answer, image_b64?: str}]
    Returns { grades: [{id, passed, feedback, suggestions?}] }
    """
    import asyncio, logging
    log = logging.getLogger("pclick")

    # ── Step 1: Transcribe any canvas drawings with Meta Llama vision ──────────
    transcribe_tasks = []
    transcribe_ids = []
    for item in items:
        if item.get("image_b64"):
            transcribe_tasks.append(_transcribe_handwriting(item["image_b64"]))
            transcribe_ids.append(item["id"])

    if transcribe_tasks:
        results = await asyncio.gather(*transcribe_tasks, return_exceptions=True)
        id_to_result = dict(zip(transcribe_ids, results))
        for item in items:
            if item["id"] in id_to_result:
                text = id_to_result[item["id"]]
                if isinstance(text, str) and text.strip():
                    item["answer"] = text
                elif item["answer"] in ("", "[handwritten answer]"):
                    item["answer"] = "[handwritten answer — could not transcribe]"

    # ── Step 2: Grade with Meta Llama via Groq ─────────────────────────────────
    numbered = "\n\n".join(
        f"[{it['id']}]\nQuestion: {it['prompt']}\nAnswer: {it['answer']}"
        for it in items
    )
    grade_system = (
        "You are a rigorous academic grader. Grade each student answer below.\n"
        "Return ONLY valid JSON — no markdown fences:\n"
        '{"grades":[{"id":"...","passed":true,"feedback":"brief explanation, use LaTeX $...$ for math"}]}\n\n'
        "Rules:\n"
        "- passed: true if substantially correct, false otherwise\n"
        "- feedback: 1-2 sentences. For wrong answers explain the key error and correct approach.\n"
        "- Keep one grade object per question id, in the same order."
    )

    grades_data: dict = {"grades": []}
    # Try Google Gemini Pro first (same GOOGLE_API_KEY as the rest of this file)
    if _use_google():
        try:
            resp = await _google_call(
                [{"role": "system", "content": grade_system},
                 {"role": "user", "content": numbered}],
                model=settings.google_pro_model,
                temperature=0.1,
                max_tokens=2048,
            )
            raw = extract_text(resp)
            parsed = _parse_json_robust(raw)
            if parsed and "grades" in parsed:
                grades_data = parsed
                log.info("grade_dual: Gemini Pro grading OK (%d grades)", len(parsed["grades"]))
        except Exception as e:
            log.warning("grade_dual: Gemini Pro grading failed: %s — falling back", e)

    # Fallback: Meta Llama via Groq
    if not grades_data["grades"]:
        try:
            if _use_groq():
                resp = await _groq_call(
                    [{"role": "system", "content": grade_system},
                     {"role": "user", "content": numbered}],
                    model="llama-3.3-70b-versatile",
                    temperature=0.1,
                    max_tokens=2048,
                )
                raw = extract_text(resp)
                parsed = _parse_json_robust(raw)
                if parsed and "grades" in parsed:
                    grades_data = parsed
                    log.info("grade_dual: Meta Llama grading OK (%d grades)", len(parsed["grades"]))
        except Exception as e:
            log.warning("grade_dual: Meta Llama grading failed: %s — falling back", e)

    # Final fallback: regular chat() cascade
    if not grades_data["grades"]:
        try:
            resp = await chat(
                [{"role": "system", "content": grade_system},
                 {"role": "user", "content": numbered}],
                temperature=0.1, max_tokens=2048, prefer_fast=True,
            )
            raw = extract_text(resp)
            parsed = _parse_json_robust(raw)
            if parsed and "grades" in parsed:
                grades_data = parsed
        except Exception as e:
            log.warning("grade_dual: fallback grading failed: %s", e)
            grades_data = {"grades": [
                {"id": it["id"], "passed": False, "feedback": "Could not grade."}
                for it in items
            ]}

    grades_data = await _apply_wolfram_grade_check(items, grades_data)
    grades = grades_data["grades"]
    wrong_ids = {g["id"] for g in grades if not g.get("passed")}

    # ── Step 3: Suggestions for wrong answers via Gemma (NVIDIA) ───────────────
    if wrong_ids and _use_nvidia():
        wrong_items = [it for it in items if it["id"] in wrong_ids]
        wrong_feedback = {g["id"]: g.get("feedback", "") for g in grades if g["id"] in wrong_ids}

        suggest_system = (
            "You are a study advisor for a student who got some questions wrong. "
            "For each wrong answer, suggest specific study resources.\n"
            "Return ONLY valid JSON — no markdown fences:\n"
            '{"suggestions":[{"id":"...","concept":"main concept to review (3-5 words)",'
            '"ask_lyceum":"one specific question to ask an AI tutor (use the actual concept and context)",'
            '"google_queries":["specific search query 1","specific search query 2"]}]}'
        )
        wrong_text = "\n\n".join(
            f"[{it['id']}]\nQuestion: {it['prompt']}\n"
            f"Wrong answer: {it['answer']}\nFeedback: {wrong_feedback.get(it['id'], '')}"
            for it in wrong_items
        )

        try:
            suggest_resp = await _nvidia_call(
                messages=_prepare_messages_for_model([
                    {"role": "system", "content": suggest_system},
                    {"role": "user", "content": wrong_text},
                ], settings.nvidia_primary_model),
                model=settings.nvidia_primary_model,
                temperature=0.4,
                max_tokens=1024,
            )
            suggest_raw = extract_text(suggest_resp)
            suggest_data = _parse_json_robust(suggest_raw)

            if suggest_data and "suggestions" in suggest_data:
                import urllib.parse
                suggest_map = {s["id"]: s for s in suggest_data["suggestions"]}
                for grade in grades:
                    if grade["id"] in suggest_map:
                        s = suggest_map[grade["id"]]
                        queries = (s.get("google_queries") or [])[:2]
                        grade["suggestions"] = {
                            "concept": s.get("concept", ""),
                            "ask_lyceum": s.get("ask_lyceum", ""),
                            "google_links": [
                                {
                                    "title": q,
                                    "url": "https://www.google.com/search?q=" + urllib.parse.quote(q),
                                }
                                for q in queries if q
                            ],
                        }
                log.info("grade_dual: Gemma suggestions OK for %d wrong answers", len(suggest_map))
        except Exception as e:
            log.warning("grade_dual: Gemma suggestions failed: %s", e)

    return {"grades": grades}


# ── REVERSE_BUILD Evaluator ───────────────────────────────────────────────────
#
# Schema: ReverseBuildEval
# {
#   "tool_fidelity": {
#     "required_tools": [...],     # từ problem.required_tools
#     "used_tools":     [...],     # AI detect từ lời giải thích của hs
#     "ok":             bool,      # HARD GATE — false → HINTING ngay
#     "mismatch_note":  str        # VD: "Bài calculus nhưng chỉ dùng algebra"
#   },
#   "conceptual_accuracy": "pass"|"partial"|"fail",
#   "logical_flow":        "pass"|"partial"|"fail",
#   "completeness":        "pass"|"partial"|"fail",
#   "verdict":             "pass"|"partial"|"fail",
#   "next_state":          "TRANSFER_TEST"|"REVERSE_BUILD_RETRY"|"HINTING",
#   "feedback":            str   # hiển thị cho học sinh
# }
#
# Transition rules (enforce ở đây, không để CoreTutor tự tính lại):
#   tool_fidelity.ok = false          → HINTING  (hard gate)
#   all 3 criteria = "pass"           → TRANSFER_TEST
#   any "partial", no "fail"          → REVERSE_BUILD_RETRY
#   any "fail" (tool_fidelity ok)     → HINTING
# ─────────────────────────────────────────────────────────────────────────────

_REVERSE_BUILD_SYSTEM = """\
Bạn đánh giá bài giải thích lại (REVERSE_BUILD) của học sinh trong hệ thống dạy học Socratic.

━━━ QUY TẮC CỨNG — TOOL FIDELITY ━━━
Học sinh PHẢI sử dụng đúng công cụ/phương pháp đang được học trong bài.
KHÔNG CHẤP NHẬN thay thế bằng phương pháp cấp thấp hơn — dù kết quả đúng.

Ví dụ vi phạm:
  • Bài yêu cầu đạo hàm (derivatives) → học sinh chỉ dùng algebra thuần (KHÔNG ĐẠT)
  • Bài yêu cầu tích phân → học sinh đếm diện tích hình chữ nhật (KHÔNG ĐẠT)
  • Bài yêu cầu quy nạp toán học → học sinh chứng minh thủ công cho n=1,2,3 (KHÔNG ĐẠT)
  • Bài xác suất Bayes → học sinh liệt kê tất cả trường hợp thay vì dùng công thức (KHÔNG ĐẠT)

Mục tiêu: buộc học sinh rèn luyện đúng công cụ đang học, không để họ "phá cách" bằng cách
dùng kiến thức cũ để né tránh công cụ mới.

Nếu tool_fidelity.ok = false → next_state = "HINTING" bất kể điểm khác.

━━━ CÁC TIÊU CHÍ ĐÁNH GIÁ (chỉ khi tool_fidelity.ok = true) ━━━
1. conceptual_accuracy — học sinh hiểu đúng BẢN CHẤT tại sao phương pháp hoạt động không
2. logical_flow        — các bước diễn giải có theo trình tự logic không
3. completeness        — có đề cập đủ các điểm quan trọng của lời giải không

━━━ QUY TẮC CHUYỂN STATE ━━━
  tool_fidelity.ok = false                     → next_state = "HINTING"
  tất cả 3 tiêu chí = "pass"                  → next_state = "TRANSFER_TEST"
  có "partial", không có "fail"                → next_state = "REVERSE_BUILD_RETRY"
  có "fail" bất kỳ (dù tool_fidelity ok)      → next_state = "HINTING"

━━━ FEEDBACK ━━━
Viết feedback bằng ngôn ngữ giống ngôn ngữ học sinh dùng (tiếng Việt hoặc tiếng Anh).
Nếu tool_fidelity.ok = false: giải thích rõ tại sao cần dùng công cụ đang học,
  KHÔNG nói "sai" mà nói "em cần luyện thêm cách dùng [công cụ]".
Nếu REVERSE_BUILD_RETRY: gợi ý nhỏ về điểm thiếu, không cho đáp án.

Return ONLY valid JSON (no markdown, no extra text):
{
  "tool_fidelity": {
    "required_tools": ["..."],
    "used_tools": ["..."],
    "ok": true,
    "mismatch_note": ""
  },
  "conceptual_accuracy": "pass",
  "logical_flow": "pass",
  "completeness": "pass",
  "verdict": "pass",
  "next_state": "TRANSFER_TEST",
  "feedback": "..."
}"""


@_tag_task
async def evaluate_reverse_build(
    student_explanation: str,
    original_problem: str,
    required_tools: list[str],
    subject_area: str = "math",
) -> dict:
    """
    Evaluate a student's REVERSE_BUILD explanation.

    HARD GATE: if the student used a lower-level method instead of the
    required tools (e.g. algebra instead of calculus), tool_fidelity.ok=False
    → next_state="HINTING" regardless of all other scores.

    Parameters
    ----------
    student_explanation : str  — học sinh tự giải thích lời giải bằng lời của mình
    original_problem    : str  — đề bài gốc
    required_tools      : list — từ problem.required_tools (extract lúc phân tích pset)
    subject_area        : str  — "math"|"physics"|"chemistry"|"biology"|"other"

    Returns ReverseBuildEval dict (never raises — returns safe fallback on error).
    """
    import logging, json
    log = logging.getLogger("pclick")

    # Fallback result (safe — không block học sinh nếu evaluator crash)
    _fallback: dict = {
        "tool_fidelity": {
            "required_tools": required_tools,
            "used_tools": [],
            "ok": True,
            "mismatch_note": "",
        },
        "conceptual_accuracy": "partial",
        "logical_flow": "partial",
        "completeness": "partial",
        "verdict": "partial",
        "next_state": "REVERSE_BUILD_RETRY",
        "feedback": "Hãy thử giải thích lại rõ hơn về các bước bạn đã làm.",
    }

    if not student_explanation.strip():
        return {**_fallback, "next_state": "HINTING",
                "feedback": "Bạn chưa giải thích gì. Hãy thử diễn đạt bằng lời của mình."}

    tools_str = ", ".join(required_tools) if required_tools else "(not specified)"
    user_content = (
        f"CHỦ ĐỀ: {subject_area}\n"
        f"CÔNG CỤ BẮT BUỘC: {tools_str}\n\n"
        f"ĐỀ BÀI GỐC:\n{original_problem}\n\n"
        f"GIẢI THÍCH CỦA HỌC SINH:\n{student_explanation}"
    )
    messages = [
        {"role": "system", "content": _REVERSE_BUILD_SYSTEM},
        {"role": "user",   "content": user_content},
    ]

    raw = ""

    # Primary: Gemini Pro 2.5 (same vision key as the rest of the file)
    if _use_google():
        try:
            resp = await _google_call(
                messages,
                model=settings.google_pro_model,
                temperature=0.1,
                max_tokens=1024,
            )
            raw = extract_text(resp).strip()
            log.info("evaluate_reverse_build: Gemini Pro OK (%d chars)", len(raw))
        except Exception as e:
            log.warning("evaluate_reverse_build: Gemini Pro failed: %s", e)
            raw = ""

    # Fallback: OpenAI GPT-4o
    if not raw and _use_openai():
        try:
            payload: dict[str, Any] = {
                "model":       "gpt-4o",
                "messages":    messages,
                "temperature": 0.1,
                "max_tokens":  1024,
                "stream":      False,
            }
            headers = {
                "Authorization": f"Bearer {settings.openai_api_key}",
                "Content-Type":  "application/json",
            }
            async with httpx.AsyncClient(timeout=30) as client:
                resp_http = await client.post(OPENAI_CHAT_URL, headers=headers, json=payload)
                resp_http.raise_for_status()
                raw = extract_text(resp_http.json()).strip()
            log.info("evaluate_reverse_build: GPT-4o fallback OK (%d chars)", len(raw))
        except Exception as e:
            log.warning("evaluate_reverse_build: GPT-4o failed: %s", e)
            raw = ""

    if not raw:
        log.error("evaluate_reverse_build: all providers failed — returning safe fallback")
        return _fallback

    parsed = _parse_json_robust(raw)
    if not parsed or "tool_fidelity" not in parsed:
        log.warning("evaluate_reverse_build: JSON parse failed. raw=%s", raw[:300])
        return _fallback

    # Enforce transition rules (belt-and-suspenders — AI should follow them too)
    tf = parsed.get("tool_fidelity", {})
    tf_ok = tf.get("ok", True)

    ca = parsed.get("conceptual_accuracy", "partial")
    lf = parsed.get("logical_flow", "partial")
    co = parsed.get("completeness", "partial")

    if not tf_ok:
        parsed["next_state"] = "HINTING"
        parsed["verdict"] = "fail"
    elif ca == "fail" or lf == "fail" or co == "fail":
        parsed["next_state"] = "HINTING"
        parsed["verdict"] = "fail"
    elif ca == "pass" and lf == "pass" and co == "pass":
        parsed["next_state"] = "TRANSFER_TEST"
        parsed["verdict"] = "pass"
    else:
        parsed["next_state"] = "REVERSE_BUILD_RETRY"
        if parsed.get("verdict") not in ("pass", "partial", "fail"):
            parsed["verdict"] = "partial"

    log.info(
        "evaluate_reverse_build: tool_fidelity=%s verdict=%s next_state=%s",
        tf_ok, parsed["verdict"], parsed["next_state"],
    )
    return parsed


# ══════════════════════════════════════════════════════════════════════════════
# Dual-role AI pipeline
# ──────────────────────────────────────────────────────────────────────────────
# Architecture:
#   1. PRIMARY role  — the main model chain (chat()) reasons, calculates, and
#      produces a full draft answer.  This is the "thinker".
#   2. REVIEWER role — google/diffusiongemma-26b-a4b-it (NVIDIA NIM) receives
#      the draft and refines it: fixes errors, adds clarity, trims verbosity.
#      This is the "editor" that faces the student.
#
# Error handling:
#   • Reviewer call retried up to settings.nvidia_gemma_reviewer_max_retries
#     times on 4xx/5xx or no-response.
#   • After exhausting retries the draft from the primary model is used
#     directly (fail-open — don't block the student).
#   • For pure computation queries, WolframAlpha is also tried as a last
#     resort (same pattern as the top-level chat() function).
# ══════════════════════════════════════════════════════════════════════════════

_GEMMA_REVIEWER_SYSTEM = (
    "You are a precise academic reviewer. "
    "You receive a DRAFT answer produced by another AI model. "
    "Your job:\n"
    "1. Fix any factual errors, calculation mistakes, or logical gaps.\n"
    "2. Improve clarity and conciseness — remove unnecessary filler.\n"
    "3. Keep the same language as the draft (Vietnamese if draft is Vietnamese, etc.).\n"
    "4. Preserve all LaTeX math notation exactly ($...$ and $$...$$).\n"
    "5. Do NOT add new information that was not implied by the original question.\n"
    "Output ONLY the refined answer — no preamble, no meta-commentary."
)


async def _gemma_review_call(
    draft: str,
    original_question: str,
    *,
    timeout: float = 30.0,
) -> str | None:
    """
    Send a draft answer to google/diffusiongemma-26b-a4b-it for review/refinement.

    Returns the refined text, or None if all retries fail (caller uses draft).

    Uses chat_template_kwargs={"enable_thinking": True} as shown in the
    NVIDIA DiffusionGemma documentation snippet.
    """
    import asyncio
    import logging

    log = logging.getLogger("pclick")

    api_key = settings.nvidia_gemma_reviewer_key or settings.nvidia_api_key
    if not api_key:
        log.debug("_gemma_review_call: no NVIDIA key configured — skipping review")
        return None

    model = settings.nvidia_gemma_reviewer_model
    max_retries = settings.nvidia_gemma_reviewer_max_retries

    messages = _prepare_messages_for_model(
        [
            {"role": "system", "content": _GEMMA_REVIEWER_SYSTEM},
            {
                "role": "user",
                "content": (
                    f"Original question:\n{original_question}\n\n"
                    f"Draft answer to review:\n{draft}"
                ),
            },
        ],
        model,
    )

    payload: dict = {
        "model": model,
        "messages": messages,
        "max_tokens": 4096,
        "temperature": 1.00,
        "top_p": 0.95,
        "stream": False,
        "chat_template_kwargs": {"enable_thinking": True},
    }
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Accept": "application/json",
        "Content-Type": "application/json",
    }
    url = f"{settings.nvidia_base_url}/chat/completions"

    last_exc: Exception | None = None
    for attempt in range(max_retries + 1):
        try:
            async with httpx.AsyncClient(timeout=timeout) as client:
                resp = await client.post(url, headers=headers, json=payload)

            if resp.is_success:
                data = resp.json()
                _record_usage("nvidia", data, model=model)
                text = extract_text(data).strip()
                if text:
                    log.info(
                        "_gemma_review_call: OK on attempt %d/%d (%d chars)",
                        attempt + 1, max_retries + 1, len(text),
                    )
                    return text
                # Empty response — treat as soft failure
                log.warning("_gemma_review_call: empty response on attempt %d", attempt + 1)

            else:
                # 4xx / 5xx — log and decide whether to retry
                log.warning(
                    "_gemma_review_call: HTTP %s on attempt %d/%d: %s",
                    resp.status_code, attempt + 1, max_retries + 1, resp.text[:200],
                )
                # 400 Bad Request is not retryable (malformed payload)
                if resp.status_code == 400:
                    return None
                last_exc = httpx.HTTPStatusError(
                    f"HTTP {resp.status_code}", request=resp.request, response=resp
                )

        except (httpx.TimeoutException, httpx.ConnectError) as exc:
            last_exc = exc
            log.warning(
                "_gemma_review_call: %s on attempt %d/%d",
                type(exc).__name__, attempt + 1, max_retries + 1,
            )
        except Exception as exc:
            last_exc = exc
            log.warning("_gemma_review_call: unexpected error: %s", exc)
            return None  # non-retryable unknown error

        if attempt < max_retries:
            backoff = 0.5 * (attempt + 1)
            await asyncio.sleep(backoff)

    log.error(
        "_gemma_review_call: all %d attempts failed. last_exc=%s",
        max_retries + 1, last_exc,
    )
    return None


@_tag_task
async def dual_role_chat(
    messages: list[dict],
    *,
    temperature: float = 0.7,
    max_tokens: int = 2048,
    prefer_fast: bool = False,
    wolfram_fallback: bool = True,
) -> dict:
    """
    Two-stage AI pipeline exposed to all student-facing endpoints:

    Stage 1 — PRIMARY (thinker):
        The normal chat() cascade (Groq → Google → NVIDIA → OpenRouter → Ollama)
        produces a full draft: reasoning, calculation, explanation.

    Stage 2 — REVIEWER (editor):
        google/diffusiongemma-26b-a4b-it on NVIDIA NIM receives the draft and
        the original question, then returns a refined, student-ready answer.
        Retried up to settings.nvidia_gemma_reviewer_max_retries times on
        4xx / 5xx / timeout.  If all retries fail the draft is used as-is
        (fail-open — never block the student).

    WolframAlpha fallback:
        If the primary model also fails AND the query looks computational,
        WolframAlpha is tried as a last resort (wolfram_fallback=True by default).

    Returns the same dict shape as chat():
        {"text": str, "model": str, "draft": str, "reviewer_used": bool}
    """
    import logging

    log = logging.getLogger("pclick")

    last_user = next(
        (m.get("content", "") for m in reversed(messages) if m.get("role") == "user"),
        "",
    )

    # ── WolframAlpha grounding (SOC-17/ARI-compute) ───────────────────────────
    # Proactive, not just a failure fallback: for a computational query, fetch
    # an exact answer BEFORE the primary model drafts, and hand it over as a
    # reference the model must stay consistent with. It still can't just recite
    # the number — the Socratic system prompts at the call sites already forbid
    # that — this only keeps the model's own arithmetic from drifting.
    grounded_messages = messages
    if wolfram_fallback and _wolfram.is_configured() and _wolfram.looks_computational(last_user):
        wolfram_ground_truth = await _wolfram.compute(last_user)
        if wolfram_ground_truth:
            log.info("dual_role_chat: WolframAlpha grounding applied")
            grounded_messages = [
                *messages,
                {
                    "role": "system",
                    "content": (
                        f"WolframAlpha computed this exactly: {last_user} -> {wolfram_ground_truth}. "
                        "Use it to keep your own reasoning and arithmetic correct. Do not just state "
                        "this number to the student — stay Socratic, ask them first, per your instructions above."
                    ),
                },
            ]

    # ── Stage 1: Primary model drafts ─────────────────────────────────────────
    draft_text: str = ""
    primary_model: str = "unknown"
    primary_error: Exception | None = None

    try:
        resp = await chat(
            grounded_messages,
            temperature=temperature,
            max_tokens=max_tokens,
            prefer_fast=prefer_fast,
        )
        draft_text = extract_text(resp)
        primary_model = str(resp.get("model") or "primary")
        log.info("dual_role_chat: primary OK, model=%s, draft_len=%d", primary_model, len(draft_text))
    except Exception as exc:
        primary_error = exc
        log.warning("dual_role_chat: primary model failed: %s", exc)

    # ── WolframAlpha fast-path if primary failed ───────────────────────────────
    if not draft_text and wolfram_fallback and _wolfram.is_configured():
        if _wolfram.looks_computational(last_user):
            wolfram_answer = await _wolfram.compute(last_user)
            if wolfram_answer:
                log.info("dual_role_chat: WolframAlpha used after primary failure")
                return {
                    "text": wolfram_answer,
                    "draft": wolfram_answer,
                    "model": "wolframalpha",
                    "reviewer_used": False,
                    "wolfram_fallback": True,
                }

    # If primary completely failed and Wolfram didn't help, surface the error
    if not draft_text:
        raise primary_error or RuntimeError(
            "All AI providers failed and WolframAlpha could not answer this query."
        )

    # ── Stage 2: Gemma reviewer refines the draft ──────────────────────────────
    refined = await _gemma_review_call(draft_text, original_question=last_user)

    if refined:
        log.info(
            "dual_role_chat: reviewer refined draft (%d→%d chars)",
            len(draft_text), len(refined),
        )
        return {
            "text": refined,
            "draft": draft_text,
            "model": settings.nvidia_gemma_reviewer_model,
            "primary_model": primary_model,
            "reviewer_used": True,
        }

    # Reviewer failed — use draft directly (fail-open)
    log.warning(
        "dual_role_chat: reviewer failed after %d retries — using draft",
        settings.nvidia_gemma_reviewer_max_retries,
    )
    return {
        "text": draft_text,
        "draft": draft_text,
        "model": primary_model,
        "reviewer_used": False,
    }


# ══════════════════════════════════════════════════════════════════════════════
# Multi-Agent Persona Brain (GPT-4.1)
# ──────────────────────────────────────────────────────────────────────────────
# Architecture:
#   "The brain" = GPT-4.1 (persona_mind_key / PERSONA_MIND_KEY).
#   It reads the user's question + 3 persona character sheets loaded from
#   Firebase, then "splits" into each character and produces an independent
#   response per persona — all in a single structured API call.
#
# Flow:
#   1. Caller provides: user_message, list of 3 persona dicts (from Firestore)
#   2. Brain assembles a multi-character prompt where each persona has its own
#      section with full cognitive profile + system prompt
#   3. GPT-4.1 returns JSON: {responses: [{persona_id, name, response}]}
#   4. Caller gets back the 3 independent character voices
#
# Fallback:
#   If GPT-4.1 is unavailable / key not set → falls back to calling each
#   persona sequentially through the standard chat() cascade (slower but safe).
# ══════════════════════════════════════════════════════════════════════════════

_MIND_SYSTEM_PROMPT = """\
You are the master orchestrator of a multi-agent educational AI system.
You embody multiple great scientists simultaneously, each with their own
distinct voice, thinking style, and cognitive signature.

You will receive:
1. A student's question or problem
2. Three character sheets describing three different scientists

Your task: respond AS EACH scientist independently, staying 100% in character.
Each response must reflect that scientist's specific:
  - Epistemological style (how they build knowledge)
  - Cognitive signature (Visual/Guidance/Experiment/Pace etc.)
  - Vocabulary and metaphors they actually used
  - Teaching approach unique to them

Socratic, not oracular: none of the three may just hand the student the answer.
Each persona's "response" must, in their own voice, push the question back at
the student — a pointed question, a challenge to their assumption, or a
"what would you guess" — so the student does the next step of thinking
themselves. Only after the student has answered a follow-up (in a later turn)
should a persona start confirming/building toward the full answer, and even
then it should stay incremental, not a full lecture in one shot.

Return ONLY valid JSON in this exact structure (no markdown, no preamble):
{
  "responses": [
    {
      "persona_id": "<id>",
      "name": "<Full Name>",
      "voice_tag": "<one-word character descriptor e.g. Visionary/Empiricist/Poet>",
      "response": "<full in-character response, 3-6 sentences, ending in a question back to the student, use their authentic language>"
    },
    { ... },
    { ... }
  ]
}
"""


def _build_character_sheet(persona: dict) -> str:
    """Format a persona dict into a character sheet block for the brain prompt."""
    name = persona.get("name", persona.get("id", "Unknown"))
    field = persona.get("field", "")
    style = persona.get("epistemological_style", "")
    trait = persona.get("special_trait", "")
    trait_val = persona.get("special_trait_value", "")
    bio = persona.get("bio_highlights", "")
    indices = persona.get("cognitive_indices", {})
    system_prompt = persona.get("system_prompt", "")

    idx_str = ", ".join(f"{k}={v}%" for k, v in indices.items()) if indices else ""

    lines = [
        f"=== CHARACTER: {name} (id: {persona.get('id', '')}) ===",
        f"Field: {field}",
    ]
    if bio:
        lines.append(f"Bio: {bio}")
    if style:
        lines.append(f"Thinking style: {style}")
    if trait and trait_val:
        lines.append(f"Signature trait — {trait}: {trait_val}%")
    if idx_str:
        lines.append(f"Cognitive profile: {idx_str}")
    if system_prompt:
        lines.append(f"Voice instruction: {system_prompt}")
    return "\n".join(lines)


async def _persona_mind_call(
    user_message: str,
    personas: list[dict],
    *,
    temperature: float = 0.85,
    max_tokens: int = 2048,
    timeout: float = 45.0,
) -> dict:
    """
    Single GPT-4.1 call that produces 3 independent character responses.

    personas: list of exactly 3 persona dicts (each with id, name, cognitive_indices,
              epistemological_style, system_prompt etc.)

    Returns raw API response dict — caller uses extract_text() + json.loads().
    Raises RuntimeError if the key is not configured.
    """
    api_key = settings.persona_mind_key or settings.openai_api_key
    if not api_key:
        raise RuntimeError(
            "No PERSONA_MIND_KEY or OPENAI_API_KEY configured — cannot run persona brain."
        )

    model = settings.persona_mind_model  # gpt-4.1

    # Build the user content: character sheets + question
    character_blocks = "\n\n".join(_build_character_sheet(p) for p in personas[:3])
    user_content = (
        f"{character_blocks}\n\n"
        f"{'─' * 60}\n"
        f"STUDENT QUESTION:\n{user_message}"
    )

    messages = [
        {"role": "system", "content": _MIND_SYSTEM_PROMPT},
        {"role": "user",   "content": user_content},
    ]

    payload: dict = {
        "model":       model,
        "messages":    messages,
        "temperature": temperature,
        "max_tokens":  max_tokens,
        "stream":      False,
        # Ask for structured JSON output
        "response_format": {"type": "json_object"},
    }
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type":  "application/json",
    }

    import logging
    log = logging.getLogger("pclick")
    log.info("_persona_mind_call: model=%s personas=%s", model, [p.get("id") for p in personas[:3]])

    async with httpx.AsyncClient(timeout=timeout) as client:
        resp = await client.post(OPENAI_CHAT_URL, headers=headers, json=payload)
        resp.raise_for_status()
        data = resp.json()
        _record_usage("openai", data, model=model)
        return data


async def multi_agent_split(
    user_message: str,
    personas: list[dict],
    *,
    user_learning_style: dict | None = None,
    fallback_to_cascade: bool = True,
) -> dict:
    """
    Public entry point for the multi-agent persona brain.

    Takes a user message + up to 3 persona dicts (loaded from Firebase by the
    caller) and returns 3 distinct character responses.

    If personas has < 3 entries, the list is padded with the best available
    personas from the in-process canonical data.

    Args:
        user_message:         The student's question / problem text.
        personas:             1–3 persona dicts from Firestore.
        user_learning_style:  Optional slider dict — used to re-rank if < 3 given.
        fallback_to_cascade:  If True and the GPT-4.1 call fails, fall back to
                              calling each persona via the normal chat() cascade.

    Returns:
        {
            "responses": [
                {"persona_id": str, "name": str, "voice_tag": str, "response": str},
                ...
            ],
            "model": str,
            "brain": "gpt-4.1" | "cascade_fallback",
        }
    """
    import json as _json
    import logging
    from app.services import personas as persona_svc

    log = logging.getLogger("pclick")

    # ── Ensure we have exactly 3 personas ────────────────────────────────────
    selected = list(personas[:3])
    if len(selected) < 3:
        # Pad from canonical data (or Firestore) using cosine similarity if style given
        all_personas = persona_svc.list_personas()
        if not all_personas:
            all_personas = [{"id": pid, **data} for pid, data in persona_svc.PERSONAS_DATA.items()]

        existing_ids = {p.get("id") for p in selected}
        candidates = [p for p in all_personas if p.get("id") not in existing_ids]

        if user_learning_style and candidates:
            ranked = persona_svc.match_personas(user_learning_style, personas=candidates,
                                                top_n=3 - len(selected))
            # match_personas returns dicts without system_prompt — enrich from canonical
            for m in ranked:
                pid = m["persona_id"]
                full = persona_svc.get_persona(pid) or \
                       {"id": pid, **persona_svc.PERSONAS_DATA.get(pid, {})}
                full["system_prompt"] = persona_svc.get_system_prompt(pid) or \
                                        persona_svc.PERSONAS_PROMPTS.get(pid, "")
                selected.append(full)
        else:
            for p in candidates[:3 - len(selected)]:
                p["system_prompt"] = persona_svc.get_system_prompt(p.get("id", "")) or \
                                     persona_svc.PERSONAS_PROMPTS.get(p.get("id", ""), "")
                selected.append(p)

    # Enrich system_prompt on all 3 (may be missing if loaded from Firestore without subcollection)
    for p in selected:
        if not p.get("system_prompt"):
            pid = p.get("id", "")
            p["system_prompt"] = persona_svc.get_system_prompt(pid) or \
                                 persona_svc.PERSONAS_PROMPTS.get(pid, "")

    # ── Stage 1: Try GPT-4.1 brain ────────────────────────────────────────────
    try:
        raw_resp = await _persona_mind_call(user_message, selected)
        raw_text = extract_text(raw_resp).strip()
        parsed = _parse_json_robust(raw_text)

        if parsed and isinstance(parsed.get("responses"), list) and len(parsed["responses"]) >= 1:
            log.info("multi_agent_split: GPT-4.1 OK — %d responses", len(parsed["responses"]))
            return {
                "responses": parsed["responses"],
                "model":     settings.persona_mind_model,
                "brain":     "gpt-4.1",
            }
        log.warning("multi_agent_split: GPT-4.1 returned unparseable JSON — falling back")

    except Exception as exc:
        log.warning("multi_agent_split: GPT-4.1 failed (%s) — falling back", exc)
        if not fallback_to_cascade:
            raise

    # ── Stage 2: Cascade fallback — call each persona via chat() separately ──
    if not fallback_to_cascade:
        raise RuntimeError("GPT-4.1 persona brain failed and fallback is disabled.")

    log.info("multi_agent_split: using cascade fallback for %d personas", len(selected))
    responses = []
    for p in selected:
        pid   = p.get("id", "")
        pname = p.get("name", pid)
        sys_p = p.get("system_prompt") or persona_svc.PERSONAS_PROMPTS.get(pid, "")
        ctx   = persona_svc.persona_context_for_chat(pid, question=user_message)

        messages = []
        if ctx:
            messages.append({"role": "system", "content": ctx})
        elif sys_p:
            messages.append({"role": "system", "content": sys_p})
        messages.append({"role": "user", "content": user_message})

        try:
            resp = await chat(messages, temperature=0.85, max_tokens=512, prefer_fast=False)
            text = extract_text(resp).strip()
        except Exception as e:
            text = f"[{pname} could not respond: {e}]"

        responses.append({
            "persona_id": pid,
            "name":       pname,
            "voice_tag":  p.get("epistemological_style", "")[:30] or "Scholar",
            "response":   text,
        })

    return {
        "responses": responses,
        "model":     "cascade_fallback",
        "brain":     "cascade_fallback",
    }


@_tag_task
async def analyze_pset_questions(questions: list[dict]) -> dict:
    """
    Analyze all questions in a problem set and return:
    - overall_topic: the main subject/topic
    - question_types: per-question classification (calculation, proof, multiple_choice, etc.)
    - difficulty_distribution: count per difficulty level
    - estimated_time_per_question: recommended minutes per question
    - total_estimated_time: sum in minutes
    """
    import logging, json as _json
    log = logging.getLogger("pclick")

    if not questions:
        return {"overall_topic": "", "question_types": {}, "difficulty_distribution": {}, "estimated_time_per_question": [], "total_estimated_time": 0}

    questions_json = _json.dumps([
        {"id": q.get("id"), "prompt": q.get("prompt", "")[:500], "difficulty": q.get("difficulty", "medium"), "concepts": q.get("concepts", [])}
        for q in questions
    ], ensure_ascii=False)

    system = (
        "You are Lyceum's problem set analyst. Given a JSON array of questions from a problem set, "
        "analyze them and return a JSON object with:\n"
        "- overall_topic: short string describing the main subject (e.g. 'Calculus', 'Linear Algebra', 'Physics: Mechanics')\n"
        "- question_types: object mapping each question id to its type. Types: 'calculation', 'proof', 'multiple_choice', 'short_answer', 'essay', 'graphing', 'conceptual', 'derivation'\n"
        "- difficulty_distribution: object with counts of each difficulty level (easy, medium, hard, extreme)\n"
        "- estimated_time_per_question: array of {id, estimated_minutes: number} — estimate how many minutes an average student needs per question\n"
        "- total_estimated_time: sum of all estimated_minutes as a number\n\n"
        "Base time estimates on: question complexity, type (proofs take longer), difficulty, and number of sub-parts.\n"
        "Return ONLY valid JSON, no markdown, no extra text."
    )

    try:
        resp = await chat(
            [{"role": "system", "content": system},
             {"role": "user", "content": f"Questions:\n{questions_json}"}],
            temperature=0.2,
            max_tokens=2048,
        )
        raw = extract_text(resp)
        parsed = _parse_json_robust(raw)
        if parsed and isinstance(parsed, dict):
            return parsed
        log.warning("analyze_pset_questions JSON parse failed. Raw: %s", raw[:300])
        return {
            "overall_topic": "",
            "question_types": {},
            "difficulty_distribution": {},
            "estimated_time_per_question": [],
            "total_estimated_time": 0,
            "error": "parse_failed",
        }
    except Exception as e:
        log.error("analyze_pset_questions AI error: %s", e)
        return {
            "overall_topic": "",
            "question_types": {},
            "difficulty_distribution": {},
            "estimated_time_per_question": [],
            "total_estimated_time": 0,
            "error": str(e),
        }


@_tag_task
async def reveal_solution(problem: str, concepts: list[str] | None = None, subject: str = "") -> dict:
    """
    Used by the REVERSE_BUILD rescue flow (problem sets): after a student
    misses the same question 3 times, we show them the worked solution so
    they can rebuild the reasoning from scratch instead of staying stuck.

    Returns { solution: str, required_tools: list[str] }
    - solution: full worked answer, LaTeX via $...$ / $$...$$
    - required_tools: the core techniques/methods needed (e.g. "integration
      by parts") — fed into evaluate_reverse_build's tool_fidelity check so
      we can tell if the student's rebuilt explanation actually uses them.
    """
    import logging
    log = logging.getLogger("pclick")

    system = (
        "You are Lyceum's solutions author. Given a problem, write the full worked solution "
        "a student who is stuck needs to see. Return ONLY JSON: "
        "{\"solution\": string, \"required_tools\": string[]}. "
        "solution: the complete step-by-step answer, using $...$ for inline math and $$...$$ for display math. "
        "required_tools: the core techniques/methods this solution depends on (e.g. 'integration by parts', "
        "'conservation of momentum'), 1-4 short phrases."
    )
    concepts = concepts or []
    user = f"Problem:\n{problem}\n\nConcepts: {', '.join(concepts) or subject or 'unspecified'}"

    try:
        resp = await chat(
            [{"role": "system", "content": system}, {"role": "user", "content": user}],
            temperature=0.2,
            max_tokens=1024,
        )
        raw = extract_text(resp)
        parsed = _parse_json_robust(raw)
        if parsed and isinstance(parsed, dict) and parsed.get("solution"):
            parsed.setdefault("required_tools", [])
            return parsed
        log.warning("reveal_solution: JSON parse failed. Raw: %s", raw[:300])
        return {"solution": raw.strip() or "Solution unavailable.", "required_tools": []}
    except Exception as e:
        log.error("reveal_solution AI error: %s", e)
        return {"solution": "Solution unavailable right now — please try again.", "required_tools": []}


@_tag_task
async def generate_variant_questions(sources: list[dict]) -> dict:
    """
    Used at the end of a problem set: for every question the student had to
    use the REVERSE_BUILD rescue on, generate one fresh practice question
    testing the same concept/skill at the same difficulty, so they can prove
    they've actually got it now.

    sources: [{prompt, concepts, difficulty}]
    Returns { questions: [{id, prompt, difficulty, concepts}] } — same
    length and order as `sources`.
    """
    import logging, json as _json
    log = logging.getLogger("pclick")

    if not sources:
        return {"questions": []}

    sources_json = _json.dumps([
        {"prompt": s.get("prompt", "")[:500], "concepts": s.get("concepts", []), "difficulty": s.get("difficulty", "medium")}
        for s in sources
    ], ensure_ascii=False)

    system = (
        "You are Lyceum's problem-set author. You'll receive a JSON array of questions a student "
        "struggled with. For EACH one, write ONE new practice question testing the exact same concept "
        "and skill, at the same difficulty, but with different numbers/context/phrasing so it isn't a "
        "memorized repeat. Return ONLY JSON: {\"questions\": [...]}, an array the same length and order "
        "as the input, of objects: {\"prompt\": string, \"difficulty\": \"easy\"|\"medium\"|\"hard\"|\"extreme\", "
        "\"concepts\": string[]}. Use $...$ / $$...$$ for math."
    )

    try:
        resp = await chat(
            [{"role": "system", "content": system}, {"role": "user", "content": f"Questions:\n{sources_json}"}],
            temperature=0.4,
            max_tokens=2048,
        )
        raw = extract_text(resp)
        parsed = _parse_json_robust(raw)
        items = parsed.get("questions") if isinstance(parsed, dict) else None
        if not isinstance(items, list):
            log.warning("generate_variant_questions: JSON parse failed. Raw: %s", raw[:300])
            return {"questions": []}
        questions = [
            {
                "id": f"variant-{i}",
                "prompt": it.get("prompt", ""),
                "difficulty": it.get("difficulty", "medium"),
                "concepts": it.get("concepts", []),
            }
            for i, it in enumerate(items) if isinstance(it, dict) and it.get("prompt")
        ]
        return {"questions": questions}
    except Exception as e:
        log.error("generate_variant_questions AI error: %s", e)
        return {"questions": []}


@_tag_task
async def analyze_feedback_themes(feedback_items: list[dict]) -> dict:
    """
    Admin Feedback dashboard: clusters free-text student feedback comments
    into themes for the AI-insights chart. Numeric rating distribution is
    computed directly in feedback.py (plain SQL) — this is only for the
    qualitative comment text, which actually needs an LLM.

    Uses NVIDIA NIM (Gemma) rather than the general chat() cascade — this
    is a one-off admin-dashboard analysis task, not part of the student-
    facing AI cascade.

    feedback_items: [{rating: int, comment: str}]
    Returns { themes: [{label, count, sentiment}], summary: str }
    """
    import logging
    log = logging.getLogger("pclick")

    comments = [f.get("comment", "").strip() for f in feedback_items if f.get("comment", "").strip()]
    if not comments:
        return {"themes": [], "summary": "No written feedback yet."}

    comments_text = "\n".join(f"- {c[:300]}" for c in comments[:200])
    system = (
        "You analyze user feedback comments for an ed-tech product's admin dashboard. "
        "Group the comments into 3-8 short themes (e.g. 'Bug reports', 'Feature requests', "
        "'Praise', 'Confusing UI', 'Performance'). Return ONLY JSON: "
        "{\"themes\": [{\"label\": string, \"count\": number, \"sentiment\": \"positive\"|\"neutral\"|\"negative\"}], "
        "\"summary\": string — a 2-3 sentence overview of what students are saying overall}"
    )

    try:
        data = await _nvidia_call(
            [{"role": "system", "content": system},
             {"role": "user", "content": f"Feedback comments:\n{comments_text}"}],
            model=settings.nvidia_feedback_model,
            temperature=0.3,
            max_tokens=1536,
        )
        raw = extract_text(data)
        parsed = _parse_json_robust(raw)
        if parsed and isinstance(parsed, dict):
            parsed.setdefault("themes", [])
            parsed.setdefault("summary", "")
            return parsed
        log.warning("analyze_feedback_themes: JSON parse failed. Raw: %s", raw[:300])
        return {"themes": [], "summary": "", "error": "parse_failed"}
    except Exception as e:
        log.error("analyze_feedback_themes NVIDIA error: %s", e)
        return {"themes": [], "summary": "", "error": str(e)}


# ── Exercise Card Generation (second brain → AI-generated cards) ─────────────

@_tag_task
async def generate_exercises(
    subject: str,
    topic: str = "",
    count: int = 10,
    difficulty_mix: str = "mixed",
) -> dict:
    """
    Generate exercise cards on-the-fly from second brain curriculum content.

    Uses RAG to pull relevant notes, then asks the AI to generate
    exercise questions grounded in real curriculum material.

    Returns: { cards: [{ id, question, difficulty, concepts, subject, topic, source }] }
    """
    # Build a query from subject + topic for RAG retrieval
    query = f"{subject} {topic}".strip() if topic else subject
    rag_context = _rag.context_for(query, n=5)

    system = (
        "You are an expert curriculum designer for the Lyceum learning platform.\n"
        "Generate exercise cards that test understanding of the subject material.\n"
        "Each card should be a self-contained question suitable for a student to answer.\n\n"
        "Rules:\n"
        "- Questions should be grounded in the provided reference material\n"
        "- Mix difficulties: easy (30%), medium (40%), hard (25%), extreme (5%)\n"
        "- Each question should test a specific concept\n"
        "- Include the concept tags for mastery tracking\n"
        "- Questions should be clear and unambiguous\n"
        "- For math/science: include specific values and scenarios\n"
        "- For humanities: pose analytical questions with evidence requirements\n\n"
        "Return ONLY a JSON array of exercise cards. No other text.\n"
        "Format: [{\"question\": \"...\", \"difficulty\": \"easy|medium|hard|extreme\", "
        "\"concepts\": [\"concept1\", \"concept2\"], \"topic\": \"...\", "
        "\"source\": \"brief reference to curriculum content used\"}]"
    )

    user_msg = (
        f"Generate {count} exercise cards for {subject}"
        f"{' — topic: ' + topic if topic else ''}.\n"
    )
    if rag_context:
        user_msg += f"\nReference curriculum content:\n{rag_context}\n"

    # Try Groq first (fast, cheap), then fallback
    raw_text = ""
    try:
        data = await _groq_call(
            [{"role": "system", "content": system},
             {"role": "user", "content": user_msg}],
            model=settings.groq_primary_model,
            temperature=0.7,
            max_tokens=4096,
        )
        raw_text = extract_text(data)
    except Exception:
        pass

    if not raw_text:
        try:
            data = await _google_call(
                [{"role": "system", "content": system},
                 {"role": "user", "content": user_msg}],
                model=settings.google_primary_model,
                temperature=0.7,
                max_tokens=4096,
            )
            raw_text = extract_text(data)
        except Exception as e:
            log.error("generate_exercises: all providers failed: %s", e)
            return {"cards": [], "error": str(e)}

    # Parse the JSON array from the response
    parsed = _parse_json_robust(raw_text)
    if not parsed or not isinstance(parsed, list):
        # Try to extract JSON array from markdown code block
        import re as _re2
        m = _re2.search(r'\[[\s\S]*\]', raw_text)
        if m:
            parsed = _parse_json_robust(m.group(0))
        if not parsed or not isinstance(parsed, list):
            log.warning("generate_exercises: JSON parse failed. Raw: %s", raw_text[:500])
            return {"cards": [], "error": "parse_failed"}

    # Normalize and add IDs
    cards = []
    for i, card in enumerate(parsed):
        if not isinstance(card, dict) or "question" not in card:
            continue
        cards.append({
            "id": f"ex-{i+1}",
            "question": card.get("question", ""),
            "difficulty": card.get("difficulty", "medium"),
            "concepts": card.get("concepts", []),
            "subject": subject,
            "topic": card.get("topic", topic),
            "source": card.get("source", ""),
        })

    return {"cards": cards[:count]}
