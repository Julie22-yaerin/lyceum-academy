# The Lyceum STEM Learning Orchestrator

**v1.0.0** · Python 3.10+ · Gemini · OpenAI · Anthropic · Bring Your Own Key

A pedagogical agent, not a prompt wrapper. It validates the input, works out what
the learner actually needs, then **selects and chains** specialised skill
plug-ins — and returns one strictly-validated JSON document your UI can render
directly.

```
learner input
   ↓  guardrails ......... junk, injection and off-topic refused locally (0 tokens)
   ↓  intent classifier .. free heuristic; a model only when genuinely unsure
   ↓  plan ............... which skills, in which order
   ↓  skill chain ........ PersonalizeContext → ReverseBuilding → Feynman → Humanizer
   ↓
LearningResponse (strict JSON + full execution trace)
```

Every workspace tool is **just a skill**. Register your own and the orchestrator
routes to it without a line of change in its own code.

---

## Integrate in 5 minutes

```bash
pip install "lyceum-stem-orchestrator[api]"
uvicorn main:app --port 8000          # OpenAPI at /docs
```

```bash
curl -sS http://localhost:8000/v1/orchestrate \
  -H "Content-Type: application/json" \
  -H "X-LLM-API-Key: $YOUR_KEY" \
  -H "X-LLM-Provider: anthropic" \
  -d '{ "text": "Derive the Pythagorean theorem from first principles",
        "level": "high_school" }'
```

```jsonc
{
  "plan": ["personalize_context", "humanizer", "reverse_building", "feynman"],
  "intent": { "intent": "deconstruct_system", "confidence": 0.79, "source": "heuristic" },
  "level_applied": "high_school",
  "reverse_building": { "derivation": [ /* … */ ], "collapses_if": [ /* … */ ] },
  "feynman":          { "knowledge_gaps": [ /* … */ ], "analogies": [ /* … */ ] },
  "meta": { "total_llm_calls": 2, "latency_ms": 7180, "trace": [ /* … */ ] }
}
```

`plan` tells you which payloads to expect, so the UI never guesses. `meta.trace`
shows what ran, what it cost, and what was skipped.

---

## The four built-in skills

| Skill | LLM calls | Role |
|---|---|---|
| **PersonalizeContext** | **0** | Tailors depth, assumed knowledge and notation to the level (`middle_school` → `olympiad`). Local lookup, not a model call. |
| **ReverseBuildingEngine** | 1 | Deconstructs a theorem/system to first principles, then rebuilds the derivation ladder. Every step tagged with the method it *must* use. |
| **FeynmanEngine** | 1 | Simplifies with intuitive framing and analogies that declare their own limits; surfaces the prerequisite knowledge gaps. |
| **PedagogicalHumanizer** | **0** or 1 | Encouraging, inquisitive, empathetic voice. Free in `directive` mode; 1 call in `rewrite` mode. |

### Routing

| Detected intent | Chain |
|---|---|
| `deconstruct_system` | Personalize → **ReverseBuilding → Feynman** |
| `explain_concept` | Personalize → Feynman |
| `simplify_further` | Personalize → Feynman (told the standard explanation already failed) |
| `compare_concepts` | Personalize → Feynman (difference made the spine) |
| `unknown` | Personalize → Feynman (safe default) |

`deconstruct_system` deliberately runs **both** producers: the derivation alone is
usually what confused the learner, so the intuitive pass is chained over it and
told to stay consistent with the axioms and method names it just produced.

---

## Three cost decisions we made for you

**1. Two of the four skills never call a model.** Turning "this learner is at
A-level" into "assume single-variable calculus, use 9701 conventions, do not
assume multivariable" is a lookup, not reasoning. Charging a round trip for it
would add latency to every request and give a *less* consistent answer than a
table does.

**2. The Humanizer defaults to `directive` mode — zero extra calls.** Instead of
generating content and then paying again to re-voice it, it appends tone
constraints to the producers' prompts, so one call produces already-warm output.
Switch to `"humanizer_mode": "rewrite"` when you want the warm layer as a
*separate renderable block* (a chat bubble above a technical card).

**3. Classification is free when it can be.** A local heuristic resolves the
clear majority of inputs; the model classifier is consulted only when heuristic
confidence falls below a threshold, and `"allow_model_classifier": false` forbids
it permanently. `intent.source` tells you which path ran.

A hard ceiling (`LYCEUM_MAX_LLM_CALLS`, default 4) caps calls per request. If a
plan would exceed it, skills are dropped **from the end** — the cheap
high-value work survives, only optional polish is lost.

---

## Authentication (BYOK)

