/**
 * ToolDockContext — which global tool overlay (if any) is open. The tools
 * that used to live inside one specific view (Feynman in Notes, Game
 * Builder in Socrat) are now workspace-wide, reachable from the left-edge
 * ToolDock on every screen.
 */
import { createContext, useContext, useState, type ReactNode } from 'react';

export type ToolId = 'feynman' | 'toolmap' | 'reverse-build' | 'games' | 'spaced-repetition';

interface ToolDockValue {
  activeTool: ToolId | null;
  /** Optional context handed to whichever tool opened it — e.g. a suggested
   * Game Builder sprite prompt from a lesson package's break-game chip. */
  payload: Record<string, unknown> | null;
  openTool: (id: ToolId, payload?: Record<string, unknown>) => void;
  closeTool: () => void;
}

const ToolDockContext = createContext<ToolDockValue>({
  activeTool: null,
  payload: null,
  openTool: () => {},
  closeTool: () => {},
});

export function ToolDockProvider({ children }: { children: ReactNode }) {
  const [activeTool, setActiveTool] = useState<ToolId | null>(null);
  const [payload, setPayload] = useState<Record<string, unknown> | null>(null);
  return (
    <ToolDockContext.Provider value={{
      activeTool,
      payload,
      openTool: (id, p) => { setActiveTool(id); setPayload(p || null); },
      closeTool: () => { setActiveTool(null); setPayload(null); },
    }}>
      {children}
    </ToolDockContext.Provider>
  );
}

export const useToolDock = () => useContext(ToolDockContext);
