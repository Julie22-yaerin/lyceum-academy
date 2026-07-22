/**
 * DarkRoomTool (Tier 2) — "Blindfolded Geometric Rendering". The screen goes
 * black; the student can't see the law's formula. They manipulate an invisible
 * relationship with the arrow keys — e.g. halve the distance r — and the UI
 * only flashes (emission) when the physical ratio is satisfied. The point is
 * to build the law by feel, not by reading it.
 *
 * Concretely: an inverse-square target (F ∝ 1/r²). The student drives r with
 * ←/→; when their implied intensity matches the true 1/r² curve within
 * tolerance, the void flares. No numbers shown until they nail it.
 */
import { useEffect, useRef, useState, type KeyboardEvent } from 'react';

export default function DarkRoomTool() {
  // r in arbitrary units; true intensity = k / r². Student can't see either.
  const [r, setR] = useState(2.0);
  const [target, setTarget] = useState(1.0);       // target r they must reach
  const [locked, setLocked] = useState(false);
  const [reveal, setReveal] = useState(false);
  const [round, setRound] = useState(1);
  const areaRef = useRef<HTMLDivElement>(null);

  const intensity = 1 / (r * r);
  const targetIntensity = 1 / (target * target);
  const withinTol = Math.abs(r - target) < 0.06;

  useEffect(() => { areaRef.current?.focus(); }, []);

  useEffect(() => {
    if (withinTol && !locked) {
      setLocked(true);
      const t = setTimeout(() => setReveal(true), 400);
      return () => clearTimeout(t);
    }
  }, [withinTol, locked]);

  function onKey(e: KeyboardEvent) {
    if (locked) return;
    if (e.key === 'ArrowRight' || e.key === 'ArrowUp') { e.preventDefault(); setR(v => Math.min(4, +(v + 0.02).toFixed(3))); }
    if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') { e.preventDefault(); setR(v => Math.max(0.4, +(v - 0.02).toFixed(3))); }
  }

  function nextRound() {
    setTarget(+(0.6 + Math.random() * 2).toFixed(2));
    setR(2.0); setLocked(false); setReveal(false); setRound(x => x + 1);
    areaRef.current?.focus();
  }

  // Emission glow scales with how close the student's intensity is to target.
  const closeness = Math.max(0, 1 - Math.abs(intensity - targetIntensity) / targetIntensity);
  const glow = locked ? 1 : Math.pow(closeness, 3);

  return (
    <div className="p-4 flex flex-col gap-3">
      <p className="text-[11px] text-white/50 leading-relaxed">
        The law is <span className="text-white/80">hidden</span>. Feel it. Use <kbd className="px-1 rounded bg-white/10">←</kbd>
        <kbd className="px-1 rounded bg-white/10 mx-0.5">→</kbd> to change the separation <i>r</i> until the field intensity
        matches the target. Inverse-square: intensity ∝ 1/r².
      </p>

      <div
        ref={areaRef}
        tabIndex={0}
        onKeyDown={onKey}
        className="relative h-64 rounded-2xl bg-black outline-none overflow-hidden cursor-crosshair select-none"
        style={{ boxShadow: glow > 0.02 ? `inset 0 0 ${60 * glow}px ${20 * glow}px rgba(196,164,255,${0.5 * glow})` : 'none' }}
      >
        {/* The invisible body — a faint dot that brightens only near the answer */}
        <div
          className="absolute left-1/2 top-1/2 rounded-full"
          style={{
            width: 14, height: 14, marginLeft: -7, marginTop: -7,
            background: `rgba(255,255,255,${0.04 + glow * 0.9})`,
            boxShadow: `0 0 ${40 * glow}px ${18 * glow}px rgba(252,211,77,${glow})`,
            transform: `scale(${1 + glow})`,
            transition: 'all 60ms linear',
          }}
        />
        {reveal && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-1 bg-black/40">
            <span className="text-3xl">✦</span>
            <p className="text-amber-200 text-sm">You found it by feel.</p>
            <p className="text-white/60 text-xs font-mono">r = {target.toFixed(2)} · intensity = {targetIntensity.toFixed(3)}</p>
            <p className="text-white/40 text-[10px] mt-1">Halving r quadrupled the intensity — that's 1/r².</p>
          </div>
        )}
        {!reveal && (
          <div className="absolute bottom-2 left-0 right-0 text-center text-[10px] text-white/25 font-mono">
            {locked ? 'locked' : withinTol ? '…' : closeness > 0.85 ? 'warmer' : closeness > 0.5 ? 'closer' : 'cold'}
          </div>
        )}
      </div>

      <button
        onClick={nextRound}
        className="self-end rounded-xl px-4 py-2 text-[10px] uppercase tracking-[2px] bg-purple-400/15 text-purple-200 hover:bg-purple-400/25 transition-colors"
      >
        {reveal ? 'Next round →' : `Round ${round} · reset`}
      </button>
    </div>
  );
}
