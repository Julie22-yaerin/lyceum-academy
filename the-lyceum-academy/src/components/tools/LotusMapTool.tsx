/**
 * LotusMapTool — a mind map with one house rule: it must stay symmetric.
 * A central topic sits in the middle; branches grow into a top half and a
 * bottom half, and the two halves are locked to the same branch count at
 * all times — add one above, the tool makes you add one below before it
 * lets you add another on top (and vice versa). No topic gets to dominate
 * the map; every idea earns a counterweight.
 *
 * Free — no Quanta cost. Reused as a no-charge assist from other tools
 * (e.g. Exercise Cards) via the `seedTopic` payload.
 */
import { useState } from 'react';

interface Branch {
  id: string;
  label: string;
  notes: string[];
}

type Side = 'top' | 'bottom';

let idCounter = 0;
function nextId() { return `branch-${Date.now()}-${idCounter++}`; }

function BranchCard({
  branch, side, noteDraft, onRemove, onNoteDraftChange, onAddNote,
}: {
  branch: Branch;
  side: Side;
  noteDraft: string;
  onRemove: (side: Side, id: string) => void;
  onNoteDraftChange: (id: string, value: string) => void;
  onAddNote: (side: Side, id: string) => void;
}) {
  return (
    <div className="glass-pill rounded-2xl px-3 py-2.5 flex flex-col gap-1.5 min-w-[160px] max-w-[200px]">
      <div className="flex items-start justify-between gap-2">
        <p className="text-xs text-white/85 leading-snug">{branch.label}</p>
        <button onClick={() => onRemove(side, branch.id)} className="text-white/30 hover:text-red-300 shrink-0 text-[10px]">✕</button>
      </div>
      {branch.notes.map((n, i) => (
        <p key={i} className="text-[10px] text-white/45 pl-2 border-l border-white/10">{n}</p>
      ))}
      <div className="flex gap-1">
        <input
          value={noteDraft}
          onChange={e => onNoteDraftChange(branch.id, e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') onAddNote(side, branch.id); }}
          placeholder="+ detail"
          className="flex-1 bg-transparent text-[10px] text-white/60 outline-none placeholder:text-white/25"
        />
      </div>
    </div>
  );
}

export default function LotusMapTool({ seedTopic }: { seedTopic?: string } = {}) {
  const [topic, setTopic] = useState(seedTopic || '');
  const [topBranches, setTopBranches] = useState<Branch[]>([]);
  const [bottomBranches, setBottomBranches] = useState<Branch[]>([]);
  const [draft, setDraft] = useState('');
  const [noteDrafts, setNoteDrafts] = useState<Record<string, string>>({});

  const balanced = topBranches.length === bottomBranches.length;
  const nextSide: Side | null = balanced ? null : (topBranches.length > bottomBranches.length ? 'bottom' : 'top');

  function addBranch(side: Side) {
    if (!draft.trim()) return;
    if (nextSide && nextSide !== side) return; // must balance the lighter side first
    const branch: Branch = { id: nextId(), label: draft.trim(), notes: [] };
    if (side === 'top') setTopBranches(b => [...b, branch]); else setBottomBranches(b => [...b, branch]);
    setDraft('');
  }

  function removeBranch(side: Side, id: string) {
    // Removing must also preserve symmetry — pull from the same position on
    // the far side so counts never drift apart silently.
    if (side === 'top') {
      const idx = topBranches.findIndex(b => b.id === id);
      setTopBranches(b => b.filter(x => x.id !== id));
      setBottomBranches(b => b.filter((_, i) => i !== idx));
    } else {
      const idx = bottomBranches.findIndex(b => b.id === id);
      setBottomBranches(b => b.filter(x => x.id !== id));
      setTopBranches(b => b.filter((_, i) => i !== idx));
    }
  }

  function setNoteDraft(id: string, value: string) {
    setNoteDrafts(d => ({ ...d, [id]: value }));
  }

  function addNote(side: Side, id: string) {
    const text = (noteDrafts[id] || '').trim();
    if (!text) return;
    const setter = side === 'top' ? setTopBranches : setBottomBranches;
    setter(list => list.map(b => b.id === id ? { ...b, notes: [...b.notes, text] } : b));
    setNoteDraft(id, '');
  }

  return (
    <div className="p-4 flex flex-col gap-4">
      <div>
        <p className="text-[10px] uppercase tracking-[2px] text-white/40 mb-1">Lotus Map · symmetric mind map</p>
        <input
          value={topic} onChange={e => setTopic(e.target.value)}
          placeholder="Central topic…"
          className="w-full bg-white/5 rounded-xl px-3 py-2 text-sm text-white/90 outline-none border border-white/10 focus:border-white/25 text-center font-serif"
        />
      </div>

      {/* Top half */}
      <div className="flex flex-wrap gap-2 justify-center min-h-[52px]">
        {topBranches.map(b => (
          <BranchCard
            key={b.id} branch={b} side="top" noteDraft={noteDrafts[b.id] || ''}
            onRemove={removeBranch} onNoteDraftChange={setNoteDraft} onAddNote={addNote}
          />
        ))}
      </div>

      <div className="flex items-center gap-2">
        <div className="flex-1 h-px bg-white/10" />
        <span className="text-[9px] uppercase tracking-[2px] text-white/30">
          {topBranches.length} top · {bottomBranches.length} bottom
        </span>
        <div className="flex-1 h-px bg-white/10" />
      </div>

      {/* Bottom half */}
      <div className="flex flex-wrap gap-2 justify-center min-h-[52px]">
        {bottomBranches.map(b => (
          <BranchCard
            key={b.id} branch={b} side="bottom" noteDraft={noteDrafts[b.id] || ''}
            onRemove={removeBranch} onNoteDraftChange={setNoteDraft} onAddNote={addNote}
          />
        ))}
      </div>

      {/* Add controls */}
      <div className="flex flex-col gap-2 border-t border-white/10 pt-3">
        <input
          value={draft} onChange={e => setDraft(e.target.value)}
          placeholder="New branch idea…"
          className="w-full bg-white/5 rounded-xl px-3 py-2 text-sm text-white/85 outline-none border border-white/10 focus:border-white/25"
        />
        <div className="flex gap-2">
          <button
            onClick={() => addBranch('top')}
            disabled={!draft.trim() || nextSide === 'bottom'}
            className="flex-1 rounded-xl px-3 py-2 text-[10px] uppercase tracking-[2px] bg-purple-400/15 text-purple-200 hover:bg-purple-400/25 disabled:opacity-30 transition-colors"
          >
            + Add to Top
          </button>
          <button
            onClick={() => addBranch('bottom')}
            disabled={!draft.trim() || nextSide === 'top'}
            className="flex-1 rounded-xl px-3 py-2 text-[10px] uppercase tracking-[2px] bg-amber-400/15 text-amber-200 hover:bg-amber-400/25 disabled:opacity-30 transition-colors"
          >
            + Add to Bottom
          </button>
        </div>
        {nextSide && (
          <p className="text-[10px] text-center text-white/40">
            Balance first — add one to the <span className="text-white/70">{nextSide}</span> before the other side grows again.
          </p>
        )}
      </div>
    </div>
  );
}
