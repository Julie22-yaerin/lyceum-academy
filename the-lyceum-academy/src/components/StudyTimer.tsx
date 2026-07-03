import React, { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import type { View } from '../types';
import type { TaskConfig } from './TaskSetupModal';

interface Props {
  config: TaskConfig;
  totalMinutes: number;
  breakMinutes: number;
  onComplete: () => void;
  onCurrentTaskChange?: (view: View | null) => void;
  onBreakActive?: (active: boolean) => void;
}

type Phase = 'idle' | 'running' | 'paused' | 'done';

interface Segment {
  type: 'task' | 'break';
  view?: View;
  duration: number;
  label?: string;
  emoji?: string;
}

function buildSegments(config: TaskConfig, totalMinutes: number, breakMinutes: number): Segment[] {
  const segs: Segment[] = [];
  const active = config.tasks.filter(t => t.percent > 0);
  const numBreaks = Math.max(0, active.length - 1);
  const totalBreakSec = numBreaks * breakMinutes * 60;
  const totalStudySec = Math.max(60, totalMinutes * 60 - totalBreakSec);

  for (let i = 0; i < config.tasks.length; i++) {
    const t = config.tasks[i];
    if (t.percent <= 0) continue;
    const taskSec = Math.round(totalStudySec * t.percent / 100);
    if (taskSec > 0) {
      segs.push({ type: 'task', view: t.view, duration: taskSec, label: t.label, emoji: t.emoji });
    }
    const remainingActive = config.tasks.slice(i + 1).filter(tt => tt.percent > 0);
    if (remainingActive.length > 0) {
      segs.push({ type: 'break', duration: breakMinutes * 60 });
    }
  }
  return segs;
}

function findSegment(segments: Segment[], elapsed: number): { seg: Segment; idx: number; segElapsed: number } | null {
  let acc = 0;
  for (let i = 0; i < segments.length; i++) {
    acc += segments[i].duration;
    if (elapsed < acc) {
      return { seg: segments[i], idx: i, segElapsed: elapsed - (acc - segments[i].duration) };
    }
  }
  return null;
}

export default function StudyTimer({ config, totalMinutes, breakMinutes, onComplete, onCurrentTaskChange, onBreakActive }: Props) {
  const [phase, setPhase] = useState<Phase>('idle');
  const [elapsed, setElapsed] = useState(0);
  const [expanded, setExpanded] = useState(false);
  const [finishedEarly, setFinishedEarly] = useState(false);
  const [postBreak, setPostBreak] = useState(false);
  const [postBreakElapsed, setPostBreakElapsed] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const startTs = useRef(0);
  const pausedElapsed = useRef(0);
  const prevTaskRef = useRef<View | null>(null);
  const postBreakTs = useRef(0);

  const posRef = useRef({ x: 16, y: 16 });
  const dragRef = useRef<{ startX: number; startY: number; origX: number; origY: number } | null>(null);

  const segments = useMemo(() => buildSegments(config, totalMinutes, breakMinutes), [config, totalMinutes, breakMinutes]);
  const totalSec = segments.reduce((a, s) => a + s.duration, 0);
  const remaining = Math.max(0, totalSec - elapsed);
  const pct = totalSec > 0 ? Math.min(1, elapsed / totalSec) : 0;

  const currentInfo = (phase === 'running' || phase === 'paused') && !postBreak ? findSegment(segments, elapsed) : null;
  const isOnBreak = postBreak || currentInfo?.seg.type === 'break';
  const postBreakRemaining = Math.max(0, breakMinutes * 60 - postBreakElapsed);
  const postBreakDone = postBreak && postBreakElapsed >= breakMinutes * 60;

  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [onBreakActive, onComplete]);

  // Notify break state on unmount
  const savedOnBreakActive = useRef(onBreakActive);
  const savedOnComplete = useRef(onComplete);
  savedOnBreakActive.current = onBreakActive;
  savedOnComplete.current = onComplete;
  useEffect(() => {
    return () => {
      if (postBreak) {
        savedOnBreakActive.current?.(false);
        savedOnComplete.current?.();
      }
    };
  }, [postBreak]);

  // Report current task (null during breaks)
  useEffect(() => {
    if (phase !== 'running') {
      if (prevTaskRef.current !== null) {
        prevTaskRef.current = null;
        onCurrentTaskChange?.(null);
      }
      return;
    }
    const info = findSegment(segments, elapsed);
    const taskView = info && info.seg.type === 'task' ? info.seg.view! : null;
    if (taskView !== prevTaskRef.current) {
      prevTaskRef.current = taskView;
      onCurrentTaskChange?.(taskView);
    }
  }, [phase, elapsed, segments, onCurrentTaskChange]);

  // Auto-complete when all segments elapsed
  useEffect(() => {
    if (phase !== 'running') return;
    if (elapsed >= totalSec) {
      if (timerRef.current) clearInterval(timerRef.current);
      setFinishedEarly(false);
      setPhase('done');
    }
  }, [elapsed, totalSec, phase]);

  // Post-break auto-complete
  useEffect(() => {
    if (!postBreak) return;
    if (postBreakElapsed >= breakMinutes * 60) {
      if (timerRef.current) clearInterval(timerRef.current);
      setPostBreak(false);
      onBreakActive?.(false);
      onComplete();
    }
  }, [postBreakElapsed, breakMinutes, postBreak, onBreakActive, onComplete]);

  function startTimer() {
    startTs.current = Date.now();
    pausedElapsed.current = 0;
    setElapsed(0);
    setPhase('running');
    timerRef.current = setInterval(() => {
      const e = Math.floor((Date.now() - startTs.current) / 1000);
      setElapsed(e);
    }, 200);
  }

  function pauseTimer() {
    if (timerRef.current) clearInterval(timerRef.current);
    pausedElapsed.current = elapsed;
    setPhase('paused');
  }

  function resumeTimer() {
    startTs.current = Date.now() - pausedElapsed.current * 1000;
    setPhase('running');
    timerRef.current = setInterval(() => {
      const e = Math.floor((Date.now() - startTs.current) / 1000);
      setElapsed(e);
    }, 200);
  }

  function resetTimer() {
    if (timerRef.current) clearInterval(timerRef.current);
    setElapsed(0);
    setPhase('idle');
    setFinishedEarly(false);
  }

  function finishTimer() {
    if (timerRef.current) clearInterval(timerRef.current);
    setFinishedEarly(true);
    setPhase('done');
  }

  function skipBreak() {
    if (postBreak) {
      if (timerRef.current) clearInterval(timerRef.current);
      setPostBreak(false);
      onBreakActive?.(false);
      onComplete();
      return;
    }
    if (!currentInfo || currentInfo.seg.type !== 'break') return;
    const breakEnd = segments.slice(0, currentInfo.idx + 1).reduce((a, s) => a + s.duration, 0);
    const jump = breakEnd - elapsed;
    startTs.current -= jump * 1000;
    setElapsed(breakEnd);
  }

  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    const el = e.currentTarget as HTMLElement;
    const rect = el.getBoundingClientRect();
    dragRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      origX: rect.left,
      origY: rect.top,
    };
    el.setPointerCapture(e.pointerId);
  }, []);

  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    if (!dragRef.current) return;
    const dx = e.clientX - dragRef.current.startX;
    const dy = e.clientY - dragRef.current.startY;
    posRef.current = {
      x: Math.max(0, dragRef.current.origX + dx),
      y: Math.max(0, dragRef.current.origY + dy),
    };
    const el = e.currentTarget as HTMLElement;
    el.style.left = posRef.current.x + 'px';
    el.style.top = posRef.current.y + 'px';
  }, []);

  const handlePointerUp = useCallback(() => {
    dragRef.current = null;
  }, []);

  // Segment breakdown with elapsed per segment
  const segInfos = (() => {
    let acc = 0;
    return segments.map(s => {
      const start = acc;
      const end = acc + s.duration;
      const segElapsed = Math.max(0, Math.min(s.duration, elapsed - start));
      const segRemaining = s.duration - segElapsed;
      acc = end;
      return { ...s, segElapsed, segRemaining, segPct: s.duration > 0 ? segElapsed / s.duration : 0, isActive: elapsed >= start && elapsed < end };
    });
  })();

  const fmt = (s: number) => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;

  return (
    <>
      <div
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        style={{
          position: 'fixed', left: posRef.current.x, bottom: 16, zIndex: 150,
          background: isOnBreak ? 'rgba(30,30,30,0.95)' : 'rgba(12,18,36,0.95)',
          border: isOnBreak ? '1px solid rgba(251,191,36,0.25)' : '1px solid rgba(255,255,255,0.12)',
          borderRadius: 12, padding: expanded ? 14 : '10px 14px',
          backdropFilter: 'blur(24px)',
          boxShadow: '0 8px 32px rgba(0,0,0,0.4)',
          cursor: dragRef.current ? 'grabbing' : 'grab',
          userSelect: 'none', touchAction: 'none',
          fontFamily: 'sans-serif', minWidth: expanded ? 240 : 120,
          transition: 'min-width 0.2s',
        }}
        onClick={(e) => { if (!dragRef.current) { e.stopPropagation(); setExpanded(!expanded); } }}
      >
        {/* Collapsed */}
        {!expanded && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {postBreak && (
              <button onClick={(e) => { e.stopPropagation(); skipBreak(); }}
                style={{ background: 'rgba(251,191,36,0.2)', border: 'none', borderRadius: 6, padding: '4px 8px', cursor: 'pointer', fontSize: 13 }}>
                ⏭
              </button>
            )}
            {!postBreak && phase === 'idle' && (
              <button onClick={(e) => { e.stopPropagation(); startTimer(); }}
                style={{ background: 'rgba(52,211,153,0.2)', border: 'none', borderRadius: 6, padding: '4px 8px', cursor: 'pointer', fontSize: 13 }}>
                ▶
              </button>
            )}
            {!postBreak && phase === 'running' && !isOnBreak && (
              <button onClick={(e) => { e.stopPropagation(); pauseTimer(); }}
                style={{ background: 'rgba(251,191,36,0.2)', border: 'none', borderRadius: 6, padding: '4px 8px', cursor: 'pointer', fontSize: 13 }}>
                ⏸
              </button>
            )}
            {!postBreak && phase === 'running' && isOnBreak && (
              <button onClick={(e) => { e.stopPropagation(); skipBreak(); }}
                style={{ background: 'rgba(251,191,36,0.2)', border: 'none', borderRadius: 6, padding: '4px 8px', cursor: 'pointer', fontSize: 13 }}>
                ⏭
              </button>
            )}
            {!postBreak && phase === 'paused' && (
              <button onClick={(e) => { e.stopPropagation(); resumeTimer(); }}
                style={{ background: 'rgba(52,211,153,0.2)', border: 'none', borderRadius: 6, padding: '4px 8px', cursor: 'pointer', fontSize: 13 }}>
                ▶
              </button>
            )}
            {!postBreak && phase === 'done' && (
              <button onClick={(e) => { e.stopPropagation(); resetTimer(); }}
                style={{ background: 'rgba(239,68,68,0.2)', border: 'none', borderRadius: 6, padding: '4px 8px', cursor: 'pointer', fontSize: 13 }}>
                ↺
              </button>
            )}
            <span style={{
              fontSize: 15, fontWeight: 600,
              color: postBreak ? '#fbbf24' : phase === 'done' ? '#f87171' : isOnBreak ? '#fbbf24' : '#e2e8f0',
              letterSpacing: 1, fontVariantNumeric: 'tabular-nums',
            }}>
              {postBreak ? fmt(postBreakRemaining) : phase === 'idle' ? fmt(totalSec) : fmt(remaining)}
            </span>
          </div>
        )}

        {/* Expanded */}
        {expanded && (
          <div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
              <span style={{ fontSize: 11, fontWeight: 600, letterSpacing: 1, color: isOnBreak ? 'rgba(251,191,36,0.7)' : 'rgba(255,255,255,0.5)' }}>
                {postBreak ? '☕ POST-BREAK' : isOnBreak ? '☕ BREAK' : 'STUDY TIMER'}
              </span>
              <div style={{ display: 'flex', gap: 4 }}>
                {postBreak && (
                  <button onClick={(e) => { e.stopPropagation(); skipBreak(); }}
                    style={{ background: 'rgba(251,191,36,0.2)', border: 'none', borderRadius: 5, padding: '3px 10px', cursor: 'pointer', fontSize: 11, color: '#fbbf24' }}>
                    Skip Break
                  </button>
                )}
                {!postBreak && (phase === 'running' || phase === 'paused') && (
                  <button onClick={(e) => { e.stopPropagation(); finishTimer(); }}
                    style={{ background: 'rgba(239,68,68,0.15)', border: 'none', borderRadius: 5, padding: '3px 8px', cursor: 'pointer', fontSize: 10, color: '#f87171', fontWeight: 600 }}>
                    Finish
                  </button>
                )}
                {phase === 'idle' && (
                  <button onClick={(e) => { e.stopPropagation(); startTimer(); }}
                    style={{ background: 'rgba(52,211,153,0.2)', border: 'none', borderRadius: 5, padding: '3px 10px', cursor: 'pointer', fontSize: 11, color: '#34d399' }}>
                    Start
                  </button>
                )}
                {phase === 'running' && !isOnBreak && (
                  <button onClick={(e) => { e.stopPropagation(); pauseTimer(); }}
                    style={{ background: 'rgba(251,191,36,0.2)', border: 'none', borderRadius: 5, padding: '3px 10px', cursor: 'pointer', fontSize: 11, color: '#fbbf24' }}>
                    Pause
                  </button>
                )}
                {phase === 'running' && isOnBreak && (
                  <button onClick={(e) => { e.stopPropagation(); skipBreak(); }}
                    style={{ background: 'rgba(251,191,36,0.2)', border: 'none', borderRadius: 5, padding: '3px 10px', cursor: 'pointer', fontSize: 11, color: '#fbbf24' }}>
                    Skip Break
                  </button>
                )}
                {phase === 'paused' && (
                  <>
                    <button onClick={(e) => { e.stopPropagation(); resumeTimer(); }}
                      style={{ background: 'rgba(52,211,153,0.2)', border: 'none', borderRadius: 5, padding: '3px 10px', cursor: 'pointer', fontSize: 11, color: '#34d399' }}>
                      Resume
                    </button>
                    <button onClick={(e) => { e.stopPropagation(); resetTimer(); }}
                      style={{ background: 'rgba(239,68,68,0.15)', border: 'none', borderRadius: 5, padding: '3px 10px', cursor: 'pointer', fontSize: 11, color: '#f87171' }}>
                      Reset
                    </button>
                  </>
                )}
                {phase === 'done' && (
                  <button onClick={(e) => { e.stopPropagation(); resetTimer(); }}
                    style={{ background: 'rgba(52,211,153,0.2)', border: 'none', borderRadius: 5, padding: '3px 10px', cursor: 'pointer', fontSize: 11, color: '#34d399' }}>
                    Restart
                  </button>
                )}
              </div>
            </div>

            {/* Main timer */}
            <div style={{ textAlign: 'center', padding: '8px 0 12px' }}>
              {postBreak && (
                <div style={{ fontSize: 10, color: '#fbbf24', marginBottom: 4, letterSpacing: 1, textTransform: 'uppercase' }}>
                  Post-session break — relax
                </div>
              )}
              {!postBreak && isOnBreak && (
                <div style={{ fontSize: 10, color: '#fbbf24', marginBottom: 4, letterSpacing: 1, textTransform: 'uppercase' }}>
                  Break time — relax
                </div>
              )}
              {!postBreak && phase !== 'idle' && (
                <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.5)', marginBottom: 2, letterSpacing: 1, fontVariantNumeric: 'tabular-nums' }}>
                  {(pct * 100).toFixed(1)}%
                </div>
              )}
              <span style={{
                fontSize: 28, fontWeight: 700,
                color: postBreak ? '#fbbf24' : phase === 'done' ? '#f87171' : isOnBreak ? '#fbbf24' : '#e2e8f0',
                letterSpacing: 2, fontVariantNumeric: 'tabular-nums',
              }}>
                {postBreak ? fmt(postBreakRemaining) : phase === 'idle' ? fmt(totalSec) : fmt(remaining)}
              </span>
              <div style={{ height: 3, background: 'rgba(255,255,255,0.1)', borderRadius: 2, marginTop: 6, overflow: 'hidden' }}>
                <div style={{ height: '100%', width: `${postBreak ? (postBreakElapsed / (breakMinutes * 60)) * 100 : pct * 100}%`, background: phase === 'done' ? '#f87171' : '#34d399', borderRadius: 2, transition: 'width 0.3s' }} />
              </div>
            </div>

            {!postBreak && (
              <>
                {/* Per-segment breakdown */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                  {segInfos.map((s, i) => (
                    <div key={i} style={{
                      display: 'flex', alignItems: 'center', gap: 6,
                      opacity: s.isActive ? 1 : phase === 'running' ? 0.5 : 0.7,
                    }}>
                      {s.type === 'break' ? (
                        <span style={{ fontSize: 11, flexShrink: 0 }}>☕</span>
                      ) : (
                        <span style={{ fontSize: 12, flexShrink: 0 }}>{s.emoji}</span>
                      )}
                      <span style={{
                        fontSize: 10, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                        color: s.isActive ? (s.type === 'break' ? '#fbbf24' : 'rgba(255,255,255,0.85)') : 'rgba(255,255,255,0.4)',
                        fontWeight: s.isActive ? 600 : 400,
                      }}>
                        {s.type === 'break' ? 'Break' : s.label}
                      </span>
                      <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.4)', fontVariantNumeric: 'tabular-nums' }}>
                        {fmt(s.segRemaining)}
                      </span>
                      <div style={{ width: 40, height: 3, background: 'rgba(255,255,255,0.08)', borderRadius: 2, overflow: 'hidden' }}>
                        <div style={{
                          height: '100%', width: `${Math.min(100, s.segPct * 100)}%`,
                          background: s.type === 'break' ? '#fbbf24' : '#60a5fa', borderRadius: 2,
                        }} />
                      </div>
                    </div>
                  ))}
                </div>

                {phase === 'done' && (
                  <div style={{ textAlign: 'center', paddingTop: 10 }}>
                    <span style={{ fontSize: 11, color: '#fbbf24' }}>✓ Session complete!</span>
                  </div>
                )}
              </>
            )}
          </div>
        )}
      </div>

      {phase === 'done' && (
        <div style={{
          position: 'fixed', top: 20, right: 20, zIndex: 200,
          background: 'rgba(12,18,36,0.95)', border: `1px solid ${finishedEarly ? 'rgba(52,211,153,0.4)' : 'rgba(251,191,36,0.3)'}`,
          borderRadius: 10, padding: '14px 20px',
          backdropFilter: 'blur(24px)',
          boxShadow: '0 8px 32px rgba(0,0,0,0.4)',
          fontFamily: 'sans-serif',
          animation: 'notifSlide 0.3s ease-out',
        }}>
          <style>{`@keyframes notifSlide { from { transform:translateX(60px); opacity:0; } to { transform:translateX(0); opacity:1; } }`}</style>
          {finishedEarly ? (
            <>
              <p style={{ margin: 0, fontSize: 13, color: '#34d399', fontWeight: 600 }}>🎉 Huarayy!</p>
              <p style={{ margin: '4px 0 0', fontSize: 11, color: 'rgba(255,255,255,0.6)', lineHeight: 1.5 }}>
                You finish a task with only {totalSec > 0 ? ((elapsed / totalSec) * 100).toFixed(1) : 0}% of time. What a smart bee 🐝
              </p>
            </>
          ) : (
            <>
              <p style={{ margin: 0, fontSize: 13, color: '#fbbf24', fontWeight: 600 }}>⏰ Study session complete!</p>
              <p style={{ margin: '4px 0 0', fontSize: 11, color: 'rgba(255,255,255,0.5)' }}>
                {totalMinutes} min — great work today.
              </p>
            </>
          )}
          <button onClick={() => {
            if (finishedEarly) {
              setFinishedEarly(false);
              setPhase('idle');
              setPostBreak(true);
              setPostBreakElapsed(0);
              postBreakTs.current = Date.now();
              onBreakActive?.(true);
              if (timerRef.current) clearInterval(timerRef.current);
              timerRef.current = setInterval(() => {
                const e = Math.floor((Date.now() - postBreakTs.current) / 1000);
                setPostBreakElapsed(e);
              }, 200);
            } else {
              resetTimer();
              onComplete();
            }
          }}
            style={{ marginTop: 8, background: 'rgba(52,211,153,0.2)', border: 'none', borderRadius: 5, padding: '4px 14px', cursor: 'pointer', fontSize: 10, color: '#34d399' }}>
            {finishedEarly ? 'Break Time' : 'Dismiss'}
          </button>
        </div>
      )}
    </>
  );
}
