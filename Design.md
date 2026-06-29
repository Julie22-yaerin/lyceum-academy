# Lyceum — Design System & Product Document

> **Lyceum** is an AI-powered Socratic learning platform.
> Single-file frontend (`web/index.html`) · FastAPI backend on port 8000
> AI provider chain: **Groq → Gemini (Google AI Studio) → OpenRouter → Ollama Cloud**

---

## 1. Visual Identity & Philosophy

### Brand Name
**Lyceum** — the school where Aristotle taught. The name carries the weight of structured philosophical inquiry, mentorship, and the pursuit of knowledge through dialogue.

### Design Direction
The visual language is a **dark, focused digital academy** — a scholar's workspace at midnight. Every decision serves one goal: keep the student in a state of deep cognitive engagement.

The design avoids the distractions of light-themed UIs. Deep navy darkness creates focus. Emerald green signals growth, insight, and correctness. Color is used semantically: blue = concepts, indigo = sub-topics, amber = prerequisites and caution, red = errors and difficulty.

> *"The unexamined life is not worth living."* — Socrates

### Stitch Design Reference (`stitch_markdown_design_system/`)
The project explored two design directions via Stitch AI mockups:

| Direction | Style | Status |
|-----------|-------|--------|
| **Socratic Archetype** | Warm parchment, EB Garamond serif, terracotta primary, Hermes bust motif, light-mode, classical Hellenistic | Reference only — defines the philosophical brand soul |
| **Lyceum Dark** (current) | Deep navy `#050816`, emerald `#34d399`, Inter sans-serif, modern educator UI | **Implemented** |

The Socratic Archetype (`socratic_archetype/DESIGN.md`) informs the *brand personality* — scholarly, warm, structured — while the dark implementation makes the actual tool ergonomically suited to long study sessions.

---

## 2. Color Palette

### CSS Variables (`:root`)

| Variable   | Value                  | Meaning                                                      |
|------------|------------------------|--------------------------------------------------------------|
| `--bg`     | `#050816`              | Page canvas — very dark navy, near-black for maximum focus   |
| `--surface`| `#0f172a`              | Cards, panels, message bubbles — slightly elevated           |
| `--s2`     | `#1e293b`              | Input fields, secondary surfaces — visibly distinct from surface |
| `--border` | `rgba(255,255,255,.1)` | All borders — subtle, non-distracting outlines               |
| `--t`      | `#ffffff`              | Primary text — pure white for maximum legibility             |
| `--t2`     | `#94a3b8`              | Secondary text — descriptions, helper content                |
| `--t3`     | `#64748b`              | Muted text — labels, placeholders, metadata                  |
| `--em`     | `#34d399`              | Emerald — primary accent, logo, active states, CTAs          |
| `--em2`    | `#10b981`              | Darker emerald — focus rings, hover states                   |
| `--blue`   | `#60a5fa`              | Concept nodes — foundational knowledge                       |
| `--indigo` | `#818cf8`              | Subtopic nodes, concept chips — deeper nested ideas          |
| `--amber`  | `#fbbf24`              | Prerequisite nodes, Medium difficulty — caution and dependency |
| `--green`  | `#86efac`              | Application nodes — real-world connections                   |

### Semantic Color Logic

| Color         | Hex         | Used for                                                     |
|---------------|-------------|--------------------------------------------------------------|
| Emerald       | `#34d399`   | ✅ Correct, primary CTA, active tab, logo, AI brand color    |
| Blue          | `#60a5fa`   | 📘 Foundational concepts in the knowledge graph              |
| Indigo        | `#818cf8`   | 🔷 Sub-topics, concept chips on question cards               |
| Amber         | `#fbbf24`   | ⚠️ Prerequisites (things to know first), Medium difficulty   |
| Red `#f87171` | `#f87171`   | ❌ Errors, incorrect answers, Hard difficulty                 |
| White         | `#ffffff`   | Primary content, titles, student input                       |
| `#94a3b8`     | —           | Supporting text — helpful but not competing for attention    |
| `#64748b`     | —           | Metadata, timestamps, muted labels                          |

### Knowledge Graph Node Colors

