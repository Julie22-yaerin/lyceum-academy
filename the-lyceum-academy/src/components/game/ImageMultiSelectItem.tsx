import { useState } from 'react';
import { answerItem, gameImageUrl, type ImageMultiselectItem as ImageItemT, type AnswerResult } from '../../lib/gameApi';
import FeedbackPanel from './FeedbackPanel';

export default function ImageMultiSelectItem({
  sessionId, item, index, total, onDone,
}: {
  sessionId: string;
  item: ImageItemT;
  index: number;
  total: number;
  onDone: (delta: number) => void;
}) {
  const [selected, setSelected] = useState<number[]>([]);
  const [result, setResult] = useState<AnswerResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [imgLoaded, setImgLoaded] = useState(false);

  function toggle(i: number) {
    setSelected((prev) => {
      if (prev.includes(i)) return prev.filter((x) => x !== i);
      if (prev.length >= item.max_select) return prev;
      return [...prev, i];
    });
  }

  async function submit(skip: boolean) {
    if (busy) return;
    setBusy(true);
    try {
      const r = await answerItem(sessionId, item.id, skip ? [] : selected, skip);
      setResult(r);
    } finally {
      setBusy(false);
    }
  }

  if (result) {
    const correctList = result.correct_options?.join(', ');
    return (
      <FeedbackPanel
        correct={result.correct} delta={result.delta} taunt={result.taunt}
        explanation={correctList ? `Đáp án đúng: ${correctList}` : undefined}
        onNext={() => onDone(result.delta)}
      />
    );
  }

  return (
    <div className="bg-white rounded-3xl shadow-xl border border-slate-200 p-8">
      <div className="flex items-center justify-between mb-4">
        <span className="text-slate-400 text-xs uppercase tracking-widest">🖼️ Đọc hình · câu {index + 1}/{total}</span>
        <span className="text-slate-400 text-xs uppercase tracking-widest">Chọn đúng {item.max_select}</span>
      </div>

      <div className="relative rounded-2xl overflow-hidden mb-6 bg-slate-50 border border-slate-200 aspect-video flex items-center justify-center">
        {!imgLoaded && (
          <p className="absolute inset-0 flex items-center justify-center text-slate-400 text-sm">Đang vẽ hình… ⏳</p>
        )}
        <img
          src={gameImageUrl(sessionId, item.id)}
          alt="" onLoad={() => setImgLoaded(true)}
          className={`w-full h-full object-contain transition-opacity ${imgLoaded ? 'opacity-100' : 'opacity-0'}`}
        />
      </div>

      <p className="text-slate-600 text-sm mb-3">
        Hình này thể hiện đúng {item.max_select} khái niệm — chọn đúng số đó. 👀
      </p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mb-8">
        {item.options.map((opt, i) => {
          const active = selected.includes(i);
          return (
            <button
              key={i}
              type="button"
              onClick={() => toggle(i)}
              className={`text-left rounded-xl px-4 py-3 text-sm border transition-colors ${
                active ? 'bg-slate-900 text-white border-slate-900' : 'bg-slate-50 text-slate-700 border-slate-200 hover:border-slate-400'
              }`}
            >
              {opt}
            </button>
          );
        })}
      </div>

      <div className="flex items-center justify-between">
        <button type="button" onClick={() => submit(true)} disabled={busy} className="text-slate-400 hover:text-slate-600 text-sm transition-colors">
          Bỏ qua 🏃
        </button>
        <button
          type="button" disabled={selected.length !== item.max_select || busy} onClick={() => submit(false)}
          className="bg-slate-900 text-white rounded-full px-8 py-2.5 text-sm font-semibold disabled:opacity-30 disabled:cursor-not-allowed hover:bg-slate-800 transition-colors"
        >
          Trả lời
        </button>
      </div>
    </div>
  );
}
