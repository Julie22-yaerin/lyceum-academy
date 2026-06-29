/* eslint-disable @typescript-eslint/no-explicit-any */

// ── KaTeX loader with ready-callback support ──────────────────────────────
let _katexReady = false;
const _readyCallbacks: Array<() => void> = [];

/** Load KaTeX from CDN once. Pass onReady to be called when KaTeX is loaded. */
export function loadKaTeX(onReady?: () => void): void {
  if ((window as any).katex) {
    _katexReady = true;
    onReady?.();
    return;
  }
  if (onReady) _readyCallbacks.push(onReady);
  if (document.getElementById('katex-css')) return; // already loading

  const link = document.createElement('link');
  link.id = 'katex-css';
  link.rel = 'stylesheet';
  link.href = 'https://cdn.jsdelivr.net/npm/katex@0.16.21/dist/katex.min.css';
  document.head.appendChild(link);

  const script = document.createElement('script');
  script.src = 'https://cdn.jsdelivr.net/npm/katex@0.16.21/dist/katex.min.js';
  script.onload = () => {
    _katexReady = true;
    _readyCallbacks.forEach(cb => cb());
    _readyCallbacks.length = 0;
  };
  document.head.appendChild(script);
}

/**
 * Auto-wrap plain math notation in $...$ so KaTeX can render it.
 * Handles: x^2, x^{n+1}, x_i, x_{ij}, sqrt(...), frac(a,b), etc.
 * Only wraps tokens that look clearly mathematical.
 */
function autoWrapMath(text: string): string {
  // x^2, a^{n+1}
  text = text.replace(
    /([a-zA-Z0-9])\^(\{[^}]+\}|[a-zA-Z0-9]+)/g,
    (m) => `$${m}$`
  );
  // x_i, x_{n-1}
  text = text.replace(
    /([a-zA-Z0-9])_(\{[^}]+\}|[a-zA-Z0-9]+)/g,
    (m) => `$${m}$`
  );
  // sqrt(...) → $\sqrt{...}$
  text = text.replace(/sqrt\(([^)]+)\)/g, (_, inner) => `$\\sqrt{${inner}}$`);
  // frac(a,b) → $\frac{a}{b}$
  text = text.replace(/frac\(([^,)]+),([^)]+)\)/g, (_, a, b) => `$\\frac{${a.trim()}}{${b.trim()}}$`);
  return text;
}

/**
 * Fix LaTeX artifacts caused by JSON parsing.
 *
 * Root cause: the AI writes \right, \nabla etc. in JSON without doubling
 * the backslash. JSON parser treats these as escape sequences:
 *   \r → CR (0x0D)   \n → LF (0x0A)   \t → TAB (0x09)
 *   \b → BS  (0x08)  \f → FF  (0x0C)
 * So "\right" in JSON becomes CR+"ight", "\frac" becomes FF+"rac", etc.
 */
