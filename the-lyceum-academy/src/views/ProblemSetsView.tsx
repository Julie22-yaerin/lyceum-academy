import { useState, useRef, useCallback, useEffect } from 'react';
import { useTranslation, getCurrentLang } from '../i18n/I18nContext';
import { uploadProblemSet, decomposeProblemSet, checkMastery, describeDrawing, getUsage, cleanQuestion, gradeAll, gradeDual, analyzePage, analyzePSetQuestions, type PsetAnalysis, revealSolution, evaluateReverseBuild, generateVariantQuestions, type VariantQuestion, generateExercises } from '../lib/api';
import { generateLessonPackage, type BreakGame } from '../lib/lyceumApi';
import { saveGradeSession } from '../lib/progress';
import { saveMistake } from '../lib/mistakes';
import { loadKaTeX, renderMath } from '../lib/math';
import { loadPSets, savePSet, deletePSet, savePages, loadPages, timeAgo, detectSubject, saveNote, type SavedPSet } from '../lib/persist';
import { recordProfileEvent } from '../lib/profile';
import { useWorkspace } from '../context/WorkspaceContext';
import MindMapTool from '../components/MindMapTool';
import GameBuilder from '../components/GameBuilder';
import Confetti from '../components/Confetti';
import { playCorrectSound, playWrongSound, speak } from '../lib/feedbackSounds';

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
  label?: string;    // exact printed question marker (e.g. "1B-2", "Problem 12") — the AI's locator code, distinct from `id`'s internal sequence number
  prompt: string;
  difficulty: 'easy' | 'medium' | 'hard';
  concepts: string[];
  page?: number;     // 0-based (lens mode)
  yStart?: number;   // % from top (lens mode)
  yEnd?: number;     // % from top (lens mode)
  image_url?: string;
}

