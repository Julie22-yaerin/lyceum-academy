import { useState } from 'react';
import { validateToolMap } from '../lib/api';

interface MindMapNode {
  id: string;
  label: string;
  x: number;
  y: number;
  color: string;
}

const DEFAULT_COLUMNS = [
  { id: 'given', label: 'Given', color: '#E8F4F8' },
  { id: 'find', label: 'Find', color: '#FFF8E8' },
  { id: 'tools', label: 'Tools', color: '#F0F8E8' },
  { id: 'steps', label: 'Steps', color: '#F8E8F0' },
  { id: 'check', label: 'Check', color: '#E8E8F8' },
];

const NODE_COLORS = ['#FF3D57', '#7C4DFF', '#00B0FF', '#00C875', '#FFAB40', '#9E9E9E'];

function Toast({ msg, onDismiss }: { msg: string; onDismiss: () => void }) {
  return (
    <div className="fixed bottom-8 right-8 z-[210] max-w-sm glass-strong rounded-2xl p-4 shadow-xl font-sans text-xs leading-relaxed text-on-surface">
      <button onClick={onDismiss} className="float-right ml-4 opacity-50 hover:opacity-100">✕</button>
      {msg}
    </div>
  );
}

/**
 * Mind Map — Tool Map (Given/Find/Tools/Steps/Check scaffold) + Free Map
 * (draggable idea nodes). Collapses to a small round node; expands into a
 * full panel on click. Self-contained so it can be dropped into any view
 * (currently used from the Problem Sets PDF viewer).
 */
