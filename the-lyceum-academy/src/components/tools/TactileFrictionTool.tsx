/**
 * TactileFrictionTool (Tier 2 · Tactile Logic Friction) — the brain encodes
 * deeper when there's motor-sensory "physical latency". Terms that are too
 * frictionless to move slip straight out of short-term memory, so here every
 * variable cluster has a knowledge "mass": heavier clusters literally drag
 * slower under the cursor. Moving a term across the = sign (transposing it)
 * costs real effort proportional to how conceptually heavy it is.
 *
 * Brain: Kinesthetic. Thinking: Procedural / Algorithmic.
 * Subjects: Classical Mechanics, balancing complex chemistry equations.
 *
 * Native pointer drag + a per-token mass that damps the follow speed (motion
 * lerp), so a heavy token "rì" (lags) behind the pointer.
 */
import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';

interface Token { id: string; label: string; mass: number; side: 'L' | 'R'; }

const PRESETS: { name: string; tokens: Token[]; note: string }[] = [
  {
    name: 'Lorentz force  F = qE + qv×B',
    note: 'Chuyển qv×B sang trái để cô lập qE. Cụm càng nặng (nhiều ý niệm) càng kéo rì.',
    tokens: [
      { id: 'F', label: 'F', mass: 1, side: 'L' },
      { id: 'qE', label: 'qE', mass: 2, side: 'R' },
      { id: 'qvB', label: 'qv×B', mass: 5, side: 'R' },
    ],
  },
  {
    name: "Newton  F = ma",
    note: 'Chuyển m sang trái để tìm a = F/m.',
    tokens: [
      { id: 'F', label: 'F', mass: 1, side: 'L' },
      { id: 'm', label: 'm', mass: 3, side: 'R' },
      { id: 'a', label: 'a', mass: 2, side: 'R' },
    ],
  },
];

export default function TactileFrictionTool() {
  const [presetIdx, setPresetIdx] = useState(0);
  const [tokens, setTokens] = useState<Token[]>(PRESETS[0].tokens);
  const [dragId, setDragId] = useState<string | null>(null);
  // Rendered position lags the pointer target, damped by mass.
  const posRef = useRef<Record<string, { x: number; y: number }>>({});
  const targetRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const [, force] = useState(0);
  const rafRef = useRef(0);

  useEffect(() => { setTokens(PRESETS[presetIdx].tokens); posRef.current = {}; }, [presetIdx]);

  useEffect(() => {
    const loop = () => {
      rafRef.current = requestAnimationFrame(loop);
      if (dragId) {
        const tok = tokens.find(t => t.id === dragId);
        if (tok) {
          const cur = posRef.current[dragId] || { x: targetRef.current.x, y: targetRef.current.y };
          // Heavier mass → smaller lerp factor → laggier ("rì") follow.
          const k = 0.28 / tok.mass;
          cur.x += (targetRef.current.x - cur.x) * k;
          cur.y += (targetRef.current.y - cur.y) * k;
          posRef.current[dragId] = cur;
          force(n => n + 1);
        }
      }
    };
    rafRef.current = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(rafRef.current);
  }, [dragId, tokens]);

  function onPointerDown(e: ReactPointerEvent, id: string) {
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    const rect = (e.currentTarget.parentElement as HTMLElement).getBoundingClientRect();
    targetRef.current = { x: e.clientX - rect.left, y: e.clientY - rect.top };
    posRef.current[id] = { ...targetRef.current };
    setDragId(id);
  }
  function onPointerMove(e: ReactPointerEvent) {
    if (!dragId) return;
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    targetRef.current = { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }
  function onPointerUp(e: ReactPointerEvent) {
    if (!dragId) return;
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const dropped = posRef.current[dragId];
    // Dropped on the left half → move to L side (transposed), right half → R.
    const newSide: 'L' | 'R' = dropped && dropped.x < rect.width / 2 ? 'L' : 'R';
    setTokens(ts => ts.map(t => t.id === dragId ? { ...t, side: newSide } : t));
    delete posRef.current[dragId];
    setDragId(null);
  }

  const preset = PRESETS[presetIdx];
  const left = tokens.filter(t => t.side === 'L');
  const right = tokens.filter(t => t.side === 'R');

  function chip(t: Token) {
    const p = posRef.current[t.id];
    const dragging = dragId === t.id;
    return (
      <div
        key={t.id}
        onPointerDown={e => onPointerDown(e, t.id)}
        className="select-none cursor-grab active:cursor-grabbing font-serif text-2xl px-4 py-2 rounded-xl"
        style={{
          background: `rgba(196,164,255,${0.08 + t.mass * 0.04})`,
          border: '1px solid rgba(196,164,255,0.3)',
          position: dragging ? 'absolute' : 'relative',
          left: dragging && p ? p.x - 30 : undefined,
          top: dragging && p ? p.y - 24 : undefined,
          zIndex: dragging ? 50 : 1,
          boxShadow: dragging ? '0 8px 30px rgba(0,0,0,0.5)' : 'none',
          touchAction: 'none',
        }}
        title={`Knowledge mass ×${t.mass}`}
      >
        {t.label}
        <span className="ml-1.5 text-[9px] align-super text-white/40">m{t.mass}</span>
      </div>
    );
  }

  return (
    <div className="p-4 flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <p className="text-[11px] uppercase tracking-[2px] text-white/40">Tactile Logic Friction</p>
        <select value={presetIdx} onChange={e => setPresetIdx(Number(e.target.value))}
          className="bg-white/5 border border-white/10 rounded-lg px-2 py-1 text-[11px] text-white/70 outline-none">
          {PRESETS.map((p, i) => <option key={i} value={i} className="bg-neutral-900">{p.name}</option>)}
        </select>
      </div>

      <div
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        className="relative rounded-2xl bg-white/[0.03] p-4 min-h-[160px] flex items-stretch gap-3"
      >
        <div className="flex-1 rounded-xl border border-dashed border-white/10 p-3 flex flex-wrap items-center content-center gap-2 justify-center">
          <span className="absolute top-1 left-3 text-[9px] uppercase tracking-[2px] text-white/25">Vế trái</span>
          {left.map(chip)}
        </div>
        <div className="self-center font-serif text-3xl text-white/60">=</div>
        <div className="flex-1 rounded-xl border border-dashed border-white/10 p-3 flex flex-wrap items-center content-center gap-2 justify-center">
          <span className="absolute top-1 right-3 text-[9px] uppercase tracking-[2px] text-white/25">Vế phải</span>
          {right.map(chip)}
        </div>
      </div>

      <p className="text-xs text-white/60">{preset.note}</p>
    </div>
  );
}
