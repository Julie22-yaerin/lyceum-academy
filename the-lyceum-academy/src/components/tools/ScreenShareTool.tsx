/**
 * ScreenShareTool — "Share Screen with AI": capture the screen (browser's
 * native picker lets the student choose window/tab/screen), freeze a
 * frame, drag-select just the region that matters, and send that crop to
 * Socrat for a look — a question back, not a direct answer, the same
 * house rule as everywhere else Socrat shows up.
 */
import { useRef, useState, type MouseEvent as ReactMouseEvent } from 'react';
import { analyzeScreenShare } from '../../lib/lyceumApi';

type Phase = 'idle' | 'sharing' | 'frozen' | 'result';

export default function ScreenShareTool() {
  const [phase, setPhase] = useState<Phase>('idle');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [comment, setComment] = useState('');
  const [question, setQuestion] = useState('');
  const [selection, setSelection] = useState<{ x: number; y: number; w: number; h: number } | null>(null);

  const videoRef = useRef<HTMLVideoElement>(null);
  const frameCanvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const dragStart = useRef<{ x: number; y: number } | null>(null);

  async function startShare() {
    setError('');
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({ video: true });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      setPhase('sharing');
    } catch (e: any) {
      setError(e?.message || 'Screen share was cancelled or denied.');
    }
  }

  function freezeFrame() {
    const video = videoRef.current, canvas = frameCanvasRef.current;
    if (!video || !canvas) return;
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext('2d')?.drawImage(video, 0, 0);
    streamRef.current?.getTracks().forEach(t => t.stop());
    setSelection(null);
    setPhase('frozen');
  }

  function stopAll() {
    streamRef.current?.getTracks().forEach(t => t.stop());
    streamRef.current = null;
    setPhase('idle'); setSelection(null); setComment('');
  }

  function relativePos(e: ReactMouseEvent<HTMLCanvasElement>) {
    const canvas = frameCanvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width, scaleY = canvas.height / rect.height;
    return { x: (e.clientX - rect.left) * scaleX, y: (e.clientY - rect.top) * scaleY };
  }

  function onMouseDown(e: ReactMouseEvent<HTMLCanvasElement>) {
    dragStart.current = relativePos(e);
    setSelection({ x: dragStart.current.x, y: dragStart.current.y, w: 0, h: 0 });
  }
  function onMouseMove(e: ReactMouseEvent<HTMLCanvasElement>) {
    if (!dragStart.current) return;
    const p = relativePos(e);
    const a = dragStart.current;
    setSelection({ x: Math.min(a.x, p.x), y: Math.min(a.y, p.y), w: Math.abs(p.x - a.x), h: Math.abs(p.y - a.y) });
  }
  function onMouseUp() { dragStart.current = null; }

  async function sendToAI() {
    const canvas = frameCanvasRef.current;
    if (!canvas || !selection || selection.w < 10 || selection.h < 10 || busy) return;
    const crop = document.createElement('canvas');
    crop.width = selection.w; crop.height = selection.h;
    crop.getContext('2d')?.drawImage(canvas, selection.x, selection.y, selection.w, selection.h, 0, 0, selection.w, selection.h);
    const dataUrl = crop.toDataURL('image/png');

    setBusy(true); setError('');
    try {
      const result = await analyzeScreenShare(dataUrl, question.trim());
      setComment(result.comment);
      setPhase('result');
    } catch (e: any) {
      setError(e?.message || 'Could not analyze the region — please try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="p-4 flex flex-col gap-3">
      <p className="text-[11px] text-white/50 leading-relaxed">
        Share your screen, freeze a moment, then drag a box around just the part you want Socrat to look at.
      </p>

      {phase === 'idle' && (
        <button onClick={startShare}
          className="self-center rounded-xl px-5 py-2.5 text-[11px] uppercase tracking-[2px] bg-purple-400/15 text-purple-200 hover:bg-purple-400/25 transition-colors">
          Start screen share
        </button>
      )}

      {phase === 'sharing' && (
        <div className="flex flex-col gap-2">
          <video ref={videoRef} className="w-full rounded-xl border border-white/10 bg-black" muted />
          <button onClick={freezeFrame}
            className="self-center rounded-xl px-5 py-2.5 text-[11px] uppercase tracking-[2px] bg-amber-400/15 text-amber-200 hover:bg-amber-400/25 transition-colors">
            Freeze this frame
          </button>
        </div>
      )}
      {/* Hidden while sharing so the video element above stays the visible one */}
      <div className="relative" style={{ display: phase === 'frozen' || phase === 'result' ? 'block' : 'none' }}>
        <canvas
          ref={frameCanvasRef}
          onMouseDown={onMouseDown} onMouseMove={onMouseMove} onMouseUp={onMouseUp} onMouseLeave={onMouseUp}
          className="w-full rounded-xl border border-white/10 cursor-crosshair"
        />
        {selection && (
          <div className="absolute border-2 border-purple-300 bg-purple-400/10 pointer-events-none"
            style={{
              left: `${(selection.x / (frameCanvasRef.current?.width || 1)) * 100}%`,
              top: `${(selection.y / (frameCanvasRef.current?.height || 1)) * 100}%`,
              width: `${(selection.w / (frameCanvasRef.current?.width || 1)) * 100}%`,
              height: `${(selection.h / (frameCanvasRef.current?.height || 1)) * 100}%`,
            }}
          />
        )}
      </div>

      {phase === 'frozen' && (
        <>
          <input
            value={question} onChange={e => setQuestion(e.target.value)}
            placeholder="Optional — what should Socrat focus on?"
            className="w-full bg-white/5 rounded-xl px-3 py-2 text-sm text-white/85 outline-none border border-white/10 focus:border-white/25"
          />
          <div className="flex gap-2 justify-center">
            <button onClick={stopAll} className="rounded-xl px-4 py-2 text-[10px] uppercase tracking-[2px] bg-white/10 text-white/60 hover:bg-white/20 transition-colors">
              Cancel
            </button>
            <button onClick={sendToAI} disabled={!selection || selection.w < 10 || busy}
              className="rounded-xl px-5 py-2 text-[10px] uppercase tracking-[2px] bg-purple-400/15 text-purple-200 hover:bg-purple-400/25 disabled:opacity-30 transition-colors">
              {busy ? 'Looking…' : 'Send region to Socrat'}
            </button>
          </div>
        </>
      )}

      {phase === 'result' && (
        <div className="flex flex-col gap-3">
          <div className="rounded-2xl bg-white/[0.03] p-4">
            <p className="text-[10px] uppercase tracking-[2px] text-purple-300/70 mb-1.5">Socrat</p>
            <p className="text-sm text-white/85 leading-relaxed">{comment}</p>
          </div>
          <button onClick={stopAll} className="self-center rounded-xl px-5 py-2 text-[10px] uppercase tracking-[2px] bg-white/10 text-white/60 hover:bg-white/20 transition-colors">
            New capture
          </button>
        </div>
      )}

      {error && <p className="text-xs text-red-300/80">{error}</p>}
    </div>
  );
}
