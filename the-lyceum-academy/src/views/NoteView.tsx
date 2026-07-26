import { useState, useRef, useEffect } from 'react';
import { noteChatMessage, NoteResult, NoteConcept, ChatMsg } from '../lib/api';
import { loadKaTeX, renderMath, renderNote } from '../lib/math';
import { sanitizeSvg } from '../lib/sanitize';
import { loadNotes, saveNote, deleteNote, setNoteFolder, listNoteFolders, shortTitle, type SavedNote } from '../lib/persist';
import { fetchTodayMaterials, type CatalogItem } from '../lib/coach';
import { getWorkspaceId } from '../lib/catalogMembership';
import { useWorkspace } from '../context/WorkspaceContext';
import { useTranslation } from '../i18n/I18nContext';

// ── ConceptCard ───────────────────────────────────────────────────────────
function ConceptCard({ kc }: { kc: NoteConcept & { how_to_use?: string; applications?: string; why?: string } }) {
  const [imgErr, setImgErr] = useState(false);
  const { t } = useTranslation();

  return (
    <div className="border border-outline/10 overflow-hidden">
      {/* Wikipedia thumbnail */}
      {kc.image_url && !imgErr && (
        <div className="w-full h-36 bg-surface-container-highest overflow-hidden">
          <img
            src={kc.image_url}
            alt={kc.concept}
            onError={() => setImgErr(true)}
            className="w-full h-full object-cover grayscale opacity-80"
          />
        </div>
      )}
      <div className="p-5 flex flex-col gap-3">
        {/* Header */}
        <div className="flex items-center gap-2">
          <span className="text-xl">{kc.emoji}</span>
          <span className="font-serif text-base font-medium"
            dangerouslySetInnerHTML={{ __html: renderMath(kc.concept) }} />
        </div>

        {/* Formal definition */}
        {kc.definition && (
          <>
            <p className="font-sans text-[10px] uppercase tracking-[1px] opacity-40">{t('notes.definition')}</p>
            <p className="font-sans text-xs text-on-surface opacity-80 leading-relaxed italic border-l-2 border-outline/20 pl-3"
              dangerouslySetInnerHTML={{ __html: renderMath(kc.definition) }} />
          </>
        )}

        {/* LaTeX equation */}
        {kc.equation && (
          <div className="bg-surface-container-lowest px-3 py-2.5 text-center font-sans text-sm border border-outline/10"
            dangerouslySetInnerHTML={{ __html: renderMath(`$$${kc.equation}$$`) }} />
        )}

        {/* The WHY */}
        {(kc as any).why && (
          <>
            <p className="font-sans text-[10px] uppercase tracking-[1px] opacity-40">{t('notes.theWhy')}</p>
            <p className="font-sans text-sm opacity-75 leading-relaxed"
              dangerouslySetInnerHTML={{ __html: renderMath((kc as any).why) }} />
          </>
        )}

        {/* How to use */}
        {(kc as any).how_to_use && (
          <>
            <p className="font-sans text-[10px] uppercase tracking-[1px] opacity-40">{t('notes.howToUse')}</p>
            <p className="font-sans text-sm opacity-75 leading-relaxed"
              dangerouslySetInnerHTML={{ __html: renderMath((kc as any).how_to_use) }} />
          </>
        )}

        {/* Applications */}
        {(kc as any).applications && (
          <>
            <p className="font-sans text-[10px] uppercase tracking-[1px] opacity-40">{t('notes.applications')}</p>
            <p className="font-sans text-sm opacity-75 leading-relaxed"
              dangerouslySetInnerHTML={{ __html: renderMath((kc as any).applications) }} />
          </>
        )}

        {/* Fun analogy */}
        {kc.explanation && (
          <p className="font-sans text-sm opacity-60 leading-relaxed italic border-t border-outline/10 pt-2 mt-1"
            dangerouslySetInnerHTML={{ __html: renderMath(kc.explanation) }} />
        )}
      </div>
    </div>
  );
}

