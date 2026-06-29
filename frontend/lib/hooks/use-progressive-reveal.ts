"use client";

import { useCallback, useRef, useState } from "react";

export type OptimisticActionStatus = "idle" | "pending" | "done" | "error";

export type UseOptimisticActionOptions<TResult> = {
  /** Runs synchronously on trigger() — update local UI before any async work resolves. */
  onOptimisticUpdate?: () => void;
  /**
   * The actual async work. Phase 1: resolves after a simulated delay with mock data.
   * Phase 2 / backend wiring: replace with a real apiFetch call — call sites don't change.
   */
  action: () => Promise<TResult>;
};

export function useOptimisticAction<TResult>({ onOptimisticUpdate, action }: UseOptimisticActionOptions<TResult>) {
  const [status, setStatus] = useState<OptimisticActionStatus>("idle");
  const [result, setResult] = useState<TResult | null>(null);
  const requestId = useRef(0);

  const trigger = useCallback(async () => {
    const id = ++requestId.current;
    onOptimisticUpdate?.();
    setStatus("pending");
    try {
      const value = await action();
      if (id !== requestId.current) return;
      setResult(value);
      setStatus("done");
    } catch {
      if (id !== requestId.current) return;
      setStatus("error");
    }
  }, [onOptimisticUpdate, action]);

  return { status, result, trigger };
}

/** "Wait N ms then resolve with value" — stand-in for a real backend call. */
export function mockDelay<T>(value: T, ms = 450): Promise<T> {
  return new Promise((resolve) => setTimeout(() => resolve(value), ms));
}
