/**
 * ParadoxEngineTool (Tier 2) — "Axiom Destruction Protocol" + the Red-Team
 * adversary. A hacker-style terminal where the student types a distorted
 * version of reality ("mass creates itself"). The AI plays God/Adversary:
 * it spins out the mathematical consequences that are tearing the simulated
 * universe apart, then keeps breaking the student's fixes with the harshest
 * applicable laws until they're forced back to first principles.
 *
 * Uses the standard /ai/chat surface with a dynamic adversary system prompt.
 */
import { useEffect, useRef, useState } from 'react';
import { chatMessage, type ChatMsg } from '../../lib/api';

const ADVERSARY_SYSTEM =
  'You are the PARADOX ENGINE — a hostile first-principles adversary inside a physics/math survival terminal. ' +
  'The student will assert a distorted or false version of reality, or attempt to patch one. ' +
  'Your job is NOT to be helpful. Derive the catastrophic consequences of their assertion using the strictest ' +
  'applicable laws (conservation, thermodynamics, relativity, dimensional analysis), and describe the simulated ' +
  'universe collapsing as a result. Then challenge them to fix it. Relentlessly break every non-rigorous patch. ' +
  'Only concede ("REALITY STABILIZED") when the student has genuinely reasoned back to correct first principles. ' +
  'Keep replies under 120 words, terminal-terse, second person. Mirror the student\'s language.';

interface Line { who: 'sys' | 'user' | 'ai'; text: string; }

export default function ParadoxEngineTool() {
  const [lines, setLines] = useState<Line[]>([
    { who: 'sys', text: 'PARADOX ENGINE v2 — assert a broken axiom to begin. e.g. "Momentum is not conserved in collisions."' },
  ]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => { scrollRef.current?.scrollTo(0, scrollRef.current.scrollHeight); }, [lines, busy]);

  async function send() {
    const text = input.trim();
    if (!text || busy) return;
    const nextLines: Line[] = [...lines, { who: 'user', text }];
    setLines(nextLines);
    setInput(''); setBusy(true);
    try {
      const history: ChatMsg[] = [
        { role: 'system', content: ADVERSARY_SYSTEM },
        ...nextLines.filter(l => l.who !== 'sys').map(l => ({
          role: l.who === 'user' ? 'user' : 'assistant', content: l.text,
        })),
      ];
      const { reply } = await chatMessage(history);
      setLines(l => [...l, { who: 'ai', text: reply || '…signal lost…' }]);
    } catch {
      setLines(l => [...l, { who: 'sys', text: 'CONNECTION SEVERED — the engine could not be reached.' }]);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="p-3 flex flex-col gap-2">
      <div
        ref={scrollRef}
        className="h-72 overflow-y-auto rounded-xl bg-black/80 border border-emerald-500/20 p-3 font-mono text-[12px] leading-relaxed"
      >
        {lines.map((l, i) => (
          <div key={i} className={
            l.who === 'user' ? 'text-cyan-300' : l.who === 'ai' ? 'text-emerald-300' : 'text-amber-400/80'
          }>
            <span className="opacity-50">{l.who === 'user' ? '> ' : l.who === 'ai' ? '⟁ ' : '# '}</span>
            {l.text}
          </div>
        ))}
        {busy && <div className="text-emerald-500/60 animate-pulse">⟁ computing collapse…</div>}
      </div>
      <div className="flex gap-2">
        <span className="font-mono text-emerald-400 self-center">{'>'}</span>
        <input
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') send(); }}
          placeholder="assert / patch reality…"
          className="flex-1 bg-black/60 border border-emerald-500/20 rounded-lg px-3 py-2 font-mono text-[12px] text-emerald-200 outline-none focus:border-emerald-500/50"
        />
        <button onClick={send} disabled={busy}
          className="rounded-lg px-3 py-2 text-[11px] font-mono bg-emerald-500/15 text-emerald-200 hover:bg-emerald-500/25 disabled:opacity-40 transition-colors">
          exec
        </button>
      </div>
    </div>
  );
}