interface QuestionTimer {
  remaining: number;    // seconds remaining
  total: number;        // total seconds
  timedOut: boolean;
  started: boolean;
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
  const { t } = useTranslation();
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
    const subject = question.concepts[0] ? detectSubject(question.concepts[0]) : detectSubject(question.prompt);
    try { setMasteryResult(await checkMastery(question.prompt, ans, question.concepts, subject)); }
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
  hiddenPages,
  docKey,
  startIdx = 0,
  totalPages = 0,
  allPagesLoaded = false,
  onExit,
  onClean,
  onPageBoundary,
  onNavigate,
  analysis,
  onAllQuestionsDone,
}: {
  questions: Question[];
  pages: PdfPage[];
  hiddenPages?: Set<number>;
  docKey: string;
  startIdx?: number;
  totalPages?: number;
  allPagesLoaded?: boolean;
  onExit: (currentIdx: number) => void;
  onClean: (idx: number) => Promise<void>;
  onPageBoundary?: (nextPage: number) => Promise<number | null>;
  onNavigate?: (view: string) => void;
  analysis?: PsetAnalysis | null;
  onAllQuestionsDone?: (rescuedQuestions: Question[]) => void;
}) {
  const { activeTab } = useWorkspace();
  const [idx, setIdx] = useState(startIdx);
  const [mode, setMode] = useState<'text' | 'canvas'>('text');
  const [answer, setAnswer] = useState('');
  const [showMathKb, setShowMathKb] = useState(false);
  const [masteryResult, setMasteryResult] = useState<{ passed: boolean; feedback: string } | null>(null);
  const [showConfetti, setShowConfetti] = useState(false);
  const [showWrongGlow, setShowWrongGlow] = useState(false);
  const [awaitingNextPage, setAwaitingNextPage] = useState(false);
  const [pendingNextPage, setPendingNextPage] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [distilling, setDistilling] = useState(false);
  const [brushColor, setBrushColor] = useState('#1A1A1A');
  const [brushSize, setBrushSize] = useState(3);
  const [canvasTranscript, setCanvasTranscript] = useState('');
  const [showQuestion, setShowQuestion] = useState(false);
  const [showLibrary, setShowLibrary] = useState(true);
  const [, setKatexTick] = useState(0);

  // ── Timer state ──
  const [timers, setTimers] = useState<Record<string, QuestionTimer>>({});
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  function getEstimatedSeconds(qId: string): number {
    if (!analysis?.estimated_time_per_question) return 0;
    const found = analysis.estimated_time_per_question.find(e => e.id === qId);
    return found ? found.estimated_minutes * 60 : 0;
  }

  // Start/reset timer when question changes
  useEffect(() => {
    const curQ = questions[idx];
    if (!analysis || !curQ) return;
    const secs = getEstimatedSeconds(curQ.id);
    if (secs <= 0) return;
    if (timers[curQ.id]?.started && !timers[curQ.id]?.timedOut) {
      // Timer already running for this question — don't reset
      return;
    }
    setTimers(prev => ({
      ...prev,
      [curQ.id]: { remaining: secs, total: secs, timedOut: false, started: true },
    }));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idx, analysis]);

  // Countdown tick
  useEffect(() => {
    const curQ = questions[idx];
    if (!curQ || !timers[curQ.id]?.started || timers[curQ.id]?.timedOut) return;
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = setInterval(() => {
      setTimers(prev => {
        const cur = prev[curQ.id];
        if (!cur || cur.timedOut || cur.remaining <= 0) {
          if (timerRef.current) clearInterval(timerRef.current);
          return prev;
        }
        const newRemaining = cur.remaining - 1;
        if (newRemaining <= 0) {
          return { ...prev, [curQ.id]: { ...cur, remaining: 0, timedOut: true } };
        }
        return { ...prev, [curQ.id]: { ...cur, remaining: newRemaining } };
      });
    }, 1000);
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idx, timers[questions[idx]?.id]?.started, timers[questions[idx]?.id]?.timedOut]);

  // ── Correct/wrong feedback: sound + confetti on right, sad sound + spoken
  // encouragement + red border glow on wrong. Fires once per new grade result.
  useEffect(() => {
    if (!masteryResult) return;
    if (masteryResult.passed) {
      playCorrectSound();
      setShowConfetti(true);
      const t = setTimeout(() => setShowConfetti(false), 1800);
      return () => clearTimeout(t);
    } else {
      playWrongSound();
      speak("That's okay. May we try again?");
      setShowWrongGlow(true);
      const t = setTimeout(() => setShowWrongGlow(false), 1400);
      return () => clearTimeout(t);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [masteryResult]);

  function formatTime(seconds: number): string {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}:${s.toString().padStart(2, '0')}`;
  }

  function timerColor(remaining: number, total: number): string {
    if (remaining <= 0) return 'text-red-400';
    const ratio = remaining / total;
    if (ratio <= 0.25) return 'text-red-400 animate-pulse';
    if (ratio <= 0.5) return 'text-amber-400';
    return 'text-emerald-400';
  }

  function resetTimerForRetry(qId: string) {
    const secs = getEstimatedSeconds(qId);
    if (secs <= 0) return;
    setTimers(prev => ({ ...prev, [qId]: { remaining: secs, total: secs, timedOut: false, started: true } }));
  }

  // ── Immediate per-question grading + REVERSE_BUILD rescue ─────────────────
  // Countdown hits zero OR the student presses OK → grade right then, not at
  // the end. REVERSE_BUILD (reveal the solution, then rebuild the reasoning
  // from scratch) is a voluntary lifeline the student can spend on ANY
  // question the moment they feel stuck — not gated behind a wrong-attempt
  // count — capped at 3 uses per problem set (persisted per docKey so it
  // survives resuming a saved set). Every question rescued this way is
  // queued for a bonus round of AI-generated variant questions once the
  // whole set is done.
  const MAX_RESCUES = 3;
  const [checkingAnswer, setCheckingAnswer] = useState(false);
  const [wrongAttempts, setWrongAttempts] = useState<Record<string, number>>({});
  const [reverseBuild, setReverseBuild] = useState<{
    qId: string;
    loadingSolution: boolean;
    solution: string;
    requiredTools: string[];
    explanation: string;
    feedback: string;
    verdict: 'pass' | 'partial' | 'fail' | null;
    submitting: boolean;
  } | null>(null);
  const [rescuesUsed, setRescuesUsed] = useState(() => {
    try { return Number(localStorage.getItem(`lyceum_rescues_${docKey}`)) || 0; } catch { return 0; }
  });
  const rescuedRef = useRef<Question[]>([]);
  const submittingRef = useRef(false);

  useEffect(() => {
    if (!docKey) return;
    try { localStorage.setItem(`lyceum_rescues_${docKey}`, String(rescuesUsed)); } catch { /* ignore */ }
  }, [rescuesUsed, docKey]);

  async function getAnswerTextForGrading(): Promise<string> {
    if (mode === 'text') return answer.trim();
    if (canvasTranscript.trim()) return canvasTranscript.trim();
    if (canvasRef.current) {
      try {
        const r = await describeDrawing(canvasRef.current.toDataURL('image/png'));
        setCanvasTranscript(r.text);
        return r.text.trim();
      } catch { /* fall through — nothing to grade */ }
    }
    return '';
  }

  async function startReverseBuild(subject: string) {
    setReverseBuild({
      qId: q.id, loadingSolution: true, solution: '', requiredTools: [],
      explanation: '', feedback: '', verdict: null, submitting: false,
    });
    try {
      const { solution, required_tools } = await revealSolution(q.prompt, q.concepts, subject);
      setReverseBuild(rb => (rb && rb.qId === q.id) ? { ...rb, loadingSolution: false, solution, requiredTools: required_tools } : rb);
    } catch (e: any) {
      setReverseBuild(rb => (rb && rb.qId === q.id) ? { ...rb, loadingSolution: false, solution: e.message || 'Could not load the solution — try again.' } : rb);
    }
  }

  // Voluntary lifeline — the student spends one of their 3 rescues the
  // moment they click it, whatever question they're currently stuck on.
  function useRescue() {
    if (rescuesUsed >= MAX_RESCUES || reverseBuild || checkingAnswer) return;
    const subject = q.concepts[0] ? detectSubject(q.concepts[0]) : detectSubject(q.prompt);
    setRescuesUsed(n => n + 1);
    startReverseBuild(subject);
  }

  async function submitAnswer(fromTimeout = false) {
    // submittingRef (not just checkingAnswer/reverseBuild) covers the whole
    // flow including the post-grade advance delay, so a countdown hitting
    // zero in that brief window can't sneak in a second submission.
    if (submittingRef.current || checkingAnswer || reverseBuild) return;
    submittingRef.current = true;
    try {
      const curQ = q;
      const subject = curQ.concepts[0] ? detectSubject(curQ.concepts[0]) : detectSubject(curQ.prompt);
      const text = await getAnswerTextForGrading();

      if (!text) {
        if (!fromTimeout) return; // manual OK with nothing written — no-op
        // Timeout with nothing written — counts as a miss, no need to burn an API call
        setWrongAttempts(prev => ({ ...prev, [curQ.id]: (prev[curQ.id] ?? 0) + 1 }));
        setMasteryResult({ passed: false, feedback: "Time's up — you didn't write an answer." });
        resetTimerForRetry(curQ.id);
        return;
      }

      setCheckingAnswer(true);
      let result: { passed: boolean; feedback: string };
      try {
        result = await checkMastery(curQ.prompt, text, curQ.concepts, subject);
      } catch (e: any) {
        result = { passed: false, feedback: e.message || 'Could not grade this — please try again.' };
      }
      setCheckingAnswer(false);
      setMasteryResult(result);

      if (result.passed) {
        setWrongAttempts(prev => ({ ...prev, [curQ.id]: 0 }));
        await new Promise(r => setTimeout(r, 900)); // let them see the ✓ before advancing
        await advanceAfterAnswer();
        return;
      }

      setWrongAttempts(prev => ({ ...prev, [curQ.id]: (prev[curQ.id] ?? 0) + 1 }));
      resetTimerForRetry(curQ.id);
    } finally {
      submittingRef.current = false;
    }
  }

  async function submitRebuild() {
    if (!reverseBuild || !reverseBuild.explanation.trim() || reverseBuild.submitting) return;
    const curQ = q;
    const subject = curQ.concepts[0] ? detectSubject(curQ.concepts[0]) : detectSubject(curQ.prompt);
    setReverseBuild(rb => rb ? { ...rb, submitting: true, feedback: '' } : rb);
    try {
      const ev = await evaluateReverseBuild(reverseBuild.explanation, curQ.prompt, reverseBuild.requiredTools, subject);
      if (ev.verdict === 'pass' || ev.next_state === 'TRANSFER_TEST') {
        rescuedRef.current = [...rescuedRef.current, curQ];
        setReverseBuild(null);
        setWrongAttempts(prev => ({ ...prev, [curQ.id]: 0 }));
        setMasteryResult(null);
        await advanceAfterAnswer();
      } else {
        setReverseBuild(rb => rb ? { ...rb, submitting: false, verdict: ev.verdict, feedback: ev.feedback } : rb);
      }
    } catch (e: any) {
      setReverseBuild(rb => rb ? { ...rb, submitting: false, feedback: e.message || 'Could not evaluate — please try again.' } : rb);
    }
  }

  // Countdown hitting zero triggers the same grading path as pressing OK
  useEffect(() => {
    const curQ = questions[idx];
    if (!curQ || checkingAnswer || reverseBuild) return;
    if (timers[curQ.id]?.timedOut) submitAnswer(true);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [timers[questions[idx]?.id]?.timedOut]);

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

  // ── "Black cloth" — once the student has started answering anything, every
  // question they haven't touched yet gets fully covered so they can't skim
  // ahead. A question counts as touched once it's graded or has a saved answer.
  function isTouched(qId: string): boolean {
    return !!gradeResults[qId] || !!pastedNotes[qId]?.trim() || !!pastedImages[qId];
  }
  const hasStartedAny =
    Object.keys(gradeResults).length > 0 ||
    Object.values(pastedNotes).some((v: string) => !!v?.trim()) ||
    Object.keys(pastedImages).length > 0;

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
        // Popup sent an answer — paste + advance directly, bypassing the
        // immediate-grading/REVERSE_BUILD flow (the detached popup has no
        // way to show that UI back to the student).
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
      alert('Your browser is blocking the popup.\n\nClick the 🔒 icon in the address bar → "Always allow popups from localhost", then try again.');
    }
  }

  const q = questions[idx];
  const activePage = q.page ?? 0;
  const yStart = q.yStart ?? 0;
  const yEnd = q.yEnd ?? 100;
  const locked = checkingAnswer || !!reverseBuild;

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

  // Progressive loading is triggered in advanceAfterAnswer (not on navigation)

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
    const subject = q.concepts[0] ? detectSubject(q.concepts[0]) : detectSubject(q.prompt);
    try { setMasteryResult(await checkMastery(q.prompt, ans, q.concepts, subject)); } catch (e: any) { setMasteryResult({ passed: false, feedback: e.message }); } finally { setBusy(false); }
  }

  // Called once a question is resolved — correct, or rescued via REVERSE_BUILD.
  // Pastes the note onto the PDF, advances to the next question, and (on the
  // very last question) hands the rescued-question list up to the parent so
  // it can offer a bonus round of AI-generated variants.
  async function advanceAfterAnswer() {
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

    const currentPage = q.page ?? 0;
    const isLastOnPage = idx === questions.length - 1 ||
      (questions[idx + 1]?.page ?? 0) > currentPage;

    if (!isLastOnPage) {
      await new Promise(r => setTimeout(r, 180));
      setIdx(i => i + 1);
      return;
    }

    // Last question on this page — don't silently jump ahead. Scan forward
    // (skipping any blank/instruction pages) and let the student explicitly
    // choose to move on via the Next Page button once it's ready.
    if (onPageBoundary && totalPages > 0 && currentPage + 1 < totalPages) {
      setAwaitingNextPage(true);
      const readyPage = await onPageBoundary(currentPage + 1);
      setAwaitingNextPage(false);
      if (readyPage !== null) {
        setPendingNextPage(readyPage);
        return;
      }
    }
    onAllQuestionsDone?.(rescuedRef.current);
  }

  function goToNextPage() {
    if (pendingNextPage === null) return;
    const firstQIdx = questions.findIndex(qq => (qq.page ?? 0) === pendingNextPage);
    if (firstQIdx >= 0) setIdx(firstQIdx);
    setPendingNextPage(null);
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
          concepts: oq.concepts,
          subject: oq.concepts[0] ? detectSubject(oq.concepts[0]) : detectSubject(oq.prompt),
          difficulty: oq.difficulty,
        };
      }).filter(Boolean) as { id: string; prompt: string; answer: string; image_b64?: string; concepts: string[]; subject: string; difficulty?: string }[];

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
            concept: oq.concepts[0],
            subject: activeTab || undefined,
          });
        } catch { /* ignore */ }
      });

      // Save to progress store
      saveGradeSession({
        sessionId: `${docKey}_${Date.now()}`,
        date: Date.now(),
        filename: docKey,
        subject: activeTab || undefined,
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
        @keyframes lyceum-wrong-glow {
          0%   { opacity: 0; }
          15%  { opacity: 1; }
          100% { opacity: 0; }
        }
        @keyframes lyceum-next-page-in {
          0%   { transform: scale(0.94); opacity: 0; }
          100% { transform: scale(1); opacity: 1; }
        }
      `}</style>

      {showConfetti && <Confetti />}
      {showWrongGlow && (
        <div
          className="fixed inset-0 z-[290] pointer-events-none"
          style={{
            boxShadow: 'inset 0 0 40px 10px rgba(239,68,68,0.55), inset 0 0 110px 30px rgba(239,68,68,0.3)',
            animation: 'lyceum-wrong-glow 1.4s ease-out forwards',
          }}
        />
      )}

      {awaitingNextPage && (
        <div className="fixed inset-0 z-[295] flex items-center justify-center pointer-events-none">
          <div className="glass-card rounded-2xl px-6 py-4 flex items-center gap-3">
            <div className="w-4 h-4 border-2 border-on-surface/30 border-t-on-surface rounded-full animate-spin" />
            <span className="font-sans text-xs uppercase tracking-[2px] opacity-70">Loading next page…</span>
          </div>
        </div>
      )}

      {pendingNextPage !== null && (
        <div className="fixed inset-0 z-[295] flex items-center justify-center bg-black/50">
          <div className="glass-card rounded-3xl px-8 py-6 flex flex-col items-center gap-3" style={{ animation: 'lyceum-next-page-in 0.25s ease-out' }}>
            <span className="text-3xl">📄</span>
            <p className="font-serif text-lg text-on-surface">Page {(q.page ?? 0) + 1} complete</p>
            <button onClick={goToNextPage}
              className="glass-btn rounded-xl px-6 py-2.5 font-sans text-xs uppercase tracking-[2px] font-bold flex items-center gap-2">
              Next Page
              <span className="material-symbols-outlined text-[16px]">arrow_forward</span>
            </button>
          </div>
        </div>
      )}

      <MindMapTool context={q.prompt} documentId={docKey} />

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
          {/* ── Timer ── */}
          {analysis && timers[q.id]?.started && (
            <span className={`font-mono text-[12px] tracking-wider ${timerColor(timers[q.id].remaining, timers[q.id].total)} ${timers[q.id].timedOut ? 'line-through' : ''}`}>
              {timers[q.id].timedOut ? 'TIMED OUT' : formatTime(timers[q.id].remaining)}
            </span>
          )}
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

          {/* Answer Library toggle */}
          <button
            onClick={() => setShowLibrary(v => !v)}
            title={showLibrary ? 'Hide Answer Library' : 'Show Answer Library'}
            className={`flex items-center gap-1.5 px-3 py-1.5 border font-sans text-[10px] uppercase tracking-[2px] transition-all ${
              showLibrary ? 'border-white/40 text-white/90 bg-white/10' : 'border-white/20 text-white/50 hover:text-white/90 hover:border-white/40'
            }`}>
            <span className="material-symbols-outlined text-[14px]">library_books</span>
            Library
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
          <div className="bg-surface border border-outline-variant/30 shadow-2xl p-8 max-w-sm w-full mx-4" style={{ borderRadius: 22 }}>
            <p className="font-sans text-[10px] uppercase tracking-[2px] text-amber-600 mb-3">Not answered yet</p>
            <p className="font-serif text-base mb-4 leading-snug">
              {warnEmpty.length} question(s) not yet answered:&nbsp;
              <span className="font-sans text-sm opacity-60">{warnEmpty.map(i => `Q${i + 1}`).join(', ')}</span>
            </p>
            <p className="font-sans text-sm opacity-60 mb-6">Submit anyway, or go back and finish them?</p>
            <div className="flex gap-3">
              <button onClick={() => { setWarnEmpty([]); setIdx(warnEmpty[0]); }}
                className="flex-1 border border-outline-variant/30 py-2.5 font-sans text-[10px] uppercase tracking-[2px] hover:bg-surface-container-highest transition-colors">
                Keep working
              </button>
              <button onClick={doGrade}
                className="flex-1 bg-on-surface text-surface py-2.5 font-sans text-[10px] uppercase tracking-[2px] hover:opacity-80 transition-opacity">
                Submit anyway
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── PDF area + Answer Library, side by side ── */}
      <div className="flex-1 flex min-h-0 overflow-hidden">
      <div ref={scrollAreaRef} className="flex-1 overflow-y-auto bg-neutral-800 min-h-0">
        <div className="flex flex-col gap-1 py-2 px-2" style={{ maxWidth: 860, margin: '0 auto' }}>
          {pages.filter(page => !hiddenPages?.has(page.index)).map(page => {
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
                  loading="lazy"
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
                    {/* Top spotlight fade — solid black up top, blending down to
                        clear right at the lit question, like a beam of light. */}
                    {yStart > 0 && (
                      <div className="absolute inset-x-0 top-0 pointer-events-none"
                        style={{ height: `${yStart}%`, zIndex: 7, ...DIM_STYLE,
                          background: 'linear-gradient(to bottom, rgba(0,0,0,0.92) 0%, rgba(0,0,0,0.55) 65%, rgba(0,0,0,0) 100%)' }} />
                    )}
                    {/* Amber focus ring + glow */}
                    <div className="absolute inset-x-0 pointer-events-none"
                      style={{ top: `${yStart}%`, height: `${yEnd - yStart}%`, zIndex: 7,
                        boxShadow: 'inset 0 0 0 2.5px rgba(251,191,36,1), inset 0 0 12px rgba(251,191,36,0.12)' }} />
                    {/* Bottom spotlight fade — mirror of the top band. */}
                    {yEnd < 100 && (
                      <div className="absolute inset-x-0 bottom-0 pointer-events-none"
                        style={{ top: `${yEnd}%`, height: `${100 - yEnd}%`, zIndex: 7, ...DIM_STYLE,
                          background: 'linear-gradient(to top, rgba(0,0,0,0.92) 0%, rgba(0,0,0,0.55) 65%, rgba(0,0,0,0) 100%)' }} />
                    )}
                  </>
                ) : (
                  <div className="absolute inset-0 pointer-events-none"
                    style={{ background: 'rgba(0,0,0,0.72)', zIndex: 7, ...DIM_STYLE }} />
                )}

                {/* Click targets for other questions (above dim) */}
                {!highlightMode && othersOnPage.map(({ oq, oi }) => {
                  const covered = hasStartedAny && !isTouched(oq.id);
                  return (
                    <div key={oi}
                      className="absolute inset-x-0 cursor-pointer group"
                      style={{ top: `${oq.yStart ?? 0}%`, height: `${(oq.yEnd ?? 100) - (oq.yStart ?? 0)}%`, zIndex: 8 }}
                      title={covered ? `Locked — finish Q${idx + 1} first, or jump to Q${oi + 1}` : `Jump to Q${oi + 1}`}
                      onClick={() => setIdx(oi)}
                    >
                      {/* Black cloth — hides not-yet-attempted questions once the
                          student has started answering something, so they can't
                          peek ahead. Already-answered questions stay dimmed only. */}
                      {covered && (
                        <div className="absolute inset-0 flex items-center justify-center"
                          style={{ background: 'radial-gradient(ellipse at center, rgba(0,0,0,0.94) 0%, rgba(0,0,0,1) 75%)' }}>
                          <span className="material-symbols-outlined text-[18px] text-white/25">lock</span>
                        </div>
                      )}
                      <div className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity"
                        style={{ boxShadow: 'inset 0 0 0 1.5px rgba(255,255,255,0.35)' }} />
                      <span className="absolute top-1 left-2 font-sans text-[9px] text-white/40 group-hover:text-white/80 transition-colors select-none">Q{oi + 1}</span>
                    </div>
                  );
                })}

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
                        textTransform: 'uppercase', padding: '2px 7px', borderRadius: 6,
                      }}>
                        Q{oi + 1}{oq.label ? ` · ${oq.label}` : ''}
                      </div>
                    </div>
                  );
                })}

                {/* Answers are NEVER overlaid on the PDF page — they live only in the
                    Answer Library panel (exact user input, untouched by AI). */}

                <div className="absolute bottom-1 right-2 font-sans text-[9px] text-white/30 pointer-events-none select-none" style={{ zIndex: 10 }}>p.{page.index + 1}</div>
              </div>
            );
          })}
        </div>
      </div>

      {/* ── Answer Library — every stored answer, exact user input, in its own
          box, ordered by question number, editable, scrollable. Replaces the
          old yellow-sticky-note overlay on the PDF entirely. ── */}
      {showLibrary && (
        <div className="w-80 flex-shrink-0 border-l border-white/10 bg-neutral-900 flex flex-col min-h-0">
          <div className="px-4 py-2.5 border-b border-white/10 flex items-center justify-between flex-shrink-0">
            <span className="font-sans text-[10px] uppercase tracking-[2px] text-white/50">Answer Library</span>
            <span className="font-sans text-[9px] text-white/30">
              {questions.filter(oq => pastedNotes[oq.id] !== undefined || pastedImages[oq.id] !== undefined).length}/{questions.length} answered
            </span>
          </div>
          <div className="flex-1 overflow-y-auto px-3 py-3 flex flex-col gap-2.5 min-h-0">
            {questions.map((oq, oi) => {
              const noteText = pastedNotes[oq.id];
              const noteImg = pastedImages[oq.id];
              const grade = gradeResults[oq.id];
              const isWrong = grade && !grade.passed;
              const isRight = grade && grade.passed;
              const showingExp = showExplanation === oq.id;
              const isCurrent = oi === idx;
              return (
                <div key={oq.id} className={`glass-pill rounded-2xl ${isCurrent ? '!border-amber-400/50' : ''}`}>
                  <div className="flex items-center justify-between px-3 py-2 cursor-pointer" onClick={() => setIdx(oi)}>
                    <div className="flex items-center gap-2">
                      <span className="font-sans text-[10px] uppercase tracking-[1px] text-white/70 font-bold">Q{oi + 1}{oq.label ? ` · ${oq.label}` : ''}</span>
                      <span className="font-sans text-[9px] text-white/30">Page {(oq.page ?? 0) + 1}</span>
                    </div>
                    {isRight && <span className="text-emerald-400 text-xs">✓</span>}
                    {isWrong && <span className="text-red-400 text-xs">✗</span>}
                  </div>
                  <div className="px-3 pb-3">
                    {noteImg ? (
                      <div className="flex flex-col gap-1.5">
                        <img src={noteImg} alt={`Q${oi + 1} handwritten answer`}
                          className="w-full border border-white/10 bg-white" style={{ maxHeight: 120, objectFit: 'contain' }}
                          loading="lazy" />
                        <button onClick={() => { setIdx(oi); setMode('canvas'); }}
                          className="self-start font-sans text-[9px] uppercase tracking-[1px] text-white/40 hover:text-white/80 transition-colors">
                          Redraw
                        </button>
                      </div>
                    ) : noteText !== undefined ? (
                      <textarea
                        value={noteText}
                        onChange={e => setPastedNotes(prev => ({ ...prev, [oq.id]: e.target.value }))}
                        rows={3}
                        placeholder="Your answer…"
                        className="w-full bg-black/30 border border-white/10 text-white/85 font-sans text-xs p-2 resize-none outline-none focus:border-white/30 transition-colors"
                      />
                    ) : (
                      <button onClick={() => setIdx(oi)}
                        className="w-full text-center py-2 border border-dashed border-white/15 font-sans text-[9px] uppercase tracking-[1px] text-white/30 hover:text-white/60 hover:border-white/30 transition-colors">
                        Not answered — jump to Q{oi + 1}
                      </button>
                    )}
                    {isWrong && (
                      <button onClick={() => setShowExplanation(showingExp ? null : oq.id)}
                        className="mt-2 font-sans text-[9px] uppercase tracking-[1px] text-red-400/70 hover:text-red-400 transition-colors">
                        {showingExp ? 'Hide explanation' : 'Why wrong?'}
                      </button>
                    )}
                    {showingExp && grade && (
                      <div className="mt-2 bg-black/40 border border-red-400/30 p-2.5 rounded-xl">
                        <p className="font-serif text-[11px] leading-relaxed text-white/80" dangerouslySetInnerHTML={{ __html: renderMath(grade.feedback) }} />
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
      </div>

      {/* ── Floating notepad ── */}
      <div
        className="fixed z-[70] bg-surface border border-outline-variant/20 shadow-2xl flex flex-col overflow-hidden"
        style={{ left: panelPos.x, top: panelPos.y, width: 380, maxHeight: panelMin ? 44 : '62vh', minHeight: panelMin ? 44 : 200, borderRadius: 20, transition: 'max-height 0.2s ease' }}
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
              title="Open notepad in a separate window"
              className={`flex items-center gap-1 px-2 py-1 border font-sans text-[9px] uppercase tracking-[1px] transition-all rounded-lg ${
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
                {masteryResult.passed ? '✓ Correct' : `◯ Not quite — attempt ${wrongAttempts[q.id] ?? 1}`}
              </span>
              <p className="font-sans text-sm leading-relaxed opacity-80" dangerouslySetInnerHTML={{ __html: renderMath(masteryResult.feedback) }} />
              {!masteryResult.passed && (
                <button onClick={() => setMasteryResult(null)} className="mt-2 font-sans text-[10px] uppercase tracking-[2px] opacity-50 hover:opacity-100 transition-opacity">Try Again</button>
              )}
            </div>
          ) : checkingAnswer ? (
            <div className="flex-1 flex flex-col items-center justify-center gap-3 min-h-[80px]">
              <div className="w-6 h-6 border-2 border-on-surface/20 border-t-on-surface rounded-full animate-spin" />
              <span className="font-sans text-[10px] uppercase tracking-[2px] opacity-40">Grading your answer…</span>
            </div>
          ) : mode === 'text' ? (
            <textarea ref={textareaRef} value={answer} onChange={e => setAnswer(e.target.value)}
              placeholder="Write your solution here…"
              disabled={locked}
              style={tearing ? { animation: 'tearOff 0.38s ease-in both' } : undefined}
              className="w-full flex-1 min-h-[80px] bg-surface-container-lowest border border-outline-variant/30 p-3 font-sans text-sm resize-none outline-none focus:border-on-surface/50 transition-colors placeholder:text-outline-variant/60 disabled:opacity-30 disabled:cursor-not-allowed" />
          ) : (
            <>
              <div className="relative border border-outline-variant/30 bg-white" style={{ aspectRatio: '4/1.5', ...(tearing ? { animation: 'tearOff 0.38s ease-in both' } : {}) }}>
                <canvas ref={canvasRef} width={1200} height={450}
                  className={`w-full h-full touch-none ${locked ? 'pointer-events-none opacity-30' : 'cursor-crosshair'}`}
                  onMouseDown={startDraw} onMouseMove={draw} onMouseUp={stopDraw} onMouseLeave={stopDraw}
                  onTouchStart={startDraw} onTouchMove={draw} onTouchEnd={stopDraw} />
                {locked && (
                  <div className="absolute inset-0 flex items-center justify-center bg-black/40">
                    <span className="font-sans text-[10px] uppercase tracking-[2px] text-red-400">Locked</span>
                  </div>
                )}
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
                disabled={locked}
                className={`px-4 py-1.5 font-sans text-[9px] uppercase tracking-[2px] transition-colors ${locked ? 'opacity-20 cursor-not-allowed' : mode === m ? 'bg-on-surface text-surface' : 'hover:bg-surface-container-highest'}`}>
                {m === 'text' ? 'Write' : 'Draw'}
              </button>
            ))}
          </div>

          {/* Math keyboard toggle */}
          {mode === 'text' && (
            <button onClick={() => setShowMathKb(v => !v)}
              disabled={locked}
              className={`flex items-center gap-1 px-3 py-1.5 border font-sans text-[9px] uppercase tracking-[2px] transition-colors ${locked ? 'opacity-20 cursor-not-allowed' : showMathKb ? 'border-on-surface bg-on-surface/10' : 'border-outline-variant/30 opacity-50 hover:opacity-100'}`}>
              <span className="material-symbols-outlined text-[14px]">functions</span>Math
            </button>
          )}

          {/* ── Highlighter toggle ── */}
          <div className="flex items-center gap-1 ml-1 border-l border-outline-variant/20 pl-2">
            <button onClick={() => setHighlightMode(v => !v)}
              disabled={locked}
              className={`flex items-center gap-1 px-3 py-1.5 border font-sans text-[9px] uppercase tracking-[2px] transition-colors ${locked ? 'opacity-20 cursor-not-allowed' : highlightMode ? 'border-amber-400 bg-amber-50 text-amber-800' : 'border-outline-variant/30 opacity-50 hover:opacity-100'}`}>
              <span className="material-symbols-outlined text-[14px]">ink_highlighter</span>Highlight
            </button>
            {highlightMode && (
              <>
                {HL_COLORS.map(c => (
                  <button key={c.value}
                    onClick={() => setHlColor(c.value)}
                    title={c.label}
                    className={`w-5 h-5 rounded-md border-2 transition-all ${hlColor === c.value ? 'border-on-surface scale-110' : 'border-transparent opacity-70 hover:opacity-100'}`}
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
            disabled={busy || distilling || (locked)}
            className="flex items-center gap-1 font-sans text-[9px] uppercase tracking-[2px] opacity-50 hover:opacity-100 transition-opacity disabled:opacity-25 px-2 py-1.5">
            {distilling ? <div className="w-3 h-3 border border-on-surface/40 border-t-on-surface rounded-full animate-spin" /> : <span className="text-[11px]">✦</span>}
            Distil
          </button>

          {/* Stuck? — voluntary REVERSE_BUILD lifeline, max 3 per problem set */}
          <button onClick={useRescue}
            disabled={locked || tearing || rescuesUsed >= MAX_RESCUES}
            title={rescuesUsed >= MAX_RESCUES ? 'No rescues left for this problem set' : 'Reveal the solution and rebuild the reasoning from scratch'}
            className="flex items-center gap-1 font-sans text-[9px] uppercase tracking-[2px] text-amber-400/80 hover:text-amber-300 transition-colors disabled:opacity-20 disabled:text-white/40 px-2 py-1.5">
            <span className="text-[11px]">🆘</span>
            Stuck? {MAX_RESCUES - rescuesUsed}/{MAX_RESCUES} left
          </button>

          {/* Check mastery (secondary — small text button) */}
          <button onClick={handleMastery}
            disabled={busy || tearing || (locked) || !!masteryResult || (mode === 'text' ? !answer.trim() : !canvasTranscript.trim())}
            className="flex items-center gap-1 font-sans text-[9px] uppercase tracking-[2px] opacity-35 hover:opacity-70 transition-opacity disabled:opacity-15 px-2 py-1.5">
            {busy
              ? <><div className="w-3 h-3 border border-on-surface/40 border-t-on-surface rounded-full animate-spin" />Checking…</>
              : <><span className="material-symbols-outlined text-[13px]">verified</span>Check</>
            }
          </button>

          {/* OK — PRIMARY: grade the answer now, paste note onto PDF, and advance */}
          <button onClick={() => submitAnswer()}
            disabled={tearing || locked || !!masteryResult}
            className={`px-6 py-1.5 font-sans text-[10px] uppercase tracking-[2px] font-bold flex items-center gap-1.5 ml-1 transition-all ${
              (locked || !!masteryResult) ? 'bg-amber-400/20 text-amber-900/40 cursor-not-allowed' :
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

      {/* ── REVERSE_BUILD rescue overlay — voluntary lifeline, max 3/pset ── */}
      {reverseBuild && (
        <div className="fixed inset-0 z-[60] bg-black/80 flex items-center justify-center p-6">
          <div className="w-full max-w-xl max-h-[85vh] overflow-y-auto bg-surface-container-lowest border border-outline-variant/30 p-6 flex flex-col gap-4">
            <div>
              <span className="font-sans text-[9px] uppercase tracking-[2px] text-red-400">Rescue used — let's rebuild it</span>
              <p className="font-sans text-xs opacity-50 mt-1">Here's the worked solution. Read it, then explain the method back in your own words — from scratch — to move on.</p>
            </div>

            {reverseBuild.loadingSolution ? (
              <div className="flex items-center gap-2 py-6 justify-center">
                <div className="w-5 h-5 border-2 border-on-surface/20 border-t-on-surface rounded-full animate-spin" />
                <span className="font-sans text-[10px] uppercase tracking-[2px] opacity-40">Loading the solution…</span>
              </div>
            ) : (
              <div className="border border-outline-variant/30 bg-surface-container-highest/20 p-4">
                <span className="font-sans text-[9px] uppercase tracking-[2px] opacity-40 block mb-2">Solution</span>
                <p className="font-sans text-sm leading-relaxed" dangerouslySetInnerHTML={{ __html: renderMath(reverseBuild.solution) }} />
                {reverseBuild.requiredTools.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 mt-3">
                    {reverseBuild.requiredTools.map(t => (
                      <span key={t} className="border border-outline-variant/40 px-1.5 py-0.5 font-sans text-[9px] uppercase tracking-[1px] opacity-60">{t}</span>
                    ))}
                  </div>
                )}
              </div>
            )}

            {reverseBuild.feedback && (
              <div className={`border p-3 ${reverseBuild.verdict === 'partial' ? 'border-amber-200 bg-amber-50' : 'border-red-200 bg-red-50'}`}>
                <p className="font-sans text-sm leading-relaxed opacity-80 text-black" dangerouslySetInnerHTML={{ __html: renderMath(reverseBuild.feedback) }} />
              </div>
            )}

            <textarea
              value={reverseBuild.explanation}
              onChange={e => setReverseBuild(rb => rb ? { ...rb, explanation: e.target.value } : rb)}
              placeholder="Rebuild the solution method here, step by step, in your own words…"
              disabled={reverseBuild.loadingSolution || reverseBuild.submitting}
              className="w-full min-h-[120px] bg-surface-container-lowest border border-outline-variant/30 p-3 font-sans text-sm resize-none outline-none focus:border-on-surface/50 transition-colors placeholder:text-outline-variant/60"
            />

            <button
              onClick={submitRebuild}
              disabled={reverseBuild.loadingSolution || reverseBuild.submitting || !reverseBuild.explanation.trim()}
              className="self-end px-6 py-2 font-sans text-[10px] uppercase tracking-[2px] font-bold bg-amber-400 text-amber-950 hover:bg-amber-300 disabled:bg-amber-400/30 disabled:text-amber-900/50 disabled:cursor-not-allowed transition-colors flex items-center gap-1.5">
              {reverseBuild.submitting
                ? <><div className="w-3 h-3 border border-amber-950/40 border-t-amber-950 rounded-full animate-spin" />Checking…</>
                : <>Submit rebuild</>
              }
            </button>
          </div>
        </div>
      )}
    </div>
  );
}


// ── Main ProblemSetsView ──────────────────────────────────────────────────
export default function ProblemSetsView({ onNavigate }: { onNavigate?: (view: string) => void } = {}) {
  const { activeTab } = useWorkspace();
  const [showGameBuilder, setShowGameBuilder] = useState(false);
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
  const [sbTopic, setSbTopic] = useState('');
  const [lessonBusy, setLessonBusy] = useState(false);
  const [lessonError, setLessonError] = useState('');
  const [breakGames, setBreakGames] = useState<BreakGame[]>([]);
  const [gameSeedPrompt, setGameSeedPrompt] = useState('');
  const [rawText, setRawText] = useState('');
  const [usage, setUsage] = useState<{ total_tokens?: number; total_calls?: number } | null>(null);
  const [savedSets, setSavedSets] = useState<SavedPSet[]>([]);
  const [totalPages, setTotalPages] = useState(0);
  const [analyzedPageCount, setAnalyzedPageCount] = useState(0);
  // Pages the AI found zero questions on (cover/instructions pages) — cut from
  // the scrollable lens view entirely rather than just dimmed.
  const [hiddenPages, setHiddenPages] = useState<Set<number>>(new Set());
  const [psetAnalysis, setPsetAnalysis] = useState<PsetAnalysis | null>(null);
  const [showAnalysis, setShowAnalysis] = useState(false);
  const [analyzingQuestions, setAnalyzingQuestions] = useState(false);
  // ── Bonus round: one AI-generated variant per question that needed the
  // REVERSE_BUILD rescue, offered once the whole problem set is done ──
  const [bonusQuestions, setBonusQuestions] = useState<VariantQuestion[]>([]);
  const [bonusAnswers, setBonusAnswers] = useState<Record<string, string>>({});
  const [bonusResults, setBonusResults] = useState<Record<string, { passed: boolean; feedback: string }>>({});
  const [bonusChecking, setBonusChecking] = useState<string | null>(null);
  const [generatingBonus, setGeneratingBonus] = useState(false);
  const psetIdRef = useRef<string>('');
  const fileRef = useRef<HTMLInputElement>(null);
  const phaseTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const analyzedPagesRef = useRef<Set<number>>(new Set());
  const hiddenPagesRef = useRef<Set<number>>(new Set());

  useEffect(() => { getUsage().then(u => setUsage(u)); }, [questions]);
  useEffect(() => { loadKaTeX(() => setKatexTick(t => t + 1)); }, []);
  useEffect(() => { setSavedSets(loadPSets(activeTab || undefined)); }, [activeTab]);

  // ── Trigger AI analysis when questions are loaded ──
  useEffect(() => {
    if (questions.length === 0) { setPsetAnalysis(null); return; }
    setAnalyzingQuestions(true);
    const items = questions.map(q => ({
      id: q.id, prompt: q.prompt, difficulty: q.difficulty, concepts: q.concepts,
    }));
    analyzePSetQuestions(items).then(result => {
      setPsetAnalysis(result);
      setShowAnalysis(true);
    }).catch(() => {
      // silently fail — analysis is non-critical
    }).finally(() => setAnalyzingQuestions(false));
  }, [questions.length]);

  // Fired once by LensView after the last question in the set is resolved.
  // For every question that needed the REVERSE_BUILD rescue, generate one
  // fresh variant to practice — proof they've actually got it now.
  async function handleAllQuestionsDone(rescuedQuestions: Question[]) {
    if (rescuedQuestions.length === 0) return;
    setGeneratingBonus(true);
    try {
      const sources = rescuedQuestions.map(q => ({ prompt: q.prompt, concepts: q.concepts, difficulty: q.difficulty }));
      const { questions: variants } = await generateVariantQuestions(sources);
      setBonusQuestions(variants);
    } catch {
      // silently fail — bonus round is non-critical
    } finally {
      setGeneratingBonus(false);
    }
  }

  async function checkBonusAnswer(vq: VariantQuestion) {
    const ans = (bonusAnswers[vq.id] || '').trim();
    if (!ans || bonusChecking) return;
    setBonusChecking(vq.id);
    try {
      const subject = vq.concepts[0] ? detectSubject(vq.concepts[0]) : detectSubject(vq.prompt);
      const result = await checkMastery(vq.prompt, ans, vq.concepts, subject);
      setBonusResults(prev => ({ ...prev, [vq.id]: result }));
    } catch (e: any) {
      setBonusResults(prev => ({ ...prev, [vq.id]: { passed: false, feedback: e.message || 'Could not grade this — try again.' } }));
    } finally {
      setBonusChecking(null);
    }
  }

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
        const existingSet = loadPSets(activeTab || undefined).find(s => s.name === file.name);
        const id = (psetIdRef.current && docKey === file.name && existingSet)
          ? psetIdRef.current
          : `pset_${Date.now()}`;
        const savedIdx = (existingSet && docKey === file.name) ? existingSet.currentIdx : 0;
        psetIdRef.current = id;
        // Save pages to IndexedDB (async, fire-and-forget; large data)
        if (pgData.length > 0) savePages(id, pgData);
        savePSet({ id, name: file.name, savedAt: Date.now(), questions: qs, currentIdx: savedIdx, lensMode: isLens, totalPages: tp, hasCachedPages: pgData.length > 0, subject: existingSet?.subject ?? activeTab ?? undefined });
        setSavedSets(loadPSets(activeTab || undefined));
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

  // ── Quest cards from the Second Brain — the primary way sets are made now.
  // The generated set is auto-saved immediately (savePSet), so it shows up in
  // the saved-sets list without any manual save step.
  async function handleGenerateFromSecondBrain() {
    const topic = sbTopic.trim();
    if (!topic || loading) return;
    setError(''); setLoading(true); setQuestions([]); setPages([]); setRawText('');
    setLensMode(false); setLensOpen(false);
    const setName = `Second Brain — ${topic}`;
    setDocKey(setName);
    try {
      const subject = activeTab || detectSubject(topic);
      const { cards } = await generateExercises(subject, topic, 8);
      if (!cards?.length) { setError('The Second Brain could not draft questions for this topic — try a more specific one.'); return; }
      const qs: Question[] = cards.map((c, i) => ({
        id: c.id || `sb_${i + 1}`,
        prompt: c.question,
        difficulty: (c.difficulty === 'extreme' ? 'hard' : c.difficulty) as Question['difficulty'],
        concepts: c.concepts || [],
      }));
      setQuestions(qs);
      const id = `pset_${Date.now()}`;
      psetIdRef.current = id;
      savePSet({ id, name: setName, savedAt: Date.now(), questions: qs, currentIdx: 0, lensMode: false, totalPages: 0, hasCachedPages: false, subject: activeTab ?? undefined });
      setSavedSets(loadPSets(activeTab || undefined));
      setSbTopic('');
    } catch (e: any) {
      const msg = e.message || String(e);
      setError(msg.includes('Failed to fetch') ? 'Cannot reach backend — is it running?' : msg);
    } finally { setLoading(false); }
  }

  // ── Full Coach lesson package: 1 illustrated note (auto-saved to Notes),
  // 2 quest sets (daily + suggested past-paper, auto-saved), 1-2 break games
  // (seed the Game Builder). The daily set loads into the workspace right
  // away so the student can start immediately; the past-paper set and note
  // wait in their libraries for later.
  async function handleGenerateLessonPackage() {
    const topic = sbTopic.trim();
    if (!topic || lessonBusy || loading) return;
    setLessonError(''); setLessonBusy(true); setBreakGames([]);
    try {
      const subject = activeTab || detectSubject(topic);
      const pkg = await generateLessonPackage(subject, topic, getCurrentLang());

      if (pkg.note?.title) {
        saveNote({
          id: `note_${Date.now()}`, title: pkg.note.title, savedAt: Date.now(),
          sourceType: 'second-brain', note: pkg.note, subject: activeTab || undefined, folder: 'Lessons',
        });
      }

      const toQuestions = (cards: typeof pkg.daily_cards) => cards.map((c, i) => ({
        id: c.id || `lc_${i + 1}`,
        prompt: c.question,
        difficulty: (c.difficulty === 'extreme' ? 'hard' : c.difficulty) as Question['difficulty'],
        concepts: c.concepts || [],
      }));

      const dailyQs = toQuestions(pkg.daily_cards);
      const pastPaperQs = toQuestions(pkg.past_paper_cards);

      if (dailyQs.length) {
        const id = `pset_${Date.now()}_daily`;
        savePSet({ id, name: `${topic} — Daily Practice`, savedAt: Date.now(), questions: dailyQs, currentIdx: 0, lensMode: false, totalPages: 0, hasCachedPages: false, subject: activeTab ?? undefined });
        psetIdRef.current = id;
        setQuestions(dailyQs);
        setDocKey(`${topic} — Daily Practice`);
      }
      if (pastPaperQs.length) {
        savePSet({ id: `pset_${Date.now()}_pastpaper`, name: `${topic} — Past Paper (suggested)`, savedAt: Date.now(), questions: pastPaperQs, currentIdx: 0, lensMode: false, totalPages: 0, hasCachedPages: false, subject: activeTab ?? undefined });
      }
      setSavedSets(loadPSets(activeTab || undefined));
      setBreakGames(pkg.break_games || []);
      setSbTopic('');
    } catch (e: any) {
      const msg = e.message || String(e);
      setLessonError(msg.includes('Failed to fetch') ? 'Cannot reach backend — is it running?' : msg);
    } finally { setLessonBusy(false); }
  }

  function handleBuildBreakGame(game: BreakGame) {
    setGameSeedPrompt(game.concepts[0] || game.title);
    setShowGameBuilder(true);
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

  /**
   * Analyze forward from nextPageIdx, skipping any page the AI finds zero
   * questions on (cover/instructions pages) — those get hidden from the lens
   * view entirely. Returns the index of the next page that actually has
   * questions ready to view, or null if none remain.
   */
  async function handlePageBoundary(nextPageIdx: number): Promise<number | null> {
    let pageIdx = nextPageIdx;
    while (pageIdx < totalPages) {
      if (hiddenPagesRef.current.has(pageIdx)) { pageIdx++; continue; }
      if (analyzedPagesRef.current.has(pageIdx)) {
        // Already analyzed (e.g. re-entering lens mode) — it has questions,
        // since hidden ones are filtered out above.
        return pageIdx;
      }
      const pageImg = pages[pageIdx];
      if (!pageImg) return null;
      analyzedPagesRef.current.add(pageIdx); // mark early to avoid double-firing
      try {
        const newQs = await analyzePage(pageImg.data, pageIdx, totalPages);
        setAnalyzedPageCount(analyzedPagesRef.current.size);
        if (newQs.length > 0) {
          setQuestions(prev => {
            const merged = [...prev, ...newQs];
            merged.sort((a, b) => (a.page ?? 0) - (b.page ?? 0) || (a.yStart ?? 0) - (b.yStart ?? 0));
            // Re-number IDs
            return merged.map((q, i) => ({ ...q, id: String(i + 1) }));
          });
          return pageIdx;
        }
        // No questions on this page — cut it from the viewable page list and
        // keep scanning forward for the next one that has content.
        hiddenPagesRef.current.add(pageIdx);
        setHiddenPages(new Set(hiddenPagesRef.current));
        pageIdx++;
      } catch {
        analyzedPagesRef.current.delete(pageIdx); // allow retry on failure
        return null;
      }
    }
    return null;
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
        setSavedSets(loadPSets(activeTab || undefined));
        setLensOpen(true);
        return;
      }
    }

    // Cached pages expired or unavailable — prompt re-upload
    savePSet({ ...s, savedAt: Date.now() });
    setSavedSets(loadPSets(activeTab || undefined));
    fileRef.current?.click();
  }

  if (showGameBuilder) {
    return (
      <div className="flex-grow flex flex-col items-center py-12 px-4 bg-surface min-h-screen">
        <button
          onClick={() => { setShowGameBuilder(false); setGameSeedPrompt(''); }}
          className="self-start max-w-6xl w-full mx-auto font-sans text-[10px] uppercase tracking-[2px] opacity-50 hover:opacity-100 transition-opacity mb-2 flex items-center gap-2"
        >
          <span className="material-symbols-outlined text-[16px]">arrow_back</span>
          Back to Problem Sets
        </button>
        <GameBuilder seedPrompt={gameSeedPrompt} />
      </div>
    );
  }

  return (
    <div className="flex-grow flex flex-col items-center py-12 px-4 bg-surface min-h-screen">
      {/* Lens view (PDF mode) */}
      {lensOpen && lensMode && questions.length > 0 && (
        <LensView
          questions={questions}
          pages={pages}
          hiddenPages={hiddenPages}
          docKey={docKey}
          totalPages={totalPages}
          allPagesLoaded={totalPages === 0 || analyzedPageCount >= totalPages}
          startIdx={savedSets.find(s => s.id === psetIdRef.current)?.currentIdx ?? 0}
          analysis={psetAnalysis}
          onExit={(exitIdx) => {
            setLensOpen(false);
            if (psetIdRef.current) {
              const existing = loadPSets(activeTab || undefined).find(p => p.id === psetIdRef.current);
              savePSet({
                id: psetIdRef.current, name: docKey, savedAt: Date.now(), questions, currentIdx: exitIdx,
                lensMode: true, totalPages, hasCachedPages: true,
                // Preserve original expiresAt so the 24h clock doesn't reset on exit
                expiresAt: existing?.expiresAt,
                subject: existing?.subject ?? activeTab ?? undefined,
              });
              setSavedSets(loadPSets(activeTab || undefined));
            }
          }}
          onClean={handleClean}
          onPageBoundary={handlePageBoundary}
          onNavigate={onNavigate}
          onAllQuestionsDone={handleAllQuestionsDone}
        />
      )}

      {/* Resume banner — shown when user has exited lens but PDF is still in memory */}
      {!lensOpen && lensMode && pages.length > 0 && questions.length > 0 && (
        <div className="w-full max-w-3xl mb-6 border border-amber-200/60 bg-amber-50/40 flex items-center justify-between px-5 py-3">
          <div>
            <span className="font-sans text-[10px] uppercase tracking-[2px] text-amber-700 opacity-70">Session in progress</span>
            <p className="font-sans text-sm mt-0.5 opacity-80">{docKey} — {questions.length} questions</p>
          </div>
          <button onClick={() => setLensOpen(true)}
            className="px-5 py-2 bg-amber-400 text-amber-950 font-sans text-[10px] uppercase tracking-[2px] font-bold hover:bg-amber-300 transition-colors">
            Resume
          </button>
        </div>
      )}

      <div className="text-center mb-12 max-w-2xl">
        <button
          onClick={() => setShowGameBuilder(true)}
          className="mb-6 px-5 py-2 border border-outline/20 font-sans text-[10px] uppercase tracking-[2px] hover:bg-surface-container-highest transition-colors inline-flex items-center gap-2"
        >
          🎮 Game Builder
        </button>
        <h1 className="font-serif text-5xl text-on-surface mb-5 tracking-tight">Socrat</h1>
        <p className="font-sans text-sm text-on-surface opacity-60 italic tracking-wide">
          "Wisdom begins in wonder and the deconstruction of the complex." — Plato
        </p>
      </div>

      {/* Quest generator — exercises come from the Second Brain, not uploads */}
      <div className="w-full max-w-3xl bg-surface border border-outline/10 p-12 mb-12 shadow-sm relative">
        <div className="absolute top-0 left-0 w-8 h-8 border-t border-l border-on-surface/30" />
        <div className="absolute top-0 right-0 w-8 h-8 border-t border-r border-on-surface/30" />

        <div className="flex flex-col items-center gap-6">
          {loading ? (
            <div className="flex flex-col items-center gap-4 py-6">
              <div className="flex gap-1.5">
                {[0,1,2].map(i => (
                  <div key={i} className="w-2 h-2 bg-on-surface rounded-full opacity-40 animate-bounce"
                    style={{ animationDelay: `${i * 0.15}s` }} />
                ))}
              </div>
              <p className="font-sans text-[10px] uppercase tracking-[2px] text-on-surface opacity-50">
                Drafting quest cards from your Second Brain…
              </p>
            </div>
          ) : (
            <>
              <span className="text-4xl">🧠</span>
              <div className="text-center">
                <p className="font-serif text-xl text-on-surface mb-2">Generate a Quest Set</p>
                <p className="font-sans text-[10px] uppercase tracking-[2px] text-on-surface opacity-40">
                  Questions are drawn from the Second Brain curriculum vault
                </p>
              </div>
              <div className="w-full flex gap-3">
                <input
                  value={sbTopic}
                  onChange={e => setSbTopic(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') handleGenerateFromSecondBrain(); }}
                  placeholder="Topic — e.g. Stoichiometry, Vectors, Cell division…"
                  className="flex-1 bg-transparent border-b border-outline/30 px-0 py-2 font-sans text-sm outline-none focus:border-on-surface transition-colors"
                />
                <button
                  onClick={handleGenerateFromSecondBrain}
                  disabled={!sbTopic.trim()}
                  className="bg-on-surface text-surface px-8 py-3 font-sans text-[10px] uppercase tracking-[2px] font-bold hover:opacity-80 transition-opacity disabled:opacity-30"
                >
                  Generate
                </button>
              </div>

              <div className="flex items-center gap-4 w-full">
                <div className="h-[1px] flex-grow bg-outline/10" />
                <span className="font-sans text-[10px] uppercase tracking-[2px] opacity-40">or</span>
                <div className="h-[1px] flex-grow bg-outline/10" />
              </div>

              <button
                onClick={handleGenerateLessonPackage}
                disabled={!sbTopic.trim() || lessonBusy}
                className="border border-outline/25 px-6 py-3 font-sans text-[10px] uppercase tracking-[2px] hover:bg-surface-container-highest transition-colors disabled:opacity-30 flex items-center gap-2"
              >
                {lessonBusy && <div className="w-3 h-3 border border-on-surface/30 border-t-on-surface rounded-full animate-spin" />}
                📦 {lessonBusy ? 'Assembling lesson…' : 'Build Full Lesson Package'}
              </button>
              <p className="font-sans text-[10px] opacity-35 text-center max-w-md">
                A full package: 1 illustrated note with sources, a daily quest set, a suggested
                past-paper set (up to 15 cards each), and 1-2 break games — all from the Second Brain.
              </p>
              {lessonError && <p className="font-sans text-sm text-red-600">{lessonError}</p>}

              <p className="font-sans text-[10px] opacity-35 text-center">
                Want your own material in the mix? Add it once via Settings → Second Brain.
              </p>
            </>
          )}
        </div>
      </div>

      {/* Break games from the last lesson package */}
      {breakGames.length > 0 && (
        <div className="w-full max-w-3xl mb-12">
          <div className="flex items-center gap-3 mb-4">
            <span className="text-base">🎮</span>
            <span className="font-sans text-[10px] uppercase tracking-[2px] opacity-50">Short-break games for this lesson</span>
          </div>
          <div className="flex flex-col gap-2">
            {breakGames.map((g, i) => (
              <div key={i} className="flex items-center justify-between border border-outline/15 px-5 py-3.5">
                <div className="min-w-0">
                  <p className="font-sans text-sm text-on-surface">{g.title}</p>
                  <p className="font-sans text-xs opacity-50 mt-0.5">{g.description}</p>
                </div>
                <button
                  onClick={() => handleBuildBreakGame(g)}
                  className="border border-outline/30 px-4 py-2 font-sans text-[9px] uppercase tracking-[1.5px] hover:bg-surface-container-highest transition-colors shrink-0 ml-4"
                >
                  Build this game →
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Overall Analysis Panel ── */}
      {questions.length > 0 && !lensOpen && psetAnalysis && (
        <div className="w-full max-w-3xl mb-10">
          <div className="flex items-center gap-3 mb-4">
            <span className="material-symbols-outlined text-[16px] opacity-40">analytics</span>
            <span className="font-sans text-[10px] uppercase tracking-[2px] opacity-50">Overall Analysis</span>
            <button onClick={() => setShowAnalysis(v => !v)}
              className="font-sans text-[9px] uppercase tracking-[1px] opacity-40 hover:opacity-80 transition-opacity">
              {showAnalysis ? 'Hide' : 'Show'}
            </button>
            {analyzingQuestions && (
              <div className="w-3 h-3 border border-on-surface/40 border-t-on-surface rounded-full animate-spin" />
            )}
          </div>
          {showAnalysis && (
            <div className="border border-outline/15 p-5 space-y-4 bg-surface-container-lowest/30">
              {/* Topic & time */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <span className="material-symbols-outlined text-[18px] opacity-40">topic</span>
                  <span className="font-sans text-sm font-medium">{psetAnalysis.overall_topic || 'Mixed topics'}</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="material-symbols-outlined text-[16px] opacity-40">schedule</span>
                  <span className="font-sans text-[11px] uppercase tracking-[1px] opacity-60">
                    Total: {psetAnalysis.total_estimated_time} min
                  </span>
                </div>
              </div>

              {/* Difficulty distribution */}
              {Object.keys(psetAnalysis.difficulty_distribution).length > 0 && (
                <div>
                  <span className="font-sans text-[9px] uppercase tracking-[2px] opacity-40 block mb-2">Difficulty</span>
                  <div className="flex gap-3">
                    {(['easy', 'medium', 'hard', 'extreme'] as const).map(d => {
                      const count = (psetAnalysis.difficulty_distribution as Record<string, number>)[d] || 0;
                      const vals = Object.values(psetAnalysis.difficulty_distribution as Record<string, number>);
                      const total = vals.reduce((a, b) => a + b, 0);
                      const pct = total > 0 ? (count / total) * 100 : 0;
                      const colors: Record<string, string> = {
                        easy: 'bg-emerald-400/80',
                        medium: 'bg-amber-400/80',
                        hard: 'bg-red-400/80',
                        extreme: 'bg-purple-400/80',
                      };
                      if (count === 0) return null;
                      return (
                        <div key={d} className="flex items-center gap-1.5">
                          <div className="h-2" style={{ width: Math.max(16, pct * 0.6) + 'px', background: colors[d] }} />
                          <span className="font-sans text-[9px] uppercase tracking-[1px] opacity-50">{d} ({count})</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Question types */}
              {Object.keys(psetAnalysis.question_types).length > 0 && (
                <div>
                  <span className="font-sans text-[9px] uppercase tracking-[2px] opacity-40 block mb-2">Question Types</span>
                  <div className="flex flex-wrap gap-2">
                    {Object.entries(
                      (Object.values(psetAnalysis.question_types as Record<string, string>) as string[]).reduce((acc, t) => {
                        acc[t] = (acc[t] || 0) + 1;
                        return acc;
                      }, {} as Record<string, number>)
                    ).map(([type, count]) => (
                      <span key={type} className="border border-outline-variant/30 px-2 py-0.5 font-sans text-[9px] uppercase tracking-[1px] opacity-60">
                        {type.replace(/_/g, ' ')} ×{count}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {/* Per-question time estimates */}
              {psetAnalysis.estimated_time_per_question.length > 0 && (
                <div>
                  <span className="font-sans text-[9px] uppercase tracking-[2px] opacity-40 block mb-2">Estimated Time / Question</span>
                  <div className="grid grid-cols-5 sm:grid-cols-8 gap-1.5">
                    {psetAnalysis.estimated_time_per_question.map(e => (
                      <div key={e.id} className="border border-outline-variant/20 px-2 py-1 text-center bg-surface-container-highest/20">
                        <span className="font-sans text-[8px] uppercase tracking-[1px] opacity-40 block">Q{e.id}</span>
                        <span className="font-sans text-[11px] font-medium">{e.estimated_minutes}m</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* ── Bonus Round — variant practice for every REVERSE_BUILD rescue ── */}
      {!lensOpen && (generatingBonus || bonusQuestions.length > 0) && (
        <div className="w-full max-w-3xl mb-10">
          <div className="flex items-center gap-3 mb-4">
            <span className="material-symbols-outlined text-[16px] opacity-40">refresh</span>
            <span className="font-sans text-[10px] uppercase tracking-[2px] opacity-50">Bonus Round — prove you've got it now</span>
            {generatingBonus && <div className="w-3 h-3 border border-on-surface/40 border-t-on-surface rounded-full animate-spin" />}
          </div>
          {generatingBonus ? (
            <p className="font-sans text-xs opacity-40">Generating fresh practice for the questions you had to rebuild…</p>
          ) : (
            <div className="flex flex-col gap-4">
              {bonusQuestions.map((vq, i) => {
                const result = bonusResults[vq.id];
                return (
                  <div key={vq.id} className="border border-outline-variant/20 p-5">
                    <div className="flex items-center gap-2 mb-2">
                      <span className="font-sans text-[9px] uppercase tracking-[1px] opacity-40">Variant {i + 1}</span>
                      <DiffBadge d={vq.difficulty} />
                    </div>
                    <p className="font-serif text-sm leading-snug mb-3" dangerouslySetInnerHTML={{ __html: renderMath(vq.prompt) }} />
                    <textarea
                      value={bonusAnswers[vq.id] || ''}
                      onChange={e => setBonusAnswers(prev => ({ ...prev, [vq.id]: e.target.value }))}
                      placeholder="Write your solution here…"
                      disabled={bonusChecking === vq.id}
                      className="w-full min-h-[80px] bg-surface-container-lowest border border-outline-variant/30 p-3 font-sans text-sm resize-none outline-none focus:border-on-surface/50 transition-colors placeholder:text-outline-variant/60 mb-2"
                    />
                    {result && (
                      <div className={`border p-3 mb-2 ${result.passed ? 'border-emerald-200 bg-emerald-50' : 'border-amber-200 bg-amber-50'}`}>
                        <span className={`font-sans text-[10px] uppercase tracking-[2px] font-semibold block mb-1 ${result.passed ? 'text-emerald-700' : 'text-amber-700'}`}>
                          {result.passed ? '✓ Correct' : '◯ Keep Exploring'}
                        </span>
                        <p className="font-sans text-sm leading-relaxed opacity-80" dangerouslySetInnerHTML={{ __html: renderMath(result.feedback) }} />
                      </div>
                    )}
                    <button
                      onClick={() => checkBonusAnswer(vq)}
                      disabled={bonusChecking === vq.id || !(bonusAnswers[vq.id] || '').trim()}
                      className="flex items-center gap-1 font-sans text-[9px] uppercase tracking-[2px] opacity-60 hover:opacity-100 transition-opacity disabled:opacity-25">
                      {bonusChecking === vq.id
                        ? <><div className="w-3 h-3 border border-on-surface/40 border-t-on-surface rounded-full animate-spin" />Checking…</>
                        : <><span className="material-symbols-outlined text-[13px]">verified</span>Check</>
                      }
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ── Uploaded PDFs (24h cache) ── */}
      {savedSets.length > 0 && (
        <div className="w-full max-w-3xl mb-10">
          <div className="flex items-center gap-3 mb-4">
            <span className="material-symbols-outlined text-[16px] opacity-40">folder_open</span>
            <span className="font-sans text-[10px] uppercase tracking-[2px] opacity-50">Uploaded PDFs</span>
            <span className="font-sans text-[9px] opacity-30 border border-outline/20 px-1.5 py-0.5">kept for 24h</span>
          </div>
          <div className="flex flex-col gap-2">
            {savedSets.map(s => {
              const now = Date.now();
              const hasCached = !!(s.hasCachedPages && s.expiresAt > now);
              const msLeft = s.expiresAt - now;
              const hLeft = Math.max(0, Math.ceil(msLeft / 3600000));
              const mLeft = Math.max(0, Math.ceil(msLeft / 60000));
              const timeLeft = hLeft >= 1 ? `${hLeft}h left` : `${mLeft}m left`;
              return (
                <div key={s.id} className="flex items-center justify-between border border-outline/15 px-5 py-3.5 hover:bg-surface-container-lowest transition-colors group">
                  <div className="min-w-0 flex items-start gap-3">
                    <span className={`material-symbols-outlined text-[18px] mt-0.5 flex-shrink-0 ${hasCached ? 'text-amber-500 opacity-80' : 'opacity-25'}`}>
                      {hasCached ? 'picture_as_pdf' : 'picture_as_pdf'}
                    </span>
                    <div className="min-w-0">
                      <p className="font-sans text-sm text-on-surface truncate">{s.name}</p>
                      <p className="font-sans text-[9px] uppercase tracking-[1.5px] opacity-40 mt-0.5">
                        {s.questions.length} questions · Q{s.currentIdx + 1}/{s.questions.length}
                        {hasCached ? (
                          <span className="text-amber-600 opacity-80"> · {timeLeft}</span>
                        ) : (
                          <span className="text-red-400 opacity-70"> · PDF expired</span>
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
                        Reload PDF
                      </button>
                    )}
                    <button
                      onClick={() => { deletePSet(s.id); setSavedSets(loadPSets(activeTab || undefined)); }}
                      className="opacity-0 group-hover:opacity-30 hover:!opacity-70 transition-opacity p-1"
                      title="Delete"
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
