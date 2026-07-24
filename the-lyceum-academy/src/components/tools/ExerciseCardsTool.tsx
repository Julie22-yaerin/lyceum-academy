/**
 * ExerciseCardsTool — a practice deck built straight from a chopped-up
 * past paper or a textbook excerpt the student pastes in. House rule:
 * cards are presented medium → hard → easy, never the usual easy-to-hard
 * ramp — the backend pre-sorts them and this view walks through in that
 * fixed order, one card at a time.
 *
 * Exactly three assists exist on a card, and only these three:
 *   - Reverse Building — 20 Quanta (reveal the worked solution, then
 *     rebuild the reasoning from scratch and get it graded)
 *   - Image Generator  — 150 Quanta (a diagram of THIS problem's concrete
 *     scenario, not the theory behind it)
 *   - Lotus Map        — free (opens the Lotus Map tool seeded with the
 *     problem, for mapping it out symmetrically)
 */
import { useState } from 'react';
import { useToolDock } from '../../context/ToolDockContext';
import {
  generateExerciseCards, revealCardSolution, evaluateCardReverseBuild, generateProblemImage,
  type ExerciseCard,
} from '../../lib/lyceumApi';

const DIFFICULTY_COLOR: Record<string, string> = {
  medium: 'text-amber-300 bg-amber-400/10',
  hard: 'text-red-300 bg-red-400/10',
  easy: 'text-emerald-300 bg-emerald-400/10',
};

