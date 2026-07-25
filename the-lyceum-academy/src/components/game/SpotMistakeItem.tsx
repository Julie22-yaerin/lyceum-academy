import { useState } from 'react';
import { answerItem, type SpotMistakeItem as SpotMistakeItemT, type AnswerResult } from '../../lib/gameApi';
import FeedbackPanel from './FeedbackPanel';

export default function SpotMistakeItem({
  sessionId, item, index, total, onDone,
}: {
  sessionId: string;
  item: SpotMistakeItemT;
  index: number;
  total: number;
  onDone: (delta: number) => void;
}) {
  const [selected, setSelected] = useState<number | null>(null);
  const [result, setResult] = useState<AnswerResult | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(skip: boolean) {
    if (busy) return;
    setBusy(true);
    try {
      const r = await answerItem(sessionId, item.id, skip || selected === null ? [] : [selected], skip);
      setResult(r);
    } finally {
      setBusy(false);
    }
  }

  if (result) {
    return (
      <FeedbackPanel
        correct={result.correct} delta={result.delta} taunt={result.taunt}
        explanation={result.explanation} onNext={() => onDone(result.delta)}
      />
    );
  }

  return (
    <div className="liquid-glass rounded-3xl p-8">
      <div className="flex items-center justify-between mb-4">
        <span className="text-white/40 text-xs uppercase tracking-widest">
          Soi lỗi sai · câu {index + 1}/{total}
        </span>
        <span className="text-white/40 text-xs uppercase tracking-widest">Độ khó {item.difficulty}/10</span>
      </div>
      <p className="text-white text-lg leading-relaxed mb-4">{item.question}</p>
      <div className="bg-white/5 rounded-2xl p-5 mb-6 border border-white/10">
        <p className="text-white/50 text-xs uppercase tracking-widest mb-2">Bài giải được đưa ra</p>
        <p className="text-white/85 text-sm leading-relaxed whitespace-pre-wrap">{item.shown_answer}</p>
      </div>
      <p className="text-white/60 text-sm mb-3">Chỗ sai thực sự nằm ở đâu?</p>
      <div className="flex flex-col gap-2 mb-8">
        {item.choices.map((c, i) => (
          <button
            key={i}
            type="button"
            onClick={() => setSelected(i)}
            className={`text-left rounded-xl px-4 py-3 text-sm border transition-colors ${
              selected === i ? 'bg-white text-black border-white' : 'bg-white/5 text-white/80 border-white/10 hover:border-white/30'
            }`}
          >
            {c}
          </button>
        ))}
      </div>
      <div className="flex items-center justify-between">
        <button type="button" onClick={() => submit(true)} disabled={busy} className="text-white/40 hover:text-white/70 text-sm transition-colors">
          Bỏ qua
        </button>
        <button
          type="button" disabled={selected === null || busy} onClick={() => submit(false)}
          className="bg-white text-black rounded-full px-8 py-2.5 text-sm font-semibold disabled:opacity-30 disabled:cursor-not-allowed hover:bg-white/90 transition-colors"
        >
          Trả lời
        </button>
      </div>
    </div>
  );
}
