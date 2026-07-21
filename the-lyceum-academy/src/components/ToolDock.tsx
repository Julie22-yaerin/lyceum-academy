/**
 * ToolDock — a vertical, drag-repositionable dock pinned to the left edge
 * of the workspace. Replaces tool-specific placement (Feynman inside
 * Notes, Game Builder inside Socrat): Feynman, Tool Map, Reverse Build,
 * Games, and Spaced Repetition are now reachable from anywhere.
 */
import { useState } from 'react';
import { motion } from 'motion/react';
import { useToolDock, type ToolId } from '../context/ToolDockContext';
import FeynmanTool from './tools/FeynmanTool';
import ToolMapTool from './tools/ToolMapTool';
import ReverseBuildTool from './tools/ReverseBuildTool';
import SpacedRepetitionTool from './tools/SpacedRepetitionTool';
import GameBuilder from './GameBuilder';

const TOOLS: { id: ToolId; icon: string; label: string }[] = [
  { id: 'feynman', icon: 'psychology', label: 'Feynman Technique' },
  { id: 'toolmap', icon: 'account_tree', label: 'Tool Map' },
  { id: 'reverse-build', icon: 'undo', label: 'Reverse Build' },
  { id: 'games', icon: 'sports_esports', label: 'Games' },
  { id: 'spaced-repetition', icon: 'refresh', label: 'Spaced Repetition' },
];

export default function ToolDock() {
  const { activeTool, payload, openTool, closeTool } = useToolDock();
  const [hovered, setHovered] = useState<ToolId | null>(null);

  const activeLabel = TOOLS.find(t => t.id === activeTool)?.label;

  function renderActivePanel() {
    switch (activeTool) {
      case 'feynman': return <FeynmanTool />;
      case 'toolmap': return <ToolMapTool />;
      case 'reverse-build': return <ReverseBuildTool />;
      case 'spaced-repetition': return <SpacedRepetitionTool />;
      case 'games': return <div className="p-1"><GameBuilder seedPrompt={(payload?.seedPrompt as string) || ''} /></div>;
      default: return null;
    }
  }

  return (
    <>
      <motion.div
        drag="y"
        dragConstraints={{ top: -200, bottom: 260 }}
        dragElastic={0.1}
        dragMomentum={false}
        className="fixed left-4 top-1/2 -translate-y-1/2 z-40 dock rounded-2xl p-2 flex flex-col gap-1 cursor-grab active:cursor-grabbing"
        title="Drag to reposition"
      >
        {TOOLS.map(t => (
          <button
            key={t.id}
            onClick={() => openTool(t.id)}
            onMouseEnter={() => setHovered(t.id)}
            onMouseLeave={() => setHovered(null)}
            className={`relative w-11 h-11 flex items-center justify-center rounded-xl transition-colors ${
              activeTool === t.id ? 'bg-purple-400/20 text-purple-200' : 'text-white/60 hover:bg-white/10 hover:text-white/90'
            }`}
          >
            <span className="material-symbols-outlined text-[20px]">{t.icon}</span>
            {hovered === t.id && (
              <span className="pointer-events-none absolute left-full ml-2 whitespace-nowrap glass-strong rounded-lg px-2.5 py-1 text-[11px] text-white/85">
                {t.label}
              </span>
            )}
          </button>
        ))}
      </motion.div>

      {activeTool && (
        <div className="fixed inset-0 z-[190] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4"
          onClick={closeTool}
        >
          <div
            className={`glass-card rounded-3xl w-full ${activeTool === 'games' ? 'max-w-4xl' : 'max-w-lg'} max-h-[85vh] overflow-y-auto`}
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-5 pt-5 pb-2 sticky top-0 bg-inherit">
              <p className="text-sm font-serif text-white">{activeLabel}</p>
              <button onClick={closeTool} className="text-white/40 hover:text-white/80">
                <span className="material-symbols-outlined text-[18px]">close</span>
              </button>
            </div>
            {renderActivePanel()}
          </div>
        </div>
      )}
    </>
  );
}
