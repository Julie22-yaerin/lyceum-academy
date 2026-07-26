/**
 * ToolDock — a vertical, drag-repositionable dock pinned to the left edge
 * of the workspace, grouped into two stacks:
 *   Lý thuyết (theory) — build or organize understanding: Feynman,
 *     Illustrations, Lotus Map, Sheet of Paper, Podcast, Share Screen.
 *   Thực hành (practice) — drill it: Reverse Build, Games, Spaced
 *     Repetition, Exercise Cards, and — below a second divider — the Tier 2
 *     "cognitive stress" tools (Dark Room, Kinetic Stress, Paradox Engine,
 *     Hostile Mode, Scalpel), which carry a neural-overload warning on first
 *     open. Tier 2 is a practice-intensity tag, not a third category — every
 *     Tier 2 tool is itself a practice tool.
 *
 * The set of tools an account may see is curated per-user by the admin+Opus
 * (backend GET /me/tools) — the dock only renders tools in that list.
 */
import { useEffect, useState } from 'react';
import { motion } from 'motion/react';
import { useToolDock, isTier2, type ToolId } from '../context/ToolDockContext';
import { getMyTools } from '../lib/lyceumApi';
import FeynmanTool from './tools/FeynmanTool';
import ReverseBuildTool from './tools/ReverseBuildTool';
import SpacedRepetitionTool from './tools/SpacedRepetitionTool';
import GameBuilder from './GameBuilder';
import NodeMapTool from './tools/NodeMapTool';
import TactileFrictionTool from './tools/TactileFrictionTool';
import ShatterTool from './tools/ShatterTool';
import AuditoryGatingTool from './tools/AuditoryGatingTool';
import MembraneFlowTool from './tools/MembraneFlowTool';
import StericSnapTool from './tools/StericSnapTool';
import TopoLockTool from './tools/TopoLockTool';
import TimeLapseTool from './tools/TimeLapseTool';
import IllustrationTool from './tools/IllustrationTool';
import LotusMapTool from './tools/LotusMapTool';
import SheetOfPaperTool from './tools/SheetOfPaperTool';
import ScreenShareTool from './tools/ScreenShareTool';
import IllustrationCaptureFlow from './tools/IllustrationCaptureFlow';
import MaterialUploadPanel from './tools/MaterialUploadPanel';
import GalleryPanel from './tools/GalleryPanel';
import ErrorSpottingTool from './tools/ErrorSpottingTool';
import ExerciseCardsTool from './tools/ExerciseCardsTool';

type ToolCategory = 'theory' | 'practice';
const CATEGORY_LABEL: Record<ToolCategory, string> = { theory: 'Lý thuyết', practice: 'Thực hành' };

interface ToolMeta { id: ToolId; icon: string; label: string; tier: 1 | 2; category: ToolCategory; subjects?: string; order?: number }

