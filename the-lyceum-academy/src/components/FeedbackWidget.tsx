/**
 * FeedbackWidget — small, persistent feedback entry point. Mounted on both
 * the landing page and the workspace (MainLayout) so it's always reachable
 * instead of popping up unpredictably. Submissions are anonymous — the
 * backend never stores anything that ties a row back to who sent it, and no
 * sign-in is required (the landing-page mount has no signed-in user at all).
 */
import { useState, useRef, useEffect } from 'react';
import { submitFeedback } from '../lib/api';

export default function FeedbackWidget({ context = 'workspace' }: { context?: string }) {
  const [open, setOpen] = useState(false);
  const [rating, setRating] = useState(0);
  const [hoverRating, setHoverRating] = useState(0);
  const [comment, setComment] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState('');
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  function reset() {
    setRating(0); setHoverRating(0); setComment(''); setDone(false); setError('');
  }

  async function handleSubmit() {
    if (rating < 1 || submitting) return;
    setSubmitting(true);
    setError('');
    try {
      await submitFeedback(rating, comment.trim(), context);
      setDone(true);
      setTimeout(() => { setOpen(false); reset(); }, 1400);
    } catch (e: any) {
      setError(e?.message || 'Could not send feedback — please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div ref={ref} className="fixed bottom-6 left-6 z-[150]">
      {!open && (
        <button
          onClick={() => setOpen(true)}
          className="glass rounded-full px-4 py-2.5 text-[10px] uppercase tracking-[2px] text-white/80 hover:text-white transition-all flex items-center gap-2"
        >
          <span className="material-symbols-outlined text-[15px]">chat_bubble</span>
          Feedback
        </button>
      )}

      {open && (
        <div className="glass-strong rounded-2xl p-5 w-72 flex flex-col gap-4" style={{ boxShadow: '0 16px 48px rgba(0,0,0,0.5)' }}>
          {done ? (
            <div className="text-center py-2">
              <div className="text-2xl mb-1 text-amber-400">✦</div>
              <p className="font-serif text-white text-sm">Thanks for the feedback</p>
            </div>
          ) : (
            <>
              <div className="flex items-start justify-between">
                <div>
                  <h2 className="font-serif text-white text-base font-semibold">How's it going?</h2>
                  <p className="text-white/60 text-[10px] font-sans uppercase tracking-[1.5px] mt-0.5">Anonymous · 10 seconds</p>
                </div>
                <button onClick={() => setOpen(false)} className="opacity-40 hover:opacity-80 transition-opacity">
                  <span className="material-symbols-outlined text-[16px]">close</span>
                </button>
              </div>

              <div className="flex items-center justify-center gap-1.5">
                {[1, 2, 3, 4, 5].map(n => (
                  <button
                    key={n}
                    type="button"
                    onClick={() => setRating(n)}
                    onMouseEnter={() => setHoverRating(n)}
                    onMouseLeave={() => setHoverRating(0)}
                    className="text-2xl leading-none transition-transform hover:scale-110"
                    style={{ color: n <= (hoverRating || rating) ? '#C5A059' : 'var(--color-on-surface-variant)' }}
                    aria-label={`${n} star${n > 1 ? 's' : ''}`}
                  >
                    ★
                  </button>
                ))}
              </div>

              <textarea
                value={comment}
                onChange={e => setComment(e.target.value)}
                placeholder="Anything you'd like us to know? (optional)"
                rows={2}
                className="glass-input rounded-xl p-2.5 font-sans text-xs resize-none"
              />

              {error && <p className="text-red-400 text-[11px] font-sans">{error}</p>}

              <button
                onClick={handleSubmit}
                disabled={rating < 1 || submitting}
                className="glass-btn rounded-xl py-2.5 font-sans text-[10px] uppercase tracking-[2px] font-semibold disabled:opacity-30 disabled:cursor-not-allowed"
              >
                {submitting ? 'Sending…' : 'Send feedback'}
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
