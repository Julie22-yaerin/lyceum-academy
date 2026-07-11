import { useRef, useState } from 'react';
import type { MouseEvent } from 'react';
import { inspectMindMap, validateToolMap } from '../lib/api';
import { useMindMapGate } from '../lib/useSubscription';
import UpgradePrompt from './UpgradePrompt';

interface MindMapNode {
  id: string;
  label: string;
  x: number;
  y: number;
  color: string;
  role: 'input_a' | 'input_b' | 'systems' | 'output' | 'custom';
  fixed?: boolean;
}

const DEFAULT_COLUMNS = [
  { id: 'given', label: 'Given', color: '#E8F4F8' },
  { id: 'find', label: 'Find', color: '#FFF8E8' },
  { id: 'tools', label: 'Tools', color: '#F0F8E8' },
  { id: 'steps', label: 'Steps', color: '#F8E8F0' },
  { id: 'check', label: 'Check', color: '#E8E8F8' },
];

const NODE_COLORS = ['#FF3D57', '#7C4DFF', '#00B0FF', '#00C875', '#FFAB40', '#9E9E9E'];
const FREE_VIEWBOX = { width: 1000, height: 520 };

function createDefaultFreeNodes(): MindMapNode[] {
  return [
    { id: 'input-a', label: 'Input 1', x: 150, y: 160, color: '#CFE8FF', role: 'input_a', fixed: true },
    { id: 'input-b', label: 'Input 2', x: 150, y: 360, color: '#D7F7E7', role: 'input_b', fixed: true },
    { id: 'systems', label: 'Systems', x: 500, y: 260, color: '#FFE7B8', role: 'systems', fixed: true },
    { id: 'output', label: 'Output', x: 850, y: 260, color: '#E5D5FF', role: 'output', fixed: true },
  ];
}

function makeCustomNode(index: number): MindMapNode {
  const offset = Math.max(0, index - 4);
  return {
    id: `${Date.now()}-${index}`,
    label: 'Custom node',
    x: 250 + Math.random() * 420,
    y: 80 + ((offset % 4) * 90) + Math.random() * 40,
    color: NODE_COLORS[index % NODE_COLORS.length],
    role: 'custom',
  };
}

function Toast({ msg, onDismiss }: { msg: string; onDismiss: () => void }) {
  return (
    <div className="fixed bottom-8 right-8 z-[210] max-w-sm glass-strong rounded-2xl p-4 shadow-xl font-sans text-xs leading-relaxed text-on-surface whitespace-pre-line">
      <button onClick={onDismiss} className="float-right ml-4 opacity-50 hover:opacity-100">✕</button>
      {msg}
    </div>
  );
}

const PLACEHOLDER_LABELS: Partial<Record<MindMapNode['role'], string>> = {
  input_a: 'Input 1',
  input_b: 'Input 2',
  systems: 'Systems',
  output: 'Output',
};

const WRONG_STREAK_BEFORE_AI_SUGGESTION = 3;

function tokenize(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .normalize('NFD').replace(/[̀-ͯ]/g, '') // strip accents
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter(w => w.length > 2)
  );
}

interface StructuralCheckResult {
  pass: boolean;
  location?: 'input' | 'systems' | 'output';
  detail: string;
}

/**
 * The "normal algorithm" pass, run entirely client-side before the paid
 * vision model is ever called (SOC-13): it can only judge what's mechanically
 * checkable — a placeholder block never renamed, or a map whose labels share
 * zero words with the problem prompt. Anything past that is a semantic
 * judgment call the algorithm can't make, so it just reports "wrong" with no
 * location, matching what happens 3 times in a row before "Let AI see" is
 * suggested.
 */
function checkFreeMapStructure(nodes: MindMapNode[], context: string): StructuralCheckResult {
  const requiredRoles: ('input_a' | 'input_b' | 'systems' | 'output')[] = ['input_a', 'input_b', 'systems', 'output'];
  for (const role of requiredRoles) {
    const node = nodes.find(n => n.role === role);
    const location: 'input' | 'systems' | 'output' = role === 'input_a' || role === 'input_b' ? 'input' : role;
    if (!node) {
      return { pass: false, location, detail: `Missing the ${role.replace('_', ' ')} block.` };
    }
    if (node.label.trim() === PLACEHOLDER_LABELS[role]) {
      return {
        pass: false,
        location,
        detail: location === 'input'
          ? `"${node.label}" is still a placeholder — fill in what this problem actually gives you.`
          : location === 'systems'
            ? '"Systems" is still a placeholder — name the tool or method you will apply.'
            : '"Output" is still a placeholder — state what the problem is asking you to find.',
      };
    }
  }

  if (context.trim()) {
    const promptWords = tokenize(context);
    const mapWords = new Set<string>();
    for (const n of nodes) tokenize(n.label).forEach(w => mapWords.add(w));
    let overlap = 0;
    mapWords.forEach(w => { if (promptWords.has(w)) overlap++; });
    if (overlap === 0) {
      return { pass: false, detail: "This doesn't look related to the problem — check your map again." };
    }
  }

  return { pass: true, detail: 'Structure looks complete.' };
}

