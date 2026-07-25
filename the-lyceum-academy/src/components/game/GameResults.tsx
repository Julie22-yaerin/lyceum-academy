import { useEffect, useState } from 'react';
import type { FinishResult } from '../../lib/gameApi';

const REDIRECT_SECONDS = 12;

const TIER_EMOJI: Record<string, string> = {
  'NPC Tier': '💀',
  'Casual Tier': '🤷',
  'Contender Tier': '🙂',
  'Sharp Tier': '🔥',
  'Lyceum Material': '👑',
};

export default function GameResults({ result, playerName }: { result: FinishResult; playerName: string }) {
  const [countdown, setCountdown] = useState(REDIRECT_SECONDS);

  useEffect(() => {
    const id = setInterval(() => setCountdown((c) => c - 1), 1000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    if (countdown <= 0) window.location.href = '/';
  }, [countdown]);

  const tierEmoji = TIER_EMOJI[result.tier.label] || '📊';

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-50 to-slate-100 flex items-center justify-center px-6 py-16">
      <div className="w-full max-w-lg bg-white rounded-3xl shadow-xl border border-slate-200 p-8 text-center">
        <p className="text-slate-400 text-xs uppercase tracking-widest mb-2">Kết quả 🎯</p>
        <p className="font-instrument text-6xl text-slate-900 mb-2">{result.score}</p>
        <p className="text-slate-400 text-xs uppercase tracking-widest mb-6">điểm · hạng #{result.rank} 🏆</p>

        <div className="rounded-2xl bg-slate-50 border border-slate-200 p-6 mb-8">
          <p className="text-slate-900 text-sm uppercase tracking-widest mb-2">{tierEmoji} {result.tier.label}</p>
          <p className="text-slate-600 text-sm leading-relaxed">{result.tier.copy}</p>
        </div>

        <p className="text-slate-400 text-xs uppercase tracking-widest mb-3 text-left">Bảng xếp hạng 📋</p>
        <div className="flex flex-col gap-1.5 mb-8 text-left">
          {result.leaderboard.map((e, i) => {
            const isMe = e.player_name === playerName && e.score === result.score;
            return (
              <div
                key={i}
                className={`flex items-center justify-between rounded-xl px-4 py-2 text-sm ${
                  isMe ? 'bg-slate-900 text-white' : 'bg-slate-50 text-slate-600'
                }`}
              >
                <span className="flex items-center gap-3">
                  <span className="w-5 text-right font-mono opacity-60">
                    {i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : i + 1}
                  </span>
                  <span className="font-medium">{e.player_name}</span>
                </span>
                <span className="font-mono">{e.score}</span>
              </div>
            );
          })}
        </div>

        <a
          href="/"
          className="block w-full bg-slate-900 text-white rounded-full py-3.5 text-sm font-semibold hover:bg-slate-800 transition-colors"
        >
          Về The Lyceum 🏛️ ({countdown}s)
        </a>
      </div>
    </div>
  );
}
