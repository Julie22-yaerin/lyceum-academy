"""
The LLM caller: one interface, two providers, strict JSON out.

Responsibilities, in order:
  1. Translate a (system, user, schema) triple into the provider's wire format.
  2. Force structured output using each provider's NATIVE mechanism rather than
     hoping a prompt is obeyed.
  3. Retry the retryable, with exponential backoff and full jitter.
  4. Parse, validate against the Pydantic model, and — on failure — run one
     repair pass before giving up.

The two schema transformers below are the fiddly part and the reason this file
is worth buying rather than writing:

  * Gemini's `responseSchema` accepts a SUBSET of OpenAPI. It rejects `$ref`,
    `$defs`, `additionalProperties`, `title`, `default`, `anyOf` with null.
    Pydantic emits all of those. So refs get inlined and unsupported keys
    stripped.
  * OpenAI's `json_schema` with `strict: true` demands the opposite:
    `additionalProperties: false` on every object and EVERY property listed in
    `required` (optional fields are expressed as nullable types instead).

Getting either wrong produces a 400 that looks like a bug in your prompt.
"""

from __future__ import annotations

import asyncio
import json
import logging
import random
import re
import time
from copy import deepcopy
from typing import Any, TypeVar

import httpx
from pydantic import BaseModel, ValidationError

from .config import DEFAULT_CONFIG, DEFAULT_MODELS, PROVIDER_ENDPOINTS, HarnessConfig, Provider, redact
from .errors import (
    ContentBlocked,
    InvalidCredentials,
    MalformedLLMOutput,
    MissingCredentials,
    UnsupportedProvider,
    UpstreamRateLimited,
    UpstreamTimeout,
    UpstreamUnavailable,
)
from .prompts import REPAIR_SYSTEM, REPAIR_USER_TEMPLATE

log = logging.getLogger("lyceum_harness.llm")

TModel = TypeVar("TModel", bound=BaseModel)

_RETRYABLE_STATUS = {408, 409, 425, 429, 500, 502, 503, 504, 529}


# ── Schema transformers ──────────────────────────────────────────────────────

def _inline_refs(schema: dict) -> dict:
    """
    Resolve every local $ref against $defs and drop the $defs block.

    Iterative rather than recursive-with-cycle-detection because our schemas are
    acyclic by construction (no self-referencing models); a cycle would recurse
    forever, so we cap depth and fail loud rather than hang a request.
    """
    defs = schema.get("$defs") or schema.get("definitions") or {}

    def resolve(node: Any, depth: int = 0) -> Any:
        if depth > 24:
            raise ValueError("schema nesting too deep — is a model self-referencing?")
        if isinstance(node, list):
            return [resolve(n, depth + 1) for n in node]
        if not isinstance(node, dict):
            return node
        if "$ref" in node:
            ref = node["$ref"]
            name = ref.split("/")[-1]
            target = defs.get(name)
            if target is None:
                raise ValueError(f"unresolvable $ref: {ref}")
            merged = {**resolve(deepcopy(target), depth + 1)}
            # Sibling keys alongside $ref (e.g. description) win.
            for k, v in node.items():
                if k != "$ref":
                    merged[k] = resolve(v, depth + 1)
            return merged
        return {k: resolve(v, depth + 1) for k, v in node.items()}

    out = resolve({k: v for k, v in schema.items() if k not in ("$defs", "definitions")})
    return out


_GEMINI_ALLOWED_KEYS = {
    "type", "format", "description", "nullable", "enum", "items",
    "properties", "required", "propertyOrdering", "minItems", "maxItems",
}


