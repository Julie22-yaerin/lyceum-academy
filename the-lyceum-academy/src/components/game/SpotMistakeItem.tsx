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
    <div className="bg-white rounded-3xl shadow-xl border border-slate-200 p-8">
      <div className="flex items-center justify-between mb-4">
        <span className="text-slate-400 text-xs uppercase tracking-widest">
          🔍 Soi lỗi sai · câu {index + 1}/{total}
        </span>
        <span className="text-slate-400 text-xs uppercase tracking-widest">Độ khó {item.difficulty}/10</span>
      </div>
      <p className="text-slate-900 text-lg leading-relaxed mb-4">{item.question}</p>
      <div className="bg-slate-50 rounded-2xl p-5 mb-6 border border-slate-200">
        <p className="text-slate-400 text-xs uppercase tracking-widest mb-2">Bài giải được đưa ra</p>
        <p className="text-slate-800 text-sm leading-relaxed whitespace-pre-wrap">{item.shown_answer}</p>
      </div>
      <p className="text-slate-600 text-sm mb-3">Chỗ sai thực sự nằm ở đâu? 🤔</p>
      <div className="flex flex-col gap-2 mb-8">
        {item.choices.map((c, i) => (
          <button
            key={i}
            type="button"
            onClick={() => setSelected(i)}
            className={`text-left rounded-xl px-4 py-3 text-sm border transition-colors ${
              selected === i ? 'bg-slate-900 text-white border-slate-900' : 'bg-slate-50 text-slate-700 border-slate-200 hover:border-slate-400'
            }`}
          >
            {c}
          </button>
        ))}
      </div>
      <div className="flex items-center justify-between">
        <button type="button" onClick={() => submit(true)} disabled={busy} className="text-slate-400 hover:text-slate-600 text-sm transition-colors">
          Bỏ qua 🏃
        </button>
        <button
          type="button" disabled={selected === null || busy} onClick={() => submit(false)}
          className="bg-slate-900 text-white rounded-full px-8 py-2.5 text-sm font-semibold disabled:opacity-30 disabled:cursor-not-allowed hover:bg-slate-800 transition-colors"
        >
          Trả lời
        </button>
      </div>
    </div>
  );
}