| Node Type     | Fill        | Stroke      | Label text  | Meaning                         |
|---------------|-------------|-------------|-------------|---------------------------------|
| `root`        | `#0a2e22`   | `#34d399`   | `#a7f3d0`   | The central topic being explored|
| `concept`     | `#0f1f3a`   | `#60a5fa`   | `#bfdbfe`   | Core concepts                   |
| `subtopic`    | `#1a1a2e`   | `#818cf8`   | `#c7d2fe`   | Deeper sub-divisions            |
| `application` | `#1f2a14`   | `#86efac`   | `#bbf7d0`   | Real-world uses and examples    |
| `prerequisite`| `#2a1f0a`   | `#fbbf24`   | `#fde68a`   | Prior knowledge required        |

### Tool Map Column Colors

| Column   | Card style                                   | Semantic meaning              |
|----------|----------------------------------------------|-------------------------------|
| Inputs   | Green border `#34d399`, dark green fill      | What you're given / starting point |
| Tools    | Blue dashed border `#60a5fa`, grid-patterned | The method, rule, or algorithm applied |
| Outputs  | Red border `#f87171`, dark red fill          | The result produced           |

---

## 3. Typography

### Typefaces

| Font            | Role                         | Source       |
|-----------------|------------------------------|--------------|
| **Inter**       | All UI, body, buttons, labels | Google Fonts |
| **JetBrains Mono** | Code blocks, equations    | Google Fonts |
| **KaTeX**       | LaTeX math (`$...$`, `$$...$$`) | CDN        |

*Note: The Stitch Socratic Archetype spec calls for **EB Garamond** for display headings. This is preserved as a future option for landing pages or marketing surfaces where classical weight is desired.*

### Type Scale

| Element              | Font         | Weight | Size   | Notes                              |
|----------------------|--------------|--------|--------|------------------------------------|
| Logo (LYCEUM)        | Inter        | 800    | 17px (header), 26px (auth) | `letter-spacing:.12em`, uppercase |
| Auth H1              | Inter        | 700    | 24px   | "Welcome back"                     |
| Section heading      | Inter        | 700    | 20px   | Screen titles (e.g. "📝 Problem Set Analyzer") |
| Card title           | Inter        | 600    | 15px   | Question titles                    |
| Body / chat          | Inter        | 400    | 14px   | Message content, descriptions      |
| Small body           | Inter        | 400    | 13px   | Inputs, textareas, summaries       |
| Caps labels          | Inter        | 700    | 9–11px | `text-transform:uppercase; letter-spacing:.1em` — like stone inscriptions |
| Code                 | JetBrains Mono | 400–500 | 12–13px | Code blocks, equations in node panel |

---

## 4. Spacing & Layout

### Base Grid
- Spacing unit: **8px**
- Content max-width: **820px** (problems), **700px** (chat messages), **860px** (focus overlay body)
- Border radius scale: `6px` chips → `10px` tabs → `12px` inputs → `14px` buttons → `16px` messages → `18px` cards → `20px` chat input → `24px` auth card → `50%` send button

### Global Layout

```
┌────────────────────────────────────────────────────────┐
│  HEADER  (56px, fixed, glass blur)                     │
│  [LYCEUM]    [💬 Chat] [🌐 Graph] [📝 Problems]    [👤]│
├────────────────────────────────────────────────────────┤
│                                                        │
│  ACTIVE VIEW  (flex:1, fills remaining height)         │
│  ┌─ v-chat   ─ Chat interface                         │
│  ├─ v-graph  ─ D3 Knowledge Graph + Node Panel        │
│  └─ v-docs   ─ Problem Set Analyzer + Cards           │
│                                                        │
├────────────────────────────────────────────────────────┤
│  🧠 MIND MAP HANDLE  (bottom center, fixed)            │
│  ┌──────────────────────────────────────────────────┐  │
│  │  MIND MAP DRAWER  (45vh, slides up)              │  │
│  │  [🔧 Tool Map] [🧠 Free Map]  ← internal tabs    │  │
│  └──────────────────────────────────────────────────┘  │
└────────────────────────────────────────────────────────┘

Global overlays:
  • #prob-focus     — full-screen card focus overlay (z-index 600)
  • #tm-toast       — bottom-right feedback toast (z-index 9999)
  • #hl-bar         — floating highlighter toolbar (z-index 2000)
  • .fig-modal      — figure zoom modal (z-index 9000)
```

---

## 5. Components

### 5.1 Header

