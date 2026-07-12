import { createContext, useContext, useState, ReactNode } from 'react';
import { loadOpenTabs, saveOpenTabs, loadActiveTab, saveActiveTab } from '../lib/workspace';

interface WorkspaceContextType {
  openTabs: string[];
  activeTab: string | null;
  openTab: (key: string) => void;
  closeTab: (key: string) => void;
  setActiveTab: (key: string) => void;
  /** Seeds tabs in one shot (onboarding completion) and activates the first one. */
  seedTabs: (keys: string[]) => void;
}

const WorkspaceContext = createContext<WorkspaceContextType>({
  openTabs: [],
  activeTab: null,
  openTab: () => {},
  closeTab: () => {},
  setActiveTab: () => {},
  seedTabs: () => {},
});

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const [openTabs, setOpenTabs] = useState<string[]>(() => loadOpenTabs());
  const [activeTab, setActiveTabState] = useState<string | null>(() => loadActiveTab());

  function setActiveTab(key: string) {
    setActiveTabState(key);
    saveActiveTab(key);
  }

  function openTab(key: string) {
    setOpenTabs(prev => {
      if (prev.includes(key)) return prev;
      const next = [...prev, key];
      saveOpenTabs(next);
      return next;
    });
    setActiveTab(key);
  }

  function closeTab(key: string) {
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

  return (
    <WorkspaceContext.Provider value={{ openTabs, activeTab, openTab, closeTab, setActiveTab, seedTabs }}>
      {children}
    </WorkspaceContext.Provider>
  );
}

export const useWorkspace = () => useContext(WorkspaceContext);
