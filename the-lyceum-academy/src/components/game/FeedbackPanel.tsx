export default function FeedbackPanel({
  correct, delta, taunt, explanation, onNext,
}: {
  correct: boolean;
  delta: number;
  taunt: string;
  explanation?: string;
  onNext: () => void;
}) {
  return (
    <div className="bg-white rounded-3xl shadow-xl border border-slate-200 p-8 text-center">
      <p className={`text-xs uppercase tracking-widest mb-3 ${correct ? 'text-emerald-600' : 'text-red-600'}`}>
        {correct ? '✅ Correct' : '❌ Wrong'} · {delta >= 0 ? '+' : ''}{delta} điểm
      </p>
      <p className="text-slate-900 text-lg leading-relaxed mb-4">{taunt}</p>
      {explanation && (
        <p className="text-slate-500 text-sm leading-relaxed mb-6 border-t border-slate-200 pt-4">{explanation}</p>
      )}
      <button
        type="button"
        onClick={onNext}
        className="mt-2 bg-slate-900 text-white rounded-full px-8 py-3 text-sm font-semibold hover:bg-slate-800 transition-colors"
      >
        Tiếp tục ➡️
      </button>
    </div>
  );
}
