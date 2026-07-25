/**
 * StudyCycleTimer — enforces the house study rhythm: 45 minutes of work, then
 * a 5-10 minute break, repeating. Built for students who lose the thread
 * without an external clock, so the timer is deliberately hard to ignore and
 * the break is not skippable: when work time is up the overlay covers the
 * workspace until the minimum break has actually elapsed.
 *
 * Runs off wall-clock deadlines (not a decrementing counter), so a
 * backgrounded tab — where browsers throttle timers — still resumes with the
 * correct remaining time instead of drifting.
 *
 * Mounted once in MainLayout. Idle until the student starts a cycle.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { Coffee, Pause, Play, RotateCcw, Timer as TimerIcon, X } from 'lucide-react';
import { useWorkspace } from '../context/WorkspaceContext';
import BreakReels from './BreakReels';

const WORK_MS = 45 * 60_000;
const BREAK_MIN_MS = 5 * 60_000;
const BREAK_MAX_MS = 10 * 60_000;

type Phase = 'idle' | 'work' | 'break';

function fmt(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

export default function StudyCycleTimer() {
  const { activeTab } = useWorkspace();
  const [phase, setPhase] = useState<Phase>('idle');
  const [remaining, setRemaining] = useState(WORK_MS);
  const [paused, setPaused] = useState(false);
  const [cycles, setCycles] = useState(0);
  // Wall-clock instant the current phase ends. Null while paused, where
  // `remaining` is the source of truth instead.
  const deadlineRef = useRef<number | null>(null);

  const startPhase = useCallback((next: Exclude<Phase, 'idle'>) => {
    const duration = next === 'work' ? WORK_MS : BREAK_MAX_MS;
    deadlineRef.current = Date.now() + duration;
    setRemaining(duration);
    setPaused(false);
    setPhase(next);
  }, []);

  // Single ticker for both phases; re-reads the deadline each tick so a
  // throttled/suspended tab self-corrects on wake.
  useEffect(() => {
    if (phase === 'idle' || paused) return;
    const id = setInterval(() => {
      const deadline = deadlineRef.current;
      if (deadline === null) return;
      const left = deadline - Date.now();
      setRemaining(left);
      if (left <= 0) {
        if (phase === 'work') {
          setCycles(c => c + 1);
          startPhase('break');
        } else {
          // Break ran its full length — back to work automatically.
          startPhase('work');
        }
      }
    }, 1000);
    return () => clearInterval(id);
  }, [phase, paused, startPhase]);

  function pauseResume() {
    if (paused) {
      deadlineRef.current = Date.now() + remaining;
      setPaused(false);
    } else {
      setPaused(true);
      deadlineRef.current = null;
    }
  }

  function stop() {
    deadlineRef.current = null;
    setPhase('idle');
    setPaused(false);
    setRemaining(WORK_MS);
  }

  // The break is only skippable once the 5-minute floor has passed — that
  // floor is the whole reason the timer exists.
  const breakElapsed = BREAK_MAX_MS - remaining;
  const canEndBreak = phase === 'break' && breakElapsed >= BREAK_MIN_MS;

  if (phase === 'break') {
    return (
      <div className="fixed inset-0 z-[190] bg-black/85 backdrop-blur-md flex flex-col md:flex-row items-center justify-center gap-8 p-6 overflow-y-auto">
        {/* Reels sit beside the break card, not inside it: they are an offer,
            not part of the instruction to rest. */}
        <BreakReels subject={activeTab} />
        <div className="glass-card rounded-3xl p-10 max-w-sm w-full text-center flex flex-col items-center gap-4">
          <Coffee className="w-9 h-9 text-emerald-300" strokeWidth={1.4} />
          <p className="text-[10px] uppercase tracking-[2px] text-emerald-300">Nghỉ bắt buộc</p>
          <p className="font-mono text-5xl text-white">{fmt(remaining)}</p>
          <p className="text-sm text-slate-400 leading-relaxed">
            Rời mắt khỏi màn hình. Đứng lên, uống nước. Nghỉ đủ mới học tiếp được —
            đây là phần làm cho 45 phút sau còn dùng được.
          </p>
          <button
            onClick={() => startPhase('work')}
            disabled={!canEndBreak}
            className="mt-2 rounded-xl px-6 py-2.5 text-[11px] uppercase tracking-[2px] bg-emerald-400/15 text-emerald-200 hover:bg-emerald-400/25 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
          >
            {canEndBreak ? 'Học tiếp' : `Còn ${fmt(BREAK_MIN_MS - breakElapsed)} nữa`}
          </button>
          <button onClick={stop} className="text-[11px] text-slate-500 hover:text-slate-300 transition-colors">
            Dừng hẳn chu kỳ
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed bottom-6 right-6 z-[120]">
      {phase === 'idle' ? (
        <button
          onClick={() => startPhase('work')}
          className="glass rounded-full pl-4 pr-5 py-2.5 flex items-center gap-2 text-xs text-white/80 hover:text-white transition-colors"
        >
          <TimerIcon className="w-4 h-4" /> Bắt đầu 45 phút
        </button>
      ) : (
        <div className="glass rounded-2xl px-4 py-3 flex items-center gap-3">
          <div>
            <p className="text-[9px] uppercase tracking-[2px] text-white/40">
              Đang học{cycles > 0 ? ` · chu kỳ ${cycles + 1}` : ''}
            </p>
            <p className="font-mono text-lg text-white leading-tight">{fmt(remaining)}</p>
          </div>
          <button onClick={pauseResume} aria-label={paused ? 'Tiếp tục' : 'Tạm dừng'}
            className="text-white/50 hover:text-white transition-colors">
            {paused ? <Play className="w-4 h-4" /> : <Pause className="w-4 h-4" />}
          </button>
          <button onClick={() => startPhase('work')} aria-label="Bắt đầu lại 45 phút"
            className="text-white/50 hover:text-white transition-colors">
            <RotateCcw className="w-4 h-4" />
          </button>
          <button onClick={stop} aria-label="Dừng"
            className="text-white/50 hover:text-red-300 transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}
    </div>
  );
}
