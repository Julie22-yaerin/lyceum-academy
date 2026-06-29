"use client";

import { useEffect, useRef } from "react";

export const DEFAULT_HESITATION_TIMEOUT_MS = 20_000;

export type UseHesitationTimerOptions = {
  /** Re-arms a fresh window whenever this changes (e.g. activeProblem.id). */
  resetKey: string;
  /** Ms of no reported activity before onHesitate fires. */
  timeoutMs?: number;
  /** Called once per armed window when the timer expires. */
  onHesitate: () => void;
  /** Skip arming entirely (e.g. helper already shown, problem already completed). */
  enabled?: boolean;
};

/**
 * Fires `onHesitate` once after `timeoutMs` of inactivity. Call the returned
 * `notifyActivity()` on any meaningful interaction to push the deadline back out.
 * Changing `resetKey` cancels any pending fire and arms a fresh window — it never
 * fires onHesitate as a side effect of the key changing.
 */
export function useHesitationTimer({
  resetKey,
  timeoutMs = DEFAULT_HESITATION_TIMEOUT_MS,
  onHesitate,
  enabled = true
}: UseHesitationTimerOptions) {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onHesitateRef = useRef(onHesitate);
  onHesitateRef.current = onHesitate;

  function arm() {
    if (timerRef.current) clearTimeout(timerRef.current);
    if (!enabled) return;
    timerRef.current = setTimeout(() => onHesitateRef.current(), timeoutMs);
  }

  useEffect(() => {
    arm();
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resetKey, timeoutMs, enabled]);

  function notifyActivity() {
    arm();
  }

  return { notifyActivity };
}
