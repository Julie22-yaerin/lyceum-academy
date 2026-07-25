import { useEffect, useState } from 'react';
import type { FinishResult } from '../../lib/gameApi';

const REDIRECT_SECONDS = 12;

export default function GameResults({ result, playerName }: { result: FinishResult; playerName: string }) {
  const [countdown, setCountdown] = useState(REDIRECT_SECONDS);

  useEffect(() => {
    const id = setInterval(() => setCountdown((c) => c - 1), 1000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    if (countdown <= 0) window.location.href = '/';
  }, [countdown]);

  return (
    <div className="min-h-screen bg-black flex items-center justify-center px-6 py-16">
      <div className="w-full max-w-lg liquid-glass rounded-3xl p-8 text-center">
        <p className="text-white/40 text-xs uppercase tracking-widest mb-2">Kết quả</p>
        <p className="font-instrument text-6xl text-white mb-2">{result.score}</p>
        <p className="text-white/50 text-xs uppercase tracking-widest mb-6">điểm · hạng #{result.rank}</p>

        <div className="rounded-2xl bg-white/5 border border-white/10 p-6 mb-8">
          <p className="text-white text-sm uppercase tracking-widest mb-2">{result.tier.label}</p>
          <p className="text-white/70 text-sm leading-relaxed">{result.tier.copy}</p>
        </div>

        <p className="text-white/40 text-xs uppercase tracking-widest mb-3 text-left">Bảng xếp hạng</p>
        <div className="flex flex-col gap-1.5 mb-8 text-left">
          {result.leaderboard.map((e, i) => {
            const isMe = e.player_name === playerName && e.score === result.score;
            return (
              <div
                key={i}
                className={`flex items-center justify-between rounded-xl px-4 py-2 text-sm ${
                  isMe ? 'bg-white text-black' : 'bg-white/5 text-white/70'
                }`}
              >
                <span className="flex items-center gap-3">
                  <span className="w-5 text-right font-mono opacity-60">{i + 1}</span>
                  <span className="font-medium">{e.player_name}</span>
                </span>
                <span className="font-mono">{e.score}</span>
              </div>
            );
          })}
        </div>

        <a
          href="/"
          className="block w-full bg-white text-black rounded-full py-3.5 text-sm font-semibold hover:bg-white/90 transition-colors"
        >
          Về The Lyceum ({countdown}s)
        </a>
      </div>
    </div>
  );
}
