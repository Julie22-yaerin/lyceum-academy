import { useState, useRef, useCallback, useEffect } from 'react';
import { synthesizeNoteFromUrl, synthesizeNoteFromFile, synthesizeNoteFromText, feynmanTest, noteChatMessage, NoteResult, NoteConcept, FeynmanResult, ChatMsg } from '../lib/api';
import { extractYouTubeInBrowser, parseYouTubeId } from '../lib/youtubeClient';
import { loadKaTeX, renderMath, renderNote } from '../lib/math';
import { loadNotes, saveNote, deleteNote, timeRemaining, detectSubject, type SavedNote } from '../lib/persist';

// ── ConceptCard ───────────────────────────────────────────────────────────
function ConceptCard({ kc }: { kc: NoteConcept & { how_to_use?: string; applications?: string; why?: string } }) {
  const [imgErr, setImgErr] = useState(false);

  return (
    <div className="border border-outline/10 overflow-hidden">
      {/* Wikipedia thumbnail */}
      {kc.image_url && !imgErr && (
        <div className="w-full h-36 bg-surface-container-highest overflow-hidden">
          <img
            src={kc.image_url}
            alt={kc.concept}
            onError={() => setImgErr(true)}
            className="w-full h-full object-cover grayscale opacity-80"
          />
        </div>
      )}
      <div className="p-5 flex flex-col gap-3">
        {/* Header */}
        <div className="flex items-center gap-2">
          <span className="text-xl">{kc.emoji}</span>
          <span className="font-serif text-base font-medium"
            dangerouslySetInnerHTML={{ __html: renderMath(kc.concept) }} />
        </div>

        {/* Formal definition */}
        {kc.definition && (
          <>
            <p className="font-sans text-[10px] uppercase tracking-[1px] opacity-40">Definition</p>
            <p className="font-sans text-xs text-on-surface opacity-80 leading-relaxed italic border-l-2 border-outline/20 pl-3"
              dangerouslySetInnerHTML={{ __html: renderMath(kc.definition) }} />
          </>
        )}

        {/* LaTeX equation */}
        {kc.equation && (
          <div className="bg-surface-container-lowest px-3 py-2.5 text-center font-sans text-sm border border-outline/10"
            dangerouslySetInnerHTML={{ __html: renderMath(`$$${kc.equation}$$`) }} />
        )}

        {/* The WHY */}
        {(kc as any).why && (
          <>
            <p className="font-sans text-[10px] uppercase tracking-[1px] opacity-40">The Why</p>
            <p className="font-sans text-sm opacity-75 leading-relaxed"
              dangerouslySetInnerHTML={{ __html: renderMath((kc as any).why) }} />
          </>
        )}

        {/* How to use */}
        {(kc as any).how_to_use && (
          <>
            <p className="font-sans text-[10px] uppercase tracking-[1px] opacity-40">How to Use</p>
            <p className="font-sans text-sm opacity-75 leading-relaxed"
              dangerouslySetInnerHTML={{ __html: renderMath((kc as any).how_to_use) }} />
          </>
        )}

        {/* Applications */}
        {(kc as any).applications && (
          <>
            <p className="font-sans text-[10px] uppercase tracking-[1px] opacity-40">Applications</p>
            <p className="font-sans text-sm opacity-75 leading-relaxed"
              dangerouslySetInnerHTML={{ __html: renderMath((kc as any).applications) }} />
          </>
        )}

        {/* Fun analogy */}
        {kc.explanation && (
          <p className="font-sans text-sm opacity-60 leading-relaxed italic border-t border-outline/10 pt-2 mt-1"
            dangerouslySetInnerHTML={{ __html: renderMath(kc.explanation) }} />
        )}
      </div>
    </div>
  );
}

// ── DiagramCard — renders an AI-generated SVG diagram ───────────────────
function DiagramCard({ diagram }: { diagram: { type: string; title: string; svg: string } }) {
  const TYPE_LABEL: Record<string, string> = {
    pyramid: '▲ Pyramid', flowchart: '→ Flowchart', mindmap: '◉ Mind Map',
    timeline: '── Timeline', cycle: '↻ Cycle', diagram: '◈ Diagram',
  };
  return (
    <div className="border border-outline/10 overflow-hidden">
      <div className="px-5 py-3 border-b border-outline/10 flex items-center justify-between bg-surface-container-lowest/40">
        <span className="font-sans text-[10px] uppercase tracking-[2px] opacity-50">
          {TYPE_LABEL[diagram.type] || diagram.type}
        </span>
        {diagram.title && (
          <span className="font-serif text-xs opacity-60 italic truncate ml-3 max-w-[240px]">{diagram.title}</span>
        )}
      </div>
      <div
        className="w-full"
        style={{ aspectRatio: '800/480' }}
        dangerouslySetInnerHTML={{ __html: diagram.svg }}
      />
    </div>
  );
}