```css
header {
  height: 56px;
  background: rgba(5,8,22,.95);
  backdrop-filter: blur(16px);
  border-bottom: 1px solid rgba(255,255,255,.1);
}
```

- **Logo**: `.h-logo` — `LYCEUM`, 17px, weight 800, `#34d399`, uppercase
- **Nav**: 3 tab buttons, `justify-content:center` (centered in header)
- **User pill**: `.upill` — avatar initial circle + username + Sign out

### 5.2 Nav Tabs

```css
.nb { padding:6px 14px; border-radius:10px; color:#64748b; }
.nb:hover { color:#fff; background:rgba(255,255,255,.06); }
.nb.on { color:#000; background:#34d399; }  /* filled green pill — active */
```

Active tab = **filled emerald green with black text**. This is the key visual signal that anchors the user's location.

### 5.3 Buttons

| Class         | Background       | Color | Border-radius | Use                       |
|---------------|------------------|-------|---------------|---------------------------|
| `.btn-p`      | `#34d399`        | `#000`| 14px          | Primary CTA               |
| `.btn-o`      | transparent      | `#fff`| 14px          | Secondary / outline       |
| `.sbtn`       | `#34d399`        | `#000`| **50%** (circular) | Send message in chat |
| `.qbtn-check` | `rgba(52,211,153,.1)` | `#34d399` | 10px | Inline check answer  |
| `.pf-back`    | transparent      | `#34d399` | 8px      | Back/nav in focus overlay |
| `.wb-tool`    | `var(--surface)` | `#94a3b8` | 8px     | Whiteboard toolbar tool   |
| `.wb-tool.on` | `#34d399`        | `#000`| 8px           | Active whiteboard tool    |

### 5.4 Cards

**Question Card** `.q-card`:
```css
background: #0f172a;
border: 1px solid rgba(255,255,255,.1);
border-radius: 18px;
padding: 20px 22px;
transition: border-color .15s;
```
Hover: `border-color: rgba(52,211,153,.3)` — subtle emerald glow, inviting interaction.

**Auth Card** `.card`:
```css
background: #0f172a;
border: 1px solid rgba(255,255,255,.12);
border-radius: 24px;
padding: 44px 40px;
width: 400px;
```

**Node Detail Panel** `.npanel`:
```css
position: absolute; right: 0; top: 0; bottom: 0; width: 340px;
background: rgba(12,18,36,.97);
backdrop-filter: blur(16px);
border-left: 1px solid rgba(255,255,255,.1);
transform: translateX(105%);  /* hidden state */
transition: transform .25s ease;
```
Slides in from the right on node click.

### 5.5 Inputs & Textareas

```css
background: #1e293b;           /* --s2: clearly distinct from surface */
border: 1px solid rgba(255,255,255,.1);
border-radius: 12px;
color: #ffffff;
font-size: 14px;
padding: 10px 14px;
```
Focus: `border-color: #10b981` (--em2)

Special cases:
- **Chat input** `.cin`: `border-radius:20px`, auto-resizes to 140px max, `background:#1e293b`
- **Problem set textarea** `.pset-input`: `min-height:150px`, `resize:vertical`
- **Focus overlay answer**: `min-height:130px`, `resize:vertical`
- **Tool Map context input**: inline style with same `#1e293b` bg

### 5.6 Difficulty Badges

```css
.q-diff { font-size:9px; font-weight:700; text-transform:uppercase;
           letter-spacing:.1em; padding:3px 8px; border-radius:6px; }
```

| Level    | Color token | Hex       | Meaning                              |
|----------|-------------|-----------|--------------------------------------|
| Easy     | Emerald     | `#34d399` | Routine, foundational                |
| Medium   | Amber       | `#fbbf24` | Requires careful multi-step thinking |
| Hard     | Red         | `#f87171` | Non-trivial, multi-concept           |
| Extreme  | Deep red    | `#ef4444` | Competition-level                    |

### 5.7 Concept Chips

```css
.q-concept {
  font-size: 10px;
  background: rgba(129,140,248,.1);
  color: #818cf8;
  border: 1px solid rgba(129,140,248,.2);
  padding: 2px 8px;
  border-radius: 6px;
}
```
Indigo chips — visually secondary to the card title, but quickly scannable to identify the subject domain.

### 5.8 Floating Toast (Tool Map Feedback)

