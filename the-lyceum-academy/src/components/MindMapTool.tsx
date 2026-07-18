import { useRef, useState, useCallback } from 'react';
import type { MouseEvent } from 'react';
import { inspectMindMap, validateToolMap } from '../lib/api';
import { useMindMapGate } from '../lib/useSubscription';
import { useTranslation } from '../i18n/I18nContext';
import UpgradePrompt from './UpgradePrompt';

// ── Types ──────────────────────────────────────────────────────────────────
interface MindMapNode {
  id: string;
  label: string;
  x: number;
  y: number;
  color: string;
  size: 's' | 'm' | 'l';
}

interface MindMapLink {
  id: string;
  from: string;
  to: string;
}

interface ContextMenu {
  nodeId: string | null;
  linkId: string | null;
  x: number;
  y: number;
}

// ── Constants ──────────────────────────────────────────────────────────────
const MAX_LABEL = 50;

const DEFAULT_COLUMNS = [
  { id: 'given', label: 'Given', color: '#E8F4F8' },
  { id: 'find', label: 'Find', color: '#FFF8E8' },
  { id: 'tools', label: 'Tools', color: '#F0F8E8' },
  { id: 'steps', label: 'Steps', color: '#F8E8F0' },
  { id: 'check', label: 'Check', color: '#E8E8F8' },
];

const NODE_PALETTE = [
  '#FF3D57', '#7C4DFF', '#00B0FF', '#00C875',
  '#FFAB40', '#E040FB', '#FF6E40', '#64FFDA',
  '#84FFFF', '#B388FF', '#FF80AB', '#CCFF90',
];

const NODE_SIZES: Record<string, { w: number; h: number; rx: number; fontSize: number }> = {
  s: { w: 100, h: 36, rx: 10, fontSize: 10 },
  m: { w: 140, h: 48, rx: 14, fontSize: 12 },
  l: { w: 180, h: 60, rx: 16, fontSize: 14 },
};

const FREE_VIEWBOX = { width: 1000, height: 520 };

// ── Helpers ────────────────────────────────────────────────────────────────
function uid() { return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`; }

function truncate(s: string, max: number) { return s.length > max ? s.slice(0, max - 1) + '…' : s; }

function Toast({ msg, onDismiss }: { msg: string; onDismiss: () => void }) {
  return (
    <div className="fixed bottom-8 right-8 z-[210] max-w-sm glass-strong rounded-2xl p-4 shadow-xl font-sans text-xs leading-relaxed text-on-surface whitespace-pre-line">
      <button onClick={onDismiss} className="float-right ml-4 opacity-50 hover:opacity-100">✕</button>
      {msg}
    </div>
  );
}

async function svgToPngDataUrl(svgEl: SVGSVGElement): Promise<string> {
  const serializer = new XMLSerializer();
  const svgClone = svgEl.cloneNode(true) as SVGSVGElement;
  svgClone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  const width = Math.max(1, svgEl.clientWidth || FREE_VIEWBOX.width);
  const height = Math.max(1, svgEl.clientHeight || FREE_VIEWBOX.height);
  const svgText = serializer.serializeToString(svgClone);
  const svgUrl = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svgText)}`;
  return new Promise((resolve, reject) => {
    const img = new Image();
    const canvas = document.createElement('canvas');
    const dpr = Math.max(1, window.devicePixelRatio || 1);
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    img.onload = () => {
      const ctx = canvas.getContext('2d');
      if (!ctx) { reject(new Error('Canvas unavailable')); return; }
      ctx.scale(dpr, dpr);
      ctx.fillStyle = '#0b1020';
      ctx.fillRect(0, 0, width, height);
      ctx.drawImage(img, 0, 0, width, height);
      resolve(canvas.toDataURL('image/png'));
    };
    img.onerror = () => reject(new Error('Could not render mind map image'));
    img.src = svgUrl;
  });
}

function tokenize(text: string): Set<string> {
  return new Set(
    text.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(w => w.length > 2)
  );
}

function formatFindings(result: { summary?: string; findings?: { location: string; issue: string; detail: string }[]; missing?: string[]; suggestions?: string[] }) {
  const lines: string[] = [];
  if (result.summary) lines.push(result.summary);
  if (result.findings?.length) {
    lines.push('', 'Findings:');
    for (const item of result.findings.slice(0, 5)) lines.push(`- ${item.location}: ${item.issue} — ${item.detail}`);
  }
  if (result.missing?.length) lines.push('', `Missing: ${result.missing.join(', ')}`);
  if (result.suggestions?.length) lines.push('', `Fix: ${result.suggestions[0]}`);
  return lines.join('\n');
}

