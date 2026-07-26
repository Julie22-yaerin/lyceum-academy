/**
 * MaterialUploadPanel — "Upload trước mỗi buổi" made concrete: three
 * categorized drop zones instead of one generic uploader, so the student
 * sorts material on the way in rather than the AI guessing what a file is
 * for. Each zone auto-saves into the real place that category belongs —
 * the AI's own generated title/summary (it already reads the whole file to
 * produce one) doubles as "skimming to know the topic," so no separate
 * classification step is needed on top of what synthesis already does:
 *
 *   Note              -> POST /ai/note-upload -> saveNote() (Notes list)
 *   Practice problems -> POST /ai/upload-pset -> savePSet() (Problem Sets list)
 *   Others            -> vocabulary lists, answer sheets, anything that
 *                         isn't a lecture note or a problem set. There is
 *                         no dedicated backend pipeline for this category —
 *                         it reuses note synthesis (the closest fit) rather
 *                         than pretending a bespoke analyzer exists, and
 *                         lands in Notes tagged sourceType 'other' so it's
 *                         visually distinct from real lecture notes. The
 *                         free-text label becomes part of the saved title.
 *
 * This does NOT touch the student's Second Brain (backend) — it's local
 * persistence only (localStorage, same as the rest of Notes/Problem Sets),
 * still free and still per-device, just no longer thrown away when the
 * panel closes.
 */
import { useRef, useState, type DragEvent } from 'react';
import { synthesizeNoteFromFile, uploadProblemSet, type NoteResult } from '../../lib/api';
import { saveNote, savePSet } from '../../lib/persist';
import { useWorkspace } from '../../context/WorkspaceContext';

type Category = 'note' | 'practice' | 'others';

type ZoneResult =
  | { kind: 'note'; data: NoteResult }
  | { kind: 'pset'; data: { summary: string; problems: unknown[] } }
  | { kind: 'error'; message: string };

const ZONES: { id: Category; icon: string; title: string; hint: string }[] = [
  { id: 'note', icon: 'description', title: 'Note', hint: 'Bài giảng, slide, tài liệu lý thuyết' },
  { id: 'practice', icon: 'assignment', title: 'Practice problems', hint: 'Đề bài tập, past paper' },
  { id: 'others', icon: 'folder_open', title: 'Others', hint: 'Từ vựng, đáp án, phụ trợ khác' },
];

function DropZone({ id, icon, title, hint, busy, result, othersLabel, onOthersLabelChange, onFile }: {
  id: Category; icon: string; title: string; hint: string;
  busy: boolean; result: ZoneResult | undefined;
  othersLabel: string; onOthersLabelChange: (v: string) => void;
  onFile: (file: File) => void;
}) {
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  function handleDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file) onFile(file);
  }

  return (
    <div className="flex-1 min-w-[200px] flex flex-col gap-2">
      <div
        onDragOver={e => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={handleDrop}
        onClick={() => inputRef.current?.click()}
        className={`flex-1 min-h-[140px] rounded-2xl border-2 border-dashed flex flex-col items-center justify-center gap-2 p-4 cursor-pointer transition-colors ${
          dragOver ? 'border-purple-300 bg-purple-400/10' : 'border-white/15 hover:border-white/30 bg-white/[0.02]'
        }`}
      >
        <input ref={inputRef} type="file" className="hidden" onChange={e => { const f = e.target.files?.[0]; if (f) onFile(f); }} />
        <span className="material-symbols-outlined text-[26px] text-white/50">{icon}</span>
        <p className="text-xs text-white/80 font-medium">{title}</p>
        <p className="text-[10px] text-white/35 text-center leading-relaxed">{hint}</p>
        {busy && <p className="text-[10px] text-purple-300 animate-pulse">Đang xử lý…</p>}
      </div>

      {id === 'others' && (
        <input
          value={othersLabel} onChange={e => onOthersLabelChange(e.target.value)}
          placeholder="Ghi chú loại tài liệu (vd: Từ vựng chương 3)…"
          className="w-full bg-white/5 rounded-lg px-2.5 py-1.5 text-[11px] text-white/75 outline-none border border-white/10 focus:border-white/25"
        />
      )}

      {result?.kind === 'error' && <p className="text-[11px] text-red-300/80">{result.message}</p>}
      {result?.kind === 'note' && (
        <div className="rounded-xl bg-white/[0.03] p-3 flex flex-col gap-1">
          <p className="text-[11px] text-emerald-300">✓ Đã lưu vào Notes</p>
          <p className="text-xs text-white/80 font-medium">{result.data.title}</p>
          <p className="text-[11px] text-white/50 line-clamp-3">{result.data.tldr || result.data.summary}</p>
        </div>
      )}
      {result?.kind === 'pset' && (
        <div className="rounded-xl bg-white/[0.03] p-3 flex flex-col gap-1">
          <p className="text-[11px] text-emerald-300">✓ Đã lưu vào Problem Sets</p>
          <p className="text-[11px] text-white/60">{result.data.problems.length} bài tập tìm thấy</p>
        </div>
      )}
    </div>
  );
}

export default function MaterialUploadPanel() {
  const { activeTab } = useWorkspace();
  const [busy, setBusy] = useState<Category | null>(null);
  const [results, setResults] = useState<Partial<Record<Category, ZoneResult>>>({});
  const [othersLabel, setOthersLabel] = useState('');

  async function handleFile(category: Category, file: File) {
    setBusy(category);
    setResults(r => ({ ...r, [category]: undefined }));
    try {
      if (category === 'practice') {
        const data = await uploadProblemSet(file);
        savePSet({
          id: `upload-${Date.now()}`,
          name: data.summary?.slice(0, 80) || file.name,
          savedAt: Date.now(),
          questions: data.questions,
          currentIdx: 0,
          lensMode: data.lensMode,
          totalPages: data.totalPages,
          subject: activeTab || undefined,
        });
        setResults(r => ({ ...r, practice: { kind: 'pset', data } }));
      } else {
        // 'note' and 'others' share the same synthesis pipeline — see the
        // file header for why 'others' has no dedicated analyzer yet.
        const data = await synthesizeNoteFromFile(file);
        const title = category === 'others' && othersLabel.trim()
          ? `${othersLabel.trim()} — ${data.title}`
          : data.title;
        saveNote({
          id: `upload-${category}-${Date.now()}`,
          title,
          savedAt: Date.now(),
          sourceType: category === 'others' ? 'other' : (data.source_type || 'upload'),
          note: data,
          subject: activeTab || undefined,
        });
        setResults(r => ({ ...r, [category]: { kind: 'note', data: { ...data, title } } }));
      }
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Không xử lý được file này.';
      setResults(r => ({ ...r, [category]: { kind: 'error', message } }));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="p-4 flex flex-col gap-3">
      <p className="text-[11px] text-white/50 leading-relaxed">
        Thả tài liệu vào đúng ô — AI đọc lướt để lấy tên chủ đề rồi tự lưu vào đúng chỗ
        (Note/Others → Notes, Practice problems → Problem Sets), miễn phí mỗi lần.
      </p>
      <div className="flex flex-col sm:flex-row gap-3">
        {ZONES.map(z => (
          <DropZone
            key={z.id} id={z.id} icon={z.icon} title={z.title} hint={z.hint}
            busy={busy === z.id} result={results[z.id]}
            othersLabel={othersLabel} onOthersLabelChange={setOthersLabel}
            onFile={file => handleFile(z.id, file)}
          />
        ))}
      </div>
    </div>
  );
}
