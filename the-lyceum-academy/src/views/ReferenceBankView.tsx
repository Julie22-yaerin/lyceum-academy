import { useState } from 'react';
import { loadReferences, deleteReference, SUBJECT_META, type ReferenceEntry } from '../lib/persist';

function ReferenceCard({ entry, onDelete }: { entry: ReferenceEntry; onDelete: () => void }) {
  const date = new Date(entry.savedAt);
  const dateStr = date.toLocaleDateString('en-US', { day: '2-digit', month: '2-digit', year: 'numeric' });

  return (
    <div className="glass-strong rounded-2xl p-4 flex gap-4 items-start hover:bg-white/[0.03] transition-all">
      {entry.imageUrl && (
        <img
          src={entry.imageUrl}
          alt=""
          className="w-16 h-16 rounded-xl object-cover flex-shrink-0"
          onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }}
        />
      )}
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-2 mb-1">
          <h4 className="font-serif text-sm text-white/90 truncate">{entry.topic}</h4>
          <button onClick={onDelete} className="opacity-30 hover:opacity-80 transition-opacity flex-shrink-0">
            <span className="material-symbols-outlined text-[14px]">close</span>
          </button>
        </div>
        <p className="font-sans text-[11px] text-white/50 leading-relaxed line-clamp-3 mb-2">{entry.summary}</p>
        <div className="flex items-center gap-3">
          <span className="font-sans text-[9px] uppercase tracking-wider text-white/30">{dateStr}</span>
          {entry.sourceUrl && (
            <a
              href={entry.sourceUrl}
              target="_blank"
              rel="noreferrer"
              className="font-sans text-[10px] text-blue-300/70 hover:text-blue-300 transition-colors"
            >
              Source ↗
            </a>
          )}
        </div>
      </div>
    </div>
  );
}

export default function ReferenceBankView() {
  const [refs, setRefs] = useState<ReferenceEntry[]>(() => loadReferences());
  const [activeCategory, setActiveCategory] = useState<string | null>(null);

  function handleDelete(id: string) {
    deleteReference(id);
    setRefs(loadReferences());
  }

  const byCategory: Record<string, ReferenceEntry[]> = {};
  for (const r of refs) {
    (byCategory[r.category] ??= []).push(r);
  }
  const categories = Object.keys(byCategory).sort((a, b) => byCategory[b].length - byCategory[a].length);
  const visibleCategories = activeCategory ? categories.filter(c => c === activeCategory) : categories;

  return (
    <div className="w-full max-w-4xl mx-auto py-4">
      <div className="mb-6">
        <h1 className="font-serif text-2xl text-white/90 mb-1">Reference Bank</h1>
        <p className="font-sans text-xs text-white/40">
          Everything Gemma has researched for you, sorted by topic — {refs.length} saved.
        </p>
      </div>

      {refs.length === 0 ? (
        <div className="glass-strong rounded-2xl p-10 text-center">
          <p className="font-sans text-sm text-white/40">
            Nothing here yet. Ask ARI to look something up and it'll show up in this bank automatically.
          </p>
        </div>
      ) : (
        <>
          <div className="flex flex-wrap gap-2 mb-6">
            <button
              onClick={() => setActiveCategory(null)}
              className={`px-3 py-1.5 rounded-full text-[11px] font-sans transition-all ${
                activeCategory === null ? 'bg-white/15 text-white' : 'bg-white/5 text-white/50 hover:bg-white/10'
              }`}
            >
              All ({refs.length})
            </button>
            {categories.map(cat => {
              const meta = SUBJECT_META[cat] || SUBJECT_META.other;
              return (
                <button
                  key={cat}
                  onClick={() => setActiveCategory(cat === activeCategory ? null : cat)}
                  className={`px-3 py-1.5 rounded-full text-[11px] font-sans transition-all ${
                    activeCategory === cat ? 'bg-white/15 text-white' : 'bg-white/5 text-white/50 hover:bg-white/10'
                  }`}
                >
                  {meta.icon} {meta.label} ({byCategory[cat].length})
                </button>
              );
            })}
          </div>

          <div className="flex flex-col gap-8">
            {visibleCategories.map(cat => {
              const meta = SUBJECT_META[cat] || SUBJECT_META.other;
              return (
                <div key={cat}>
                  <h3 className="font-sans text-[10px] uppercase tracking-[2px] text-white/40 mb-3">
                    {meta.icon} {meta.label}
                  </h3>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    {byCategory[cat].map(r => (
                      <ReferenceCard key={r.id} entry={r} onDelete={() => handleDelete(r.id)} />
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
