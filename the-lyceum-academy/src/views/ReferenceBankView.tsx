import { useState, useEffect } from 'react';
import { loadReferences, deleteReference, type ReferenceEntry } from '../lib/persist';
import SmartImage from '../components/SmartImage';
import { useReferenceLibraryGate } from '../lib/useSubscription';
import UpgradePrompt from '../components/UpgradePrompt';
import { useWorkspace } from '../context/WorkspaceContext';

function ReferenceCard({ entry, onDelete, onOpenImage }: { entry: ReferenceEntry; onDelete: () => void; onOpenImage: (url: string) => void }) {
  const date = new Date(entry.savedAt);
  const dateStr = date.toLocaleDateString('en-US', { day: '2-digit', month: '2-digit', year: 'numeric' });
  const images = entry.imageUrls?.length ? entry.imageUrls : (entry.imageUrl ? [entry.imageUrl] : []);
  // A real Wikipedia/Knowledge-Graph article, not a generic search query — label it accordingly.
  const isCitable = !!entry.sourceUrl && !entry.sourceUrl.includes('google.com/search');

  return (
    <div className="glass-strong rounded-2xl p-4 flex gap-4 items-start hover:bg-white/[0.03] transition-all">
      {images.length > 0 && (
        <div className="flex flex-col gap-1.5 flex-shrink-0">
          <SmartImage
            src={images[0]}
            alt=""
            onClick={() => onOpenImage(images[0])}
            className="w-16 h-16 rounded-xl object-cover cursor-pointer hover:opacity-85 transition-opacity"
          />
          {images.length > 1 && (
            <div className="flex gap-1.5">
              {images.slice(1, 3).map((img, i) => (
                <SmartImage key={i} src={img} alt="" onClick={() => onOpenImage(img)}
                  className="w-[29px] h-[29px] rounded-md object-cover cursor-pointer opacity-80 hover:opacity-100 transition-opacity" />
              ))}
            </div>
          )}
        </div>
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
              {isCitable ? 'Source ↗' : 'Search ↗'}
            </a>
          )}
        </div>
      </div>
    </div>
  );
}

export default function ReferenceBankView() {
  const { activeTab } = useWorkspace();
  const [refs, setRefs] = useState<ReferenceEntry[]>([]);
  const [lightboxImage, setLightboxImage] = useState<string | null>(null);
  const [showUpgradePrompt, setShowUpgradePrompt] = useState(false);
  const { canUse, limit, used } = useReferenceLibraryGate();

  useEffect(() => { setRefs(loadReferences(activeTab || undefined)); }, [activeTab]);

  function handleDelete(id: string) {
    deleteReference(id);
    setRefs(loadReferences(activeTab || undefined));
  }

  const limitText = limit === Infinity ? 'Unlimited' : `${used} / ${limit}`;
  const nearLimit = limit !== Infinity && used >= limit * 0.8;
  const atLimit = !canUse;

  return (
    <div className="w-full max-w-4xl mx-auto py-4">
      {showUpgradePrompt && (
        <UpgradePrompt
          feature="reference"
          onClose={() => setShowUpgradePrompt(false)}
        />
      )}

      <div className="mb-6">
        <div className="flex items-center justify-between mb-1">
          <h1 className="font-serif text-2xl text-white/90">Reference Bank</h1>
          <div className="flex items-center gap-2">
            <span className={`font-sans text-xs ${atLimit ? 'text-red-400' : nearLimit ? 'text-yellow-400' : 'text-white/50'}`}>
              {limitText}
            </span>
            {atLimit && (
              <button
                onClick={() => setShowUpgradePrompt(true)}
                className="px-3 py-1 rounded-full bg-blue-600 hover:bg-blue-700 text-white text-[10px] font-sans uppercase tracking-wider"
              >
                Upgrade
              </button>
            )}
          </div>
        </div>
        <p className="font-sans text-xs text-white/40">
          Everything Gemma has researched for you, sorted by topic{atLimit ? ' — limit reached' : ''}.
        </p>
      </div>

      {refs.length === 0 ? (
        <div className="glass-strong rounded-2xl p-10 text-center">
          <p className="font-sans text-sm text-white/40">
            Nothing here yet for this subject. Ask ARI to look something up and it'll show up in this bank automatically.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {refs.map(r => (
            <ReferenceCard key={r.id} entry={r} onDelete={() => handleDelete(r.id)} onOpenImage={setLightboxImage} />
          ))}
        </div>
      )}

      {/* Lightbox: full-size reference image on a blurred backdrop */}
      {lightboxImage && (
        <div
          className="fixed inset-0 z-[250] flex items-center justify-center p-8 bg-black/60 backdrop-blur-xl animate-scale-in"
          onClick={() => setLightboxImage(null)}
        >
          <SmartImage src={lightboxImage} alt="" className="max-w-full max-h-full rounded-2xl shadow-2xl" onClick={e => e.stopPropagation()} />
          <button onClick={() => setLightboxImage(null)}
            className="absolute top-6 right-6 w-10 h-10 rounded-full glass-strong flex items-center justify-center text-white/80 hover:text-white transition-colors">
            <span className="material-symbols-outlined text-[20px]">close</span>
          </button>
        </div>
      )}
    </div>
  );
}
