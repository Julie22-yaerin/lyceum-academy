import { useState, useRef } from 'react';
import { validateToolMap } from '../lib/api';

const DEFAULT_COLUMNS = [
  { id: 'given', label: 'Given', color: '#E8F4F8' },
  { id: 'find', label: 'Find', color: '#FFF8E8' },
  { id: 'tools', label: 'Tools', color: '#F0F8E8' },
  { id: 'steps', label: 'Steps', color: '#F8E8F0' },
  { id: 'check', label: 'Check', color: '#E8E8F8' },
];

const NODE_COLORS = ['#FF3D57', '#7C4DFF', '#00B0FF', '#00C875', '#FFAB40', '#9E9E9E'];

interface MindMapNode {
  id: string;
  label: string;
  x: number;
  y: number;
  color: string;
}

export default function MindMapOverlay({ onClose }: { onClose: () => void }) {
  const [tab, setTab] = useState<'tool' | 'free'>('tool');

  // Tool Map
  const [columns, setColumns] = useState(DEFAULT_COLUMNS.map(c => ({ ...c, items: [] as string[] })));
  const [toolInput, setToolInput] = useState<Record<string, string>>({});
  const [validating, setValidating] = useState(false);
  const [toastMsg, setToastMsg] = useState('');

  // Free Map
  const [mmNodes, setMmNodes] = useState<MindMapNode[]>([]);
  const [mmDragging, setMmDragging] = useState<string | null>(null);
  const [mmDragOffset, setMmDragOffset] = useState({ x: 0, y: 0 });
  const mmSvgRef = useRef<SVGSVGElement>(null);

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
    const W = mmSvgRef.current?.parentElement?.clientWidth || 600;
    const H = mmSvgRef.current?.parentElement?.clientHeight || 300;
    setMmNodes(prev => [...prev, {
      id: Date.now().toString(),
      label: 'New Idea',
      x: 80 + Math.random() * (W - 200),
      y: 60 + Math.random() * (H - 120),
      color: NODE_COLORS[prev.length % NODE_COLORS.length],
    }]);
  }

  function startMmDrag(id: string, e: React.MouseEvent) {
    const node = mmNodes.find(n => n.id === id);
    if (!node || !mmSvgRef.current) return;
    const rect = mmSvgRef.current.getBoundingClientRect();
    setMmDragging(id);
    setMmDragOffset({ x: e.clientX - rect.left - node.x, y: e.clientY - rect.top - node.y });
  }

  function onMmMouseMove(e: React.MouseEvent) {
    if (!mmDragging || !mmSvgRef.current) return;
    const rect = mmSvgRef.current.getBoundingClientRect();
    const nx = e.clientX - rect.left - mmDragOffset.x;
    const ny = e.clientY - rect.top - mmDragOffset.y;
    setMmNodes(prev => prev.map(n => n.id === mmDragging ? { ...n, x: nx, y: ny } : n));
  }

  return (
    <div className="fixed inset-0 z-50 bg-[#050508]/85 flex items-center justify-center" onClick={onClose}>
      <div className="glass-strong mindmap-panel w-[90vw] h-[85vh] flex flex-col rounded-2xl animate-scale-in"
        onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center justify-between px-8 py-4 border-b border-white/10 flex-shrink-0">
          <span className="font-serif text-xl tracking-[4px] uppercase">Mind Map</span>
          <div className="flex items-center gap-6">
            <div className="flex gap-0 border border-white/10">
              {(['tool', 'free'] as const).map(t => (
                <button key={t} onClick={() => setTab(t)}
                  className={`px-5 py-1.5 font-sans text-[10px] uppercase tracking-[2px] transition-colors ${tab === t ? 'bg-white/10 text-white' : 'text-white/50 hover:bg-white/10'}`}>
                  {t === 'tool' ? '🔧 Tool Map' : '🧠 Free Map'}
                </button>
              ))}
            </div>
            <button onClick={onClose} className="opacity-60 hover:opacity-100 transition-opacity">
              <span className="material-symbols-outlined">close</span>
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-hidden">
          {tab === 'tool' ? (
            <div className="h-full flex flex-col">
              <div className="flex-1 overflow-x-auto">
                <div className="flex h-full gap-0 min-w-max">
                  {columns.map(col => (
                    <div key={col.id} className="flex flex-col border-r border-surface/10 min-w-[180px] max-w-[220px]" style={{ background: col.color + '22' }}>
                      <div className="px-4 py-3 border-b border-surface/10">
                        <span className="font-sans text-[10px] uppercase tracking-[2px] text-white/80 font-semibold">{col.label}</span>
                      </div>
                      <div className="flex-1 overflow-y-auto p-3 space-y-2">
                        {col.items.map((item, i) => (
                          <div key={i} className="glass border border-white/10 px-3 py-2 font-sans text-xs text-white/80 flex items-center justify-between group">
                            <span>{item}</span>
                            <button onClick={() => removeItem(col.id, i)} className="opacity-0 group-hover:opacity-100 ml-2 text-white/40 hover:text-white/80">✕</button>
                          </div>
                        ))}
                      </div>
                      <div className="p-3 border-t border-surface/10">
                        <div className="flex gap-1">
                          <input
                            type="text"
                            value={toolInput[col.id] || ''}
                            onChange={e => setToolInput(ti => ({ ...ti, [col.id]: e.target.value }))}
                            onKeyDown={e => e.key === 'Enter' && addItem(col.id)}
                            placeholder="Add…"
                            className="flex-1 glass-input rounded-lg px-2 py-1.5 font-sans text-xs outline-none min-w-0"
                          />
                          <button onClick={() => addItem(col.id)} className="glass-btn px-2 py-1.5 font-sans text-xs">+</button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
              <div className="flex-shrink-0 px-6 py-3 border-t border-surface/10 flex items-center justify-end">
                <button onClick={validateMap} disabled={validating}
                  className="glass-btn px-6 py-2 font-sans text-[10px] uppercase tracking-[2px] disabled:opacity-40 flex items-center gap-2">
                  {validating
                    ? <div className="w-3 h-3 border border-white/20 border-t-white rounded-full animate-spin" />
                    : <span className="material-symbols-outlined text-[14px]">check_circle</span>}
                  Validate with AI
                </button>
              </div>
            </div>
          ) : (
            <div className="h-full flex flex-col">
              <div className="flex-1 relative overflow-hidden">
                <svg ref={mmSvgRef} className="w-full h-full"
                  onMouseMove={onMmMouseMove}
                  onMouseUp={() => setMmDragging(null)}
                  onMouseLeave={() => setMmDragging(null)}>
                  {mmNodes.length > 1 && mmNodes.slice(1).map((node, i) => (
                    <line key={`e${i}`} x1={mmNodes[0].x} y1={mmNodes[0].y} x2={node.x} y2={node.y} stroke="rgba(255,255,255,0.2)" strokeWidth={1} />
                  ))}
                  {mmNodes.map(node => (
                    <g key={node.id} transform={`translate(${node.x},${node.y})`}
                      onMouseDown={e => startMmDrag(node.id, e)}
                      onDoubleClick={e => { e.stopPropagation(); const lbl = prompt('Rename node:', node.label); if (lbl) setMmNodes(prev => prev.map(n => n.id === node.id ? { ...n, label: lbl } : n)); }}
                      style={{ cursor: 'move' }}>
                      <rect x={-60} y={-20} width={120} height={40} fill={node.color} opacity={0.9} />
                      <text textAnchor="middle" dominantBaseline="middle" fontSize={11}
                        fontFamily="Helvetica Neue, sans-serif" fontWeight="600"
                        fill={node.color === '#1A1A1A' ? '#FDFCF8' : '#1A1A1A'}
                        style={{ userSelect: 'none', pointerEvents: 'none' }}>{node.label}</text>
                    </g>
                  ))}
                </svg>
                {mmNodes.length === 0 && (
                  <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                    <p className="font-sans text-xs text-white/30 uppercase tracking-[2px]">Click "Add Node" to begin</p>
                  </div>
                )}
              </div>
              <div className="flex-shrink-0 px-6 py-3 border-t border-surface/10 flex items-center gap-4">
                <button onClick={addMmNode} className="glass-btn px-5 py-2 font-sans text-[10px] uppercase tracking-[2px] flex items-center gap-2">
                  <span className="material-symbols-outlined text-[14px]">add</span> Add Node
                </button>
                <button onClick={() => setMmNodes([])} className="glass border border-white/10 px-5 py-2 font-sans text-[10px] uppercase tracking-[2px] text-white/70 hover:bg-white/10">Clear</button>
                <span className="font-sans text-[10px] text-white/30 ml-auto">{mmNodes.length} nodes</span>
              </div>
            </div>
          )}
        </div>

        {toastMsg && (
          <div className="absolute bottom-8 right-8 z-[100] max-w-sm glass-strong text-white/90 p-4 shadow-xl font-sans text-xs leading-relaxed">
            <button onClick={() => setToastMsg('')} className="float-right ml-4 opacity-50 hover:opacity-100">✕</button>
            {toastMsg}
          </div>
        )}
      </div>
    </div>
  );
}