def to_gemini_schema(model: type[BaseModel]) -> dict:
    """Pydantic model -> Gemini `responseSchema`."""
    raw = _inline_refs(model.model_json_schema())

    def clean(node: Any) -> Any:
        if isinstance(node, list):
            return [clean(n) for n in node]
        if not isinstance(node, dict):
            return node

        # Pydantic renders Optional[X] as anyOf[X, null]; Gemini wants nullable.
        if "anyOf" in node:
            variants = [v for v in node["anyOf"] if v.get("type") != "null"]
            nullable = len(variants) < len(node["anyOf"])
            base = clean(variants[0]) if variants else {"type": "string"}
            if nullable:
                base["nullable"] = True
            if "description" in node:
                base["description"] = node["description"]
            return base

        out: dict = {}
        for key, value in node.items():
            if key == "const":
                # Literal["1.0"] -> single-value enum, which Gemini understands.
                out["enum"] = [value]
                out.setdefault("type", "string")
                continue
            if key == "properties":
                # `properties` is a MAP of arbitrary field names to schemas —
                # not a schema itself. Recurse into the values only; filtering
                # this dict by the allowed-key set would delete every field.
                out["properties"] = {
                    prop_name: clean(prop_schema)
                    for prop_name, prop_schema in (value or {}).items()
                }
                continue
            if key not in _GEMINI_ALLOWED_KEYS:
                continue
            out[key] = clean(value)

        # additionalProperties:true dict fields (jargon_translated) have no
        # Gemini equivalent — degrade to a plain object and let the model fill it.
        if out.get("type") == "object" and not out.get("properties"):
            out.pop("properties", None)
            out.pop("required", None)
        return out

    return clean(raw)


def to_openai_schema(model: type[BaseModel]) -> dict:
    """
    Pydantic model -> OpenAI `json_schema` (strict mode).

    Strict mode requires every property to appear in `required` and every
    object to set additionalProperties:false. Genuinely optional fields become
    nullable instead of absent.
    """
    raw = _inline_refs(model.model_json_schema())

    def clean(node: Any) -> Any:
        if isinstance(node, list):
            return [clean(n) for n in node]
        if not isinstance(node, dict):
            return node

        out: dict = {}
        for k, v in node.items():
            if k in ("title", "default", "$schema", "minLength", "maxLength"):
                continue
            # Same trap as the Gemini transformer: `properties` keys are field
            # names, so never run the key filter over them.
            out[k] = ({pn: clean(ps) for pn, ps in (v or {}).items()}
                      if k == "properties" else clean(v))

        if out.get("type") == "object":
            props = out.get("properties")
            if isinstance(props, dict):
                out["additionalProperties"] = False
                out["required"] = list(props.keys())
            else:
                # Open-ended map (jargon_translated). Strict mode cannot express
                # it, so allow free-form values here.
                out["additionalProperties"] = True
                out.pop("required", None)
        return out

    return {
        "name": model.__name__,
        "strict": False,  # see note below
        "schema": clean(raw),
    }
    # strict=False deliberately: our schemas contain an open-ended
    # Dict[str, str] (jargon_translated), which strict mode forbids outright.
    # json_schema without strict still constrains the model hard and, unlike
    # strict, does not 400 on the whole request. Validation is enforced by
    # Pydantic on the way out regardless, so the contract still holds.


# ── JSON extraction ──────────────────────────────────────────────────────────

_FENCE_RE = re.compile(r"^\s*```(?:json)?\s*|\s*```\s*$", re.IGNORECASE)


def extract_json(raw: str) -> dict:
    """
    Pull a JSON object out of a model response.

    Providers with native JSON mode usually return clean JSON, but not always:
    a refusal, a truncation, or a stray "Here is the JSON:" all happen in
    production. Brace-matching is used rather than a greedy regex so that
    nested objects and braces inside strings survive.
    """
    if not raw or not raw.strip():
        raise MalformedLLMOutput("Model returned an empty response.")

    text = _FENCE_RE.sub("", raw.strip())
    try:
        parsed = json.loads(text)
        if isinstance(parsed, dict):
            return parsed
    except json.JSONDecodeError:
        pass

    start = text.find("{")
    if start == -1:
        raise MalformedLLMOutput("No JSON object found in model response.", raw_excerpt=raw)

    depth, in_str, escaped = 0, False, False
    for i, ch in enumerate(text[start:], start=start):
        if in_str:
            if escaped:
                escaped = False
            elif ch == "\\":
                escaped = True
            elif ch == '"':
                in_str = False
            continue
        if ch == '"':
            in_str = True
        elif ch == "{":
            depth += 1
        elif ch == "}":
            depth -= 1
            if depth == 0:
                try:
                    return json.loads(text[start:i + 1])
                except json.JSONDecodeError as exc:
                    raise MalformedLLMOutput(
                        f"Model response was not valid JSON: {exc.msg}", raw_excerpt=raw
                    ) from None
    raise MalformedLLMOutput("Model response contained unterminated JSON.", raw_excerpt=raw)


