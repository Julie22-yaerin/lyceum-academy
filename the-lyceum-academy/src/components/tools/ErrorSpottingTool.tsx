/**
 * ErrorSpottingTool — "soi lỗi": step 3 of the suggested topic order
 * (Podcast + Whiteboard -> Feynman -> Error Spotting -> Exercise Cards).
 * A deliberately flawed worked example — click the step that's wrong,
 * write the correction and the correct final answer, then Commit. AI
 * grades all three parts at once; the ground truth only appears after
 * grading, never before.
 */
import { useState } from 'react';
import { useWorkspace } from '../../context/WorkspaceContext';
import { useToolDock } from '../../context/ToolDockContext';
import {
  generateErrorSpotting, gradeErrorSpotting,
  type ErrorSpottingExample, type ErrorSpottingGradeResult,
} from '../../lib/lyceumApi';

type Phase = 'setup' | 'loading' | 'solving' | 'graded';

export default function ErrorSpottingTool() {
  const { activeTab } = useWorkspace();
  const { openTool } = useToolDock();
  const [phase, setPhase] = useState<Phase>('setup');
  const [topic, setTopic] = useState('');
  const [sessionId, setSessionId] = useState('');
  const [examples, setExamples] = useState<ErrorSpottingExample[]>([]);
  const [current, setCurrent] = useState(0);
  const [pickedStep, setPickedStep] = useState<number | null>(null);
  const [correction, setCorrection] = useState('');
  const [finalAnswer, setFinalAnswer] = useState('');
  const [result, setResult] = useState<ErrorSpottingGradeResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function start() {
    setBusy(true); setError('');
    try {
      const r = await generateErrorSpotting(activeTab || '', topic.trim());
      setSessionId(r.session_id);
      setExamples(r.examples);
      setCurrent(0);
      resetAnswer();
      setPhase('solving');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Không tạo được bài — thử lại.');
    } finally {
      setBusy(false);
    }
  }

  function resetAnswer() {
    setPickedStep(null); setCorrection(''); setFinalAnswer(''); setResult(null);
  }

  async function commit() {
    if (pickedStep === null || !correction.trim() || !finalAnswer.trim() || busy) return;
    setBusy(true); setError('');
    try {
      const r = await gradeErrorSpotting(sessionId, examples[current].id, pickedStep, correction.trim(), finalAnswer.trim());
      setResult(r);
      setPhase('graded');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Không chấm được — thử lại.');
    } finally {
      setBusy(false);
    }
  }

  function nextExample() {
    if (current + 1 < examples.length) {
      setCurrent(c => c + 1);
      resetAnswer();
      setPhase('solving');
    } else {
      // All examples done — hand off to the next step in the suggested order.
      openTool('exercise-cards');
    }
  }

  const ex = examples[current];

  if (phase === 'setup') {
    return (
      <div className="p-4 flex flex-col gap-3">
        <p className="text-[11px] text-white/50 leading-relaxed">
          AI dựng một bài giải có sẵn — trong đó cố tình có một bước sai. Bạn tìm ra bước đó,
          sửa lại, và cho đáp án đúng. Commit xong AI sẽ chấm luôn.
        </p>
        <input
          value={topic} onChange={e => setTopic(e.target.value)}
          placeholder="Chủ đề cụ thể (bỏ trống = AI tự chọn)…"
          className="w-full bg-white/5 rounded-xl px-3 py-2 text-sm text-white/85 outline-none border border-white/10 focus:border-white/25"
        />
        {error && <p className="text-xs text-red-300/80">{error}</p>}
        <button onClick={start} disabled={busy}
          className="self-center rounded-xl px-5 py-2.5 text-[11px] uppercase tracking-[2px] bg-purple-400/15 text-purple-200 hover:bg-purple-400/25 disabled:opacity-30 transition-colors">
          {busy ? 'Đang tạo…' : 'Bắt đầu'}
        </button>
      </div>
    );
  }

  if (!ex) return null;

  return (
    <div className="p-4 flex flex-col gap-3">
      <p className="text-[10px] uppercase tracking-[2px] text-white/40">
        Bài {current + 1}/{examples.length}
      </p>
      <div className="rounded-2xl bg-white/5 p-4">
        <p className="text-sm text-white/90 leading-relaxed">{ex.problem}</p>
      </div>

      <div className="flex flex-col gap-1.5">
        {ex.steps.map((step, i) => (
          <button
            key={i}
            onClick={() => phase === 'solving' && setPickedStep(i)}
            disabled={phase !== 'solving'}
            className={`text-left rounded-xl px-3 py-2.5 text-sm border transition-colors ${
              phase === 'graded' && result?.correct_step_index === i
                ? 'border-emerald-400/50 bg-emerald-400/10 text-emerald-100'
                : pickedStep === i
                  ? 'border-purple-400/50 bg-purple-400/10 text-purple-100'
                  : 'border-white/10 bg-white/[0.02] text-white/75 hover:border-white/25'
            }`}
          >
            <span className="text-white/30 mr-2">{i + 1}.</span>{step}
          </button>
        ))}
      </div>

      {phase === 'solving' && (
        <>
          <textarea
            value={correction} onChange={e => setCorrection(e.target.value)}
            placeholder="Bước đó đúng ra phải là gì?"
            rows={2}
            className="w-full bg-white/5 rounded-xl px-3 py-2 text-sm text-white/85 outline-none border border-white/10 focus:border-white/25 resize-y"
          />
          <input
            value={finalAnswer} onChange={e => setFinalAnswer(e.target.value)}
            placeholder="Đáp án cuối cùng đúng"
            className="w-full bg-white/5 rounded-xl px-3 py-2 text-sm text-white/85 outline-none border border-white/10 focus:border-white/25"
          />
          {error && <p className="text-xs text-red-300/80">{error}</p>}
          <button
            onClick={commit}
            disabled={pickedStep === null || !correction.trim() || !finalAnswer.trim() || busy}
            className="self-center rounded-xl px-6 py-2.5 text-[11px] uppercase tracking-[2px] bg-purple-400 text-black font-bold hover:bg-purple-300 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
          >
            {busy ? 'Đang chấm…' : 'Commit'}
          </button>
        </>
      )}

      {phase === 'graded' && result && (
        <div className="flex flex-col gap-3">
          <div className={`rounded-2xl p-4 flex flex-col gap-1.5 ${
            result.step_correct && result.correction_correct && result.answer_correct
              ? 'bg-emerald-400/10' : 'bg-amber-400/10'
          }`}>
            <div className="flex gap-3 text-[10px] uppercase tracking-[1.5px]">
              <span className={result.step_correct ? 'text-emerald-300' : 'text-red-300'}>
                {result.step_correct ? '✓' : '✗'} Vị trí
              </span>
              <span className={result.correction_correct ? 'text-emerald-300' : 'text-red-300'}>
                {result.correction_correct ? '✓' : '✗'} Sửa lại
              </span>
              <span className={result.answer_correct ? 'text-emerald-300' : 'text-red-300'}>
                {result.answer_correct ? '✓' : '✗'} Đáp án
              </span>
            </div>
            <p className="text-sm text-white/85 leading-relaxed">{result.feedback}</p>
          </div>
          <div className="rounded-2xl bg-white/[0.03] p-4 text-xs text-white/60 leading-relaxed">
            <p><span className="text-white/40">Bước đúng ra:</span> {result.correct_step}</p>
            <p className="mt-1"><span className="text-white/40">Đáp án đúng:</span> {result.correct_final_answer}</p>
          </div>
          <button onClick={nextExample}
            className="self-center rounded-xl px-6 py-2.5 text-[11px] uppercase tracking-[2px] bg-white/10 text-white/80 hover:bg-white/20 transition-colors">
            {current + 1 < examples.length ? 'Bài tiếp theo' : 'Sang Exercise Cards →'}
          </button>
        </div>
      )}
    </div>
  );
}
