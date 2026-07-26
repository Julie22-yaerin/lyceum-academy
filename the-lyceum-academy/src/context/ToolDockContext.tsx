/**
 * ToolDockContext — which global tool overlay (if any) is open. The tools
 * that used to live inside one specific view (Feynman in Notes, Game
 * Builder in Socrat) are now workspace-wide, reachable from the left-edge
 * ToolDock on every screen.
 *
 * Tools are split two ways:
 *   By tier — Tier 1 (standard learning aids) vs Tier 2, high-intensity
 *            "cognitive stress" tools that deliberately overload the senses
 *            (Dark Room, Kinetic Stress, Paradox Engine, Hostile Mode,
 *            Scalpel). Opening one the first time shows a neural-overload
 *            warning the student must accept.
 *   By purpose — theory (understanding a concept: Feynman, Illustrations,
 *            Lotus Map, Sheet of Paper, Podcast, Share Screen) vs practice
 *            (drilling it: Reverse Build, Games, Spaced Repetition, Exercise
 *            Cards, and every Tier 2 tool). See TOOLS in ToolDock.tsx for the
 *            per-tool category and how the dock groups them.
 *
 * Which tools an account may see is curated per-user by the admin+Opus
 * (backend GET /me/tools); the dock filters against that list.
 */
import { createContext, useContext, useState, type ReactNode } from 'react';

export type Tier1ToolId =
  | 'feynman' | 'reverse-build' | 'games' | 'spaced-repetition' | 'illustrations'
  | 'lotus-map' | 'sheet-of-paper' | 'podcast' | 'screen-share' | 'exercise-cards';
export type Tier2ToolId =
  | 'node-map' | 'tactile-friction' | 'shatter' | 'auditory-gating'
  | 'membrane-flow' | 'steric-snap' | 'topo-lock' | 'time-lapse';
export type ToolId = Tier1ToolId | Tier2ToolId;

export const TIER2_TOOLS: Tier2ToolId[] = [
  'node-map', 'tactile-friction', 'shatter', 'auditory-gating',
  'membrane-flow', 'steric-snap', 'topo-lock', 'time-lapse',
];

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
  /** The Floating Podcast lives outside the modal system entirely — it must
   * stay on screen and playable while the student works in another tool
   * (Lotus Map, Sheet of Paper, ...), so it gets its own independent
   * open/seed state instead of going through activeTool. */
  podcastOpen: boolean;
  podcastSeedText: string;
  togglePodcast: (seedText?: string) => void;
  closePodcast: () => void;
}

const ToolDockContext = createContext<ToolDockValue>({
  activeTool: null,
  payload: null,
  openTool: () => {},
  closeTool: () => {},
  podcastOpen: false,
  podcastSeedText: '',
  togglePodcast: () => {},
  closePodcast: () => {},
});

export function ToolDockProvider({ children }: { children: ReactNode }) {
  const [activeTool, setActiveTool] = useState<ToolId | null>(null);
  const [payload, setPayload] = useState<Record<string, unknown> | null>(null);
  const [podcastOpen, setPodcastOpen] = useState(false);
  const [podcastSeedText, setPodcastSeedText] = useState('');
  return (
    <ToolDockContext.Provider value={{
      activeTool,
      payload,
      openTool: (id, p) => { setActiveTool(id); setPayload(p || null); },
      closeTool: () => { setActiveTool(null); setPayload(null); },
      podcastOpen,
      podcastSeedText,
      togglePodcast: (seedText) => {
        if (seedText) setPodcastSeedText(seedText);
        setPodcastOpen(v => !v);
      },
      closePodcast: () => setPodcastOpen(false),
    }}>
      {children}
    </ToolDockContext.Provider>
  );
}

export const useToolDock = () => useContext(ToolDockContext);
