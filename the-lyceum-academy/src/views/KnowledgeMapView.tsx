/* eslint-disable @typescript-eslint/no-explicit-any */
import { useState, useEffect, useRef, useCallback } from 'react';
import * as d3 from 'd3';
import { generateGraph, getNodeSummary, validateToolMap } from '../lib/api';
import { loadKaTeX, renderMath } from '../lib/math';
import { loadGraphs, saveGraph, deleteGraph, timeAgo, type SavedGraph } from '../lib/persist';

// ── Types ─────────────────────────────────────────────────────────────────
interface GraphNode extends d3.SimulationNodeDatum {
  id: string;
  label: string;
  group?: string;
}
interface GraphEdge extends d3.SimulationLinkDatum<GraphNode> {
  source: string | GraphNode;
  target: string | GraphNode;
}
interface MindMapNode {
  id: string;
  label: string;
  x: number;
  y: number;
  color: string;
}

// ── Group color map — vivid, hierarchical by importance ──────────────────
interface GroupStyle { fill: string; r: number }
const GROUP_STYLES: Record<string, GroupStyle> = {
  core:        { fill: '#FF3D57', r: 20 },  // red   — most central, largest
  theorem:     { fill: '#7C4DFF', r: 16 },  // violet
  concept:     { fill: '#00B0FF', r: 15 },  // sky blue
  method:      { fill: '#00C875', r: 14 },  // emerald
  application: { fill: '#FFAB40', r: 13 },  // amber
  default:     { fill: '#9E9E9E', r: 12 },  // gray
};
function gStyle(group?: string): GroupStyle {
  return GROUP_STYLES[group || 'default'] ?? GROUP_STYLES.default;
}

const TOPIC_CHIPS = [
  'Calculus', 'Linear Algebra', 'Quantum Mechanics', 'Machine Learning',
  'Philosophy', 'Number Theory', 'Thermodynamics', 'Neuroscience',
];

// ── Tool Map column defaults ──────────────────────────────────────────────
const DEFAULT_COLUMNS = [
  { id: 'given', label: 'Given', color: '#E8F4F8' },
  { id: 'find', label: 'Find', color: '#FFF8E8' },
  { id: 'tools', label: 'Tools', color: '#F0F8E8' },
  { id: 'steps', label: 'Steps', color: '#F8E8F0' },
  { id: 'check', label: 'Check', color: '#E8E8F8' },
];

const NODE_COLORS = ['#FF3D57', '#7C4DFF', '#00B0FF', '#00C875', '#FFAB40', '#9E9E9E'];

// ── Toast ─────────────────────────────────────────────────────────────────
function Toast({ msg, onDismiss }: { msg: string; onDismiss: () => void }) {
  useEffect(() => {
    const t = setTimeout(onDismiss, 8000);
    return () => clearTimeout(t);
  }, [onDismiss]);
  return (
    <div className="fixed bottom-8 right-8 z-[100] max-w-sm bg-on-surface text-surface p-4 shadow-xl font-sans text-xs leading-relaxed"
      style={{ animation: 'fadeIn 0.3s ease' }}>
      <button onClick={onDismiss} className="float-right ml-4 opacity-50 hover:opacity-100">✕</button>
      {msg}
    </div>
  );
}

