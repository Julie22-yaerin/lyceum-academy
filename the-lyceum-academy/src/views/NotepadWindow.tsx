/**
 * NotepadWindow — renders when ?panel=notepad is in the URL.
 * Communicates with LensView in the main window via BroadcastChannel('lyceum_notepad_v1').
 *
 * Protocol:
 *   Popup → Main : { type:'READY' }
 *   Main  → Popup: { type:'SYNC_QUESTION', question, idx, total, docKey }
 *   Main  → Popup: { type:'GRADE_RESULT', qId, passed, feedback }
 *   Popup → Main : { type:'ANSWER', qId, text?, dataURL? }
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { checkMastery, describeDrawing } from '../lib/api';
import { loadKaTeX, renderMath } from '../lib/math';

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

export default function NotepadWindow() {
  const channelRef = useRef<BroadcastChannel | null>(null);
  const [qData, setQData]     = useState<{ question: SyncedQuestion; idx: number; total: number; docKey: string } | null>(null);
  const [connected, setConnected] = useState(false);

  // Input state
  const [mode, setMode]             = useState<'text' | 'canvas'>('text');
  const [answer, setAnswer]         = useState('');
  const [showMathKb, setShowMathKb] = useState(false);
  const [brushColor, setBrushColor] = useState('#F5F0E8');
  const [brushSize, setBrushSize]   = useState(3);
  const [canvasTranscript, setCanvasTranscript] = useState('');
  const [busy, setBusy]             = useState(false);
  const [showQuestion, setShowQuestion] = useState(true);
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
    drawing.current = true; lastPos.current = getPos(e, c);
  }

  function draw(e: React.MouseEvent | React.TouchEvent) {
    if (!drawing.current) return;
    const c = canvasRef.current; if (!c) return;
    const ctx = c.getContext('2d'); if (!ctx) return;
    e.preventDefault();
    const pos = getPos(e, c);
    ctx.strokeStyle = brushColor; ctx.lineWidth = brushSize; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.beginPath(); ctx.moveTo(lastPos.current.x, lastPos.current.y); ctx.lineTo(pos.x, pos.y); ctx.stroke();
    lastPos.current = pos;
  }

  function stopDraw() { drawing.current = false; }

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
    try { setMasteryResult(await checkMastery(qData.question.prompt, ans)); }
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
      <div style={{ background: '#111', height: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: 'rgba(255,255,255,0.4)', fontFamily: 'sans-serif' }}>
        <style>{`body{margin:0;background:#111;} @keyframes pulse{0%,100%{opacity:.3}50%{opacity:.7}}`}</style>
        <div style={{ fontSize: 28, letterSpacing: 6, marginBottom: 16, animation: 'pulse 2s infinite', fontFamily: 'Georgia, serif', color: 'rgba(255,255,255,0.25)' }}>THE LYCEUM</div>
        <p style={{ fontSize: 11, letterSpacing: 3, textTransform: 'uppercase', marginBottom: 8 }}>Notepad</p>
        <p style={{ fontSize: 10, letterSpacing: 1, opacity: 0.5, marginTop: 24 }}>Waiting for PDF to open in main window…</p>
      </div>
    );
  }

  const { question, idx, total } = qData;
  const diffColor = DIFF_COLOR[question.difficulty] || '#C5A059';

  return (
    <div style={{ background: '#131313', minHeight: '100vh', display: 'flex', flexDirection: 'column', color: '#F5F0E8', fontFamily: 'Georgia, serif', userSelect: 'none' }}>
      <style>{`
        * { box-sizing: border-box; }
        body { margin: 0; background: #131313; }
        textarea { font-family: Georgia, serif; }
        @keyframes tearOff {
          0%   { transform: scale(1) translateY(0); opacity: 1; }
          100% { transform: scale(0.6) translateY(-30px); opacity: 0; }
        }
        ::-webkit-scrollbar { width: 4px; } ::-webkit-scrollbar-track { background: #1a1a1a; } ::-webkit-scrollbar-thumb { background: #333; }
      `}</style>

      {/* ── Header ── */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 16px', borderBottom: '1px solid rgba(255,255,255,0.08)', background: '#0e0e0e', flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontFamily: 'sans-serif', fontSize: 9, letterSpacing: 3, textTransform: 'uppercase', color: 'rgba(255,255,255,0.35)' }}>
            Q{idx + 1} / {total}
          </span>
          <span style={{ fontFamily: 'sans-serif', fontSize: 8, letterSpacing: 1, textTransform: 'uppercase', padding: '2px 6px', border: `1px solid ${diffColor}60`, color: diffColor }}>
            {question.difficulty}
          </span>
        </div>
        <button
          onClick={() => setShowQuestion(v => !v)}
          style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'rgba(255,255,255,0.35)', fontSize: 11, letterSpacing: 2, textTransform: 'uppercase', fontFamily: 'sans-serif' }}>
          {showQuestion ? 'Hide Q' : 'Show Q'}
        </button>
      </div>

      {/* ── Question ── */}
      {showQuestion && (
        <div style={{ padding: '12px 16px', borderBottom: '1px solid rgba(255,255,255,0.06)', background: '#0e0e0e', flexShrink: 0, maxHeight: 160, overflowY: 'auto' }}>
          <div style={{ fontSize: 13, lineHeight: 1.6, color: 'rgba(255,255,255,0.8)' }}
            dangerouslySetInnerHTML={{ __html: renderMath(question.prompt) }} />
          {question.concepts.length > 0 && (
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 8 }}>
              {question.concepts.map(c => (
                <span key={c} style={{ fontSize: 8, letterSpacing: 1, textTransform: 'uppercase', fontFamily: 'sans-serif', border: '1px solid rgba(255,255,255,0.15)', padding: '1px 6px', color: 'rgba(255,255,255,0.35)' }}>{c}</span>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── Mode tabs ── */}
      <div style={{ display: 'flex', borderBottom: '1px solid rgba(255,255,255,0.08)', flexShrink: 0 }}>
        {(['text', 'canvas'] as const).map(m => (
          <button key={m} onClick={() => setMode(m)} style={{
            flex: 1, padding: '8px 0', fontFamily: 'sans-serif', fontSize: 9, letterSpacing: 3, textTransform: 'uppercase',
            background: mode === m ? 'rgba(255,255,255,0.08)' : 'none',
            border: 'none', borderBottom: mode === m ? '2px solid rgba(251,191,36,0.8)' : '2px solid transparent',
            color: mode === m ? '#F5F0E8' : 'rgba(255,255,255,0.3)', cursor: 'pointer',
          }}>
            {m === 'text' ? '✍ Write' : '🖊 Draw'}
          </button>
        ))}
      </div>

      {/* ── Input area ── */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', padding: '12px 14px', gap: 10, minHeight: 0, overflow: 'hidden' }}>
        {masteryResult ? (
          <div style={{ border: `1px solid ${masteryResult.passed ? 'rgba(74,124,89,0.5)' : 'rgba(251,191,36,0.4)'}`, padding: 12, background: masteryResult.passed ? 'rgba(74,124,89,0.12)' : 'rgba(251,191,36,0.06)', borderRadius: 3 }}>
            <span style={{ fontFamily: 'sans-serif', fontSize: 9, letterSpacing: 2, textTransform: 'uppercase', display: 'block', marginBottom: 6, color: masteryResult.passed ? '#4A7C59' : '#C5A059' }}>
              {masteryResult.passed ? '✓ Mastered' : '◯ Keep Exploring'}
            </span>
            <p style={{ margin: 0, fontSize: 12, lineHeight: 1.6, color: 'rgba(255,255,255,0.75)' }}
              dangerouslySetInnerHTML={{ __html: renderMath(masteryResult.feedback) }} />
            <button onClick={() => setMasteryResult(null)} style={{ marginTop: 8, fontFamily: 'sans-serif', fontSize: 9, letterSpacing: 2, textTransform: 'uppercase', color: 'rgba(255,255,255,0.3)', background: 'none', border: 'none', cursor: 'pointer' }}>
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
              flex: 1, background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.1)',
              color: '#F5F0E8', padding: '12px 14px', fontSize: 13, lineHeight: 1.65,
              resize: 'none', outline: 'none', borderRadius: 3,
              animation: tearing ? 'tearOff 0.35s ease-in both' : 'none',
              fontFamily: 'Georgia, serif',
            }}
          />
        ) : (
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 8, minHeight: 0 }}>
            <div style={{ flex: 1, border: '1px solid rgba(255,255,255,0.1)', background: '#fff', borderRadius: 3, overflow: 'hidden', animation: tearing ? 'tearOff 0.35s ease-in both' : 'none', minHeight: 0 }}>
              <canvas ref={canvasRef} width={900} height={500}
                style={{ width: '100%', height: '100%', cursor: 'crosshair', touchAction: 'none', display: 'block' }}
                onMouseDown={startDraw} onMouseMove={draw} onMouseUp={stopDraw} onMouseLeave={stopDraw}
                onTouchStart={startDraw} onTouchMove={draw} onTouchEnd={stopDraw} />
            </div>
            {canvasTranscript && (
              <div style={{ border: '1px solid rgba(255,255,255,0.1)', padding: '8px 12px', background: 'rgba(255,255,255,0.04)', borderRadius: 3, flexShrink: 0 }}>
                <span style={{ fontFamily: 'sans-serif', fontSize: 8, letterSpacing: 2, textTransform: 'uppercase', color: 'rgba(255,255,255,0.3)', display: 'block', marginBottom: 4 }}>Transcription</span>
                <p style={{ margin: 0, fontSize: 12, color: 'rgba(255,255,255,0.7)', lineHeight: 1.5 }}>{canvasTranscript}</p>
              </div>
            )}
          </div>
        )}

        {/* Math keyboard */}
        {showMathKb && mode === 'text' && (
          <div style={{ border: '1px solid rgba(255,255,255,0.1)', padding: 8, background: 'rgba(255,255,255,0.03)', borderRadius: 3, flexShrink: 0 }}>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3 }}>
              {MATH_SYMBOLS.map(sym => (
                <button key={sym} onClick={() => insertSymbol(sym)} style={{
                  width: 30, height: 30, border: '1px solid rgba(255,255,255,0.12)', background: 'rgba(255,255,255,0.04)',
                  color: '#F5F0E8', fontSize: 11, fontFamily: 'monospace', cursor: 'pointer', borderRadius: 2,
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
        <div style={{ margin: '0 14px 10px', border: `1px solid ${gradeResult.passed ? 'rgba(74,124,89,0.5)' : 'rgba(220,38,38,0.4)'}`, padding: '10px 12px', background: gradeResult.passed ? 'rgba(74,124,89,0.12)' : 'rgba(220,38,38,0.08)', borderRadius: 3 }}>
          <span style={{ fontFamily: 'sans-serif', fontSize: 9, letterSpacing: 2, textTransform: 'uppercase', display: 'block', marginBottom: 5, color: gradeResult.passed ? '#4A7C59' : 'rgba(220,38,38,0.8)' }}>
            {gradeResult.passed ? '✓ Correct' : '✗ Wrong'}
          </span>
          <p style={{ margin: 0, fontSize: 11, lineHeight: 1.55, color: 'rgba(255,255,255,0.65)' }}
            dangerouslySetInnerHTML={{ __html: renderMath(gradeResult.feedback) }} />
        </div>
      )}

      {/* ── Toolbar ── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '10px 14px', borderTop: '1px solid rgba(255,255,255,0.08)', flexShrink: 0, flexWrap: 'wrap', background: '#0e0e0e' }}>
        {/* Math kb toggle */}
        {mode === 'text' && (
          <button onClick={() => setShowMathKb(v => !v)} style={{
            background: showMathKb ? 'rgba(255,255,255,0.1)' : 'none',
            border: '1px solid rgba(255,255,255,0.15)', borderRadius: 3, padding: '4px 10px',
            fontFamily: 'sans-serif', fontSize: 9, letterSpacing: 2, textTransform: 'uppercase',
            color: showMathKb ? '#F5F0E8' : 'rgba(255,255,255,0.4)', cursor: 'pointer',
          }}>∑ Math</button>
        )}

        {/* Canvas controls */}
        {mode === 'canvas' && (
          <>
            {['#F5F0E8','#C5A059','#4A7C59','#2563EB','#DC2626'].map(c => (
              <button key={c} onClick={() => setBrushColor(c)} style={{
                width: 18, height: 18, borderRadius: '50%', background: c, border: brushColor === c ? '2px solid white' : '2px solid transparent', cursor: 'pointer',
              }} />
            ))}
            <div style={{ width: 1, height: 14, background: 'rgba(255,255,255,0.15)', margin: '0 2px' }} />
            {[2, 4, 7].map(s => (
              <button key={s} onClick={() => setBrushSize(s)} style={{
                padding: '2px 7px', border: `1px solid ${brushSize === s ? 'rgba(255,255,255,0.6)' : 'rgba(255,255,255,0.15)'}`,
                background: brushSize === s ? 'rgba(255,255,255,0.1)' : 'none', color: '#F5F0E8',
                fontFamily: 'sans-serif', fontSize: 9, cursor: 'pointer', borderRadius: 2,
              }}>{s}</button>
            ))}
            <button onClick={clearCanvas} style={{ fontFamily: 'sans-serif', fontSize: 9, letterSpacing: 2, textTransform: 'uppercase', background: 'none', border: 'none', color: 'rgba(255,255,255,0.3)', cursor: 'pointer' }}>Clear</button>
            <button onClick={transcribeCanvas} disabled={busy} style={{ fontFamily: 'sans-serif', fontSize: 9, letterSpacing: 2, textTransform: 'uppercase', background: 'none', border: 'none', color: 'rgba(255,255,255,0.45)', cursor: 'pointer' }}>Read</button>
          </>
        )}

        <div style={{ flex: 1 }} />

        {/* Check mastery */}
        <button onClick={handleCheck} disabled={busy || !!masteryResult || !canAnswer}
          style={{ fontFamily: 'sans-serif', fontSize: 9, letterSpacing: 2, textTransform: 'uppercase', background: 'none', border: 'none', color: 'rgba(255,255,255,0.3)', cursor: 'pointer', opacity: canAnswer ? 1 : 0.3 }}>
          {busy ? '…' : 'Check'}
        </button>

        {/* OK */}
        <button onClick={handleOK} disabled={tearing || !canAnswer}
          style={{
            padding: '7px 22px', fontFamily: 'sans-serif', fontSize: 10, letterSpacing: 3, textTransform: 'uppercase', fontWeight: 700,
            background: canAnswer ? 'rgba(251,191,36,1)' : 'rgba(251,191,36,0.2)',
            color: canAnswer ? '#1a1a1a' : 'rgba(255,255,255,0.2)',
            border: 'none', cursor: canAnswer ? 'pointer' : 'not-allowed', borderRadius: 3, transition: 'all 0.15s',
          }}>
          {tearing ? '…' : 'OK'}
        </button>
      </div>
    </div>
  );
}