```
Position: fixed, bottom-right, z-index:9999
Max-width: 400px
Border-radius: 18px
Animation: slide-up + fade with spring curve
```

**Three states:**
| State    | Background  | Icon | Color    |
|----------|-------------|------|----------|
| Loading  | `#0f172a`   | ⏳   | muted    |
| Correct  | `#061a10`   | ✅   | `#34d399`|
| Partial  | `#1a1200`   | ⚠️   | `#fbbf24`|
| Incorrect| `#1a0606`   | ❌   | `#f87171`|

Auto-dismisses after 8 seconds with an animated progress bar. Expandable "Details" section.

### 5.9 Highlighter Toolbar

```
Position: fixed, floating above text selection, z-index:2000
Shape: pill — backdrop-blur, dark surface, border
```

5 swatches (spec-exact colors):
| Color  | Hex       |
|--------|-----------|
| Yellow | `#fef08a` |
| Green  | `#86efac` |
| Blue   | `#93c5fd` |
| Pink   | `#f9a8d4` |
| Orange | `#fdba74` |

Plus "✕ Erase" to remove highlights. Appears only when text is selected inside `.q-prompt`.

### 5.10 Whiteboard Canvas

```css
#wb-canvas {
  background: #ffffff;       /* white drawing surface */
  border-radius: 12px;
  cursor: crosshair;
  touch-action: none;        /* prevents scroll interference on touch */
}
```

Renders at `clientWidth × 38vh`. Supports:
- **Pen tool** — smooth lines via `lineTo` / `stroke`
- **Eraser** — same path but `strokeStyle:#fff`
- 6 color swatches: `#111827` (dark) + red, blue, green, amber, purple
- Size slider (1–20px)
- Clear (fills canvas with `#ffffff`)

---

## 6. Screens

### 6.1 Auth Screen (`#auth`)

**Content:**
- Large **LYCEUM** logo (26px, `#34d399`, uppercase)
- Tagline: "Welcome back" + "Sign in to your learning space"
- Google SSO button (white bg, Google SVG, rounded 14px)
- "or" divider with horizontal lines
- Email + Password inputs (`background:#1e293b`)
- **Sign in** (green primary button)
- "Don't have an account? Sign up" (soft link)
- "Dev access (no auth)" (muted text link — bypasses Firebase)

**Function:**
- Google: `signInGoogle()` → popup → fallback redirect
- Email: `signInEmail()` → tries sign-in → creates account if not found
- Dev: `devAccess()` → sets `token='pclick-admin-dev'`, `sbUserId='dev'`

**Meaning:** The gateway emphasizes simplicity. The muted "Dev access" option signals this is a tool built by developers, for real use, not just a demo.

### 6.2 Chat Screen (`#v-chat`)

**Content:**
- Topbar: `"Lyceum AI · Socratic tutor · English"` (left) + `"✕ Clear chat"` (right)
- Scrollable message area (`.msgs`)
- Welcome message: 🦉 + "Hey! I'm **Lyceum AI** — your Socratic learning companion…"
- Glass-effect bottom input bar

**Message anatomy:**
```
AI message:  [🦉 dark-green circle] [bubble: surface bg, left-rounded corners]
                                     [model badge: muted, right-aligned]
User message:               [bubble: emerald-tinted, right-rounded corners] [👤]
```

**Function — `sendChat()`:**
1. Adds user message to DOM and `hist[]`
2. Persists to Supabase (`pclick_messages`)
3. Sends to `/ai/chat` with system prompt + full history
4. Renders reply through `renderMd()` (markdown) + `renderMath()` (KaTeX)
5. Displays model name badge below AI bubble

**System prompt behavior:** AI responds in English regardless of input language. Uses Socratic method — guiding questions, not direct answers. Math in `$...$` / `$$...$$`, code in backticks.

**Meaning:** The owl 🦉 is the avatar for Lyceum AI — the owl of Athena, symbol of wisdom. The dark green circle (`#0a2e1e`) grounds it in the Lyceum brand.

### 6.3 Graph Screen (`#v-graph`)

**Content:**
- Full-width topic input + "Generate Map" button
- Empty state: 🌐 globe, subtitle, 6 clickable example chips
- D3 force-directed graph (fills container)
- Node detail panel (340px, slides from right)

**Empty state chips:** Integral Calculus · Machine Learning · Quantum Mechanics · Linear Algebra · Number Theory · Thermodynamics