// ── Layout: arrange tool items into a mind-map ─────────────────────────────
function layoutToolItems(columns: { id: string; label: string; color: string; items: string[] }[]): MindMapNode[] {
  const nodes: MindMapNode[] = [];
  const colCount = columns.length;
  const colWidth = FREE_VIEWBOX.width / (colCount + 1);

  columns.forEach((col, ci) => {
    const cx = colWidth * (ci + 1);
    const items = col.items.slice(0, 6); // max 6 per column
    const totalH = items.length * 58;
    const startY = (FREE_VIEWBOX.height - totalH) / 2;

    items.forEach((item, ri) => {
      nodes.push({
        id: uid(),
        label: truncate(item, MAX_LABEL),
        x: cx,
        y: startY + ri * 58,
        color: NODE_PALETTE[ci % NODE_PALETTE.length],
        size: 'm',
      });
    });
  });

  return nodes;
}

// ═══════════════════════════════════════════════════════════════════════════
//  COMPONENT
// ═══════════════════════════════════════════════════════════════════════════
export default function MindMapTool({ context = '', documentId = '' }: { context?: string; documentId?: string }) {
  const { t } = useTranslation();
  const { canUse, tier, used, limit, remaining, loading, refetch } = useMindMapGate(documentId);
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<'tool' | 'free'>('tool');
  const [showUpgradePrompt, setShowUpgradePrompt] = useState(false);

  // ── Tool tab state ────────────────────────────────────────────────────
  const [columns, setColumns] = useState(DEFAULT_COLUMNS.map(c => ({ ...c, items: [] as string[] })));
  const [toolInput, setToolInput] = useState<Record<string, string>>({});
  const [validating, setValidating] = useState(false);

  // ── Free map state ────────────────────────────────────────────────────
  const [mmNodes, setMmNodes] = useState<MindMapNode[]>([]);
  const [mmLinks, setMmLinks] = useState<MindMapLink[]>([]);
  const [mmDragging, setMmDragging] = useState<string | null>(null);
  const [mmDragOffset, setMmDragOffset] = useState({ x: 0, y: 0 });
  const [inspecting, setInspecting] = useState(false);
  const [toastMsg, setToastMsg] = useState('');
  const [contextMenu, setContextMenu] = useState<ContextMenu | null>(null);

  // link drawing state: click first node → click second node
  const [linkingFrom, setLinkingFrom] = useState<string | null>(null);

  // editing node inline
  const [editingNode, setEditingNode] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');

  // color picker for selected node
  const [colorPickerNode, setColorPickerNode] = useState<string | null>(null);

  const mmSvgRef = useRef<SVGSVGElement>(null);

  // ── Tool tab helpers ──────────────────────────────────────────────────
  function addItem(colId: string) {
    const val = (toolInput[colId] || '').trim();
    if (!val) return;
    setColumns(cols => cols.map(c => c.id === colId ? { ...c, items: [...c.items, truncate(val, MAX_LABEL)] } : c));
    setToolInput(ti => ({ ...ti, [colId]: '' }));
  }

  function removeItem(colId: string, idx: number) {
    setColumns(cols => cols.map(c => c.id === colId ? { ...c, items: c.items.filter((_, i) => i !== idx) } : c));
  }

  async function validateMap() {
    setValidating(true);
    try {
      const payload = Object.fromEntries(columns.map(c => [c.label, c.items]));
      const result = await validateToolMap(payload);
      setToastMsg(result.feedback);
    } catch (e: any) {
      setToastMsg('Validation error: ' + e.message);
    } finally {
      setValidating(false);
    }
  }

  /** Transfer tool column items → mind map nodes */
  function buildMapFromTool() {
    const total = columns.reduce((s, c) => s + c.items.length, 0);
    if (total === 0) {
      setToastMsg('Add items to the columns first, then build the map.');
      return;
    }
    const nodes = layoutToolItems(columns);
    setMmNodes(nodes);
    setMmLinks([]);
    setTab('free');
    setToastMsg(t('mindmap.mapBuilt', { count: nodes.length }));
  }

  // ── Mind map: node operations ─────────────────────────────────────────
  function addNode() {
    const id = uid();
    setMmNodes(prev => [...prev, {
      id,
      label: 'New node',
      x: 200 + Math.random() * 500,
      y: 80 + Math.random() * 300,
      color: NODE_PALETTE[prev.length % NODE_PALETTE.length],
      size: 'm',
    }]);
  }

  function deleteNode(id: string) {
    setMmNodes(prev => prev.filter(n => n.id !== id));
    setMmLinks(prev => prev.filter(l => l.from !== id && l.to !== id));
    setContextMenu(null);
    setColorPickerNode(null);
  }

  function startDrag(id: string, e: MouseEvent) {
    if (editingNode === id) return;
    const node = mmNodes.find(n => n.id === id);
    if (!node || !mmSvgRef.current) return;
    const rect = mmSvgRef.current.getBoundingClientRect();
    setMmDragging(id);
    setMmDragOffset({ x: e.clientX - rect.left - node.x, y: e.clientY - rect.top - node.y });
  }

  function onMove(e: MouseEvent) {
    if (!mmDragging || !mmSvgRef.current) return;
    const rect = mmSvgRef.current.getBoundingClientRect();
    const nx = Math.min(FREE_VIEWBOX.width - 60, Math.max(60, e.clientX - rect.left - mmDragOffset.x));
    const ny = Math.min(FREE_VIEWBOX.height - 30, Math.max(30, e.clientY - rect.top - mmDragOffset.y));
    setMmNodes(prev => prev.map(n => n.id === mmDragging ? { ...n, x: nx, y: ny } : n));
  }

  function onUp() {
    setMmDragging(null);
    setLinkingFrom(null);
  }

  /** Click on a node: if linking mode, create link; else start linking */
  function onNodeClick(id: string) {
    if (editingNode === id) return;
    if (linkingFrom && linkingFrom !== id) {
      // create link
      const exists = mmLinks.some(l =>
        (l.from === linkingFrom && l.to === id) || (l.from === id && l.to === linkingFrom)
      );
      if (!exists) {
        setMmLinks(prev => [...prev, { id: uid(), from: linkingFrom, to: id }]);
      }
      setLinkingFrom(null);
    } else {
      setLinkingFrom(linkingFrom === id ? null : id);
    }
  }

  /** Double-click → inline edit */
  function onNodeDblClick(id: string) {
    const node = mmNodes.find(n => n.id === id);
    if (!node) return;
    setEditingNode(id);
    setEditValue(node.label);
  }

  function commitEdit(id: string) {
    const trimmed = editValue.trim();
    if (trimmed) {
      setMmNodes(prev => prev.map(n => n.id === id ? { ...n, label: truncate(trimmed, MAX_LABEL) } : n));
    }
    setEditingNode(null);
  }

  function changeNodeColor(id: string, color: string) {
    setMmNodes(prev => prev.map(n => n.id === id ? { ...n, color } : n));
    setColorPickerNode(null);
    setContextMenu(null);
  }

  function changeNodeSize(id: string, size: 's' | 'm' | 'l') {
    setMmNodes(prev => prev.map(n => n.id === id ? { ...n, size } : n));
    setContextMenu(null);
  }

  function deleteLink(id: string) {
    setMmLinks(prev => prev.filter(l => l.id !== id));
    setContextMenu(null);
  }

  // ── Context menu (right-click) ────────────────────────────────────────
  function onNodeContextMenu(e: MouseEvent, id: string) {
    e.preventDefault();
    e.stopPropagation();
    setContextMenu({ nodeId: id, linkId: null, x: e.clientX, y: e.clientY });
  }

  function onSvgContextMenu(e: MouseEvent) {
    e.preventDefault();
    setContextMenu(null);
    setColorPickerNode(null);
  }

  // ── AI see ────────────────────────────────────────────────────────────
  async function handleAiSee() {
    if (loading) { setToastMsg('Checking quota...'); return; }
    if (!canUse) { setShowUpgradePrompt(true); return; }
    const svg = mmSvgRef.current;
    if (!svg) { setToastMsg('Mind map canvas is not ready yet.'); return; }
    setInspecting(true);
    try {
      const image = await svgToPngDataUrl(svg);
      const result = await inspectMindMap(image, context, documentId);
      await refetch();
      const remainingText = result.remaining === null ? 'unlimited' : `${result.remaining} left in this PDF`;
      const lines = [formatFindings(result), '', `Quota: ${result.used_in_document}/${result.document_limit ?? '∞'} · ${remainingText}`];
      setToastMsg(lines.filter(Boolean).join('\n'));
    } catch (e: any) {
      setToastMsg(e?.message || 'AI inspection failed.');
    } finally {
      setInspecting(false);
    }
  }

  const aiQuotaLabel = loading
    ? 'Checking quota...'
    : limit === null
      ? `AI see: unlimited (${tier})`
      : `AI see: ${used}/${limit} this PDF · ${remaining ?? 0} left`;

  // ── Render SVG link between two nodes ─────────────────────────────────
  function renderLink(link: MindMapLink) {
    const a = mmNodes.find(n => n.id === link.from);
    const b = mmNodes.find(n => n.id === link.to);
    if (!a || !b) return null;
    return (
      <line
        key={link.id}
        x1={a.x} y1={a.y} x2={b.x} y2={b.y}
        stroke="rgba(255,255,255,0.3)" strokeWidth={2}
        markerEnd="url(#mindmap-arrow)"
        onContextMenu={e => { e.preventDefault(); e.stopPropagation(); setContextMenu({ nodeId: null, linkId: link.id, x: e.clientX, y: e.clientY }); }}
        style={{ cursor: 'pointer' }}
      />
    );
  }

  // ── Render SVG node ───────────────────────────────────────────────────
  function renderNode(node: MindMapNode) {
    const dim = NODE_SIZES[node.size];
    const isActive = linkingFrom === node.id;
    const isEditing = editingNode === node.id;

    return (
      <g
        key={node.id}
        transform={`translate(${node.x},${node.y})`}
        onMouseDown={e => { e.stopPropagation(); startDrag(node.id, e); }}
        onClick={e => { e.stopPropagation(); onNodeClick(node.id); }}
        onDoubleClick={e => { e.stopPropagation(); onNodeDblClick(node.id); }}
        onContextMenu={e => onNodeContextMenu(e, node.id)}
        style={{ cursor: mmDragging === node.id ? 'grabbing' : 'grab' }}
      >
        {/* glow for linking mode */}
        {isActive && (
          <rect
            x={-dim.w / 2 - 4} y={-dim.h / 2 - 4}
            width={dim.w + 8} height={dim.h + 8}
            rx={dim.rx + 4} ry={dim.rx + 4}
            fill="none" stroke="#7C4DFF" strokeWidth={2.5}
            opacity={0.8}
          />
        )}
        <rect
          x={-dim.w / 2} y={-dim.h / 2}
          width={dim.w} height={dim.h}
          rx={dim.rx} ry={dim.rx}
          fill={node.color} opacity={0.96}
          style={{ filter: 'drop-shadow(0 2px 6px rgba(0,0,0,0.3))' }}
        />
        {isEditing ? (
          <foreignObject x={-dim.w / 2 + 4} y={-dim.h / 2 + 2} width={dim.w - 8} height={dim.h - 4}>
            <input
              type="text"
              autoFocus
              value={editValue}
              onChange={e => setEditValue(e.target.value.slice(0, MAX_LABEL))}
              onBlur={() => commitEdit(node.id)}
              onKeyDown={e => { if (e.key === 'Enter') commitEdit(node.id); if (e.key === 'Escape') setEditingNode(null); }}
              className="w-full h-full bg-white text-[#101320] font-sans font-bold outline-none text-center px-1"
              style={{ fontSize: dim.fontSize }}
            />
          </foreignObject>
        ) : (
          <text
            textAnchor="middle"
            dominantBaseline="middle"
            fontSize={dim.fontSize}
            fontFamily="Helvetica Neue, sans-serif"
            fontWeight="700"
            fill="#101320"
            style={{ userSelect: 'none', pointerEvents: 'none' }}
          >
            {node.label}
          </text>
        )}
      </g>
    );
  }

  // ═════════════════════════════════════════════════════════════════════
  //  CLOSED — floating button
  // ═════════════════════════════════════════════════════════════════════
  if (!open) {
    return (
      <>
        {showUpgradePrompt && (
          <UpgradePrompt feature="mindmap" currentTier={tier} onClose={() => setShowUpgradePrompt(false)} />
        )}
        <button
          onClick={() => setOpen(true)}
          className="fixed bottom-24 left-6 z-40 w-14 h-14 rounded-full glass-strong flex items-center justify-center hover:-translate-y-0.5 transition-transform"
          style={{ boxShadow: '0 8px 24px rgba(0,0,0,0.4)' }}
          title="Mind Map"
        >
          <span className="material-symbols-outlined text-[22px] text-on-surface opacity-80">psychology</span>
        </button>
      </>
    );
  }

  // ═════════════════════════════════════════════════════════════════════
  //  OPEN — panel
  // ═════════════════════════════════════════════════════════════════════
  return (
    <>
      <div
        className="fixed bottom-24 left-6 z-40 w-[min(760px,calc(100vw-3rem))] h-[500px] glass-strong mindmap-panel rounded-3xl flex flex-col overflow-hidden"
        style={{ boxShadow: '0 16px 48px rgba(0,0,0,0.5)' }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-outline-variant/20 flex-shrink-0">
          <span className="font-serif text-lg text-on-surface tracking-wide">Mind Map</span>
          <div className="flex items-center gap-3">
            <div className="flex gap-0 rounded-xl overflow-hidden border border-outline-variant/30">
              {(['tool', 'free'] as const).map(tabKey => (
                <button
                  key={tabKey}
                  onClick={() => setTab(tabKey)}
                  className={`px-4 py-1.5 font-sans text-[10px] uppercase tracking-[1.5px] transition-colors ${tab === tabKey ? 'bg-on-surface text-surface' : 'text-on-surface opacity-60 hover:opacity-100'}`}
                >
                  {tabKey === 'tool' ? t('mindmap.tool') : t('mindmap.map')}
                </button>
              ))}
            </div>
            <button onClick={() => setOpen(false)} className="opacity-50 hover:opacity-100 transition-opacity rounded-full">
              <span className="material-symbols-outlined text-[18px]">close</span>
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-hidden">

          {/* ─── TOOL TAB ──────────────────────────────────────────── */}
          {tab === 'tool' && (
            <div className="h-full flex flex-col">
              <div className="flex-1 overflow-x-auto p-3">
                <div className="flex h-full gap-2 min-w-max">
                  {columns.map(col => (
                    <div key={col.id} className="flex flex-col rounded-2xl overflow-hidden min-w-[160px] max-w-[190px]" style={{ background: col.color + '22' }}>
                      <div className="px-3 py-2 border-b border-outline-variant/10">
                        <span className="font-sans text-[9px] uppercase tracking-[1.5px] text-on-surface opacity-80 font-semibold">{t(`mindmap.${col.id}`)}</span>
                      </div>
                      <div className="flex-1 overflow-y-auto p-2 space-y-1.5">
                        {col.items.map((item, i) => (
                          <div key={i} className="glass rounded-lg px-2.5 py-1.5 font-sans text-[11px] text-on-surface flex items-center justify-between group">
                            <span className="flex-1 truncate" title={item}>{item}</span>
                            <button onClick={() => removeItem(col.id, i)} className="opacity-0 group-hover:opacity-100 ml-2 text-on-surface/50 hover:text-on-surface">✕</button>
                          </div>
                        ))}
                      </div>
                      <div className="p-2 border-t border-outline-variant/10">
                        <div className="flex gap-1">
                          <input
                            type="text"
                            value={toolInput[col.id] || ''}
                            onChange={e => setToolInput(ti => ({ ...ti, [col.id]: e.target.value.slice(0, MAX_LABEL) }))}
                            onKeyDown={e => e.key === 'Enter' && addItem(col.id)}
                            placeholder={t('mindmap.addPlaceholder')}
                            maxLength={MAX_LABEL}
                            className="flex-1 glass-input rounded-lg px-2 py-1.5 font-sans text-[11px] min-w-0"
                          />
                          <button onClick={() => addItem(col.id)} className="px-2 py-1.5 rounded-lg glass-btn font-sans text-xs">+</button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
              <div className="flex-shrink-0 px-4 py-2.5 border-t border-outline-variant/20 flex items-center justify-end gap-2">
                <button
                  onClick={validateMap}
                  disabled={validating}
                  className="glass-btn rounded-xl px-5 py-2 font-sans text-[10px] uppercase tracking-[2px] disabled:opacity-40 flex items-center gap-2"
                >
                  {validating
                    ? <div className="w-3 h-3 border border-current/30 border-t-current rounded-full animate-spin" />
                    : <span className="material-symbols-outlined text-[14px]">check_circle</span>}
                  {t('mindmap.validate')}
                </button>
                <button
                  onClick={buildMapFromTool}
                  className="rounded-xl bg-on-surface text-surface px-5 py-2 font-sans text-[10px] uppercase tracking-[2px] flex items-center gap-2 hover:opacity-90 transition-opacity"
                >
                  <span className="material-symbols-outlined text-[14px]">account_tree</span>
                  {t('mindmap.buildMap')}
                </button>
              </div>
            </div>
          )}

          {/* ─── FREE MAP TAB ──────────────────────────────────────── */}
          {tab === 'free' && (
            <div className="h-full flex flex-col">
              <div className="flex-1 relative overflow-hidden">
                {linkingFrom && (
                  <div className="absolute top-2 left-1/2 -translate-x-1/2 z-10 glass-strong rounded-xl px-4 py-1.5 font-sans text-[10px] uppercase tracking-[1px] text-on-surface/80 flex items-center gap-2">
                    <span className="material-symbols-outlined text-[13px] text-violet-400">link</span>
                    {t('mindmap.clickConnect')}
                    <button onClick={() => setLinkingFrom(null)} className="ml-2 opacity-50 hover:opacity-100">✕</button>
                  </div>
                )}
                <svg
                  ref={mmSvgRef}
                  className="w-full h-full"
                  viewBox={`0 0 ${FREE_VIEWBOX.width} ${FREE_VIEWBOX.height}`}
                  onMouseMove={onMove}
                  onMouseUp={onUp}
                  onMouseLeave={() => { onUp(); setContextMenu(null); setColorPickerNode(null); }}
                  onContextMenu={onSvgContextMenu}
                  onClick={() => { setContextMenu(null); setColorPickerNode(null); }}
                >
                  <defs>
                    <marker id="mindmap-arrow" markerWidth="10" markerHeight="10" refX="9" refY="5" orient="auto">
                      <path d="M0,0 L10,5 L0,10 z" fill="rgba(255,255,255,0.35)" />
                    </marker>
                  </defs>
                  <rect x={0} y={0} width={FREE_VIEWBOX.width} height={FREE_VIEWBOX.height} fill="#0b1020" />

                  {mmLinks.map(renderLink)}
                  {mmNodes.map(renderNode)}
                </svg>

                {mmNodes.length === 0 && (
                  <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none gap-3">
                    <span className="material-symbols-outlined text-[40px] text-on-surface opacity-15">account_tree</span>
                    <p className="font-sans text-xs text-on-surface opacity-30 uppercase tracking-[2px]">{t('mindmap.emptyHint')}</p>
                  </div>
                )}
              </div>

              {/* Bottom toolbar */}
              <div className="flex-shrink-0 px-4 py-2.5 border-t border-outline-variant/20 flex items-center gap-2 flex-wrap">
                <button onClick={addNode} className="glass-btn rounded-xl px-3 py-2 font-sans text-[10px] uppercase tracking-[2px] flex items-center gap-1.5">
                  <span className="material-symbols-outlined text-[13px]">add</span> {t('mindmap.addNode')}
                </button>

                {linkingFrom && (
                  <div className="flex items-center gap-1.5 text-violet-400 font-sans text-[10px]">
                    <span className="material-symbols-outlined text-[13px] animate-pulse">link</span>
                    {t('mindmap.selectTarget')}
                  </div>
                )}

                <div className="ml-auto flex items-center gap-2">
                  <button
                    onClick={handleAiSee}
                    disabled={inspecting}
                    className={`glass-btn rounded-xl px-3 py-2 font-sans text-[10px] uppercase tracking-[2px] flex items-center gap-1.5 disabled:opacity-40`}
                    title={aiQuotaLabel}
                  >
                    {inspecting
                      ? <div className="w-3 h-3 border border-current/30 border-t-current rounded-full animate-spin" />
                      : <span className="material-symbols-outlined text-[13px]">visibility</span>}
                    {t('mindmap.aiSee')}
                  </button>
                  <span className="font-sans text-[10px] text-on-surface opacity-30">{aiQuotaLabel}</span>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ─── Context Menu (right-click on node or link) ───────────── */}
      {contextMenu && (
        <div
          className="fixed z-[220] glass-strong rounded-2xl shadow-2xl p-2 min-w-[180px] font-sans text-[11px]"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          onClick={e => e.stopPropagation()}
        >
          {contextMenu.nodeId && (
            <>
              {/* Edit */}
              <button
                onClick={() => { onNodeDblClick(contextMenu.nodeId!); setContextMenu(null); }}
                className="w-full text-left px-3 py-2 rounded-xl hover:bg-on-surface/10 flex items-center gap-2 transition-colors"
              >
                <span className="material-symbols-outlined text-[14px]">edit</span> {t('mindmap.editLabel')}
              </button>

              {/* Color */}
              <button
                onClick={() => { setColorPickerNode(contextMenu.nodeId); setContextMenu(null); }}
                className="w-full text-left px-3 py-2 rounded-xl hover:bg-on-surface/10 flex items-center gap-2 transition-colors"
              >
                <span className="material-symbols-outlined text-[14px]">palette</span> {t('mindmap.changeColor')}
              </button>

              {/* Size submenu */}
              <div className="px-3 py-1.5 text-[9px] uppercase tracking-[1.5px] text-on-surface/40 mt-1">{t('mindmap.size')}</div>
              {(['s', 'm', 'l'] as const).map(sz => (
                <button
                  key={sz}
                  onClick={() => changeNodeSize(contextMenu.nodeId!, sz)}
                  className="w-full text-left px-3 py-1.5 rounded-xl hover:bg-on-surface/10 flex items-center gap-2 transition-colors"
                >
                  <span className="material-symbols-outlined text-[13px]">
                    {sz === 's' ? 'zoom_out' : sz === 'm' ? 'crop_square' : 'zoom_in'}
                  </span>
                  {sz === 's' ? t('mindmap.small') : sz === 'm' ? t('mindmap.medium') : t('mindmap.large')}
                </button>
              ))}

              <div className="my-1 border-t border-outline-variant/15" />

              {/* Delete */}
              <button
                onClick={() => deleteNode(contextMenu.nodeId!)}
                className="w-full text-left px-3 py-2 rounded-xl hover:bg-red-500/15 text-red-400 flex items-center gap-2 transition-colors"
              >
                <span className="material-symbols-outlined text-[14px]">delete</span> {t('mindmap.deleteNode')}
              </button>
            </>
          )}

          {contextMenu.linkId && (
            <button
              onClick={() => deleteLink(contextMenu.linkId!)}
              className="w-full text-left px-3 py-2 rounded-xl hover:bg-red-500/15 text-red-400 flex items-center gap-2 transition-colors"
            >
              <span className="material-symbols-outlined text-[14px]">link_off</span> {t('mindmap.removeConn')}
            </button>
          )}
        </div>
      )}

      {/* ─── Floating Color Picker ────────────────────────────────── */}
      {colorPickerNode && (
        <div
          className="fixed z-[220] glass-strong rounded-2xl shadow-2xl p-3"
          style={{ left: '50%', top: '50%', transform: 'translate(-50%,-50%)' }}
          onClick={e => e.stopPropagation()}
        >
          <div className="font-sans text-[9px] uppercase tracking-[1.5px] text-on-surface/50 mb-2">Pick color</div>
          <div className="grid grid-cols-6 gap-1.5">
            {NODE_PALETTE.map(c => (
              <button
                key={c}
                onClick={() => changeNodeColor(colorPickerNode, c)}
                className="w-7 h-7 rounded-lg border border-white/10 hover:scale-110 transition-transform"
                style={{ background: c }}
              />
            ))}
          </div>
          <button onClick={() => setColorPickerNode(null)} className="mt-2 w-full text-center font-sans text-[10px] text-on-surface/50 hover:text-on-surface transition-colors">Cancel</button>
        </div>
      )}

      {showUpgradePrompt && (
        <UpgradePrompt feature="mindmap" currentTier={tier} onClose={() => setShowUpgradePrompt(false)} />
      )}
      {toastMsg && <Toast msg={toastMsg} onDismiss={() => setToastMsg('')} />}
    </>
  );
}
