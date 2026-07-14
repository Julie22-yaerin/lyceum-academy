/**
 * ProductTour — first-login-only spotlight walkthrough.
 *
 * Darkens the whole page except a glowing hole cut around the current
 * step's target element (found via `document.querySelector`, so any
 * element just needs a stable `data-tour="…"` attribute). A floating
 * annotation card sits next to the spotlight with a title, a numbered
 * "how to use" list, and back/next arrows.
 *
 * Steps can run `onEnter` before the target is measured — e.g. navigate to
 * a different view, or click a button to reveal a nested panel — so the
 * same spotlight format can introduce small features buried inside a
 * bigger one, not just top-level nav items. If a target never appears
 * (element didn't render in time), that step is skipped automatically
 * rather than getting the tour stuck.
 */
import { useEffect, useRef, useState, type CSSProperties } from 'react';

export interface TourStep {
  target: string;                 // CSS selector, e.g. '[data-tour="dock-nexus"]'
  title: string;
  bullets: string[];
  onEnter?: () => void | Promise<void>;
  onExit?: () => void;
}

const TOOLTIP_WIDTH = 320;
const MARGIN = 16;
const SPOTLIGHT_PAD = 10;

export default function ProductTour({ steps, onFinish }: { steps: TourStep[]; onFinish: () => void }) {
  const [idx, setIdx] = useState(0);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const [visible, setVisible] = useState(false);
  const step = steps[idx];
  const runIdRef = useRef(0);

  useEffect(() => {
    const runId = ++runIdRef.current;
    let cancelled = false;
    setVisible(false);
    setRect(null);

    (async () => {
      if (step.onEnter) {
        try { await step.onEnter(); } catch { /* ignore */ }
      }
      for (let i = 0; i < 20; i++) {
        if (cancelled || runIdRef.current !== runId) return;
        const el = document.querySelector(step.target) as HTMLElement | null;
        if (el) {
          el.scrollIntoView({ block: 'center', behavior: 'auto' });
          setRect(el.getBoundingClientRect());
          setVisible(true);
          return;
        }
        await new Promise(res => setTimeout(res, 100));
      }
      // Target never showed up — skip this step rather than get stuck.
      if (!cancelled && runIdRef.current === runId) advance(idx + 1, true);
    })();

    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idx]);

  // Keep the spotlight glued to its target through resizes/scroll/animation.
  useEffect(() => {
    if (!visible) return;
    function reposition() {
      const el = document.querySelector(step.target);
      if (el) setRect(el.getBoundingClientRect());
    }
    const raf = window.setInterval(reposition, 200);
    window.addEventListener('resize', reposition);
    return () => { window.clearInterval(raf); window.removeEventListener('resize', reposition); };
  }, [visible, step.target]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') finish();
      if (e.key === 'ArrowRight') advance(idx + 1);
      if (e.key === 'ArrowLeft') advance(idx - 1);
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idx]);

  function advance(nextIdx: number, skippedTarget = false) {
    if (!skippedTarget) step.onExit?.();
    if (nextIdx < 0) return;
    if (nextIdx >= steps.length) { finish(); return; }
    setIdx(nextIdx);
  }

  function finish() {
    step.onExit?.();
    onFinish();
  }

  if (!rect || !visible) {
    // Still resolving the first step's target — show nothing rather than
    // a full-screen flash with no spotlight.
    return null;
  }

  const isIconLike = rect.width <= 90 && rect.height <= 90;
  const spotlightStyle: CSSProperties = isIconLike
    ? (() => {
        const size = Math.max(rect.width, rect.height) + SPOTLIGHT_PAD * 2;
        const cx = rect.left + rect.width / 2;
        const cy = rect.top + rect.height / 2;
        return {
          left: cx - size / 2, top: cy - size / 2, width: size, height: size,
          borderRadius: '9999px',
        };
      })()
    : {
        left: rect.left - SPOTLIGHT_PAD, top: rect.top - SPOTLIGHT_PAD,
        width: rect.width + SPOTLIGHT_PAD * 2, height: rect.height + SPOTLIGHT_PAD * 2,
        borderRadius: 20,
      };

  // Prefer placing the annotation below the target; flip above if there's
  // not enough room (true for the bottom dock, for instance).
  const spotBottom = (spotlightStyle.top as number) + (spotlightStyle.height as number);
  const spotTop = spotlightStyle.top as number;
  const roomBelow = window.innerHeight - spotBottom;
  const placeAbove = roomBelow < 220 && spotTop > 220;
  const tooltipTop = placeAbove ? undefined : spotBottom + 18;
  const tooltipBottom = placeAbove ? window.innerHeight - spotTop + 18 : undefined;

  const spotCenterX = (spotlightStyle.left as number) + (spotlightStyle.width as number) / 2;
  let tooltipLeft = spotCenterX - TOOLTIP_WIDTH / 2;
  tooltipLeft = Math.min(Math.max(tooltipLeft, MARGIN), window.innerWidth - TOOLTIP_WIDTH - MARGIN);

  const isFirst = idx === 0;
  const isLast = idx === steps.length - 1;

  return (
    <div className="fixed inset-0 z-[400]" style={{ fontFamily: 'inherit' }}>
      {/* Darken everything except the spotlight hole */}
      <div
        className="absolute transition-all duration-300 ease-out pointer-events-none"
        style={{
          ...spotlightStyle,
          boxShadow: '0 0 0 9999px rgba(2,2,6,0.95), 0 0 0 3px rgba(167,139,250,0.9), 0 0 44px 10px rgba(167,139,250,0.45)',
        }}
      />
      {/* Click-catcher — absorbs clicks so nothing underneath is interactive
          during the tour, without ending it (only Skip/Escape/arrows do). */}
      <div className="absolute inset-0" onClick={e => e.stopPropagation()} />

      {/* Annotation card */}
      <div
        className="absolute glass-strong rounded-2xl p-5 flex flex-col gap-3 fade-in-tour"
        style={{
          left: tooltipLeft, top: tooltipTop, bottom: tooltipBottom, width: TOOLTIP_WIDTH,
          boxShadow: '0 20px 60px rgba(0,0,0,0.6)',
        }}
        onClick={e => e.stopPropagation()}
      >
        <style>{`@keyframes fadeInTour { from { opacity:0; transform:translateY(6px); } to { opacity:1; transform:translateY(0); } } .fade-in-tour { animation: fadeInTour 0.22s ease-out; }`}</style>

        <div className="flex items-center justify-between">
          <span className="text-[10px] uppercase tracking-[2px] text-white/40">
            Step {idx + 1} / {steps.length}
          </span>
          <button onClick={finish} className="text-[10px] uppercase tracking-[2px] text-white/35 hover:text-white/70 transition-colors">
            Skip tour
          </button>
        </div>

        <h3 className="font-serif text-white text-base font-semibold">{step.title}</h3>

        <ol className="flex flex-col gap-1.5">
          {step.bullets.map((b, i) => (
            <li key={i} className="flex gap-2 text-white/70 text-xs leading-relaxed">
              <span className="text-[#a78bfa] font-semibold flex-shrink-0">{i + 1}.</span>
              <span>{b}</span>
            </li>
          ))}
        </ol>

        <div className="flex items-center justify-between mt-1">
          <button
            onClick={() => advance(idx - 1)}
            disabled={isFirst}
            className="w-9 h-9 flex items-center justify-center rounded-full glass disabled:opacity-20 disabled:cursor-not-allowed hover:bg-white/10 transition-colors"
            title="Back"
          >
            <span className="material-symbols-outlined text-[18px] text-white/80">arrow_back</span>
          </button>

          <div className="flex gap-1">
            {steps.map((_, i) => (
              <span key={i} className="w-1.5 h-1.5 rounded-full" style={{ background: i === idx ? '#a78bfa' : 'rgba(255,255,255,0.15)' }} />
            ))}
          </div>

          <button
            onClick={() => advance(idx + 1)}
            className="w-9 h-9 flex items-center justify-center rounded-full glass-btn hover:opacity-90 transition-opacity"
            title={isLast ? 'Finish' : 'Next'}
          >
            <span className="material-symbols-outlined text-[18px]">
              {isLast ? 'check' : 'arrow_forward'}
            </span>
          </button>
        </div>
      </div>
    </div>
  );
}