// ── DiagramCard — renders an AI-generated SVG diagram ───────────────────
function DiagramCard({ diagram }: { diagram: { type: string; title: string; svg: string } }) {
  const { t } = useTranslation();
  const TYPE_LABEL: Record<string, string> = {
    pyramid: t('notes.diagramPyramid'), flowchart: t('notes.diagramFlowchart'), mindmap: t('notes.diagramMindmap'),
    timeline: t('notes.diagramTimeline'), cycle: t('notes.diagramCycle'), diagram: t('notes.diagramDiagram'),
  };
  return (
    <div className="border border-outline/10 overflow-hidden">
      <div className="px-5 py-3 border-b border-outline/10 flex items-center justify-between bg-surface-container-lowest/40">
        <span className="font-sans text-[10px] uppercase tracking-[2px] opacity-50">
          {TYPE_LABEL[diagram.type] || diagram.type}
        </span>
        {diagram.title && (
          <span className="font-serif text-xs opacity-60 italic truncate ml-3 max-w-[240px]">{diagram.title}</span>
        )}
      </div>
      <div
        className="w-full"
        style={{ aspectRatio: '800/480' }}
        dangerouslySetInnerHTML={{ __html: sanitizeSvg(diagram.svg) }}
      />
    </div>
  );
}

// ── NoteChatPanel — AI dialogue panel (right half) ───────────────────────
const QUICK_PROMPTS = [
  { label: '📊 Comparison table', msg: 'Create a comparison table of the key concepts in this note' },
  { label: '💡 Real-world example', msg: 'Give me 3 real-world examples applying the content of this note' },
  { label: '🤓 Explain in more depth', msg: 'Explain the most important part of this note in more depth, with a concrete example' },
  { label: '✏️ What am I missing?', msg: 'Is there anything important missing from this note? Suggest additions.' },
];

interface ChatBubble { role: 'user' | 'assistant'; content: string; }

