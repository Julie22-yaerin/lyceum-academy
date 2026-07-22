/**
 * ToolDock — a vertical, drag-repositionable dock pinned to the left edge
 * of the workspace. Feynman, Tool Map, Reverse Build, Games, and Spaced
 * Repetition (Tier 1) are reachable from anywhere; below a divider sit the
 * Tier 2 "cognitive stress" tools (Dark Room, Kinetic Stress, Paradox
 * Engine, Hostile Mode, Scalpel), which carry a neural-overload warning on
 * first open.
 *
 * The set of tools an account may see is curated per-user by the admin+Opus
 * (backend GET /me/tools) — the dock only renders tools in that list.
 */
import { useEffect, useState } from 'react';
import { motion } from 'motion/react';
import { useToolDock, isTier2, type ToolId } from '../context/ToolDockContext';
import { getMyTools } from '../lib/lyceumApi';
import FeynmanTool from './tools/FeynmanTool';
import ToolMapTool from './tools/ToolMapTool';
import ReverseBuildTool from './tools/ReverseBuildTool';
import SpacedRepetitionTool from './tools/SpacedRepetitionTool';
import GameBuilder from './GameBuilder';
import DarkRoomTool from './tools/DarkRoomTool';
import KineticStressTool from './tools/KineticStressTool';
import ParadoxEngineTool from './tools/ParadoxEngineTool';
import HostileModeTool from './tools/HostileModeTool';
import ScalpelTool from './tools/ScalpelTool';

interface ToolMeta { id: ToolId; icon: string; label: string; tier: 1 | 2; }

const TOOLS: ToolMeta[] = [
  { id: 'feynman', icon: 'psychology', label: 'Feynman Technique', tier: 1 },
  { id: 'toolmap', icon: 'account_tree', label: 'Tool Map', tier: 1 },
  { id: 'reverse-build', icon: 'undo', label: 'Reverse Build', tier: 1 },
  { id: 'games', icon: 'sports_esports', label: 'Games', tier: 1 },
  { id: 'spaced-repetition', icon: 'refresh', label: 'Spaced Repetition', tier: 1 },
  { id: 'dark-room', icon: 'dark_mode', label: 'Dark Room — Blind Rendering', tier: 2 },
  { id: 'kinetic-stress', icon: 'timer', label: 'Kinetic Stress', tier: 2 },
  { id: 'paradox', icon: 'terminal', label: 'Paradox Engine', tier: 2 },
  { id: 'hostile', icon: 'graphic_eq', label: 'Hostile Environment', tier: 2 },
  { id: 'scalpel', icon: 'content_cut', label: 'Scalpel — Equation Mutilation', tier: 2 },
];

const OVERLOAD_ACK_KEY = 'lyceum_tier2_ack_v1';