// ── FeynmanPanel ──────────────────────────────────────────────────────────
type FeynmanState = 'idle' | 'recording' | 'processing' | 'result';

function FeynmanPanel({ note }: { note: NoteResult }) {
  const [phase, setPhase]   = useState<FeynmanState>('idle');
  const [result, setResult] = useState<FeynmanResult | null>(null);
  const [error, setError]   = useState('');
  const [seconds, setSeconds] = useState(0);
  const mrRef    = useRef<MediaRecorder | null>(null);
  const chunks   = useRef<Blob[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  async function startRecording() {
    setError(''); setResult(null); chunks.current = [];
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mr = new MediaRecorder(stream);
      mrRef.current = mr;
      mr.ondataavailable = e => { if (e.data.size > 0) chunks.current.push(e.data); };
      mr.onstop = async () => {
        stream.getTracks().forEach(t => t.stop());
        const blob = new Blob(chunks.current, { type: 'audio/webm' });
        await submit(blob);
      };
      mr.start(200);
      setPhase('recording'); setSeconds(0);
      timerRef.current = setInterval(() => setSeconds(s => s + 1), 1000);
    } catch {
      setError('Could not access the microphone — check your browser permissions.');
    }
  }

  function stopRecording() {
    if (timerRef.current) clearInterval(timerRef.current);
    mrRef.current?.stop();
    setPhase('processing');
  }

  async function submit(blob: Blob) {
    try {
      const concepts = (note.key_concepts || []).map(kc => kc.concept);
      const subject = concepts[0] ? detectSubject(concepts[0]) : detectSubject(note.title || '');
      const data = await feynmanTest(blob, note.title || '', concepts, subject);
      setResult(data); setPhase('result');
    } catch (e: any) {
      setError(e.message || 'Something went wrong'); setPhase('idle');
    }
  }

  function reset() { setPhase('idle'); setResult(null); setError(''); setSeconds(0); }

  const scoreColor = result
    ? result.score >= 8 ? 'text-emerald-600' : result.score >= 5 ? 'text-amber-500' : 'text-red-500'
    : '';
  const scoreLabel = result
    ? result.score >= 8 ? 'You really get it! 🎉' : result.score >= 5 ? 'Pretty good! 🤔' : 'Not quite clear yet 😅'
    : '';

  return (
    <div className="w-full max-w-3xl border border-outline/10 shadow-sm overflow-hidden">
      {/* Header */}
      <div className="px-8 py-5 border-b border-outline/10 bg-surface-container-lowest/30 flex items-center gap-3">
        <span className="text-xl">🧠</span>
        <div>
          <p className="font-serif text-base font-medium">Feynman Test</p>
          <p className="font-sans text-[10px] uppercase tracking-[1.5px] opacity-40 mt-0.5">
            Explain it like they're 5 years old
          </p>
        </div>
      </div>

      <div className="px-8 py-8">
        {/* IDLE */}
        {phase === 'idle' && (
          <div className="flex flex-col items-center gap-5 py-4 text-center">
            <p className="font-sans text-sm opacity-55 leading-relaxed max-w-sm">
              Explain what you just learned out loud. The AI will play a curious 5-year-old — asking the most naive questions it can. If you can explain it clearly, you really understand it.
            </p>
            <button
              onClick={startRecording}
              className="flex items-center gap-3 px-8 py-4 bg-on-surface text-surface font-sans text-[10px] uppercase tracking-[2px] hover:opacity-80 transition-opacity"
            >
              <span className="material-symbols-outlined text-[18px]">mic</span>
              Start explaining
            </button>
          </div>
        )}

        {/* RECORDING */}
        {phase === 'recording' && (
          <div className="flex flex-col items-center gap-6 py-4">
            <div className="relative w-20 h-20 flex items-center justify-center">
              <div className="absolute inset-0 rounded-full bg-red-500/8 animate-ping" />
              <div className="absolute inset-2 rounded-full bg-red-500/15 animate-pulse" />
              <span className="material-symbols-outlined text-red-500 text-3xl relative z-10">mic</span>
            </div>
            <p className="font-sans text-[10px] uppercase tracking-[2px] opacity-45">
              {String(Math.floor(seconds / 60)).padStart(2, '0')}:{String(seconds % 60).padStart(2, '0')} · Recording
            </p>
            <button
              onClick={stopRecording}
              className="flex items-center gap-2 px-6 py-3 border border-red-400/50 text-red-600 font-sans text-[10px] uppercase tracking-[2px] hover:bg-red-50 transition-colors"
            >
              <span className="material-symbols-outlined text-[14px]">stop_circle</span>
              Done, send to AI
            </button>
          </div>
        )}

        {/* PROCESSING */}
        {phase === 'processing' && (
          <div className="flex flex-col items-center gap-5 py-10">
            <span className="text-5xl" style={{ animation: 'bounce 0.8s infinite alternate' }}>👶</span>
            <div className="flex gap-1.5">
              {[0,1,2].map(i => (
                <div key={i} className="w-2 h-2 bg-on-surface rounded-full opacity-30 animate-bounce"
                  style={{ animationDelay: `${i * 0.15}s` }} />
              ))}
            </div>
            <p className="font-sans text-[10px] uppercase tracking-[2px] opacity-40">AI is listening and thinking…</p>
          </div>
        )}

        {/* RESULT */}
        {phase === 'result' && result && (
          <div className="flex flex-col gap-6">

            {/* Score row */}
            <div className="flex items-center gap-4 pb-5 border-b border-outline/10">
              <div className={`font-serif text-5xl font-medium leading-none ${scoreColor}`}>
                {result.score}
                <span className="text-2xl opacity-35 font-sans">/10</span>
              </div>
              <div>
                <p className={`font-sans text-sm font-medium ${scoreColor}`}>{scoreLabel}</p>
                {result.score_reason && (
                  <p className="font-sans text-xs opacity-50 mt-1 leading-relaxed max-w-xs">{result.score_reason}</p>
                )}
              </div>
            </div>

            {/* Child's reaction bubble */}
            <div className="flex gap-3 items-start">
              <div className="shrink-0 w-9 h-9 rounded-full bg-amber-100 border border-amber-200/50 flex items-center justify-center text-lg leading-none">
                👶
              </div>
              <div className="bg-surface-container-lowest border border-outline/10 px-4 py-3 flex-1"
                style={{ borderRadius: '2px 12px 12px 12px' }}>
                <p className="font-sans text-sm leading-relaxed opacity-85">{result.reaction}</p>
              </div>
            </div>

            {/* Questions as child speech bubbles */}
            {result.questions.length > 0 && (
              <div className="flex flex-col gap-2 pl-12">
                {result.questions.map((q, i) => (
                  <div key={i} className="bg-amber-50/80 border border-amber-200/50 px-4 py-2.5"
                    style={{ borderRadius: '12px 12px 12px 2px' }}>
                    <p className="font-sans text-sm text-amber-900 leading-relaxed">🤔 {q}</p>
                  </div>
                ))}
              </div>
            )}

            {/* Gaps — words/concepts child didn't get */}
            {result.gaps.length > 0 && (
              <div>
                <p className="font-sans text-[10px] uppercase tracking-[1.5px] opacity-40 mb-2">Words I didn't understand</p>
                <div className="flex flex-wrap gap-2">
                  {result.gaps.map((g, i) => (
                    <span key={i} className="font-sans text-[11px] px-2.5 py-1 border border-outline/15 bg-surface-container-highest/30 opacity-70">
                      {g}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* Transcript (collapsible) */}
            <details className="border-t border-outline/10 pt-4">
              <summary className="font-sans text-[10px] uppercase tracking-[1.5px] opacity-35 cursor-pointer hover:opacity-60 transition-opacity select-none">
                View the transcript
              </summary>
              <p className="font-sans text-xs opacity-55 leading-relaxed mt-3 italic">"{result.transcript}"</p>
            </details>

            {/* Actions */}
            <div className="flex gap-3">
              <button
                onClick={reset}
                className="flex items-center gap-2 px-5 py-2.5 border border-outline/25 font-sans text-[10px] uppercase tracking-[2px] hover:bg-surface-container-highest transition-colors"
              >
                <span className="material-symbols-outlined text-[14px]">replay</span>
                Try again
              </button>
            </div>
          </div>
        )}

        {error && (
          <p className="font-sans text-xs text-red-600 text-center mt-3 border border-red-100 bg-red-50 px-3 py-2">{error}</p>
        )}
      </div>
    </div>
  );
}

// ── NoteChatPanel — AI dialogue panel (right half) ───────────────────────
const QUICK_PROMPTS = [
  { label: '📊 Comparison table', msg: 'Create a comparison table of the key concepts in this note' },
  { label: '💡 Real-world example', msg: 'Give me 3 real-world examples applying the content of this note' },
  { label: '🤓 Explain in more depth', msg: 'Explain the most important part of this note in more depth, with a concrete example' },
  { label: '✏️ What am I missing?', msg: 'Is there anything important missing from this note? Suggest additions.' },
];

interface ChatBubble { role: 'user' | 'assistant'; content: string; }

function NoteChatPanel({ note }: { note: NoteResult }) {
  const [messages, setMessages] = useState<ChatBubble[]>([]);
  const [input, setInput]       = useState('');
  const [loading, setLoading]   = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef  = useRef<HTMLTextAreaElement>(null);
  const [, setTick] = useState(0);

  useEffect(() => { loadKaTeX(() => setTick(t => t + 1)); }, []);
  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages, loading]);

  async function send(text?: string) {
    const content = (text ?? input).trim();
    if (!content || loading) return;
    setInput('');
    const updated: ChatBubble[] = [...messages, { role: 'user', content }];
    setMessages(updated);
    setLoading(true);
    try {
      const apiMsgs: ChatMsg[] = updated.map(m => ({ role: m.role, content: m.content }));
      const ctx = {
        title: note.title,
        summary: note.summary,
        key_concepts: (note.key_concepts || []).map(kc => ({
          concept: kc.concept,
          definition: kc.definition,
          explanation: kc.explanation,
        })),
        key_insight: note.key_insight,
      };
      const result = await noteChatMessage(apiMsgs, ctx);
      setMessages([...updated, { role: 'assistant', content: result.reply }]);
    } catch (e: any) {
      setMessages([...updated, { role: 'assistant', content: `⚠️ ${e.message}` }]);
    } finally {
      setLoading(false);
    }
  }

  function handleKey(e: { key: string; shiftKey: boolean; preventDefault: () => void }) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
  }

  return (
    <div className="flex flex-col h-full bg-surface border-l border-outline/10">
      {/* Header */}
      <div className="px-6 py-5 border-b border-outline/10 bg-surface-container-lowest/40 shrink-0">
        <p className="font-serif text-xl font-medium">Hey, I'm Lyceum</p>
        <p className="font-sans text-[10px] uppercase tracking-[1.5px] opacity-40 mt-0.5">
          Ask me anything about this note
        </p>
      </div>

      {/* Quick prompts — only before first message */}
      {messages.length === 0 && (
        <div className="px-5 pt-5 pb-2 shrink-0 flex flex-col gap-2">
          {QUICK_PROMPTS.map((qp, i) => (
            <button
              key={i}
              onClick={() => send(qp.msg)}
              disabled={loading}
              className="text-left border border-outline/15 px-4 py-2.5 font-sans text-xs hover:bg-surface-container-lowest transition-colors disabled:opacity-30"
            >
              {qp.label}
            </button>
          ))}
        </div>
      )}

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-5 py-4 flex flex-col gap-4 min-h-0">
        {messages.map((m, i) => (
          <div key={i} className={`flex gap-3 ${m.role === 'user' ? 'flex-row-reverse' : 'flex-row'}`}>
            {/* Avatar */}
            <div className={`shrink-0 w-7 h-7 rounded-full flex items-center justify-center text-xs font-medium
              ${m.role === 'user'
                ? 'bg-on-surface text-surface'
                : 'bg-surface-container-highest border border-outline/15'}`}>
              {m.role === 'user' ? 'M' : '✦'}
            </div>
            {/* Bubble */}
            <div className={`max-w-[82%] px-4 py-3 text-sm leading-relaxed
              ${m.role === 'user'
                ? 'bg-on-surface text-surface font-sans'
                : 'bg-surface-container-lowest border border-outline/10 note-body text-on-surface'}`}
              style={{ borderRadius: m.role === 'user' ? '12px 2px 12px 12px' : '2px 12px 12px 12px' }}>
              {m.role === 'user'
                ? <span className="opacity-90">{m.content}</span>
                : <div dangerouslySetInnerHTML={{ __html: renderNote(m.content) }} />
              }
            </div>
          </div>
        ))}

        {loading && (
          <div className="flex gap-3">
            <div className="w-7 h-7 rounded-full bg-surface-container-highest border border-outline/15 flex items-center justify-center text-xs">✦</div>
            <div className="bg-surface-container-lowest border border-outline/10 px-4 py-3 flex gap-1.5 items-center"
              style={{ borderRadius: '2px 12px 12px 12px' }}>
              {[0,1,2].map(i => (
                <div key={i} className="w-1.5 h-1.5 bg-on-surface rounded-full opacity-30 animate-bounce"
                  style={{ animationDelay: `${i * 0.15}s` }} />
              ))}
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div className="px-5 py-4 border-t border-outline/10 shrink-0 bg-surface">
        <div className="flex gap-3 items-end">
          <textarea
            ref={inputRef}
            rows={2}
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={handleKey}
            placeholder="Ask something about this note... (Enter to send)"
            className="flex-1 border border-outline/20 px-4 py-3 font-sans text-sm bg-surface-container-lowest outline-none focus:border-on-surface/40 transition-colors resize-none leading-relaxed"
            style={{ minHeight: '60px', maxHeight: '120px' }}
          />
          <button
            onClick={() => send()}
            disabled={loading || !input.trim()}
            className="bg-on-surface text-surface w-11 h-11 flex items-center justify-center hover:opacity-80 transition-opacity disabled:opacity-25 shrink-0"
          >
            <span className="material-symbols-outlined text-[18px]">send</span>
          </button>
        </div>
        {messages.length > 0 && (
          <button
            onClick={() => setMessages([])}
            className="mt-2 font-sans text-[9px] uppercase tracking-[1.5px] opacity-25 hover:opacity-50 transition-opacity"
          >
            Clear conversation
          </button>
        )}
      </div>
    </div>
  );
}

// ── NoteCard — rendered output ────────────────────────────────────────────
function NoteCard({ note }: { note: NoteResult }) {
  const [, setKatexTick] = useState(0);
  useEffect(() => { loadKaTeX(() => setKatexTick(t => t + 1)); }, []);

  return (
    <div className="w-full max-w-3xl flex flex-col gap-0 border border-outline/10 shadow-sm overflow-hidden">

      {/* Title + TL;DR */}
      <div className="bg-on-surface text-surface px-8 py-7">
        <h2 className="font-serif text-2xl leading-snug mb-3"
          dangerouslySetInnerHTML={{ __html: renderMath(note.title) }} />
        {note.tldr && (
          <p className="font-sans text-sm opacity-75 leading-relaxed"
            dangerouslySetInnerHTML={{ __html: renderMath(note.tldr) }} />
        )}
        {note.source_type && (
          <span className="font-sans text-[9px] uppercase tracking-[2px] opacity-40 mt-3 block">
            {note.source_type}
            {note.video_id && (
              <a href={`https://youtu.be/${note.video_id}`} target="_blank" rel="noopener noreferrer"
                className="ml-2 underline opacity-60 hover:opacity-100">Watch ↗</a>
            )}
          </span>
        )}
      </div>

      {/* Summary — full rich markdown document */}
      <div className="px-8 py-7 border-b border-outline/10">
        <span className="font-sans text-[10px] uppercase tracking-[2px] opacity-40 block mb-4">Summary</span>
        <div className="note-body text-on-surface"
          dangerouslySetInnerHTML={{ __html: renderNote(note.summary) }} />
      </div>

      {/* Key Concepts — card grid */}
      {note.key_concepts?.length > 0 && (
        <div className="px-8 py-7 border-b border-outline/10">
          <span className="font-sans text-[10px] uppercase tracking-[2px] opacity-40 block mb-5">Key Concepts</span>
          <div className="flex flex-col gap-4">
            {note.key_concepts.map((kc, i) => (
              <ConceptCard key={i} kc={kc} />
            ))}
          </div>
        </div>
      )}

      {/* AI-generated diagrams */}
      {(note as any).diagrams?.length > 0 && (
        <div className="px-8 py-7 border-b border-outline/10">
          <span className="font-sans text-[10px] uppercase tracking-[2px] opacity-40 block mb-5">Diagrams</span>
          <div className="flex flex-col gap-4">
            {((note as any).diagrams as { type: string; title: string; svg: string }[]).map((d, i) => (
              <DiagramCard key={i} diagram={d} />
            ))}
          </div>
        </div>
      )}

      {/* Socratic Questions */}
      {note.socratic_questions?.length > 0 && (
        <div className="px-8 py-7 border-b border-outline/10 bg-surface-container-lowest/40">
          <span className="font-sans text-[10px] uppercase tracking-[2px] opacity-40 block mb-5">Socratic Questions</span>
          <div className="flex flex-col gap-3">
            {note.socratic_questions.map((q, i) => (
              <p key={i} className="font-serif text-base leading-snug italic"
                dangerouslySetInnerHTML={{ __html: renderMath(q) }} />
            ))}
          </div>
        </div>
      )}

      {/* Key Insight */}
      {note.key_insight && (
        <div className="px-8 py-7">
          <span className="font-sans text-[10px] uppercase tracking-[2px] opacity-40 block mb-3">Key Insight</span>
          <p className="font-serif text-lg leading-relaxed"
            dangerouslySetInnerHTML={{ __html: renderMath(note.key_insight) }} />
        </div>
      )}
    </div>
  );
}

// ── Main NoteView ─────────────────────────────────────────────────────────
export default function NoteView() {
  const [note, setNote] = useState<NoteResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [ytUrl, setYtUrl] = useState('');
  const [showYt, setShowYt] = useState(false);
  const [saved, setSaved] = useState(false);         // saved state for current note
  const [sourceType, setSourceType] = useState('');  // track source for save label
  const [savedNotes, setSavedNotes] = useState<SavedNote[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);

  const ACCEPTED = '.pdf,.png,.jpg,.jpeg,.webp';

  useEffect(() => { setSavedNotes(loadNotes()); }, []);

  async function handleFile(file: File) {
    setError(''); setNote(null); setLoading(true); setSaved(false);
    setSourceType(file.type.includes('pdf') ? 'pdf' : 'image');
    try {
      const result = await synthesizeNoteFromFile(file);
      if (result.error) { setError(result.summary || 'Synthesis failed.'); }
      else { setNote(result); }
    } catch (e: any) {
      setError(e.message || String(e));
    } finally { setLoading(false); }
  }

  async function handleYoutube() {
    if (!ytUrl.trim()) return;
    setError(''); setNote(null); setLoading(true); setSaved(false);
    setSourceType('youtube');
    const url = ytUrl.trim();
    try {
      const result = await synthesizeNoteFromUrl(url);
      if (result.error) { setError(result.summary || 'Synthesis failed.'); }
      else { setNote(result); setShowYt(false); }
    } catch (e: any) {
      // Server-side extraction failed (usually YouTube blocking the server's
      // IP). Fall back to extracting from THIS browser — the user's own IP
      // isn't blocked — then submit the transcript for synthesis.
      try {
        const extracted = await extractYouTubeInBrowser(url);
        if (extracted) {
          const result = await synthesizeNoteFromText(extracted.content, extracted.title);
          const vidId = parseYouTubeId(url);
          if (vidId) result.video_id = vidId;
          setNote(result); setShowYt(false);
          return;
        }
      } catch { /* fall through to the original server error */ }
      setError(e.message || String(e));
    } finally { setLoading(false); }
  }

  function handleSaveNote() {
    if (!note) return;
    const id = `note_${Date.now()}`;
    saveNote({ id, title: note.title || 'Note', savedAt: Date.now(), sourceType, note });
    setSavedNotes(loadNotes());
    setSaved(true);
  }

  function openSavedNote(sn: SavedNote) {
    setNote(sn.note as NoteResult);
    setSourceType(sn.sourceType);
    setSaved(true); // already saved
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  }, []);

  return (
    <div className={`flex-grow flex flex-col bg-surface min-h-screen ${note && !loading ? 'px-4 py-4' : 'items-center py-12 px-4'}`}>
      {!note && (
        <div className="text-center mb-12 max-w-2xl">
          <h1 className="font-serif text-5xl text-on-surface mb-5 tracking-tight">Notes</h1>
          <p className="font-sans text-sm text-on-surface opacity-60 italic tracking-wide">
            "The mind is not a vessel to be filled, but a fire to be kindled." — Plutarch
          </p>
        </div>
      )}

      {/* Input area — hidden after note loads */}
      {!note && <div className="w-full max-w-3xl mb-10 flex flex-col gap-5">

        {/* File drop zone */}
        <div
          className="w-full border border-dashed border-outline/30 bg-surface-container-highest/20 p-10 text-center hover:bg-surface-container-lowest transition-colors cursor-pointer group relative"
          onClick={() => fileRef.current?.click()}
          onDragOver={e => e.preventDefault()}
          onDrop={onDrop}
        >
          {loading ? (
            <div className="flex flex-col items-center gap-4 py-2">
              <div className="flex gap-1.5">
                {[0,1,2].map(i => (
                  <div key={i} className="w-2 h-2 bg-on-surface rounded-full opacity-40 animate-bounce"
                    style={{ animationDelay: `${i * 0.15}s` }} />
                ))}
              </div>
              <p className="font-sans text-[10px] uppercase tracking-[2px] opacity-50">
                AI synthesizing note…
              </p>
            </div>
          ) : (
            <>
              <span className="material-symbols-outlined text-on-surface opacity-30 text-4xl mb-4 block group-hover:opacity-50 transition-opacity">
                upload_file
              </span>
              <p className="font-serif text-xl text-on-surface mb-1">Upload PDF or Image</p>
              <p className="font-sans text-[10px] uppercase tracking-[2px] text-on-surface opacity-40">
                Drag & drop or click · PDF, PNG, JPG, WebP
              </p>
            </>
          )}
        </div>
        <input ref={fileRef} type="file" accept={ACCEPTED} className="hidden"
          onChange={e => e.target.files?.[0] && handleFile(e.target.files[0])} />

        {/* Divider */}
        <div className="flex items-center gap-4">
          <div className="h-[1px] flex-grow bg-outline/10" />
          <span className="font-sans text-[10px] uppercase tracking-[2px] opacity-40">or</span>
          <div className="h-[1px] flex-grow bg-outline/10" />
        </div>

        {/* YouTube input */}
        <div>
          <button
            onClick={() => setShowYt(v => !v)}
            className="w-full border border-outline/20 py-4 font-sans text-[10px] uppercase tracking-[2px] hover:bg-surface-container-highest transition-colors flex items-center justify-center gap-3"
          >
            <span className="text-base">▶</span>
            YouTube Video
          </button>
          {showYt && (
            <div className="flex gap-3 mt-3">
              <input
                type="url"
                value={ytUrl}
                onChange={e => setYtUrl(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleYoutube()}
                placeholder="https://youtube.com/watch?v=..."
                className="flex-1 border border-outline-variant/30 px-4 py-3 font-sans text-sm bg-surface-container-lowest outline-none focus:border-on-surface/50 transition-colors"
              />
              <button
                onClick={handleYoutube}
                disabled={loading || !ytUrl.trim()}
                className="bg-on-surface text-surface px-6 py-3 font-sans text-[10px] uppercase tracking-[2px] hover:opacity-80 transition-opacity disabled:opacity-30 flex items-center gap-2"
              >
                {loading
                  ? <div className="w-3 h-3 border border-surface/40 border-t-surface rounded-full animate-spin" />
                  : <span className="material-symbols-outlined text-[14px]">auto_stories</span>
                }
                Synthesise
              </button>
            </div>
          )}
        </div>
      </div>}

      {/* Error */}
      {!note && error && (
        <div className="w-full max-w-3xl mb-8">
          <p className="font-sans text-xs text-red-600 border border-red-200 bg-red-50 px-4 py-3 text-center">{error}</p>
        </div>
      )}
      {/* Error while loading */}
      {loading && error && (
        <div className="w-full max-w-3xl mb-8">
          <p className="font-sans text-xs text-red-600 border border-red-200 bg-red-50 px-4 py-3 text-center">{error}</p>
        </div>
      )}

      {/* Output note — split pane */}
      {note && !loading && (
        <div className="w-full mb-16 flex flex-col gap-4">
          {/* Actions bar */}
          <div className="w-full flex items-center justify-between px-2">
            <button
              onClick={() => { setNote(null); setYtUrl(''); setSaved(false); }}
              className="flex items-center gap-1.5 font-sans text-[10px] uppercase tracking-[2px] opacity-40 hover:opacity-80 transition-opacity"
            >
              <span className="material-symbols-outlined text-[13px]">arrow_back</span>
              New note
            </button>
            {saved ? (
              <div className="flex items-center gap-2 font-sans text-[10px] uppercase tracking-[2px] text-emerald-600 opacity-80">
                <span className="material-symbols-outlined text-[15px]">check_circle</span>
                Saved · 24h left
              </div>
            ) : (
              <button
                onClick={handleSaveNote}
                className="flex items-center gap-2 px-4 py-2 border border-outline/30 font-sans text-[10px] uppercase tracking-[2px] hover:bg-surface-container-highest transition-colors"
              >
                <span className="material-symbols-outlined text-[15px]">bookmark_add</span>
                Save · 24h
              </button>
            )}
          </div>

          {/* Split pane */}
          <div className="w-full flex gap-0 border border-outline/10 shadow-sm overflow-hidden" style={{ height: 'calc(100vh - 120px)', minHeight: '600px' }}>
            {/* Left — Note content (scrollable) */}
            <div className="flex-1 overflow-y-auto" style={{ width: '55%' }}>
              <NoteCard note={note} />
              <div className="px-8 pb-10">
                <FeynmanPanel note={note} />
              </div>
            </div>

            {/* Right — AI Chat (sticky full height) */}
            <div className="shrink-0 flex flex-col" style={{ width: '45%' }}>
              <NoteChatPanel note={note} />
            </div>
          </div>
        </div>
      )}

      {/* Empty state hint */}
      {!note && !loading && !savedNotes.length && (
        <div className="w-full max-w-3xl opacity-40 text-center py-4">
          <p className="font-sans text-sm italic">Upload a document or paste a YouTube link to generate a study note.</p>
        </div>
      )}

      {/* ── Saved Notes (24h) ── */}
      {savedNotes.length > 0 && !note && (
        <div className="w-full max-w-3xl mb-16">
          <div className="flex items-center gap-3 mb-4">
            <span className="material-symbols-outlined text-[16px] opacity-40">folder_open</span>
            <span className="font-sans text-[10px] uppercase tracking-[2px] opacity-50">Saved notes</span>
            <span className="font-sans text-[9px] opacity-30 border border-outline/20 px-1.5 py-0.5">kept for 24h</span>
          </div>
          <div className="flex flex-col gap-2">
            {savedNotes.map(sn => {
              const srcIcon = sn.sourceType === 'youtube' ? '▶' : sn.sourceType === 'pdf' ? '📄' : '🖼';
              return (
                <div key={sn.id} className="flex items-center justify-between border border-outline/15 px-5 py-3.5 hover:bg-surface-container-lowest transition-colors group">
                  <div className="min-w-0 flex items-start gap-3">
                    <span className="text-base flex-shrink-0 mt-0.5">{srcIcon}</span>
                    <div className="min-w-0">
                      <p className="font-sans text-sm text-on-surface truncate"
                        dangerouslySetInnerHTML={{ __html: sn.title.replace(/[\u{1F300}-\u{1FAFF}]/gu, '').trim() || sn.title }} />
                      <p className="font-sans text-[9px] uppercase tracking-[1.5px] mt-0.5">
                        <span className="text-amber-600 opacity-80">{timeRemaining(sn.expiresAt)}</span>
                        <span className="opacity-30"> · {new Date(sn.savedAt).toLocaleDateString('en-US')}</span>
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0 ml-4">
                    <button
                      onClick={() => openSavedNote(sn)}
                      className="border border-amber-400/50 bg-amber-50 px-4 py-1.5 font-sans text-[9px] uppercase tracking-[1.5px] text-amber-700 hover:bg-amber-100 transition-colors flex items-center gap-1.5"
                    >
                      <span className="material-symbols-outlined text-[13px]">open_in_new</span>
                      Review
                    </button>
                    <button
                      onClick={() => { deleteNote(sn.id); setSavedNotes(loadNotes()); }}
                      className="opacity-0 group-hover:opacity-30 hover:!opacity-70 transition-opacity p-1"
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
    </div>
  );
}
