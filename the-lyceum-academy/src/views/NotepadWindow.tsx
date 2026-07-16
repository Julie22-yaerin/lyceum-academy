/**
 * NotepadWindow — renders when ?panel=notepad is in the URL.
 * Communicates with LensView in the main window via BroadcastChannel('lyceum_notepad_v1').
 *
 * Protocol:
 *   Popup → Main : { type:'READY' }
 *   Main  → Popup: { type:'SYNC_QUESTION', question, idx, total, docKey }
 *   Main  → Popup: { type:'GRADE_RESULT', qId, passed, feedback }
 *   Popup → Main : { type:'ANSWER', qId, text?, dataURL? }
 *
 * This is a separate top-level window/document — it never mounts inside
 * <ThemeProvider>, so it can't read useTheme(). Instead it reads the same
 * 'lyceum-theme' localStorage key ThemeContext persists to directly, and
 * listens for the 'storage' event to stay in sync if the main window's
 * theme is flipped while this popup is open.
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { checkMastery, describeDrawing } from '../lib/api';
import { loadKaTeX, renderMath } from '../lib/math';
import { detectSubject } from '../lib/persist';

const MATH_SYMBOLS = [
  '÷','×','±','∓','√','∛','∜','∞','≈','≠','≤','≥',
  'α','β','γ','δ','ε','ζ','η','θ','ι','κ','λ','μ',
  'ν','ξ','π','ρ','σ','τ','υ','φ','χ','ψ','ω','Σ',
  'Δ','Γ','Λ','Π','Ω','∂','∇','∫','∬','∭','∮','∯',
  '⁰','¹','²','³','⁴','⁵','⁶','⁷','⁸','⁹','ⁿ','ˣ',
];

interface SyncedQuestion {
  id: string;
  prompt: string;
  difficulty: string;
  concepts: string[];
  page?: number;
}

interface GradeResult {
  passed: boolean;
  feedback: string;
}

type DrawTool = 'pen' | 'eraser' | 'line' | 'rect' | 'circle' | 'triangle';

function useNotepadTheme() {
  const [isLight, setIsLight] = useState(() => {
    try { return localStorage.getItem('lyceum-theme') === 'light'; } catch { return false; }
  });

  useEffect(() => {
    function sync() {
      try { setIsLight(localStorage.getItem('lyceum-theme') === 'light'); } catch { /* ignore */ }
    }
    window.addEventListener('storage', sync);
    return () => window.removeEventListener('storage', sync);
  }, []);

  return isLight;
}

