# The Lyceum — STEM Deconstruction Harness

**v1.0.0** · Python 3.10+ · Bring Your Own Key

Four prompt-engineered STEM engines behind a strict JSON contract. You supply
your own LLM key; we supply the pedagogy, the guardrails and the reliability
layer.

| Engine | Endpoint | What it does |
|---|---|---|
| **Reverse Build Auditor** | `POST /v1/reverse-build/evaluate` | Audits a learner's own explanation: is the reasoning logically sound, and did they apply the lesson's concept? Returns the next state to route them to. |
| **Podcast Producer** | `POST /v1/podcast` | Turns study material into a TTS-ready script with note cues. Three formats. No LaTeX in spoken text. |
| **Feynman** | `POST /v1/feynman` | Breaks a concept down into plain language, analogies **with their limits**, and the prerequisite gaps a learner is missing. |
| **Deconstruction** | `POST /v1/deconstruct` | Takes a theorem or system apart to first principles, then rebuilds the derivation ladder — each step tagged with the method it *must* use. |
| Guardrails | `POST /v1/validate` | Free. Runs input validation with no LLM call, so you can pre-check in your own UI. |

---

## 1. Why this rather than your own prompt

Three things you would otherwise build and maintain yourself:

**The output is a contract, not prose.** Every response validates against a
Pydantic schema before it leaves the harness. You render fields; you never
parse Markdown, never regex a bullet list, never handle "the model added a
preamble today". Structured output is forced via each provider's *native*
mechanism (Gemini `responseSchema`, OpenAI `json_schema`), not by asking
politely.

**Bad input never reaches the model.** Prompt injection, gibberish and
non-STEM requests are refused locally, before a billable call. That is your
margin, not ours — we do not hold your key.

**Failures are typed and bounded.** Timeouts, exponential backoff with jitter,
`Retry-After` honoured (and capped), and a repair pass that rescues a
schema-violating response instead of failing your request. Every error is JSON
with a stable `code`. Your app does not go down because a provider hiccuped.

### The pedagogy, specifically

Two rules are enforced in the prompts and in the schema, because they are what
separates this from "explain X simply":

- **An analogy must declare where it breaks.** `breaks_down_when` is a required
  field. An analogy taught without its limits installs a misconception that
  costs more to remove than the original ignorance.
- **Tool fidelity.** Every derivation step carries `required_tool` — the method
  that step must use. A learner who reaches the right number by substituting a
  lower-level method (counting rectangles instead of integrating, testing
  n=1,2,3 instead of induction) has not done the step. You can enforce that,
  because we tell you what the step was for.

  The rule is about **level, not conformity**: a method of equal or greater
  sophistication passes and is recorded as an alternative. An evaluator that
  fails elegant solutions teaches learners to stop thinking.
- **The answer is not the verdict.** The auditor reports `answer_correct` and
  `reasoning_sound` as separate fields and drives the verdict from the
  *reasoning*. A right answer reached by a broken route cannot pass — that is
  the difference between auditing and marking.
- **Spoken text is never LaTeX.** A TTS engine reads `\frac` aloud as
  "backslash f r a c". The podcast schema guarantees `spoken_text` is free of
  LaTeX, markdown and stage directions, with maths verbalised; display forms
  travel separately in `on_screen_latex`. Asserted in the test suite.

---

## 2. Install

```bash
# Library only (embed in your own Python backend)
pip install lyceum-harness

# With the FastAPI reference server
pip install "lyceum-harness[api]"
```

Run the reference server:

```bash
uvicorn lyceum_harness.main:app --host 0.0.0.0 --port 8000
# OpenAPI/Swagger at http://localhost:8000/docs
```

---

## 3. Authentication (BYOK)

There is no Lyceum API key. You pass **your own** provider key on every
request, as a header:

| Header | Required | Value |
|---|---|---|
| `X-LLM-API-Key` | **yes** | Your Google AI Studio or OpenAI key |
| `X-LLM-Provider` | no | `gemini` (default) or `openai` |
| `X-LLM-Model` | no | Model override, e.g. `gemini-2.5-pro`, `gpt-4o` |
| `X-Request-Id` | no | Your correlation id; echoed back on the response |

