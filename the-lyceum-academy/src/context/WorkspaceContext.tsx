import { createContext, useContext, useState, ReactNode } from 'react';
import { loadOpenTabs, saveOpenTabs, loadActiveTab, saveActiveTab } from '../lib/workspace';

export interface ActiveLock {
  subjectKey: string;
  until: number; // epoch ms
}

interface WorkspaceContextType {
  openTabs: string[];
  activeTab: string | null;
  activeLock: ActiveLock | null;
  openTab: (key: string) => void;
  closeTab: (key: string) => void;
  setActiveTab: (key: string) => void;
  /** Seeds tabs in one shot (onboarding completion) and activates the first one. */
  seedTabs: (keys: string[]) => void;
  /** Locks the workspace onto `subjectKey` for `minutes` — other tabs can't be switched to until it expires or clearLock() is called. */
  lockUntil: (subjectKey: string, minutes: number) => void;
  clearLock: () => void;
}

const WorkspaceContext = createContext<WorkspaceContextType>({
  openTabs: [],
  activeTab: null,
  activeLock: null,
  openTab: () => {},
  closeTab: () => {},
  setActiveTab: () => {},
  seedTabs: () => {},
  lockUntil: () => {},
  clearLock: () => {},
});

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const [openTabs, setOpenTabs] = useState<string[]>(() => loadOpenTabs());
  const [activeTab, setActiveTabState] = useState<string | null>(() => loadActiveTab());
  const [activeLock, setActiveLock] = useState<ActiveLock | null>(null);

  function isLockedAgainst(key: string): boolean {
    return !!activeLock && activeLock.until > Date.now() && activeLock.subjectKey !== key;
  }

  function setActiveTab(key: string) {
    if (isLockedAgainst(key)) return;
    setActiveTabState(key);
    saveActiveTab(key);
  }

  function openTab(key: string) {
    if (isLockedAgainst(key)) return;
    setOpenTabs(prev => {
      if (prev.includes(key)) return prev;
      const next = [...prev, key];
      saveOpenTabs(next);
      return next;
    });
    setActiveTab(key);
  }

  function closeTab(key: string) {
    if (isLockedAgainst(key)) return;
    setOpenTabs(prev => {
      const idx = prev.indexOf(key);
      if (idx === -1) return prev;
      const next = prev.filter(k => k !== key);
      saveOpenTabs(next);
      if (activeTab === key) {
        const fallback = next[Math.max(0, idx - 1)] ?? next[0] ?? null;
        if (fallback) setActiveTab(fallback);
        else { setActiveTabState(null); }
      }
      return next;
    });
  }

  function seedTabs(keys: string[]) {
    const deduped = Array.from(new Set(keys));
    setOpenTabs(deduped);
    saveOpenTabs(deduped);
    if (deduped[0]) setActiveTab(deduped[0]);
  }

  function lockUntil(subjectKey: string, minutes: number) {
    setActiveLock({ subjectKey, until: Date.now() + minutes * 60 * 1000 });
  }

  function clearLock() {
    setActiveLock(null);
  }

  return (
    <WorkspaceContext.Provider value={{ openTabs, activeTab, activeLock, openTab, closeTab, setActiveTab, seedTabs, lockUntil, clearLock }}>
      {children}
    </WorkspaceContext.Provider>
  );
}

export const useWorkspace = () => useContext(WorkspaceContext);
