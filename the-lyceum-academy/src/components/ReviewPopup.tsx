/**
 * ReviewPopup — step 7 of the house topic pipeline (see backend
 * user_brain.LYCEUM_PIPELINE_PROMPT): the 3-7-21-30 spaced-repetition prompt.
 * Polls the review queue (lib/reviewReminders) and, when a checkpoint comes
 * due, surfaces a modal that makes the student re-anchor an old topic — first
 * re-explain the core idea in their own words, then a compact AI summary plus
 * 2-3 short retention questions. Per the pipeline this stays at medium and is
 * deliberately NOT escalated to hard: it is retention, not interrogation.
 * Clearing it retires that checkpoint; dismissing snoozes it a day.
 */
import { useEffect, useState } from 'react';
import { nextDueReview, clearCheckpoint, snoozeCheckpoint, type ReviewItem } from '../lib/reviewReminders';
import { getSortedMistakes } from '../lib/mistakes';
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
  // Pipeline step 7 opens with the student re-explaining the topic from
  // memory. The recap and questions stay hidden until they have — reading the
  // summary first would hand them the answer and kill the retrieval practice.
  const [recall, setRecall] = useState('');
  const [recallDone, setRecallDone] = useState(false);

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

    // Prefer mistakes actually tied to this topic (matched by concept);
    // fall back to the subject's most recent ones if none match exactly —
    // still real mistakes from this subject, just not concept-tagged.
    const subjectMistakes = getSortedMistakes(item.subject);
    const topicMistakes = subjectMistakes.filter(m => m.concept === item.topic);
    const pastMistakes = (topicMistakes.length ? topicMistakes : subjectMistakes).slice(0, 2);
    const mistakeBlock = pastMistakes.length
      ? pastMistakes.map((m, i) => `${i + 1}. Sai lầm cũ: "${m.mistake}" (ở: ${m.location}). Đúng ra: ${m.explanation}`).join('\n')
      : '(chưa có sai lầm nào ghi nhận cho chủ đề này)';

    // Pipeline step 7: reuse what actually tripped them up on this topic —
    // real retrieval practice, not a generic recap — plus 1-2 fresh
    // realistic questions so it isn't pure rote replay of the same items.
    const nNew = due.stage <= 7 ? 1 : 2;
    const sys =
      'You build spaced-repetition review packs. Return ONLY JSON, no fences: ' +
      '{"summary":"<=120-word crisp recap of the material>","questions":' +
      '[{"q":"<short question>","a":"<concise answer>","level":"medium"}]}. ' +
      `You are given the student's OWN past mistakes on this exact topic. Turn each one into a ` +
      'question that makes them redo the same misstep and catch it themselves — reuse the same ' +
      'wording/setup that tripped them up the first time, not a paraphrase that hides the trap. ' +
      `Then add ${nNew} new question(s) at "medium": a realistic, applied scenario for this topic ` +
      'they have not seen phrased this way before — not another instance of the same mistake. ' +
      'All questions "medium". This is retention practice, not an exam. Keep each answerable in ' +
      "a sentence. Mirror the material's language.";
    chatMessage([
      { role: 'system', content: sys },
      { role: 'user', content: `Topic: ${item.topic}\nSubject: ${item.subject}\n\nMaterial:\n${item.summarySeed}\n\nCác sai lầm cũ của học sinh về chủ đề này:\n${mistakeBlock}` },
    ])
      .then(({ reply }) => {
        setPack(parsePack(reply) || {
          summary: item.summarySeed.slice(0, 400),
          questions: [{ q: `Nhắc lại ý chính của "${item.topic}"?`, a: '', level: 'medium' }],
        });
      })
      .catch(() => setPack({
        summary: item.summarySeed.slice(0, 400),
        questions: [{ q: `Nhắc lại ý chính của "${item.topic}"?`, a: '', level: 'medium' }],
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
    setRecall(''); setRecallDone(false);
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

        {/* The pack loads in the background while they recall, so this only
            shows if they finished recalling before it arrived. */}
        {loading && recallDone && (
          <p className="text-sm text-white/50 animate-pulse py-6 text-center">Đang chuẩn bị bài ôn…</p>
        )}

        {/* Recall first — from memory, before anything is shown. */}
        {!recallDone && (
          <>
            <div className="rounded-2xl bg-white/5 p-4 flex flex-col gap-2">
              <p className="text-[10px] uppercase tracking-[2px] text-white/40">Nhắc lại từ đầu · chưa xem tóm tắt</p>
              <p className="text-sm text-white/80 leading-relaxed">
                Giải thích ngắn ý cốt lõi của <span className="text-white">{due.item.topic}</span> bằng lời của bạn.
              </p>
              <textarea
                value={recall} onChange={e => setRecall(e.target.value)} rows={4}
                placeholder="Viết những gì bạn còn nhớ — không cần hoàn hảo…"
                className="w-full bg-white/5 rounded-xl px-3 py-2.5 text-sm text-white/90 outline-none border border-white/10 focus:border-white/25 resize-y"
              />
            </div>
            <div className="flex gap-2 pt-1">
              <button onClick={later}
                className="flex-1 rounded-xl px-4 py-2.5 text-[11px] uppercase tracking-[2px] bg-white/10 text-white/60 hover:bg-white/20 transition-colors">
                Để mai
              </button>
              <button onClick={() => setRecallDone(true)} disabled={recall.trim().length < 20}
                className="flex-1 rounded-xl px-4 py-2.5 text-[11px] uppercase tracking-[2px] bg-purple-400/15 text-purple-200 hover:bg-purple-400/25 disabled:opacity-30 disabled:cursor-not-allowed transition-colors">
                Xong · xem lại
              </button>
            </div>
          </>
        )}

        {pack && !loading && recallDone && (
          <>
            <div className="rounded-2xl bg-white/5 p-4">
              <p className="text-[10px] uppercase tracking-[2px] text-white/40 mb-1">Tóm tắt nhanh</p>
              <p className="text-sm text-white/80 leading-relaxed whitespace-pre-wrap">{pack.summary}</p>
            </div>

            <div className="rounded-2xl bg-white/[0.03] p-4">
              <p className="text-[10px] uppercase tracking-[2px] text-white/40 mb-1">Bạn đã nhắc lại</p>
              <p className="text-xs text-white/60 leading-relaxed whitespace-pre-wrap">{recall.trim()}</p>
              <p className="text-[10px] text-white/35 mt-2">So với tóm tắt trên — chỗ nào bạn bỏ sót?</p>
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