function sanitizeLatex(s: string): string {
  // ── \r (0x0D) artifacts ──────────────────────────────────────────────────
  s = s.replace(/\x0Dight/g,   '\\right')   // \right
       .replace(/\x0Dho\b/g,   '\\rho')     // \rho
       .replace(/\x0Dceil/g,   '\\rceil')
       .replace(/\x0Dfloor/g,  '\\rfloor')
       .replace(/\x0Dangle/g,  '\\rangle')
       .replace(/\x0Dm\b/g,    '\\rm')
       .replace(/\x0Def\b/g,   '\\ref')

  // ── \n (0x0A) artifacts ──────────────────────────────────────────────────
       .replace(/\x0Abla/g,    '\\nabla')   // \nabla
       .replace(/\x0Au\b/g,    '\\nu')      // \nu
       .replace(/\x0Aeq/g,     '\\neq')     // \neq
       .replace(/\x0Aotin/g,   '\\notin')
       .replace(/\x0Aot\b/g,   '\\not')
       .replace(/\x0Aum/g,     '\\num')

  // ── \t (0x09) artifacts ──────────────────────────────────────────────────
       .replace(/\x09au\b/g,   '\\tau')     // \tau
       .replace(/\x09heta/g,   '\\theta')
       .replace(/\x09imes/g,   '\\times')
       .replace(/\x09o\b/g,    '\\to')
       .replace(/\x09op\b/g,   '\\top')
       .replace(/\x09ext\b/g,  '\\text')
       .replace(/\x09ilde/g,   '\\tilde')

  // ── \b (0x08) artifacts ──────────────────────────────────────────────────
       .replace(/\x08eta/g,    '\\beta')    // \beta
       .replace(/\x08ar\b/g,   '\\bar')
       .replace(/\x08egin/g,   '\\begin')
       .replace(/\x08inom/g,   '\\binom')
       .replace(/\x08ig\b/g,   '\\big')
       .replace(/\x08ullet/g,  '\\bullet')

  // ── \f (0x0C) artifacts ──────────────────────────────────────────────────
       .replace(/\x0Crac/g,    '\\frac')    // \frac ← very common
       .replace(/\x0Corall/g,  '\\forall')

  // ── Bare commands (backslash stripped entirely) ───────────────────────────
       .replace(/(?<![\\a-zA-Z])(left)(?=\s*[\(\[|{])/g,   '\\left')
       .replace(/(?<![\\a-zA-Z])(right)(?=\s*[\)\]|.}])/g, '\\right')
       .replace(/(?<![\\a-zA-Z])(frac)(?=\s*\{)/g,         '\\frac')
       .replace(/(?<![\\a-zA-Z])(sqrt)(?=\s*[\{\(])/g,     '\\sqrt');

  // ── Balance unclosed braces ───────────────────────────────────────────────
  const opens  = (s.match(/\{/g) || []).length;
  const closes = (s.match(/\}/g) || []).length;
  if (opens > closes) s += '}'.repeat(opens - closes);
  return s;
}

/**
 * Render a LaTeX expression to HTML.
 * Fallback behaviour when KaTeX fails or isn't loaded:
 *  - If KaTeX not loaded → show plain expression text (no $ signs)
 *  - If KaTeX parse error → show raw expression in monospace, no ugly red error
 */
function renderKaTeX(expr: string, display: boolean): string {
  const katex = (window as any).katex;
  const trimmed = sanitizeLatex(expr.trim());

  if (!katex) {
    // KaTeX not loaded yet — show plain text, styled to indicate math
    return display
      ? `<span class="block text-center font-mono text-sm opacity-70 py-1">${escapeHtml(trimmed)}</span>`
      : `<span class="font-mono text-xs opacity-70">${escapeHtml(trimmed)}</span>`;
  }

  try {
    return katex.renderToString(trimmed, {
      displayMode: display,
      throwOnError: false,
      strict: false,
      output: 'html',
      errorColor: '#9ca3af',  // gray instead of screaming red for any residual errors
      macros: {
        '\\R': '\\mathbb{R}',
        '\\N': '\\mathbb{N}',
        '\\Z': '\\mathbb{Z}',
        '\\Q': '\\mathbb{Q}',
        '\\C': '\\mathbb{C}',
        '\\E': '\\mathbb{E}',
        '\\P': '\\mathbb{P}',
        '\\d': '\\mathrm{d}',
        '\\eps': '\\varepsilon',
      },
    });
  } catch {
    // Fallback: show expression in monospace without any LaTeX rendering
    return display
      ? `<span class="block text-center font-mono text-sm opacity-50 py-1 px-2 border border-outline-variant/20">${escapeHtml(trimmed)}</span>`
      : `<span class="font-mono text-xs opacity-50">${escapeHtml(trimmed)}</span>`;
  }
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * Render inline markdown + LaTeX (no block-level transforms, no <br>).
 * Used inside renderNote() for cell/paragraph content.
 */
function renderInline(text: string): string {
  if (!text) return '';
  text = autoWrapMath(text);
  const parts: string[] = [];
  const mathPattern = /(\$\$[\s\S]+?\$\$|\$[^\$\n]+?\$)/g;
  let lastIdx = 0;
  let match: RegExpExecArray | null;
  while ((match = mathPattern.exec(text)) !== null) {
    parts.push(escapeHtml(text.slice(lastIdx, match.index)));
    const full = match[0];
    parts.push(full.startsWith('$$')
      ? renderKaTeX(full.slice(2, -2), true)
      : renderKaTeX(full.slice(1, -1), false));
    lastIdx = match.index + full.length;
  }
  parts.push(escapeHtml(text.slice(lastIdx)));
  let out = parts.join('');
  out = out.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  out = out.replace(/(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)/g, '<em>$1</em>');
  out = out.replace(/`([^`]+)`/g, '<code class="font-mono text-xs bg-surface-container-highest px-1 py-0.5 rounded">$1</code>');
  return out;
}

function renderMdTable(rows: string[]): string {
  if (rows.length < 1) return '';
  const parseRow = (r: string) =>
    r.replace(/^\||\|$/g, '').split('|').map(c => c.trim());
  const isSep = (r: string) => /^\|[-| :]+\|$/.test(r.trim());

  const headerCells = parseRow(rows[0]);
  let bodyStart = 1;
  if (rows.length > 1 && isSep(rows[1])) bodyStart = 2;
  const bodyRows = rows.slice(bodyStart).filter(r => !isSep(r)).map(parseRow);

  const th = headerCells.map(c =>
    `<th class="text-left font-sans text-[10px] uppercase tracking-[1px] opacity-50 px-3 py-2 border-b border-outline/15 whitespace-nowrap">${renderInline(c)}</th>`
  ).join('');
  const tb = bodyRows.map(row =>
    `<tr class="border-b border-outline/8 hover:bg-surface-container-lowest/30 transition-colors">${
      row.map((c, i) =>
        `<td class="font-sans text-xs px-3 py-2 leading-relaxed ${i === 0 ? 'font-medium opacity-90' : 'opacity-70'}">${renderInline(c)}</td>`
      ).join('')
    }</tr>`
  ).join('');

  return `<div class="overflow-x-auto my-4 border border-outline/10"><table class="w-full border-collapse"><thead><tr class="bg-surface-container-lowest/50">${th}</tr></thead><tbody>${tb}</tbody></table></div>`;
}

/**
 * Full markdown-to-HTML renderer for AI-generated note content.
 * Handles: ## headers, tables, bullet lists, blockquotes, bold, italic, LaTeX.
 */
export function renderNote(text: string): string {
  if (!text) return '';
  const lines = text.split('\n');
  let html = '';
  let i = 0;

  while (i < lines.length) {
    const raw = lines[i];
    const t = raw.trim();

    if (!t) { i++; continue; }

    // ── Headings ─────────────────────────────────────────────────────────
    if (t.startsWith('#### ')) {
      html += `<h4 class="font-serif text-sm font-semibold mt-4 mb-1.5 opacity-80">${renderInline(t.slice(5))}</h4>`;
      i++; continue;
    }
    if (t.startsWith('### ')) {
      html += `<h3 class="font-serif text-base font-medium mt-6 mb-2">${renderInline(t.slice(4))}</h3>`;
      i++; continue;
    }
    if (t.startsWith('## ')) {
      html += `<h2 class="font-serif text-lg font-semibold mt-8 mb-3 pb-1 border-b border-outline/10">${renderInline(t.slice(3))}</h2>`;
      i++; continue;
    }
    if (t.startsWith('# ')) {
      html += `<h1 class="font-serif text-xl font-bold mt-8 mb-3">${renderInline(t.slice(2))}</h1>`;
      i++; continue;
    }

    // ── Table ─────────────────────────────────────────────────────────────
    if (t.startsWith('|') && t.endsWith('|')) {
      const tableRows: string[] = [];
      while (i < lines.length && lines[i].trim().startsWith('|') && lines[i].trim().endsWith('|')) {
        tableRows.push(lines[i]);
        i++;
      }
      html += renderMdTable(tableRows);
      continue;
    }

    // ── Bullet list (- or *) ──────────────────────────────────────────────
    if (/^[-*] /.test(t)) {
      let listHtml = '<ul class="flex flex-col gap-1.5 my-3 pl-1">';
      while (i < lines.length && /^\s*[-*] /.test(lines[i])) {
        const indent = lines[i].match(/^(\s*)/)?.[1].length ?? 0;
        const content = lines[i].trim().replace(/^[-*] /, '');
        const ml = indent >= 2 ? 'ml-5' : '';
        listHtml += `<li class="flex gap-2 font-sans text-sm opacity-80 leading-relaxed ${ml}"><span class="opacity-30 shrink-0 mt-0.5">·</span><span>${renderInline(content)}</span></li>`;
        i++;
      }
      listHtml += '</ul>';
      html += listHtml;
      continue;
    }

    // ── Blockquote ────────────────────────────────────────────────────────
    if (t.startsWith('> ')) {
      let bq = '';
      while (i < lines.length && lines[i].trim().startsWith('> ')) {
        bq += renderInline(lines[i].trim().slice(2)) + ' ';
        i++;
      }
      html += `<blockquote class="border-l-2 border-outline/25 pl-4 italic font-sans text-sm opacity-60 my-3 leading-relaxed">${bq.trim()}</blockquote>`;
      continue;
    }

    // ── Horizontal rule ───────────────────────────────────────────────────
    if (/^[-*_]{3,}$/.test(t)) {
      html += '<hr class="border-outline/10 my-5"/>';
      i++; continue;
    }

    // ── Paragraph ─────────────────────────────────────────────────────────
    html += `<p class="font-sans text-sm leading-relaxed opacity-85 mb-3">${renderInline(t)}</p>`;
    i++;
  }

  return html;
}

/** Render a string containing $...$ and $$...$$ and basic markdown to HTML. */
export function renderMath(text: string): string {
  if (!text) return '';

  // Auto-wrap plain math notation BEFORE escaping HTML
  text = autoWrapMath(text);

  const parts: string[] = [];
  const mathPattern = /(\$\$[\s\S]+?\$\$|\$[^\$\n]+?\$)/g;
  let lastIdx = 0;
  let match: RegExpExecArray | null;

  while ((match = mathPattern.exec(text)) !== null) {
    // Escape non-math text before this block
    parts.push(escapeHtml(text.slice(lastIdx, match.index)));

    const full = match[0];
    if (full.startsWith('$$')) {
      parts.push(renderKaTeX(full.slice(2, -2), true));
    } else {
      parts.push(renderKaTeX(full.slice(1, -1), false));
    }
    lastIdx = match.index + full.length;
  }

  // Remaining text after last math block
  parts.push(escapeHtml(text.slice(lastIdx)));

  let out = parts.join('');

  // Bold **text**
  out = out.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  // Italic *text*
  out = out.replace(/\*(.+?)\*/g, '<em>$1</em>');
  // Code `text`
  out = out.replace(/`([^`]+)`/g, '<code class="font-mono text-xs bg-surface-container-highest px-1">$1</code>');
  // Newlines
  out = out.replace(/\n/g, '<br>');

  return out;
}