There is no Lyceum key. You pass **your own** provider key per request.

| Header | Required | Value |
|---|---|---|
| `X-LLM-API-Key` | **yes** | Your Gemini / OpenAI / Anthropic key |
| `X-LLM-Provider` | no | `gemini` (default) · `openai` · `anthropic` |
| `X-LLM-Model` | no | Override, e.g. `claude-sonnet-4-5`, `gpt-4o`, `gemini-2.5-pro` |
| `X-Request-Id` | no | Your correlation id; echoed on the response |

Your key is used for that one request and dropped: never persisted, never logged
unredacted (`AIza…7f` at most), never echoed in a body. Self-host and it never
leaves your infrastructure.

> **Do not call this from a browser.** `X-LLM-API-Key` in front-end code exposes
> your key to end users. Call it from your backend.

---

## Endpoints

| Method | Path | Key? | Cost |
|---|---|---|---|
| `POST` | `/v1/orchestrate` | yes | 1–4 LLM calls |
| `POST` | `/v1/classify` | yes | 0 calls when the heuristic is confident |
| `POST` | `/v1/validate` | **no** | Always 0 — guardrails only |
| `GET` | `/v1/skills` | **no** | 0 — capability discovery |
| `GET` | `/healthz` | no | 0 — never calls a provider |

### Request body (`/v1/orchestrate`, `/v1/classify`)

| Field | Type | Default | Notes |
|---|---|---|---|
| `text` | string | — | **Required.** 8–4000 chars. |
| `level` | enum? | `null` | `middle_school` `high_school` `a_level` `undergraduate` `olympiad`. Omit to infer; an explicit value **always wins**. |
| `subject` | enum? | `null` | `math` `physics` `chemistry` `biology` `computer_science` `other`. |
| `integrator_notes` | string | `""` | Context about your learners. Treated as **data**, never instructions. |
| `strict_stem` | bool | `false` | Raise the STEM bar: rejects more, costs less. |
| `allow_model_classifier` | bool? | `null` | `false` keeps classification permanently free. |
| `humanizer_mode` | string | `"directive"` | `"directive"` (0 calls) or `"rewrite"` (+1 call, separate block). |

---

## Response contract

```jsonc
{
  "schema_version": "1.0",
  "request_id": "5d71a48d82dc4dd4",

  "intent": {
    "intent": "deconstruct_system",   // explain_concept | simplify_further | compare_concepts | unknown
    "subject": "math",
    "level": "high_school",
    "target": "the Pythagorean theorem",
    "confidence": 0.79,
    "source": "heuristic"             // "heuristic" = this cost you nothing
  },
  "plan": ["personalize_context", "humanizer", "reverse_building", "feynman"],
  "title": "the Pythagorean theorem",
  "level_applied": "high_school",

  "reverse_building": {
    "summary": "Relates the three sides of any right triangle.",
    "building_blocks": [
      { "name": "Right angle", "role": "Fixes the geometry", "is_axiomatic": true, "latex": "" }
    ],
    "governing_rules": [
      { "name": "Similar triangles", "statement": "Side ratios are preserved.",
        "latex": "", "holds_when": "Euclidean plane" }
    ],
    "derivation": [
      { "index": 1, "statement": "Drop an altitude to the hypotenuse.",
        "justification": "Always constructible.",
        "required_tool": "auxiliary construction", "latex": "" }
    ],
    "collapses_if": ["The plane is not Euclidean"],
    "prerequisites": ["Area of a triangle"],
    "visual_hints": []
  },

  "feynman": {
    "one_sentence": "…",
    "plain_explanation": "…",
    "analogies": [
      { "title": "…", "body": "…", "breaks_down_when": "…" }
    ],
    "jargon_translated": { "hypotenuse": "the long side, opposite the right angle" },
    "knowledge_gaps": [
      { "prerequisite": "…", "why_it_matters": "…", "diagnostic_question": "…" }
    ],
    "common_misconception": "…",
    "equations": ["a^2+b^2=c^2"],
    "visual_hints": [{ "kind": "diagram", "description": "…", "latex": "" }]
  },

  "humanizer": null,                  // populated only in rewrite mode

  "meta": {
    "provider": "gemini", "model": "gemini-2.5-flash",
    "latency_ms": 7180, "total_llm_calls": 2,
    "usage": { "input_tokens": 1210, "output_tokens": 2480 },
    "trace": [
      { "skill": "personalize_context", "executed": true, "llm_calls": 0, "note": "9 directives for high_school" },
      { "skill": "reverse_building",    "executed": true, "llm_calls": 1, "note": "2 steps, 2 blocks (2 axiomatic)" }
    ]
  }
}
```