**Function — `genGraph()`:**
1. POST `/ai/topic-map` → Gemini returns `{nodes, edges}` JSON
2. `renderGraph(data)` → D3 simulation:
   - `forceManyBody(-550)` repulsion
   - `forceLink(180px)` attraction
   - `forceCollide(90)` no overlap
   - Zoom/pan + drag on nodes
3. Click node → `showP(node, data)` → slides in `.npanel`
4. `loadNodeSummary()` → parallel `asyncio.gather()`:
   - POST `/ai/node-summary` (Gemini: 4–5 sentence definition + equations + example + key insight)
   - Wikipedia REST API: `https://en.wikipedia.org/api/rest_v1/page/summary/{label}` → thumbnail image

**Node panel sections:** Wikipedia image → formula display → Definition → Key Equations → Example → 💡 Key Insight → Connected to

**Meaning:** The graph externalizes the mind. Students who see the topology of a topic understand *how ideas connect*, not just *what they are*. Each node click triggers an async rich summary — making the graph feel alive, not static.

### 6.4 Problems Screen (`#v-docs`)

**Content:**
- Title: "📝 Problem Set Analyzer" (20px, bold)
- Subtitle: "Paste text or upload a PDF / PNG…"
- Drag-and-drop upload zone (dashed border, `📎` icon)
- "or paste text" divider
- Large textarea (with multi-line placeholder example)
- Buttons: "🔍 Analyze text" (green) · "✕ Clear" (outline)
- Token usage pill (bottom right, appears after first AI call)
- Results area: Figures panel (if any) + summary banner + question cards

**Two input paths:**

| Path | Endpoint | AI Used | Process |
|------|----------|---------|---------|
| File upload | `/ai/upload-pset` | Gemini vision (images) / PyMuPDF (PDFs) | OCR → JSON decompose → image crops |
| Text paste | `/ai/decompose` | Groq → chain | Text → structured JSON |

**Question card anatomy:**
```
┌─────────────────────────────────────────────────────────┐
│  #1  Question Title                          [Medium] [↗ Open]  │
│  [Calculus] [Integration]                              │
│  ┌───────────────────────────────────────────┐         │
│  │ image crop (if from PDF upload)           │         │
│  │ OR rendered question text with KaTeX      │         │
│  └───────────────────────────────────────────┘         │
│  YOUR ANSWER                                            │
│  [textarea]                                             │
│  [✓ Check answer]                                       │
│  [feedback result here]                                 │
└─────────────────────────────────────────────────────────┘
```

**Persistence:** Problem set saved to `localStorage` key `lyceum_last_pset` (without image crops). Restored when the Problems tab is re-opened.

**Meaning:** Students shouldn't need to re-upload their homework every session. The problem set becomes the student's workspace for the day.

### 6.5 Mind Map Drawer (`#mm-drawer`)

A persistent 45vh drawer fixed at the bottom, accessible from any view. Triggered by the `🧠 Mind Map` handle.

**Handle animation:** Smooth `cubic-bezier(.4,0,.2,1)` slide-up. Handle changes to emerald tint when open. Arrow rotates 180°.

#### Tab 1 — 🔧 Tool Map (default)

**Purpose:** Students explicitly map their *problem-solving process* — not just the answer, but the method.

**Three columns (left to right):**

| Column | Header | Card style | Content |
|--------|--------|-----------|---------|
| Inputs | `↓ INPUTS` | Green border | Given values, functions, data |
| Tools/Steps | `⚙ TOOLS / STEPS` | Blue dashed, grid texture | Rules, algorithms, methods |
| Outputs | `OUTPUTS ↓` | Red border | Results produced |

**Bezier curves** (`tmDrawCurves()`): SVG `<path>` curves overlay — green curves from inputs → tools, red curves from tools → outputs. Redrawn on card add/remove via `MutationObserver` and on resize via `ResizeObserver`.

**Cards** are `contenteditable` divs with placeholder behavior (text dimmed until focused).

**"🔍 Analyze with Gemini"** → POST `/ai/tool-map/validate`:
- Returns: `{verdict, feedback, correct[], issues[], missing[], suggestions[]}`
- Shows in **floating toast** (bottom-right, 8s auto-dismiss)

