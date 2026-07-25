/**
 * BreakReels — the 12-15s shorts that play during a study break.
 *
 * Deliberately kept optional and quiet: the break exists to rest, and the
 * copy still says to look away from the screen. But a student who is going to
 * pick up a phone anyway is better off watching four ideas from their own
 * subject than an infinite feed, so the playlist is right there, one tap in,
 * and one tap out.
 *
 * The reels have no audio track, so there is nothing to mute and nothing to
 * blast into a quiet room.
 */
import { useEffect, useRef, useState } from 'react';
import { ChevronRight, EyeOff, Play } from 'lucide-react';
import { pickBreakReels, type BreakReel } from '../lib/breakReels';

export default function BreakReels({ subject }: { subject: string | null }) {
  // Chosen once per mount — a break is one mount, so the playlist (and the
  // rotation counter it advances) is stable for the whole break.
  const [playlist] = useState<BreakReel[]>(() => pickBreakReels(subject, 4));
  const [index, setIndex] = useState(0);
  const [open, setOpen] = useState(false);
  const videoRef = useRef<HTMLVideoElement | null>(null);

  const reel = playlist[index];

  useEffect(() => {
    const v = videoRef.current;
    if (!open || !v) return;
    // Autoplay is only permitted while muted; these files carry no audio
    // anyway, so play() should not be blocked.
    v.play().catch(() => { /* browser declined — the poster and controls stay */ });
  }, [open, index]);

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="glass rounded-2xl px-4 py-3 flex items-center gap-3 text-left w-full max-w-xs hover:bg-white/10 transition-colors"
      >
        <span className="w-9 h-9 rounded-xl bg-white/10 flex items-center justify-center shrink-0">
          <Play className="w-4 h-4 text-white/80" />
        </span>
        <span>
          <span className="block text-xs text-white/85">Xem {playlist.length} reel ôn tập</span>
          <span className="block text-[10px] text-white/40">
            mỗi cái ~14 giây · không có tiếng
          </span>
        </span>
      </button>
    );
  }

  return (
    <div className="flex flex-col items-center gap-3 w-full max-w-[280px]">
      <div className="relative w-full rounded-2xl overflow-hidden bg-black/60 border border-white/10">
        <video
          ref={videoRef}
          key={reel.id}
          src={reel.src}
          poster={reel.poster}
          muted
          playsInline
          preload="auto"
          className="w-full aspect-[9/16] object-cover"
          onEnded={() => setIndex(i => (i + 1) % playlist.length)}
        />
        <button
          onClick={() => setIndex(i => (i + 1) % playlist.length)}
          aria-label="Reel tiếp theo"
          className="absolute bottom-2 right-2 w-9 h-9 rounded-full bg-black/55 backdrop-blur-sm flex items-center justify-center text-white/85 hover:bg-black/75 transition-colors"
        >
          <ChevronRight className="w-4 h-4" />
        </button>
      </div>

      <div className="flex items-center gap-1.5">
        {playlist.map((r, i) => (
          <button
            key={r.id}
            onClick={() => setIndex(i)}
            aria-label={`Reel ${r.subject}`}
            className={`h-1.5 rounded-full transition-all ${
              i === index ? 'w-6 bg-white/80' : 'w-1.5 bg-white/25 hover:bg-white/45'
            }`}
          />
        ))}
      </div>

      <p className="text-[11px] text-slate-400 text-center leading-relaxed">
        <span className="text-slate-200">{reel.emoji} {reel.subject}</span> — {reel.headline}
      </p>

      <button
        onClick={() => setOpen(false)}
        className="text-[11px] text-slate-500 hover:text-slate-300 flex items-center gap-1.5 transition-colors"
      >
        <EyeOff className="w-3.5 h-3.5" /> Ẩn reel, nghỉ hẳn
      </button>
    </div>
  );
}