export default function KnowledgeMapView() {
  // Graph
  const [topic, setTopic] = useState('');
  const [nodes, setNodes] = useState<GraphNode[]>([]);
  const [edges, setEdges] = useState<GraphEdge[]>([]);
  const [loadingGraph, setLoadingGraph] = useState(false);
  const [graphError, setGraphError] = useState('');
  const [selectedNode, setSelectedNode] = useState<GraphNode | null>(null);
  const [nodeSummary, setNodeSummary] = useState('');
  const [nodeImage, setNodeImage] = useState('');
  const [loadingSummary, setLoadingSummary] = useState(false);
  const svgRef = useRef<SVGSVGElement>(null);
  const zoomRef = useRef<d3.ZoomBehavior<SVGSVGElement, unknown> | null>(null);

  // KaTeX — re-render node summary once CDN loads
  const [, setKatexTick] = useState(0);
  useEffect(() => { loadKaTeX(() => setKatexTick(t => t + 1)); }, []);

  // Drawer
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [drawerTab, setDrawerTab] = useState<'tool' | 'free'>('tool');

  // Tool Map
  const [columns, setColumns] = useState(DEFAULT_COLUMNS.map(c => ({ ...c, items: [] as string[] })));
  const [toolInput, setToolInput] = useState<Record<string, string>>({});
  const [toastMsg, setToastMsg] = useState('');
  const [validating, setValidating] = useState(false);

  // Free Map
  const [mmNodes, setMmNodes] = useState<MindMapNode[]>([]);
  const [mmDragging, setMmDragging] = useState<string | null>(null);
  const [mmDragOffset, setMmDragOffset] = useState({ x: 0, y: 0 });
  const mmSvgRef = useRef<SVGSVGElement>(null);

  // Saved graphs
  const [savedGraphs, setSavedGraphs] = useState<SavedGraph[]>([]);
  const [showSavedGraphs, setShowSavedGraphs] = useState(false);
  const currentGraphIdRef = useRef<string>('');

  useEffect(() => { setSavedGraphs(loadGraphs()); }, []);

  // ── D3 Graph ──────────────────────────────────────────────────────────────
  useEffect(() => {
    if (nodes.length === 0 || !svgRef.current) return;

    const svg = d3.select<SVGSVGElement, unknown>(svgRef.current);
    svg.selectAll('*').remove();

    const container = svgRef.current.parentElement!;
    const W = container.clientWidth || 800;
    const H = container.clientHeight || 500;

    svg.attr('viewBox', `0 0 ${W} ${H}`).attr('width', W).attr('height', H);

    const g = svg.append('g');

    const zoom = d3.zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.3, 3])
      .on('zoom', (event: any) => {
        g.attr('transform', event.transform);
      });

    zoomRef.current = zoom;
    svg.call(zoom);

    // Deep-copy to avoid mutating state
    const simNodes: GraphNode[] = nodes.map(n => ({ ...n }));
    const simEdges: GraphEdge[] = edges.map(e => ({
      source: typeof e.source === 'string' ? e.source : (e.source as GraphNode).id,
      target: typeof e.target === 'string' ? e.target : (e.target as GraphNode).id,
    }));

    const simulation = d3.forceSimulation<GraphNode>(simNodes)
      .force('link', d3.forceLink<GraphNode, GraphEdge>(simEdges).id((d: GraphNode) => d.id).distance(120).strength(0.8))
      .force('charge', d3.forceManyBody<GraphNode>().strength(-380))
      .force('center', d3.forceCenter<GraphNode>(W / 2, H / 2))
      .force('collision', d3.forceCollide<GraphNode>((d: GraphNode) => gStyle(d.group).r + 32));

    // Links
    const link = g.append('g')
      .selectAll<SVGLineElement, GraphEdge>('line')
      .data(simEdges)
      .join('line')
      .attr('stroke', '#C4BFBA')
      .attr('stroke-width', 1.5)
      .attr('opacity', 0.55);

    // Node groups
    const nodeG = g.append('g')
      .selectAll<SVGGElement, GraphNode>('g')
      .data(simNodes)
      .join('g')
      .attr('cursor', 'pointer');

    // Drag
    const drag = d3.drag<SVGGElement, GraphNode>()
      .on('start', (event: any, d: GraphNode) => {
        if (!event.active) simulation.alphaTarget(0.3).restart();
        d.fx = d.x; d.fy = d.y;
      })
      .on('drag', (event: any, d: GraphNode) => {
        d.fx = event.x; d.fy = event.y;
      })
      .on('end', (event: any, d: GraphNode) => {
        if (!event.active) simulation.alphaTarget(0);
        d.fx = null; d.fy = null;
      });

    nodeG.call(drag as any);

    nodeG.on('click', (_event: any, d: GraphNode) => {
      setSelectedNode(d);
      setNodeSummary('');
      setNodeImage('');
      setLoadingSummary(true);
      getNodeSummary(d.label)
        .then(r => { setNodeSummary(r.definition || r.summary || ''); setNodeImage(r.image_url || ''); })
        .catch((e: any) => setNodeSummary('Could not load: ' + e.message))
        .finally(() => setLoadingSummary(false));
    });

    // Circles
    nodeG.append('circle')
      .attr('r', (d: GraphNode) => gStyle(d.group).r)
      .attr('fill', (d: GraphNode) => gStyle(d.group).fill)
      .attr('stroke', '#FFFFFF')
      .attr('stroke-width', 2.5)
      .attr('opacity', 0.95);

    // Label background (improves legibility over the graph canvas)
    nodeG.append('rect')
      .attr('x', -38)
      .attr('y', (d: GraphNode) => gStyle(d.group).r + 4)
      .attr('width', 76)
      .attr('height', 14)
      .attr('fill', 'rgba(253,252,248,0.72)')
      .attr('rx', 2)
      .attr('pointer-events', 'none');

    // Label below circle
    nodeG.append('text')
      .text((d: GraphNode) => d.label.length > 13 ? d.label.slice(0, 12) + '…' : d.label)
      .attr('text-anchor', 'middle')
      .attr('dominant-baseline', 'hanging')
      .attr('y', (d: GraphNode) => gStyle(d.group).r + 5)
      .attr('fill', '#1A1A1A')
      .attr('font-size', 10)
      .attr('font-family', 'Helvetica Neue, sans-serif')
      .attr('font-weight', '500')
      .attr('pointer-events', 'none')
      .style('user-select', 'none');

    simulation.on('tick', () => {
      link
        .attr('x1', (d: any) => d.source.x)
        .attr('y1', (d: any) => d.source.y)
        .attr('x2', (d: any) => d.target.x)
        .attr('y2', (d: any) => d.target.y);
      nodeG.attr('transform', (d: GraphNode) => `translate(${d.x ?? 0},${d.y ?? 0})`);
    });

    return () => { simulation.stop(); };
  }, [nodes, edges]);

  // ── Generate graph ────────────────────────────────────────────────────────
  const genGraph = useCallback(async (t?: string) => {
    const q = (t || topic).trim();
    if (!q) return;
    if (t) setTopic(t);
    setGraphError(''); setLoadingGraph(true);
    setSelectedNode(null); setNodeSummary(''); setNodeImage('');
    try {
      const result = await generateGraph(q);
      const ns = result.nodes as GraphNode[];
      const es = result.edges as GraphEdge[];
      setNodes(ns);
      setEdges(es);
      // Auto-save graph
      const id = `graph_${Date.now()}`;
      currentGraphIdRef.current = id;
      saveGraph({
        id,
        topic: q,
        savedAt: Date.now(),
        nodes: ns.map(n => ({ id: n.id, label: n.label, group: n.group })),
        edges: es.map(e => ({
          source: typeof e.source === 'string' ? e.source : (e.source as GraphNode).id,
          target: typeof e.target === 'string' ? e.target : (e.target as GraphNode).id,
        })),
      });
      setSavedGraphs(loadGraphs());
    } catch (e: any) {
      setGraphError(e.message || 'Backend is not running. Start it first.');
    } finally {
      setLoadingGraph(false);
    }
  }, [topic]);

  // ── Zoom buttons ──────────────────────────────────────────────────────────
  function zoomBy(k: number) {
    if (!zoomRef.current || !svgRef.current) return;
    zoomRef.current.scaleBy(d3.select<SVGSVGElement, unknown>(svgRef.current).transition().duration(300) as any, k);
  }

  // ── Tool Map ──────────────────────────────────────────────────────────────
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

  // ── Free Map ──────────────────────────────────────────────────────────────
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
    <div className="relative w-full h-[calc(100vh-100px)] bg-surface overflow-hidden flex flex-col">
      <style>{`@keyframes fadeIn { from { opacity:0; transform:translateY(8px); } to { opacity:1; transform:translateY(0); } }`}</style>

      {/* Topic bar */}
      <div className="flex-shrink-0 border-b border-outline-variant/20 px-6 py-4 flex items-center gap-4 bg-surface z-10 relative">
        <input
          type="text"
          value={topic}
          onChange={e => setTopic(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && genGraph()}
          placeholder="Enter a topic… e.g. Integral Calculus, Machine Learning, Quantum Physics"
          className="flex-1 bg-transparent border-b border-outline-variant/50 py-2 font-sans text-sm outline-none focus:border-on-surface transition-colors placeholder:text-outline-variant/60"
        />
        {/* Saved graphs button */}
        {savedGraphs.length > 0 && (
          <div className="relative">
            <button
              onClick={() => setShowSavedGraphs(v => !v)}
              className={`border px-4 py-2 font-sans text-[10px] uppercase tracking-[2px] flex items-center gap-1.5 transition-colors ${showSavedGraphs ? 'border-on-surface bg-on-surface/5' : 'border-outline-variant/30 hover:bg-surface-container-highest opacity-70 hover:opacity-100'}`}
              title="Saved graphs"
            >
              <span className="material-symbols-outlined text-[14px]">history</span>
              {savedGraphs.length}
            </button>
            {showSavedGraphs && (
              <div className="absolute top-full right-0 mt-2 w-72 bg-surface border border-outline-variant/30 shadow-lg z-50 max-h-72 overflow-y-auto">
                {savedGraphs.map(g => (
                  <div key={g.id} className="flex items-center justify-between px-4 py-3 border-b border-outline-variant/10 hover:bg-surface-container-lowest transition-colors group">
                    <div className="min-w-0 cursor-pointer flex-1" onClick={() => {
                      setTopic(g.topic);
                      setNodes(g.nodes as GraphNode[]);
                      setEdges(g.edges as GraphEdge[]);
                      currentGraphIdRef.current = g.id;
                      setShowSavedGraphs(false);
                    }}>
                      <p className="font-sans text-sm text-on-surface truncate">{g.topic}</p>
                      <p className="font-sans text-[9px] uppercase tracking-[1px] opacity-40 mt-0.5">
                        {g.nodes.length} nodes · {timeAgo(g.savedAt)}
                      </p>
                    </div>
                    <button
                      onClick={() => { deleteGraph(g.id); setSavedGraphs(loadGraphs()); }}
                      className="opacity-0 group-hover:opacity-30 hover:!opacity-70 transition-opacity ml-2 flex-shrink-0"
                    >
                      <span className="material-symbols-outlined text-[14px]">delete</span>
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
        <button
          onClick={() => genGraph()}
          disabled={loadingGraph || !topic.trim()}
          className="bg-on-surface text-surface px-6 py-2 font-sans text-[10px] uppercase tracking-[2px] hover:opacity-80 transition-opacity disabled:opacity-30 flex items-center gap-2"
        >
          {loadingGraph
            ? <div className="w-3 h-3 border border-surface/40 border-t-surface rounded-full animate-spin" />
            : <span className="material-symbols-outlined text-[14px]">account_tree</span>}
          {loadingGraph ? 'Building…' : 'Generate Map'}
        </button>
      </div>

      {/* Topic chips */}
      <div className="flex-shrink-0 flex gap-2 px-6 py-3 border-b border-outline-variant/10 overflow-x-auto">
        {TOPIC_CHIPS.map(chip => (
          <button
            key={chip}
            onClick={() => genGraph(chip)}
            className="flex-shrink-0 border border-outline-variant/30 px-3 py-1.5 font-sans text-[10px] uppercase tracking-[1px] hover:bg-surface-container-highest transition-colors"
          >
            {chip}
          </button>
        ))}
      </div>

      {/* Graph area */}
      <div className="flex-1 relative overflow-hidden">
        {nodes.length === 0 && !loadingGraph && !graphError && (
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="text-center">
              <span className="material-symbols-outlined text-on-surface opacity-20 text-6xl block mb-4">account_tree</span>
              <p className="font-serif text-xl text-on-surface opacity-30">Enter a topic above to generate a knowledge map</p>
            </div>
          </div>
        )}

        {loadingGraph && (
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="text-center">
              <div className="w-8 h-8 border-2 border-on-surface/20 border-t-on-surface rounded-full animate-spin mx-auto mb-4" />
              <p className="font-sans text-sm text-on-surface opacity-50">Building knowledge graph…</p>
            </div>
          </div>
        )}

        {graphError && (
          <div className="absolute inset-0 flex items-center justify-center">
            <p className="font-sans text-sm text-red-600 border border-red-200 bg-red-50 px-6 py-3 max-w-md text-center">{graphError}</p>
          </div>
        )}

        <svg ref={svgRef} className="w-full h-full" />

        {/* Zoom controls */}
        <div className="absolute bottom-8 left-8 flex flex-col gap-2 z-10">
          {[{ icon: 'add', k: 1.3 }, { icon: 'remove', k: 0.7 }].map(({ icon, k }) => (
            <button
              key={icon}
              onClick={() => zoomBy(k)}
              className="w-10 h-10 bg-surface border border-outline-variant/50 flex items-center justify-center hover:bg-surface-container transition-colors shadow-sm"
            >
              <span className="material-symbols-outlined text-on-surface opacity-70">{icon}</span>
            </button>
          ))}
        </div>

        {/* Node summary panel */}
        {selectedNode && (
          <div className="absolute top-4 right-4 w-80 bg-surface border border-outline-variant/30 shadow-md z-20 flex flex-col" style={{ maxHeight: 'calc(100vh - 2rem)' }}>
            {/* Header — fixed, doesn't scroll */}
            <div className="border-b border-outline-variant/20 px-6 py-4 flex justify-between items-start flex-shrink-0">
              <div>
                <span className="text-[10px] tracking-[2px] text-on-surface uppercase opacity-40 block mb-1">Node Focus</span>
                <h2 className="font-serif text-xl text-on-surface">{selectedNode.label}</h2>
              </div>
              <button onClick={() => setSelectedNode(null)} className="opacity-40 hover:opacity-100 transition-opacity mt-1">
                <span className="material-symbols-outlined text-[16px]">close</span>
              </button>
            </div>
            {/* Scrollable body */}
            <div className="overflow-y-auto flex-1">
              {nodeImage && (
                <img
                  src={nodeImage}
                  alt={selectedNode.label}
                  className="w-full h-36 object-cover grayscale opacity-80"
                  onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }}
                />
              )}
              <div className="px-6 py-4">
                {loadingSummary ? (
                  <div className="flex items-center gap-3">
                    <div className="w-4 h-4 border border-on-surface/20 border-t-on-surface rounded-full animate-spin" />
                    <span className="font-sans text-xs opacity-50">Loading…</span>
                  </div>
                ) : (
                  <p className="font-sans text-sm text-on-surface opacity-80 leading-relaxed" dangerouslySetInnerHTML={{ __html: renderMath(nodeSummary) }} />
                )}
              </div>
              {selectedNode.group && selectedNode.group !== 'default' && (
                <div className="px-6 pb-4">
                  <span className="inline-block w-3 h-3 rounded-full mr-2"
                    style={{ background: gStyle(selectedNode.group).fill }} />
                  <span className="font-sans text-[10px] uppercase tracking-[1px] text-on-surface opacity-50">
                    {selectedNode.group}
                  </span>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Mind Map Drawer */}
      <div className={`absolute bottom-0 left-0 right-0 bg-on-surface text-surface z-50 flex flex-col border-t border-outline/20 transition-transform duration-500 ease-in-out ${drawerOpen ? 'translate-y-0 h-[420px]' : 'translate-y-[calc(100%-60px)] h-[420px]'}`}>
        {/* Handle */}
        <div
          className="h-[60px] flex items-center justify-between px-8 cursor-pointer hover:bg-surface/5 flex-shrink-0"
          onClick={() => setDrawerOpen(v => !v)}
        >
          <span className="font-serif text-xl text-surface tracking-[4px] uppercase">Mind Map</span>
          <div className="flex items-center gap-6">
            {drawerOpen && (
              <div className="flex gap-0 border border-surface/20">
                {(['tool', 'free'] as const).map(tab => (
                  <button
                    key={tab}
                    onClick={e => { e.stopPropagation(); setDrawerTab(tab); }}
                    className={`px-5 py-1.5 font-sans text-[10px] uppercase tracking-[2px] transition-colors ${drawerTab === tab ? 'bg-surface text-on-surface' : 'text-surface hover:bg-surface/10'}`}
                  >
                    {tab === 'tool' ? '🔧 Tool Map' : '🧠 Free Map'}
                  </button>
                ))}
              </div>
            )}
            <span className={`material-symbols-outlined text-surface transition-transform duration-500 ${drawerOpen ? 'rotate-180' : ''}`}>
              keyboard_arrow_up
            </span>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-hidden border-t border-surface/10">

          {/* Tool Map */}
          {drawerTab === 'tool' && (
            <div className="h-full flex flex-col">
              <div className="flex-1 overflow-x-auto">
                <div className="flex h-full gap-0 min-w-max">
                  {columns.map(col => (
                    <div key={col.id} className="flex flex-col border-r border-surface/10 min-w-[180px] max-w-[220px]" style={{ background: col.color + '22' }}>
                      <div className="px-4 py-3 border-b border-surface/10">
                        <span className="font-sans text-[10px] uppercase tracking-[2px] text-surface opacity-80 font-semibold">{col.label}</span>
                      </div>
                      <div className="flex-1 overflow-y-auto p-3 space-y-2">
                        {col.items.map((item, i) => (
                          <div key={i} className="bg-surface/10 border border-surface/20 px-3 py-2 font-sans text-xs text-surface flex items-center justify-between group">
                            <span className="flex-1">{item}</span>
                            <button onClick={() => removeItem(col.id, i)} className="opacity-0 group-hover:opacity-100 ml-2 text-surface/50 hover:text-surface">✕</button>
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
                            className="flex-1 bg-surface/10 border border-surface/20 px-2 py-1.5 font-sans text-xs text-surface placeholder:text-surface/30 outline-none min-w-0"
                          />
                          <button onClick={() => addItem(col.id)} className="px-2 py-1.5 bg-surface/20 hover:bg-surface/30 font-sans text-xs text-surface">+</button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
              <div className="flex-shrink-0 px-6 py-3 border-t border-surface/10 flex items-center justify-end">
                <button
                  onClick={validateMap}
                  disabled={validating}
                  className="bg-surface text-on-surface px-6 py-2 font-sans text-[10px] uppercase tracking-[2px] hover:opacity-80 disabled:opacity-40 flex items-center gap-2"
                >
                  {validating
                    ? <div className="w-3 h-3 border border-on-surface/30 border-t-on-surface rounded-full animate-spin" />
                    : <span className="material-symbols-outlined text-[14px]">check_circle</span>}
                  Validate with AI
                </button>
              </div>
            </div>
          )}

          {/* Free Map */}
          {drawerTab === 'free' && (
            <div className="h-full flex flex-col">
              <div className="flex-1 relative overflow-hidden">
                <svg
                  ref={mmSvgRef}
                  className="w-full h-full"
                  onMouseMove={onMmMouseMove}
                  onMouseUp={() => setMmDragging(null)}
                  onMouseLeave={() => setMmDragging(null)}
                >
                  {mmNodes.length > 1 && mmNodes.slice(1).map((node, i) => (
                    <line key={`e${i}`} x1={mmNodes[0].x} y1={mmNodes[0].y} x2={node.x} y2={node.y} stroke="rgba(253,252,248,0.2)" strokeWidth={1} />
                  ))}
                  {mmNodes.map(node => (
                    <g key={node.id} transform={`translate(${node.x},${node.y})`}
                      onMouseDown={e => startMmDrag(node.id, e)}
                      onDoubleClick={e => { e.stopPropagation(); const lbl = prompt('Rename node:', node.label); if (lbl) setMmNodes(prev => prev.map(n => n.id === node.id ? { ...n, label: lbl } : n)); }}
                      style={{ cursor: 'move' }}>
                      <rect x={-60} y={-20} width={120} height={40} fill={node.color} opacity={0.9} />
                      <text
                        textAnchor="middle"
                        dominantBaseline="middle"
                        fontSize={11}
                        fontFamily="Helvetica Neue, sans-serif"
                        fontWeight="600"
                        fill={node.color === '#1A1A1A' ? '#FDFCF8' : '#1A1A1A'}
                        style={{ userSelect: 'none', pointerEvents: 'none' }}
                      >
                        {node.label}
                      </text>
                    </g>
                  ))}
                </svg>
                {mmNodes.length === 0 && (
                  <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                    <p className="font-sans text-xs text-surface opacity-30 uppercase tracking-[2px]">Click "Add Node" to begin</p>
                  </div>
                )}
              </div>
              <div className="flex-shrink-0 px-6 py-3 border-t border-surface/10 flex items-center gap-4">
                <button onClick={addMmNode} className="bg-surface text-on-surface px-5 py-2 font-sans text-[10px] uppercase tracking-[2px] hover:opacity-80 flex items-center gap-2">
                  <span className="material-symbols-outlined text-[14px]">add</span> Add Node
                </button>
                <button onClick={() => setMmNodes([])} className="border border-surface/30 px-5 py-2 font-sans text-[10px] uppercase tracking-[2px] text-surface hover:bg-surface/10">
                  Clear
                </button>
                <span className="font-sans text-[10px] text-surface opacity-30 ml-auto">{mmNodes.length} nodes</span>
              </div>
            </div>
          )}
        </div>
      </div>

      {toastMsg && <Toast msg={toastMsg} onDismiss={() => setToastMsg('')} />}
    </div>
  );
}
