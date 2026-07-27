"""
BYOK LLM wrapper: one interface, three providers, strict JSON out.

Responsibilities:
  1. Translate (system, user, pydantic model) into each provider's wire format.
  2. Force structured output through the provider's NATIVE mechanism, not by
     asking the prompt nicely.
  3. Retry the retryable with exponential backoff + full jitter.
  4. Validate, and on failure run one repair pass before giving up.

The three providers want three *incompatible* things, which is the fiddly part
and the reason this file exists:

  Gemini    `generationConfig.responseSchema` — an OpenAPI SUBSET. Rejects
            `$ref`, `$defs`, `additionalProperties`, `title`, `anyOf`-with-null.
  OpenAI    `response_format.json_schema` — wants the opposite: every object
            closed with `additionalProperties: false`.
  Anthropic no response_format at all. Structured output is done by declaring a
            single tool whose `input_schema` is the model, then forcing
            `tool_choice` to it and reading `content[].input`.

Getting any of these wrong produces a 400 that looks like a bug in your prompt.
"""

from __future__ import annotations

import asyncio
import json
import logging
import random
import re
from copy import deepcopy
from typing import Any, TypeVar

import httpx
from pydantic import BaseModel, ValidationError

from .config import (
    ANTHROPIC_API_VERSION,
    DEFAULT_CONFIG,
    DEFAULT_MODELS,
    PROVIDER_ENDPOINTS,
    OrchestratorConfig,
    Provider,
    redact,
)
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

log = logging.getLogger("harness.llm")

TModel = TypeVar("TModel", bound=BaseModel)

_RETRYABLE_STATUS = {408, 409, 425, 429, 500, 502, 503, 504, 529}
_STRUCTURED_TOOL_NAME = "emit_result"

_REPAIR_SYSTEM = """
You are a JSON repair function. You receive a schema-violating JSON document and
the validation errors it produced.

Return the CORRECTED JSON object and nothing else. Preserve every correct value
EXACTLY as written — do not rewrite, improve, shorten, translate or re-explain
any field. Fix only what the errors identify: missing keys, wrong types, wrong
enum values, out-of-range array lengths.

If a required field is absent and cannot be inferred from what is present,
supply the most conservative valid value (an empty string, or a single-element
array restating what is already there).

Return a single JSON object. No markdown fences, no prose.
""".strip()


# ── Schema transformers ──────────────────────────────────────────────────────