**What we do with your key:** use it for that one request, then drop it. It is
never persisted, never logged (logs show `AIza…7f` at most), and never included
in a response body. If you deploy this harness yourself, the key never leaves
your infrastructure at all.

> Browser callers: `X-LLM-API-Key` from a browser exposes your key to end
> users. Call the harness from your backend. If you must call it from a
> browser, that key should be one you are willing to have stolen.

---

## 4. Quick start

### cURL

```bash
curl -sS http://localhost:8000/v1/feynman \
  -H "Content-Type: application/json" \
  -H "X-LLM-API-Key: $YOUR_KEY" \
  -H "X-LLM-Provider: gemini" \
  -d '{
        "concept": "Why does a photon have momentum if it has no mass?",
        "subject": "physics",
        "difficulty": "a_level"
      }'
```

### Python (as a library — no HTTP hop)

```python
import asyncio
from lyceum_harness import FeynmanEngine, ReverseBuildingEngine, Subject, Difficulty
from lyceum_harness import GuardrailRejection, UpstreamRateLimited, HarnessError

async def main():
    engine = FeynmanEngine(api_key=YOUR_KEY, provider="gemini")
    try:
        explanation, meta = await engine.run(
            "Why does a photon have momentum if it has no mass?",
            subject=Subject.PHYSICS,
            difficulty=Difficulty.A_LEVEL,
        )
    except GuardrailRejection as e:
        print("rejected before any call:", e.reason)   # cost you nothing
        return
    except UpstreamRateLimited as e:
        print("back off for", e.retry_after, "seconds")
        return
    except HarnessError as e:
        print(e.code, e.message)                       # every failure is typed
        return

    print(explanation.one_sentence)
    for gap in explanation.knowledge_gaps:
        print("teach first:", gap.prerequisite, "→", gap.diagnostic_question)
    print(f"{meta.latency_ms}ms, {meta.attempts} call(s)")

asyncio.run(main())
```

### TypeScript

```ts
const res = await fetch("https://your-harness/v1/deconstruct", {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "X-LLM-API-Key": process.env.LLM_KEY!,   // server-side only
  },
  body: JSON.stringify({
    target: "Derive the Pythagorean theorem from first principles",
    subject: "math",
    difficulty: "high_school",
  }),
});

if (!res.ok) {
  const { error } = await res.json();
  if (error.code === "rate_limited") { /* honour Retry-After */ }
  if (error.code === "input_rejected") { /* show error.reason to the user */ }
  throw new Error(error.code);
}
const { data, meta } = await res.json();
```

---

## 5. Request bodies

### `POST /v1/feynman`

| Field | Type | Default | Notes |
|---|---|---|---|
| `concept` | string | — | **Required.** 8–4000 chars. |
| `subject` | enum | `other` | `math` `physics` `chemistry` `biology` `computer_science` `other` |
| `difficulty` | enum | `a_level` | `middle_school` `high_school` `a_level` `undergraduate` |
| `integrator_notes` | string? | `null` | Context about your learners. Treated as **data**, never instructions. |
| `strict_stem` | bool | `false` | Raise the STEM bar. Rejects more borderline input; saves more cost. |

### `POST /v1/deconstruct`

Identical, except `concept` → **`target`** (the theorem/law/system).

### `POST /v1/reverse-build/evaluate`

| Field | Type | Default | Notes |
|---|---|---|---|
| `explanation` | string | — | **Required.** The learner's own words, judged as-is. |
| `problem` | string | — | **Required.** The original problem statement. |
| `concept` | string | — | **Required.** The lesson concept under test, e.g. `"chain rule"`. |
| `required_tools` | string[] | `[]` | Method(s) the lesson demands. **Strongly recommended** — without it the tool-fidelity gate cannot fire. |
| `reference_answer` | string | `""` | Optional known-correct answer. |
| `subject` | enum | `other` | As above. |
| `integrator_notes` | string? | `null` | Data, never instructions. |

`explanation` runs a **different guardrail profile** from every other endpoint:
shape and injection are enforced, the STEM-relevance filter is not. A learner's
hesitant, jargon-free answer ("it gets bigger then comes back down") scores zero
on a topic filter and is precisely what this endpoint exists to read. The STEM
context comes from `problem`, which you supply and which *is* fully checked.

