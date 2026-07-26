# Break-time reels

One 13.5-second vertical (720×1280) short per subject, played during the
5–10 minute break in `StudyCycleTimer`. Each reel says exactly one thing:

| file | subject | idea |
|---|---|---|
| `math.mp4` | Toán | the chain rule as layers you peel |
| `chemistry.mp4` | Hoá | an orbital is a probability cloud, not an orbit |
| `biology.mp4` | Sinh | the action potential is all-or-nothing |
| `physics.mp4` | Lý | SHM is circular motion seen edge-on |

Output lands in `the-lyceum-academy/public/reels/` as `<id>.mp4` plus an
`<id>-poster.jpg` hook frame. They are static assets — no API key, no quota,
no generation latency when a break starts.

## Rendering

```sh
NODE_PATH=/opt/node22/lib/node_modules node tools/reels/render.mjs            # all four
NODE_PATH=/opt/node22/lib/node_modules node tools/reels/render.mjs physics    # just one
NODE_PATH=/opt/node22/lib/node_modules node tools/reels/render.mjs --webm     # + VP9 copies
```

`scene.html` draws every frame from `window.renderAt(t)`, a pure function of
time — no CSS animation, no `requestAnimationFrame`, and the only randomness
comes from a seeded PRNG evaluated once at load. `render.mjs` steps the clock,
pulls each frame out as a JPEG and pipes the sequence into ffmpeg, so a
re-render of unchanged input produces the same video.

To change the words, edit `scenes.json`. To change a diagram, edit the matching
`diag*` function in `scene.html`.

### What it needs

- **Chromium** — override with `CHROMIUM=/path/to/chrome`. Default is
  `/opt/pw-browsers/chromium`.
- **Playwright**, resolved via `createRequire` so a globally installed copy on
  `NODE_PATH` works (bare `import` ignores `NODE_PATH`).
- **ffmpeg with libx264** — override with `FFMPEG=/path/to/ffmpeg`. It
  auto-detects the static build that ships with `pip install imageio-ffmpeg`.
  The ffmpeg Playwright bundles is compiled webm-only and cannot write H.264.
- **Fonts**: Instrument Serif (vendored in `fonts/`, SIL Open Font License) for
  the brand mark; DejaVu Sans / Liberation Sans and Noto Color Emoji from the
  system for everything else. Note that DejaVu Sans **Mono** has no precomposed
  Vietnamese glyphs, so it is used only for pure-maths labels — Vietnamese text
  must stay in the proportional sans.

### Verifying output

A Chromium built without proprietary codecs cannot decode H.264, so
`<video src="…mp4">` fails with `MEDIA_ERR_SRC_NOT_SUPPORTED` there even though
the file is fine. Either decode a frame back with ffmpeg, or render with
`--webm` and check the VP9 copy in the browser. The `--webm` files are for
verification only and are not committed — on this grainy source VP9 comes out
roughly five times larger than the H.264 equivalent.

## On generators

These are rendered, not model-generated. Seedance is not reachable from this
environment: it is not on Cloudflare Workers AI (which has no text-to-video
model at all), and no `generate_video` tool is exposed here.

### Veo — wired, but blocked on billing

A Google AI Studio key (`VEO_API_KEY` in `backend/.env`) reaches Veo directly:

```
curl -X POST "https://generativelanguage.googleapis.com/v1beta/models/veo-3.1-fast-generate-preview:predictLongRunning?key=$VEO_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"instances":[{"prompt":"..."}],"parameters":{"aspectRatio":"9:16","durationSeconds":8,"sampleCount":1}}'
```

Confirmed empirically against the live API:
- `durationSeconds` must be 4-8 inclusive — Veo cannot produce a single
  12-15s clip. A reel that length needs two generations concatenated, or one
  clip ping-ponged (played forward then reversed) to double its length.
- `aspectRatio: "9:16"` is accepted.
- **this key has no billing account attached** — every call returns
  `429 RESOURCE_EXHAUSTED` with `limit: 0` for the free tier. This is a hard
  wall, not a transient rate limit: Veo is paid-tier-only, and nothing
  generates until billing is enabled on the Google Cloud project behind the
  key. Confirmed the key itself is otherwise valid (`GET /v1beta/models`
  lists it fine; even plain `gemini-2.0-flash:generateContent` hits the same
  429, so this isn't Veo-specific — the project has no billing at all yet).

`app/services/veo.py` (backend) and `tools/reels/veo_backgrounds.py`
(standalone script, no FastAPI dependency) both implement the
submit → poll → download flow and are ready to run as soon as billing is
turned on:

```sh
python3 tools/reels/veo_backgrounds.py            # all four subjects
python3 tools/reels/veo_backgrounds.py math        # just one
```

Each subject gets one cinematic, caption-free prompt (`PROMPTS` in that
script) — explicitly asked to render no on-screen text, because video models
render embedded text and equations unreliably (worse for Vietnamese
diacritics). That's also why the plan is to use Veo output as a *background*
layer and keep drawing the accurate captions/diagrams in `scene.html` on top,
not to hand the model the whole reel. Output lands in `tools/reels/veo/`;
compositing that under the existing overlay is the next step once real
footage exists to test against — not built blind against a wall that returns
429 for everything.

If a Seedance endpoint and key become available instead — BytePlus/Volcengine
Ark, fal.ai and Replicate all host it — the same pattern applies: a generated
reel can replace any file in `public/reels/` without touching the player,
since the catalogue in `src/lib/breakReels.ts` only points at paths.