function NoteChatPanel({ note }: { note: NoteResult }) {
  const { t } = useTranslation();
  const [messages, setMessages] = useState<ChatBubble[]>([]);
  const [input, setInput]       = useState('');
  const [loading, setLoading]   = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef  = useRef<HTMLTextAreaElement>(null);
  const [, setTick] = useState(0);

  useEffect(() => { loadKaTeX(() => setTick(t => t + 1)); }, []);
  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages, loading]);

  async function send(text?: string) {
    const content = (text ?? input).trim();
    if (!content || loading) return;
    setInput('');
    const updated: ChatBubble[] = [...messages, { role: 'user', content }];
    setMessages(updated);
    setLoading(true);
    try {
      const apiMsgs: ChatMsg[] = updated.map(m => ({ role: m.role, content: m.content }));
      const ctx = {
        title: note.title,
        summary: note.summary,
        key_concepts: (note.key_concepts || []).map(kc => ({
          concept: kc.concept,
          definition: kc.definition,
          explanation: kc.explanation,
        })),
        key_insight: note.key_insight,
      };
      const result = await noteChatMessage(apiMsgs, ctx);
      setMessages([...updated, { role: 'assistant', content: result.reply }]);
    } catch (e: any) {
      setMessages([...updated, { role: 'assistant', content: `⚠️ ${e.message}` }]);
    } finally {
      setLoading(false);
    }
  }

  function handleKey(e: { key: string; shiftKey: boolean; preventDefault: () => void }) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
  }

  return (
    <div className="flex flex-col h-full bg-surface border-l border-outline/10">
      {/* Header */}
      <div className="px-6 py-5 border-b border-outline/10 bg-surface-container-lowest/40 shrink-0">
        <p className="font-serif text-xl font-medium">{t('notes.chatHeading')}</p>
        <p className="font-sans text-[10px] uppercase tracking-[1.5px] opacity-40 mt-0.5">
          {t('notes.chatSubtitle')}
        </p>
      </div>

      {/* Quick prompts — only before first message */}
      {messages.length === 0 && (
        <div className="px-5 pt-5 pb-2 shrink-0 flex flex-col gap-2">
          {QUICK_PROMPTS.map((qp, i) => (
            <button
              key={i}
              onClick={() => send(qp.msg)}
              disabled={loading}
              className="text-left border border-outline/15 px-4 py-2.5 font-sans text-xs hover:bg-surface-container-lowest transition-colors disabled:opacity-30"
            >
              {qp.label}
            </button>
          ))}
        </div>
      )}

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-5 py-4 flex flex-col gap-4 min-h-0">
        {messages.map((m, i) => (
          <div key={i} className={`flex gap-3 ${m.role === 'user' ? 'flex-row-reverse' : 'flex-row'}`}>
            {/* Avatar */}
            <div className={`shrink-0 w-7 h-7 rounded-full flex items-center justify-center text-xs font-medium
              ${m.role === 'user'
                ? 'bg-on-surface text-surface'
                : 'bg-surface-container-highest border border-outline/15'}`}>
              {m.role === 'user' ? 'M' : '✦'}
            </div>
            {/* Bubble */}
            <div className={`max-w-[82%] px-4 py-3 text-sm leading-relaxed
              ${m.role === 'user'
                ? 'bg-on-surface text-surface font-sans'
                : 'bg-surface-container-lowest border border-outline/10 note-body text-on-surface'}`}
              style={{ borderRadius: m.role === 'user' ? '12px 2px 12px 12px' : '2px 12px 12px 12px' }}>
              {m.role === 'user'
                ? <span className="opacity-90">{m.content}</span>
                : <div dangerouslySetInnerHTML={{ __html: renderNote(m.content) }} />
              }
            </div>
          </div>
        ))}

        {loading && (
          <div className="flex gap-3">
            <div className="w-7 h-7 rounded-full bg-surface-container-highest border border-outline/15 flex items-center justify-center text-xs">✦</div>
            <div className="bg-surface-container-lowest border border-outline/10 px-4 py-3 flex gap-1.5 items-center"
              style={{ borderRadius: '2px 12px 12px 12px' }}>
              {[0,1,2].map(i => (
                <div key={i} className="w-1.5 h-1.5 bg-on-surface rounded-full opacity-30 animate-bounce"
                  style={{ animationDelay: `${i * 0.15}s` }} />
              ))}
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div className="px-5 py-4 border-t border-outline/10 shrink-0 bg-surface">
        <div className="flex gap-3 items-end">
          <textarea
            ref={inputRef}
            rows={2}
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={handleKey}
            placeholder={t('notes.chatPlaceholder')}
            className="flex-1 border border-outline/20 px-4 py-3 font-sans text-sm bg-surface-container-lowest outline-none focus:border-on-surface/40 transition-colors resize-none leading-relaxed"
            style={{ minHeight: '60px', maxHeight: '120px' }}
          />
          <button
            onClick={() => send()}
            disabled={loading || !input.trim()}
            className="bg-on-surface text-surface w-11 h-11 flex items-center justify-center hover:opacity-80 transition-opacity disabled:opacity-25 shrink-0"
          >
            <span className="material-symbols-outlined text-[18px]">send</span>
          </button>
        </div>
        {messages.length > 0 && (
          <button
            onClick={() => setMessages([])}
            className="mt-2 font-sans text-[9px] uppercase tracking-[1.5px] opacity-25 hover:opacity-50 transition-opacity"
          >
            {t('notes.clearChat')}
          </button>
        )}
      </div>
    </div>
  );
}

// ── NoteCard — rendered output ────────────────────────────────────────────
function NoteCard({ note }: { note: NoteResult }) {
  const { t } = useTranslation();
  const [, setKatexTick] = useState(0);
  useEffect(() => { loadKaTeX(() => setKatexTick(t => t + 1)); }, []);

  return (
    <div className="w-full max-w-3xl flex flex-col gap-0 border border-outline/10 shadow-sm overflow-hidden">

      {/* Title + TL;DR */}
      <div className="bg-on-surface text-surface px-8 py-7">
        <h2 className="font-serif text-2xl leading-snug mb-3"
          dangerouslySetInnerHTML={{ __html: renderMath(note.title) }} />
        {note.tldr && (
          <p className="font-sans text-sm opacity-75 leading-relaxed"
            dangerouslySetInnerHTML={{ __html: renderMath(note.tldr) }} />
        )}
        {note.source_type && (
          <span className="font-sans text-[9px] uppercase tracking-[2px] opacity-40 mt-3 block">
            {note.source_type}
            {note.video_id && (
              <a href={`https://youtu.be/${note.video_id}`} target="_blank" rel="noopener noreferrer"
                className="ml-2 underline opacity-60 hover:opacity-100">{t('notes.watchLink')}</a>
            )}
          </span>
        )}
      </div>

      {/* Summary — full rich markdown document */}
      <div className="px-8 py-7 border-b border-outline/10">
        <span className="font-sans text-[10px] uppercase tracking-[2px] opacity-40 block mb-4">{t('notes.summary')}</span>
        <div className="note-body text-on-surface"
          dangerouslySetInnerHTML={{ __html: renderNote(note.summary) }} />
      </div>

      {/* Key Concepts — card grid */}
      {note.key_concepts?.length > 0 && (
        <div className="px-8 py-7 border-b border-outline/10">
          <span className="font-sans text-[10px] uppercase tracking-[2px] opacity-40 block mb-5">{t('notes.keyConcepts')}</span>
          <div className="flex flex-col gap-4">
            {note.key_concepts.map((kc, i) => (
              <ConceptCard key={i} kc={kc} />
            ))}
          </div>
        </div>
      )}

      {/* AI-generated diagrams */}
      {(note as any).diagrams?.length > 0 && (
        <div className="px-8 py-7 border-b border-outline/10">
          <span className="font-sans text-[10px] uppercase tracking-[2px] opacity-40 block mb-5">{t('notes.diagrams')}</span>
          <div className="flex flex-col gap-4">
            {((note as any).diagrams as { type: string; title: string; svg: string }[]).map((d, i) => (
              <DiagramCard key={i} diagram={d} />
            ))}
          </div>
        </div>
      )}

      {/* Socratic Questions */}
      {note.socratic_questions?.length > 0 && (
        <div className="px-8 py-7 border-b border-outline/10 bg-surface-container-lowest/40">
          <span className="font-sans text-[10px] uppercase tracking-[2px] opacity-40 block mb-5">{t('notes.socraticQuestions')}</span>
          <div className="flex flex-col gap-3">
            {note.socratic_questions.map((q, i) => (
              <p key={i} className="font-serif text-base leading-snug italic"
                dangerouslySetInnerHTML={{ __html: renderMath(q) }} />
            ))}
          </div>
        </div>
      )}

      {/* Key Insight */}
      {note.key_insight && (
        <div className="px-8 py-7">
          <span className="font-sans text-[10px] uppercase tracking-[2px] opacity-40 block mb-3">{t('notes.keyInsight')}</span>
          <p className="font-serif text-lg leading-relaxed"
            dangerouslySetInnerHTML={{ __html: renderMath(note.key_insight) }} />
        </div>
      )}
    </div>
  );
}

// ── Main NoteView ─────────────────────────────────────────────────────────
export default function NoteView() {
  const { t } = useTranslation();
  const { activeTab } = useWorkspace();
  const [note, setNote] = useState<NoteResult | null>(null);
  const [error, setError] = useState('');
  const [savedNotes, setSavedNotes] = useState<SavedNote[]>([]);
  const [activeFolder, setActiveFolder] = useState<string>(''); // '' = all
  const [folders, setFolders] = useState<string[]>(() => listNoteFolders());
  const newFolderRef = useRef<HTMLInputElement>(null);

  // Materials the Coach selected for this workspace — no upload/topic-input
  // anymore, content only ever arrives pre-supplied by the admin-curated
  // catalog (see lib/coach.ts, lib/catalogMembership.ts).
  const [todayItems, setTodayItems] = useState<CatalogItem[]>([]);
  const [studiedItems, setStudiedItems] = useState<CatalogItem[]>([]);

  useEffect(() => { setSavedNotes(loadNotes(activeTab || undefined)); }, [activeTab]);

  useEffect(() => {
    const workspaceId = activeTab ? getWorkspaceId(activeTab) : null;
    if (!workspaceId) { setTodayItems([]); setStudiedItems([]); return; }
    setError('');
    fetchTodayMaterials(workspaceId)
      .then(r => {
        setTodayItems(r.today.filter(i => i.item_type === 'lesson'));
        setStudiedItems(r.studied.filter(i => i.item_type === 'lesson'));
      })
      .catch(e => setError(e.message || 'Could not load today\'s materials.'));
  }, [activeTab]);

  function refreshSaved() {
    setSavedNotes(loadNotes(activeTab || undefined));
    setFolders(listNoteFolders());
  }

  // Opens a Coach-selected lesson item — its admin-authored `content` is
  // already shaped like a NoteResult, so it renders through the exact same
  // reading/Feynman-chat UI a synthesized note used to.
  function openCatalogItem(item: CatalogItem) {
    const result = item.content as NoteResult;
    setNote(result);
    if (!savedNotes.some(n => n.id === `catalog_${item.id}`)) {
      saveNote({
        id: `catalog_${item.id}`, title: result.title || item.title, savedAt: Date.now(),
        sourceType: 'coach', note: result, subject: activeTab || undefined,
      });
      refreshSaved();
    }
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function openSavedNote(sn: SavedNote) {
    setNote(sn.note as NoteResult);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function handleCreateFolder() {
    const name = (newFolderRef.current?.value || '').trim();
    if (!name) return;
    if (!folders.includes(name)) setFolders([...folders, name].sort());
    setActiveFolder(name);
    if (newFolderRef.current) newFolderRef.current.value = '';
  }

  const visibleNotes = activeFolder
    ? savedNotes.filter(n => n.folder === activeFolder)
    : savedNotes;

  return (
    <div className={`flex-grow flex flex-col bg-surface min-h-screen ${note ? "px-4 py-4" : 'items-center py-12 px-4'}`}>
      {!note && (
        <div className="text-center mb-12 max-w-2xl">
          <h1 className="font-serif text-5xl text-on-surface mb-5 tracking-tight">{t('notes.pageTitle')}</h1>
          <p className="font-sans text-sm text-on-surface opacity-60 italic tracking-wide">
            {t('notes.quote')}
          </p>
        </div>
      )}

      {/* Today / Already Studied — materials the Coach selected from the
          admin-curated catalog for this workspace. No upload/topic-input:
          content only ever arrives pre-supplied. */}
      {!note && (
        <div className="w-full max-w-3xl mb-10 flex flex-col gap-6">
          {!activeTab || !getWorkspaceId(activeTab) ? (
            <p className="font-sans text-sm opacity-40 text-center py-6">
              Join a workspace to receive today's materials.
            </p>
          ) : (
            <>
              <div>
                <span className="font-sans text-[10px] uppercase tracking-[2px] opacity-50 block mb-3">Today</span>
                {todayItems.length === 0 ? (
                  <p className="font-sans text-sm opacity-40">Nothing new today yet — check back soon.</p>
                ) : (
                  <div className="flex flex-col gap-2">
                    {todayItems.map(item => (
                      <button key={item.id} onClick={() => openCatalogItem(item)}
                        className="text-left border border-outline/20 bg-surface-container-highest/20 px-5 py-4 hover:bg-surface-container-highest/40 transition-colors">
                        <span className="font-serif text-lg block">{item.title}</span>
                        <span className="font-sans text-[10px] uppercase tracking-[1.5px] opacity-40">{item.concept_name}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {studiedItems.length > 0 && (
                <div>
                  <span className="font-sans text-[10px] uppercase tracking-[2px] opacity-50 block mb-3">Already Studied</span>
                  <div className="flex flex-col gap-2">
                    {studiedItems.map(item => (
                      <button key={item.id} onClick={() => openCatalogItem(item)}
                        className="text-left border border-outline/10 px-5 py-3 opacity-70 hover:opacity-100 transition-opacity">
                        <span className="font-sans text-sm block">{item.title}</span>
                        <span className="font-sans text-[10px] uppercase tracking-[1.5px] opacity-40">{item.concept_name}</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* Error */}
      {!note && error && (
        <div className="w-full max-w-3xl mb-8">
          <p className="font-sans text-xs text-red-600 border border-red-200 bg-red-50 px-4 py-3 text-center">{error}</p>
        </div>
      )}
      {/* Output note — split pane */}
      {note && (
        <div className="w-full mb-16 flex flex-col gap-4">
          {/* Actions bar — notes auto-save, no manual step */}
          <div className="w-full flex items-center justify-between px-2">
            <button
              onClick={() => setNote(null)}
              className="flex items-center gap-1.5 font-sans text-[10px] uppercase tracking-[2px] opacity-40 hover:opacity-80 transition-opacity"
            >
              <span className="material-symbols-outlined text-[13px]">arrow_back</span>
              {t('notes.newNote2')}
            </button>
            <div className="flex items-center gap-2 font-sans text-[10px] uppercase tracking-[2px] text-emerald-600 opacity-80">
              <span className="material-symbols-outlined text-[15px]">check_circle</span>
              Auto-saved
            </div>
          </div>

          {/* Split pane */}
          <div className="w-full flex gap-0 border border-outline/10 shadow-sm overflow-hidden" style={{ height: 'calc(100vh - 120px)', minHeight: '600px' }}>
            {/* Left — Note content (scrollable) */}
            <div className="flex-1 overflow-y-auto" style={{ width: '55%' }}>
              <NoteCard note={note} />
            </div>

            {/* Right — AI Chat (sticky full height) */}
            <div className="shrink-0 flex flex-col" style={{ width: '45%' }}>
              <NoteChatPanel note={note} />
            </div>
          </div>
        </div>
      )}

      {/* Empty state hint */}
      {!note && !savedNotes.length && (
        <div className="w-full max-w-3xl opacity-40 text-center py-4">
          <p className="font-sans text-sm italic">{t('notes.uploadHint')}</p>
        </div>
      )}

      {/* ── Note Library — auto-saved, folder-organized ── */}
      {savedNotes.length > 0 && !note && (
        <div className="w-full max-w-3xl mb-16">
          <div className="flex items-center gap-3 mb-3">
            <span className="material-symbols-outlined text-[16px] opacity-40">folder_open</span>
            <span className="font-sans text-[10px] uppercase tracking-[2px] opacity-50">{t('notes.savedNotes')}</span>
          </div>

          {/* Folder chips + create */}
          <div className="flex flex-wrap items-center gap-2 mb-4">
            <button
              onClick={() => setActiveFolder('')}
              className={`px-3 py-1 font-sans text-[10px] uppercase tracking-[1.5px] border transition-colors ${
                activeFolder === '' ? 'border-on-surface bg-on-surface text-surface' : 'border-outline/25 opacity-60 hover:opacity-100'}`}
            >
              All
            </button>
            {folders.map(f => (
              <button
                key={f}
                onClick={() => setActiveFolder(f)}
                className={`px-3 py-1 font-sans text-[10px] uppercase tracking-[1.5px] border transition-colors ${
                  activeFolder === f ? 'border-on-surface bg-on-surface text-surface' : 'border-outline/25 opacity-60 hover:opacity-100'}`}
              >
                📁 {f}
              </button>
            ))}
            <div className="flex items-center gap-1 ml-1">
              <input
                ref={newFolderRef}
                placeholder="New folder…"
                onKeyDown={e => { if (e.key === 'Enter') handleCreateFolder(); }}
                className="bg-transparent border-b border-outline/30 px-1 py-0.5 font-sans text-[11px] outline-none w-28 focus:border-on-surface"
              />
              <button onClick={handleCreateFolder} className="opacity-40 hover:opacity-90">
                <span className="material-symbols-outlined text-[15px]">create_new_folder</span>
              </button>
            </div>
          </div>

          <div className="flex flex-col gap-2">
            {visibleNotes.length === 0 && (
              <p className="font-sans text-xs opacity-40 italic px-1">No notes in this folder yet.</p>
            )}
            {visibleNotes.map(sn => {
              const srcIcon = sn.sourceType === 'second-brain' ? '🧠' : sn.sourceType === 'pdf' ? '📄' : '🖼';
              return (
                <div key={sn.id} className="flex items-center justify-between border border-outline/15 px-5 py-3.5 hover:bg-surface-container-lowest transition-colors group">
                  <div className="min-w-0 flex items-start gap-3">
                    <span className="text-base flex-shrink-0 mt-0.5">{srcIcon}</span>
                    <div className="min-w-0">
                      <p className="font-sans text-sm text-on-surface truncate" title={sn.title}>
                        {shortTitle(sn.title)}
                      </p>
                      <p className="font-sans text-[9px] uppercase tracking-[1.5px] mt-0.5 opacity-30">
                        {sn.folder ? `📁 ${sn.folder} · ` : ''}{new Date(sn.savedAt).toLocaleDateString('en-US')}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0 ml-4">
                    <select
                      value={sn.folder || ''}
                      onChange={e => { setNoteFolder(sn.id, e.target.value); refreshSaved(); }}
                      className="border border-outline/20 bg-transparent px-1.5 py-1 font-sans text-[10px] outline-none opacity-50 hover:opacity-100 max-w-[110px]"
                      title="Move to folder"
                    >
                      <option value="">Unfiled</option>
                      {folders.map(f => <option key={f} value={f}>{f}</option>)}
                    </select>
                    <button
                      onClick={() => openSavedNote(sn)}
                      className="border border-amber-400/50 bg-amber-50 px-4 py-1.5 font-sans text-[9px] uppercase tracking-[1.5px] text-amber-700 hover:bg-amber-100 transition-colors flex items-center gap-1.5"
                    >
                      <span className="material-symbols-outlined text-[13px]">open_in_new</span>
                      {t('notes.review')}
                    </button>
                    <button
                      onClick={() => { deleteNote(sn.id); refreshSaved(); }}
                      className="opacity-0 group-hover:opacity-30 hover:!opacity-70 transition-opacity p-1"
                    >
                      <span className="material-symbols-outlined text-[14px]">delete</span>
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
