/**
 * IllustrationCaptureFlow — the "scan a region, then generate" path reached
 * by hovering the Illustration dock icon and picking Tạo ảnh / Tạo video.
 * Reuses ScreenCropCapture for the scan step (same mechanics as Share
 * Screen with AI), then routes the crop to either the illustration
 * pipeline (POST /ai/screen-share/illustrate) or Veo (POST
 * /ai/screen-share/animate).
 *
 * Video generation is real, wired code — not a mock — but this
 * deployment's Veo key has no billing enabled yet (see
 * backend/app/services/veo.py), so it currently surfaces a plain 503
 * rather than a fake result. Told to the student directly instead of
 * hidden behind a generic "something went wrong."
 */
import { useState } from 'react';
import {
  illustrateScreenShare, animateScreenShare, saveToGallery, type IllustrationShot,
} from '../../lib/lyceumApi';
import ScreenCropCapture from './ScreenCropCapture';

type Mode = 'image' | 'video';
type Phase = 'capture' | 'generating' | 'result';

export default function IllustrationCaptureFlow({ mode, onClose }: { mode: Mode; onClose: () => void }) {
  const [phase, setPhase] = useState<Phase>('capture');
  const [cropDataUrl, setCropDataUrl] = useState<string | null>(null);
  const [shots, setShots] = useState<IllustrationShot[]>([]);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [videoBase64, setVideoBase64] = useState<string | null>(null);
  const [description, setDescription] = useState('');
  const [error, setError] = useState('');
  const [savedIds, setSavedIds] = useState<Set<number | string>>(new Set());

  async function handleCropped(dataUrl: string) {
    setCropDataUrl(dataUrl);
    setPhase('generating');
    setError('');
    try {
      if (mode === 'image') {
        const result = await illustrateScreenShare(dataUrl);
        setShots(result.shots);
        setDescription(result.description);
      } else {
        const result = await animateScreenShare(dataUrl);
        const bytes = Uint8Array.from(atob(result.video_base64), c => c.charCodeAt(0));
        setVideoUrl(URL.createObjectURL(new Blob([bytes], { type: 'video/mp4' })));
        setVideoBase64(result.video_base64);
        setDescription(result.description);
      }
      setPhase('result');
    } catch (e) {
      const msg = e instanceof Error ? e.message : '';
      setError(
        msg.includes('veo_billing_not_enabled') || msg.includes('video_generation_not_configured')
          ? 'Tạo video chưa dùng được — tài khoản Veo của Lyceum chưa bật billing bên Google. Thử "Tạo ảnh" thay thế nhé.'
          : msg || 'Không tạo được — thử lại sau.',
      );
      setPhase('result');
    }
  }

  async function saveShot(index: number, base64: string) {
    try {
      await saveToGallery('image', 'image/png', base64, description.slice(0, 60), '', 'illustration');
      setSavedIds(s => new Set(s).add(index));
    } catch { /* the shot stays visible either way — not worth blocking on */ }
  }

  async function saveVideo() {
    if (!videoBase64) return;
    try {
      await saveToGallery('video', 'video/mp4', videoBase64, description.slice(0, 60), '', 'illustration');
      setSavedIds(s => new Set(s).add('video'));
    } catch { /* keep the player up regardless */ }
  }

  return (
    <>
      {phase === 'capture' && (
        <ScreenCropCapture
          title={mode === 'image' ? 'Chọn vùng để tạo ảnh minh hoạ' : 'Chọn vùng để tạo video'}
          onCropped={handleCropped}
          onCancel={onClose}
        />
      )}

      {phase !== 'capture' && (
        <div className="fixed inset-0 z-[195] bg-[#050508] flex flex-col items-center justify-center p-6 gap-5">
          <button onClick={onClose} className="absolute top-6 right-6 text-white/50 hover:text-white">
            <span className="material-symbols-outlined text-[22px]">close</span>
          </button>

          {cropDataUrl && (
            <img src={cropDataUrl} alt="Vùng đã chọn" className="max-h-[22vh] rounded-lg border border-white/10 opacity-60" />
          )}

          {phase === 'generating' && (
            <p className="text-sm text-white/50 animate-pulse">
              {mode === 'image' ? 'Đang vẽ minh hoạ…' : 'Đang dựng video…'}
            </p>
          )}

          {phase === 'result' && error && (
            <div className="glass-card rounded-3xl max-w-md w-full p-6 text-center flex flex-col items-center gap-4">
              <span className="material-symbols-outlined text-[28px] text-amber-300">warning</span>
              <p className="text-sm text-white/70 leading-relaxed">{error}</p>
              <button onClick={onClose} className="rounded-xl px-5 py-2.5 text-[11px] uppercase tracking-[2px] bg-white/10 text-white/70 hover:bg-white/20">
                Đóng
              </button>
            </div>
          )}

          {phase === 'result' && !error && mode === 'image' && (
            <div className="flex flex-col gap-3 max-w-2xl w-full">
              {shots.map((s, i) => (
                s.image_base64 ? (
                  <div key={i} className="flex flex-col gap-2">
                    <img src={`data:image/png;base64,${s.image_base64}`} alt={s.topic || 'illustration'} className="rounded-xl w-full border border-white/10" />
                    <button onClick={() => saveShot(i, s.image_base64!)} disabled={savedIds.has(i)}
                      className="self-center rounded-lg px-4 py-1.5 text-[10px] uppercase tracking-[1.5px] bg-white/10 text-white/70 hover:bg-white/20 disabled:opacity-40 transition-colors">
                      {savedIds.has(i) ? '✓ Đã lưu vào Gallery' : 'Lưu vào Gallery'}
                    </button>
                  </div>
                ) : (
                  <p key={i} className="text-sm text-red-300/80 text-center">{s.error || 'Không tạo được ảnh.'}</p>
                )
              ))}
            </div>
          )}

          {phase === 'result' && !error && mode === 'video' && videoUrl && (
            <div className="flex flex-col gap-2 max-w-2xl w-full items-center">
              <video src={videoUrl} controls autoPlay loop className="w-full rounded-xl border border-white/10" />
              <button onClick={saveVideo} disabled={savedIds.has('video')}
                className="rounded-lg px-4 py-1.5 text-[10px] uppercase tracking-[1.5px] bg-white/10 text-white/70 hover:bg-white/20 disabled:opacity-40 transition-colors">
                {savedIds.has('video') ? '✓ Đã lưu vào Gallery' : 'Lưu vào Gallery'}
              </button>
            </div>
          )}
        </div>
      )}
    </>
  );
}