def inline_refs(schema: dict) -> dict:
    """
    Resolve every local `$ref` against `$defs` and drop the defs block.

    Depth-capped rather than cycle-detecting: our models are acyclic by
    construction, and a self-referencing model should fail loudly here instead
    of recursing until the worker dies.
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
            name = node["$ref"].split("/")[-1]
            target = defs.get(name)
            if target is None:
                raise ValueError(f"unresolvable $ref: {node['$ref']}")
            merged = dict(resolve(deepcopy(target), depth + 1))
            for k, v in node.items():          # sibling keys (description) win
                if k != "$ref":
                    merged[k] = resolve(v, depth + 1)
            return merged
        return {k: resolve(v, depth + 1) for k, v in node.items()}

    return resolve({k: v for k, v in schema.items() if k not in ("$defs", "definitions")})


_GEMINI_ALLOWED = {
    "type", "format", "description", "nullable", "enum", "items",
    "properties", "required", "propertyOrdering", "minItems", "maxItems",
}


def to_gemini_schema(model: type[BaseModel]) -> dict:
    raw = inline_refs(model.model_json_schema())

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
                out["enum"] = [value]
                out.setdefault("type", "string")
                continue
            if key == "properties":
                # A properties MAP's keys are field names, not schema keywords.
                # Filtering them against the allow-list would delete every field.
                out["properties"] = {k: clean(v) for k, v in (value or {}).items()}
                continue
            if key not in _GEMINI_ALLOWED:
                continue
            out[key] = clean(value)

        # Open-ended Dict[str, str] (jargon_translated) has no Gemini analogue:
        # degrade to a bare object and let the model populate it.
        if out.get("type") == "object" and not out.get("properties"):
            out.pop("properties", None)
            out.pop("required", None)
        return out

    return clean(raw)


def _strip_meta(node: Any, drop: tuple[str, ...]) -> Any:
    """Shared cleaner for OpenAI/Anthropic: both take normal JSON Schema."""
    if isinstance(node, list):
        return [_strip_meta(n, drop) for n in node]
    if not isinstance(node, dict):
        return node
    out: dict = {}
    for k, v in node.items():
        if k in drop:
            continue
        out[k] = ({pk: _strip_meta(pv, drop) for pk, pv in (v or {}).items()}
                  if k == "properties" else _strip_meta(v, drop))
    return out


def to_openai_schema(model: type[BaseModel]) -> dict:
    """
    OpenAI `json_schema`. `strict` is False deliberately — see the note below.
    """
    raw = inline_refs(model.model_json_schema())
    cleaned = _strip_meta(raw, ("title", "default", "$schema", "minLength", "maxLength"))

    def close_objects(node: Any) -> Any:
        if isinstance(node, list):
            return [close_objects(n) for n in node]
        if not isinstance(node, dict):
            return node
        out = {k: ({pk: close_objects(pv) for pk, pv in v.items()}
                   if k == "properties" and isinstance(v, dict) else close_objects(v))
               for k, v in node.items()}
        if out.get("type") == "object":
            props = out.get("properties")
            if isinstance(props, dict) and props:
                out["additionalProperties"] = False
                out["required"] = list(props.keys())
            else:
                out["additionalProperties"] = True     # the open-ended map
                out.pop("required", None)
        return out

    # strict=False on purpose: our contract contains an open-ended
    # Dict[str, str] (jargon_translated), which strict mode forbids outright and
    # 400s the entire request over. Non-strict json_schema still constrains the
    # model hard, and Pydantic validates on the way out regardless — so the
    # contract holds either way, without a hard failure mode.
    return {"name": model.__name__, "strict": False, "schema": close_objects(cleaned)}


def to_anthropic_tool(model: type[BaseModel]) -> dict:
    """
    Anthropic has no response_format. The idiomatic way to get guaranteed
    structure is a single forced tool whose input_schema IS the model.
    """
    raw = inline_refs(model.model_json_schema())
    cleaned = _strip_meta(raw, ("title", "default", "$schema"))
    cleaned.setdefault("type", "object")
    return {
        "name": _STRUCTURED_TOOL_NAME,
        "description": f"Emit the {model.__name__} result. Call this exactly once.",
        "input_schema": cleaned,
    }


# ── JSON extraction ──────────────────────────────────────────────────────────

_FENCE_RE = re.compile(r"^\s*```(?:json)?\s*|\s*```\s*$", re.IGNORECASE)


def extract_json(raw: str) -> dict:
    """
    Pull a JSON object out of a model response.

    Native JSON modes usually return clean JSON — but not always. A refusal, a
    truncation, or a stray "Here is the JSON:" all happen in production.
    Brace-matching rather than a greedy regex, so nested objects and braces
    inside strings survive.
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
                        f"Model response was not valid JSON: {exc.msg}", raw_excerpt=raw,
                    ) from None
    raise MalformedLLMOutput("Model response contained unterminated JSON.", raw_excerpt=raw)


# ── Client ───────────────────────────────────────────────────────────────────