### `POST /v1/podcast`

| Field | Type | Default | Notes |
|---|---|---|---|
| `material` | string | — | **Required.** Study material to adapt. 8–4000 chars. |
| `format` | enum | `explorers` | `storyteller` (1 voice) · `explorers` (expert + student) · `gladiators` (resolving debate) |
| `minutes` | int | `5` | Target runtime. Clamped to 1–20 rather than rejected — an absurd value is a units mistake, not a reason to 4xx. |
| `topic` | string | `""` | Optional focus within the material. |
| `subject` / `difficulty` | enum | | As above. |

---

## 6. Response shape

Every successful response is `{ "data": ..., "meta": ... }`.

```json
{
  "meta": {
    "request_id": "5d71a48d82dc4dd4",
    "provider": "gemini",
    "model": "gemini-2.5-flash",
    "latency_ms": 4120,
    "attempts": 1,
    "usage": { "input_tokens": 90, "output_tokens": 420 }
  }
}
```

### `/v1/feynman` → `data`

```json
{
  "schema_version": "1.0",
  "engine": "feynman",
  "concept": "Photon momentum",
  "subject": "physics",
  "difficulty": "a_level",

  "one_sentence": "Momentum comes from energy and motion, not from having weight.",
  "plain_explanation": "…",

  "analogies": [
    {
      "title": "Sunlight on a sail",
      "body": "Light pushes a solar sail the way wind pushes cloth.",
      "breaks_down_when": "Wind is made of massive particles; light is not, so the sail's push does not depend on air pressure."
    }
  ],

  "jargon_translated": {
    "rest mass": "the mass a thing has when it is not moving"
  },

  "knowledge_gaps": [
    {
      "prerequisite": "Energy and momentum are separate quantities",
      "why_it_matters": "Without this, p = E/c looks like a contradiction.",
      "diagnostic_question": "Can something have energy but no momentum?"
    }
  ],

  "common_misconception": "That momentum is defined as mass × velocity in all cases.",
  "equations": ["E^2 = (pc)^2 + (mc^2)^2", "p = E/c"],
  "visual_hints": [
    { "kind": "diagram", "description": "Energy-momentum triangle.", "latex": "E^2=(pc)^2+(mc^2)^2" }
  ]
}
```

**Field guide**

| Field | Cardinality | Use it for |
|---|---|---|
| `one_sentence` | 1 | Card headline, TTS opener |
| `plain_explanation` | 1 | Main body |
| `analogies` | 1–3 | Each has a mandatory `breaks_down_when` |
| `jargon_translated` | 0..n | Tooltips / glossary hover |
| `knowledge_gaps` | 1–5 | **The commercial payload.** What to teach *first*, with a diagnostic question per gap |
| `common_misconception` | 1 | Pre-empt the usual wrong model |
| `equations` | 0..n | Bare LaTeX, no `$` |
| `visual_hints` | 0..n | Manim / diagram generation. Advisory |

### `/v1/deconstruct` → `data`

```json
{
  "schema_version": "1.0",
  "engine": "reverse_building",
  "target": "Pythagorean theorem",
  "subject": "math",
  "difficulty": "high_school",

  "summary": "Relates the three sides of any right triangle.",

  "building_blocks": [
    { "name": "Right angle", "role": "Fixes the geometry", "is_axiomatic": true, "latex": "" },
    { "name": "Area additivity", "role": "Lets areas be summed", "is_axiomatic": true, "latex": "" }
  ],

  "governing_rules": [
    { "name": "Similar triangles", "statement": "Side ratios are preserved.", "latex": "", "holds_when": "Euclidean plane" }
  ],

  "derivation": [
    { "index": 1, "statement": "Drop an altitude to the hypotenuse.", "justification": "Always constructible.", "required_tool": "auxiliary construction", "latex": "" },
    { "index": 2, "statement": "a^2 + b^2 = c^2", "justification": "Sum the sub-triangle areas.", "required_tool": "similar triangles", "latex": "a^2+b^2=c^2" }
  ],

  "collapses_if": ["The plane is not Euclidean"],
  "prerequisites": ["Area of a triangle"],
  "visual_hints": []
}
```

**Field guide**

