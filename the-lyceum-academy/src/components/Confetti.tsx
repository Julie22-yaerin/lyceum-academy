import { useMemo } from 'react';

const COLORS = ['#fbbf24', '#34d399', '#60a5fa', '#f472b6', '#a78bfa', '#f87171'];

interface Piece {
  id: number;
  left: number;
  delay: number;
  duration: number;
  rotate: number;
  color: string;
  width: number;
  height: number;
  drift: number;
}

/** One-shot paper-streamer burst — mount to play, unmount (parent-controlled) when done. */
export default function Confetti({ pieceCount = 70 }: { pieceCount?: number }) {
  const pieces = useMemo<Piece[]>(() => Array.from({ length: pieceCount }, (_, i) => ({
    id: i,
    left: Math.random() * 100,
    delay: Math.random() * 0.25,
    duration: 1.3 + Math.random() * 0.9,
    rotate: 180 + Math.random() * 540,
    color: COLORS[i % COLORS.length],
    width: 6 + Math.random() * 5,
    height: 10 + Math.random() * 8,
    drift: (Math.random() - 0.5) * 160,
  })), [pieceCount]);

  return (
    <div className="fixed inset-0 z-[300] pointer-events-none overflow-hidden">
      {pieces.map(p => (
        <span
          key={p.id}
          style={{
            position: 'absolute',
            top: '-8%',
            left: `${p.left}%`,
            width: p.width,
            height: p.height,
            backgroundColor: p.color,
            borderRadius: 1,
            opacity: 0.9,
            animation: `lyceum-confetti-fall ${p.duration}s cubic-bezier(0.25,0.46,0.45,0.94) ${p.delay}s forwards`,
            ['--lyceum-confetti-drift' as any]: `${p.drift}px`,
            ['--lyceum-confetti-rotate' as any]: `${p.rotate}deg`,
          }}
        />
      ))}
      <style>{`
        @keyframes lyceum-confetti-fall {
          0%   { transform: translate(0, 0) rotate(0deg); opacity: 1; }
          100% { transform: translate(var(--lyceum-confetti-drift), 115vh) rotate(var(--lyceum-confetti-rotate)); opacity: 0; }
        }
      `}</style>
    </div>
  );
}
