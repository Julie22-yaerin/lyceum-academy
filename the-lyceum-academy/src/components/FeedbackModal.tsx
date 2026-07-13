/**
 * FeedbackModal — star rating + optional comment, shown every 2nd time a
 * student enters the workspace (see App.tsx). Submissions are anonymous:
 * the backend never stores anything that ties a row back to who sent it.
 */
import { useState } from 'react';
import { submitFeedback } from '../lib/api';

export default function FeedbackModal({ onClose }: { onClose: () => void }) {
  const [rating, setRating] = useState(0);
  const [hoverRating, setHoverRating] = useState(0);
  const [comment, setComment] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState('');

  async function handleSubmit() {
    if (rating < 1 || submitting) return;
    setSubmitting(true);
    setError('');
    try {
      await submitFeedback(rating, comment.trim(), 'workspace');
      setDone(true);
      setTimeout(onClose, 1400);
    } catch (e: any) {
      setError(e?.message || 'Could not send feedback — please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[300] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
      <div
        className="glass-strong rounded-2xl p-8 max-w-md w-full flex flex-col gap-5"
        style={{ boxShadow: '0 24px 64px rgba(0,0,0,0.7)' }}
      >
        {done ? (
          <div className="text-center py-4">
            <div className="text-3xl mb-2 text-purple-400">✦</div>
            <p className="font-serif text-white text-lg">Thanks for the feedback</p>
          </div>
        ) : (
          <>
            <div>
              <h2 className="font-serif text-white text-xl font-semibold mb-1">How's it going?</h2>
              <p className="text-white/40 text-xs font-sans uppercase tracking-[2px]">Anonymous — takes 10 seconds</p>
            </div>

            <div className="flex items-center justify-center gap-2">
              {[1, 2, 3, 4, 5].map(n => (
                <button
                  key={n}
                  type="button"
                  onClick={() => setRating(n)}
                  onMouseEnter={() => setHoverRating(n)}
                  onMouseLeave={() => setHoverRating(0)}
                  className="text-3xl leading-none transition-transform hover:scale-110"
                  style={{ color: n <= (hoverRating || rating) ? '#8b5cf6' : 'rgba(255,255,255,0.15)' }}
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
              rows={3}
              className="glass-input rounded-xl p-3 font-sans text-sm resize-none"
            />

            {error && <p className="text-red-400 text-xs font-sans">{error}</p>}

            <div className="flex gap-3">
              <button
                onClick={onClose}
                className="flex-1 rounded-xl border border-white/10 py-3 font-sans text-xs uppercase tracking-[2px] text-white/50 hover:text-white/80 transition-colors"
              >
                Maybe later
              </button>
              <button
                onClick={handleSubmit}
                disabled={rating < 1 || submitting}
                className="flex-[2] glass-btn rounded-xl py-3 font-sans text-xs uppercase tracking-[2px] font-semibold disabled:opacity-30 disabled:cursor-not-allowed"
              >
                {submitting ? 'Sending…' : 'Send feedback'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
