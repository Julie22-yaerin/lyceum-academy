import { useState, useRef, useCallback, useEffect } from 'react';

interface Props {
  totalMinutes: number;
  onComplete: () => void;
}

export default function MiniTimer({ totalMinutes, onComplete }: Props) {
  const totalSec = totalMinutes * 60;
  const [remaining, setRemaining] = useState(totalSec);
  const [running, setRunning] = useState(false);
  const [done, setDone] = useState(false);
  const startTs = useRef(0);
  const pausedRem = useRef(totalSec);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const pos = useRef({ x: 24, y: 24 });
  const drag = useRef<{ sx: number; sy: number; ox: number; oy: number } | null>(null);

  useEffect(() => {
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, []);

  useEffect(() => {
    if (!running || done) return;
    timerRef.current = setInterval(() => {
      const el = Math.floor((Date.now() - startTs.current) / 1000);
      const r = Math.max(0, pausedRem.current - el);
      setRemaining(r);
      if (r <= 0) {
        if (timerRef.current) clearInterval(timerRef.current);
        setRunning(false);
        setDone(true);
        onComplete();
      }
    }, 200);
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [running, done, onComplete]);

  function toggle() {
    if (done) return;
    if (running) {
      if (timerRef.current) clearInterval(timerRef.current);
      pausedRem.current = remaining;
      setRunning(false);
    } else {
      startTs.current = Date.now();
      pausedRem.current = remaining;
      setRunning(true);
    }
  }

  function handleReset() {
    if (timerRef.current) clearInterval(timerRef.current);
    setRunning(false);
    setDone(false);
    setRemaining(totalSec);
    pausedRem.current = totalSec;
  }

  const onDown = useCallback((e: React.PointerEvent) => {
    const el = e.currentTarget as HTMLElement;
    const rect = el.getBoundingClientRect();
    drag.current = { sx: e.clientX, sy: e.clientY, ox: rect.left, oy: rect.top };
    el.setPointerCapture(e.pointerId);
  }, []);
  const onMove = useCallback((e: React.PointerEvent) => {
    if (!drag.current) return;
    pos.current = {
      x: Math.max(0, drag.current.ox + e.clientX - drag.current.sx),
      y: Math.max(0, drag.current.oy + e.clientY - drag.current.sy),
    };
    (e.currentTarget as HTMLElement).style.left = pos.current.x + 'px';
    (e.currentTarget as HTMLElement).style.top = pos.current.y + 'px';
  }, []);
  const onUp = useCallback(() => { drag.current = null; }, []);

  const fmt = (s: number) => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;

  const pct = totalSec > 0 ? (1 - remaining / totalSec) * 100 : 0;

  return (
    <div
      onPointerDown={onDown}
      onPointerMove={onMove}
      onPointerUp={onUp}
      onClick={e => { if (!drag.current) { e.stopPropagation(); toggle(); } }}
      style={{
        position: 'fixed', left: pos.current.x, bottom: pos.current.y, zIndex: 150,
        background: done ? 'rgba(30,30,30,0.92)' : 'rgba(12,18,36,0.92)',
        border: done ? '1px solid rgba(248,113,113,0.3)' : '1px solid rgba(255,255,255,0.12)',
        borderRadius: 8, padding: '8px 14px',
        backdropFilter: 'blur(24px)',
        boxShadow: '0 8px 32px rgba(0,0,0,0.4)',
        cursor: drag.current ? 'grabbing' : 'grab',
        userSelect: 'none', touchAction: 'none',
        fontFamily: 'sans-serif',
        display: 'flex', alignItems: 'center', gap: 10,
        width: 'auto', minWidth: 140,
      }}
    >
      <button onClick={e => { e.stopPropagation(); if (done) handleReset(); else toggle(); }}
        style={{
          background: done ? 'rgba(239,68,68,0.2)' : running ? 'rgba(251,191,36,0.2)' : 'rgba(52,211,153,0.2)',
          border: 'none', borderRadius: 5, padding: '4px 8px', cursor: 'pointer', fontSize: 13, lineHeight: 1,
          flexShrink: 0,
        }}>
        {done ? '↺' : running ? '⏸' : '▶'}
      </button>
      <span style={{
        fontSize: 18, fontWeight: 600,
        color: done ? '#f87171' : '#e2e8f0',
        letterSpacing: 1, fontVariantNumeric: 'tabular-nums',
        whiteSpace: 'nowrap',
      }}>
        {done ? '00:00' : fmt(remaining)}
      </span>
      <div style={{
        width: 40, height: 4, background: 'rgba(255,255,255,0.1)', borderRadius: 2, overflow: 'hidden', flexShrink: 0,
      }}>
        <div style={{
          height: '100%', width: `${pct}%`,
          background: done ? '#f87171' : '#34d399', borderRadius: 2,
          transition: 'width 0.3s',
        }} />
      </div>
    </div>
  );
}