**Meaning:** The Tool Map forces students to articulate *why* they're doing each step, not just *what*. Gemini acts as a reviewer who checks if the INPUT→TOOL→OUTPUT chain is logically valid.

#### Tab 2 — 🧠 Free Map

**Purpose:** Open-ended concept mapping. No structure imposed.

SVG canvas with panning. Nodes are rounded rectangles with text. Edges are cubic bezier paths with arrow markers.

**Node interactions:**

| Action | Trigger | Effect |
|--------|---------|--------|
| Create node | Double-click canvas | New node at cursor, rename mode opens |
| Select | Single click | Node highlighted, selection border |
| Move | Drag | Node repositions freely |
| Rename | Double-click node | Inline `<input>` via SVG `<foreignObject>` |
| Delete | Delete key | Removes node + all connected edges |
| Connect | 🔗 Connect button → click A → click B | Directed edge drawn |
| Add child | ↳ Child button | New node auto-connected to selected |

**7 node colors:** `#34d399` · `#60a5fa` · `#818cf8` · `#fbbf24` · `#f87171` · `#86efac` · `#fb923c`

**Persistence:** Saves to `localStorage` key `lyceum_mindmap` after every mutation.

---

## 7. Problem Focus Overlay

Full-screen takeover that slides up from the bottom with a spring animation:

```css
.prob-focus {
  position: fixed; inset: 0; z-index: 600;
  background: #050816;
  transform: translateY(100%) scale(.98); opacity: 0;  /* hidden */
  transition: transform .28s cubic-bezier(.4,0,.2,1), opacity .28s ease;
}
.prob-focus.on { transform: translateY(0) scale(1); opacity: 1; }
```

### Header bar
`← Back` | `Problem X / N` | `‹ Prev` | `Next ›` | `✓ Check`

### Body (max-width 860px, centered)
1. Problem title + difficulty badge
2. Concept chips
3. Question prompt — large (15px), KaTeX-rendered, green left-border, `--surface` bg
4. **YOUR ANSWER** label
5. Mode tabs: `[✏ Text]` `[🖊 Whiteboard]`

### Text Mode
- Large `textarea` (130px min) with `#1e293b` bg
- **Math keyboard** — 12×8 grid, 96 Unicode symbols:
  - Row 1–2: Greek lowercase (α β γ δ ε ... ω Ω)
  - Row 3: Greek uppercase + misc (Γ Δ Θ ... ∂ ∅)
  - Row 4: Operators (× ÷ ± ∓ ≈ ≠ ≤ ≥ ≡ ∝ ∴ √)
  - Row 5: Powers (² ³ ⁰ ¹ ⁻¹ ... ⁿ)
  - Row 6: Calculus + arrows (∫ ∬ ∮ ∇ → ⇒ ... ∑ ∏)
  - Row 7: Sets + logic (∈ ∉ ⊂ ⊃ ∪ ∩ ∀ ∃ ¬ ∧ ∨ ⊕)
  - Row 8: Number sets + geometry (ℝ ℤ ℕ ℚ ℂ ° ′ ″ ⊥ ∥ ∠ △)
  - Click = inserts symbol at cursor position

### Whiteboard Mode
- HTML5 Canvas, white bg, `38vh` height
- Pen/Eraser toggle, 6 color swatches, size slider (1–20)
- Canvas fills parent width dynamically

### Check flow
- **Text mode**: POST `/ai/mastery` with textarea content
- **Whiteboard mode**: POST `/ai/describe-drawing` (Gemini vision transcribes canvas image to text) → POST `/ai/mastery`
- Result: green banner (✅ Correct) or red banner (❌ Not quite) with Gemini feedback + mastery delta
- Answer syncs back to inline card on close

**Prev / Next navigation** rebuilds the entire overlay in-place — no re-render flash.

---

## 8. AI Functions & API Endpoints

