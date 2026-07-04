import { useState, useRef, useCallback, useEffect } from 'react';
import { uploadProblemSet, decomposeProblemSet, checkMastery, describeDrawing, getUsage, cleanQuestion, gradeAll, gradeDual, analyzePage } from '../lib/api';
import { saveGradeSession } from '../lib/progress';
import { saveMistake } from '../lib/mistakes';
import { loadKaTeX, renderMath } from '../lib/math';
import { loadPSets, savePSet, deletePSet, savePages, loadPages, timeAgo, type SavedPSet } from '../lib/persist';
import MindMapTool from '../components/MindMapTool';

// ── Math keyboard symbols ─────────────────────────────────────────────────
const MATH_SYMBOLS = [
  '÷','×','±','∓','√','∛','∜','∞','≈','≠','≤','≥',
  'α','β','γ','δ','ε','ζ','η','θ','ι','κ','λ','μ',
  'ν','ξ','π','ρ','σ','τ','υ','φ','χ','ψ','ω','Σ',
  'Δ','Γ','Λ','Π','Ω','∂','∇','∫','∬','∭','∮','∯',
  '⁰','¹','²','³','⁴','⁵','⁶','⁷','⁸','⁹','ⁿ','ˣ',
  '₀','₁','₂','₃','₄','₅','₆','₇','₈','₉','ₙ','ₓ',
  '∀','∃','∄','∈','∉','⊂','⊃','⊆','⊇','∩','∪','∅',
  '→','←','↔','⇒','⇐','⇔','↑','↓','⊕','⊗','⊙','∝',
];

interface Question {
  id: string;
  prompt: string;
  difficulty: 'easy' | 'medium' | 'hard';
  concepts: string[];
  page?: number;     // 0-based (lens mode)
  yStart?: number;   // % from top (lens mode)
  yEnd?: number;     // % from top (lens mode)
  image_url?: string;
}

interface GradeSuggestion {
  concept: string;
  ask_lyceum: string;
  google_links: { title: string; url: string }[];
}

interface PdfPage {
  index: number;
  width: number;
  height: number;
  data: string; // base64 JPEG
}

interface Highlight {
  id: string;
  pageIndex: number;
  x: number; y: number; w: number; h: number; // all in % of page dimensions
  color: string;
}

const HL_COLORS = [
  { label: 'Yellow', value: 'rgba(253,224,71,0.48)'  },
  { label: 'Green',  value: 'rgba(74,222,128,0.45)'  },
  { label: 'Blue',   value: 'rgba(96,165,250,0.45)'  },
  { label: 'Pink',   value: 'rgba(249,168,212,0.5)'  },
  { label: 'Orange', value: 'rgba(251,146,60,0.45)'  },
];

// ── Difficulty badge ──────────────────────────────────────────────────────
function DiffBadge({ d }: { d: string }) {
  const map: Record<string, string> = {
    easy: 'text-emerald-700 border-emerald-200 bg-emerald-50',
    medium: 'text-amber-700 border-amber-200 bg-amber-50',
    hard: 'text-red-700 border-red-200 bg-red-50',
    extreme: 'text-purple-700 border-purple-200 bg-purple-50',
  };
  return (
    <span className={`border px-2 py-0.5 font-sans text-[9px] uppercase tracking-[1px] ${map[d] || 'border-outline-variant/50 text-on-surface opacity-60'}`}>
      {d}
    </span>
  );
}

// ── Answer panel — shared between LensView and FocusOverlay ──────────────
function AnswerPanel({
  question,
  onClean,
  onOK,
}: {
  question: Question;
  onClean?: () => Promise<void>;
  onOK?: (answer: string) => void;
}) {
  const [mode, setMode] = useState<'text' | 'canvas'>('text');
  const [answer, setAnswer] = useState('');
  const [showMathKb, setShowMathKb] = useState(false);
  const [masteryResult, setMasteryResult] = useState<{ passed: boolean; feedback: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [distilling, setDistilling] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const lastPos = useRef({ x: 0, y: 0 });
  const [canvasTranscript, setCanvasTranscript] = useState('');
  const [brushColor, setBrushColor] = useState('#1A1A1A');
  const [brushSize, setBrushSize] = useState(3);

  const [, setKatexTick] = useState(0);
  useEffect(() => { loadKaTeX(() => setKatexTick(t => t + 1)); }, []);

  useEffect(() => {
    setAnswer('');
    setMasteryResult(null);
    setCanvasTranscript('');
    if (canvasRef.current) {
      canvasRef.current.getContext('2d')?.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height);
    }
  }, [question.id]);

  function getPos(e: React.MouseEvent | React.TouchEvent, canvas: HTMLCanvasElement) {
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    if ('touches' in e) {
      const t = e.touches[0];
      return { x: (t.clientX - rect.left) * scaleX, y: (t.clientY - rect.top) * scaleY };
    }
    return { x: ((e as React.MouseEvent).clientX - rect.left) * scaleX, y: ((e as React.MouseEvent).clientY - rect.top) * scaleY };
  }

  function startDraw(e: React.MouseEvent | React.TouchEvent) {
    const canvas = canvasRef.current; if (!canvas) return;
    drawing.current = true; lastPos.current = getPos(e, canvas);
  }

  function draw(e: React.MouseEvent | React.TouchEvent) {
    if (!drawing.current) return;
    const canvas = canvasRef.current; if (!canvas) return;
    const ctx = canvas.getContext('2d'); if (!ctx) return;
    e.preventDefault();
    const pos = getPos(e, canvas);
    ctx.strokeStyle = brushColor; ctx.lineWidth = brushSize; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.beginPath(); ctx.moveTo(lastPos.current.x, lastPos.current.y); ctx.lineTo(pos.x, pos.y); ctx.stroke();
    lastPos.current = pos;
  }

  function stopDraw() { drawing.current = false; }

  function clearCanvas() {
    const canvas = canvasRef.current; if (!canvas) return;
    canvas.getContext('2d')?.clearRect(0, 0, canvas.width, canvas.height);
    setCanvasTranscript('');
  }

  async function transcribeCanvas() {
    const canvas = canvasRef.current; if (!canvas) return;
    setBusy(true);
    try {
      const result = await describeDrawing(canvas.toDataURL('image/png'));
      setCanvasTranscript(result.text);
    } catch (e: any) { setCanvasTranscript('Could not transcribe: ' + e.message); }
    finally { setBusy(false); }
  }

  async function handleMastery() {
    const ans = mode === 'text' ? answer : canvasTranscript;
    if (!ans.trim()) return;
    setBusy(true);
    try { setMasteryResult(await checkMastery(question.prompt, ans)); }
    catch (e: any) { setMasteryResult({ passed: false, feedback: 'Error: ' + e.message }); }
    finally { setBusy(false); }
  }

  function insertSymbol(sym: string) {
    const ta = textareaRef.current; if (!ta) return;
    const s = ta.selectionStart, end = ta.selectionEnd;
    const v = answer.slice(0, s) + sym + answer.slice(end);
    setAnswer(v);
    setTimeout(() => { ta.selectionStart = ta.selectionEnd = s + sym.length; ta.focus(); }, 0);
  }

  return (
    <div className="flex flex-col gap-4 h-full">
      {/* Mode tabs */}
      <div className="flex gap-0 border border-outline-variant/30 self-start flex-shrink-0">
        {(['text', 'canvas'] as const).map(m => (
          <button key={m} onClick={() => setMode(m)}
            className={`px-5 py-2 font-sans text-[10px] uppercase tracking-[2px] transition-colors ${mode === m ? 'bg-on-surface text-surface' : 'hover:bg-surface-container-highest'}`}>
            {m === 'text' ? 'Write' : 'Draw'}
          </button>
        ))}
      </div>

      {mode === 'text' ? (
        <>
          <textarea ref={textareaRef} value={answer} onChange={e => setAnswer(e.target.value)}
            placeholder="Write your solution here…"
            className="flex-1 min-h-[140px] bg-surface-container-lowest border border-outline-variant/30 p-4 font-sans text-sm resize-none outline-none focus:border-on-surface/50 transition-colors placeholder:text-outline-variant/60" />
          {showMathKb && (
            <div className="border border-outline-variant/30 p-3 bg-surface-container-lowest flex-shrink-0">
              <div className="flex flex-wrap gap-1">
                {MATH_SYMBOLS.map(sym => (
                  <button key={sym} onClick={() => insertSymbol(sym)}
                    className="w-8 h-8 border border-outline-variant/30 text-xs font-mono hover:bg-surface-container-highest transition-colors flex items-center justify-center">
                    {sym}
                  </button>
                ))}
              </div>
            </div>
          )}
          <button onClick={() => setShowMathKb(v => !v)}
            className={`font-sans text-[10px] uppercase tracking-[2px] flex items-center gap-2 self-start transition-opacity ${showMathKb ? 'opacity-100' : 'opacity-40 hover:opacity-100'}`}>
            <span className="material-symbols-outlined text-[16px]">functions</span>Math
          </button>
        </>
      ) : (
        <>
          <div className="border border-outline-variant/30 relative bg-white flex-shrink-0" style={{ aspectRatio: '4/3' }}>
            <canvas ref={canvasRef} width={800} height={600} className="w-full h-full cursor-crosshair touch-none"
              onMouseDown={startDraw} onMouseMove={draw} onMouseUp={stopDraw} onMouseLeave={stopDraw}
              onTouchStart={startDraw} onTouchMove={draw} onTouchEnd={stopDraw} />
          </div>
          <div className="flex items-center gap-3 flex-wrap flex-shrink-0">
            {['#1A1A1A','#C5A059','#823b18','#2563eb','#dc2626'].map(c => (
              <button key={c} onClick={() => setBrushColor(c)}
                className={`w-5 h-5 border-2 ${brushColor === c ? 'border-on-surface' : 'border-transparent'}`}
                style={{ backgroundColor: c }} />
            ))}
            <div className="w-[1px] h-4 bg-outline-variant/40" />
            {[2,4,8].map(s => (
              <button key={s} onClick={() => setBrushSize(s)}
                className={`px-2 py-0.5 border font-sans text-[10px] ${brushSize === s ? 'border-on-surface bg-on-surface text-surface' : 'border-outline-variant/30'}`}>
                {s}
              </button>
            ))}
            <button onClick={clearCanvas} className="font-sans text-[10px] uppercase tracking-[2px] opacity-40 hover:opacity-100 transition-opacity ml-2">Clear</button>
            <button onClick={transcribeCanvas} disabled={busy}
              className="font-sans text-[10px] uppercase tracking-[2px] opacity-60 hover:opacity-100 transition-opacity disabled:opacity-25 flex items-center gap-1">
              <span className="material-symbols-outlined text-[14px]">document_scanner</span>Read
            </button>
          </div>
          {canvasTranscript && (
            <div className="border border-outline-variant/30 p-3 bg-surface-container-lowest flex-shrink-0">
              <span className="font-sans text-[10px] uppercase tracking-[2px] opacity-40 block mb-1">Transcription</span>
              <p className="font-sans text-sm leading-relaxed">{canvasTranscript}</p>
            </div>
          )}
        </>
      )}

      <div className="flex items-center gap-4 flex-shrink-0">
        {onClean && (
          <button onClick={async () => { setDistilling(true); try { await onClean(); } finally { setDistilling(false); } }}
            disabled={busy || distilling}
            className="flex items-center gap-2 text-on-surface font-sans text-[10px] uppercase tracking-[2px] opacity-50 hover:opacity-100 transition-opacity disabled:opacity-25">
            {distilling ? <div className="w-3 h-3 border border-on-surface/40 border-t-on-surface rounded-full animate-spin" /> : <span className="text-[12px]">✦</span>}
            Distil
          </button>
        )}
      </div>

      {/* Mastery result */}
      {masteryResult && (
        <div className={`border p-4 flex-shrink-0 ${masteryResult.passed ? 'border-emerald-200 bg-emerald-50' : 'border-amber-200 bg-amber-50'}`}>
          <span className={`font-sans text-[10px] uppercase tracking-[2px] font-semibold block mb-2 ${masteryResult.passed ? 'text-emerald-700' : 'text-amber-700'}`}>
            {masteryResult.passed ? '✓ Mastered' : '◯ Keep Exploring'}
          </span>
          <p className="font-sans text-sm leading-relaxed opacity-80" dangerouslySetInnerHTML={{ __html: renderMath(masteryResult.feedback) }} />
          <button onClick={() => setMasteryResult(null)}
            className="mt-3 font-sans text-[10px] uppercase tracking-[2px] opacity-50 hover:opacity-100 transition-opacity">
            Try Again
          </button>
        </div>
      )}

      {/* Action row: Check (secondary) + OK (primary) */}
      <div className="flex items-center gap-3 flex-shrink-0">
        <button onClick={handleMastery}
          disabled={busy || !!masteryResult || (mode === 'text' ? !answer.trim() : !canvasTranscript.trim())}
          className="flex items-center gap-1.5 text-on-surface font-sans text-[10px] uppercase tracking-[2px] opacity-40 hover:opacity-80 transition-opacity disabled:opacity-20">
          <span className="material-symbols-outlined text-[14px]">verified</span>Check
        </button>
        {onOK && (
          <button
            onClick={() => {
              const ans = mode === 'text' ? answer : canvasTranscript;
              if (!ans.trim()) return;
              onOK(ans);
              setAnswer('');
              setMasteryResult(null);
            }}
            disabled={mode === 'text' ? !answer.trim() : !canvasTranscript.trim()}
            className={`ml-auto px-6 py-2.5 font-sans text-[10px] uppercase tracking-[2px] font-bold transition-all ${
              (mode === 'text' ? answer.trim() : canvasTranscript.trim())
                ? 'bg-amber-400 text-amber-950 hover:bg-amber-300'
                : 'bg-amber-400/25 text-amber-900/40 cursor-not-allowed'
            }`}>
            OK
          </button>
        )}
      </div>
    </div>
  );
}