function formatFindings(result: { summary?: string; findings?: { location: string; issue: string; detail: string }[]; missing?: string[]; suggestions?: string[] }) {
  const lines: string[] = [];
  if (result.summary) lines.push(result.summary);
  if (result.findings?.length) {
    lines.push('');
    lines.push('Findings:');
    for (const item of result.findings.slice(0, 5)) {
      lines.push(`- ${item.location}: ${item.issue} — ${item.detail}`);
    }
  }
  if (result.missing?.length) {
    lines.push('');
    lines.push(`Missing: ${result.missing.join(', ')}`);
  }
  if (result.suggestions?.length) {
    lines.push('');
    lines.push(`Fix: ${result.suggestions[0]}`);
  }
  return lines.join('\n');
}

async function svgToPngDataUrl(svgEl: SVGSVGElement): Promise<string> {
  const serializer = new XMLSerializer();
  const svgClone = svgEl.cloneNode(true) as SVGSVGElement;
  svgClone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  svgClone.setAttribute('xmlns:xlink', 'http://www.w3.org/1999/xlink');

  const width = Math.max(1, svgEl.clientWidth || FREE_VIEWBOX.width);
  const height = Math.max(1, svgEl.clientHeight || FREE_VIEWBOX.height);
  const svgText = serializer.serializeToString(svgClone);
  const svgUrl = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svgText)}`;

  return await new Promise((resolve, reject) => {
    const img = new Image();
    const canvas = document.createElement('canvas');
    const dpr = Math.max(1, window.devicePixelRatio || 1);
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);

    img.onload = () => {
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        reject(new Error('Canvas unavailable'));
        return;
      }
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

/**
 * Mind Map — Tool Map (Given/Find/Tools/Steps/Check scaffold) + Free Map
 * The free map starts with a standard 2-input -> systems -> output layout
 * and allows custom nodes. The "Let AI see" action sends a screenshot to
 * the vision model for structural feedback.
 */
export default function MindMapTool({ context = '', documentId = '' }: { context?: string; documentId?: string }) {
  const { canUse, tier, used, limit, remaining, loading, refetch } = useMindMapGate(documentId);
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<'tool' | 'free'>('free');
  const [showUpgradePrompt, setShowUpgradePrompt] = useState(false);

  const [columns, setColumns] = useState(DEFAULT_COLUMNS.map(c => ({ ...c, items: [] as string[] })));
  const [toolInput, setToolInput] = useState<Record<string, string>>({});
  const [toastMsg, setToastMsg] = useState('');
  const [validating, setValidating] = useState(false);

  const [mmNodes, setMmNodes] = useState<MindMapNode[]>(() => createDefaultFreeNodes());
  const [mmDragging, setMmDragging] = useState<string | null>(null);
  const [mmDragOffset, setMmDragOffset] = useState({ x: 0, y: 0 });
  const [inspecting, setInspecting] = useState(false);
  const [wrongStreak, setWrongStreak] = useState(0);
  const mmSvgRef = useRef<SVGSVGElement>(null);
  const suggestAiSee = wrongStreak >= WRONG_STREAK_BEFORE_AI_SUGGESTION;

  function addItem(colId: string) {
    const val = (toolInput[colId] || '').trim();
    if (!val) return;
    setColumns(cols => cols.map(c => c.id === colId ? { ...c, items: [...c.items, val] } : c));
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

  function addMmNode() {
    setMmNodes(prev => [...prev, makeCustomNode(prev.length)]);
  }

  function resetMmNodes() {
    setMmNodes(createDefaultFreeNodes());
    setWrongStreak(0);
  }

  function handleOk() {
    const result = checkFreeMapStructure(mmNodes, context);
    if (result.pass) {
      setWrongStreak(0);
      setToastMsg('✓ Looks right — structure checks out.');
      return;
    }
    const next = wrongStreak + 1;
    setWrongStreak(next);
    const lines = [`✗ Not quite right${result.location ? ` (${result.location})` : ''}: ${result.detail}`];
    if (next >= WRONG_STREAK_BEFORE_AI_SUGGESTION) {
      lines.push('', `Wrong ${next} times in a row — try "Let AI see" for a closer look.`);
    }
    setToastMsg(lines.join('\n'));
  }

  function startMmDrag(id: string, e: MouseEvent) {
    const node = mmNodes.find(n => n.id === id);
    if (!node || node.fixed || !mmSvgRef.current) return;
    const rect = mmSvgRef.current.getBoundingClientRect();
    setMmDragging(id);
    setMmDragOffset({ x: e.clientX - rect.left - node.x, y: e.clientY - rect.top - node.y });
  }

  function onMmMouseMove(e: MouseEvent) {
    if (!mmDragging || !mmSvgRef.current) return;
    const rect = mmSvgRef.current.getBoundingClientRect();
    const nx = Math.min(FREE_VIEWBOX.width - 60, Math.max(60, e.clientX - rect.left - mmDragOffset.x));
    const ny = Math.min(FREE_VIEWBOX.height - 30, Math.max(30, e.clientY - rect.top - mmDragOffset.y));
    setMmNodes(prev => prev.map(n => n.id === mmDragging ? { ...n, x: nx, y: ny } : n));
  }

  function updateNodeLabel(id: string) {
    const node = mmNodes.find(n => n.id === id);
    const lbl = window.prompt('Rename node:', node?.label || '');
    if (!lbl) return;
    setMmNodes(prev => prev.map(n => n.id === id ? { ...n, label: lbl } : n));
  }

  async function handleAiSee() {
    if (loading) {
      setToastMsg('Checking quota...');
      return;
    }
    if (!canUse) {
      setShowUpgradePrompt(true);
      return;
    }
    const svg = mmSvgRef.current;
    if (!svg) {
      setToastMsg('Mind map canvas is not ready yet.');
      return;
    }

    setInspecting(true);
    try {
      const image = await svgToPngDataUrl(svg);
      const result = await inspectMindMap(image, context, documentId);
      await refetch();
      setWrongStreak(0);
      const remainingText = result.remaining === null ? 'unlimited' : `${result.remaining} left in this PDF`;
      const lines = [formatFindings(result), '', `Quota: ${result.used_in_document}/${result.document_limit ?? '∞'} · ${remainingText}`];
      setToastMsg(lines.filter(Boolean).join('\n'));
    } catch (e: any) {
      setToastMsg(e?.message || 'AI inspection failed.');
    } finally {
      setInspecting(false);
    }
  }

  const defaultNodes = mmNodes.filter(n => n.role !== 'custom');
  const customNodes = mmNodes.filter(n => n.role === 'custom');

  const aiQuotaLabel = loading
    ? 'Checking quota...'
    : limit === null
      ? `AI see: unlimited (${tier})`
      : `AI see: ${used}/${limit} this PDF · ${remaining ?? 0} left`;

  if (!open) {
    return (
      <>
        {showUpgradePrompt && (
          <UpgradePrompt
            feature="mindmap"
            currentTier={tier}
            onClose={() => setShowUpgradePrompt(false)}
          />
        )}
        <button
          onClick={() => setOpen(true)}
          className="fixed bottom-6 left-6 z-40 w-14 h-14 rounded-full glass-strong flex items-center justify-center hover:-translate-y-0.5 transition-transform"
          style={{ boxShadow: '0 8px 24px rgba(0,0,0,0.4)' }}
          title="Mind Map"
        >
          <span className="material-symbols-outlined text-[22px] text-on-surface opacity-80">psychology</span>
        </button>
      </>
    );
  }

  return (
    <>
      <div
        className="fixed bottom-6 left-6 z-40 w-[min(760px,calc(100vw-3rem))] h-[480px] glass-strong mindmap-panel rounded-3xl flex flex-col overflow-hidden"
        style={{ boxShadow: '0 16px 48px rgba(0,0,0,0.5)' }}
      >
        <div className="flex items-center justify-between px-5 py-3 border-b border-outline-variant/20 flex-shrink-0">
          <span className="font-serif text-lg text-on-surface tracking-wide">Mind Map</span>
          <div className="flex items-center gap-3">
            <div className="flex gap-0 rounded-xl overflow-hidden border border-outline-variant/30">
              {(['free', 'tool'] as const).map(t => (
                <button
                  key={t}
                  onClick={() => setTab(t)}
                  className={`px-4 py-1.5 font-sans text-[10px] uppercase tracking-[1.5px] transition-colors ${tab === t ? 'bg-on-surface text-surface' : 'text-on-surface opacity-60 hover:opacity-100'}`}
                >
                  {t === 'free' ? 'Map' : 'Tool'}
                </button>
              ))}
            </div>
            <button onClick={() => setOpen(false)} className="opacity-50 hover:opacity-100 transition-opacity rounded-full">
              <span className="material-symbols-outlined text-[18px]">close</span>
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-hidden">
          {tab === 'tool' && (
            <div className="h-full flex flex-col">
              <div className="flex-1 overflow-x-auto p-3">
                <div className="flex h-full gap-2 min-w-max">
                  {columns.map(col => (
                    <div key={col.id} className="flex flex-col rounded-2xl overflow-hidden min-w-[160px] max-w-[190px]" style={{ background: col.color + '22' }}>
                      <div className="px-3 py-2 border-b border-outline-variant/10">
                        <span className="font-sans text-[9px] uppercase tracking-[1.5px] text-on-surface opacity-80 font-semibold">{col.label}</span>
                      </div>
                      <div className="flex-1 overflow-y-auto p-2 space-y-1.5">
                        {col.items.map((item, i) => (
                          <div key={i} className="glass rounded-lg px-2.5 py-1.5 font-sans text-[11px] text-on-surface flex items-center justify-between group">
                            <span className="flex-1">{item}</span>
                            <button onClick={() => removeItem(col.id, i)} className="opacity-0 group-hover:opacity-100 ml-2 text-on-surface/50 hover:text-on-surface">✕</button>
                          </div>
                        ))}
                      </div>
                      <div className="p-2 border-t border-outline-variant/10">
                        <div className="flex gap-1">
                          <input
                            type="text"
                            value={toolInput[col.id] || ''}
                            onChange={e => setToolInput(ti => ({ ...ti, [col.id]: e.target.value }))}
                            onKeyDown={e => e.key === 'Enter' && addItem(col.id)}
                            placeholder="Add..."
                            className="flex-1 glass-input rounded-lg px-2 py-1.5 font-sans text-[11px] min-w-0"
                          />
                          <button onClick={() => addItem(col.id)} className="px-2 py-1.5 rounded-lg glass-btn font-sans text-xs">+</button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
              <div className="flex-shrink-0 px-4 py-2.5 border-t border-outline-variant/20 flex items-center justify-end">
                <button
                  onClick={validateMap}
                  disabled={validating}
                  className="glass-btn rounded-xl px-5 py-2 font-sans text-[10px] uppercase tracking-[2px] disabled:opacity-40 flex items-center gap-2"
                >
                  {validating
                    ? <div className="w-3 h-3 border border-current/30 border-t-current rounded-full animate-spin" />
                    : <span className="material-symbols-outlined text-[14px]">check_circle</span>}
                  Validate with AI
                </button>
              </div>
            </div>
          )}

          {tab === 'free' && (
            <div className="h-full flex flex-col">
              <div className="flex-1 relative overflow-hidden">
                <svg
                  ref={mmSvgRef}
                  className="w-full h-full"
                  viewBox={`0 0 ${FREE_VIEWBOX.width} ${FREE_VIEWBOX.height}`}
                  onMouseMove={onMmMouseMove}
                  onMouseUp={() => setMmDragging(null)}
                  onMouseLeave={() => setMmDragging(null)}
                >
                  <defs>
                    <marker id="mindmap-arrow" markerWidth="10" markerHeight="10" refX="9" refY="5" orient="auto">
                      <path d="M0,0 L10,5 L0,10 z" fill="rgba(255,255,255,0.25)" />
                    </marker>
                  </defs>

                  <rect x={0} y={0} width={FREE_VIEWBOX.width} height={FREE_VIEWBOX.height} fill="#0b1020" />

                  <line x1={230} y1={160} x2={420} y2={260} stroke="rgba(255,255,255,0.26)" strokeWidth={2} markerEnd="url(#mindmap-arrow)" />
                  <line x1={230} y1={360} x2={420} y2={260} stroke="rgba(255,255,255,0.26)" strokeWidth={2} markerEnd="url(#mindmap-arrow)" />
                  <line x1={580} y1={260} x2={790} y2={260} stroke="rgba(255,255,255,0.26)" strokeWidth={2} markerEnd="url(#mindmap-arrow)" />

                  {defaultNodes.map(node => (
                    <g
                      key={node.id}
                      transform={`translate(${node.x},${node.y})`}
                      onMouseDown={e => startMmDrag(node.id, e)}
                      onDoubleClick={e => { e.stopPropagation(); updateNodeLabel(node.id); }}
                      style={{ cursor: node.fixed ? 'default' : 'move' }}
                    >
                      <rect x={-72} y={-24} width={144} height={48} rx={14} ry={14} fill={node.color} opacity={0.96} />
                      <text
                        textAnchor="middle"
                        dominantBaseline="middle"
                        fontSize={12}
                        fontFamily="Helvetica Neue, sans-serif"
                        fontWeight="700"
                        fill="#101320"
                        style={{ userSelect: 'none', pointerEvents: 'none' }}
                      >
                        {node.label}
                      </text>
                    </g>
                  ))}

                  {customNodes.map(node => (
                    <g
                      key={node.id}
                      transform={`translate(${node.x},${node.y})`}
                      onMouseDown={e => startMmDrag(node.id, e)}
                      onDoubleClick={e => { e.stopPropagation(); updateNodeLabel(node.id); }}
                      style={{ cursor: 'move' }}
                    >
                      <rect x={-64} y={-22} width={128} height={44} rx={12} ry={12} fill={node.color} opacity={0.92} />
                      <text
                        textAnchor="middle"
                        dominantBaseline="middle"
                        fontSize={11}
                        fontFamily="Helvetica Neue, sans-serif"
                        fontWeight="600"
                        fill="#101320"
                        style={{ userSelect: 'none', pointerEvents: 'none' }}
                      >
                        {node.label}
                      </text>
                    </g>
                  ))}
                </svg>
                {mmNodes.length === 0 && (
                  <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                    <p className="font-sans text-xs text-on-surface opacity-30 uppercase tracking-[2px]">Reset the default map to begin</p>
                  </div>
                )}
              </div>

              <div className="flex-shrink-0 px-4 py-2.5 border-t border-outline-variant/20 flex items-center gap-3 flex-wrap">
                <button onClick={addMmNode} className="glass-btn rounded-xl px-4 py-2 font-sans text-[10px] uppercase tracking-[2px] flex items-center gap-2">
                  <span className="material-symbols-outlined text-[14px]">add</span> Add Node
                </button>
                <button onClick={resetMmNodes} className="rounded-xl border border-outline-variant/30 px-4 py-2 font-sans text-[10px] uppercase tracking-[2px] text-on-surface opacity-70 hover:opacity-100 hover:bg-on-surface/5 transition-colors">
                  Reset Default
                </button>
                <button
                  onClick={handleOk}
                  className="rounded-xl bg-on-surface text-surface px-4 py-2 font-sans text-[10px] uppercase tracking-[2px] flex items-center gap-2 hover:opacity-90 transition-opacity"
                  title="Check the map's structure — free, instant, no AI call"
                >
                  <span className="material-symbols-outlined text-[14px]">check</span> OK
                </button>
                <button
                  onClick={handleAiSee}
                  disabled={inspecting}
                  className={`glass-btn rounded-xl px-4 py-2 font-sans text-[10px] uppercase tracking-[2px] flex items-center gap-2 disabled:opacity-40 ${suggestAiSee ? 'ring-2 ring-amber-400 animate-pulse' : ''}`}
                  title={aiQuotaLabel}
                >
                  {inspecting
                    ? <div className="w-3 h-3 border border-current/30 border-t-current rounded-full animate-spin" />
                    : <span className="material-symbols-outlined text-[14px]">visibility</span>}
                  Let AI see
                </button>
                <span className="font-sans text-[10px] text-on-surface opacity-40 ml-auto">{aiQuotaLabel}</span>
              </div>
            </div>
          )}
        </div>
      </div>

      {showUpgradePrompt && (
        <UpgradePrompt
          feature="mindmap"
          currentTier={tier}
          onClose={() => setShowUpgradePrompt(false)}
        />
      )}

      {toastMsg && <Toast msg={toastMsg} onDismiss={() => setToastMsg('')} />}
    </>
  );
}