| Endpoint | Method | Input | Output | AI Provider |
|----------|--------|-------|--------|-------------|
| `/ai/chat` | POST | `{messages, model, temperature, max_tokens}` | `{text, model, usage}` | Groq → chain |
| `/ai/topic-map` | POST | `{topic}` | `{nodes[], edges[]}` | Gemini first, fallback chain |
| `/ai/node-summary` | POST | `{label, node_type, description, connections[]}` | `{definition, equations[], example, key_insight, formula_display, image_url}` | Gemini + Wikipedia (parallel) |
| `/ai/decompose` | POST | `{pset_text}` | `{summary, problems[], source_file}` | Groq → chain |
| `/ai/upload-pset` | POST | `multipart/form-data file` | `{summary, problems[], figures[], source_file}` | Gemini vision / PyMuPDF |
| `/ai/mastery` | POST | `{problem, solution}` | `{correct, mastery_delta, feedback}` | Groq → chain |
| `/ai/hint` | POST | `{problem, level: 1-3}` | `{hint}` | Groq → chain |
| `/ai/tool-map/validate` | POST | `{inputs[], tools[], outputs[], context}` | `{verdict, feedback, correct[], issues[], missing[], suggestions[]}` | Gemini |
| `/ai/describe-drawing` | POST | `{image: base64_jpeg}` | `{text}` | Gemini vision |
| `/ai/usage` | GET | — | `{total, by_provider}` | — |

### AI Provider Chain
```
Groq (primary, free)
  └─ fail → Google AI Studio / Gemini (secondary, free 1M tokens/day)
       └─ fail → OpenRouter (paid, deepseek-r1, gemini-2.0-flash)
            └─ fail → Ollama Cloud (free, multi-key rotation)
```

### Token Usage Tracking
- Backend: `_session_usage` dict tracks prompt/completion per provider
- Frontend: `refreshUsage()` polls `/ai/usage` every 30s
- **Token pill** (Problems tab): `🔢 12.4k tokens · 8 req` — click for full breakdown
- `showUsageDetail()` → `alert()` with per-provider breakdown

---

## 9. Key Data Flows

### Chat
```
User types → sendChat()
  → [system prompt + history] → POST /ai/chat
  → renderMd(text)           — markdown: bold, italic, code, lists, headers
  → renderMath(div)          — KaTeX: $...$ and $$...$$
  → addMsg('ai', reply)      — appends bubble with model badge
  → sbSaveMsg()              — Supabase insert
```

### Knowledge Graph
```
User types topic → genGraph()
  → POST /ai/topic-map → {nodes, edges}
  → renderGraph(data) → D3 force sim + SVG
  → click node → showP()
      → $('np-ai') = spinner
      → loadNodeSummary()
          → asyncio.gather(
              _gemini_summary(label),         // 4-5 sentence definition
              _fetch_wiki_image(label)        // Wikipedia REST API thumbnail
            )
          → renderNodeSummary(data)          // image + formula + definition + equations + example + insight
```

### Problem Set Upload (Image)
```
User drops PNG → uploadPset(file)
  → FormData POST /ai/upload-pset
  → backend: Gemini vision → JSON {y_start%, y_end%} per question
  → _crop_question_image() → Pillow crops → base64 JPEG per question
  → renderPset(data)
      → Figures panel (if figures[])
      → question cards with <img class="q-crop">
      → renderMath(results)    — KaTeX pass
      → restoreHL()            — reload localStorage highlights
      → savePset(data)         — persist (strips image_crop)
```

### Tool Map Validation
```
Student fills cards → tmAnalyze()
  → showTmToast({loading:true})
  → POST /ai/tool-map/validate {inputs, tools, outputs, context}
  → Gemini reviews logical chain
  → tmRenderFeedback(data)
      → toast: verdict color + icon
      → detail body: ✓ correct, ✗ issues, ⚠ missing, 💡 suggestions
      → 8s auto-dismiss progress bar
```

---

## 10. Persistence

| Key | Storage | Content | Stripped fields |
|-----|---------|---------|-----------------|
| `lyceum_last_pset` | localStorage | `{summary, problems[], figures[]}` | `image_crop`, `figure.data` (base64) |
| `lyceum_highlights` | localStorage | `{"qcard-0": [{text, color},...], ...}` | — |
| `lyceum_mindmap` | localStorage | `{nodes[], edges[], nextId}` | — |
| `pclick_messages` | Supabase (Postgres) | `{user_id, role, content, created_at}` | — |

---

## 11. External Dependencies

| Library | Version | Use |
|---------|---------|-----|
| D3.js | 7.9.0 | Force-directed knowledge graph |
| Firebase Auth compat | 10.7.1 | Google SSO + email/password |
| Supabase JS | v2 | Chat history persistence |
| KaTeX | 0.16.11 | LaTeX math rendering |
| Google Fonts | — | Inter + JetBrains Mono |
| Wikipedia REST API | — | Free thumbnails for graph nodes (`/api/rest_v1/page/summary/{title}`) |