**Conventions.** LaTeX fields carry **bare LaTeX** — no `$`, no `\[` — because a
MathJax renderer and a Manim `MathTex` want different wrapping. Nothing is ever
omitted: inapplicable fields are `""` or `[]`, so you can bind without existence
checks. `visual_hints` is advisory and safe to ignore.

**Fields worth building product on.** `knowledge_gaps` tells you what to teach
*first* — each with a diagnostic question whose wrong answer proves the gap.
`required_tool` lets you refuse a learner's lower-level shortcut around the
method being taught. `collapses_if` is excellent exam-question material.

### Versioning
`schema_version` is `"1.0"`. Additive changes ship without a bump — **do not
reject unknown fields**. Breaking changes get a new path (`/v2/…`).

---

## Errors

Every failure, without exception:

```jsonc
{ "error": { "code": "rate_limited", "message": "…", "request_id": "…" } }
```

| HTTP | `code` | Meaning | Action |
|---|---|---|---|
| 401 | `missing_api_key` | No `X-LLM-API-Key` | Send your key |
| 401 | `invalid_api_key` | Provider rejected it | Fix the key. **Not retryable** |
| 400 | `unsupported_provider` | Unknown provider | `gemini` · `openai` · `anthropic` |
| 400 | `unknown_skill` | Asked for an unregistered skill | Check `GET /v1/skills` |
| 422 | `input_rejected` | Guardrails refused, **before any LLM call** | Show `error.reason`. No cost |
| 422 | `content_blocked_upstream` | Provider safety layer refused | Surface as unsupported |
| 429 | `rate_limited` | Throttled, retries exhausted | Honour `Retry-After` |
| 502 | `malformed_model_output` | Schema broken twice | **Retryable** |
| 502 | `skill_failed` | One skill died unrecoverably | Retryable; `error.skill` names it |
| 503 | `upstream_unavailable` / `upstream_timeout` | Provider down or slow | Retry with backoff |
| 500 | `internal_error` | Our bug | Report with `request_id` |

`input_rejected` carries the diagnosis:

```jsonc
{ "error": {
    "code": "input_rejected",
    "reason": "prompt_injection",
    "failed_checks": [{ "check": "injection", "passed": false, "note": "instruction_override" }] } }
```

`reason` ∈ `empty_input` · `too_short` · `too_long` · `unintelligible` ·
`prompt_injection` · `not_stem`.

**Graceful degradation.** If a *later* producer fails after an earlier one
succeeded, you get **200 with a partial result** and the failure in
`meta.trace` — the learner keeps the derivation instead of seeing an error page.
Only a failure with nothing usable produced raises.

---

## Use it as a library (no HTTP hop)

```python
from harness import STEMOrchestrator, StudentLevel, GuardrailRejection, HarnessError

orch = STEMOrchestrator(api_key=user_key, provider="anthropic")

try:
    res = await orch.run(
        "Derive the Pythagorean theorem from first principles",
        level=StudentLevel.HIGH_SCHOOL,
    )
except GuardrailRejection as e:
    return reject(e.reason)          # cost you nothing
except HarnessError as e:
    return retry_later(e.code)       # every failure is typed

for step in res.reverse_building.derivation:
    render(step.statement, requires=step.required_tool)
for gap in res.feynman.knowledge_gaps:
    schedule_prerequisite(gap.prerequisite, probe=gap.diagnostic_question)
```

Preview the route and cost first, for free:

```python
plan = await orch.dry_run("Prove that the square root of 2 is irrational")
plan.would_run             # [personalize_context, humanizer, reverse_building, feynman]
plan.estimated_llm_calls   # 2
```

---

## Add your own skill

This is the extension point — every workspace tool is a skill.

```python
from harness import Skill, SkillContext, SkillResult, STEMOrchestrator
from harness.schemas import Intent

class LotusMapSkill(Skill):
    name = "lotus_map"
    description = "Symmetric mind map. Local, no LLM call."
    requires_llm = False                  # free: the orchestrator budgets on this
    handles_intents = (Intent.EXPLAIN_CONCEPT,)   # () means "any intent"

    async def run(self, ctx: SkillContext) -> SkillResult:
        ctx.extras["lotus_map"] = build_map(ctx.intent.target, ctx.feynman)
        return SkillResult(executed=True, note="built a lotus map")

orch = STEMOrchestrator(api_key=key)
orch.register(LotusMapSkill())             # routable immediately
```

Three kinds of skill, distinguished because they cost differently:

