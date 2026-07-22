/**
 * ScalpelTool (Tier 2) — "Equation Mutilation". An equation is rendered as a
 * row of living tokens. The cursor is a scalpel; the student excises tokens
 * to test which are structurally load-bearing. Cutting a peripheral term is
 * tolerated; severing a core proportionality makes the equation "bleed"
 * (particle burst + red error) — teaching, viscerally, which relationships
 * the law cannot survive without.
 */
import { useRef, useState, type MouseEvent } from 'react';

interface EqToken { sym: string; core: boolean; }

const PRESETS: { name: string; tokens: EqToken[] }[] = [
  { name: "Newton's 2nd law", tokens: [
    { sym: 'F', core: true }, { sym: '=', core: true }, { sym: 'm', core: true }, { sym: 'a', core: true },
  ] },
  { name: "Coulomb's law", tokens: [
    { sym: 'F', core: true }, { sym: '=', core: true }, { sym: 'k', core: false },
    { sym: 'q₁q₂', core: true }, { sym: '/', core: true }, { sym: 'r²', core: true },
  ] },
  { name: 'Ideal gas', tokens: [
    { sym: 'P', core: true }, { sym: 'V', core: true }, { sym: '=', core: true },
    { sym: 'n', core: false }, { sym: 'R', core: false }, { sym: 'T', core: true },
  ] },
];

export default function ScalpelTool() {
  const [presetIdx, setPresetIdx] = useState(0);
  const [cut, setCut] = useState<Set<number>>(new Set());
  const [bleed, setBleed] = useState<number | null>(null);
  const [particles, setParticles] = useState<{ id: number; x: number; y: number }[]>([]);
  const pid = useRef(0);

  const preset = PRESETS[presetIdx];

  function excise(i: number, e: MouseEvent) {
    if (cut.has(i)) return;
    const tok = preset.tokens[i];
    setCut(s => new Set(s).add(i));
    if (tok.core) {
      setBleed(i);
      const rect = (e.target as HTMLElement).getBoundingClientRect();
      const burst = Array.from({ length: 14 }, () => ({
        id: pid.current++, x: rect.width / 2 + (Math.random() - 0.5) * 40, y: rect.height / 2 + (Math.random() - 0.5) * 40,
      }));
      setParticles(burst);
      setTimeout(() => { setParticles([]); }, 700);
      setTimeout(() => { setBleed(null); }, 1200);
    }
  }

  function reset(idx = presetIdx) {
    setPresetIdx(idx); setCut(new Set()); setBleed(null); setParticles([]);
  }

  const severedCore = preset.tokens.some((t, i) => t.core && cut.has(i));

  return (
    <div className="p-4 flex flex-col gap-4" style={{ cursor: 'crosshair' }}>
      <div className="flex items-center justify-between">
        <p className="text-[11px] uppercase tracking-[2px] text-white/40">Scalpel · Equation Mutilation</p>
        <select
          value={presetIdx} onChange={e => reset(Number(e.target.value))}
          className="bg-white/5 border border-white/10 rounded-lg px-2 py-1 text-[11px] text-white/70 outline-none"
        >
          {PRESETS.map((p, i) => <option key={i} value={i} className="bg-neutral-900">{p.name}</option>)}
        </select>
      </div>

      <div className={`relative flex items-center justify-center gap-2 rounded-2xl py-10 transition-colors ${
        bleed !== null ? 'bg-red-500/10' : 'bg-white/[0.03]'
      }`}>
        {preset.tokens.map((t, i) => (
          <button
            key={i}
            onClick={e => excise(i, e)}
            className="relative font-serif text-3xl px-2 py-1 rounded transition-all"
            style={{
              color: cut.has(i) ? (t.core ? 'rgba(248,113,113,0.35)' : 'rgba(255,255,255,0.2)') : 'rgba(255,255,255,0.9)',
              textDecoration: cut.has(i) ? 'line-through' : 'none',
              transform: bleed === i ? 'scale(0.9)' : 'scale(1)',
              textShadow: bleed === i ? '0 0 12px rgba(248,113,113,0.9)' : 'none',
            }}
          >
            {t.sym}
            {bleed === i && particles.map(p => (
              <span key={p.id} className="pointer-events-none absolute rounded-full"
                style={{
                  left: p.x, top: p.y, width: 4, height: 4, background: 'rgba(248,113,113,0.9)',
                  animation: 'scalpelBleed 0.7s ease-out forwards',
                }} />
            ))}
          </button>
        ))}
      </div>

      <p className={`text-center text-xs ${severedCore ? 'text-red-300' : 'text-white/40'}`}>
        {severedCore
          ? '✗ You severed a load-bearing relationship — the law no longer holds.'
          : cut.size > 0
            ? '✓ That term was peripheral. The core proportionality survives.'
            : 'Click a symbol to excise it. Find out which ones the law cannot live without.'}
      </p>

      <button onClick={() => reset()}
        className="self-center rounded-xl px-4 py-2 text-[10px] uppercase tracking-[2px] bg-white/10 text-white/60 hover:bg-white/20 transition-colors">
        heal equation
      </button>

      <style>{`
        @keyframes scalpelBleed {
          to { transform: translate(${'' /* random handled inline */}0, 24px); opacity: 0; }
        }
      `}</style>
    </div>
  );
}
