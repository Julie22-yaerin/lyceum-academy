/**
 * Hyperfocus — a top-left trigger that takes the whole browser into real
 * Fullscreen API mode (not just a `fixed inset-0` overlay: the tab bar,
 * bookmarks bar, everything the OS/browser chrome would otherwise show is
 * gone too) for a single, undistracted session.
 *
 * On leaving fullscreen — Esc, F11, swiping away, anything — a red warning
 * gate takes over instead of silently dropping back to the normal view.
 * This is NOT a trap: the gate always offers a real "Thoát hẳn" (exit for
 * real) button, exactly as visible as "quay lại tập trung." The point is
 * friction against the reflex exit, not removing the exit — same principle
 * CancelFlow already holds elsewhere in this app.
 *
 * Browser reality check, worth being honest about in the code that reads
 * it later: the Escape key's native "leave fullscreen" behavior cannot be
 * preventDefault()'d — no browser allows a page to block it (that's a
 * deliberate security decision, not a gap in this component). So this
 * doesn't "catch Esc before it fires" — it reacts to `fullscreenchange`
 * after fullscreen has already ended, and immediately re-covers the screen
 * with the warning gate. The gap between "browser exits fullscreen" and
 * "gate appears" is a single event-loop tick, not noticeable in practice.
 */
import { useCallback, useEffect, useState } from 'react';

const KEY = 'lyceum_hyperfocus_active';

export default function HyperfocusButton() {
  const [active, setActive] = useState(false);
  const [warning, setWarning] = useState(false);

  const enter = useCallback(async () => {
    try {
      await document.documentElement.requestFullscreen();
    } catch {
      // Fullscreen can be denied (not called from a user gesture, or the
      // browser/embedder disallows it) — fall back to the focused state
      // without real fullscreen rather than silently doing nothing.
    }
    setActive(true);
    setWarning(false);
    try { sessionStorage.setItem(KEY, '1'); } catch { /* ignore */ }
  }, []);

  const exitForReal = useCallback(() => {
    setActive(false);
    setWarning(false);
    try { sessionStorage.removeItem(KEY); } catch { /* ignore */ }
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
  }, []);

  const returnToFocus = useCallback(() => {
    setWarning(false);
    void enter();
  }, [enter]);

  useEffect(() => {
    function onFullscreenChange() {
      if (!document.fullscreenElement) {
        // Left fullscreen while a Hyperfocus session was still live —
        // Esc, F11, or the browser's own UI. Gate it instead of just
        // returning to the normal workspace.
        setActive(prev => {
          if (prev) setWarning(true);
          return prev;
        });
      }
    }
    document.addEventListener('fullscreenchange', onFullscreenChange);
    return () => document.removeEventListener('fullscreenchange', onFullscreenChange);
  }, []);

  if (warning) {
    return (
      <div className="fixed inset-0 z-[300] bg-red-950/95 backdrop-blur-md flex items-center justify-center p-6">
        <div className="max-w-sm w-full text-center flex flex-col items-center gap-5">
          <span className="material-symbols-outlined text-[44px] text-red-300">warning</span>
          <div>
            <h2 className="font-serif text-2xl text-white mb-2">Đang rời Hyperfocus?</h2>
            <p className="text-sm text-red-200/80 leading-relaxed">
              Bạn vừa thoát toàn màn hình. Nếu chỉ là phản xạ bấm Esc, quay lại tập trung tiếp —
              còn nếu thật sự xong việc, cứ thoát hẳn.
            </p>
          </div>
          <div className="flex flex-col gap-2.5 w-full">
            <button
              onClick={returnToFocus}
              className="rounded-xl px-5 py-3 text-xs uppercase tracking-[2px] bg-white text-red-950 font-bold hover:bg-red-50 transition-colors"
            >
              Quay lại tập trung
            </button>
            <button
              onClick={exitForReal}
              className="rounded-xl px-5 py-3 text-xs uppercase tracking-[2px] bg-transparent text-white border border-white/30 hover:bg-white/10 transition-colors"
            >
              Thoát hẳn
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (active) {
    return (
      <button
        onClick={exitForReal}
        className="fixed top-6 left-6 z-[210] flex items-center gap-1.5 rounded-full bg-black/40 backdrop-blur-sm border border-white/15 px-3.5 py-2 text-[10px] uppercase tracking-[2px] text-white/60 hover:text-white hover:bg-black/55 transition-colors"
      >
        <span className="material-symbols-outlined text-[14px]">close_fullscreen</span>
        Thoát Hyperfocus
      </button>
    );
  }

  return (
    <button
      onClick={enter}
      className="fixed top-6 left-6 z-[210] flex items-center gap-1.5 rounded-full glass px-3.5 py-2 text-[10px] uppercase tracking-[2px] text-white/70 hover:text-white hover:bg-white/10 transition-colors"
      title="Toàn màn hình, một việc tại một thời điểm"
    >
      <span className="material-symbols-outlined text-[14px]">center_focus_strong</span>
      Hyperfocus
    </button>
  );
}