export default function NotepadWindow() {
  const isLight = useNotepadTheme();
  const C = isLight ? {
    bg: '#FAF7F0', bar: '#EFE9DA', text: '#2A2620',
    textDim: 'rgba(42,38,32,0.55)', textFaint: 'rgba(42,38,32,0.35)',
    border: 'rgba(42,38,32,0.14)', borderStrong: 'rgba(42,38,32,0.22)',
    inputBg: 'rgba(42,38,32,0.045)', scrollTrack: '#e5ddc8', scrollThumb: '#c9bfa0',
  } : {
    bg: '#131313', bar: '#0e0e0e', text: '#F5F0E8',
    textDim: 'rgba(255,255,255,0.4)', textFaint: 'rgba(255,255,255,0.3)',
    border: 'rgba(255,255,255,0.08)', borderStrong: 'rgba(255,255,255,0.15)',
    inputBg: 'rgba(255,255,255,0.04)', scrollTrack: '#1a1a1a', scrollThumb: '#333',
  };

  const channelRef = useRef<BroadcastChannel | null>(null);
  const [qData, setQData]     = useState<{ question: SyncedQuestion; idx: number; total: number; docKey: string } | null>(null);
  const [connected, setConnected] = useState(false);

  // Input state
  const [mode, setMode]             = useState<'text' | 'canvas'>('text');
  const [answer, setAnswer]         = useState('');
  const [showMathKb, setShowMathKb] = useState(false);
  const [brushColor, setBrushColor] = useState('#F5F0E8');
  const [brushSize, setBrushSize]   = useState(3);
  const [drawTool, setDrawTool]     = useState<DrawTool>('pen');
  const [canvasTranscript, setCanvasTranscript] = useState('');
  const [busy, setBusy]             = useState(false);
  const [tearing, setTearing]       = useState(false);

  // Mastery check
  const [masteryResult, setMasteryResult] = useState<GradeResult | null>(null);

  // Grade result from main window
  const [gradeResult, setGradeResult] = useState<GradeResult | null>(null);

  const [, setKatexTick] = useState(0);
  useEffect(() => { loadKaTeX(() => setKatexTick(t => t + 1)); }, []);

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const canvasRef   = useRef<HTMLCanvasElement>(null);
  const drawing     = useRef(false);
  const lastPos     = useRef({ x: 0, y: 0 });
  const shapeStart      = useRef<{ x: number; y: number } | null>(null);
  const shapeSnapshot   = useRef<ImageData | null>(null);

  // ── BroadcastChannel ───────────────────────────────────────────────────────
  useEffect(() => {
    const ch = new BroadcastChannel('lyceum_notepad_v1');
    channelRef.current = ch;

    ch.onmessage = (e) => {
      const { type } = e.data;
      if (type === 'SYNC_QUESTION') {
        setQData({ question: e.data.question, idx: e.data.idx, total: e.data.total, docKey: e.data.docKey });
        setConnected(true);
        setAnswer('');
        setMasteryResult(null);
        setGradeResult(null);
        setCanvasTranscript('');
        clearCanvas();
      }
      if (type === 'GRADE_RESULT') {
        setGradeResult({ passed: e.data.passed, feedback: e.data.feedback });
      }
    };

    // Signal ready → main window will respond with current question
    ch.postMessage({ type: 'READY' });

    return () => { ch.close(); channelRef.current = null; };
  }, []);

  // Update window title
  useEffect(() => {
    if (qData) {
      document.title = `Q${qData.idx + 1}/${qData.total} — Lyceum Notepad`;
    } else {
      document.title = 'Lyceum Notepad';
    }
  }, [qData]);

  // ── Canvas helpers ─────────────────────────────────────────────────────────
  function clearCanvas() {
    canvasRef.current?.getContext('2d')?.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height);
    setCanvasTranscript('');
  }

  function getPos(e: React.MouseEvent | React.TouchEvent, canvas: HTMLCanvasElement) {
    const r = canvas.getBoundingClientRect();
    const sx = canvas.width / r.width, sy = canvas.height / r.height;
    if ('touches' in e) { const t = e.touches[0]; return { x: (t.clientX - r.left) * sx, y: (t.clientY - r.top) * sy }; }
    return { x: ((e as React.MouseEvent).clientX - r.left) * sx, y: ((e as React.MouseEvent).clientY - r.top) * sy };
  }

  function startDraw(e: React.MouseEvent | React.TouchEvent) {
    const c = canvasRef.current; if (!c) return;
    const ctx = c.getContext('2d'); if (!ctx) return;
    const pos = getPos(e, c);
    drawing.current = true;
    lastPos.current = pos;
    // Shape tools rubber-band a preview from a snapshot taken at the start —
    // pen/eraser just stroke continuously and need no snapshot.
    if (drawTool !== 'pen' && drawTool !== 'eraser') {
      shapeStart.current = pos;
      shapeSnapshot.current = ctx.getImageData(0, 0, c.width, c.height);
    }
  }

  function draw(e: React.MouseEvent | React.TouchEvent) {
    if (!drawing.current) return;
    const c = canvasRef.current; if (!c) return;
    const ctx = c.getContext('2d'); if (!ctx) return;
    e.preventDefault();
    const pos = getPos(e, c);

    if (drawTool === 'pen' || drawTool === 'eraser') {
      ctx.globalCompositeOperation = drawTool === 'eraser' ? 'destination-out' : 'source-over';
      ctx.strokeStyle = brushColor;
      ctx.lineWidth = drawTool === 'eraser' ? brushSize * 4 : brushSize;
      ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      ctx.beginPath(); ctx.moveTo(lastPos.current.x, lastPos.current.y); ctx.lineTo(pos.x, pos.y); ctx.stroke();
      lastPos.current = pos;
      return;
    }

    // Shape tools: restore the pre-drag snapshot, then draw a live preview
    // from the drag start point to the current pointer position.
    if (!shapeStart.current || !shapeSnapshot.current) return;
    ctx.putImageData(shapeSnapshot.current, 0, 0);
    ctx.globalCompositeOperation = 'source-over';
    ctx.strokeStyle = brushColor;
    ctx.lineWidth = brushSize;
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    const { x: x0, y: y0 } = shapeStart.current;
    ctx.beginPath();
    if (drawTool === 'line') {
      ctx.moveTo(x0, y0); ctx.lineTo(pos.x, pos.y);
    } else if (drawTool === 'rect') {
      ctx.rect(Math.min(x0, pos.x), Math.min(y0, pos.y), Math.abs(pos.x - x0), Math.abs(pos.y - y0));
    } else if (drawTool === 'circle') {
      const cx = (x0 + pos.x) / 2, cy = (y0 + pos.y) / 2;
      const rx = Math.abs(pos.x - x0) / 2, ry = Math.abs(pos.y - y0) / 2;
      ctx.ellipse(cx, cy, Math.max(rx, 0.01), Math.max(ry, 0.01), 0, 0, Math.PI * 2);
    } else if (drawTool === 'triangle') {
      const midX = (x0 + pos.x) / 2;
      ctx.moveTo(midX, Math.min(y0, pos.y));
      ctx.lineTo(Math.min(x0, pos.x), Math.max(y0, pos.y));
      ctx.lineTo(Math.max(x0, pos.x), Math.max(y0, pos.y));
      ctx.closePath();
    }
    ctx.stroke();
  }

  function stopDraw() {
    drawing.current = false;
    shapeStart.current = null;
    shapeSnapshot.current = null;
  }

  async function transcribeCanvas() {
    const c = canvasRef.current; if (!c) return;
    setBusy(true);
    try {
      const result = await describeDrawing(c.toDataURL('image/png'));
      setCanvasTranscript(result.text);
    } catch (err: any) { setCanvasTranscript('Could not transcribe: ' + err.message); }
    finally { setBusy(false); }
  }

  function insertSymbol(sym: string) {
    const ta = textareaRef.current; if (!ta) return;
    const s = ta.selectionStart, end = ta.selectionEnd;
    const v = answer.slice(0, s) + sym + answer.slice(end);
    setAnswer(v);
    setTimeout(() => { ta.selectionStart = ta.selectionEnd = s + sym.length; ta.focus(); }, 0);
  }

  // ── Mastery check ──────────────────────────────────────────────────────────
  async function handleCheck() {
    if (!qData) return;
    const ans = mode === 'text' ? answer : canvasTranscript;
    if (!ans.trim()) return;
    setBusy(true);
    const concepts = qData.question.concepts || [];
    const subject = concepts[0] ? detectSubject(concepts[0]) : detectSubject(qData.question.prompt);
    try { setMasteryResult(await checkMastery(qData.question.prompt, ans, concepts, subject)); }
    catch (err: any) { setMasteryResult({ passed: false, feedback: err.message }); }
    finally { setBusy(false); }
  }

  // ── OK → send answer back to main window ──────────────────────────────────
  async function handleOK() {
    if (!qData || !channelRef.current) return;
    const hasText   = mode === 'text' && answer.trim();
    const hasCanvas = mode === 'canvas' && canvasRef.current;
    if (!hasText && !hasCanvas) return;

    setTearing(true);
    await new Promise(r => setTimeout(r, 350));

    if (mode === 'canvas' && canvasRef.current) {
      channelRef.current.postMessage({
        type: 'ANSWER',
        qId: qData.question.id,
        dataURL: canvasRef.current.toDataURL('image/png'),
      });
      clearCanvas();
    } else {
      channelRef.current.postMessage({
        type: 'ANSWER',
        qId: qData.question.id,
        text: answer,
      });
      setAnswer('');
    }

    setTearing(false);
    setMasteryResult(null);
    setGradeResult(null);
  }

  const canAnswer = mode === 'text' ? answer.trim().length > 0 : canvasTranscript.trim().length > 0 || (canvasRef.current !== null);
  const DIFF_COLOR: Record<string, string> = {
    easy: '#4A7C59', medium: '#C5A059', hard: '#823B18', extreme: '#7C3AED',
  };

  // ── Waiting screen ─────────────────────────────────────────────────────────
  if (!qData) {
    return (
      <div style={{ background: C.bg, height: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: C.textDim, fontFamily: 'sans-serif' }}>
        <style>{`body{margin:0;background:${C.bg};} @keyframes pulse{0%,100%{opacity:.3}50%{opacity:.7}}`}</style>
        <div style={{ fontSize: 28, letterSpacing: 6, marginBottom: 16, animation: 'pulse 2s infinite', fontFamily: 'Georgia, serif', color: C.textFaint }}>THE LYCEUM</div>
        <p style={{ fontSize: 11, letterSpacing: 3, textTransform: 'uppercase', marginBottom: 8 }}>Notepad</p>
        <p style={{ fontSize: 10, letterSpacing: 1, opacity: 0.5, marginTop: 24 }}>Waiting for PDF to open in main window…</p>
      </div>
    );
  }

  const { question, idx, total } = qData;
  const diffColor = DIFF_COLOR[question.difficulty] || '#C5A059';

  return (
    <div style={{ background: C.bg, height: '100vh', display: 'flex', flexDirection: 'column', color: C.text, fontFamily: 'Georgia, serif', userSelect: 'none', overflow: 'hidden' }}>
      <style>{`
        * { box-sizing: border-box; }
        body { margin: 0; background: ${C.bg}; }
        textarea { font-family: Georgia, serif; }
        @keyframes tearOff {
          0%   { transform: scale(1) translateY(0); opacity: 1; }
          100% { transform: scale(0.6) translateY(-30px); opacity: 0; }
        }
        ::-webkit-scrollbar { width: 4px; } ::-webkit-scrollbar-track { background: ${C.scrollTrack}; } ::-webkit-scrollbar-thumb { background: ${C.scrollThumb}; }
      `}</style>

      {/* ── Header ── */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 16px', borderBottom: `1px solid ${C.border}`, background: C.bar, flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontFamily: 'sans-serif', fontSize: 9, letterSpacing: 3, textTransform: 'uppercase', color: C.textFaint }}>
            Q{idx + 1} / {total}
          </span>
          <span style={{ fontFamily: 'sans-serif', fontSize: 8, letterSpacing: 1, textTransform: 'uppercase', padding: '2px 6px', border: `1px solid ${diffColor}60`, color: diffColor }}>
            {question.difficulty}
          </span>
        </div>
      </div>

      {/* Intentionally no question text here — the popup is a pure input
          surface. The question itself lives in the main window; re-showing
          it here would just be a second, out-of-sync copy of the same text. */}

      {/* ── Mode tabs ── */}
      <div style={{ display: 'flex', borderBottom: `1px solid ${C.border}`, flexShrink: 0 }}>
        {(['text', 'canvas'] as const).map(m => (
          <button key={m} onClick={() => setMode(m)} style={{
            flex: 1, padding: '8px 0', fontFamily: 'sans-serif', fontSize: 9, letterSpacing: 3, textTransform: 'uppercase',
            background: mode === m ? C.inputBg : 'none',
            border: 'none', borderBottom: mode === m ? '2px solid rgba(251,191,36,0.8)' : '2px solid transparent',
            color: mode === m ? C.text : C.textFaint, cursor: 'pointer',
          }}>
            {m === 'text' ? '✍ Write' : '🖊 Draw'}
          </button>
        ))}
      </div>

      {/* ── Input area — expanded to fill essentially the whole popup, since
          there's no question block above it anymore ── */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', padding: '8px', gap: 8, minHeight: 0, overflow: 'hidden' }}>
        {masteryResult ? (
          <div style={{ border: `1px solid ${masteryResult.passed ? 'rgba(74,124,89,0.5)' : 'rgba(251,191,36,0.4)'}`, padding: 12, background: masteryResult.passed ? 'rgba(74,124,89,0.12)' : 'rgba(251,191,36,0.06)', borderRadius: 10 }}>
            <span style={{ fontFamily: 'sans-serif', fontSize: 9, letterSpacing: 2, textTransform: 'uppercase', display: 'block', marginBottom: 6, color: masteryResult.passed ? '#4A7C59' : '#C5A059' }}>
              {masteryResult.passed ? '✓ Mastered' : '◯ Keep Exploring'}
            </span>
            <p style={{ margin: 0, fontSize: 12, lineHeight: 1.6, color: C.text, opacity: 0.85 }}
              dangerouslySetInnerHTML={{ __html: renderMath(masteryResult.feedback) }} />
            <button onClick={() => setMasteryResult(null)} style={{ marginTop: 8, fontFamily: 'sans-serif', fontSize: 9, letterSpacing: 2, textTransform: 'uppercase', color: C.textFaint, background: 'none', border: 'none', cursor: 'pointer' }}>
              Try Again
            </button>
          </div>
        ) : mode === 'text' ? (
          <textarea
            ref={textareaRef}
            value={answer}
            onChange={e => setAnswer(e.target.value)}
            placeholder="Write your solution here…"
            style={{
              flex: 1, background: C.inputBg, border: `1px solid ${C.border}`,
              color: C.text, padding: '14px 16px', fontSize: 14, lineHeight: 1.7,
              resize: 'none', outline: 'none', borderRadius: 14,
              animation: tearing ? 'tearOff 0.35s ease-in both' : 'none',
              fontFamily: 'Georgia, serif',
            }}
          />
        ) : (
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 8, minHeight: 0 }}>
            <div style={{ flex: 1, border: `1px solid ${C.border}`, background: '#fff', borderRadius: 14, overflow: 'hidden', animation: tearing ? 'tearOff 0.35s ease-in both' : 'none', minHeight: 0 }}>
              <canvas ref={canvasRef} width={1400} height={900}
                style={{ width: '100%', height: '100%', cursor: drawTool === 'eraser' ? 'cell' : 'crosshair', touchAction: 'none', display: 'block' }}
                onMouseDown={startDraw} onMouseMove={draw} onMouseUp={stopDraw} onMouseLeave={stopDraw}
                onTouchStart={startDraw} onTouchMove={draw} onTouchEnd={stopDraw} />
            </div>
            {canvasTranscript && (
              <div style={{ border: `1px solid ${C.border}`, padding: '8px 12px', background: C.inputBg, borderRadius: 10, flexShrink: 0 }}>
                <span style={{ fontFamily: 'sans-serif', fontSize: 8, letterSpacing: 2, textTransform: 'uppercase', color: C.textFaint, display: 'block', marginBottom: 4 }}>Transcription</span>
                <p style={{ margin: 0, fontSize: 12, color: C.text, opacity: 0.8, lineHeight: 1.5 }}>{canvasTranscript}</p>
              </div>
            )}
          </div>
        )}

        {/* Math keyboard */}
        {showMathKb && mode === 'text' && (
          <div style={{ border: `1px solid ${C.border}`, padding: 8, background: C.inputBg, borderRadius: 12, flexShrink: 0 }}>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3 }}>
              {MATH_SYMBOLS.map(sym => (
                <button key={sym} onClick={() => insertSymbol(sym)} style={{
                  width: 30, height: 30, border: `1px solid ${C.borderStrong}`, background: C.inputBg,
                  color: C.text, fontSize: 11, fontFamily: 'monospace', cursor: 'pointer', borderRadius: 8,
                }}>
                  {sym}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* ── Grade result from main (after Submit) ── */}
      {gradeResult && (
        <div style={{ margin: '0 14px 10px', border: `1px solid ${gradeResult.passed ? 'rgba(74,124,89,0.5)' : 'rgba(220,38,38,0.4)'}`, padding: '10px 12px', background: gradeResult.passed ? 'rgba(74,124,89,0.12)' : 'rgba(220,38,38,0.08)', borderRadius: 10 }}>
          <span style={{ fontFamily: 'sans-serif', fontSize: 9, letterSpacing: 2, textTransform: 'uppercase', display: 'block', marginBottom: 5, color: gradeResult.passed ? '#4A7C59' : 'rgba(220,38,38,0.8)' }}>
            {gradeResult.passed ? '✓ Correct' : '✗ Wrong'}
          </span>
          <p style={{ margin: 0, fontSize: 11, lineHeight: 1.55, color: C.text, opacity: 0.75 }}
            dangerouslySetInnerHTML={{ __html: renderMath(gradeResult.feedback) }} />
        </div>
      )}

      {/* ── Toolbar ── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '10px 14px', borderTop: `1px solid ${C.border}`, flexShrink: 0, flexWrap: 'wrap', background: C.bar }}>
        {/* Math kb toggle */}
        {mode === 'text' && (
          <button onClick={() => setShowMathKb(v => !v)} style={{
            background: showMathKb ? C.inputBg : 'none',
            border: `1px solid ${C.borderStrong}`, borderRadius: 8, padding: '4px 10px',
            fontFamily: 'sans-serif', fontSize: 9, letterSpacing: 2, textTransform: 'uppercase',
            color: showMathKb ? C.text : C.textDim, cursor: 'pointer',
          }}>∑ Math</button>
        )}

        {/* Canvas controls */}
        {mode === 'canvas' && (
          <>
            {/* Tools: pen, eraser, ruler (straight line), basic shapes */}
            <div style={{ display: 'flex', gap: 2 }}>
              {([
                { id: 'pen',      label: '✎', title: 'Pen' },
                { id: 'eraser',   label: '⌫', title: 'Eraser' },
                { id: 'line',     label: '📏', title: 'Ruler — straight line' },
                { id: 'rect',     label: '▭', title: 'Square / rectangle' },
                { id: 'circle',   label: '◯', title: 'Circle' },
                { id: 'triangle', label: '△', title: 'Triangle' },
              ] as const).map(t => (
                <button key={t.id} onClick={() => setDrawTool(t.id)} title={t.title} style={{
                  width: 26, height: 26, border: `1px solid ${drawTool === t.id ? C.borderStrong : C.border}`,
                  background: drawTool === t.id ? C.inputBg : 'none', color: C.text,
                  fontSize: 13, cursor: 'pointer', borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0,
                }}>{t.label}</button>
              ))}
            </div>

            <div style={{ width: 1, height: 14, background: C.borderStrong, margin: '0 4px' }} />

            {/* Color presets + a real color wheel via the native picker */}
            {['#F5F0E8','#C5A059','#4A7C59','#2563EB','#DC2626'].map(c => (
              <button key={c} onClick={() => setBrushColor(c)} style={{
                width: 18, height: 18, borderRadius: '50%', background: c, border: brushColor === c ? `2px solid ${C.text}` : '2px solid transparent', cursor: 'pointer', padding: 0,
              }} />
            ))}
            <input type="color" value={brushColor} onChange={e => setBrushColor(e.target.value)} title="Custom color"
              style={{ width: 22, height: 22, padding: 0, border: 'none', background: 'none', cursor: 'pointer', borderRadius: 6 }} />

            <div style={{ width: 1, height: 14, background: C.borderStrong, margin: '0 4px' }} />

            {/* Pen/shape thickness */}
            <input type="range" min={1} max={24} value={brushSize} onChange={e => setBrushSize(Number(e.target.value))}
              title={`Size: ${brushSize}px`} style={{ width: 56, cursor: 'pointer' }} />
            <span style={{ fontFamily: 'sans-serif', fontSize: 9, color: C.textDim, minWidth: 14, textAlign: 'right' }}>{brushSize}</span>

            <div style={{ width: 1, height: 14, background: C.borderStrong, margin: '0 4px' }} />

            <button onClick={clearCanvas} style={{ fontFamily: 'sans-serif', fontSize: 9, letterSpacing: 2, textTransform: 'uppercase', background: 'none', border: 'none', color: C.textFaint, cursor: 'pointer' }}>Clear</button>
            <button onClick={transcribeCanvas} disabled={busy} style={{ fontFamily: 'sans-serif', fontSize: 9, letterSpacing: 2, textTransform: 'uppercase', background: 'none', border: 'none', color: C.textDim, cursor: 'pointer' }}>Read</button>
          </>
        )}

        <div style={{ flex: 1 }} />

        {/* Check mastery */}
        <button onClick={handleCheck} disabled={busy || !!masteryResult || !canAnswer}
          style={{ fontFamily: 'sans-serif', fontSize: 9, letterSpacing: 2, textTransform: 'uppercase', background: 'none', border: 'none', color: C.textFaint, cursor: 'pointer', opacity: canAnswer ? 1 : 0.3 }}>
          {busy ? '…' : 'Check'}
        </button>

        {/* OK */}
        <button onClick={handleOK} disabled={tearing || !canAnswer}
          style={{
            padding: '7px 22px', fontFamily: 'sans-serif', fontSize: 10, letterSpacing: 3, textTransform: 'uppercase', fontWeight: 700,
            background: canAnswer ? 'rgba(251,191,36,1)' : 'rgba(251,191,36,0.2)',
            color: canAnswer ? '#1a1a1a' : C.textFaint,
            border: 'none', cursor: canAnswer ? 'pointer' : 'not-allowed', borderRadius: 10, transition: 'all 0.15s',
          }}>
          {tearing ? '…' : 'OK'}
        </button>
      </div>
    </div>
  );
}
