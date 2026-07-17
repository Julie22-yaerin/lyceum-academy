/**
 * ReportBugButton — small "Báo lỗi" icon button in the corner utility cluster.
 *
 * Submits to the backend /ai/agents/dev-patrol/report-bug endpoint, which
 * routes through Commander triage (critical vs minor) exactly like the
 * support consultant's auto-detected complaints.
 *
 * By product decision, the UI always treats submission as a success (even
 * on a network error) — the user is never shown a failure state for a bug
 * report; it always ends in "sent" + a redirect back to the workspace.
 */
import { useState, useRef, useEffect } from 'react';
import { View } from '../types';
import { useTranslation } from '../i18n/I18nContext';

export default function ReportBugButton({ onNavigate }: { onNavigate: (view: View) => void }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [sent, setSent] = useState(false);
  const [description, setDescription] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) close();
    }
    if (open) document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  function close() {
    setOpen(false);
    setSent(false);
    setDescription('');
  }

  async function handleSubmit() {
    if (!description.trim() || submitting) return;
    setSubmitting(true);

    try {
      const API_BASE = (import.meta as any).env?.VITE_API_URL || 'http://localhost:8000';
      await fetch(`${API_BASE}/ai/agents/dev-patrol/report-bug`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ description: description.trim(), page: window.location.pathname }),
      });
    } catch {
      // Intentionally swallowed — reporting a bug must never itself fail
      // in front of the user; the backend also always answers {ok:true}.
    } finally {
      setSubmitting(false);
      setSent(true);
      setTimeout(() => {
        close();
        onNavigate('problem-sets');
      }, 1400);
    }
  }

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-8 h-8 flex items-center justify-center rounded-full opacity-40 hover:opacity-90 hover:bg-white/10 transition-all"
        title={t('dock.reportBug')}
      >
        <span className="material-symbols-outlined text-[16px]">bug_report</span>
      </button>

      {open && (
        <div
          className="absolute bottom-full right-0 mb-2 w-72 glass-strong rounded-2xl z-[200] overflow-hidden"
          style={{ animation: 'fadeDown 0.18s ease-out' }}
        >
          <div className="px-5 py-4 border-b border-white/10 flex items-center justify-between">
            <span className="text-[10px] uppercase tracking-wider text-white/50">{t('reportBug.title')}</span>
            <button onClick={close} className="opacity-30 hover:opacity-80 transition-opacity">
              <span className="material-symbols-outlined text-[14px]">close</span>
            </button>
          </div>

          <div className="px-5 py-4 flex flex-col gap-3">
            {sent ? (
              <p className="text-xs text-emerald-400 text-center py-2">{t('reportBug.success')}</p>
            ) : (
              <>
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder={t('reportBug.placeholder')}
                  rows={4}
                  autoFocus
                  className="w-full rounded-xl bg-white/10 px-3 py-2.5 text-xs text-white placeholder-white/40 outline-none focus:ring-1 focus:ring-orange-500/50 transition-all resize-none"
                />
                <button
                  onClick={handleSubmit}
                  disabled={!description.trim() || submitting}
                  className="rounded-xl bg-orange-500 px-3 py-2 text-xs font-medium text-white transition-all hover:bg-orange-400 disabled:opacity-30 disabled:cursor-not-allowed active:scale-95"
                >
                  {t('reportBug.submit')}
                </button>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
