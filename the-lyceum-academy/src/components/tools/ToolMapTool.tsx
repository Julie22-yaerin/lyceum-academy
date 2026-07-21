/**
 * ToolMapTool — generic INPUT → TOOL → OUTPUT flow validator. Build the
 * execution path for any problem and get AI feedback on ordering, missing
 * steps, and mismatched inputs/outputs.
 */
import { useState } from 'react';
import { validateToolMap } from '../../lib/api';

function ChipList({ label, items, onAdd, onRemove, placeholder }: {
  label: string; items: string[]; onAdd: (v: string) => void; onRemove: (i: number) => void; placeholder: string;
}) {
  const [value, setValue] = useState('');
  function add() {
    if (!value.trim()) return;
    onAdd(value.trim());
    setValue('');
  }
  return (
    <div>
      <p className="text-[10px] uppercase tracking-[2px] text-white/40 mb-2">{label}</p>
      <div className="flex flex-wrap gap-1.5 mb-2">
        {items.map((it, i) => (
          <span key={i} className="glass-pill rounded-full px-3 py-1 text-xs text-white/80 flex items-center gap-1.5">
            {it}
            <button onClick={() => onRemove(i)} className="opacity-50 hover:opacity-90">×</button>
          </span>
        ))}
      </div>
      <div className="flex gap-2">
        <input value={value} onChange={e => setValue(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') add(); }}
          placeholder={placeholder}
          className="flex-1 bg-white/5 rounded-lg px-3 py-1.5 text-xs text-white/85 outline-none border border-white/10 focus:border-white/25" />
        <button onClick={add} className="glass-btn rounded-lg px-3 py-1.5 text-[10px] uppercase tracking-[1.5px]">Add</button>
      </div>
    </div>
  );
}

export default function ToolMapTool() {
  const [context, setContext] = useState('');
  const [inputs, setInputs] = useState<string[]>([]);
  const [tools, setTools] = useState<string[]>([]);
  const [outputs, setOutputs] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<{ verdict: string; feedback: string; correct?: string[]; issues?: string[]; missing?: string[]; suggestions?: string[] } | null>(null);

  async function validate() {
    if (tools.length === 0 || busy) return;
    setBusy(true); setError(''); setResult(null);
    try {
      const r = await validateToolMap({ inputs, tools, outputs, context });
      setResult(r as any);
    } catch (e: any) {
      setError(e.message || 'Validation failed.');
    } finally { setBusy(false); }
  }

  return (
    <div className="p-2 flex flex-col gap-4">
      <div>
        <p className="text-[10px] uppercase tracking-[2px] text-white/40 mb-2">Problem (optional)</p>
        <textarea value={context} onChange={e => setContext(e.target.value)} rows={2}
          placeholder="Paste the problem statement for richer feedback…"
          className="w-full bg-white/5 rounded-lg px-3 py-2 text-xs text-white/85 outline-none border border-white/10 focus:border-white/25 resize-y" />
      </div>
      <ChipList label="Inputs" items={inputs} onAdd={v => setInputs([...inputs, v])} onRemove={i => setInputs(inputs.filter((_, x) => x !== i))} placeholder="e.g. initial velocity" />
      <ChipList label="Tools / methods, in order" items={tools} onAdd={v => setTools([...tools, v])} onRemove={i => setTools(tools.filter((_, x) => x !== i))} placeholder="e.g. kinematics equation" />
      <ChipList label="Outputs" items={outputs} onAdd={v => setOutputs([...outputs, v])} onRemove={i => setOutputs(outputs.filter((_, x) => x !== i))} placeholder="e.g. time to reach ground" />

      <button onClick={validate} disabled={busy || tools.length === 0}
        className="glass-btn rounded-xl px-4 py-2.5 text-[10px] uppercase tracking-[2px] disabled:opacity-30 self-end">
        {busy ? 'Validating…' : 'Validate map'}
      </button>

      {error && <p className="text-xs text-red-300/80">{error}</p>}

      {result && (
        <div className="glass-pill rounded-xl px-4 py-3 flex flex-col gap-2">
          <span className={`text-[10px] uppercase tracking-[2px] ${result.verdict === 'pass' ? 'text-emerald-400' : result.verdict === 'partial' ? 'text-amber-400' : 'text-red-400'}`}>
            {result.verdict}
          </span>
          <p className="text-sm text-white/80">{result.feedback}</p>
          {!!result.missing?.length && <p className="text-xs text-white/50">Missing: {result.missing.join(', ')}</p>}
          {!!result.suggestions?.length && <p className="text-xs text-white/50">Suggestions: {result.suggestions.join(', ')}</p>}
        </div>
      )}
    </div>
  );
}
