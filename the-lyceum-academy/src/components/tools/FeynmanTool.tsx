/**
 * FeynmanTool — global version of the Feynman-technique test, reachable
 * from the ToolDock instead of being buried inside Notes. Pick any saved
 * note, then explain a concept out loud; a "5-year-old" AI listens for
 * gaps in your explanation.
 */
import { useState, useRef } from 'react';
import { feynmanTest, type FeynmanResult } from '../../lib/api';
import { loadNotes, detectSubject, type SavedNote } from '../../lib/persist';
import IllustrationCaptureFlow from './IllustrationCaptureFlow';

type Phase = 'pick' | 'idle' | 'recording' | 'processing' | 'result';

export default function FeynmanTool() {
  const [notes] = useState<SavedNote[]>(() => loadNotes());
  const [note, setNote] = useState<SavedNote | null>(null);
  const [phase, setPhase] = useState<Phase>('pick');
  const [result, setResult] = useState<FeynmanResult | null>(null);
  const [error, setError] = useState('');
  const [seconds, setSeconds] = useState(0);
  // Stuck on a gap Leo/the grader flagged? Let Illustration draw it out as
  // a short silent video instead — same scan-a-region flow as the dock's
  // Illustration hover menu, just reached from inside Feynman's result.
  const [showVideoHelp, setShowVideoHelp] = useState(false);
  const mrRef = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  function pickNote(sn: SavedNote) {
    setNote(sn);
    setPhase('idle');
  }

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
      setError('Microphone access denied.');
    }
  }

  function stopRecording() {
    if (timerRef.current) clearInterval(timerRef.current);
    mrRef.current?.stop();
    setPhase('processing');
  }

  async function submit(blob: Blob) {
    if (!note) return;
    try {
      const concepts = (note.note?.key_concepts || []).map((kc: any) => kc.concept);
      const subject = note.subject || (concepts[0] ? detectSubject(concepts[0]) : detectSubject(note.title || ''));
      const data = await feynmanTest(blob, note.title || '', concepts, subject);
      setResult(data); setPhase('result');
    } catch (e: any) {
      setError(e.message || 'Something went wrong'); setPhase('idle');
    }
  }

  function reset() { setPhase('idle'); setResult(null); setError(''); setSeconds(0); }

  if (phase === 'pick' || !note) {
    return (
      <div className="p-2">
        <p className="text-xs uppercase tracking-[2px] text-white/40 mb-3">Pick a note to explain</p>
        {notes.length === 0 ? (
          <p className="text-sm text-white/40">No saved notes yet — synthesize one in Socrat or Notes first.</p>
        ) : (
          <div className="flex flex-col gap-2 max-h-80 overflow-y-auto">
            {notes.map(sn => (
              <button key={sn.id} onClick={() => pickNote(sn)}
                className="text-left glass-pill rounded-xl px-4 py-2.5 text-sm text-white/80 hover:bg-white/10 transition-colors truncate">
                🧠 {sn.title}
              </button>
            ))}
          </div>
        )}
      </div>
    );
  }

  const scoreColor = result ? (result.score >= 8 ? 'text-emerald-400' : result.score >= 5 ? 'text-amber-400' : 'text-red-400') : '';

  return (
    <div className="p-2">
      <button onClick={() => setPhase('pick')} className="text-[10px] uppercase tracking-[1.5px] text-white/40 hover:text-white/70 mb-3">
        ← Change note
      </button>
      <p className="text-sm text-white/70 mb-4">Explaining: <span className="text-white">{note.title}</span></p>

      {phase === 'idle' && (
        <div className="flex flex-col items-center gap-4 py-6 text-center">
          <p className="text-xs text-white/50 max-w-xs">Explain this concept out loud in your own simple words.</p>
          <button onClick={startRecording} className="glass-btn rounded-xl px-6 py-3 text-[10px] uppercase tracking-[2px] flex items-center gap-2">
            <span className="material-symbols-outlined text-[16px]">mic</span> Start explaining
          </button>
        </div>
      )}

      {phase === 'recording' && (
        <div className="flex flex-col items-center gap-4 py-6">
          <div className="w-16 h-16 rounded-full bg-red-500/15 flex items-center justify-center animate-pulse">
            <span className="material-symbols-outlined text-red-400 text-2xl">mic</span>
          </div>
          <p className="text-[10px] uppercase tracking-[2px] text-white/40">
            {String(Math.floor(seconds / 60)).padStart(2, '0')}:{String(seconds % 60).padStart(2, '0')} · Recording
          </p>
          <button onClick={stopRecording} className="glass-btn rounded-xl px-5 py-2.5 text-[10px] uppercase tracking-[2px]">
            Done — send
          </button>
        </div>
      )}

      {phase === 'processing' && (
        <div className="flex flex-col items-center gap-3 py-8">
          <div className="w-3 h-3 border border-white/30 border-t-white rounded-full animate-spin" />
          <p className="text-[10px] uppercase tracking-[2px] text-white/40">Listening…</p>
        </div>
      )}

      {phase === 'result' && result && (
        <div className="flex flex-col gap-4">
          <div className="flex items-center gap-3">
            <span className={`text-4xl font-serif ${scoreColor}`}>{result.score}<span className="text-lg text-white/30">/10</span></span>
            {result.score_reason && <p className="text-xs text-white/50">{result.score_reason}</p>}
          </div>
          <p className="text-sm text-white/80 glass-pill rounded-xl px-4 py-3">{result.reaction}</p>
          {result.questions.length > 0 && (
            <div className="flex flex-col gap-2">
              {result.questions.map((q, i) => (
                <p key={i} className="text-sm text-amber-200 bg-amber-400/10 rounded-xl px-4 py-2.5">🤔 {q}</p>
              ))}
            </div>
          )}
          <div className="flex items-center gap-4">
            <button onClick={reset} className="text-[10px] uppercase tracking-[1.5px] text-white/40 hover:text-white/70">
              ↺ Try again
            </button>
            <button onClick={() => setShowVideoHelp(true)} className="text-[10px] uppercase tracking-[1.5px] text-purple-300 hover:text-purple-200 flex items-center gap-1">
              <span className="material-symbols-outlined text-[14px]">movie</span> Tạo video minh hoạ (không lời)
            </button>
          </div>
        </div>
      )}

      {error && <p className="text-xs text-red-300/80 mt-3">{error}</p>}

      {showVideoHelp && <IllustrationCaptureFlow mode="video" onClose={() => setShowVideoHelp(false)} />}
    </div>
  );
}
