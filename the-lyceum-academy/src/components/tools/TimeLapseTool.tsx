/**
 * TimeLapseTool (Tier 2 · Algorithmic Time-Lapse) — the human brain is poor at
 * reasoning across thousands of generations (evolution, population genetics)
 * but sharp at feedback loops. The "Generative Sandbox": the student sets
 * input variables (environmental pressure, mutation rate) and hits Play; a
 * Cellular Automaton fast-forwards hundreds of generations in seconds, so they
 * watch a population collapse or adapt and derive the genetic law themselves.
 *
 * Brain: Analytical-Logical. Thinking: Systems Thinking (dynamic systems).
 * Subjects: Ecology, Genetics.
 *
 * Canvas 2D grid: each cell holds a "trait" value; selection pressure favours
 * traits near an environment optimum, mutation jitters offspring traits. The
 * population's mean fitness + trait distribution evolve live.
 */
import { useEffect, useRef, useState } from 'react';

const GRID = 60;

export default function TimeLapseTool() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [pressure, setPressure] = useState(0.5);    // environment optimum (0..1)
  const [mutation, setMutation] = useState(0.15);   // mutation magnitude
  const [running, setRunning] = useState(false);
  const [gen, setGen] = useState(0);
  const [meanFit, setMeanFit] = useState(0);
  const [alive, setAlive] = useState(GRID * GRID);

  const pressureRef = useRef(pressure); pressureRef.current = pressure;
  const mutationRef = useRef(mutation); mutationRef.current = mutation;
  const runningRef = useRef(running); runningRef.current = running;
  // trait grid; -1 = dead cell.
  const gridRef = useRef<Float32Array>(new Float32Array(GRID * GRID));

  function seed() {
    const g = gridRef.current;
    for (let i = 0; i < g.length; i++) g[i] = Math.random();
    setGen(0);
  }
  useEffect(() => { seed(); }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d')!;
    const cell = canvas.width / GRID;
    let raf = 0, acc = 0, last = performance.now();

    function step() {
      const g = gridRef.current;
      const opt = pressureRef.current;
      const mut = mutationRef.current;
      const next = new Float32Array(g.length);
      let sumFit = 0, count = 0;
      for (let i = 0; i < g.length; i++) {
        const trait = g[i];
        if (trait < 0) { next[i] = -1; continue; }
        // Fitness: gaussian around the environment optimum.
        const d = trait - opt;
        const fit = Math.exp(-(d * d) / 0.05);
        // Selection: low fitness cells die and are recolonised by a fit neighbour.
        if (Math.random() > fit * 0.9 + 0.1) {
          // find a neighbour to reproduce into this cell
          const nx = i + (Math.random() < 0.5 ? -1 : 1);
          const parent = g[nx] >= 0 ? g[nx] : g[i];
          next[i] = Math.min(1, Math.max(0, parent + (Math.random() - 0.5) * mut));
        } else {
          next[i] = trait;
        }
        sumFit += fit; count++;
      }
      gridRef.current = next;
      setMeanFit(count ? sumFit / count : 0);
      setAlive(count);
      setGen(x => x + 1);
    }

    function draw() {
      const g = gridRef.current;
      const opt = pressureRef.current;
      for (let y = 0; y < GRID; y++) {
        for (let x = 0; x < GRID; x++) {
          const t = g[y * GRID + x];
          if (t < 0) { ctx.fillStyle = '#0a0a0a'; }
          else {
            // hue by trait; brightness by fitness vs optimum
            const d = Math.abs(t - opt);
            const fit = Math.exp(-(d * d) / 0.05);
            const hue = Math.round(t * 260);
            ctx.fillStyle = `hsl(${hue}, 70%, ${20 + fit * 45}%)`;
          }
          ctx.fillRect(x * cell, y * cell, cell, cell);
        }
      }
    }

    const loop = (now: number) => {
      raf = requestAnimationFrame(loop);
      draw();
      if (runningRef.current) {
        acc += now - last;
        if (acc > 60) { step(); acc = 0; }   // ~16 gen/sec
      }
      last = now;
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <div className="p-4 flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <p className="text-[11px] uppercase tracking-[2px] text-white/40">Generative Sandbox</p>
        <div className="flex gap-2">
          <button onClick={() => setRunning(r => !r)}
            className={`rounded-full px-3 py-1 text-[10px] uppercase tracking-[2px] transition-colors ${running ? 'bg-amber-400/20 text-amber-200' : 'bg-emerald-400/15 text-emerald-200'}`}>
            {running ? '❚❚ pause' : '▶ play'}
          </button>
          <button onClick={() => { setRunning(false); seed(); }}
            className="rounded-full px-3 py-1 text-[10px] uppercase tracking-[2px] bg-white/10 text-white/60 hover:bg-white/20 transition-colors">
            ↻ reset
          </button>
        </div>
      </div>

      <canvas ref={canvasRef} width={480} height={480} className="w-full rounded-2xl bg-black" style={{ imageRendering: 'pixelated' }} />

      <div className="flex gap-4 text-[11px] text-white/60">
        <span>Thế hệ: <span className="text-white/85">{gen}</span></span>
        <span>Fitness TB: <span className="text-emerald-300">{Math.round(meanFit * 100)}%</span></span>
        <span>Sống: <span className="text-white/85">{alive}</span></span>
      </div>

      <div>
        <div className="flex justify-between text-[10px] text-white/40 mb-1">
          <span>Áp lực môi trường (điểm tối ưu của trait)</span><span>{Math.round(pressure * 100)}%</span>
        </div>
        <input type="range" min={0} max={100} value={Math.round(pressure * 100)}
          onChange={e => setPressure(Number(e.target.value) / 100)} className="w-full accent-purple-400" />
      </div>
      <div>
        <div className="flex justify-between text-[10px] text-white/40 mb-1">
          <span>Tỷ lệ đột biến</span><span>{Math.round(mutation * 100)}%</span>
        </div>
        <input type="range" min={0} max={60} value={Math.round(mutation * 100)}
          onChange={e => setMutation(Number(e.target.value) / 100)} className="w-full accent-pink-400" />
      </div>
      <p className="text-[10px] text-white/40">
        Chỉnh áp lực môi trường & tỷ lệ đột biến rồi bấm Play. Xem quần thể thích nghi (fitness tăng) hay sụp đổ qua hàng trăm thế hệ — tự đúc kết quy luật chọn lọc.
      </p>
    </div>
  );
}