export default function MindMapTool() {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<'tool' | 'free'>('tool');

  const [columns, setColumns] = useState(DEFAULT_COLUMNS.map(c => ({ ...c, items: [] as string[] })));
  const [toolInput, setToolInput] = useState<Record<string, string>>({});
  const [toastMsg, setToastMsg] = useState('');
  const [validating, setValidating] = useState(false);

  const [mmNodes, setMmNodes] = useState<MindMapNode[]>([]);
  const [mmDragging, setMmDragging] = useState<string | null>(null);
  const [mmDragOffset, setMmDragOffset] = useState({ x: 0, y: 0 });

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

  function addMmNode(container: HTMLElement | null) {
    const W = container?.clientWidth || 600;
    const H = container?.clientHeight || 300;
    setMmNodes(prev => [...prev, {
      id: Date.now().toString(),
      label: 'New Idea',
      x: 80 + Math.random() * Math.max(1, W - 200),
      y: 60 + Math.random() * Math.max(1, H - 120),
      color: NODE_COLORS[prev.length % NODE_COLORS.length],
    }]);
  }

  function startMmDrag(id: string, e: React.MouseEvent, svgEl: SVGSVGElement | null) {
    const node = mmNodes.find(n => n.id === id);
    if (!node || !svgEl) return;
    const rect = svgEl.getBoundingClientRect();
    setMmDragging(id);
    setMmDragOffset({ x: e.clientX - rect.left - node.x, y: e.clientY - rect.top - node.y });
  }

  function onMmMouseMove(e: React.MouseEvent, svgEl: SVGSVGElement | null) {
    if (!mmDragging || !svgEl) return;
    const rect = svgEl.getBoundingClientRect();
    const nx = e.clientX - rect.left - mmDragOffset.x;
    const ny = e.clientY - rect.top - mmDragOffset.y;
    setMmNodes(prev => prev.map(n => n.id === mmDragging ? { ...n, x: nx, y: ny } : n));
  }

  let mmSvgEl: SVGSVGElement | null = null;
  let mmContainerEl: HTMLDivElement | null = null;

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="fixed bottom-6 left-6 z-40 w-14 h-14 rounded-full glass-strong flex items-center justify-center hover:-translate-y-0.5 transition-transform"
        style={{ boxShadow: '0 8px 24px rgba(0,0,0,0.4)' }}
        title="Mind Map"
      >
        <span className="material-symbols-outlined text-[22px] text-on-surface opacity-80">psychology</span>
      </button>
    );
  }

  return (
    <>
      <div className="fixed bottom-6 left-6 z-40 w-[min(680px,calc(100vw-3rem))] h-[440px] glass-strong rounded-3xl flex flex-col overflow-hidden"
        style={{ boxShadow: '0 16px 48px rgba(0,0,0,0.5)' }}>
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-outline-variant/20 flex-shrink-0">
          <span className="font-serif text-lg text-on-surface tracking-wide">Mind Map</span>
          <div className="flex items-center gap-3">
            <div className="flex gap-0 rounded-xl overflow-hidden border border-outline-variant/30">
              {(['tool', 'free'] as const).map(t => (
                <button
                  key={t}
                  onClick={() => setTab(t)}
                  className={`px-4 py-1.5 font-sans text-[10px] uppercase tracking-[1.5px] transition-colors ${tab === t ? 'bg-on-surface text-surface' : 'text-on-surface opacity-60 hover:opacity-100'}`}
                >
                  {t === 'tool' ? '🔧 Tool' : '🧠 Free'}
                </button>
              ))}
            </div>
            <button onClick={() => setOpen(false)} className="opacity-50 hover:opacity-100 transition-opacity rounded-full">
              <span className="material-symbols-outlined text-[18px]">close</span>
            </button>
          </div>
        </div>

        {/* Content */}
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
                            placeholder="Add…"
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
              <div className="flex-1 relative overflow-hidden" ref={el => { mmContainerEl = el; }}>
                <svg
                  ref={el => { mmSvgEl = el; }}
                  className="w-full h-full"
                  onMouseMove={e => onMmMouseMove(e, mmSvgEl)}
                  onMouseUp={() => setMmDragging(null)}
                  onMouseLeave={() => setMmDragging(null)}
                >
                  {mmNodes.length > 1 && mmNodes.slice(1).map((node, i) => (
                    <line key={`e${i}`} x1={mmNodes[0].x} y1={mmNodes[0].y} x2={node.x} y2={node.y} stroke="rgba(160,165,184,0.3)" strokeWidth={1} />
                  ))}
                  {mmNodes.map(node => (
                    <g key={node.id} transform={`translate(${node.x},${node.y})`}
                      onMouseDown={e => startMmDrag(node.id, e, mmSvgEl)}
                      onDoubleClick={e => { e.stopPropagation(); const lbl = prompt('Rename node:', node.label); if (lbl) setMmNodes(prev => prev.map(n => n.id === node.id ? { ...n, label: lbl } : n)); }}
                      style={{ cursor: 'move' }}>
                      <rect x={-60} y={-20} width={120} height={40} rx={10} ry={10} fill={node.color} opacity={0.9} />
                      <text
                        textAnchor="middle"
                        dominantBaseline="middle"
                        fontSize={11}
                        fontFamily="Helvetica Neue, sans-serif"
                        fontWeight="600"
                        fill="#1A1A1A"
                        style={{ userSelect: 'none', pointerEvents: 'none' }}
                      >
                        {node.label}
                      </text>
                    </g>
                  ))}
                </svg>
                {mmNodes.length === 0 && (
                  <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                    <p className="font-sans text-xs text-on-surface opacity-30 uppercase tracking-[2px]">Click "Add Node" to begin</p>
                  </div>
                )}
              </div>
              <div className="flex-shrink-0 px-4 py-2.5 border-t border-outline-variant/20 flex items-center gap-3">
                <button onClick={() => addMmNode(mmContainerEl)} className="glass-btn rounded-xl px-4 py-2 font-sans text-[10px] uppercase tracking-[2px] flex items-center gap-2">
                  <span className="material-symbols-outlined text-[14px]">add</span> Add Node
                </button>
                <button onClick={() => setMmNodes([])} className="rounded-xl border border-outline-variant/30 px-4 py-2 font-sans text-[10px] uppercase tracking-[2px] text-on-surface opacity-70 hover:opacity-100 hover:bg-on-surface/5 transition-colors">
                  Clear
                </button>
                <span className="font-sans text-[10px] text-on-surface opacity-30 ml-auto">{mmNodes.length} nodes</span>
              </div>
            </div>
          )}
        </div>
      </div>

      {toastMsg && <Toast msg={toastMsg} onDismiss={() => setToastMsg('')} />}
    </>
  );
}
