"use client";

/**
 * Guest progress — short-term, localStorage-backed.
 * Persists until the user clears storage or logs in and syncs.
 *
 * Structure: { [psetId]: { completedIds: string[] } }
 */

import { useCallback, useEffect, useState } from "react";

const STORAGE_KEY = "pclick:guest:progress";

type GuestProgress = Record<string, { completedIds: string[] }>;

function load(): GuestProgress {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as GuestProgress) : {};
  } catch {
    return {};
  }
}

function save(data: GuestProgress) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch {
    // quota exceeded — skip
  }
}

export function useGuestProgress(psetId: string) {
  const [completedIds, setCompletedIds] = useState<Set<string>>(new Set());

  // hydrate from localStorage after mount
  useEffect(() => {
    const all = load();
    const ids = all[psetId]?.completedIds ?? [];
    setCompletedIds(new Set(ids));
  }, [psetId]);

  const markComplete = useCallback(
    (problemId: string) => {
      setCompletedIds((prev) => {
        const next = new Set(prev).add(problemId);
        const all = load();
        all[psetId] = { completedIds: [...next] };
        save(all);
        return next;
      });
    },
    [psetId]
  );

  const clearProgress = useCallback(() => {
    setCompletedIds(new Set());
    const all = load();
    delete all[psetId];
    save(all);
  }, [psetId]);

  return { completedIds, markComplete, clearProgress };
}

/** Returns all guest progress (for sync-on-login) */
export function getAllGuestProgress(): GuestProgress {
  return load();
}

/** Clear everything after successful backend sync */
export function clearAllGuestProgress() {
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
}
