import { useEffect, useRef, useState } from 'react';
import { useWorkspace } from '../context/WorkspaceContext';
import { loadSchedule, isBlockLiveNow } from '../lib/schedule';
import { decideScheduleLock } from '../lib/api';

const POLL_MS = 60_000;

/**
 * Watches the saved weekly schedule; when a block goes "live", asks the AI
 * (POST /ai/schedule-decide) whether to auto-open/lock the workspace onto
 * that subject. Mounted once in MainLayout, alongside SubjectTabBar.
 */
export default function ScheduleLockManager() {
  const { activeTab, openTab, lockUntil } = useWorkspace();
  const [toast, setToast] = useState<string | null>(null);
  const lastDecidedFor = useRef<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function tick() {
      const schedule = loadSchedule();
      if (schedule.length === 0) return;
      const now = new Date();
      const live = schedule.find(b => isBlockLiveNow(b, now));
      if (!live) { lastDecidedFor.current = null; return; }
      if (live.subjectKey === activeTab) return;
      // Avoid re-asking every poll for the same still-live block once we've already decided.
      const decisionKey = `${live.id}-${now.toDateString()}`;
      if (lastDecidedFor.current === decisionKey) return;
      lastDecidedFor.current = decisionKey;

      try {
        const decision = await decideScheduleLock(schedule, activeTab, live.subjectKey);
        if (cancelled) return;
        if (decision.allow_switch && decision.recommended_subject) {
          openTab(decision.recommended_subject);
          lockUntil(decision.recommended_subject, decision.lock_minutes || live.durationMinutes);
        }
        if (decision.reason) {
          setToast(decision.reason);
          setTimeout(() => setToast(null), 5000);
        }
      } catch { /* best-effort — schedule lock is a convenience, never blocks the app */ }
    }

    tick();
    const id = setInterval(tick, POLL_MS);
    return () => { cancelled = true; clearInterval(id); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab]);

  if (!toast) return null;

  return (
    <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[250] glass-strong rounded-xl px-4 py-2.5 max-w-sm text-center">
      <span className="font-sans text-xs text-white/80">{toast}</span>
    </div>
  );
}
