/**
 * KineticStressTool (Tier 2) — "Time-Dilation via Pain-Triggering". A
 * countdown that does NOT run evenly: while the student is actively working
 * (moving the mouse, typing) it ticks at 1×, but the moment they go idle the
 * clock accelerates up to 3× and the whole frame shakes with a red pulse —
 * simulating a system on the verge of collapse to force sustained focus.
 *
 * Drop a problem in, hit start, keep moving or lose time.
 */
import { useEffect, useRef, useState } from 'react';
import { motion, useAnimationControls } from 'motion/react';

export default function KineticStressTool() {
  const [problem, setProblem] = useState('');
  const [running, setRunning] = useState(false);
  const [remaining, setRemaining] = useState(180); // seconds of "real" budget
  const [speed, setSpeed] = useState(1);
  const lastActivity = useRef(Date.now());
  const controls = useAnimationControls();

  // Any mouse move / keypress registers as activity.
  useEffect(() => {
    function mark() { lastActivity.current = Date.now(); }
    window.addEventListener('mousemove', mark);
    window.addEventListener('keydown', mark);
    return () => { window.removeEventListener('mousemove', mark); window.removeEventListener('keydown', mark); };
  }, []);

  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => {
      const idleMs = Date.now() - lastActivity.current;
      // 0–3s idle → 1×; ramps to 3× by 6s idle.
      const s = idleMs < 1500 ? 1 : Math.min(3, 1 + (idleMs - 1500) / 2250 * 2);
      setSpeed(+s.toFixed(2));
      setRemaining(prev => {
        const next = prev - s * 0.25; // tick every 250ms
        return next <= 0 ? 0 : next;
      });
    }, 250);
    return () => clearInterval(id);
  }, [running]);

  // Shake harder the faster the clock is running.
  useEffect(() => {
    if (running && speed > 1.4) {
      const amp = (speed - 1) * 3;
      controls.start({ x: [0, -amp, amp, -amp, 0], transition: { duration: 0.25 } });
    }
  }, [speed, running, controls]);

  const danger = speed > 1.4;
  const dead = remaining <= 0;
  const mins = Math.floor(remaining / 60);
  const secs = Math.floor(remaining % 60);

  return (
    <motion.div
      animate={controls}
      className="p-4 flex flex-col gap-3 rounded-2xl transition-colors duration-300"
      style={{ boxShadow: danger ? `inset 0 0 60px ${(speed - 1) * 24}px rgba(248,113,113,${(speed - 1) * 0.4})` : 'none' }}
    >
      <div className="flex items-center justify-between">
        <p className="text-[11px] uppercase tracking-[2px] text-white/40">Kinetic Stress</p>
        <span className={`font-mono text-sm ${danger ? 'text-red-300' : 'text-white/70'}`}>×{speed.toFixed(1)}</span>
      </div>

      <div className={`text-center font-mono text-5xl tabular-nums ${dead ? 'text-red-400' : danger ? 'text-red-300' : 'text-white/90'}`}>
        {dead ? 'COLLAPSE' : `${mins}:${secs.toString().padStart(2, '0')}`}
      </div>
      <p className="text-center text-[10px] text-white/30 -mt-1">
        {dead ? 'You stalled too long. The system fell.' : danger ? '⚠ Keep moving — the clock is accelerating.' : 'Stay in motion. Idleness burns time faster.'}
      </p>

      {!running && !dead && (
        <>
          <textarea
            value={problem} onChange={e => setProblem(e.target.value)} rows={3}
            placeholder="Paste the problem you must not stop solving…"
            className="w-full bg-white/5 rounded-xl px-3 py-2 text-sm text-white/85 outline-none border border-white/10 focus:border-white/25 resize-y"
          />
          <button
            onClick={() => { setRunning(true); lastActivity.current = Date.now(); }}
            className="rounded-xl px-4 py-2.5 text-[11px] uppercase tracking-[2px] bg-red-400/15 text-red-200 hover:bg-red-400/25 transition-colors"
          >
            Begin under pressure
          </button>
        </>
      )}

      {running && !dead && (
        <div className="rounded-xl bg-white/5 p-3 text-sm text-white/80 whitespace-pre-wrap min-h-[80px]">
          {problem || '(no problem text — the clock runs anyway)'}
        </div>
      )}

      {(dead || running) && (
        <button
          onClick={() => { setRunning(false); setRemaining(180); setSpeed(1); }}
          className="self-end text-[10px] uppercase tracking-[2px] text-white/40 hover:text-white/70 transition-colors"
        >
          reset
        </button>
      )}
    </motion.div>
  );
}