export default function ToolDock() {
  const { activeTool, payload, openTool, closeTool } = useToolDock();
  const [hovered, setHovered] = useState<ToolId | null>(null);
  const [allowed, setAllowed] = useState<Set<ToolId> | null>(null);
  const [warnFor, setWarnFor] = useState<ToolId | null>(null);
  const [ackDontShow, setAckDontShow] = useState(false);

  useEffect(() => {
    getMyTools()
      .then(r => setAllowed(new Set(r.tools as ToolId[])))
      // If curation can't be fetched, fall back to tier-1 only.
      .catch(() => setAllowed(new Set(['feynman', 'toolmap', 'reverse-build', 'games', 'spaced-repetition'])));
  }, []);

  const visible = TOOLS.filter(t => !allowed || allowed.has(t.id));
  const tier1 = visible.filter(t => t.tier === 1);
  const tier2 = visible.filter(t => t.tier === 2);
  const activeLabel = TOOLS.find(t => t.id === activeTool)?.label;

  function hasAcked(): boolean {
    try { return localStorage.getItem(OVERLOAD_ACK_KEY) === '1'; } catch { return false; }
  }

  function requestOpen(id: ToolId) {
    if (isTier2(id) && !hasAcked()) { setWarnFor(id); return; }
    openTool(id);
  }

  function confirmWarn() {
    if (ackDontShow) { try { localStorage.setItem(OVERLOAD_ACK_KEY, '1'); } catch { /* quota */ } }
    const id = warnFor; setWarnFor(null);
    if (id) openTool(id);
  }

  function renderActivePanel() {
    switch (activeTool) {
      case 'feynman': return <FeynmanTool />;
      case 'toolmap': return <ToolMapTool />;
      case 'reverse-build': return <ReverseBuildTool />;
      case 'spaced-repetition': return <SpacedRepetitionTool />;
      case 'games': return <div className="p-1"><GameBuilder seedPrompt={(payload?.seedPrompt as string) || ''} /></div>;
      case 'dark-room': return <DarkRoomTool />;
      case 'kinetic-stress': return <KineticStressTool />;
      case 'paradox': return <ParadoxEngineTool />;
      case 'hostile': return <HostileModeTool />;
      case 'scalpel': return <ScalpelTool />;
      default: return null;
    }
  }

  function toolButton(t: ToolMeta) {
    return (
      <button
        key={t.id}
        onClick={() => requestOpen(t.id)}
        onMouseEnter={() => setHovered(t.id)}
        onMouseLeave={() => setHovered(null)}
        className={`relative w-11 h-11 flex items-center justify-center rounded-xl transition-colors ${
          activeTool === t.id
            ? 'bg-purple-400/20 text-purple-200'
            : t.tier === 2
              ? 'text-red-300/70 hover:bg-red-400/10 hover:text-red-200'
              : 'text-white/60 hover:bg-white/10 hover:text-white/90'
        }`}
      >
        <span className="material-symbols-outlined text-[20px]">{t.icon}</span>
        {hovered === t.id && (
          <span className="pointer-events-none absolute left-full ml-2 whitespace-nowrap glass-strong rounded-lg px-2.5 py-1 text-[11px] text-white/85">
            {t.label}{t.tier === 2 && <span className="text-red-300"> · intense</span>}
          </span>
        )}
      </button>
    );
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
        {tier1.map(toolButton)}
        {tier2.length > 0 && (
          <div className="my-1 h-px bg-gradient-to-r from-transparent via-red-400/30 to-transparent" title="Tier 2 — high intensity" />
        )}
        {tier2.map(toolButton)}
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
              <p className="text-sm font-serif text-white">
                {activeLabel}
                {activeTool && isTier2(activeTool) && (
                  <span className="ml-2 text-[10px] uppercase tracking-[2px] text-red-300/80">Tier 2</span>
                )}
              </p>
              <button onClick={closeTool} className="text-white/40 hover:text-white/80">
                <span className="material-symbols-outlined text-[18px]">close</span>
              </button>
            </div>
            {renderActivePanel()}
          </div>
        </div>
      )}

      {/* Neural-overload warning — first open of any Tier 2 tool */}
      {warnFor && (
        <div className="fixed inset-0 z-[200] bg-black/80 backdrop-blur-sm flex items-center justify-center p-4"
          onClick={() => setWarnFor(null)}>
          <div className="glass-card rounded-3xl max-w-md w-full p-7 text-center flex flex-col items-center gap-4"
            onClick={e => e.stopPropagation()}>
            <span className="text-4xl">⚠️</span>
            <h2 className="font-serif text-xl text-white">Công cụ Bậc 2 — Cảnh báo quá tải thần kinh</h2>
            <p className="text-sm text-white/60 leading-relaxed">
              Các công cụ Bậc 2 được thiết kế để <span className="text-red-300">chủ động gây căng thẳng nhận thức</span>:
              tắt hình ảnh, ép thời gian, nhiễu loạn âm thanh bất đối xứng, giao diện thù địch. Chúng có thể gây mệt mỏi,
              khó chịu hoặc quá tải giác quan. Chỉ dùng trong thời gian ngắn, và dừng lại ngay nếu bạn thấy chóng mặt,
              đau đầu hay bất kỳ khó chịu nào.
            </p>
            <label className="flex items-center gap-2 text-xs text-white/50 cursor-pointer">
              <input type="checkbox" checked={ackDontShow} onChange={e => setAckDontShow(e.target.checked)} />
              Tôi hiểu — không hiện lại cảnh báo này
            </label>
            <div className="flex gap-2 w-full pt-1">
              <button onClick={() => setWarnFor(null)}
                className="flex-1 rounded-xl px-4 py-2.5 text-xs uppercase tracking-[2px] bg-white/10 text-white/60 hover:bg-white/20 transition-colors">
                Huỷ
              </button>
              <button onClick={confirmWarn}
                className="flex-1 rounded-xl px-4 py-2.5 text-xs uppercase tracking-[2px] bg-red-400/20 text-red-200 hover:bg-red-400/30 transition-colors">
                Tôi chấp nhận · Mở
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