# ── Client ───────────────────────────────────────────────────────────────────

class LLMClient:
    """
    A stateless, per-request LLM caller.

    BYOK: `api_key` is held only for the lifetime of this object and never
    logged in full. Construct one per request (cheap) or pass the key per call.
    """

    def __init__(
        self,
        api_key: str,
        provider: Provider | str = Provider.GEMINI,
        model: str | None = None,
        config: HarnessConfig = DEFAULT_CONFIG,
        http_client: httpx.AsyncClient | None = None,
    ):
        try:
            self.provider = Provider(provider)
        except ValueError:
            raise UnsupportedProvider(
                f"Unsupported provider {provider!r}. Supported: "
                f"{', '.join(p.value for p in Provider)}."
            ) from None

        if not api_key or not api_key.strip():
            raise MissingCredentials(
                f"No API key supplied for provider {self.provider.value}. "
                "This harness is bring-your-own-key."
            )

        self.api_key = api_key.strip()
        self.model = model or DEFAULT_MODELS[self.provider]
        self.config = config
        self._external_client = http_client
        self.attempts_used = 0
        self.last_usage: dict[str, int | None] = {}

    # ── wire formats ─────────────────────────────────────────────────────────

    def _build_request(self, system: str, user: str, schema_model: type[BaseModel]) -> tuple[str, dict, dict]:
        base = PROVIDER_ENDPOINTS[self.provider]

        if self.provider is Provider.GEMINI:
            url = f"{base}/models/{self.model}:generateContent"
            headers = {
                # Header, not ?key= — query strings land in access logs and
                # proxy caches far more often than headers do.
                "x-goog-api-key": self.api_key,
                "Content-Type": "application/json",
            }
            payload = {
                "systemInstruction": {"parts": [{"text": system}]},
                "contents": [{"role": "user", "parts": [{"text": user}]}],
                "generationConfig": {
                    "temperature": self.config.temperature,
                    "maxOutputTokens": self.config.max_output_tokens,
                    "responseMimeType": "application/json",
                    "responseSchema": to_gemini_schema(schema_model),
                },
            }
            return url, headers, payload

        url = f"{base}/chat/completions"
        headers = {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json",
        }
        payload = {
            "model": self.model,
            "temperature": self.config.temperature,
            "max_tokens": self.config.max_output_tokens,
            "messages": [
                {"role": "system", "content": system},
                {"role": "user", "content": user},
            ],
            "response_format": {
                "type": "json_schema",
                "json_schema": to_openai_schema(schema_model),
            },
        }
        return url, headers, payload

    def _extract_text(self, body: dict) -> str:
        if self.provider is Provider.GEMINI:
            if (fb := body.get("promptFeedback", {})).get("blockReason"):
                raise ContentBlocked(
                    f"Provider safety filter blocked the prompt ({fb['blockReason']})."
                )
            candidates = body.get("candidates") or []
            if not candidates:
                raise MalformedLLMOutput("Provider returned no candidates.")
            cand = candidates[0]
            if cand.get("finishReason") == "SAFETY":
                raise ContentBlocked("Provider safety filter blocked the response.")
            if cand.get("finishReason") == "MAX_TOKENS":
                log.warning("Gemini hit MAX_TOKENS — output likely truncated")
            usage = body.get("usageMetadata") or {}
            self.last_usage = {
                "input_tokens": usage.get("promptTokenCount"),
                "output_tokens": usage.get("candidatesTokenCount"),
            }
            parts = (cand.get("content") or {}).get("parts") or []
            return "".join(p.get("text", "") for p in parts)

        choices = body.get("choices") or []
        if not choices:
            raise MalformedLLMOutput("Provider returned no choices.")
        choice = choices[0]
        if choice.get("finish_reason") == "content_filter":
            raise ContentBlocked("Provider content filter blocked the response.")
        if choice.get("finish_reason") == "length":
            log.warning("OpenAI hit length limit — output likely truncated")
        usage = body.get("usage") or {}
        self.last_usage = {
            "input_tokens": usage.get("prompt_tokens"),
            "output_tokens": usage.get("completion_tokens"),
        }
        message = choice.get("message") or {}
        if message.get("refusal"):
            raise ContentBlocked(f"Model refused: {message['refusal']}")
        return message.get("content") or ""

    # ── transport with retries ───────────────────────────────────────────────

    def _sleep_for(self, attempt: int, retry_after: str | None) -> float:
        """Honour Retry-After when sane, else exponential backoff + full jitter."""
        if retry_after:
            try:
                wanted = float(retry_after)
                return max(0.0, min(wanted, self.config.retry.max_honoured_retry_after_s))
            except ValueError:
                pass  # HTTP-date form; fall through to backoff
        ceiling = min(
            self.config.retry.base_delay_s * (2 ** attempt),
            self.config.retry.max_delay_s,
        )
        # Full jitter: prevents a fleet of clients retrying in lockstep.
        return random.uniform(0.0, ceiling)

    async def _post(self, url: str, headers: dict, payload: dict) -> dict:
        timeout = httpx.Timeout(
            connect=self.config.timeouts.connect_s,
            read=self.config.timeouts.read_s,
            write=self.config.timeouts.read_s,
            pool=self.config.timeouts.connect_s,
        )
        client = self._external_client
        owns_client = client is None
        if owns_client:
            client = httpx.AsyncClient(timeout=timeout)

        last_error: Exception | None = None
        try:
            for attempt in range(self.config.retry.max_attempts):
                self.attempts_used = attempt + 1
                try:
                    resp = await client.post(url, headers=headers, json=payload, timeout=timeout)
                except (httpx.ConnectTimeout, httpx.ReadTimeout, httpx.WriteTimeout, httpx.PoolTimeout) as exc:
                    last_error = exc
                    log.warning("timeout on attempt %d/%d (%s, key=%s)",
                                attempt + 1, self.config.retry.max_attempts,
                                type(exc).__name__, redact(self.api_key))
                except httpx.HTTPError as exc:
                    last_error = exc
                    log.warning("transport error on attempt %d/%d: %s",
                                attempt + 1, self.config.retry.max_attempts, type(exc).__name__)
                else:
                    if resp.status_code < 400:
                        return resp.json()

                    # Terminal: the caller's key or payload is the problem.
                    if resp.status_code in (401, 403):
                        raise InvalidCredentials(
                            "The provider rejected the supplied API key "
                            f"({resp.status_code}). Check the key and its permissions."
                        )
                    if resp.status_code == 400:
                        raise UpstreamUnavailable(
                            "The provider rejected the request as malformed (400).",
                            detail=_safe_excerpt(resp.text),
                        )
                    if resp.status_code not in _RETRYABLE_STATUS:
                        raise UpstreamUnavailable(
                            f"Provider returned {resp.status_code}.",
                            detail=_safe_excerpt(resp.text),
                        )

                    last_error = UpstreamUnavailable(f"provider {resp.status_code}")
                    is_last = attempt == self.config.retry.max_attempts - 1
                    if is_last:
                        if resp.status_code == 429:
                            raise UpstreamRateLimited(
                                "The provider rate-limited this key and retries were exhausted. "
                                "Back off and retry.",
                                retry_after=_parse_retry_after(resp.headers.get("Retry-After")),
                            )
                        raise UpstreamUnavailable(
                            f"Provider returned {resp.status_code} after "
                            f"{self.config.retry.max_attempts} attempts.",
                            detail=_safe_excerpt(resp.text),
                        )
                    delay = self._sleep_for(attempt, resp.headers.get("Retry-After"))
                    log.info("retrying after %.2fs (status %d)", delay, resp.status_code)
                    await asyncio.sleep(delay)
                    continue

                # Transport failure path: retry unless this was the last go.
                if attempt == self.config.retry.max_attempts - 1:
                    break
                await asyncio.sleep(self._sleep_for(attempt, None))

            if isinstance(last_error, (httpx.ConnectTimeout, httpx.ReadTimeout,
                                       httpx.WriteTimeout, httpx.PoolTimeout)):
                raise UpstreamTimeout(
                    "The provider did not respond in time after "
                    f"{self.config.retry.max_attempts} attempts."
                )
            raise UpstreamUnavailable(
                "Could not reach the model provider after "
                f"{self.config.retry.max_attempts} attempts."
            )
        finally:
            if owns_client:
                await client.aclose()

    # ── public API ───────────────────────────────────────────────────────────

    async def generate_structured(
        self,
        system: str,
        user: str,
        schema_model: type[TModel],
    ) -> TModel:
        """
        Call the model and return a validated instance of `schema_model`.

        Raises only `HarnessError` subclasses — never a bare httpx or pydantic
        error. That is the contract the FastAPI layer depends on.
        """
        url, headers, payload = self._build_request(system, user, schema_model)
        body = await self._post(url, headers, payload)
        raw_text = self._extract_text(body)

        try:
            return schema_model.model_validate(extract_json(raw_text))
        except (MalformedLLMOutput, ValidationError) as exc:
            # Rebind: Python deletes the `as` name when the except block exits,
            # so `exc` is not visible after this point.
            first_error: Exception = exc
            if not self.config.enable_repair_pass:
                raise _as_malformed(first_error, raw_text)
            log.warning("schema validation failed, attempting repair pass: %s",
                        _short_errors(first_error))

        # One repair round trip. Same schema, tiny prompt, low temperature.
        repair_user = REPAIR_USER_TEMPLATE.format(
            errors=_short_errors(first_error), raw=raw_text[:6000],
        )
        r_url, r_headers, r_payload = self._build_request(REPAIR_SYSTEM, repair_user, schema_model)
        try:
            repaired_body = await self._post(r_url, r_headers, r_payload)
            repaired_text = self._extract_text(repaired_body)
            return schema_model.model_validate(extract_json(repaired_text))
        except (MalformedLLMOutput, ValidationError) as second_error:
            raise _as_malformed(second_error, raw_text) from None


# ── helpers ──────────────────────────────────────────────────────────────────

def _safe_excerpt(text: str, limit: int = 300) -> str:
    """Provider error bodies can echo the request. Truncate, and never keys."""
    return re.sub(r"(sk-|AIza)[A-Za-z0-9_\-]{6,}", r"\1***", (text or ""))[:limit]


def _parse_retry_after(value: str | None) -> float | None:
    if not value:
        return None
    try:
        return float(value)
    except ValueError:
        return None


def _short_errors(exc: Exception) -> str:
    if isinstance(exc, ValidationError):
        lines = [
            f"- {'.'.join(str(p) for p in e['loc'])}: {e['msg']}"
            for e in exc.errors()[:12]
        ]
        return "\n".join(lines)
    return str(exc)


def _as_malformed(exc: Exception, raw: str) -> MalformedLLMOutput:
    if isinstance(exc, MalformedLLMOutput):
        return exc
    return MalformedLLMOutput(
        "The model's response did not match the required schema, and the "
        "repair attempt also failed. This request is safe to retry.",
        raw_excerpt=f"{_short_errors(exc)}\n---\n{raw}",
    )


def now_ms() -> int:
    return int(time.monotonic() * 1000)
