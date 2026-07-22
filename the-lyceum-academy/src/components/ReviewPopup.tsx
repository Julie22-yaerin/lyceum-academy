/**
 * ReviewPopup — the 3-7-21 spaced-repetition prompt. Polls the review queue
 * (lib/reviewReminders) and, when a checkpoint comes due, surfaces a modal
 * that makes the student re-anchor an old topic: a compact AI summary plus
 * 1-3 short questions graded easy → medium → hard. Clearing them retires that
 * checkpoint; dismissing snoozes it a day.
 */
import { useEffect, useState } from 'react';
import { nextDueReview, clearCheckpoint, snoozeCheckpoint, type ReviewItem } from '../lib/reviewReminders';
import { chatMessage } from '../lib/api';

interface ReviewPack { summary: string; questions: { q: string; a: string; level: 'easy' | 'medium' | 'hard' }[]; }

function parsePack(raw: string): ReviewPack | null {
  try {
    let s = raw.trim();
    if (s.startsWith('```')) s = s.replace(/^```[a-z]*/i, '').replace(/```$/, '').trim();
    const start = s.indexOf('{'), end = s.lastIndexOf('}');
    if (start === -1 || end <= start) return null;
    const parsed = JSON.parse(s.slice(start, end + 1));
    if (!parsed.questions?.length) return null;
    return parsed;
  } catch { return null; }
}

export default function ReviewPopup() {
  const [due, setDue] = useState<ReturnType<typeof nextDueReview>>(null);
  const [pack, setPack] = useState<ReviewPack | null>(null);
  const [loading, setLoading] = useState(false);
  const [revealed, setRevealed] = useState<Set<number>>(new Set());
  const [dismissed, setDismissed] = useState(false);

  // Poll every 60s (and once shortly after mount) for a due checkpoint.
  useEffect(() => {
    if (dismissed) return;
    function check() { if (!due) setDue(nextDueReview()); }
    const t = setTimeout(check, 4000);
    const id = setInterval(check, 60000);
    return () => { clearTimeout(t); clearInterval(id); };
  }, [due, dismissed]);

  // When a checkpoint appears, ask the AI for the recap + questions.
  useEffect(() => {
    if (!due || pack || loading) return;
    const item: ReviewItem = due.item;
    setLoading(true);
    const nQ = due.stage === 3 ? 1 : due.stage === 7 ? 2 : 3;
    const sys =
      'You build spaced-repetition review packs. Return ONLY JSON, no fences: ' +
      '{"summary":"<=120-word crisp recap of the material>","questions":' +
      '[{"q":"<short question>","a":"<concise answer>","level":"easy|medium|hard"}]}. ' +
      `Produce exactly ${nQ} question(s)` +
      (nQ === 1 ? ' at "easy".' : nQ === 2 ? ', graded easy then medium.' : ', graded easy, medium, hard.') +
      ' Keep questions answerable in a sentence. Mirror the material\'s language.';
    chatMessage([
      { role: 'system', content: sys },
      { role: 'user', content: `Topic: ${item.topic}\nSubject: ${item.subject}\n\nMaterial:\n${item.summarySeed}` },
    ])
      .then(({ reply }) => {
        setPack(parsePack(reply) || {
          summary: item.summarySeed.slice(0, 400),
          questions: [{ q: `Nhắc lại ý chính của "${item.topic}"?`, a: '', level: 'easy' }],
        });
      })
      .catch(() => setPack({
        summary: item.summarySeed.slice(0, 400),
        questions: [{ q: `Nhắc lại ý chính của "${item.topic}"?`, a: '', level: 'easy' }],
      }))
      .finally(() => setLoading(false));
  }, [due, pack, loading]);

  if (!due) return null;

  function finish() {
    if (due) clearCheckpoint(due.item.id, due.checkpointIndex);
    reset();
  }
  function later() {
    if (due) snoozeCheckpoint(due.item.id, due.checkpointIndex);
    setDismissed(true);
    reset();
  }
  function reset() {
    setDue(null); setPack(null); setRevealed(new Set());
  }

  const levelColor: Record<string, string> = {
    easy: 'text-emerald-300 bg-emerald-400/10',
    medium: 'text-amber-300 bg-amber-400/10',
    hard: 'text-red-300 bg-red-400/10',
  };

  return (
    <div className="fixed inset-0 z-[195] bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="glass-card rounded-3xl max-w-lg w-full max-h-[85vh] overflow-y-auto p-6 flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-[10px] uppercase tracking-[2px] text-purple-300">Ôn tập · sau {due.stage} ngày</p>
            <h2 className="font-serif text-xl text-white">{due.item.topic}</h2>
          </div>
          <span className="text-2xl">🔁</span>
        </div>

        {loading && <p className="text-sm text-white/50 animate-pulse py-6 text-center">Đang chuẩn bị bài ôn…</p>}

        {pack && !loading && (
          <>
            <div className="rounded-2xl bg-white/5 p-4">
              <p className="text-[10px] uppercase tracking-[2px] text-white/40 mb-1">Tóm tắt nhanh</p>
              <p className="text-sm text-white/80 leading-relaxed whitespace-pre-wrap">{pack.summary}</p>
            </div>

            <div className="flex flex-col gap-2">
              {pack.questions.map((q, i) => (
                <div key={i} className="rounded-2xl bg-white/[0.03] p-4">
                  <div className="flex items-center gap-2 mb-1.5">
                    <span className={`text-[9px] uppercase tracking-[2px] rounded-full px-2 py-0.5 ${levelColor[q.level] || levelColor.easy}`}>
                      {q.level}
                    </span>
                  </div>
                  <p className="text-sm text-white/90 mb-2">{q.q}</p>
                  {revealed.has(i) ? (
                    <p className="text-xs text-emerald-200/90 border-t border-white/10 pt-2">{q.a || '(tự chấm — nhớ lại rồi so với ghi chú của bạn)'}</p>
                  ) : (
                    <button onClick={() => setRevealed(s => new Set(s).add(i))}
                      className="text-[11px] text-purple-300 hover:text-purple-200 transition-colors">
                      Hiện đáp án
                    </button>
                  )}
                </div>
              ))}
            </div>

            <div className="flex gap-2 pt-1">
              <button onClick={later}
                className="flex-1 rounded-xl px-4 py-2.5 text-[11px] uppercase tracking-[2px] bg-white/10 text-white/60 hover:bg-white/20 transition-colors">
                Để mai
              </button>
              <button onClick={finish}
                className="flex-1 rounded-xl px-4 py-2.5 text-[11px] uppercase tracking-[2px] bg-emerald-400/15 text-emerald-200 hover:bg-emerald-400/25 transition-colors">
                Đã ôn xong
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
