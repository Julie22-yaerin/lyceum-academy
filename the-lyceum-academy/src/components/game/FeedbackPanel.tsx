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
    <div className="liquid-glass rounded-3xl p-8 text-center">
      <p className={`text-xs uppercase tracking-widest mb-3 ${correct ? 'text-emerald-300' : 'text-red-300'}`}>
        {correct ? 'Correct' : 'Wrong'} · {delta >= 0 ? '+' : ''}{delta} điểm
      </p>
      <p className="text-white text-lg leading-relaxed mb-4">{taunt}</p>
      {explanation && (
        <p className="text-white/50 text-sm leading-relaxed mb-6 border-t border-white/10 pt-4">{explanation}</p>
      )}
      <button
        type="button"
        onClick={onNext}
        className="mt-2 bg-white text-black rounded-full px-8 py-3 text-sm font-semibold hover:bg-white/90 transition-colors"
      >
        Tiếp tục
      </button>
    </div>
  );
}
