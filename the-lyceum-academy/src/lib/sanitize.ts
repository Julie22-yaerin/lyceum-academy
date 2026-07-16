/**
 * DOMPurify wrapper for the one spot in the app that injects raw markup
 * from an AI response instead of the escaped renderMath()/renderNote()
 * pipeline (lib/math.ts) — the note diagram SVG. AI output is not trusted
 * input: a prompt-injected upload could coax the model into emitting
 * <script>/onload=/foreignObject payloads, so this strips anything that
 * isn't plain SVG shape markup before it's dropped into the DOM.
 */

import DOMPurify from 'dompurify';

const SVG_PROFILE = {
  USE_PROFILES: { svg: true, svgFilters: true },
  FORBID_TAGS: ['script', 'foreignObject'],
  FORBID_ATTR: ['onload', 'onerror', 'onclick', 'onmouseover'],
};

export function sanitizeSvg(svg: string): string {
  if (!svg) return '';
  return DOMPurify.sanitize(svg, SVG_PROFILE);
}
