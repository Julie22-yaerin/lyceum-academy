"use client";

/**
 * FeedbackWidget — a small, always-reachable feedback trigger.
 *
 * Renders a tiny "Feedback" pill in the bottom-left corner (kept clear of the
 * left dock and the bottom-right voice orb). Clicking it opens a compact popup
 * with a 1-5 star rating and an optional comment. Submissions are anonymous —
 * the backend never stores a user identifier — and no sign-in is required, so
 * the same widget works on the landing/dashboard and inside the workspace.
 */

import { useEffect, useRef, useState } from "react";
import { MessageCircle, X } from "lucide-react";

import { submitFeedback } from "@/lib/api";

export function FeedbackWidget({ context = "app" }: { context?: string }) {
  const [open, setOpen] = useState(false);
  const [rating, setRating] = useState(0);
  const [hoverRating, setHoverRating] = useState(0);
  const [comment, setComment] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState("");
  const ref = useRef<HTMLDivElement>(null);

  // Close the popup when clicking outside of it.
  useEffect(() => {
    function handler(event: MouseEvent) {
      if (ref.current && !ref.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  function reset() {
    setRating(0);
    setHoverRating(0);
    setComment("");
    setDone(false);
    setError("");
  }

  async function handleSubmit() {
    if (rating < 1 || submitting) return;
    setSubmitting(true);
    setError("");
    try {
      await submitFeedback(rating, comment.trim(), context);
      setDone(true);
      setTimeout(() => {
        setOpen(false);
        reset();
      }, 1400);
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Could not send feedback — please try again."
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div ref={ref} className="fixed bottom-5 left-5 z-[60]">
      {!open && (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="flex items-center gap-2 rounded-full px-4 py-2.5 text-[11px] font-medium uppercase tracking-[0.15em] text-zinc-200 transition-colors hover:border-emerald-500/30 hover:text-emerald-200"
          style={{ background: 'rgba(255,255,255,0.1)', backdropFilter: 'blur(24px)', border: '1px solid rgba(255,255,255,0.2)' }}
        >
          <MessageCircle className="h-3.5 w-3.5" />
          Feedback
        </button>
      )}

      {open && (
        <div className="w-72 rounded-2xl p-5 shadow-[0_16px_48px_rgba(0,0,0,0.5)]" style={{ background: 'rgba(10, 16, 32, 0.97)', backdropFilter: 'blur(40px)', border: '1px solid rgba(255,255,255,0.18)' }}>
          {done ? (
            <div className="py-2 text-center">
              <div className="mb-1 text-2xl text-emerald-400">✦</div>
              <p className="text-sm font-medium text-white">Thanks for the feedback</p>
            </div>
          ) : (
            <div className="flex flex-col gap-4">
              <div className="flex items-start justify-between">
                <div>
                  <h2 className="text-base font-semibold text-white">How&apos;s it going?</h2>
                  <p className="mt-0.5 text-[10px] uppercase tracking-[0.15em] text-zinc-400">
                    Anonymous · 10 seconds
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  className="text-zinc-500 transition-colors hover:text-zinc-200"
                  aria-label="Close feedback"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              <div className="flex items-center justify-center gap-1.5">
                {[1, 2, 3, 4, 5].map((n) => (
                  <button
                    key={n}
                    type="button"
                    onClick={() => setRating(n)}
                    onMouseEnter={() => setHoverRating(n)}
                    onMouseLeave={() => setHoverRating(0)}
                    className="text-2xl leading-none transition-transform hover:scale-110"
                    style={{
                      color: n <= (hoverRating || rating) ? "#10b981" : "rgba(255,255,255,0.3)"
                    }}
                    aria-label={`${n} star${n > 1 ? "s" : ""}`}
                  >
                    ★
                  </button>
                ))}
              </div>

              <textarea
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                placeholder="Anything you'd like us to know? (optional)"
                rows={2}
                className="resize-none rounded-xl p-2.5 text-xs text-zinc-200 placeholder:text-zinc-500 focus:border-emerald-500/40 focus:outline-none"
                style={{ background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.15)' }}
              />

              {error && <p className="text-[11px] text-rose-400">{error}</p>}

              <button
                type="button"
                onClick={handleSubmit}
                disabled={rating < 1 || submitting}
                className="rounded-xl py-2.5 text-[11px] font-semibold uppercase tracking-[0.15em] text-emerald-300 transition-colors disabled:cursor-not-allowed disabled:opacity-30"
                style={{ background: 'linear-gradient(135deg, rgba(16, 185, 129, 0.3), rgba(16, 185, 129, 0.2))', border: '1px solid rgba(16, 185, 129, 0.4)' }}
              >
                {submitting ? "Sending…" : "Send feedback"}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