export default function ExerciseCardsTool() {
  const { openTool } = useToolDock();
  const [sourceText, setSourceText] = useState('');
  const [maxCards, setMaxCards] = useState(6);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [cards, setCards] = useState<ExerciseCard[] | null>(null);
  const [idx, setIdx] = useState(0);

  // Reverse Building state
  const [rb, setRb] = useState<{ solution: string; tools: string[]; explanation: string; verdict?: string; feedback?: string; busy: boolean } | null>(null);
  // Image Generator state
  const [imgBusy, setImgBusy] = useState(false);
  const [imgB64, setImgB64] = useState<string | null>(null);
  const [imgError, setImgError] = useState('');

  async function handleGenerate() {
    if (!sourceText.trim() || busy) return;
    setBusy(true); setError('');
    try {
      const result = await generateExerciseCards(sourceText.trim(), maxCards);
      setCards(result.cards);
      setIdx(0);
    } catch (e: any) {
      setError(e?.message || 'Could not build cards from this material — please try again.');
    } finally {
      setBusy(false);
    }
  }

  function resetAssists() {
    setRb(null); setImgB64(null); setImgError('');
  }

  function nextCard() {
    if (!cards) return;
    resetAssists();
    setIdx(i => Math.min(i + 1, cards.length - 1));
  }
  function prevCard() {
    resetAssists();
    setIdx(i => Math.max(i - 1, 0));
  }

  const current = cards?.[idx];

  async function startReverseBuild() {
    if (!current || rb?.busy) return;
    setRb({ solution: '', tools: [], explanation: '', busy: true });
    try {
      const { solution, required_tools } = await revealCardSolution(current.question, current.concepts, current.subject);
      setRb({ solution, tools: required_tools, explanation: '', busy: false });
    } catch (e: any) {
      setRb({ solution: e?.message || 'Could not reveal the solution.', tools: [], explanation: '', busy: false });
    }
  }

  async function submitReverseBuild() {
    if (!current || !rb || !rb.explanation.trim() || rb.busy) return;
    setRb({ ...rb, busy: true });
    try {
      const ev = await evaluateCardReverseBuild(rb.explanation, current.question, rb.tools, current.subject || 'math');
      setRb({ ...rb, busy: false, verdict: ev.verdict, feedback: ev.feedback });
    } catch (e: any) {
      setRb({ ...rb, busy: false, feedback: e?.message || 'Could not evaluate — please try again.' });
    }
  }

  async function generateImage() {
    if (!current || imgBusy) return;
    setImgBusy(true); setImgError(''); setImgB64(null);
    try {
      const r = await generateProblemImage(current.question);
      setImgB64(r.image_base64);
    } catch (e: any) {
      setImgError(e?.message || 'Image generation failed.');
    } finally {
      setImgBusy(false);
    }
  }

  function openLotusMap() {
    if (!current) return;
    openTool('lotus-map', { seedTopic: current.question });
  }

  if (!cards) {
    return (
      <div className="p-4 flex flex-col gap-3">
        <p className="text-[11px] text-white/50 leading-relaxed">
          Paste a chopped-up past paper or a textbook excerpt. Real questions are pulled out and tagged by
          difficulty — presented medium → hard → easy, not the usual ramp.
        </p>
        <textarea
          value={sourceText} onChange={e => setSourceText(e.target.value)} rows={9}
          placeholder="Paste source material here…"
          className="w-full bg-white/5 rounded-xl px-3 py-2.5 text-sm text-white/85 outline-none border border-white/10 focus:border-white/25 resize-y"
        />
        <div className="flex items-center gap-3">
          <label className="text-[11px] text-white/50">Max cards</label>
          <input type="range" min={1} max={10} value={maxCards} onChange={e => setMaxCards(Number(e.target.value))} className="flex-1 accent-purple-400" />
          <span className="text-xs text-white/70 w-4 text-center">{maxCards}</span>
        </div>
        <button onClick={handleGenerate} disabled={!sourceText.trim() || busy}
          className="self-end rounded-xl px-5 py-2.5 text-[11px] uppercase tracking-[2px] bg-purple-400/15 text-purple-200 hover:bg-purple-400/25 disabled:opacity-40 transition-colors">
          {busy ? 'Building deck…' : 'Build cards'}
        </button>
        {error && <p className="text-xs text-red-300/80">{error}</p>}
      </div>
    );
  }

  if (!current) return null;

  return (
    <div className="p-4 flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <p className="text-[11px] uppercase tracking-[2px] text-white/40">Card {idx + 1} / {cards.length}</p>
        <button onClick={() => { setCards(null); resetAssists(); }} className="text-[11px] text-white/50 hover:text-white/80 transition-colors">
          ← New deck
        </button>
      </div>

      <div className="rounded-2xl bg-white/[0.03] p-4 flex flex-col gap-2">
        <span className={`self-start text-[9px] uppercase tracking-[2px] rounded-full px-2 py-0.5 ${DIFFICULTY_COLOR[current.difficulty]}`}>
          {current.difficulty}
        </span>
        <p className="text-sm text-white/90 leading-relaxed">{current.question}</p>
        {current.concepts?.length > 0 && (
          <p className="text-[10px] text-white/30">{current.subject}{current.subject ? ' · ' : ''}{current.concepts.join(', ')}</p>
        )}
      </div>

      {/* Exactly 3 assists — the only ones allowed on this deck */}
      <div className="flex gap-2">
        <button onClick={startReverseBuild} disabled={!!rb}
          className="flex-1 rounded-xl px-3 py-2 text-[10px] uppercase tracking-[1.5px] bg-blue-400/10 text-blue-200 hover:bg-blue-400/20 disabled:opacity-40 transition-colors">
          Reverse Building · 20⚡
        </button>
        <button onClick={generateImage} disabled={imgBusy}
          className="flex-1 rounded-xl px-3 py-2 text-[10px] uppercase tracking-[1.5px] bg-emerald-400/10 text-emerald-200 hover:bg-emerald-400/20 disabled:opacity-40 transition-colors">
          {imgBusy ? 'Drawing…' : 'Image Generator · 150⚡'}
        </button>
        <button onClick={openLotusMap}
          className="flex-1 rounded-xl px-3 py-2 text-[10px] uppercase tracking-[1.5px] bg-white/10 text-white/60 hover:bg-white/20 transition-colors">
          Lotus Map · free
        </button>
      </div>

      {rb && (
        <div className="rounded-2xl bg-blue-400/5 p-4 flex flex-col gap-2 border border-blue-400/10">
          {rb.busy && !rb.solution && <p className="text-xs text-white/50 animate-pulse">Revealing solution…</p>}
          {rb.solution && (
            <>
              <p className="text-[10px] uppercase tracking-[2px] text-blue-300/70">Worked solution</p>
              <p className="text-xs text-white/80 whitespace-pre-wrap leading-relaxed">{rb.solution}</p>
              {rb.tools.length > 0 && (
                <p className="text-[10px] text-white/40">Required tools: {rb.tools.join(', ')}</p>
              )}
              {!rb.verdict && (
                <>
                  <textarea
                    value={rb.explanation} onChange={e => setRb({ ...rb, explanation: e.target.value })}
                    rows={4} placeholder="Now rebuild the reasoning yourself, from scratch…"
                    disabled={rb.busy}
                    className="w-full bg-white/5 rounded-xl px-3 py-2 text-xs text-white/85 outline-none border border-white/10 focus:border-white/25 resize-y"
                  />
                  <button onClick={submitReverseBuild} disabled={!rb.explanation.trim() || rb.busy}
                    className="self-end rounded-lg px-4 py-1.5 text-[10px] uppercase tracking-[2px] bg-blue-400/15 text-blue-200 hover:bg-blue-400/25 disabled:opacity-40 transition-colors">
                    {rb.busy ? 'Grading…' : 'Submit rebuild'}
                  </button>
                </>
              )}
              {rb.verdict && (
                <div className={`rounded-lg px-3 py-2 text-xs ${rb.verdict === 'pass' ? 'bg-emerald-400/10 text-emerald-200' : rb.verdict === 'partial' ? 'bg-amber-400/10 text-amber-200' : 'bg-red-400/10 text-red-200'}`}>
                  <p className="uppercase tracking-[2px] text-[9px] mb-1">{rb.verdict}</p>
                  <p className="leading-relaxed">{rb.feedback}</p>
                </div>
              )}
            </>
          )}
        </div>
      )}

      {imgError && <p className="text-xs text-red-300/80">{imgError}</p>}
      {imgB64 && (
        <img src={`data:image/png;base64,${imgB64}`} alt="Problem diagram" className="w-full rounded-xl border border-white/10" />
      )}

      <div className="flex items-center justify-between pt-2 border-t border-white/10">
        <button onClick={prevCard} disabled={idx === 0}
          className="text-xs text-white/50 hover:text-white/80 disabled:opacity-30 transition-colors">
          ← Previous
        </button>
        <button onClick={nextCard} disabled={idx >= cards.length - 1}
          className="text-xs text-white/50 hover:text-white/80 disabled:opacity-30 transition-colors">
          Next →
        </button>
      </div>
    </div>
  );
}
