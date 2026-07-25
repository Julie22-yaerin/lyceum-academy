import { useEffect, useRef, useState } from 'react';
import { Mic, Square, Type } from 'lucide-react';
import { conceptAnswer, type ConceptExplainItem as ConceptItemT, type ConceptAnswerResult } from '../../lib/gameApi';

const MIN_SECONDS = 30;

export default function ConceptExplainItem({
  item, index, total, onDone, sessionId,
}: {
  sessionId: string;
  item: ConceptItemT;
  index: number;
  total: number;
  onDone: (delta: number) => void;
}) {
  const [mode, setMode] = useState<'text' | 'audio'>('text');
  const [text, setText] = useState('');
  const [recording, setRecording] = useState(false);
  const [hasRecording, setHasRecording] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [micError, setMicError] = useState('');
  const [result, setResult] = useState<ConceptAnswerResult | null>(null);
  const [busy, setBusy] = useState(false);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const timerRef = useRef<number | null>(null);
  const startTimeRef = useRef(0);

  useEffect(() => {
    return () => {
      if (timerRef.current) window.clearInterval(timerRef.current);
      streamRef.current?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  async function startRecording() {
    setMicError('');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const mr = new MediaRecorder(stream);
      mediaRecorderRef.current = mr;
      mr.start();
      startTimeRef.current = Date.now();
      setRecording(true);
      setHasRecording(false);
      setElapsed(0);
      timerRef.current = window.setInterval(() => {
        setElapsed(Math.floor((Date.now() - startTimeRef.current) / 1000));
      }, 250);
    } catch {
      setMicError('Không truy cập được micro — cho phép quyền micro, hoặc chuyển sang gõ chữ.');
    }
  }

  function stopRecording() {
    mediaRecorderRef.current?.stop();
    streamRef.current?.getTracks().forEach((t) => t.stop());
    if (timerRef.current) window.clearInterval(timerRef.current);
    setElapsed(Math.floor((Date.now() - startTimeRef.current) / 1000));
    setRecording(false);
    setHasRecording(true);
  }

  async function submit(skip: boolean) {
    if (busy) return;
    setBusy(true);
    try {
      let r: ConceptAnswerResult;
      if (skip) r = await conceptAnswer(sessionId, item.id, 'skip');
      else if (mode === 'text') r = await conceptAnswer(sessionId, item.id, 'text', text.trim());
      else r = await conceptAnswer(sessionId, item.id, 'audio', '', elapsed);
      setResult(r);
    } finally {
      setBusy(false);
    }
  }

  if (result) {
    return (
      <div className="liquid-glass rounded-3xl p-8 text-center">
        <p className={`text-xs uppercase tracking-widest mb-3 ${result.gave_up ? 'text-red-300' : 'text-emerald-300'}`}>
          {result.gave_up ? 'Bỏ cuộc' : 'Đã cố gắng'} · {result.delta >= 0 ? '+' : ''}{result.delta} điểm
        </p>
        <p className="text-white text-lg leading-relaxed mb-6">{result.taunt}</p>
        <button
          type="button" onClick={() => onDone(result.delta)}
          className="bg-white text-black rounded-full px-8 py-3 text-sm font-semibold hover:bg-white/90 transition-colors"
        >
          Tiếp tục
        </button>
      </div>
    );
  }

  const canSubmit = mode === 'text' ? text.trim().length > 0 : hasRecording;

  return (
    <div className="liquid-glass rounded-3xl p-8">
      <div className="flex items-center justify-between mb-4">
        <span className="text-white/40 text-xs uppercase tracking-widest">Giải thích khái niệm · câu {index + 1}/{total}</span>
        <span className="text-white/40 text-xs uppercase tracking-widest">Mức {item.difficulty}</span>
      </div>
      <p className="text-white text-lg leading-relaxed mb-6">{item.prompt}</p>

      <div className="flex gap-2 mb-4">
        <button
          type="button" onClick={() => setMode('text')}
          className={`flex items-center gap-1.5 rounded-full px-4 py-1.5 text-xs font-medium border transition-colors ${
            mode === 'text' ? 'bg-white text-black border-white' : 'bg-white/5 text-white/70 border-white/10'
          }`}
        >
          <Type className="w-3.5 h-3.5" /> Gõ chữ
        </button>
        <button
          type="button" onClick={() => setMode('audio')}
          className={`flex items-center gap-1.5 rounded-full px-4 py-1.5 text-xs font-medium border transition-colors ${
            mode === 'audio' ? 'bg-white text-black border-white' : 'bg-white/5 text-white/70 border-white/10'
          }`}
        >
          <Mic className="w-3.5 h-3.5" /> Ghi âm
        </button>
      </div>

      {mode === 'text' ? (
        <textarea
          value={text} onChange={(e) => setText(e.target.value)} rows={5}
          placeholder="Giải thích bằng lời của bạn — đừng chỉ gõ &quot;không biết&quot;…"
          className="w-full bg-white/5 rounded-xl px-4 py-3 text-sm text-white/90 outline-none border border-white/10 focus:border-white/30 resize-y mb-6"
        />
      ) : (
        <div className="bg-white/5 rounded-2xl p-6 mb-6 border border-white/10 flex flex-col items-center gap-3">
          {micError && <p className="text-red-300 text-xs">{micError}</p>}
          <p className={`text-2xl font-mono ${elapsed >= MIN_SECONDS ? 'text-emerald-300' : 'text-white/70'}`}>
            {String(Math.floor(elapsed / 60)).padStart(2, '0')}:{String(elapsed % 60).padStart(2, '0')}
          </p>
          <p className="text-white/40 text-xs">Cần tối thiểu {MIN_SECONDS}s</p>
          {!recording ? (
            <button
              type="button" onClick={startRecording}
              className="flex items-center gap-2 bg-white text-black rounded-full px-6 py-2.5 text-sm font-semibold hover:bg-white/90 transition-colors"
            >
              <Mic className="w-4 h-4" /> {hasRecording ? 'Ghi lại' : 'Bắt đầu ghi âm'}
            </button>
          ) : (
            <button
              type="button" onClick={stopRecording}
              className="flex items-center gap-2 bg-red-500 text-white rounded-full px-6 py-2.5 text-sm font-semibold hover:bg-red-400 transition-colors"
            >
              <Square className="w-4 h-4" /> Dừng ghi âm
            </button>
          )}
          {hasRecording && !recording && (
            <p className="text-emerald-300 text-xs">Đã ghi được {elapsed}s.</p>
          )}
        </div>
      )}

      <div className="flex items-center justify-between">
        <button type="button" onClick={() => submit(true)} disabled={busy} className="text-white/40 hover:text-white/70 text-sm transition-colors">
          Bỏ qua
        </button>
        <button
          type="button" disabled={!canSubmit || busy} onClick={() => submit(false)}
          className="bg-white text-black rounded-full px-8 py-2.5 text-sm font-semibold disabled:opacity-30 disabled:cursor-not-allowed hover:bg-white/90 transition-colors"
        >
          Gửi
        </button>
      </div>
    </div>
  );
}