// Suggested topic order (not enforced — every tool stays reachable
// regardless): 1 Podcast+Whiteboard together, 2 Feynman, 3 Error Spotting,
// 4 Exercise Cards (itself assisted by Reverse Build + Lotus Map). Shown as
// a number badge in the tooltip so the sequence is visible without being a
// gate — this app suggests, it doesn't lock.
const TOOLS: ToolMeta[] = [
  // Lý thuyết — building or organizing understanding of a concept.
  { id: 'podcast', icon: 'podcasts', label: 'Floating Podcast', tier: 1, category: 'theory', order: 1 },
  { id: 'feynman', icon: 'psychology', label: 'Feynman Technique', tier: 1, category: 'theory', order: 2 },
  { id: 'illustrations', icon: 'draw', label: 'Xiaohei Illustrations', tier: 1, category: 'theory' },
  { id: 'lotus-map', icon: 'spa', label: 'Lotus Map', tier: 1, category: 'theory' },
  { id: 'sheet-of-paper', icon: 'edit_note', label: 'Large Sheet of Paper', tier: 1, category: 'theory' },
  { id: 'material-upload', icon: 'upload_file', label: 'Upload tài liệu', tier: 1, category: 'theory' },
  { id: 'gallery', icon: 'photo_library', label: 'Gallery', tier: 1, category: 'theory' },
  { id: 'screen-share', icon: 'screen_share', label: 'Share Screen with AI', tier: 1, category: 'theory' },
  // Thực hành — drilling it: past papers, quizzes, recall, cognitive-stress practice.
  { id: 'error-spotting', icon: 'find_in_page', label: 'Soi lỗi', tier: 1, category: 'practice', order: 3 },
  { id: 'exercise-cards', icon: 'style', label: 'Exercise Cards', tier: 1, category: 'practice', order: 4 },
  { id: 'reverse-build', icon: 'undo', label: 'Reverse Build', tier: 1, category: 'practice' },
  { id: 'games', icon: 'sports_esports', label: 'Games', tier: 1, category: 'practice' },
  { id: 'spaced-repetition', icon: 'refresh', label: 'Spaced Repetition', tier: 1, category: 'practice' },
  { id: 'node-map', icon: 'deployed_code', label: 'Node Mapping 3D', tier: 2, category: 'practice', subjects: 'Vật lý lượng tử · Toán đa biến' },
  { id: 'tactile-friction', icon: 'drag_pan', label: 'Tactile Logic Friction', tier: 2, category: 'practice', subjects: 'Cơ học · Cân bằng hoá học' },
  { id: 'shatter', icon: 'broken_image', label: 'Axiom Destructor', tier: 2, category: 'practice', subjects: 'Nhiệt động lực học · Điện từ' },
  { id: 'auditory-gating', icon: 'graphic_eq', label: 'Auditory Gating', tier: 2, category: 'practice', subjects: 'Toán rời rạc · Giải thuật' },
  { id: 'membrane-flow', icon: 'water_drop', label: 'Purification Sandbox', tier: 2, category: 'practice', subjects: 'Hoá lý · Kỹ thuật hoá học' },
  { id: 'steric-snap', icon: 'hub', label: 'Steric Repulsion', tier: 2, category: 'practice', subjects: 'Hoá hữu cơ' },
  { id: 'topo-lock', icon: 'biotech', label: 'Topological Lock', tier: 2, category: 'practice', subjects: 'Sinh học phân tử · Hoá sinh' },
  { id: 'time-lapse', icon: 'timelapse', label: 'Generative Sandbox', tier: 2, category: 'practice', subjects: 'Sinh thái · Di truyền' },
];

const OVERLOAD_ACK_KEY = 'lyceum_tier2_ack_v1';

type PodcastCompanion = 'whiteboard' | 'lotus-map';

