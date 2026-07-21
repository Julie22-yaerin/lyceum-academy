/**
 * ReverseBuildTool — generic ad-hoc reverse-build: paste any problem, get
 * the solution + required tools revealed, then reconstruct the method
 * backwards from the answer in your own words for AI evaluation. (The
 * in-exercise "rescue after 3 wrong attempts" mechanic in Socrat is a
 * separate, automatic flow — this is the standalone version, usable on
 * anything, any time.)
 */
import { useState } from 'react';
import { revealSolution, evaluateReverseBuild, type ReverseBuildEval } from '../../lib/api';
import { detectSubject } from '../../lib/persist';

export default function ReverseBuildTool() {
  const [problem, setProblem] = useState('');
  const [revealed, setRevealed] = useState<{ solution: string; required_tools: string[] } | null>(null);
  const [explanation, setExplanation] = useState('');
  const [evalResult, setEvalResult] = useState<ReverseBuildEval | null>(null);
  const [loadingReveal, setLoadingReveal] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  async function reveal() {
    if (!problem.trim() || loadingReveal) return;
    setLoadingReveal(true); setError(''); setRevealed(null); setEvalResult(null);
    try {
      const r = await revealSolution(problem.trim(), [], detectSubject(problem));
      setRevealed(r);
    } catch (e: any) {
      setError(e.message || 'Could not reveal a solution.');
    } finally { setLoadingReveal(false); }
  }

  async function submit() {
    if (!revealed || !explanation.trim() || submitting) return;
    setSubmitting(true); setError('');
    try {
      const ev = await evaluateReverseBuild(explanation.trim(), problem.trim(), revealed.required_tools, detectSubject(problem));
      setEvalResult(ev);
    } catch (e: any) {
      setError(e.message || 'Could not evaluate.');
    } finally { setSubmitting(false); }
  }

  return (
    <div className="p-2 flex flex-col gap-4">
      <div>
        <p className="text-[10px] uppercase tracking-[2px] text-white/40 mb-2">Problem</p>
        <textarea value={problem} onChange={e => setProblem(e.target.value)} rows={3}
          placeholder="Paste a problem you already know (or want to know) the answer to…"
          className="w-full bg-white/5 rounded-lg px-3 py-2 text-sm text-white/85 outline-none border border-white/10 focus:border-white/25 resize-y" />
        <button onClick={reveal} disabled={loadingReveal || !problem.trim()}
          className="glass-btn rounded-xl px-4 py-2 text-[10px] uppercase tracking-[2px] disabled:opacity-30 mt-2">
          {loadingReveal ? 'Revealing…' : 'Reveal solution'}
        </button>
      </div>

      {revealed && (
        <div className="glass-pill rounded-xl px-4 py-3">
          <p className="text-sm text-white/80 whitespace-pre-wrap">{revealed.solution}</p>
          {revealed.required_tools.length > 0 && (
            <p className="text-xs text-white/40 mt-2">Tools used: {revealed.required_tools.join(', ')}</p>
          )}
        </div>
      )}

      {revealed && (
        <div>
          <p className="text-[10px] uppercase tracking-[2px] text-white/40 mb-2">Now rebuild it backwards, in your own words</p>
          <textarea value={explanation} onChange={e => setExplanation(e.target.value)} rows={4}
            placeholder="Starting from the answer, reconstruct the method step by step…"
            className="w-full bg-white/5 rounded-lg px-3 py-2 text-sm text-white/85 outline-none border border-white/10 focus:border-white/25 resize-y" />
          <button onClick={submit} disabled={submitting || !explanation.trim()}
            className="glass-btn rounded-xl px-4 py-2 text-[10px] uppercase tracking-[2px] disabled:opacity-30 mt-2">
            {submitting ? 'Checking…' : 'Submit rebuild'}
          </button>
        </div>
      )}

      {evalResult && (
        <div className="glass-pill rounded-xl px-4 py-3">
          <span className={`text-[10px] uppercase tracking-[2px] ${evalResult.verdict === 'pass' ? 'text-emerald-400' : evalResult.verdict === 'partial' ? 'text-amber-400' : 'text-red-400'}`}>
            {evalResult.verdict}
          </span>
          <p className="text-sm text-white/80 mt-1.5">{evalResult.feedback}</p>
        </div>
      )}

      {error && <p className="text-xs text-red-300/80">{error}</p>}
    </div>
  );
}