| Field | Cardinality | Use it for |
|---|---|---|
| `building_blocks` | 2–10 | `is_axiomatic` marks the honest floor of the derivation |
| `governing_rules` | 1–8 | `holds_when` is the domain of validity — always present |
| `derivation` | 2–12 | Ordered ladder. `required_tool` is the tool-fidelity gate |
| `collapses_if` | 1–5 | The load-bearing-wall test. Excellent exam-question material |
| `prerequisites` | 0..n | Gate content, or build a syllabus order |

### `/v1/reverse-build/evaluate` → `data`

```json
{
  "schema_version": "1.0",
  "engine": "reverse_build_eval",
  "subject": "math",
  "concept_under_test": "chain rule",

  "answer_correct":  true,
  "reasoning_sound": false,

  "tool_fidelity": {
    "required_tools": ["chain rule"],
    "used_tools": ["numeric estimation"],
    "ok": false,
    "mismatch_note": "Estimated numerically instead of differentiating."
  },

  "concept_applied_correctly": "fail",
  "logical_flow": "partial",
  "completeness": "partial",

  "flaws": [
    {
      "kind": "wrong_concept",
      "where": "took a ratio of values near x",
      "why": "That approximates the derivative rather than applying the chain rule.",
      "is_fatal": true
    }
  ],

  "verdict": "fail",
  "next_state": "HINTING",
  "feedback": "Đáp số đúng, nhưng cách làm chưa dùng quy tắc chuỗi.",
  "hint": "Hãy gọi lớp trong là u rồi thử lại."
}
```

**Field guide**

| Field | Use it for |
|---|---|
| `answer_correct` / `reasoning_sound` | Separate on purpose. **Verdict follows the reasoning** — a right answer by a broken route does not pass |
| `tool_fidelity.ok` | `false` only for a *lower-level* dodge. An equal-or-better alternative method passes, with the alternative noted |
| `flaws[]` | Typed and located: `non_sequitur`, `circular`, `unjustified_leap`, `wrong_concept`, `scope_error`, `sign_or_algebra_slip`, `unit_error`. Empty when sound |
| `is_fatal` | Whether the conclusion survives the flaw — drives whether you block or just annotate |
| `next_state` | **Route on this.** `HINTING` / `REVERSE_BUILD_RETRY` / `TRANSFER_TEST` |
| `feedback` | Written to the learner, in the language they wrote in |
| `hint` | One nudge, never the answer. Empty on `TRANSFER_TEST` |

State machine, fixed and enforced in the prompt:

```
tool_fidelity.ok = false        -> HINTING              (hard gate, overrides all)
any criterion    = fail         -> HINTING
all criteria     = pass         -> TRANSFER_TEST
otherwise (a partial present)   -> REVERSE_BUILD_RETRY
```

### `/v1/podcast` → `data`

```json
{
  "schema_version": "1.0",
  "engine": "podcast",
  "title": "Why the chain rule multiplies",
  "subject": "math",
  "difficulty": "a_level",
  "format": "explorers",
  "speakers": ["Expert", "Student"],

  "hook": "Most people add the two derivatives. That is the mistake.",

  "segments": [
    {
      "speaker": "Student",
      "spoken_text": "So why do we multiply and not add?",
      "on_screen_latex": "",
      "is_note_cue": false
    },
    {
      "speaker": "Expert",
      "spoken_text": "Write this one down. d y by d x equals d y by d u, times d u by d x.",
      "on_screen_latex": "\\frac{dy}{dx}=\\frac{dy}{du}\\cdot\\frac{du}{dx}",
      "is_note_cue": true
    }
  ],

  "takeaways": ["Differentiate the outer layer, keep the inner, multiply by its derivative."],
  "note_prompts": ["The chain rule in dy/du · du/dx form"],
  "key_terms": { "composite function": "a function fed the output of another" },
  "estimated_seconds": 180
}
```

**Field guide**

| Field | Use it for |
|---|---|
| `spoken_text` | Send **straight to TTS**. Guaranteed free of LaTeX, markdown and stage directions; maths verbalised |
| `on_screen_latex` | Show while that line plays. Bare LaTeX, no delimiters |
| `is_note_cue` | The listen-and-write trigger: pause, flash a prompt, or highlight |
| `note_prompts` | The checklist of what the learner's notes should contain by the end |
| `hook` | First ~15s. Use it as your preview/teaser text too |
| `estimated_seconds` | Derived from word count, not guessed — safe for a progress bar |
| `speakers` | 1 name for `storyteller`, 2 for the others. Map to distinct TTS voices |

