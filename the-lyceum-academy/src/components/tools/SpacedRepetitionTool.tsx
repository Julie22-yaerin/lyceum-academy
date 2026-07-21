/**
 * SpacedRepetitionTool — flashcard review queue built from the Mistake
 * Bank and saved Notes' key concepts (see lib/spacedRepetition.ts).
 */
import { useState } from 'react';
import { loadDueCards, reviewCard, deckStats, type SrsCard } from '../../lib/spacedRepetition';

export default function SpacedRepetitionTool() {
  const [queue, setQueue] = useState<SrsCard[]>(() => loadDueCards());
  const [flipped, setFlipped] = useState(false);
  const [stats, setStats] = useState(() => deckStats());

  const current = queue[0];

  function handleReview(correct: boolean) {
    if (!current) return;
    reviewCard(current.id, correct);
    setQueue(q => q.slice(1));
    setFlipped(false);
    setStats(deckStats());
  }

  if (!current) {
    return (
      <div className="p-6 text-center">
        <span className="text-3xl block mb-3">✦</span>
        <p className="text-sm text-white/70 mb-1">All caught up.</p>
        <p className="text-xs text-white/40">{stats.total} cards total · none due right now.</p>
      </div>
    );
  }

  return (
    <div className="p-2 flex flex-col gap-4">
      <p className="text-[10px] uppercase tracking-[2px] text-white/40">
        {queue.length} due · {current.source === 'mistake' ? '🩹 from Mistake Bank' : '🧠 from Notes'} · {current.subject}
      </p>

      <button
        onClick={() => setFlipped(v => !v)}
        className="glass-pill rounded-2xl px-5 py-8 text-center min-h-[140px] flex items-center justify-center"
      >
        <p className="text-base text-white/90 leading-relaxed">{flipped ? current.back : current.front}</p>
      </button>
      <p className="text-[10px] text-white/30 text-center -mt-2">{flipped ? 'Answer' : 'Tap to reveal'}</p>

      {flipped && (
        <div className="flex gap-2">
          <button onClick={() => handleReview(false)}
            className="flex-1 rounded-xl px-4 py-2.5 text-[10px] uppercase tracking-[2px] bg-red-400/10 text-red-300 hover:bg-red-400/20 transition-colors">
            Forgot
          </button>
          <button onClick={() => handleReview(true)}
            className="flex-1 rounded-xl px-4 py-2.5 text-[10px] uppercase tracking-[2px] bg-emerald-400/10 text-emerald-300 hover:bg-emerald-400/20 transition-colors">
            Got it
          </button>
        </div>
      )}
    </div>
  );
}
