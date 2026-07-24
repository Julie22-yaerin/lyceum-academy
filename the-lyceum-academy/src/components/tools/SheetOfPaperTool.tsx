/**
 * SheetOfPaperTool — "Large Sheet of Paper": a lighter, smaller cousin of a
 * full whiteboard. One canvas, a real toolset (pen, eraser, line, rectangle,
 * ellipse, text, color, stroke width, undo/redo, clear), nothing else —
 * no boards, no multi-page, no collaboration. Just a sheet to think on.
 */
import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';

type Tool = 'pen' | 'eraser' | 'line' | 'rect' | 'ellipse' | 'text';

const COLORS = ['#f5f5f5', '#f87171', '#fb923c', '#facc15', '#4ade80', '#60a5fa', '#c084fc'];
const CANVAS_W = 1200;
const CANVAS_H = 750;

export default function SheetOfPaperTool() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null); // live preview for shapes
  const [tool, setTool] = useState<Tool>('pen');
  const [color, setColor] = useState(COLORS[0]);
  const [width, setWidth] = useState(3);
  const [history, setHistory] = useState<ImageData[]>([]);
  const [historyIdx, setHistoryIdx] = useState(-1);
  const drawing = useRef(false);
  const start = useRef<{ x: number; y: number } | null>(null);
  const [textInput, setTextInput] = useState<{ x: number; y: number } | null>(null);
  const [textValue, setTextValue] = useState('');

  useEffect(() => {
    const c = canvasRef.current;
    if (!c) return;
    const ctx = c.getContext('2d');
    if (!ctx) return;
    ctx.fillStyle = '#141824';
    ctx.fillRect(0, 0, c.width, c.height);
    pushHistory();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function pushHistory() {
    const c = canvasRef.current;
    if (!c) return;
    const ctx = c.getContext('2d');
    if (!ctx) return;
    const snap = ctx.getImageData(0, 0, c.width, c.height);
    setHistory(h => {
      const trimmed = h.slice(0, historyIdx + 1);
      return [...trimmed, snap].slice(-40);
    });
    setHistoryIdx(i => Math.min(i + 1, 39));
  }

  function restore(idx: number) {
    const c = canvasRef.current;
    const ctx = c?.getContext('2d');
    if (!c || !ctx || !history[idx]) return;
    ctx.putImageData(history[idx], 0, 0);
  }

  function undo() { if (historyIdx > 0) { restore(historyIdx - 1); setHistoryIdx(i => i - 1); } }
  function redo() { if (historyIdx < history.length - 1) { restore(historyIdx + 1); setHistoryIdx(i => i + 1); } }

  function clearSheet() {
    const c = canvasRef.current;
    const ctx = c?.getContext('2d');
    if (!c || !ctx) return;
    ctx.fillStyle = '#141824';
    ctx.fillRect(0, 0, c.width, c.height);
    pushHistory();
  }

  function pos(e: ReactPointerEvent<HTMLCanvasElement>): { x: number; y: number } {
    const c = e.currentTarget;
    const rect = c.getBoundingClientRect();
    const scaleX = c.width / rect.width, scaleY = c.height / rect.height;
    return { x: (e.clientX - rect.left) * scaleX, y: (e.clientY - rect.top) * scaleY };
  }

  function handlePointerDown(e: ReactPointerEvent<HTMLCanvasElement>) {
    const p = pos(e);
    if (tool === 'text') { setTextInput(p); setTextValue(''); return; }
    drawing.current = true;
    start.current = p;
    if (tool === 'pen' || tool === 'eraser') {
      const ctx = canvasRef.current?.getContext('2d');
      if (!ctx) return;
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
    }
  }

  function handlePointerMove(e: ReactPointerEvent<HTMLCanvasElement>) {
    if (!drawing.current) return;
    const p = pos(e);
    if (tool === 'pen' || tool === 'eraser') {
      const ctx = canvasRef.current?.getContext('2d');
      if (!ctx) return;
      ctx.strokeStyle = tool === 'eraser' ? '#141824' : color;
      ctx.lineWidth = tool === 'eraser' ? width * 4 : width;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.lineTo(p.x, p.y);
      ctx.stroke();
    } else {
      // live preview for shapes on the overlay canvas
      const ov = overlayRef.current;
      const octx = ov?.getContext('2d');
      if (!ov || !octx || !start.current) return;
      octx.clearRect(0, 0, ov.width, ov.height);
      octx.strokeStyle = color;
      octx.lineWidth = width;
      drawShape(octx, tool, start.current, p);
    }
  }

  function handlePointerUp(e: ReactPointerEvent<HTMLCanvasElement>) {
    if (!drawing.current) return;
    drawing.current = false;
    if (tool !== 'pen' && tool !== 'eraser' && start.current) {
      const p = pos(e);
      const ctx = canvasRef.current?.getContext('2d');
      const ov = overlayRef.current;
      const octx = ov?.getContext('2d');
      if (ctx) { ctx.strokeStyle = color; ctx.lineWidth = width; drawShape(ctx, tool, start.current, p); }
      if (ov && octx) octx.clearRect(0, 0, ov.width, ov.height);
    }
    start.current = null;
    pushHistory();
  }

  function drawShape(ctx: CanvasRenderingContext2D, t: Tool, a: { x: number; y: number }, b: { x: number; y: number }) {
    ctx.beginPath();
    if (t === 'line') {
      ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y);
    } else if (t === 'rect') {
      ctx.rect(Math.min(a.x, b.x), Math.min(a.y, b.y), Math.abs(b.x - a.x), Math.abs(b.y - a.y));
    } else if (t === 'ellipse') {
      const rx = Math.abs(b.x - a.x) / 2, ry = Math.abs(b.y - a.y) / 2;
      ctx.ellipse((a.x + b.x) / 2, (a.y + b.y) / 2, rx, ry, 0, 0, Math.PI * 2);
    }
    ctx.stroke();
  }

  function commitText() {
    if (!textInput || !textValue.trim()) { setTextInput(null); return; }
    const ctx = canvasRef.current?.getContext('2d');
    if (ctx) {
      ctx.fillStyle = color;
      ctx.font = `${14 + width * 2}px sans-serif`;
      ctx.fillText(textValue, textInput.x, textInput.y);
      pushHistory();
    }
    setTextInput(null);
  }

  const TOOLS: { id: Tool; icon: string }[] = [
    { id: 'pen', icon: 'edit' }, { id: 'eraser', icon: 'ink_eraser' },
    { id: 'line', icon: 'horizontal_rule' }, { id: 'rect', icon: 'crop_square' },
    { id: 'ellipse', icon: 'circle' }, { id: 'text', icon: 'title' },
  ];

  return (
    <div className="p-4 flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        {TOOLS.map(t => (
          <button key={t.id} onClick={() => setTool(t.id)}
            className={`w-9 h-9 flex items-center justify-center rounded-lg transition-colors ${tool === t.id ? 'bg-purple-400/25 text-purple-200' : 'bg-white/5 text-white/60 hover:bg-white/10'}`}>
            <span className="material-symbols-outlined text-[18px]">{t.icon}</span>
          </button>
        ))}
        <div className="w-px h-6 bg-white/10 mx-1" />
        {COLORS.map(c => (
          <button key={c} onClick={() => setColor(c)}
            className={`w-6 h-6 rounded-full border-2 transition-transform ${color === c ? 'scale-110 border-white' : 'border-transparent'}`}
            style={{ background: c }} />
        ))}
        <div className="w-px h-6 bg-white/10 mx-1" />
        <input type="range" min={1} max={12} value={width} onChange={e => setWidth(Number(e.target.value))} className="w-20 accent-purple-400" />
        <div className="flex-1" />
        <button onClick={undo} disabled={historyIdx <= 0} className="w-9 h-9 flex items-center justify-center rounded-lg bg-white/5 text-white/60 hover:bg-white/10 disabled:opacity-30">
          <span className="material-symbols-outlined text-[18px]">undo</span>
        </button>
        <button onClick={redo} disabled={historyIdx >= history.length - 1} className="w-9 h-9 flex items-center justify-center rounded-lg bg-white/5 text-white/60 hover:bg-white/10 disabled:opacity-30">
          <span className="material-symbols-outlined text-[18px]">redo</span>
        </button>
        <button onClick={clearSheet} className="rounded-lg px-3 h-9 text-[10px] uppercase tracking-[2px] bg-red-400/10 text-red-300 hover:bg-red-400/20">
          Clear
        </button>
      </div>

      <div className="relative rounded-2xl overflow-hidden border border-white/10" style={{ aspectRatio: `${CANVAS_W}/${CANVAS_H}` }}>
        <canvas
          ref={canvasRef} width={CANVAS_W} height={CANVAS_H}
          onPointerDown={handlePointerDown} onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp} onPointerLeave={handlePointerUp}
          className="absolute inset-0 w-full h-full touch-none cursor-crosshair"
        />
        <canvas ref={overlayRef} width={CANVAS_W} height={CANVAS_H} className="absolute inset-0 w-full h-full pointer-events-none" />
        {textInput && (
          <input
            autoFocus
            value={textValue}
            onChange={e => setTextValue(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') commitText(); if (e.key === 'Escape') setTextInput(null); }}
            onBlur={commitText}
            style={{
              position: 'absolute',
              left: `${(textInput.x / CANVAS_W) * 100}%`,
              top: `${(textInput.y / CANVAS_H) * 100 - 3}%`,
              color, fontSize: 14 + width * 2,
            }}
            className="bg-black/40 outline-none border border-white/20 rounded px-1"
          />
        )}
      </div>
    </div>
  );
}