// ── Lens View (PDF mode) — vertical split: PDF top, notepad bottom ────────
function LensView({
  questions,
  pages,
  docKey,
  startIdx = 0,
  totalPages = 0,
  allPagesLoaded = false,
  onExit,
  onClean,
  onPageBoundary,
  onNavigate,
}: {
  questions: Question[];
  pages: PdfPage[];
  docKey: string;
  startIdx?: number;
  totalPages?: number;
  allPagesLoaded?: boolean;
  onExit: (currentIdx: number) => void;
  onClean: (idx: number) => Promise<void>;
  onPageBoundary?: (nextPage: number) => void;
  onNavigate?: (view: string) => void;
}) {
  const [idx, setIdx] = useState(startIdx);
  const [mode, setMode] = useState<'text' | 'canvas'>('text');
  const [answer, setAnswer] = useState('');
  const [showMathKb, setShowMathKb] = useState(false);
  const [masteryResult, setMasteryResult] = useState<{ passed: boolean; feedback: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [distilling, setDistilling] = useState(false);
  const [brushColor, setBrushColor] = useState('#1A1A1A');
  const [brushSize, setBrushSize] = useState(3);
  const [canvasTranscript, setCanvasTranscript] = useState('');
  const [showQuestion, setShowQuestion] = useState(false);
  const [, setKatexTick] = useState(0);

  // ── Detachable notepad popup ──
  const notesChannelRef = useRef<BroadcastChannel | null>(null);
  const popupRef = useRef<Window | null>(null);
  const [popupOpen, setPopupOpen] = useState(false);

  // ── Pasted notes state ──
  const [pastedNotes, setPastedNotes] = useState<Record<string, string>>({});   // qId → answer text
  const [pastedImages, setPastedImages] = useState<Record<string, string>>({});  // qId → canvas dataURL
  const [tearing, setTearing] = useState(false);

  // ── Submit + grading state ──
  const [gradeResults, setGradeResults] = useState<Record<string, { passed: boolean; feedback: string; suggestions?: GradeSuggestion }>>({});
  const [grading, setGrading] = useState(false);
  const [showExplanation, setShowExplanation] = useState<string | null>(null); // question id
  const [warnEmpty, setWarnEmpty] = useState<number[]>([]); // indices of unanswered Qs

  // ── Floating panel drag state ──
  const [panelPos, setPanelPos] = useState({ x: 0, y: 0 });
  const [panelDrag, setPanelDrag] = useState<{ ox: number; oy: number } | null>(null);
  const [panelMin, setPanelMin] = useState(false);
  useEffect(() => {
    setPanelPos({ x: Math.max(0, window.innerWidth - 420), y: Math.max(0, window.innerHeight - 440) });
  }, []);

  // ── Highlighter state ──
  const [highlights, setHighlights] = useState<Highlight[]>([]);
  const [highlightMode, setHighlightMode] = useState(false);
  const [hlColor, setHlColor] = useState(HL_COLORS[0].value);
  const [drawingHl, setDrawingHl] = useState<{ pageIndex: number; x1: number; y1: number; x2: number; y2: number } | null>(null);

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const lastPos = useRef({ x: 0, y: 0 });
  const scrollAreaRef = useRef<HTMLDivElement>(null);
  const pageRefs = useRef<Record<number, HTMLDivElement | null>>({});

  useEffect(() => { loadKaTeX(() => setKatexTick(t => t + 1)); }, []);

  // Load + save highlights from localStorage (keyed by filename)
  useEffect(() => {
    if (!docKey) return;
    try {
      const saved = localStorage.getItem(`lyceum_hl_${docKey}`);
      if (saved) setHighlights(JSON.parse(saved));
    } catch { /* ignore */ }
  }, [docKey]);

  useEffect(() => {
    if (!docKey) return;
    try { localStorage.setItem(`lyceum_hl_${docKey}`, JSON.stringify(highlights)); } catch { /* ignore */ }
  }, [highlights, docKey]);

  // Load + auto-save pasted text answers from localStorage (keyed by filename)
  useEffect(() => {
    if (!docKey) return;
    try {
      const saved = localStorage.getItem(`lyceum_answers_${docKey}`);
      if (saved) {
        const data = JSON.parse(saved);
        if (data.notes) setPastedNotes(data.notes);
      }
    } catch { /* ignore */ }
  }, [docKey]);

  useEffect(() => {
    if (!docKey || Object.keys(pastedNotes).length === 0) return;
    try { localStorage.setItem(`lyceum_answers_${docKey}`, JSON.stringify({ notes: pastedNotes })); } catch { /* ignore */ }
  }, [pastedNotes, docKey]);

  // ── BroadcastChannel: sync current question to popup + receive answers ──
  useEffect(() => {
    const ch = new BroadcastChannel('lyceum_notepad_v1');
    notesChannelRef.current = ch;

    ch.onmessage = (e) => {
      const { type, qId, text, dataURL } = e.data;

      if (type === 'READY') {
        // Popup just opened/reloaded — send it the current question
        const cur = questions[idx];
        if (cur) ch.postMessage({ type: 'SYNC_QUESTION', question: cur, idx, total: questions.length, docKey });
        setPopupOpen(true);
      }

      if (type === 'ANSWER') {
        // Popup sent an answer — mirror the handleOK logic
        if (text) setPastedNotes(prev => ({ ...prev, [qId]: text }));
        if (dataURL) setPastedImages(prev => ({ ...prev, [qId]: dataURL }));
        setIdx(i => Math.min(questions.length - 1, i + 1));
      }
    };

    return () => { ch.close(); notesChannelRef.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [questions, docKey]);

  // Sync question to popup whenever idx changes
  useEffect(() => {
    const ch = notesChannelRef.current;
    if (!ch) return;
    if (popupRef.current?.closed) { setPopupOpen(false); return; }
    const cur = questions[idx];
    if (cur) ch.postMessage({ type: 'SYNC_QUESTION', question: cur, idx, total: questions.length, docKey });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idx]);

  // Forward grade results to popup
  useEffect(() => {
    const ch = notesChannelRef.current;
    if (!ch || Object.keys(gradeResults).length === 0) return;
    if (popupRef.current?.closed) { setPopupOpen(false); return; }
    // Send result for the currently-displayed question if there's one
    const cur = questions[idx];
    if (cur && gradeResults[cur.id]) {
      const g = gradeResults[cur.id];
      ch.postMessage({ type: 'GRADE_RESULT', qId: cur.id, passed: g.passed, feedback: g.feedback });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gradeResults, idx]);

  function openNotepadPopup() {
    const url = `${window.location.origin}${window.location.pathname}?panel=notepad`;
    const features = 'width=480,height=700,menubar=no,toolbar=no,location=no,resizable=yes,scrollbars=no';
    const popup = window.open(url, 'lyceum_notepad', features);
    if (popup) {
      popupRef.current = popup;
      setPopupOpen(true);
    } else {
      // Popup was blocked — alert the user
      alert('Trình duyệt đang chặn popup.\n\nBấm vào icon 🔒 trên thanh địa chỉ → "Luôn cho phép popup từ localhost" rồi thử lại.');
    }
  }

  const q = questions[idx];
  const activePage = q.page ?? 0;
  const yStart = q.yStart ?? 0;
  const yEnd = q.yEnd ?? 100;

  // Reset per-question state
  useEffect(() => {
    setAnswer(''); setMasteryResult(null); setCanvasTranscript('');
    canvasRef.current?.getContext('2d')?.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height);
  }, [idx]);

  // Auto-scroll PDF to centre the focused region
  useEffect(() => {
    const el = pageRefs.current[activePage];
    const area = scrollAreaRef.current;
    if (!el || !area) return;
    const regionTop = el.offsetTop + (yStart / 100) * el.offsetHeight;
    const regionH = ((yEnd - yStart) / 100) * el.offsetHeight;
    area.scrollTo({ top: regionTop - (area.clientHeight - regionH) / 2, behavior: 'smooth' });
  }, [idx, activePage, yStart, yEnd]);

  // Progressive loading is triggered in handleOK (not on navigation)

  function prev() { setIdx(i => Math.max(0, i - 1)); }
  function next() { setIdx(i => Math.min(questions.length - 1, i + 1)); }

  // Canvas helpers
  function getPos(e: React.MouseEvent | React.TouchEvent, canvas: HTMLCanvasElement) {
    const r = canvas.getBoundingClientRect();
    const sx = canvas.width / r.width, sy = canvas.height / r.height;
    if ('touches' in e) { const t = e.touches[0]; return { x: (t.clientX - r.left) * sx, y: (t.clientY - r.top) * sy }; }
    return { x: ((e as React.MouseEvent).clientX - r.left) * sx, y: ((e as React.MouseEvent).clientY - r.top) * sy };
  }
  function startDraw(e: React.MouseEvent | React.TouchEvent) { const c = canvasRef.current; if (!c) return; drawing.current = true; lastPos.current = getPos(e, c); }
  function draw(e: React.MouseEvent | React.TouchEvent) {
    if (!drawing.current) return; const c = canvasRef.current; if (!c) return;
    const ctx = c.getContext('2d'); if (!ctx) return; e.preventDefault();
    const pos = getPos(e, c);
    ctx.strokeStyle = brushColor; ctx.lineWidth = brushSize; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.beginPath(); ctx.moveTo(lastPos.current.x, lastPos.current.y); ctx.lineTo(pos.x, pos.y); ctx.stroke();
    lastPos.current = pos;
  }
  function stopDraw() { drawing.current = false; }

  async function transcribeCanvas() {
    const c = canvasRef.current; if (!c) return; setBusy(true);
    try { const r = await describeDrawing(c.toDataURL('image/png')); setCanvasTranscript(r.text); }
    catch (e: any) { setCanvasTranscript('Error: ' + e.message); } finally { setBusy(false); }
  }

  async function handleMastery() {
    const ans = mode === 'text' ? answer : canvasTranscript; if (!ans.trim()) return;
    setBusy(true);
    try { setMasteryResult(await checkMastery(q.prompt, ans)); } catch (e: any) { setMasteryResult({ passed: false, feedback: e.message }); } finally { setBusy(false); }
  }

  async function handleOK() {
    const hasText = mode === 'text' && answer.trim();
    const hasCanvas = mode === 'canvas' && canvasRef.current;
    if (!hasText && !hasCanvas) return;
    setTearing(true);
    await new Promise(r => setTimeout(r, 380));
    if (mode === 'canvas' && canvasRef.current) {
      setPastedImages(prev => ({ ...prev, [q.id]: canvasRef.current!.toDataURL('image/png') }));
      canvasRef.current.getContext('2d')?.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height);
      setCanvasTranscript('');
    } else {
      setPastedNotes(prev => ({ ...prev, [q.id]: answer }));
      setAnswer('');
    }
    setTearing(false);
    setMasteryResult(null);

    // Trigger next-page analysis when OK is pressed on the last question of the current page
    if (onPageBoundary && totalPages > 0) {
      const currentPage = q.page ?? 0;
      const nextPage = currentPage + 1;
      if (nextPage < totalPages) {
        const isLastOnPage = idx === questions.length - 1 ||
          (questions[idx + 1]?.page ?? 0) > currentPage;
        if (isLastOnPage) onPageBoundary(nextPage);
      }
    }

    await new Promise(r => setTimeout(r, 180));
    if (idx < questions.length - 1) setIdx(i => i + 1);
  }

  async function doGrade() {
    setWarnEmpty([]);
    setGrading(true);
    try {
      const items = questions.map(oq => {
        const noteText = pastedNotes[oq.id];
        const noteImg = pastedImages[oq.id];
        if (!noteText && !noteImg) return null;
        return {
          id: oq.id,
          prompt: oq.prompt,
          answer: noteText || '[handwritten answer]',
          image_b64: noteImg ? noteImg.replace(/^data:[^;]+;base64,/, '') : undefined,
        };
      }).filter(Boolean) as { id: string; prompt: string; answer: string; image_b64?: string }[];

      const result = await gradeDual(items);
      const map: Record<string, { passed: boolean; feedback: string; suggestions?: GradeSuggestion }> = {};
      result.grades.forEach(g => {
        map[g.id] = { passed: g.passed, feedback: g.feedback, suggestions: g.suggestions };
      });
      setGradeResults(map);

      // Mistake Bank is populated by AI grading, not manual entry — every
      // question marked wrong here gets logged automatically so the student
      // never has to type it in themselves.
      result.grades.forEach(g => {
        if (g.passed) return;
        const oq = questions.find(q => q.id === g.id);
        if (!oq) return;
        try {
          saveMistake({
            mistake: oq.prompt.slice(0, 300),
            location: `${docKey} · Q${questions.indexOf(oq) + 1}`,
            explanation: g.feedback || '',
          });
        } catch { /* ignore */ }
      });

      // Save to progress store
      saveGradeSession({
        sessionId: `${docKey}_${Date.now()}`,
        date: Date.now(),
        filename: docKey,
        grades: result.grades.map(g => {
          const oq = questions.find(q => q.id === g.id);
          return {
            questionId: g.id,
            passed: g.passed,
            concepts: oq?.concepts || [],
            difficulty: oq?.difficulty || 'medium',
          };
        }),
      });
    } catch (e: any) {
      // silently fail — user can retry
    } finally {
      setGrading(false);
    }
  }

  function handleSubmit() {
    const empty = questions
      .map((oq, i) => ({ oq, i }))
      .filter(({ oq }) => !pastedNotes[oq.id] && !pastedImages[oq.id])
      .map(({ i }) => i);
    if (empty.length > 0) {
      setWarnEmpty(empty);
    } else {
      doGrade();
    }
  }

  function insertSymbol(sym: string) {
    const ta = textareaRef.current; if (!ta) return;
    const s = ta.selectionStart, end = ta.selectionEnd;
    const v = answer.slice(0, s) + sym + answer.slice(end); setAnswer(v);
    setTimeout(() => { ta.selectionStart = ta.selectionEnd = s + sym.length; ta.focus(); }, 0);
  }

  const DIM_STYLE = { backdropFilter: 'blur(5px) brightness(0.38)' } as React.CSSProperties;

  return (
    <div className="fixed inset-0 z-50 bg-black flex flex-col" style={{ animation: 'slideUp 0.3s ease-out' }}>
      <style>{`
        @keyframes slideUp { from { transform: translateY(6%); opacity:0; } to { transform: translateY(0); opacity:1; } }
        @keyframes tearOff {
          0%   { transform: scale(1) translateY(0) rotate(0deg); opacity:1; }
          60%  { transform: scale(0.92) translateY(-10px) rotate(-1.5deg); opacity:0.7; }
          100% { transform: scale(0.55) translateY(-32px) rotate(-3deg); opacity:0; }
        }
        @keyframes pasteOn {
          0%   { transform: rotate(2deg) scale(0.82) translateY(-6px); opacity:0; filter:blur(2px); }
          65%  { transform: rotate(-0.5deg) scale(1.03) translateY(1px); opacity:1; filter:blur(0); }
          100% { transform: rotate(-0.35deg) scale(1) translateY(0); opacity:1; filter:blur(0); }
        }
      `}</style>

      <MindMapTool />

      {/* ── Header bar ── */}
      <div className="flex items-center justify-between px-5 py-2.5 border-b border-white/10 flex-shrink-0 bg-neutral-900">
        <button onClick={() => onExit(idx)} className="font-sans text-[10px] uppercase tracking-[2px] text-white/50 hover:text-white/90 transition-colors flex items-center gap-2">
          <span className="material-symbols-outlined text-[16px]">arrow_back</span>Back
        </button>
        <div className="flex items-center gap-3">
          {/* Grade score */}
          {Object.keys(gradeResults).length > 0 && (
            <span className="font-sans text-[11px] uppercase tracking-[2px] text-white/60">
              {Object.values(gradeResults).filter(r => r.passed).length}
              <span className="opacity-40">/</span>
              {Object.keys(gradeResults).length} correct
            </span>
          )}
          <button onClick={prev} disabled={idx === 0}
            className="w-7 h-7 border border-white/20 flex items-center justify-center text-white hover:bg-white/10 disabled:opacity-25 transition-colors">
            <span className="material-symbols-outlined text-[15px]">chevron_left</span>
          </button>
          <span className="font-sans text-[11px] uppercase tracking-[2px] text-white/60 min-w-[56px] text-center">
            Q{idx + 1} / {questions.length}
          </span>
          <button onClick={next} disabled={idx === questions.length - 1}
            className="w-7 h-7 border border-white/20 flex items-center justify-center text-white hover:bg-white/10 disabled:opacity-25 transition-colors">
            <span className="material-symbols-outlined text-[15px]">chevron_right</span>
          </button>
          <DiffBadge d={q.difficulty} />
          {/* Pop-out notepad button */}
          <button
            onClick={() => {
              if (popupOpen && popupRef.current && !popupRef.current.closed) {
                popupRef.current.focus();
              } else {
                openNotepadPopup();
              }
            }}
            title={popupOpen ? 'Notepad open — click to focus' : 'Open notepad in separate window'}
            className={`flex items-center gap-1.5 px-3 py-1.5 border font-sans text-[10px] uppercase tracking-[2px] transition-all ${
              popupOpen ? 'border-amber-400/60 text-amber-300 bg-amber-400/10' : 'border-white/20 text-white/50 hover:text-white/90 hover:border-white/40'
            }`}>
            <span className="material-symbols-outlined text-[14px]">open_in_new</span>
            {popupOpen ? 'Notepad ●' : 'Pop out'}
          </button>

          {/* Submit button — lights up only when ALL pages are analyzed */}
          <button onClick={handleSubmit} disabled={grading || !allPagesLoaded}
            className={`px-4 py-1.5 font-sans text-[10px] uppercase tracking-[2px] transition-all flex items-center gap-1.5 ml-2 ${
              allPagesLoaded
                ? 'bg-amber-400 text-amber-950 hover:bg-amber-300'
                : 'border border-white/20 text-white/30 cursor-not-allowed'
            } disabled:opacity-30`}>
            {grading
              ? <><div className="w-3 h-3 border border-current/40 border-t-current rounded-full animate-spin" />Analysing…</>
              : <><span className="material-symbols-outlined text-[14px]">send</span>Submit</>
            }
          </button>
        </div>
      </div>

      {/* ── Warn: unanswered questions ── */}
      {warnEmpty.length > 0 && (
        <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/60">
          <div className="bg-surface border border-outline-variant/30 shadow-2xl p-8 max-w-sm w-full mx-4" style={{ borderRadius: 4 }}>
            <p className="font-sans text-[10px] uppercase tracking-[2px] text-amber-600 mb-3">Chưa trả lời</p>
            <p className="font-serif text-base mb-4 leading-snug">
              {warnEmpty.length} câu chưa có bài làm:&nbsp;
              <span className="font-sans text-sm opacity-60">{warnEmpty.map(i => `Q${i + 1}`).join(', ')}</span>
            </p>
            <p className="font-sans text-sm opacity-60 mb-6">Vẫn nộp bài hay quay lại làm tiếp?</p>
            <div className="flex gap-3">
              <button onClick={() => { setWarnEmpty([]); setIdx(warnEmpty[0]); }}
                className="flex-1 border border-outline-variant/30 py-2.5 font-sans text-[10px] uppercase tracking-[2px] hover:bg-surface-container-highest transition-colors">
                Làm tiếp
              </button>
              <button onClick={doGrade}
                className="flex-1 bg-on-surface text-surface py-2.5 font-sans text-[10px] uppercase tracking-[2px] hover:opacity-80 transition-opacity">
                Nộp luôn
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── PDF area (top, scrollable) ── */}
      <div ref={scrollAreaRef} className="flex-1 overflow-y-auto bg-neutral-800 min-h-0">
        <div className="flex flex-col gap-1 py-2 px-2" style={{ maxWidth: 860, margin: '0 auto' }}>
          {pages.map(page => {
            const isActive = page.index === activePage;
            const othersOnPage = questions
              .map((oq, oi) => ({ oq, oi }))
              .filter(({ oi, oq }) => oi !== idx && (oq.page ?? 0) === page.index);

            return (
              <div
                key={page.index}
                ref={el => { pageRefs.current[page.index] = el; }}
                className="relative w-full select-none"
              >
                <img
                  src={`data:image/jpeg;base64,${page.data}`}
                  alt={`Page ${page.index + 1}`}
                  className="w-full block"
                  draggable={false}
                />

                {/* ── Saved highlights (above image, below dim) ── */}
                {highlights.filter(h => h.pageIndex === page.index).map(h => (
                  <div key={h.id} className="absolute group"
                    style={{ top: `${h.y}%`, left: `${h.x}%`, width: `${h.w}%`, height: `${h.h}%`,
                      background: h.color, mixBlendMode: 'multiply', zIndex: 5, pointerEvents: highlightMode ? 'auto' : 'none',
                      cursor: highlightMode ? 'pointer' : 'default' }}
                    title="Click to delete highlight"
                    onClick={highlightMode ? () => setHighlights(prev => prev.filter(p => p.id !== h.id)) : undefined}
                  >
                    {highlightMode && (
                      <span className="absolute -top-2.5 -right-2.5 w-4 h-4 bg-red-500 text-white text-[9px] rounded-full items-center justify-center hidden group-hover:flex">×</span>
                    )}
                  </div>
                ))}

                {/* ── Preview rectangle while drawing ── */}
                {drawingHl?.pageIndex === page.index && (
                  <div className="absolute pointer-events-none"
                    style={{
                      top: `${Math.min(drawingHl.y1, drawingHl.y2)}%`,
                      left: `${Math.min(drawingHl.x1, drawingHl.x2)}%`,
                      width: `${Math.abs(drawingHl.x2 - drawingHl.x1)}%`,
                      height: `${Math.abs(drawingHl.y2 - drawingHl.y1)}%`,
                      background: hlColor, mixBlendMode: 'multiply',
                      border: '1.5px dashed rgba(0,0,0,0.35)', zIndex: 6,
                    }} />
                )}

                {isActive ? (
                  <>
                    {/* Top blur+dim */}
                    {yStart > 0 && (
                      <div className="absolute inset-x-0 top-0 pointer-events-none"
                        style={{ height: `${yStart}%`, background: 'rgba(0,0,0,0.52)', zIndex: 7, ...DIM_STYLE }} />
                    )}
                    {/* Amber focus ring + glow */}
                    <div className="absolute inset-x-0 pointer-events-none"
                      style={{ top: `${yStart}%`, height: `${yEnd - yStart}%`, zIndex: 7,
                        boxShadow: 'inset 0 0 0 2.5px rgba(251,191,36,1), inset 0 0 12px rgba(251,191,36,0.12)' }} />
                    {/* Bottom blur+dim */}
                    {yEnd < 100 && (
                      <div className="absolute inset-x-0 bottom-0 pointer-events-none"
                        style={{ top: `${yEnd}%`, height: `${100 - yEnd}%`, background: 'rgba(0,0,0,0.52)', zIndex: 7, ...DIM_STYLE }} />
                    )}
                  </>
                ) : (
                  <div className="absolute inset-0 pointer-events-none"
                    style={{ background: 'rgba(0,0,0,0.58)', zIndex: 7, ...DIM_STYLE }} />
                )}

                {/* Click targets for other questions (above dim) */}
                {!highlightMode && othersOnPage.map(({ oq, oi }) => (
                  <div key={oi}
                    className="absolute inset-x-0 cursor-pointer group"
                    style={{ top: `${oq.yStart ?? 0}%`, height: `${(oq.yEnd ?? 100) - (oq.yStart ?? 0)}%`, zIndex: 8 }}
                    title={`Jump to Q${oi + 1}`}
                    onClick={() => setIdx(oi)}
                  >
                    <div className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity"
                      style={{ boxShadow: 'inset 0 0 0 1.5px rgba(255,255,255,0.35)' }} />
                    <span className="absolute top-1 left-2 font-sans text-[9px] text-white/40 group-hover:text-white/80 transition-colors select-none">Q{oi + 1}</span>
                  </div>
                ))}

                {/* ── Highlight drawing overlay (topmost, only in highlight mode) ── */}
                {highlightMode && (
                  <div
                    className="absolute inset-0 cursor-crosshair"
                    style={{ zIndex: 9 }}
                    onPointerDown={e => {
                      e.currentTarget.setPointerCapture(e.pointerId);
                      const r = e.currentTarget.getBoundingClientRect();
                      const x = (e.clientX - r.left) / r.width * 100;
                      const y = (e.clientY - r.top) / r.height * 100;
                      setDrawingHl({ pageIndex: page.index, x1: x, y1: y, x2: x, y2: y });
                    }}
                    onPointerMove={e => {
                      if (!drawingHl || drawingHl.pageIndex !== page.index) return;
                      const r = e.currentTarget.getBoundingClientRect();
                      setDrawingHl(prev => prev ? {
                        ...prev,
                        x2: Math.min(100, Math.max(0, (e.clientX - r.left) / r.width * 100)),
                        y2: Math.min(100, Math.max(0, (e.clientY - r.top) / r.height * 100)),
                      } : null);
                    }}
                    onPointerUp={() => {
                      if (!drawingHl || drawingHl.pageIndex !== page.index) return;
                      const x = Math.min(drawingHl.x1, drawingHl.x2);
                      const y = Math.min(drawingHl.y1, drawingHl.y2);
                      const w = Math.abs(drawingHl.x2 - drawingHl.x1);
                      const h = Math.abs(drawingHl.y2 - drawingHl.y1);
                      if (w > 0.5 && h > 0.2) {
                        setHighlights(prev => [...prev, { id: Date.now().toString(), pageIndex: page.index, x, y, w, h, color: hlColor }]);
                      }
                      setDrawingHl(null);
                    }}
                  />
                )}

                {/* ── Question divider lines — always visible through blur ── */}
                {questions.map((oq, oi) => {
                  if ((oq.page ?? 0) !== page.index) return null;
                  const qyStart = oq.yStart ?? 0;
                  const isQ = oi === idx;
                  return (
                    <div key={`qdiv-${oi}`}
                      className="absolute inset-x-0 pointer-events-none select-none"
                      style={{ top: `${qyStart}%`, zIndex: 11 }}>
                      {/* Horizontal rule */}
                      <div style={{
                        height: isQ ? '2px' : '1px',
                        background: isQ
                          ? 'rgba(251,191,36,0.85)'
                          : 'rgba(255,255,255,0.22)',
                      }} />
                      {/* Badge */}
                      <div style={{
                        position: 'absolute', left: 10, top: isQ ? -12 : -10,
                        background: isQ ? 'rgba(251,191,36,0.95)' : 'rgba(0,0,0,0.55)',
                        color: isQ ? '#1a1a1a' : 'rgba(255,255,255,0.65)',
                        fontSize: 9, fontFamily: 'Helvetica Neue, sans-serif',
                        fontWeight: 700, letterSpacing: '1.5px',
                        textTransform: 'uppercase', padding: '2px 7px', borderRadius: 2,
                      }}>
                        Q{oi + 1}
                      </div>
                    </div>
                  );
                })}

                {/* ── Pasted answer notes ── */}
                {questions.map((oq, oi) => {
                  const noteText = pastedNotes[oq.id];
                  const noteImg = pastedImages[oq.id];
                  if ((!noteText && !noteImg) || (oq.page ?? 0) !== page.index) return null;
                  const nTop = oq.yStart ?? 0;
                  const nH = Math.max(8, (oq.yEnd ?? 100) - nTop);
                  const grade = gradeResults[oq.id];
                  const isWrong = grade && !grade.passed;
                  const isRight = grade && grade.passed;
                  const showingExp = showExplanation === oq.id;
                  return (
                    <div key={`pasted-${oi}`} className="absolute inset-x-0 select-none"
                      style={{ top: `${nTop}%`, height: `${nH}%`, zIndex: 14,
                        animation: 'pasteOn 0.48s cubic-bezier(0.23,1,0.32,1) both',
                        cursor: isWrong ? 'pointer' : 'default',
                        pointerEvents: isWrong ? 'auto' : 'none' }}
                      onClick={isWrong ? () => setShowExplanation(showingExp ? null : oq.id) : undefined}>
                      <div style={{
                        background: isRight ? 'rgba(220,252,231,0.94)' : isWrong ? 'rgba(254,226,226,0.94)' : 'rgba(254,249,195,0.94)',
                        borderTop: `3px solid ${isRight ? 'rgba(22,163,74,0.6)' : isWrong ? 'rgba(220,38,38,0.6)' : 'rgba(202,138,4,0.55)'}`,
                        boxShadow: `2px 4px 14px rgba(0,0,0,0.32)${isWrong ? ', inset 0 0 0 1.5px rgba(220,38,38,0.25)' : ''}`,
                        padding: '7px 12px 7px 14px',
                        height: '100%', overflow: 'hidden',
                        transform: 'rotate(-0.35deg)',
                        position: 'relative',
                        transition: 'background 0.4s, border-color 0.4s',
                      }}>
                        <div style={{ position:'absolute', top:0, left:0, right:0, height:3,
                          background:'repeating-linear-gradient(90deg,transparent,transparent 4px,rgba(0,0,0,0.06) 4px,rgba(0,0,0,0.06) 5px)' }} />
                        {noteText && (
                          <p style={{ margin:0, fontFamily:'Georgia, serif', fontSize:11, lineHeight:1.55,
                            color:'#1a1a1a', whiteSpace:'pre-wrap', wordBreak:'break-word' }}>{noteText}</p>
                        )}
                        {noteImg && <img src={noteImg} style={{ width:'100%', height:'calc(100% - 8px)', objectFit:'contain', display:'block' }} />}
                        <span style={{ position:'absolute', bottom:4, right:8, fontFamily:'sans-serif',
                          fontSize:10, fontWeight:700, letterSpacing:'1px',
                          color: isRight ? 'rgba(22,163,74,0.7)' : isWrong ? 'rgba(220,38,38,0.7)' : 'rgba(0,0,0,0.22)' }}>
                          {isRight ? '✓' : isWrong ? '✗' : `Q${oi+1}`}
                        </span>
                        {isWrong && !showingExp && (
                          <span style={{ position:'absolute', bottom:4, left:10, fontFamily:'sans-serif',
                            fontSize:9, color:'rgba(220,38,38,0.55)', letterSpacing:'0.5px' }}>tap for explanation</span>
                        )}
                      </div>
                      {/* Explanation + suggestions popup */}
                      {showingExp && grade && (
                        <div style={{
                          position:'absolute', left:'4%', right:'4%', top:'calc(100% + 6px)', zIndex:20,
                          background:'#1a1a1a', border:'1px solid rgba(220,38,38,0.4)',
                          boxShadow:'0 8px 24px rgba(0,0,0,0.6)',
                          padding:'14px 16px', borderRadius:4,
                          fontFamily:'Georgia, serif', fontSize:12, lineHeight:1.6,
                          color:'rgba(255,255,255,0.88)',
                        }}
                          onClick={e => e.stopPropagation()}>
                          <span style={{ fontFamily:'sans-serif', fontSize:9, letterSpacing:'2px',
                            textTransform:'uppercase', color:'rgba(220,38,38,0.8)', display:'block', marginBottom:6 }}>
                            Q{oi+1} — Why wrong
                          </span>
                          <p style={{ margin:'0 0 10px 0' }} dangerouslySetInnerHTML={{ __html: renderMath(grade.feedback) }} />

                          {/* Suggestions from Gemma */}
                          {grade.suggestions && (
                            <div style={{ borderTop:'1px solid rgba(255,255,255,0.1)', paddingTop:10, marginTop:2 }}>
                              <span style={{ fontFamily:'sans-serif', fontSize:8, letterSpacing:'2px',
                                textTransform:'uppercase', color:'rgba(255,255,255,0.35)', display:'block', marginBottom:8 }}>
                                What to do
                              </span>
                              <div style={{ display:'flex', flexDirection:'column', gap:6 }}>
                                {/* View Notes */}
                                {grade.suggestions.concept && (
                                  <button
                                    style={{ display:'flex', alignItems:'center', gap:6, background:'rgba(255,255,255,0.06)',
                                      border:'1px solid rgba(255,255,255,0.12)', borderRadius:3, padding:'5px 10px',
                                      cursor:'pointer', textAlign:'left', color:'rgba(255,255,255,0.75)',
                                      fontFamily:'sans-serif', fontSize:10 }}
                                    onClick={() => {
                                      setShowExplanation(null);
                                      onExit(idx);
                                      onNavigate?.('notes');
                                    }}>
                                    <span style={{ fontSize:13 }}>📝</span>
                                    <span>Review in Notes: <strong style={{ color:'rgba(251,191,36,0.9)' }}>{grade.suggestions.concept}</strong></span>
                                  </button>
                                )}
                                {/* Ask Lyceum AI */}
                                {grade.suggestions.ask_lyceum && (
                                  <button
                                    style={{ display:'flex', alignItems:'center', gap:6, background:'rgba(255,255,255,0.06)',
                                      border:'1px solid rgba(255,255,255,0.12)', borderRadius:3, padding:'5px 10px',
                                      cursor:'pointer', textAlign:'left', color:'rgba(255,255,255,0.75)',
                                      fontFamily:'sans-serif', fontSize:10 }}
                                    onClick={() => {
                                      try { sessionStorage.setItem('lyceum_dialogue_prefill', grade.suggestions!.ask_lyceum); } catch {}
                                      setShowExplanation(null);
                                      onExit(idx);
                                      onNavigate?.('dialogue');
                                    }}>
                                    <span style={{ fontSize:13 }}>🤖</span>
                                    <span>Ask Lyceum AI</span>
                                  </button>
                                )}
                                {/* Google search links */}
                                {(grade.suggestions.google_links || []).map((link, li) => (
                                  <a key={li} href={link.url} target="_blank" rel="noopener noreferrer"
                                    style={{ display:'flex', alignItems:'center', gap:6, background:'rgba(255,255,255,0.06)',
                                      border:'1px solid rgba(255,255,255,0.12)', borderRadius:3, padding:'5px 10px',
                                      textDecoration:'none', color:'rgba(255,255,255,0.75)',
                                      fontFamily:'sans-serif', fontSize:10 }}>
                                    <span style={{ fontSize:13 }}>🔍</span>
                                    <span style={{ overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{link.title}</span>
                                  </a>
                                ))}
                                {/* Community placeholder */}
                                <div style={{ display:'flex', alignItems:'center', gap:6,
                                  padding:'5px 10px', color:'rgba(255,255,255,0.3)',
                                  fontFamily:'sans-serif', fontSize:10 }}>
                                  <span style={{ fontSize:13 }}>💬</span>
                                  <span>Discuss with community — coming soon</span>
                                </div>
                              </div>
                            </div>
                          )}

                          <button style={{ marginTop:10, fontFamily:'sans-serif', fontSize:9, letterSpacing:'2px',
                            textTransform:'uppercase', color:'rgba(255,255,255,0.3)', cursor:'pointer', background:'none', border:'none' }}
                            onClick={() => setShowExplanation(null)}>Close ×</button>
                        </div>
                      )}
                    </div>
                  );
                })}

                <div className="absolute bottom-1 right-2 font-sans text-[9px] text-white/30 pointer-events-none select-none" style={{ zIndex: 10 }}>p.{page.index + 1}</div>
              </div>
            );
          })}
        </div>
      </div>

      {/* ── Floating notepad ── */}
      <div
        className="fixed z-[70] bg-surface border border-outline-variant/20 shadow-2xl flex flex-col overflow-hidden"
        style={{ left: panelPos.x, top: panelPos.y, width: 380, maxHeight: panelMin ? 44 : '62vh', minHeight: panelMin ? 44 : 200, borderRadius: 4, transition: 'max-height 0.2s ease' }}
      >
        {/* Drag handle */}
        <div
          className="flex items-center justify-between px-3 py-2 border-b border-outline-variant/20 bg-surface-container-highest/60 flex-shrink-0 select-none"
          style={{ cursor: panelDrag ? 'grabbing' : 'grab', minHeight: 44 }}
          onPointerDown={e => {
            (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
            setPanelDrag({ ox: e.clientX - panelPos.x, oy: e.clientY - panelPos.y });
          }}
          onPointerMove={e => {
            if (!panelDrag) return;
            setPanelPos({
              x: Math.max(0, Math.min(window.innerWidth - 380, e.clientX - panelDrag.ox)),
              y: Math.max(0, Math.min(window.innerHeight - 44, e.clientY - panelDrag.oy)),
            });
          }}
          onPointerUp={() => setPanelDrag(null)}
          onPointerCancel={() => setPanelDrag(null)}
        >
          <div className="flex items-center gap-2 min-w-0">
            <span className="material-symbols-outlined text-[14px] opacity-30">drag_indicator</span>
            <span className="font-sans text-[10px] uppercase tracking-[2px] opacity-50">Q{idx + 1}/{questions.length}</span>
            {popupOpen && (
              <span className="font-sans text-[9px] uppercase tracking-[1px] text-amber-400 border border-amber-400/40 px-1.5 py-0.5 animate-pulse">
                Popup active
              </span>
            )}
            {!panelMin && !popupOpen && q.concepts.length > 0 && (
              <div className="flex gap-1 flex-wrap">
                {q.concepts.slice(0, 2).map(c => (
                  <span key={c} className="border border-outline-variant/30 px-1.5 py-0.5 font-sans text-[8px] uppercase tracking-[1px] opacity-40">{c}</span>
                ))}
              </div>
            )}
          </div>
          <div className="flex items-center gap-1 flex-shrink-0" onPointerDown={e => e.stopPropagation()}>
            {/* Pop-out to separate window */}
            <button
              onClick={() => {
                if (popupOpen && popupRef.current && !popupRef.current.closed) {
                  popupRef.current.focus();
                } else {
                  openNotepadPopup();
                }
              }}
              title="Mở notepad trong cửa sổ riêng"
              className={`flex items-center gap-1 px-2 py-1 border font-sans text-[9px] uppercase tracking-[1px] transition-all rounded-sm ${
                popupOpen
                  ? 'border-amber-400/70 text-amber-600 bg-amber-50'
                  : 'border-outline-variant/40 opacity-60 hover:opacity-100'
              }`}>
              <span className="material-symbols-outlined text-[13px]">open_in_new</span>
              {popupOpen ? '●' : 'Pop'}
            </button>
            <button onClick={() => setShowQuestion(v => !v)} className="opacity-30 hover:opacity-70 transition-opacity p-1">
              <span className="material-symbols-outlined text-[14px]">notes</span>
            </button>
            <button onClick={() => setPanelMin(v => !v)} className="opacity-30 hover:opacity-70 transition-opacity p-1">
              <span className="material-symbols-outlined text-[14px]">{panelMin ? 'open_in_full' : 'remove'}</span>
            </button>
          </div>
        </div>

        {/* Question text (collapsible) */}
        {!panelMin && showQuestion && (
          <div className="px-5 py-3 border-b border-outline-variant/15 flex-shrink-0 bg-surface-container-lowest/40">
            <div className="font-serif text-sm leading-snug line-clamp-4"
              dangerouslySetInnerHTML={{ __html: renderMath(q.prompt) }} />
            {q.concepts.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mt-1.5">
                {q.concepts.map(c => (
                  <span key={c} className="border border-outline-variant/40 px-1.5 py-0.5 font-sans text-[9px] uppercase tracking-[1px] opacity-50">{c}</span>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Mastery result or input area */}
        {!panelMin && <div className="flex-1 overflow-y-auto px-5 py-3 flex flex-col gap-3 min-h-0">
          {masteryResult ? (
            <div className={`border p-4 ${masteryResult.passed ? 'border-emerald-200 bg-emerald-50' : 'border-amber-200 bg-amber-50'}`}>
              <span className={`font-sans text-[10px] uppercase tracking-[2px] font-semibold block mb-1.5 ${masteryResult.passed ? 'text-emerald-700' : 'text-amber-700'}`}>
                {masteryResult.passed ? '✓ Mastered' : '◯ Keep Exploring'}
              </span>
              <p className="font-sans text-sm leading-relaxed opacity-80" dangerouslySetInnerHTML={{ __html: renderMath(masteryResult.feedback) }} />
              <button onClick={() => setMasteryResult(null)} className="mt-2 font-sans text-[10px] uppercase tracking-[2px] opacity-50 hover:opacity-100 transition-opacity">Try Again</button>
            </div>
          ) : mode === 'text' ? (
            <textarea ref={textareaRef} value={answer} onChange={e => setAnswer(e.target.value)}
              placeholder="Write your solution here…"
              style={tearing ? { animation: 'tearOff 0.38s ease-in both' } : undefined}
              className="w-full flex-1 min-h-[80px] bg-surface-container-lowest border border-outline-variant/30 p-3 font-sans text-sm resize-none outline-none focus:border-on-surface/50 transition-colors placeholder:text-outline-variant/60" />
          ) : (
            <>
              <div className="border border-outline-variant/30 bg-white" style={{ aspectRatio: '4/1.5', ...(tearing ? { animation: 'tearOff 0.38s ease-in both' } : {}) }}>
                <canvas ref={canvasRef} width={1200} height={450}
                  className="w-full h-full cursor-crosshair touch-none"
                  onMouseDown={startDraw} onMouseMove={draw} onMouseUp={stopDraw} onMouseLeave={stopDraw}
                  onTouchStart={startDraw} onTouchMove={draw} onTouchEnd={stopDraw} />
              </div>
              {canvasTranscript && (
                <div className="border border-outline-variant/30 p-3 bg-surface-container-lowest">
                  <span className="font-sans text-[9px] uppercase tracking-[2px] opacity-40 block mb-1">Transcription</span>
                  <p className="font-sans text-sm leading-relaxed">{canvasTranscript}</p>
                </div>
              )}
            </>
          )}

          {/* Math keyboard */}
          {showMathKb && mode === 'text' && (
            <div className="border border-outline-variant/30 p-3 bg-surface-container-lowest">
              <div className="flex flex-wrap gap-1">
                {MATH_SYMBOLS.map(sym => (
                  <button key={sym} onClick={() => insertSymbol(sym)}
                    className="w-8 h-8 border border-outline-variant/30 text-xs font-mono hover:bg-surface-container-highest transition-colors flex items-center justify-center">
                    {sym}
                  </button>
                ))}
              </div>
            </div>
          )}

        </div>}

        {/* Toolbar row */}
        {!panelMin && <div className="flex items-center gap-1 px-5 py-2 border-t border-outline-variant/20 flex-shrink-0 flex-wrap">
          {/* Mode toggle */}
          <div className="flex gap-0 border border-outline-variant/30 mr-2">
            {(['text', 'canvas'] as const).map(m => (
              <button key={m} onClick={() => setMode(m)}
                className={`px-4 py-1.5 font-sans text-[9px] uppercase tracking-[2px] transition-colors ${mode === m ? 'bg-on-surface text-surface' : 'hover:bg-surface-container-highest'}`}>
                {m === 'text' ? 'Write' : 'Draw'}
              </button>
            ))}
          </div>

          {/* Math keyboard toggle */}
          {mode === 'text' && (
            <button onClick={() => setShowMathKb(v => !v)}
              className={`flex items-center gap-1 px-3 py-1.5 border font-sans text-[9px] uppercase tracking-[2px] transition-colors ${showMathKb ? 'border-on-surface bg-on-surface/10' : 'border-outline-variant/30 opacity-50 hover:opacity-100'}`}>
              <span className="material-symbols-outlined text-[14px]">functions</span>Math
            </button>
          )}

          {/* ── Highlighter toggle ── */}
          <div className="flex items-center gap-1 ml-1 border-l border-outline-variant/20 pl-2">
            <button onClick={() => setHighlightMode(v => !v)}
              className={`flex items-center gap-1 px-3 py-1.5 border font-sans text-[9px] uppercase tracking-[2px] transition-colors ${highlightMode ? 'border-amber-400 bg-amber-50 text-amber-800' : 'border-outline-variant/30 opacity-50 hover:opacity-100'}`}>
              <span className="material-symbols-outlined text-[14px]">ink_highlighter</span>Highlight
            </button>
            {highlightMode && (
              <>
                {HL_COLORS.map(c => (
                  <button key={c.value}
                    onClick={() => setHlColor(c.value)}
                    title={c.label}
                    className={`w-5 h-5 rounded-sm border-2 transition-all ${hlColor === c.value ? 'border-on-surface scale-110' : 'border-transparent opacity-70 hover:opacity-100'}`}
                    style={{ background: c.value.replace(/[\d.]+\)$/, '0.9)') }}
                  />
                ))}
                {highlights.length > 0 && (
                  <button onClick={() => { if (confirm(`Clear all ${highlights.length} highlights?`)) setHighlights([]); }}
                    className="font-sans text-[9px] uppercase tracking-[2px] text-red-400 hover:text-red-600 transition-colors ml-1 opacity-70 hover:opacity-100">
                    Clear all
                  </button>
                )}
              </>
            )}
          </div>

          {/* Canvas controls */}
          {mode === 'canvas' && (
            <div className="flex items-center gap-2 mr-2">
              {['#1A1A1A','#C5A059','#823b18','#2563eb','#dc2626'].map(c => (
                <button key={c} onClick={() => setBrushColor(c)}
                  className={`w-5 h-5 border-2 ${brushColor === c ? 'border-on-surface' : 'border-transparent'}`}
                  style={{ backgroundColor: c }} />
              ))}
              <div className="w-[1px] h-4 bg-outline-variant/30" />
              {[2,4,8].map(s => (
                <button key={s} onClick={() => setBrushSize(s)}
                  className={`px-2 py-0.5 border font-sans text-[9px] ${brushSize === s ? 'border-on-surface bg-on-surface text-surface' : 'border-outline-variant/30'}`}>
                  {s}
                </button>
              ))}
              <button onClick={() => { canvasRef.current?.getContext('2d')?.clearRect(0,0,canvasRef.current.width,canvasRef.current.height); setCanvasTranscript(''); }}
                className="font-sans text-[9px] uppercase tracking-[2px] opacity-40 hover:opacity-100 transition-opacity">Clear</button>
              <button onClick={transcribeCanvas} disabled={busy}
                className="flex items-center gap-1 font-sans text-[9px] uppercase tracking-[2px] opacity-50 hover:opacity-100 disabled:opacity-25 transition-opacity">
                <span className="material-symbols-outlined text-[13px]">document_scanner</span>Read
              </button>
            </div>
          )}

          <div className="flex-1" />

          {/* Distil */}
          <button onClick={async () => { setDistilling(true); try { await onClean(idx); } finally { setDistilling(false); } }}
            disabled={busy || distilling}
            className="flex items-center gap-1 font-sans text-[9px] uppercase tracking-[2px] opacity-50 hover:opacity-100 transition-opacity disabled:opacity-25 px-2 py-1.5">
            {distilling ? <div className="w-3 h-3 border border-on-surface/40 border-t-on-surface rounded-full animate-spin" /> : <span className="text-[11px]">✦</span>}
            Distil
          </button>

          {/* Check mastery (secondary — small text button) */}
          <button onClick={handleMastery}
            disabled={busy || tearing || !!masteryResult || (mode === 'text' ? !answer.trim() : !canvasTranscript.trim())}
            className="flex items-center gap-1 font-sans text-[9px] uppercase tracking-[2px] opacity-35 hover:opacity-70 transition-opacity disabled:opacity-15 px-2 py-1.5">
            {busy
              ? <><div className="w-3 h-3 border border-on-surface/40 border-t-on-surface rounded-full animate-spin" />Checking…</>
              : <><span className="material-symbols-outlined text-[13px]">verified</span>Check</>
            }
          </button>

          {/* OK — PRIMARY: paste note onto PDF then advance */}
          <button onClick={handleOK}
            disabled={tearing}
            className={`px-6 py-1.5 font-sans text-[10px] uppercase tracking-[2px] font-bold flex items-center gap-1.5 ml-1 transition-all ${
              (mode === 'text' ? answer.trim() : canvasTranscript.trim())
                ? 'bg-amber-400 text-amber-950 hover:bg-amber-300 shadow-sm'
                : 'bg-amber-400/30 text-amber-900/50 cursor-not-allowed'
            }`}>
            {tearing
              ? <><div className="w-3 h-3 border border-amber-950/40 border-t-amber-950 rounded-full animate-spin" />…</>
              : <>OK</>
            }
          </button>
        </div>}
      </div>
    </div>
  );
}


// ── Main ProblemSetsView ──────────────────────────────────────────────────
export default function ProblemSetsView({ onNavigate }: { onNavigate?: (view: string) => void } = {}) {
  const [questions, setQuestions] = useState<Question[]>([]);
  const [pages, setPages] = useState<PdfPage[]>([]);
  const [lensMode, setLensMode] = useState(false);
  const [lensOpen, setLensOpen] = useState(false);
  const [docKey, setDocKey] = useState('');
  const [loading, setLoading] = useState(false);
  const [phase, setPhase] = useState<0|1|2|3>(0);
  const [error, setError] = useState('');
  const [cleaningSet, setCleaningSet] = useState<Set<number>>(new Set());
  const [, setKatexTick] = useState(0);
  const [pasteText, setPasteText] = useState('');
  const [showPaste, setShowPaste] = useState(false);
  const [rawText, setRawText] = useState('');
  const [usage, setUsage] = useState<{ total_tokens?: number; total_calls?: number } | null>(null);
  const [savedSets, setSavedSets] = useState<SavedPSet[]>([]);
  const [totalPages, setTotalPages] = useState(0);
  const [analyzedPageCount, setAnalyzedPageCount] = useState(0);
  const psetIdRef = useRef<string>('');
  const fileRef = useRef<HTMLInputElement>(null);
  const phaseTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const analyzedPagesRef = useRef<Set<number>>(new Set());

  useEffect(() => { getUsage().then(u => setUsage(u)); }, [questions]);
  useEffect(() => { loadKaTeX(() => setKatexTick(t => t + 1)); }, []);
  useEffect(() => { setSavedSets(loadPSets()); }, []);

  function startPhaseTimer() {
    phaseTimer.current = setTimeout(() => {
      setPhase(2);
      phaseTimer.current = setTimeout(() => setPhase(3), 7000);
    }, 3000);
  }

  function clearPhaseTimer() {
    if (phaseTimer.current) { clearTimeout(phaseTimer.current); phaseTimer.current = null; }
  }

  async function handleFile(file: File) {
    setError(''); setLoading(true); setQuestions([]); setPages([]); setRawText('');
    setLensMode(false); setLensOpen(false); setDocKey(file.name);
    setPhase(1); startPhaseTimer();
    try {
      const result = await uploadProblemSet(file);
      clearPhaseTimer(); setPhase(3);
      await new Promise(r => setTimeout(r, 600));
      const qs: Question[] = result.questions || [];
      if (qs.length === 0) {
        const backendMsg = result.summary || result.error || 'No questions found in this file.';
        setError(backendMsg);
        if (result.raw_text) { setRawText(result.raw_text); setPasteText(result.raw_text); setShowPaste(true); }
      } else {
        setQuestions(qs);
        const pgData: PdfPage[] = result.pages || [];
        setPages(pgData);
        const tp = result.totalPages || pgData.length;
        setTotalPages(tp);
        analyzedPagesRef.current = new Set([0]); // page 0 already analyzed
        setAnalyzedPageCount(1);
        const isLens = pgData.length > 0;
        setLensMode(isLens);
        // Re-use existing saved set ID if same file name (preserves progress position)
        const existingSet = loadPSets().find(s => s.name === file.name);
        const id = (psetIdRef.current && docKey === file.name && existingSet)
          ? psetIdRef.current
          : `pset_${Date.now()}`;
        const savedIdx = (existingSet && docKey === file.name) ? existingSet.currentIdx : 0;
        psetIdRef.current = id;
        // Save pages to IndexedDB (async, fire-and-forget; large data)
        if (pgData.length > 0) savePages(id, pgData);
        savePSet({ id, name: file.name, savedAt: Date.now(), questions: qs, currentIdx: savedIdx, lensMode: isLens, totalPages: tp, hasCachedPages: pgData.length > 0 });
        setSavedSets(loadPSets());
        if (isLens) {
          setLensOpen(true);
        }
      }
    } catch (e: any) {
      clearPhaseTimer();
      const msg = e.message || String(e);
      if (msg.includes('Failed to fetch') || msg.includes('NetworkError')) {
        setError('Cannot reach backend at localhost:8000 — is it running?');
      } else { setError(msg); }
    } finally { setLoading(false); setPhase(0); }
  }

  async function handleDecompose() {
    if (!pasteText.trim()) return;
    setError(''); setLoading(true); setRawText('');
    setPhase(2); startPhaseTimer();
    try {
      const result = await decomposeProblemSet(pasteText);
      clearPhaseTimer(); setPhase(3);
      await new Promise(r => setTimeout(r, 400));
      const qs: Question[] = result.questions || [];
      if (qs.length === 0) {
        setError(result.summary || 'AI could not parse questions. Try editing the text above.');
      } else {
        setQuestions(qs); setShowPaste(false);
      }
    } catch (e: any) {
      clearPhaseTimer(); setError(e.message);
    } finally { setLoading(false); setPhase(0); }
  }

  async function handlePageBoundary(nextPageIdx: number) {
    if (analyzedPagesRef.current.has(nextPageIdx)) return;
    if (nextPageIdx >= totalPages) return;
    const pageImg = pages[nextPageIdx];
    if (!pageImg) return;
    analyzedPagesRef.current.add(nextPageIdx); // mark early to avoid double-firing
    try {
      const newQs = await analyzePage(pageImg.data, nextPageIdx, totalPages);
      if (newQs.length > 0) {
        setQuestions(prev => {
          const merged = [...prev, ...newQs];
          merged.sort((a, b) => (a.page ?? 0) - (b.page ?? 0) || (a.yStart ?? 0) - (b.yStart ?? 0));
          // Re-number IDs
          return merged.map((q, i) => ({ ...q, id: String(i + 1) }));
        });
      }
      setAnalyzedPageCount(analyzedPagesRef.current.size);
    } catch {
      analyzedPagesRef.current.delete(nextPageIdx); // allow retry on failure
    }
  }

  async function handleClean(i: number, rawPrompt?: string) {
    setCleaningSet(prev => new Set(prev).add(i));
    try {
      const prompt = rawPrompt ?? questions[i]?.prompt ?? '';
      const result = await cleanQuestion(prompt);
      if (result.clean) {
        setQuestions(qs => qs.map((q, qi) => qi === i ? { ...q, prompt: result.clean } : q));
      }
    } catch { /* silently fail */ }
    finally { setCleaningSet(prev => { const s = new Set(prev); s.delete(i); return s; }); }
  }


  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  }, []);

  async function openSavedSet(s: SavedPSet) {
    setDocKey(s.name);
    psetIdRef.current = s.id;
    setQuestions(s.questions as Question[]);

    // Try to load cached pages from IndexedDB (valid within 24h)
    if (s.hasCachedPages && s.expiresAt > Date.now()) {
      const cachedPages = await loadPages(s.id);
      if (cachedPages && cachedPages.length > 0) {
        setPages(cachedPages as PdfPage[]);
        const tp = s.totalPages || cachedPages.length;
        setTotalPages(tp);
        setLensMode(true);
        // Mark all pages as analyzed so Submit button is enabled
        analyzedPagesRef.current = new Set(Array.from({ length: cachedPages.length }, (_, i) => i));
        setAnalyzedPageCount(cachedPages.length);
        savePSet({ ...s, savedAt: Date.now() });
        setSavedSets(loadPSets());
        setLensOpen(true);
        return;
      }
    }

    // Cached pages expired or unavailable — prompt re-upload
    savePSet({ ...s, savedAt: Date.now() });
    setSavedSets(loadPSets());
    fileRef.current?.click();
  }

  return (
    <div className="flex-grow flex flex-col items-center py-12 px-4 bg-surface min-h-screen">
      {/* Lens view (PDF mode) */}
      {lensOpen && lensMode && questions.length > 0 && (
        <LensView
          questions={questions}
          pages={pages}
          docKey={docKey}
          totalPages={totalPages}
          allPagesLoaded={totalPages === 0 || analyzedPageCount >= totalPages}
          startIdx={savedSets.find(s => s.id === psetIdRef.current)?.currentIdx ?? 0}
          onExit={(exitIdx) => {
            setLensOpen(false);
            if (psetIdRef.current) {
              const existing = loadPSets().find(p => p.id === psetIdRef.current);
              savePSet({
                id: psetIdRef.current, name: docKey, savedAt: Date.now(), questions, currentIdx: exitIdx,
                lensMode: true, totalPages, hasCachedPages: true,
                // Preserve original expiresAt so the 24h clock doesn't reset on exit
                expiresAt: existing?.expiresAt,
              });
              setSavedSets(loadPSets());
            }
          }}
          onClean={handleClean}
          onPageBoundary={handlePageBoundary}
          onNavigate={onNavigate}
        />
      )}

      {/* Resume banner — shown when user has exited lens but PDF is still in memory */}
      {!lensOpen && lensMode && pages.length > 0 && questions.length > 0 && (
        <div className="w-full max-w-3xl mb-6 border border-amber-200/60 bg-amber-50/40 flex items-center justify-between px-5 py-3">
          <div>
            <span className="font-sans text-[10px] uppercase tracking-[2px] text-amber-700 opacity-70">Session in progress</span>
            <p className="font-sans text-sm mt-0.5 opacity-80">{docKey} — {questions.length} câu</p>
          </div>
          <button onClick={() => setLensOpen(true)}
            className="px-5 py-2 bg-amber-400 text-amber-950 font-sans text-[10px] uppercase tracking-[2px] font-bold hover:bg-amber-300 transition-colors">
            Resume
          </button>
        </div>
      )}

      <div className="text-center mb-12 max-w-2xl">
        <h1 className="font-serif text-5xl text-on-surface mb-5 tracking-tight">Problem Set Analysis</h1>
        <p className="font-sans text-sm text-on-surface opacity-60 italic tracking-wide">
          "Wisdom begins in wonder and the deconstruction of the complex." — Plato
        </p>
        {usage && (
          <p className="font-sans text-[10px] uppercase tracking-[2px] opacity-40 mt-4">
            Session: {usage.total_tokens?.toLocaleString() || 0} tokens · {usage.total_calls || 0} calls
          </p>
        )}
      </div>

      {/* Upload zone */}
      <div className="w-full max-w-3xl bg-surface border border-outline/10 p-12 mb-12 shadow-sm relative">
        <div className="absolute top-0 left-0 w-8 h-8 border-t border-l border-on-surface/30" />
        <div className="absolute top-0 right-0 w-8 h-8 border-t border-r border-on-surface/30" />

        <div className="flex flex-col items-center gap-8">
          <div
            className="w-full border border-dashed border-outline/30 bg-surface-container-highest/20 p-12 text-center hover:bg-surface-container-lowest transition-colors cursor-pointer group"
            onClick={() => fileRef.current?.click()}
            onDragOver={e => e.preventDefault()}
            onDrop={onDrop}
          >
            {loading ? (
              <div className="flex flex-col items-center gap-6 py-4">
                <div className="flex items-center gap-0">
                  {([
                    { n: 1, label: 'Render PDF' },
                    { n: 2, label: 'Vision AI' },
                    { n: 3, label: 'Build Lens' },
                  ] as const).map(({ n, label }, i) => {
                    const done = phase > n;
                    const active = phase === n;
                    return (
                      <div key={n} className="flex items-center">
                        <div className="flex flex-col items-center gap-1.5">
                          <div className={`w-8 h-8 flex items-center justify-center border transition-all duration-500 ${
                            done ? 'bg-on-surface text-surface border-on-surface' :
                            active ? 'border-on-surface text-on-surface' :
                            'border-outline-variant/30 text-on-surface opacity-30'
                          }`}>
                            {done
                              ? <span className="material-symbols-outlined text-[14px]">check</span>
                              : active
                                ? <div className="w-3 h-3 border border-on-surface/40 border-t-on-surface rounded-full animate-spin" />
                                : <span className="font-sans text-[10px]">{n}</span>
                            }
                          </div>
                          <span className={`font-sans text-[9px] uppercase tracking-[1.5px] transition-opacity ${active ? 'opacity-100' : 'opacity-40'}`}>{label}</span>
                        </div>
                        {i < 2 && (
                          <div className={`w-12 h-[1px] mx-1 mb-5 transition-all duration-500 ${done ? 'bg-on-surface' : 'bg-outline-variant/30'}`} />
                        )}
                      </div>
                    );
                  })}
                </div>
                <p className="font-sans text-[10px] uppercase tracking-[2px] text-on-surface opacity-50">
                  {phase === 1 ? 'Rendering PDF pages…' : phase === 2 ? 'Vision AI extracting questions…' : 'Building lens view…'}
                </p>
              </div>
            ) : (
              <>
                <span className="material-symbols-outlined text-on-surface opacity-40 text-4xl mb-5 block group-hover:opacity-60 transition-opacity">upload_file</span>
                <p className="font-serif text-xl text-on-surface mb-2">Upload Problem Set</p>
                <p className="font-sans text-[10px] uppercase tracking-[2px] text-on-surface opacity-40">PDF, image, or text — drag & drop or click</p>
              </>
            )}
          </div>
          <input ref={fileRef} type="file" accept=".pdf,.png,.jpg,.jpeg,.txt" className="hidden"
            onChange={e => e.target.files?.[0] && handleFile(e.target.files[0])} />

          <div className="flex items-center gap-4 w-full">
            <div className="h-[1px] flex-grow bg-outline/10" />
            <span className="font-sans text-[10px] uppercase tracking-[2px] opacity-40">or</span>
            <div className="h-[1px] flex-grow bg-outline/10" />
          </div>

          <button onClick={() => setShowPaste(v => !v)}
            className="border border-outline/20 px-8 py-3 font-sans text-[10px] uppercase tracking-[2px] hover:bg-surface-container-highest transition-colors flex items-center gap-2">
            <span className="material-symbols-outlined text-[16px]">content_paste</span>Paste Problem Text
          </button>

          {showPaste && (
            <div className="w-full flex flex-col gap-4">
              <textarea value={pasteText} onChange={e => setPasteText(e.target.value)}
                placeholder="Paste your problem set text here…"
                className="w-full h-40 border border-outline-variant/30 p-4 font-sans text-sm resize-none bg-surface-container-lowest outline-none focus:border-on-surface/50 transition-colors" />
              <button onClick={handleDecompose} disabled={loading || !pasteText.trim()}
                className="self-end bg-on-surface text-surface px-8 py-3 font-sans text-[10px] uppercase tracking-[2px] hover:opacity-80 transition-opacity disabled:opacity-30 flex items-center gap-2">
                <span className="material-symbols-outlined text-[14px]">analytics</span>Analyse Set
              </button>
            </div>
          )}
        </div>
      </div>

      {/* ── PDF đã tải lên (24h cache) ── */}
      {savedSets.length > 0 && (
        <div className="w-full max-w-3xl mb-10">
          <div className="flex items-center gap-3 mb-4">
            <span className="material-symbols-outlined text-[16px] opacity-40">folder_open</span>
            <span className="font-sans text-[10px] uppercase tracking-[2px] opacity-50">PDF đã tải lên</span>
            <span className="font-sans text-[9px] opacity-30 border border-outline/20 px-1.5 py-0.5">lưu trữ 24h</span>
          </div>
          <div className="flex flex-col gap-2">
            {savedSets.map(s => {
              const now = Date.now();
              const hasCached = !!(s.hasCachedPages && s.expiresAt > now);
              const msLeft = s.expiresAt - now;
              const hLeft = Math.max(0, Math.ceil(msLeft / 3600000));
              const mLeft = Math.max(0, Math.ceil(msLeft / 60000));
              const timeLeft = hLeft >= 1 ? `còn ${hLeft}h` : `còn ${mLeft}m`;
              return (
                <div key={s.id} className="flex items-center justify-between border border-outline/15 px-5 py-3.5 hover:bg-surface-container-lowest transition-colors group">
                  <div className="min-w-0 flex items-start gap-3">
                    <span className={`material-symbols-outlined text-[18px] mt-0.5 flex-shrink-0 ${hasCached ? 'text-amber-500 opacity-80' : 'opacity-25'}`}>
                      {hasCached ? 'picture_as_pdf' : 'picture_as_pdf'}
                    </span>
                    <div className="min-w-0">
                      <p className="font-sans text-sm text-on-surface truncate">{s.name}</p>
                      <p className="font-sans text-[9px] uppercase tracking-[1.5px] opacity-40 mt-0.5">
                        {s.questions.length} câu · Q{s.currentIdx + 1}/{s.questions.length}
                        {hasCached ? (
                          <span className="text-amber-600 opacity-80"> · {timeLeft}</span>
                        ) : (
                          <span className="text-red-400 opacity-70"> · PDF hết hạn</span>
                        )}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0 ml-4">
                    {hasCached ? (
                      <button
                        onClick={() => openSavedSet(s)}
                        className="border border-amber-400/50 bg-amber-50 px-4 py-1.5 font-sans text-[9px] uppercase tracking-[1.5px] text-amber-700 hover:bg-amber-100 transition-colors flex items-center gap-1.5"
                      >
                        <span className="material-symbols-outlined text-[13px]">play_arrow</span>
                        Resume
                      </button>
                    ) : (
                      <button
                        onClick={() => openSavedSet(s)}
                        className="border border-outline/25 px-4 py-1.5 font-sans text-[9px] uppercase tracking-[1.5px] hover:bg-surface-container-lowest transition-colors flex items-center gap-1.5 opacity-60"
                      >
                        <span className="material-symbols-outlined text-[13px]">upload_file</span>
                        Tải lại PDF
                      </button>
                    )}
                    <button
                      onClick={() => { deletePSet(s.id); setSavedSets(loadPSets()); }}
                      className="opacity-0 group-hover:opacity-30 hover:!opacity-70 transition-opacity p-1"
                      title="Xóa"
                    >
                      <span className="material-symbols-outlined text-[14px]">delete</span>
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {error && (
        <div className="w-full max-w-3xl mb-8">
          <p className="font-sans text-xs text-red-600 border border-red-200 bg-red-50 px-4 py-3 text-center">{error}</p>
        </div>
      )}


      {questions.length === 0 && !loading && (
        <section className="w-full max-w-3xl mb-16 opacity-50">
          <div className="flex items-center gap-6 mb-10">
            <div className="h-[1px] flex-grow bg-outline/10" />
            <h2 className="font-serif text-2xl text-on-surface tracking-wide">Example</h2>
            <div className="h-[1px] flex-grow bg-outline/10" />
          </div>
          <div className="bg-surface border border-outline/10 p-8 shadow-sm">
            <p className="font-sans text-sm text-on-surface opacity-60 text-center italic">
              Upload a problem set or paste text above to begin analysis.
            </p>
          </div>
        </section>
      )}
    </div>
  );
}