---

## 12. Backend Architecture

```
FastAPI (localhost:8000)
  ├── /ai/*          — AI endpoints (main.py)
  ├── /admin/*       — RAG + fine-tune admin (routers/admin.py)
  └── /health/*      — liveness probe

AI Layer (services/ai.py)
  ├── chat()                 — full provider chain
  ├── _google_call()         — Gemini-direct calls
  ├── topic_to_nodemap()     — Gemini first
  ├── node_summary()         — asyncio.gather(Gemini, Wikipedia)
  ├── decompose_pset()       — Groq → chain
  ├── analyze_file_pset()    — vision + PDF extraction
  ├── check_mastery()        — Groq → chain
  ├── validate_tool_map()    — Gemini
  └── describe_drawing()     — Gemini vision

Storage
  ├── Supabase (Postgres)    — chat messages
  ├── ChromaDB (local)       — RAG vector store
  ├── SQLite (local)         — fine-tune dataset
  └── localStorage (browser) — highlights, pset, mindmap
```

### JSON Repair Pipeline
AI-generated JSON is repaired via 4 sequential passes (`_repair_json()`):
1. Strip code fences (` ```json ` wrappers)
2. Fix bare backslashes (`\sqrt` → `\\sqrt` for LaTeX in JSON)
3. Remove trailing commas (`[1, 2,]` → `[1, 2]`)
4. Escape literal newlines in string values

---

## 13. File Structure

```
PCLICK CODE/
├── web/
│   └── index.html              ← Single-file frontend (~2200 lines)
│                                  HTML + CSS + JS (Firebase, Supabase, D3, KaTeX)
├── backend/
│   ├── .env                    ← API keys (Groq, Google, OpenRouter, Supabase, Firebase)
│   ├── requirements.txt
│   └── app/
│       ├── main.py             ← FastAPI app + all route handlers + endpoint schemas
│       ├── core/config.py      ← Pydantic settings from .env
│       ├── services/
│       │   ├── ai.py           ← All AI logic: chat, decompose, vision, graph, tool map
│       │   ├── auth.py         ← Firebase/Supabase JWT verification
│       │   ├── embeddings.py   ← sentence-transformers wrapper (all-MiniLM-L6-v2)
│       │   ├── rag.py          ← ChromaDB RAG pipeline
│       │   └── finetune_db.py  ← SQLite fine-tune dataset storage
│       ├── models/entities.py  ← SQLAlchemy models
│       ├── db/session.py       ← DB engine + session factory
│       └── routers/admin.py    ← Admin RAG/fine-tune endpoints
├── stitch_markdown_design_system/
│   ├── socratic_archetype/DESIGN.md    ← Reference: Socratic visual system spec
│   ├── pclick_socratic_dialogue_classic_style/screen.png
│   ├── pclick_academy_access_auth_page/screen.png
│   ├── pclick_knowledge_map_hermes_mind_map_classic_style/screen.png
│   ├── pclick_problem_set_analysis_insight_cards/screen.png
│   └── ... (6 more screen mockups)
├── Design.md                   ← This file — current design system documentation
└── start_*.command             ← Dev launcher shell scripts
```

---

## 14. Environment Variables (`.env`)

```env
# Google AI Studio (Gemini — primary for graph + node summary + tool map)
GOOGLE_API_KEY=...

# Groq (primary for chat + mastery + decompose)
GROQ_API_KEY=...

# OpenRouter (paid fallback)
OPENROUTER_API_KEY=...

# Ollama Cloud (free fallback, 3-key rotation)
OLLAMA_API_KEY=...
OLLAMA_API_KEY_2=...
OLLAMA_API_KEY_3=...
OLLAMA_CLOUD_URL=https://ollama.com/v1

# Supabase
SUPABASE_URL=https://xxx.supabase.co
SUPABASE_ANON_KEY=...
SUPABASE_SERVICE_ROLE_KEY=...
SUPABASE_JWT_SECRET=...

# Firebase
FIREBASE_PROJECT_ID=pclick-9f190

# App
APP_ENV=development
API_ALLOW_DEV_AUTH=false
```

---

*Document reflects the Lyceum frontend as implemented in `web/index.html` — Lyceum design system, June 2026.*