### Versioning

`schema_version` is `"1.0"`. Additive changes (new optional fields) ship
without a version bump — **do not** reject unknown fields. Breaking changes get
a new path (`/v2/...`); `/v1` keeps working.

---

## 7. Errors

Every failure, without exception, is this shape:

```json
{ "error": { "code": "rate_limited", "message": "…", "request_id": "…" } }
```

| HTTP | `code` | Meaning | What to do |
|---|---|---|---|
| 401 | `missing_api_key` | No `X-LLM-API-Key` | Send your key |
| 401 | `invalid_api_key` | Provider rejected the key | Check key + permissions. **Not retryable** |
| 400 | `unsupported_provider` | Unknown `X-LLM-Provider` | Use `gemini` or `openai` |
| 422 | `input_rejected` | Guardrails refused **before any LLM call** | Show `error.reason` to the user. No cost incurred |
| 422 | `content_blocked_upstream` | Provider safety layer refused | Surface as unsupported content |
| 429 | `rate_limited` | Provider throttled your key, retries exhausted | Honour `Retry-After` header |
| 502 | `malformed_model_output` | Model broke the schema twice | **Retryable.** Usually transient |
| 503 | `upstream_unavailable` / `upstream_timeout` | Provider down or too slow | Retry with backoff |
| 500 | `internal_error` | Our bug | Report with `request_id` |

`input_rejected` also carries the diagnosis:

```json
{
  "error": {
    "code": "input_rejected",
    "reason": "prompt_injection",
    "message": "Input contains an instruction-override or prompt-extraction attempt.",
    "failed_checks": [{ "check": "injection", "passed": false, "note": "instruction_override" }]
  }
}
```

`reason` is one of: `empty_input`, `too_short`, `too_long`, `unintelligible`,
`prompt_injection`, `not_stem`.

---

## 8. Guardrails in detail

Three gates, cheapest first, all local — no network call is made to decide
whether to make a network call.

1. **Shape** — length (8–4000), emptiness, control characters, single-character
   repetition, vowelless keyboard mashing. Pure notation (`∫ x² dx = ?`) passes:
   it has almost no letters but is a real question.
2. **Injection** — instruction override, prompt exfiltration, persona hijack,
   safety-bypass, chat-template delimiter injection (`<|im_start|>`, `[INST]`),
   and long encoded blobs. Input is Unicode NFKC-normalised first, so fullwidth
   confusables (`ｉgnore　previous`) cannot slip past.
3. **STEM relevance** — a lexicon + notation score, plus a high-precision
   off-topic matcher (poems, recipes, stock tips, medical advice).

**Deliberate asymmetry, so you can predict the failure modes:** the injection
gate is strict — a false positive costs one confused user, a false negative
costs prompt integrity for everyone. The STEM gate is **lenient by default** —
it is a cost filter, not curriculum police, and refusing a paying customer's
legitimate learner is worse than one wasted call. Set `strict_stem: true` to
trade recall for cost.

Guardrails are heuristic. They are a cost-control and hygiene layer, **not** a
security boundary: the prompts also instruct the model to treat user text as
data, and that defence-in-depth is what actually holds. Do not rely on the
guardrail alone if you are passing untrusted text into other systems.

---

## 9. Reliability

| Behaviour | Default | Env var |
|---|---|---|
| Attempts (first call + retries) | 3 | `LYCEUM_MAX_ATTEMPTS` |
| Backoff base / ceiling | 0.75s / 8s, full jitter | `LYCEUM_RETRY_BASE_S`, `LYCEUM_RETRY_MAX_S` |
| `Retry-After` cap | 10s | `LYCEUM_MAX_RETRY_AFTER_S` |
| Connect / read timeout | 5s / 90s | `LYCEUM_CONNECT_TIMEOUT_S`, `LYCEUM_READ_TIMEOUT_S` |
| Temperature | 0.25 | `LYCEUM_TEMPERATURE` |
| Max output tokens | 4096 | `LYCEUM_MAX_OUTPUT_TOKENS` |
| Schema repair pass | on | `LYCEUM_REPAIR_PASS=0` to disable |
| CORS allowlist | closed | `LYCEUM_CORS_ORIGINS` (comma-separated) |