class LLMClient:
    """
    Stateless, per-request LLM caller.

    BYOK: `api_key` lives only as long as this object and is never logged in
    full. Construct one per request (cheap) and hand it the shared httpx pool.

    `calls` and `usage` accumulate across every call made through this instance,
    which is how the orchestrator reports per-request cost.
    """

    def __init__(
        self,
        api_key: str,
        provider: Provider | str = Provider.GEMINI,
        model: str | None = None,
        config: OrchestratorConfig = DEFAULT_CONFIG,
        http_client: httpx.AsyncClient | None = None,
    ) -> None:
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

        self.calls: int = 0
        self.usage: dict[str, int] = {"input_tokens": 0, "output_tokens": 0}

    # ── wire formats ─────────────────────────────────────────────────────────

    def _build(self, system: str, user: str, schema_model: type[BaseModel]) -> tuple[str, dict, dict]:
        base = PROVIDER_ENDPOINTS[self.provider]

        if self.provider is Provider.GEMINI:
            return (
                f"{base}/models/{self.model}:generateContent",
                # Header, not ?key= — query strings land in access logs and proxy
                # caches far more often than headers do.
                {"x-goog-api-key": self.api_key, "Content-Type": "application/json"},
                {
                    "systemInstruction": {"parts": [{"text": system}]},
                    "contents": [{"role": "user", "parts": [{"text": user}]}],
                    "generationConfig": {
                        "temperature": self.config.temperature,
                        "maxOutputTokens": self.config.max_output_tokens,
                        "responseMimeType": "application/json",
                        "responseSchema": to_gemini_schema(schema_model),
                    },
                },
            )

        if self.provider is Provider.OPENAI:
            return (
                f"{base}/chat/completions",
                {"Authorization": f"Bearer {self.api_key}", "Content-Type": "application/json"},
                {
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
                },
            )

        # Anthropic: forced single tool call is the structured-output mechanism.
        return (
            f"{base}/messages",
            {
                "x-api-key": self.api_key,
                "anthropic-version": ANTHROPIC_API_VERSION,
                "Content-Type": "application/json",
            },
            {
                "model": self.model,
                "max_tokens": self.config.max_output_tokens,
                "temperature": self.config.temperature,
                "system": system,
                "messages": [{"role": "user", "content": user}],
                "tools": [to_anthropic_tool(schema_model)],
                "tool_choice": {"type": "tool", "name": _STRUCTURED_TOOL_NAME},
            },
        )

    def _extract(self, body: dict) -> dict | str:
        """
        Returns either a parsed dict (Anthropic tool input) or raw text to be
        run through `extract_json`.
        """
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
                log.warning("gemini hit MAX_TOKENS — output likely truncated")
            u = body.get("usageMetadata") or {}
            self._add_usage(u.get("promptTokenCount"), u.get("candidatesTokenCount"))
            return "".join(p.get("text", "") for p in (cand.get("content") or {}).get("parts") or [])

        if self.provider is Provider.OPENAI:
            choices = body.get("choices") or []
            if not choices:
                raise MalformedLLMOutput("Provider returned no choices.")
            choice = choices[0]
            if choice.get("finish_reason") == "content_filter":
                raise ContentBlocked("Provider content filter blocked the response.")
            if choice.get("finish_reason") == "length":
                log.warning("openai hit length limit — output likely truncated")
            u = body.get("usage") or {}
            self._add_usage(u.get("prompt_tokens"), u.get("completion_tokens"))
            msg = choice.get("message") or {}
            if msg.get("refusal"):
                raise ContentBlocked(f"Model refused: {msg['refusal']}")
            return msg.get("content") or ""

        # Anthropic
        if body.get("stop_reason") == "refusal":
            raise ContentBlocked("Model refused to produce the requested output.")
        u = body.get("usage") or {}
        self._add_usage(u.get("input_tokens"), u.get("output_tokens"))
        for block in body.get("content") or []:
            if block.get("type") == "tool_use" and block.get("name") == _STRUCTURED_TOOL_NAME:
                payload = block.get("input")
                if isinstance(payload, dict):
                    return payload
        # Forced tool_choice should make this unreachable; if the model talked
        # instead, fall back to scraping any text blocks for JSON.
        text = "".join(b.get("text", "") for b in (body.get("content") or [])
                       if b.get("type") == "text")
        if not text:
            raise MalformedLLMOutput("Anthropic response contained no tool_use block.")
        log.warning("anthropic returned text instead of the forced tool call")
        return text

    def _add_usage(self, inp: int | None, out: int | None) -> None:
        if inp:
            self.usage["input_tokens"] += int(inp)
        if out:
            self.usage["output_tokens"] += int(out)

    # ── transport ────────────────────────────────────────────────────────────

    def _delay(self, attempt: int, retry_after: str | None) -> float:
        """Honour Retry-After when sane, else backoff with FULL jitter."""
        if retry_after:
            try:
                return max(0.0, min(float(retry_after),
                                    self.config.retry.max_honoured_retry_after_s))
            except ValueError:
                pass  # HTTP-date form — fall through
        ceiling = min(self.config.retry.base_delay_s * (2 ** attempt),
                      self.config.retry.max_delay_s)
        # Full jitter stops a fleet of instances retrying in lockstep.
        return random.uniform(0.0, ceiling)

    async def _post(self, url: str, headers: dict, payload: dict) -> dict:
        timeout = httpx.Timeout(
            connect=self.config.timeouts.connect_s,
            read=self.config.timeouts.read_s,
            write=self.config.timeouts.read_s,
            pool=self.config.timeouts.connect_s,
        )
        client = self._external_client
        owns = client is None
        if owns:
            client = httpx.AsyncClient(timeout=timeout)

        last_transport_error: Exception | None = None
        try:
            for attempt in range(self.config.retry.max_attempts):
                try:
                    resp = await client.post(url, headers=headers, json=payload, timeout=timeout)
                except (httpx.ConnectTimeout, httpx.ReadTimeout,
                        httpx.WriteTimeout, httpx.PoolTimeout) as exc:
                    last_transport_error = exc
                    log.warning("timeout attempt %d/%d (%s, key=%s)", attempt + 1,
                                self.config.retry.max_attempts, type(exc).__name__,
                                redact(self.api_key))
                except httpx.HTTPError as exc:
                    last_transport_error = exc
                    log.warning("transport error attempt %d/%d: %s", attempt + 1,
                                self.config.retry.max_attempts, type(exc).__name__)
                else:
                    if resp.status_code < 400:
                        return resp.json()

                    if resp.status_code in (401, 403):
                        raise InvalidCredentials(
                            f"The provider rejected the supplied API key ({resp.status_code}). "
                            "Check the key and its permissions."
                        )
                    if resp.status_code == 400:
                        raise UpstreamUnavailable(
                            "The provider rejected the request as malformed (400).",
                            detail=_safe(resp.text),
                        )
                    if resp.status_code not in _RETRYABLE_STATUS:
                        raise UpstreamUnavailable(
                            f"Provider returned {resp.status_code}.", detail=_safe(resp.text),
                        )

                    if attempt == self.config.retry.max_attempts - 1:
                        if resp.status_code == 429:
                            raise UpstreamRateLimited(
                                "The provider rate-limited this key and retries were "
                                "exhausted. Back off and retry.",
                                retry_after=_retry_after(resp.headers.get("Retry-After")),
                            )
                        raise UpstreamUnavailable(
                            f"Provider returned {resp.status_code} after "
                            f"{self.config.retry.max_attempts} attempts.",
                            detail=_safe(resp.text),
                        )
                    await asyncio.sleep(self._delay(attempt, resp.headers.get("Retry-After")))
                    continue

                if attempt == self.config.retry.max_attempts - 1:
                    break
                await asyncio.sleep(self._delay(attempt, None))

            if isinstance(last_transport_error, (httpx.ConnectTimeout, httpx.ReadTimeout,
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
            if owns:
                await client.aclose()

    # ── public ───────────────────────────────────────────────────────────────

    async def generate(self, system: str, user: str, schema_model: type[TModel]) -> TModel:
        """
        Call the model and return a validated `schema_model`.

        Raises only `HarnessError` subclasses — never a bare httpx or pydantic
        error. The FastAPI layer depends on that.
        """
        url, headers, payload = self._build(system, user, schema_model)
        self.calls += 1
        raw = self._extract(await self._post(url, headers, payload))

        try:
            data = raw if isinstance(raw, dict) else extract_json(raw)
            return schema_model.model_validate(data)
        except (MalformedLLMOutput, ValidationError) as exc:
            first: Exception = exc     # rebind: `exc` is deleted after this block
            if not self.config.enable_repair_pass:
                raise _malformed(first, raw)
            log.warning("schema validation failed, repairing: %s", _short(first))

        repair_user = (
            f"VALIDATION ERRORS:\n{_short(first)}\n\n"
            f"DOCUMENT TO REPAIR:\n<<<\n{_as_text(raw)[:6000]}\n>>>"
        )
        r_url, r_headers, r_payload = self._build(_REPAIR_SYSTEM, repair_user, schema_model)
        self.calls += 1
        try:
            repaired = self._extract(await self._post(r_url, r_headers, r_payload))
            data = repaired if isinstance(repaired, dict) else extract_json(repaired)
            return schema_model.model_validate(data)
        except (MalformedLLMOutput, ValidationError) as exc2:
            raise _malformed(exc2, raw) from None


# ── helpers ──────────────────────────────────────────────────────────────────

def _safe(text: str, limit: int = 300) -> str:
    """Provider error bodies can echo the request. Truncate, and never keys."""
    return re.sub(r"(sk-|AIza|sk-ant-)[A-Za-z0-9_\-]{6,}", r"\1***", text or "")[:limit]


def _retry_after(value: str | None) -> float | None:
    if not value:
        return None
    try:
        return float(value)
    except ValueError:
        return None


def _as_text(raw: dict | str) -> str:
    return json.dumps(raw, ensure_ascii=False) if isinstance(raw, dict) else str(raw)


def _short(exc: Exception) -> str:
    if isinstance(exc, ValidationError):
        return "\n".join(
            f"- {'.'.join(str(p) for p in e['loc'])}: {e['msg']}" for e in exc.errors()[:12]
        )
    return str(exc)


def _malformed(exc: Exception, raw: dict | str) -> MalformedLLMOutput:
    if isinstance(exc, MalformedLLMOutput):
        return exc
    return MalformedLLMOutput(
        "The model's response did not match the required schema, and the repair "
        "attempt also failed. This request is safe to retry.",
        raw_excerpt=f"{_short(exc)}\n---\n{_as_text(raw)}",
    )
