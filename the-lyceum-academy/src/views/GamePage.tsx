/**
 * thelyceum.site/game — public, no-login marketing quiz. Standalone route
 * (see App.tsx path-based routing), no auth/Quanta/workspace involved.
 * See backend/app/services/game.py for the full design notes.
 */
import { useState } from 'react';
import {
  startGame, finishGame, type Subject, type GameItem, type FinishResult,
} from '../lib/gameApi';
import GameIntro from '../components/game/GameIntro';
import SpotMistakeItem from '../components/game/SpotMistakeItem';
import ConceptExplainItem from '../components/game/ConceptExplainItem';
import ImageMultiSelectItem from '../components/game/ImageMultiSelectItem';
import GameResults from '../components/game/GameResults';

type Phase = 'intro' | 'playing' | 'finishing' | 'results';

export default function GamePage() {
  const [phase, setPhase] = useState<Phase>('intro');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const [sessionId, setSessionId] = useState('');
  const [items, setItems] = useState<GameItem[]>([]);
  const [playerName, setPlayerName] = useState('');
  const [currentIndex, setCurrentIndex] = useState(0);
  const [score, setScore] = useState(0);
  const [finishResult, setFinishResult] = useState<FinishResult | null>(null);

  async function handleStart(subject: Subject, curriculum: string, name: string) {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      const res = await startGame(subject, curriculum, name);
      setSessionId(res.session_id);
      setItems(res.items);
      setPlayerName(name);
      setCurrentIndex(0);
      setScore(0);
      setPhase('playing');
    } catch {
      setError('Không dựng được đề lúc này — thử lại sau vài giây.');
    } finally {
      setBusy(false);
    }
  }

  async function finishUp(finalSessionId: string) {
    setPhase('finishing');
    try {
      const res = await finishGame(finalSessionId);
      setFinishResult(res);
      setPhase('results');
    } catch {
      setPhase('results');
      setFinishResult({
        score, tier: { label: 'Unknown', copy: 'Không lấy được kết quả từ máy chủ — nhưng bạn đã chơi xong.' },
        rank: 0, leaderboard: [],
      });
    }
  }

  function handleItemDone(delta: number) {
    const newScore = score + delta;
    setScore(newScore);
    if (currentIndex + 1 >= items.length) {
      finishUp(sessionId);
    } else {
      setCurrentIndex((i) => i + 1);
    }
  }

  if (phase === 'intro') {
    return <GameIntro onStart={handleStart} busy={busy} error={error} />;
  }

  if (phase === 'finishing') {
    return (
      <div className="min-h-screen bg-black flex items-center justify-center">
        <p className="text-white/50 text-sm">Đang chấm điểm…</p>
      </div>
    );
  }

  if (phase === 'results' && finishResult) {
    return <GameResults result={finishResult} playerName={playerName} />;
  }

  const item = items[currentIndex];
  if (!item) return null;

  return (
    <div className="min-h-screen bg-black px-6 py-10">
      <div className="max-w-2xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <div className="flex-1 h-1.5 bg-white/10 rounded-full overflow-hidden mr-4">
            <div
              className="h-full bg-white transition-all duration-300"
              style={{ width: `${((currentIndex) / items.length) * 100}%` }}
            />
          </div>
          <span className="text-white/60 text-sm font-mono shrink-0">{score >= 0 ? '+' : ''}{score} điểm</span>
        </div>

        {item.type === 'spot_mistake' && (
          <SpotMistakeItem sessionId={sessionId} item={item} index={currentIndex} total={items.length} onDone={handleItemDone} />
        )}
        {item.type === 'concept_explain' && (
          <ConceptExplainItem sessionId={sessionId} item={item} index={currentIndex} total={items.length} onDone={handleItemDone} />
        )}
        {item.type === 'image_multiselect' && (
          <ImageMultiSelectItem sessionId={sessionId} item={item} index={currentIndex} total={items.length} onDone={handleItemDone} />
        )}
      </div>
    </div>
  );
}