| Kind | Flags | Runs | Example |
|---|---|---|---|
| **Local** | `requires_llm = False` | first | PersonalizeContext |
| **Producer** | `requires_llm = True` | middle | Feynman, ReverseBuilding |
| **Post-processor** | `is_post_processor = True` | last | Humanizer (rewrite mode) |

Skills never import one another. They read and write `SkillContext`, which is how
`Feynman` can build on `ReverseBuilding`'s output without knowing it exists.

---

## Configuration

All optional; the harness runs correctly with none of them set.

| Variable | Default | Purpose |
|---|---|---|
| `LYCEUM_MAX_LLM_CALLS` | `4` | Hard ceiling per request |
| `LYCEUM_MAX_ATTEMPTS` | `3` | First call + 2 retries |
| `LYCEUM_RETRY_BASE_S` / `_MAX_S` | `0.75` / `8.0` | Backoff, full jitter |
| `LYCEUM_MAX_RETRY_AFTER_S` | `10.0` | Cap on a provider's `Retry-After` |
| `LYCEUM_CONNECT_TIMEOUT_S` / `_READ_` | `5.0` / `90.0` | Separate connect/read |
| `LYCEUM_TEMPERATURE` | `0.25` | Low: UI output should not churn |
| `LYCEUM_MAX_OUTPUT_TOKENS` | `4096` | |
| `LYCEUM_REPAIR_PASS` | `1` | `0` disables the schema-repair call |
| `LYCEUM_MODEL_CLASSIFIER` | `1` | `0` forces the free heuristic only |
| `LYCEUM_CLASSIFIER_THRESHOLD` | `0.55` | Below this, escalate to the model |
| `LYCEUM_CORS_ORIGINS` | *(closed)* | Comma-separated allowlist |
| `LYCEUM_{GEMINI,OPENAI,ANTHROPIC}_MODEL` | see `config.py` | Default model per provider |

**Retried:** 408, 409, 425, 429, 5xx, connection errors, timeouts, with full
jitter so a fleet of your instances does not retry in lockstep.
**Never retried:** 400, 401, 403 — your key or payload is wrong, and hammering
the provider only burns your quota.

---

## Structure

```
harness/
├── guardrails.py     Validation + intent classification (both local-first)
├── orchestrator.py   STEMOrchestrator, SkillRegistry — routing and cost only
├── skills/
│   ├── base_skill.py Skill ABC, SkillContext, SkillResult
│   ├── feynman.py    prompt + binding, self-contained
│   ├── reverse_building.py
│   ├── humanizer.py  directive (free) / rewrite (1 call)
│   └── personalize.py  local level & subject profiles
├── schemas.py        Pydantic models = the JSON contract
├── llm_client.py     BYOK wrapper: 3 providers, retry, JSON repair
├── config.py         Timeouts, retry, budgets. No secrets
└── errors.py         Typed exceptions, stable codes
main.py               FastAPI reference server
```

Each layer is independently usable: import `guardrails` alone to pre-filter in
your own pipeline, or `LLMClient` alone for strict-JSON calls against your own
schemas.

```bash
pip install -e ".[api,dev]"
pytest -q      # 46 tests, no network, no API key
```

The suite covers routing order, the call budget, all three providers' structured
output, 429-then-success, rate-limit exhaustion, the repair pass, partial-result
degradation, and third-party skill registration.

---

## Limits and honest caveats

- **Guardrails are not a security boundary.** They are a cost-control and hygiene
  layer: heuristic patterns plus a relevance score. The real defence is that
  every prompt treats learner text as data. If you pipe learner text into other
  systems, apply your own controls.
- **Not a fact-checker.** Prompts forbid fabricated citations and constants and
  demand mechanism over name-dropping, but an LLM can still be confidently wrong.
  For high-stakes assessment, keep a human in the loop.
- **`strict: false` on OpenAI's `json_schema`** is deliberate: the contract
  contains an open-ended `Dict[str, str]` (`jargon_translated`) which strict mode
  forbids and 400s the whole request over. Pydantic validates on the way out
  regardless, so the contract holds without a hard failure mode.
- **Third-party skills are not in the `SkillName` enum**, so they appear in
  `plan`/`trace` under the nearest built-in slot with their real name in `note`.
  Extend the enum if you need them first-class.
- **No streaming.** These are structured single-shot documents; partial JSON is
  not useful to a renderer. Ask if you want SSE for perceived latency.
- **No built-in rate limiting or tenant metering.** You hold the key, so you hold
  the quota. Put your own limiter in front if you resell this.

---

© The Lyceum. Proprietary. Contact for commercial licensing and SLA terms.
