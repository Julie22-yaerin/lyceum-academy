/**
 * ScreenCropCapture — the capture -> freeze -> drag-select flow shared by
 * Share Screen with AI and the Illustration tool's "scan a region" step.
 * Owns the whole viewport (screenshot-tool style), and calls back with a
 * single cropped PNG data URL once the student confirms a selection.
 *
 * Deliberately just the capture mechanics — no chat, no generation. Callers
 * decide what happens to the crop.
 */
import { useEffect, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react';

type Phase = 'capturing' | 'live' | 'selecting';

export default function ScreenCropCapture({
  title, onCropped, onCancel,
}: {
  title?: string;
  onCropped: (dataUrl: string) => void;
  onCancel: () => void;
}) {
  const [phase, setPhase] = useState<Phase>('capturing');
  const [error, setError] = useState('');
  const [selection, setSelection] = useState<{ x: number; y: number; w: number; h: number } | null>(null);

  const videoRef = useRef<HTMLVideoElement>(null);
  const frameCanvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const dragStart = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    let cancelled = false;
    navigator.mediaDevices.getDisplayMedia({ video: true }).then(stream => {
      if (cancelled) { stream.getTracks().forEach(t => t.stop()); return; }
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.play().catch(() => {});
      }
      setPhase('live');
    }).catch((e: unknown) => {
      if (cancelled) return;
      setError(e instanceof Error ? e.message : 'Chia sẻ màn hình bị huỷ hoặc từ chối.');
    });
    return () => {
      cancelled = true;
      streamRef.current?.getTracks().forEach(t => t.stop());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function freezeFrame() {
    const video = videoRef.current, canvas = frameCanvasRef.current;
    if (!video || !canvas) return;
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext('2d')?.drawImage(video, 0, 0);
    streamRef.current?.getTracks().forEach(t => t.stop());
    setSelection(null);
    setPhase('selecting');
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

  function confirmSelection() {
    const canvas = frameCanvasRef.current;
    if (!canvas || !selection || selection.w < 10 || selection.h < 10) return;
    const crop = document.createElement('canvas');
    crop.width = selection.w; crop.height = selection.h;
    crop.getContext('2d')?.drawImage(canvas, selection.x, selection.y, selection.w, selection.h, 0, 0, selection.w, selection.h);
    onCropped(crop.toDataURL('image/png'));
  }

  function fullCancel() {
    streamRef.current?.getTracks().forEach(t => t.stop());
    onCancel();
  }

  if (error) {
    return (
      <div className="fixed inset-0 z-[195] bg-[#050508] flex items-center justify-center p-6">
        <div className="glass-card rounded-3xl max-w-sm w-full p-7 text-center flex flex-col items-center gap-4">
          <span className="material-symbols-outlined text-[32px] text-red-300">screen_share_off</span>
          <p className="text-sm text-white/70">{error}</p>
          <button onClick={fullCancel} className="rounded-xl px-5 py-2.5 text-[11px] uppercase tracking-[2px] bg-white/10 text-white/70 hover:bg-white/20">
            Đóng
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-[195] bg-[#050508] flex items-center justify-center overflow-hidden">
      {(phase === 'capturing' || phase === 'live') && (
        <div className="relative flex-1 h-full flex items-center justify-center">
          <video ref={videoRef} className="max-w-full max-h-full" muted />
          {phase === 'capturing' && <p className="absolute text-sm text-white/50">Đang chờ bạn chọn màn hình/cửa sổ để chia sẻ…</p>}
          {phase === 'live' && (
            <button onClick={freezeFrame}
              className="absolute bottom-10 rounded-full px-6 py-3 text-xs uppercase tracking-[2px] bg-amber-400/90 text-black font-bold hover:bg-amber-300 transition-colors shadow-xl">
              📸 Chụp
            </button>
          )}
          {title && <p className="absolute top-6 left-1/2 -translate-x-1/2 text-xs text-white/50">{title}</p>}
          <button onClick={fullCancel} className="absolute top-6 right-6 text-white/50 hover:text-white">
            <span className="material-symbols-outlined text-[22px]">close</span>
          </button>
        </div>
      )}

      {phase === 'selecting' && (
        <div className="relative flex-1 h-full flex items-center justify-center overflow-hidden">
          <div className="relative">
            <canvas
              ref={frameCanvasRef}
              onMouseDown={onMouseDown} onMouseMove={onMouseMove} onMouseUp={onMouseUp} onMouseLeave={onMouseUp}
              className="max-w-[95vw] max-h-[85vh] cursor-crosshair"
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
          <p className="absolute top-6 left-1/2 -translate-x-1/2 text-xs text-white/50">
            {title || 'Kéo chuột để chọn vùng nội dung'}
          </p>
          <div className="absolute bottom-8 flex gap-2">
            <button onClick={fullCancel} className="rounded-full px-5 py-2.5 text-[11px] uppercase tracking-[2px] bg-white/10 text-white/60 hover:bg-white/20">
              Huỷ
            </button>
            <button onClick={confirmSelection} disabled={!selection || selection.w < 10 || selection.h < 10}
              className="rounded-full px-6 py-2.5 text-[11px] uppercase tracking-[2px] bg-purple-400 text-black font-bold hover:bg-purple-300 disabled:opacity-30 disabled:cursor-not-allowed">
              Xong
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
