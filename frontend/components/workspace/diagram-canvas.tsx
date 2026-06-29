"use client";

import { useEffect, useRef, useState } from "react";
import { Eraser } from "lucide-react";

import { useLocalStorageState } from "@/lib/hooks/use-local-storage-state";

export type DiagramPoint = { x: number; y: number };
export type DiagramStroke = { color: string; points: DiagramPoint[] };

const COLORS = ["#e2e8f0", "#34d399", "#38bdf8"];
const CANVAS_HEIGHT = 320;

export function DiagramCanvas({ problemId, onActivity }: { problemId: string; onActivity?: () => void }) {
  const [strokes, setStrokes] = useLocalStorageState<DiagramStroke[]>(`pclick:diagram:${problemId}`, []);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const drawingRef = useRef(false);
  const currentStrokeRef = useRef<DiagramStroke | null>(null);
  const [activeColor, setActiveColor] = useState(COLORS[0]);

  function redraw(ctx: CanvasRenderingContext2D, allStrokes: DiagramStroke[]) {
    ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
    for (const stroke of allStrokes) {
      if (!stroke || !stroke.points || stroke.points.length < 2) continue;
      ctx.strokeStyle = stroke.color;
      ctx.lineWidth = 2;
      ctx.lineJoin = "round";
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo(stroke.points[0].x, stroke.points[0].y);
      for (const point of stroke.points.slice(1)) ctx.lineTo(point.x, point.y);
      ctx.stroke();
    }
  }

  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    function resizeAndRedraw() {
      const dpr = window.devicePixelRatio || 1;
      const rect = container!.getBoundingClientRect();
      canvas!.width = rect.width * dpr;
      canvas!.height = CANVAS_HEIGHT * dpr;
      canvas!.style.width = `${rect.width}px`;
      canvas!.style.height = `${CANVAS_HEIGHT}px`;
      const ctx = canvas!.getContext("2d");
      if (!ctx) return;
      ctx.scale(dpr, dpr);
      redraw(ctx, strokes);
    }

    resizeAndRedraw();
    const observer = new ResizeObserver(resizeAndRedraw);
    observer.observe(container);
    return () => observer.disconnect();
  }, [strokes]);

  function getRelativePoint(event: React.PointerEvent<HTMLCanvasElement>): DiagramPoint {
    const rect = canvasRef.current!.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }

  function handlePointerDown(event: React.PointerEvent<HTMLCanvasElement>) {
    drawingRef.current = true;
    currentStrokeRef.current = { color: activeColor, points: [getRelativePoint(event)] };
    canvasRef.current?.setPointerCapture(event.pointerId);
  }

  function handlePointerMove(event: React.PointerEvent<HTMLCanvasElement>) {
    if (!drawingRef.current || !currentStrokeRef.current) return;
    currentStrokeRef.current.points.push(getRelativePoint(event));
    const ctx = canvasRef.current?.getContext("2d");
    if (ctx) redraw(ctx, [...strokes, currentStrokeRef.current]);
  }

  function handlePointerUp() {
    if (!drawingRef.current || !currentStrokeRef.current) return;
    drawingRef.current = false;
    setStrokes((prev) => [...prev, currentStrokeRef.current!]);
    currentStrokeRef.current = null;
    onActivity?.();
  }

  function handleClear() {
    setStrokes([]);
    onActivity?.();
  }

  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <div className="flex gap-2">
          {COLORS.map((color) => (
            <button
              key={color}
              type="button"
              onClick={() => setActiveColor(color)}
              aria-label={`Color ${color}`}
              className={`h-6 w-6 rounded-full border-2 ${activeColor === color ? "border-white" : "border-transparent"}`}
              style={{ backgroundColor: color }}
            />
          ))}
        </div>
        <button
          type="button"
          onClick={handleClear}
          className="inline-flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-3 py-1.5 text-xs text-zinc-300 hover:bg-white/10"
        >
          <Eraser className="h-3.5 w-3.5" />
          Clear
        </button>
      </div>
      <div ref={containerRef} className="w-full overflow-hidden rounded-2xl border border-white/10 bg-[#091022]">
        <canvas
          ref={canvasRef}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerLeave={handlePointerUp}
          className="touch-none"
        />
      </div>
    </div>
  );
}
