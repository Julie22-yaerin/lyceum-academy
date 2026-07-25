"""
Xiaohei Illustrations — plain-white, hand-drawn, deadpan-absurd body
illustrations for article/note content.

Adapted from the "ian-xiaohei-illustrations" style guide (a Codex/Claude
Skill by github.com/helloianneo — MIT licensed, style docs only, no
executable code) into a real in-app feature: a Tool Dock tool any student
or Coach can point at an article, note, or single concept to get a short
shot list plus generated 16:9 illustrations.

Two deviations from the source skill, both deliberate:
  - Everything (shot-list fields, annotation words) is in ENGLISH, not
    Chinese — Lyceum's primary content language.
  - Actual pixel generation runs on the same local CPU tiny-diffusion
    pipeline Game Builder uses (app.services.image_gen) rather than a
    dedicated external image model — this deployment has no paid image API
    configured. Quality is a rough sketch approximation of the style, not
    a faithful reproduction; treat it as a placeholder renderer until a
    stronger image backend is wired in.

The recurring character keeps its original name, Xiaohei ("little black"):
a solid-black, absurd little creature with white dot eyes, thin legs, and
a blank, serious expression, always performing the core action of the
illustration rather than decorating it.
"""

from __future__ import annotations

import json
import logging
from typing import Any

log = logging.getLogger("pclick.illustration")

MAX_SHOTS = 9
DEFAULT_SHOTS = 5

_STRUCTURE_TYPES = [
    "workflow", "system-fragment", "before-after", "character-state",
    "concept-metaphor", "layered-method", "map-route", "mini-comic-strip",
]

_SHOT_LIST_SYSTEM = (
    "You are a visual-metaphor editor for the 'Xiaohei' illustration style: plain-white, "
    "hand-drawn, deadpan-absurd body illustrations that explain one cognitive point per image "
    "from an article, note, or concept.\n\n"
    "Style rules you plan against (do not restate these in your output, just honor them):\n"
    "- Pure white background, black hand-drawn line art, sparse red/orange/blue annotation words.\n"
    "- Only ONE core judgment, process, structure, state, or metaphor per image.\n"
    "- Xiaohei — a small solid-black creature, white dot eyes, thin legs, blank serious "
    "expression — must be the one PERFORMING the core action, never just decoration standing "
    "beside the diagram. If the metaphor still works with Xiaohei removed, it's too decorative.\n"
    "- Invent a fresh, low-tech physical metaphor for THIS content every time (a jammed machine, "
    "a funnel, a well, a broken conveyor, a mailbox, a scale, a ladder) — never reuse a stock "
    "diagram look, never a PPT/course-slide feel, never cute/childish/mascot-poster.\n\n"
    "Given the user's text, produce a JSON object only, no markdown fences:\n"
    '{"shots": [{"placement": "<where in the text this follows>", "topic": "<short title>", '
    '"core_idea": "<the one point this image explains>", "structure_type": "<one of: '
    + ", ".join(_STRUCTURE_TYPES) + '>", "xiaohei_action": "<what Xiaohei is physically doing>", '
    '"objects": ["<1-2 concrete low-tech objects/props>"], "annotations": ["<2-5 short English '
    'annotation words/phrases, each under 4 words>"]}]}\n\n'
    "Pick 4-8 shots by default (fewer for short input, never more than 9). Choose only the "
    "content's real cognitive turning points — do not illustrate evenly. All fields in English."
)


def _build_image_prompt(shot: dict[str, Any]) -> tuple[str, str]:
    """Compose the full Stable-Diffusion prompt + negative prompt for one shot."""
    objects = ", ".join(shot.get("objects") or []) or "a simple hand-drawn prop"
    annotations = ", ".join(shot.get("annotations") or [])
    prompt = (
        "16:9 horizontal minimalist hand-drawn explainer illustration, pure white background, "
        "black ink line art, slightly wobbly pen lines, lots of empty white space, clean absurd "
        "product-sketch feel. "
        "Recurring character Xiaohei: a small solid-black creature with white dot eyes, thin "
        "legs, blank deadpan serious expression, performing the core action — not decorative. "
        f"Xiaohei is {shot.get('xiaohei_action', 'engaged in the central action')}. "
        f"Scene objects: {objects}. "
        f"Core idea depicted: {shot.get('core_idea', shot.get('topic', ''))}. "
        + (f"Sparse handwritten annotation words visible: {annotations}. " if annotations else "")
        + "Black for main line art and character, orange for the main flow/path/arrow, red only "
        "for a key warning or result, blue only for a secondary note. No gradients, no shadows, "
        "no paper texture, no photorealism."
    )
    negative = (
        "gradient, shadow, paper texture, watermark, signature, photorealistic, 3d render, "
        "cute mascot, chibi, kawaii, children's cartoon, business flat illustration, PPT "
        "infographic, dense diagram, ui screenshot, color background, sepia, vignette, blur, "
        "extra limbs, deformed"
    )
    return prompt, negative


async def build_shot_list(text: str, max_shots: int = DEFAULT_SHOTS) -> list[dict[str, Any]]:
    """LLM step: read the source text, return a shot list (no images yet)."""
    from app.services import ai as ai_svc

    max_shots = min(max(max_shots, 1), MAX_SHOTS)
    user = f"Target shot count: {max_shots} (fewer is fine if the content is thin).\n\nContent:\n{text[:8000]}"

    resp = await ai_svc.chat(
        [
            {"role": "system", "content": _SHOT_LIST_SYSTEM},
            {"role": "user", "content": user},
        ],
        temperature=0.7, max_tokens=2048,
    )
    raw = ai_svc.extract_text(resp).strip()
    if raw.startswith("```"):
        raw = raw.strip("`")
        if raw.startswith("json"):
            raw = raw[4:]
    start, end = raw.find("{"), raw.rfind("}")
    if start == -1 or end <= start:
        raise RuntimeError("shot list generation returned no usable JSON")
    parsed = json.loads(raw[start:end + 1])
    shots = parsed.get("shots") or []
    if not shots:
        raise RuntimeError("shot list generation returned zero shots")
    return shots[:max_shots]


async def generate_illustrations(text: str, max_shots: int = DEFAULT_SHOTS) -> dict[str, Any]:
    """Full pipeline: shot list, then one image generation per shot (serial —
    the local fallback pipeline is single-lane, see app.services.image_gen)."""
    from app.services import image_gen

    shots = await build_shot_list(text, max_shots)
    results: list[dict[str, Any]] = []
    for shot in shots:
        prompt, negative = _build_image_prompt(shot)
        try:
            png_bytes = await image_gen.generate_illustration(prompt, negative)
            image_b64 = _to_base64(png_bytes)
            error = None
        except Exception as exc:  # local CPU pipeline unavailable / OOM / etc.
            log.warning("illustration generation failed for shot %r: %s", shot.get("topic"), exc)
            image_b64 = None
            error = str(exc)
        results.append({**shot, "image_base64": image_b64, "error": error})

    return {"shots": results}


def _to_base64(data: bytes) -> str:
    import base64
    return base64.b64encode(data).decode("ascii")
