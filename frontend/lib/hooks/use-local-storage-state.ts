"use client";

import { useEffect, useState } from "react";

/**
 * SSR-safe localStorage-backed state. `initialValue` is what both the server
 * render and the first client render produce (no hydration mismatch) — the
 * real localStorage read happens inside a useEffect, client-only, after mount.
 */
export function useLocalStorageState<T>(
  key: string,
  initialValue: T
): [T, (value: T | ((prev: T) => T)) => void, { hydrated: boolean }] {
  const [value, setValue] = useState<T>(initialValue);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(key);
      if (raw !== null) setValue(JSON.parse(raw) as T);
    } catch {
      // Corrupt JSON or storage unavailable (private mode, quota) — keep initialValue.
    } finally {
      setHydrated(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  function update(next: T | ((prev: T) => T)) {
    setValue((prev) => {
      const resolved = typeof next === "function" ? (next as (prev: T) => T)(prev) : next;
      try {
        window.localStorage.setItem(key, JSON.stringify(resolved));
      } catch {
        // Quota exceeded / storage disabled — keep the in-memory value, skip persistence.
      }
      return resolved;
    });
  }

  return [value, update, { hydrated }];
}