- **Retried:** 408, 409, 425, 429, 5xx, connection errors, timeouts.
- **Never retried:** 400, 401, 403 — your key or payload is wrong, and
  hammering the provider only burns your quota.
- **Full jitter** on backoff, so a fleet of your instances does not retry in
  lockstep.
- **Repair pass:** if a response fails schema validation, the harness sends the
  broken document back with the validation errors and asks for a corrected
  document — preserving content, fixing structure. One extra call, and it turns
  most would-be 502s into a success. `meta.attempts` tells you when it fired.

Cost control worth knowing: `/healthz` never calls a provider (a health check
that spends your tokens is a bug), and `/v1/validate` is free.

---

## 10. Deployment notes

- **Stateless.** No database, no cache, no session. Scale horizontally; run it
  in a Lambda if you like.
- **Shared connection pool** on startup via lifespan. If you `mount()` the app
  inside a parent FastAPI app, Starlette does not run the sub-app's lifespan —
  the harness detects this and opens a per-request pool instead of failing, so
  mounting works, just slightly less efficiently.
- **Logs** contain `request_id`, provider, model, latency and outcome. They do
  **not** contain your key or the learner's full input.
- Set `LYCEUM_LOG_LEVEL=WARNING` in production if guardrail rejections are
  noisy; they log at INFO because they are normal traffic, not incidents.

---

## 11. Local development

```bash
pip install -e ".[api,dev]"
pytest -q            # 35 tests, no network, no API key needed
uvicorn lyceum_harness.main:app --reload
```

The test suite mocks the provider with `respx`, so CI needs no credentials. It
covers the guardrails (both profiles), both schema transformers, JSON extraction
from dirty responses, 429-then-success retry, rate-limit exhaustion, the repair
pass, the auditor's right-answer/wrong-reasoning and
alternative-method-accepted cases, and the podcast script's TTS-safety
guarantee.

A sales/marketing page for the harness lives at `site/index.html` — static,
self-contained, no build step.

### Module layout

```
lyceum_harness/
├── guardrails.py    Input validation. Local, deterministic, pre-billing
├── prompts.py       Prompt templates — the pedagogy
├── schemas.py       Pydantic models = the JSON contract
├── llm_client.py    Provider calls, retry/backoff, JSON parse + repair
├── engines.py       FeynmanEngine, ReverseBuildingEngine
├── config.py        Timeouts, retry policy, model defaults. No secrets
├── errors.py        Typed exception hierarchy with stable codes
└── main.py          FastAPI reference server
```

Each layer is independently usable: import `guardrails` alone to pre-filter in
your own pipeline, or `LLMClient` alone to get strict-JSON calls against your
own schemas.

---

## 12. Limits and honest caveats

- **Not a fact-checker.** The prompts forbid fabricated citations and constants,
  and demand mechanism over name-dropping, but an LLM can still be confidently
  wrong. For high-stakes assessment content, keep a human in the loop.
- **Guardrails are heuristic**, not a security boundary (see §8).
- **The auditor is not an examiner.** It is built so a right answer with broken
  reasoning cannot pass, but it is still an LLM and can be wrong. For
  high-stakes assessment, keep a human in the loop.
- **Only Gemini and OpenAI** are wired. Anthropic/Azure/Bedrock are a
  `_build_request` branch away — ask us.
- **`strict: false`** is used on OpenAI's `json_schema` on purpose: our schema
  contains an open-ended map (`jargon_translated`) that strict mode forbids
  outright, and a hard 400 is worse than a soft constraint. Output is still
  validated by Pydantic before it reaches you, so the contract holds either way.
- **No streaming.** These are structured single-shot documents; partial JSON is
  not useful to a renderer. Ask if you need SSE for perceived latency.
- **No built-in rate limiting or tenant metering.** You hold the key, so you
  hold the quota. Put your own limiter in front if you resell this.

---

© The Lyceum. Proprietary. Contact for commercial licensing and SLA terms.
