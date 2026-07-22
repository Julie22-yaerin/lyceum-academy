/**
 * ToolDockContext — which global tool overlay (if any) is open. The tools
 * that used to live inside one specific view (Feynman in Notes, Game
 * Builder in Socrat) are now workspace-wide, reachable from the left-edge
 * ToolDock on every screen.
 *
 * Tools are split into two tiers:
 *   Tier 1 — the standard learning aids (Feynman, Tool Map, Reverse Build,
 *            Games, Spaced Repetition).
 *   Tier 2 — high-intensity "cognitive stress" tools that deliberately
 *            overload the senses (Dark Room, Kinetic Stress, Paradox Engine,
 *            Hostile Mode, Scalpel). Opening one the first time shows a
 *            neural-overload warning the student must accept.
 *
 * Which tools an account may see is curated per-user by the admin+Opus
 * (backend GET /me/tools); the dock filters against that list.
 */
import { createContext, useContext, useState, type ReactNode } from 'react';

export type Tier1ToolId = 'feynman' | 'toolmap' | 'reverse-build' | 'games' | 'spaced-repetition';
export type Tier2ToolId = 'dark-room' | 'kinetic-stress' | 'paradox' | 'hostile' | 'scalpel';
export type ToolId = Tier1ToolId | Tier2ToolId;

export const TIER2_TOOLS: Tier2ToolId[] = ['dark-room', 'kinetic-stress', 'paradox', 'hostile', 'scalpel'];

export function isTier2(id: ToolId): id is Tier2ToolId {
  return (TIER2_TOOLS as string[]).includes(id);
}

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