export default function ToolDock() {
  const { activeTool, payload, openTool, closeTool, podcastOpen, togglePodcast, setFocusActive } = useToolDock();
  const [hovered, setHovered] = useState<ToolId | null>(null);
  const [allowed, setAllowed] = useState<Set<ToolId> | null>(null);
  const [warnFor, setWarnFor] = useState<ToolId | null>(null);
  const [ackDontShow, setAckDontShow] = useState(false);
  // Opening the podcast asks which full-page companion to pair it with —
  // the floating player stays on top (z-[250]) while the companion owns the
  // rest of the screen, instead of being crammed into the Tool Dock's
  // max-w-lg modal.
  const [podcastChooserOpen, setPodcastChooserOpen] = useState(false);
  const [podcastCompanion, setPodcastCompanion] = useState<PodcastCompanion | null>(null);
  // Browser-tab-style display: collapsed (a hidden tab peeking off the right
  // edge), popup (a floating window, workspace still visible around it), or
  // fullscreen (the old full takeover). Defaults to popup — least disruptive.
  const [companionDisplay, setCompanionDisplay] = useState<'collapsed' | 'popup' | 'fullscreen'>('popup');
  const [screenShareOpen, setScreenShareOpen] = useState(false);
  const [illustrationFlow, setIllustrationFlow] = useState<'image' | 'video' | null>(null);
  // "Kéo đẩy" — a drag-handle that tucks the whole rail away to a thin peek
  // tab, for when even a slim icon strip feels like clutter. Persisted so a
  // student who hides it doesn't have to re-hide it every session.
  const [railHidden, setRailHidden] = useState(() => {
    try { return localStorage.getItem('lyceum_tooldock_hidden') === '1'; } catch { return false; }
  });
  function toggleRailHidden() {
    setRailHidden(v => {
      try { localStorage.setItem('lyceum_tooldock_hidden', v ? '0' : '1'); } catch { /* ignore */ }
      return !v;
    });
  }

  // Focus mode: any tool that's taken over the screen hides the surrounding
  // chrome (this rail, FloatingDock's bars). Podcast is excluded on purpose
  // — it floats over other work rather than asking for full attention.
  useEffect(() => {
    setFocusActive(!!activeTool || screenShareOpen || !!illustrationFlow);
  }, [activeTool, screenShareOpen, illustrationFlow, setFocusActive]);

  useEffect(() => {
    getMyTools()
      .then(r => setAllowed(new Set(r.tools as ToolId[])))
      // If curation can't be fetched, fall back to tier-1 only.
      .catch(() => setAllowed(new Set([
        'feynman', 'reverse-build', 'games', 'spaced-repetition', 'illustrations',
        'lotus-map', 'sheet-of-paper', 'podcast', 'screen-share', 'exercise-cards', 'material-upload', 'gallery', 'error-spotting',
      ])));
  }, []);

  const visible = TOOLS.filter(t => !allowed || allowed.has(t.id));
  const theoryTools = visible.filter(t => t.category === 'theory');
  const practiceTools = visible.filter(t => t.category === 'practice' && t.tier === 1);
  const practiceIntense = visible.filter(t => t.category === 'practice' && t.tier === 2);
  const activeLabel = TOOLS.find(t => t.id === activeTool)?.label;

  function hasAcked(): boolean {
    try { return localStorage.getItem(OVERLOAD_ACK_KEY) === '1'; } catch { return false; }
  }

  function requestOpen(id: ToolId) {
    // Screen Share owns the whole viewport (capture -> fullscreen crop ->
    // side chat) — it can't live inside the generic centered-card modal
    // every other tool uses.
    if (id === 'screen-share') { setScreenShareOpen(true); return; }
    if (isTier2(id) && !hasAcked()) { setWarnFor(id); return; }
    openTool(id);
  }

  function confirmWarn() {
    if (ackDontShow) { try { localStorage.setItem(OVERLOAD_ACK_KEY, '1'); } catch { /* quota */ } }
    const id = warnFor; setWarnFor(null);
    if (id) openTool(id);
  }

  function podcastClick() {
    if (podcastOpen) { togglePodcast(); setPodcastCompanion(null); return; }
    setPodcastChooserOpen(true);
  }

  function pickPodcastCompanion(companion: PodcastCompanion) {
    setPodcastCompanion(companion);
    setCompanionDisplay('popup');
    setPodcastChooserOpen(false);
    togglePodcast();
  }

  const companionMeta = podcastCompanion === 'whiteboard'
    ? { icon: 'edit_note', label: 'Whiteboard' }
    : { icon: 'spa', label: 'Lotus Map' };
  const companionBody = podcastCompanion === 'whiteboard'
    ? <SheetOfPaperTool />
    : <LotusMapTool seedTopic={(payload?.seedTopic as string) || ''} />;

  function renderActivePanel() {
    switch (activeTool) {
      case 'feynman': return <FeynmanTool />;
      case 'reverse-build': return <ReverseBuildTool />;
      case 'spaced-repetition': return <SpacedRepetitionTool />;
      case 'illustrations': return <IllustrationTool />;
      case 'lotus-map': return <LotusMapTool seedTopic={(payload?.seedTopic as string) || ''} />;
      case 'sheet-of-paper': return <SheetOfPaperTool />;
      case 'material-upload': return <MaterialUploadPanel />;
      case 'gallery': return <GalleryPanel />;
      case 'error-spotting': return <ErrorSpottingTool />;
      case 'exercise-cards': return <ExerciseCardsTool />;
      case 'games': return <div className="p-1"><GameBuilder seedPrompt={(payload?.seedPrompt as string) || ''} /></div>;
      case 'node-map': return <NodeMapTool />;
      case 'tactile-friction': return <TactileFrictionTool />;
      case 'shatter': return <ShatterTool />;
      case 'auditory-gating': return <AuditoryGatingTool />;
      case 'membrane-flow': return <MembraneFlowTool />;
      case 'steric-snap': return <StericSnapTool />;
      case 'topo-lock': return <TopoLockTool />;
      case 'time-lapse': return <TimeLapseTool />;
      default: return null;
    }
  }

  function toolButton(t: ToolMeta) {
    const active = t.id === 'podcast' ? podcastOpen : t.id === 'screen-share' ? screenShareOpen : activeTool === t.id;

    // Illustrations gets a hover flyout instead of a plain tooltip: two new
    // scan-a-region actions (image/video) plus the original paste-text flow,
    // kept as a third option rather than replaced.
    if (t.id === 'illustrations') {
      return (
        <div key={t.id} className="relative" onMouseEnter={() => setHovered(t.id)} onMouseLeave={() => setHovered(null)}>
          <button
            onClick={() => requestOpen(t.id)}
            className={`relative w-10 h-10 flex items-center justify-center rounded-xl transition-colors ${
              active ? 'bg-purple-400/20 text-purple-200' : 'text-white/60 hover:bg-white/10 hover:text-white/90'
            }`}
          >
            <span className="material-symbols-outlined text-[18px]">{t.icon}</span>
          </button>
          {hovered === t.id && (
            <div className="absolute left-full ml-2 top-1/2 -translate-y-1/2 glass-strong rounded-xl p-1.5 flex flex-col gap-1 w-40 z-10">
              <button onClick={() => setIllustrationFlow('image')}
                className="flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-[11px] text-white/80 hover:bg-white/10 text-left transition-colors">
                🖼️ Tạo ảnh
              </button>
              <button onClick={() => setIllustrationFlow('video')}
                className="flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-[11px] text-white/80 hover:bg-white/10 text-left transition-colors">
                🎬 Tạo video
              </button>
              <button onClick={() => requestOpen('illustrations')}
                className="flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-[11px] text-white/80 hover:bg-white/10 text-left transition-colors">
                📝 Từ văn bản
              </button>
            </div>
          )}
        </div>
      );
    }

    return (
      <button
        key={t.id}
        onClick={() => t.id === 'podcast' ? podcastClick() : requestOpen(t.id)}
        onMouseEnter={() => setHovered(t.id)}
        onMouseLeave={() => setHovered(null)}
        className={`relative w-10 h-10 flex items-center justify-center rounded-xl transition-colors ${
          active
            ? 'bg-purple-400/20 text-purple-200'
            : t.tier === 2
              ? 'text-red-300/70 hover:bg-red-400/10 hover:text-red-200'
              : 'text-white/60 hover:bg-white/10 hover:text-white/90'
        }`}
      >
        <span className="material-symbols-outlined text-[18px]">{t.icon}</span>
        {t.order && (
          <span className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-purple-400 text-black text-[9px] font-bold flex items-center justify-center">
            {t.order}
          </span>
        )}
        {hovered === t.id && (
          <span className="pointer-events-none absolute left-full ml-2 whitespace-nowrap glass-strong rounded-lg px-2.5 py-1 text-[11px] text-white/85">
            {t.label}{t.tier === 2 && <span className="text-red-300"> · intense</span>}
            <span className="block text-[10px] text-white/40">
              {t.order ? `Bước ${t.order} gợi ý · ` : ''}{CATEGORY_LABEL[t.category]}{t.subjects && ` · ${t.subjects}`}
            </span>
          </span>
        )}
      </button>
    );
  }

  function groupLabel(text: string) {
    return (
      <p
        className="text-[8px] uppercase tracking-[1.5px] text-white/30 text-center py-0.5 select-none"
        style={{ writingMode: 'vertical-rl' }}
      >
        {text}
      </p>
    );
  }

  // While a tool owns the screen (see the focusActive effect above), the
  // rail itself hides too — activeTool is still set, so the icon that
  // opened it just isn't visible to re-click, which is fine: each tool's
  // own close button is the way back.
  const anyToolActive = !!activeTool || screenShareOpen || !!illustrationFlow;

  return (
    <>
      {!anyToolActive && railHidden && (
        <button
          onClick={toggleRailHidden}
          className="fixed left-0 top-1/2 -translate-y-1/2 z-40 flex items-center justify-center w-4 h-14 rounded-r-xl bg-white/5 hover:bg-white/10 text-white/30 hover:text-white/60 transition-colors"
          title="Hiện thanh công cụ"
        >
          <span className="material-symbols-outlined text-[14px]">chevron_right</span>
        </button>
      )}

      {!anyToolActive && !railHidden && (
      <motion.div
        drag="y"
        dragConstraints={{ top: -200, bottom: 260 }}
        dragElastic={0.1}
        dragMomentum={false}
        className="fixed left-4 top-1/2 -translate-y-1/2 z-40 dock rounded-2xl p-2 flex flex-col gap-1"
      >
        <div
          onClick={toggleRailHidden}
          className="flex items-center justify-center h-4 -mt-1 mb-0.5 cursor-grab active:cursor-grabbing text-white/20 hover:text-white/50 transition-colors"
          title="Kéo/bấm để ẩn thanh công cụ"
        >
          <span className="material-symbols-outlined text-[14px]">drag_indicator</span>
        </div>

        {theoryTools.length > 0 && groupLabel('Lý thuyết')}
        {theoryTools.map(toolButton)}

        {practiceTools.length + practiceIntense.length > 0 && (
          <div className="my-1 h-px bg-gradient-to-r from-transparent via-white/20 to-transparent" />
        )}
        {(practiceTools.length > 0 || practiceIntense.length > 0) && groupLabel('Thực hành')}
        {practiceTools.map(toolButton)}

        {practiceIntense.length > 0 && (
          <div className="my-1 h-px bg-gradient-to-r from-transparent via-red-400/30 to-transparent" title="Tier 2 — high intensity" />
        )}
        {practiceIntense.map(toolButton)}
      </motion.div>
      )}

      {activeTool && (
        <div className="fixed inset-0 z-[190] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4"
          onClick={closeTool}
        >
          <div
            className={`glass-card rounded-3xl w-full ${
              activeTool === 'games' || activeTool === 'sheet-of-paper' || activeTool === 'screen-share' ? 'max-w-4xl'
                : activeTool && isTier2(activeTool) ? 'max-w-2xl' : 'max-w-lg'
            } max-h-[85vh] overflow-y-auto`}
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

      {/* Podcast companion picker — shown once, right when the podcast opens */}
      {podcastChooserOpen && (
        <div className="fixed inset-0 z-[200] bg-black/70 backdrop-blur-sm flex items-center justify-center p-4"
          onClick={() => setPodcastChooserOpen(false)}>
          <div className="glass-card rounded-3xl max-w-md w-full p-7 text-center flex flex-col items-center gap-5"
            onClick={e => e.stopPropagation()}>
            <span className="material-symbols-outlined text-[32px] text-purple-200">podcasts</span>
            <div>
              <h2 className="font-serif text-xl text-white mb-1.5">Nghe kèm việc gì?</h2>
              <p className="text-sm text-white/55 leading-relaxed">
                Podcast sẽ nổi trên màn hình trong lúc bạn làm việc ở đây — chọn một cái.
              </p>
            </div>
            <div className="grid grid-cols-2 gap-3 w-full">
              <button onClick={() => pickPodcastCompanion('whiteboard')}
                className="flex flex-col items-center gap-2 rounded-2xl p-5 bg-white/5 hover:bg-white/10 border border-white/10 hover:border-white/25 transition-colors">
                <span className="material-symbols-outlined text-[24px] text-white/80">edit_note</span>
                <span className="text-xs text-white/85">Whiteboard</span>
                <span className="text-[10px] text-white/40">Toàn trang</span>
              </button>
              <button onClick={() => pickPodcastCompanion('lotus-map')}
                className="flex flex-col items-center gap-2 rounded-2xl p-5 bg-white/5 hover:bg-white/10 border border-white/10 hover:border-white/25 transition-colors">
                <span className="material-symbols-outlined text-[24px] text-white/80">spa</span>
                <span className="text-xs text-white/85">Lotus Map</span>
                <span className="text-[10px] text-white/40">Toàn trang</span>
              </button>
            </div>
            <button onClick={() => setPodcastChooserOpen(false)} className="text-[11px] text-white/40 hover:text-white/70">
              Huỷ
            </button>
          </div>
        </div>
      )}

      {/* Podcast companion — a hidden right-edge tab (collapsed), a floating
          popup window, or a fullscreen takeover, switchable like browser
          tab modes. Sits under the floating podcast (z-[250] > z-[175]). */}
      {podcastOpen && podcastCompanion && companionDisplay === 'collapsed' && (
        <button
          onClick={() => setCompanionDisplay('popup')}
          className="fixed right-0 top-1/2 -translate-y-1/2 z-[175] flex flex-col items-center gap-1 bg-[#12141c] border border-white/10 border-r-0 rounded-l-2xl px-2 py-3 hover:bg-[#1a1d28] transition-colors"
          title={`Mở lại ${companionMeta.label}`}
        >
          <span className="material-symbols-outlined text-[18px] text-white/60">{companionMeta.icon}</span>
          <span className="text-[9px] uppercase tracking-[1.5px] text-white/40" style={{ writingMode: 'vertical-rl' }}>
            {companionMeta.label}
          </span>
        </button>
      )}

      {podcastOpen && podcastCompanion && companionDisplay === 'popup' && (
        <div className="fixed top-20 right-6 z-[175] w-[420px] max-h-[65vh] bg-[#0a0c14] border border-white/10 rounded-2xl shadow-2xl flex flex-col overflow-hidden">
          <div className="flex items-center justify-between px-4 py-2.5 border-b border-white/10 shrink-0">
            <p className="text-xs font-serif text-white flex items-center gap-1.5">
              <span className="material-symbols-outlined text-[16px] text-white/60">{companionMeta.icon}</span>
              {companionMeta.label}
            </p>
            <div className="flex items-center gap-2.5">
              <button onClick={() => setCompanionDisplay('collapsed')} title="Ẩn xuống tab" className="text-white/40 hover:text-white/80">
                <span className="material-symbols-outlined text-[15px]">remove</span>
              </button>
              <button onClick={() => setCompanionDisplay('fullscreen')} title="Toàn màn hình" className="text-white/40 hover:text-white/80">
                <span className="material-symbols-outlined text-[15px]">open_in_full</span>
              </button>
              <button onClick={() => setPodcastCompanion(null)} title="Đóng" className="text-white/40 hover:text-white/80">
                <span className="material-symbols-outlined text-[15px]">close</span>
              </button>
            </div>
          </div>
          <div className="overflow-y-auto">{companionBody}</div>
        </div>
      )}

      {podcastOpen && podcastCompanion && companionDisplay === 'fullscreen' && (
        <div className="fixed inset-0 z-[175] bg-[#0a0c14] overflow-y-auto">
          <div className="flex items-center justify-between px-6 py-4 sticky top-0 bg-[#0a0c14]/95 backdrop-blur-sm border-b border-white/10 z-10">
            <p className="text-sm font-serif text-white flex items-center gap-2">
              <span className="material-symbols-outlined text-[18px] text-white/60">{companionMeta.icon}</span>
              {companionMeta.label}
            </p>
            <div className="flex items-center gap-3">
              <button onClick={() => setCompanionDisplay('popup')} title="Thu về popup" className="text-white/40 hover:text-white/80">
                <span className="material-symbols-outlined text-[18px]">close_fullscreen</span>
              </button>
              <button onClick={() => setCompanionDisplay('collapsed')} title="Ẩn xuống tab" className="text-white/40 hover:text-white/80">
                <span className="material-symbols-outlined text-[18px]">remove</span>
              </button>
              <button onClick={() => setPodcastCompanion(null)} className="text-white/40 hover:text-white/80 flex items-center gap-1 text-[11px] uppercase tracking-[1.5px]">
                Đóng <span className="material-symbols-outlined text-[16px]">close</span>
              </button>
            </div>
          </div>
          <div className="max-w-5xl mx-auto p-6">{companionBody}</div>
        </div>
      )}

      {/* Share Screen with AI — owns the whole viewport, not the generic modal */}
      {screenShareOpen && <ScreenShareTool onClose={() => setScreenShareOpen(false)} />}

      {/* Illustration hover flyout's scan-a-region actions */}
      {illustrationFlow && <IllustrationCaptureFlow mode={illustrationFlow} onClose={() => setIllustrationFlow(null)} />}

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
