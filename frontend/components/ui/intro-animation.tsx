"use client";

import { useEffect, useRef } from "react";

interface Props {
  onComplete: () => void;
}

export function IntroAnimation({ onComplete }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef = useRef<number | null>(null);
  const doneRef = useRef(false);
  const onCompleteRef = useRef(onComplete);
  useEffect(() => { onCompleteRef.current = onComplete; }, [onComplete]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx2d = canvas.getContext("2d");
    if (!ctx2d) return;
    // Explicit non-null alias so the closures below (drawBg/drawSnake/…) keep
    // the narrowed type — control-flow narrowing of a checked const isn't
    // preserved inside nested function declarations, but a typed const is.
    const ctx: CanvasRenderingContext2D = ctx2d;

    // ── sizing ────────────────────────────────────────────────────────────────
    const W = 560, H = 280;
    canvas.width = W;
    canvas.height = H;

    // ── helpers ───────────────────────────────────────────────────────────────
    const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
    const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
    const eI = (t: number) => (t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t);
    const eO = (t: number) => 1 - (1 - t) * (1 - t);
    const nn = (v: number, a: number, b: number) => clamp((v - a) / (b - a), 0, 1);

    // ── timing (ms) ───────────────────────────────────────────────────────────
    const TE = 2000;   // snake crawl end
    const CS = 1600;   // cat start walking in
    const CE = 3100;   // cat arrives (stops walking)
    const WS = 3000;   // snake starts wrapping
    const WE = 4300;   // snake done wrapping
    const SS = 4300;   // cat starts sitting
    const TOTAL = 5300;

    // ── colors ────────────────────────────────────────────────────────────────
    const GREEN = "#10b981";
    const GD    = "#059669";
    const BG    = "#050816";
    const CAT   = "#0d0d0d";

    // ── letter x-positions ────────────────────────────────────────────────────
    const LX = [68, 142, 216, 290, 364, 438];
    const SEGS = 38;

    // ── mutable state (inside closure, not React state) ───────────────────────
    let body: Array<{ x: number; y: number }> = [];
    let hx = -40, hy = H / 2 - 18;
    let la = [0, 0, 0, 0, 0, 0];
    let cx = W + 70, cy = H / 2 + 22, cw = 0;
    let t0: number | null = null;

    // ── draw helpers ──────────────────────────────────────────────────────────
    function drawBg() {
      ctx.fillStyle = BG;
      ctx.fillRect(0, 0, W, H);
    }

    function drawLetters() {
      ctx.save();
      ctx.font = "bold 54px system-ui, -apple-system, sans-serif";
      ctx.textBaseline = "middle";
      ctx.textAlign = "center";
      "PCLICK".split("").forEach((ch, i) => {
        if (la[i] <= 0) return;
        ctx.globalAlpha = la[i];
        ctx.shadowColor = GREEN;
        ctx.shadowBlur = 14;
        ctx.fillStyle = GREEN;
        ctx.fillText(ch, LX[i], H / 2 - 20);
      });
      ctx.shadowBlur = 0;
      ctx.globalAlpha = 1;
      ctx.restore();
    }

    function drawSnake() {
      if (body.length < 2) return;
      ctx.save();
      ctx.strokeStyle = GREEN;
      ctx.lineWidth = 9;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.beginPath();
      ctx.moveTo(body[0].x, body[0].y);
      for (let i = 1; i < body.length; i++) {
        const mx = (body[i - 1].x + body[i].x) / 2;
        const my = (body[i - 1].y + body[i].y) / 2;
        ctx.quadraticCurveTo(body[i - 1].x, body[i - 1].y, mx, my);
      }
      ctx.stroke();
      ctx.restore();
    }

    function drawHead() {
      const ang =
        body.length > 1
          ? Math.atan2(body[0].y - body[1].y, body[0].x - body[1].x)
          : 0;
      ctx.save();
      ctx.translate(hx, hy);
      ctx.rotate(ang);
      ctx.fillStyle = GD;
      ctx.beginPath();
      ctx.ellipse(0, 0, 13, 9, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#fef08a";
      ctx.beginPath();
      ctx.arc(7, -3, 3.2, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#111";
      ctx.beginPath();
      ctx.arc(7.8, -3, 1.8, 0, Math.PI * 2);
      ctx.fill();
      if (Math.sin(Date.now() / 90) > 0.2) {
        ctx.strokeStyle = "#f43f5e";
        ctx.lineWidth = 2;
        ctx.lineCap = "round";
        ctx.beginPath();
        ctx.moveTo(13, 0); ctx.lineTo(20, -4);
        ctx.moveTo(13, 0); ctx.lineTo(20,  4);
        ctx.stroke();
      }
      ctx.restore();
    }

    function drawCat(mode: "walk" | "stop" | "sit", sp?: number) {
      ctx.save();
      ctx.fillStyle = CAT;

      if (mode === "walk" || mode === "stop") {
        const sw = mode === "walk" ? Math.sin(cw) * 9 : 0;
        ctx.beginPath();
        ctx.ellipse(cx, cy, 27, 12, -0.1, 0, Math.PI * 2);
        ctx.fill();
        ctx.beginPath();
        ctx.arc(cx - 21, cy - 8, 13, 0, Math.PI * 2);
        ctx.fill();
        // ears
        ctx.beginPath();
        ctx.moveTo(cx - 29, cy - 19); ctx.lineTo(cx - 37, cy - 33); ctx.lineTo(cx - 19, cy - 23);
        ctx.closePath(); ctx.fill();
        ctx.beginPath();
        ctx.moveTo(cx - 13, cy - 21); ctx.lineTo(cx - 11, cy - 34); ctx.lineTo(cx - 3, cy - 21);
        ctx.closePath(); ctx.fill();
        // legs
        ([
          [cx - 17,  1] as const,
          [cx -  8, -1] as const,
          [cx + 10, -1] as const,
          [cx + 18,  1] as const,
        ] as [number, number][]).forEach(([lx, s]) =>
          ctx.fillRect(lx - 3.5, cy + 10, 7, 14 + s * sw)
        );
        // tail
        ctx.strokeStyle = CAT; ctx.lineWidth = 6; ctx.lineCap = "round";
        ctx.beginPath();
        ctx.moveTo(cx + 24, cy - 3);
        ctx.quadraticCurveTo(cx + 46, cy - 20, cx + 42, cy - 43);
        ctx.stroke();
        // eye
        ctx.fillStyle = "#d97706";
        ctx.beginPath(); ctx.arc(cx - 28, cy - 10, 3.5, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = "#111";
        ctx.beginPath(); ctx.arc(cx - 28, cy - 10, 2, 0, Math.PI * 2); ctx.fill();
      } else {
        // sitting front-face
        const p = sp ?? 1;
        ctx.beginPath();
        ctx.ellipse(cx, cy + 6, 18, lerp(12, 23, p), 0, 0, Math.PI * 2);
        ctx.fill();
        const hy2 = cy + lerp(-8, -30, p);
        ctx.beginPath(); ctx.arc(cx, hy2, 15, 0, Math.PI * 2); ctx.fill();
        // ears
        ctx.beginPath();
        ctx.moveTo(cx - 11, hy2 - 12); ctx.lineTo(cx - 19, hy2 - 27); ctx.lineTo(cx - 3, hy2 - 16);
        ctx.closePath(); ctx.fill();
        ctx.beginPath();
        ctx.moveTo(cx + 11, hy2 - 12); ctx.lineTo(cx + 19, hy2 - 27); ctx.lineTo(cx + 3, hy2 - 16);
        ctx.closePath(); ctx.fill();
        // eyes
        ctx.fillStyle = "#d97706";
        ctx.beginPath(); ctx.ellipse(cx - 5, hy2 + 1, 3.5, 4.5, 0, 0, Math.PI * 2); ctx.fill();
        ctx.beginPath(); ctx.ellipse(cx + 5, hy2 + 1, 3.5, 4.5, 0, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = "#111";
        ctx.beginPath(); ctx.ellipse(cx - 5, hy2 + 1, 1.8, 4.5, 0, 0, Math.PI * 2); ctx.fill();
        ctx.beginPath(); ctx.ellipse(cx + 5, hy2 + 1, 1.8, 4.5, 0, 0, Math.PI * 2); ctx.fill();
        // tail curled
        ctx.strokeStyle = CAT; ctx.lineWidth = 6; ctx.lineCap = "round";
        ctx.beginPath();
        ctx.moveTo(cx + 16, cy + 28);
        ctx.quadraticCurveTo(cx + 44, cy + 32, cx + 26, cy + 10);
        ctx.stroke();
      }

      ctx.restore();
    }

    // ── main animation loop ───────────────────────────────────────────────────
    function frame(ts: number) {
      if (!t0) t0 = ts;
      const t = ts - t0;

      drawBg();

      // Phase 1: snake crawls left→right, letters appear
      if (t <= TE) {
        const sn = eI(t / TE);
        hx = lerp(-40, 440, sn);
        hy = H / 2 - 18 + Math.sin(sn * Math.PI * 5) * 26;
        body.unshift({ x: hx, y: hy });
        if (body.length > SEGS) body.pop();
        la.forEach((_, i) => {
          if (hx > LX[i] - 10) la[i] = Math.min(1, la[i] + 0.08);
        });
      }

      // Phase 2: cat walks in
      if (t >= CS) {
        const ct = eO(nn(t, CS, CE));
        cx = lerp(W + 70, W * 0.72, ct);
        if (t < CE) cw = t / 180;
      }

      // Phase 3: snake wraps around neck
      if (t >= WS && t < WE) {
        const wt = nn(t, WS, WE);
        const nx = cx - 18, ny = cy - 22;
        const ang = -wt * Math.PI * 3.8;
        const r = lerp(65, 13, eO(wt));
        const tx = nx + Math.cos(ang) * r;
        const ty = ny + Math.sin(ang) * r * 0.42;
        hx += (tx - hx) * 0.12;
        hy += (ty - hy) * 0.12;
        body.unshift({ x: hx, y: hy });
        if (body.length > SEGS) body.pop();
      }

      drawLetters();
      drawSnake();

      if (t >= CS) {
        const mode: "walk" | "stop" | "sit" =
          t < CE ? "walk" : t < SS ? "stop" : "sit";
        drawCat(
          mode,
          mode === "sit" ? eO(nn(t, SS, SS + 700)) : undefined
        );
      }

      drawHead();

      // Fade to black at end
      if (t > TOTAL - 700) {
        const f = eI(nn(t, TOTAL - 700, TOTAL));
        ctx.fillStyle = `rgba(5,8,22,${f})`;
        ctx.fillRect(0, 0, W, H);
      }

      if (t < TOTAL) {
        rafRef.current = requestAnimationFrame(frame);
      } else if (!doneRef.current) {
        doneRef.current = true;
        onCompleteRef.current();
      }
    }

    rafRef.current = requestAnimationFrame(frame);

    return () => {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    };
  }, []);

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 9999,
        background: "#050816",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <canvas
        ref={canvasRef}
        style={{ display: "block", maxWidth: "100%", maxHeight: "100%" }}
      />
    </div>
  );
}
