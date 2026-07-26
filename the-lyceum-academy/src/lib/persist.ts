// ── Lightweight localStorage persistence for ProblemSets & Graphs ──────────
import { auth } from './firebase';

/**
 * Namespaces a one-time-gate localStorage key (terms/onboarding/tour/login-count)
 * by the signed-in Firebase UID. Without this, a second account signing in on
 * the same browser inherits the first account's "already onboarded" flags —
 * the gates would never re-trigger for a genuinely new user.
 */
export function scopedGateKey(base: string): string {
  const uid = auth.currentUser?.uid;
  return uid ? `${base}:${uid}` : base;
}

const PSET_TTL = 24 * 60 * 60 * 1000; // 24 hours

export interface SavedPSet {
  id: string;
  name: string;
  savedAt: number;
  expiresAt: number;   // savedAt + 24h
  questions: any[];
  currentIdx: number;
  lensMode?: boolean;
  totalPages?: number;
  // pages are stored in IndexedDB (too large for localStorage)
  hasCachedPages?: boolean;
  /** SUBJECT_META key — the workspace tab active when this set was saved. */
  subject?: string;
  /** User-created folder name, mirrors SavedNote.folder — '' = unfiled. */
  folder?: string;
}

export interface SavedGraph {
  id: string;
  topic: string;
  savedAt: number;
  nodes: any[];
  edges: any[];
  /** SUBJECT_META key — the workspace tab active when this graph was saved. */
  subject?: string;
}

const PSETS_KEY  = 'lyceum_psets_v2';
const GRAPHS_KEY = 'lyceum_graphs_v1';
const IDB_NAME   = 'lyceum_pset_pages';
const IDB_STORE  = 'pages';

function parse<T>(key: string): T[] {
  try { return JSON.parse(localStorage.getItem(key) || '[]'); }
  catch { return []; }
}

// ── IndexedDB helpers for PDF pages ──────────────────────────────────────

function openIDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(IDB_STORE)) db.createObjectStore(IDB_STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror   = () => reject(req.error);
  });
}

export async function savePages(psetId: string, pages: any[]): Promise<void> {
  try {
    const db = await openIDB();
    const tx = db.transaction(IDB_STORE, 'readwrite');
    tx.objectStore(IDB_STORE).put({ pages, savedAt: Date.now() }, psetId);
    await new Promise<void>((res, rej) => { tx.oncomplete = () => res(); tx.onerror = () => rej(tx.error); });
    db.close();
  } catch { /* IndexedDB not available — silent fail */ }
}

export async function loadPages(psetId: string): Promise<any[] | null> {
  try {
    const db = await openIDB();
    const tx = db.transaction(IDB_STORE, 'readonly');
    const req = tx.objectStore(IDB_STORE).get(psetId);
    const result = await new Promise<any>((res, rej) => { req.onsuccess = () => res(req.result); req.onerror = () => rej(req.error); });
    db.close();
    if (!result) return null;
    // Expire after 24h
    if (Date.now() - result.savedAt > PSET_TTL) { deletePages(psetId); return null; }
    return result.pages;
  } catch { return null; }
}

export async function deletePages(psetId: string): Promise<void> {
  try {
    const db = await openIDB();
    const tx = db.transaction(IDB_STORE, 'readwrite');
    tx.objectStore(IDB_STORE).delete(psetId);
    await new Promise<void>((res) => { tx.oncomplete = () => res(); tx.onerror = () => res(); });
    db.close();
  } catch {}
}

// ── Problem Sets ─────────────────────────────────────────────────────────
export function loadPSets(subjectFilter?: string): SavedPSet[] {
  const all = parse<SavedPSet>(PSETS_KEY);
  // Auto-purge expired
  const live = all.filter(p => p.expiresAt > Date.now());
  if (live.length !== all.length) {
    const expired = all.filter(p => p.expiresAt <= Date.now());
    expired.forEach(p => deletePages(p.id));
    try { localStorage.setItem(PSETS_KEY, JSON.stringify(live)); } catch {}
  }
  const filtered = subjectFilter ? live.filter(p => p.subject === subjectFilter) : live;
  return filtered.sort((a, b) => b.savedAt - a.savedAt);
}

export function savePSet(pset: Omit<SavedPSet, 'expiresAt'> & { expiresAt?: number }): void {
  const full: SavedPSet = { ...pset, expiresAt: pset.expiresAt ?? (Date.now() + PSET_TTL) };
  const list = loadPSets().filter(p => p.id !== full.id);
  list.unshift(full);
  try { localStorage.setItem(PSETS_KEY, JSON.stringify(list.slice(0, 20))); } catch { /* quota exceeded */ }
}

export function deletePSet(id: string): void {
  deletePages(id);
  try { localStorage.setItem(PSETS_KEY, JSON.stringify(loadPSets().filter(p => p.id !== id))); } catch {}
}

/** Move a saved problem set into a folder ('' = unfiled) — mirrors setNoteFolder. */
export function setPSetFolder(id: string, folder: string): void {
  const all = loadPSets();
  const target = all.find(p => p.id === id);
  if (!target) return;
  savePSet({ ...target, folder });
}

/** Distinct folder names across saved problem sets. */
export function listPSetFolders(): string[] {
  const set = new Set<string>();
  loadPSets().forEach(p => { if (p.folder) set.add(p.folder); });
  return [...set].sort();
}

// ── Exercise Cards (24h TTL) ────────────────────────────────────────────────
const EXERCISE_TTL = 24 * 60 * 60 * 1000;
const EXERCISES_KEY = 'lyceum_exercises_v1';

export interface SavedExerciseSession {
  id: string;
  subject: string;
  topic: string;
  savedAt: number;
  expiresAt: number;
  cards: any[];
  currentIdx: number;
  grades: Record<string, { passed: boolean; feedback: string }>;
  rescuesUsed: number;
  rescuedCards: any[];
}

export function loadExerciseSessions(subjectFilter?: string): SavedExerciseSession[] {
  const all = parse<SavedExerciseSession>(EXERCISES_KEY);
  const live = all.filter(e => e.expiresAt > Date.now());
  if (live.length !== all.length) {
    try { localStorage.setItem(EXERCISES_KEY, JSON.stringify(live)); } catch {}
  }
  return subjectFilter ? live.filter(e => e.subject === subjectFilter) : live;
}

export function saveExerciseSession(session: Omit<SavedExerciseSession, 'expiresAt'> & { expiresAt?: number }): void {
  const full: SavedExerciseSession = { ...session, expiresAt: session.expiresAt ?? (Date.now() + EXERCISE_TTL) };
  const list = loadExerciseSessions().filter(e => e.id !== full.id);
  list.unshift(full);
  try { localStorage.setItem(EXERCISES_KEY, JSON.stringify(list.slice(0, 10))); } catch {}
}

export function deleteExerciseSession(id: string): void {
  try { localStorage.setItem(EXERCISES_KEY, JSON.stringify(loadExerciseSessions().filter(e => e.id !== id))); } catch {}
}

// ── Saved Notes (auto-saved, kept until the student deletes them) ─────────
// Notes used to expire after 24h; they're now a permanent, folder-organized
// personal library (auto-saved on generation, no manual save step).
const NOTE_KEEP_MS = 100 * 365 * 24 * 60 * 60 * 1000; // effectively forever
const NOTES_KEY  = 'lyceum_notes_v1';

export interface SavedNote {
  id: string;
  title: string;
  savedAt: number;
  expiresAt: number;
  sourceType: string;   // 'pdf' | 'image' | 'youtube' | 'text' | 'second-brain'
  note: any;            // full NoteResult object
  /** SUBJECT_META key — the workspace tab active when this note was saved. */
  subject?: string;
  /** User-created folder name ('' = unfiled). */
  folder?: string;
}

export function loadNotes(subjectFilter?: string): SavedNote[] {
  const all = parse<SavedNote>(NOTES_KEY);
  const live = all.filter(n => n.expiresAt > Date.now());
  if (live.length !== all.length) {
    try { localStorage.setItem(NOTES_KEY, JSON.stringify(live)); } catch {}
  }
  const filtered = subjectFilter ? live.filter(n => n.subject === subjectFilter) : live;
  // Explicit sort (not just insertion order) — moving a note into a folder
  // re-persists it without touching savedAt, and relying on array order to
  // stay "recent first" breaks the moment any code touches the list.
  return filtered.sort((a, b) => b.savedAt - a.savedAt);
}

export function saveNote(note: Omit<SavedNote, 'expiresAt'> & { expiresAt?: number }): void {
  const full: SavedNote = { ...note, expiresAt: note.expiresAt ?? (Date.now() + NOTE_KEEP_MS) };
  const isNew = !loadNotes().some(n => n.id === full.id);
  const list = loadNotes().filter(n => n.id !== full.id);
  list.unshift(full);
  // Learning a new note schedules its 3-7-21 spaced-repetition checkpoints.
  if (isNew) {
    const seed = full.note?.tldr || full.note?.summary
      || (full.note?.key_concepts || []).map((k: any) => `${k.concept}: ${k.definition || ''}`).join('\n')
      || full.title;
    void import('./reviewReminders').then(({ registerLearned }) =>
      registerLearned(full.id, full.title, full.subject || 'general', String(seed || full.title))
    ).catch(() => { /* non-critical */ });
  }
  // Keep max 40 notes; drop full note bodies from the oldest if quota hits
  try { localStorage.setItem(NOTES_KEY, JSON.stringify(list.slice(0, 40))); } catch {
    try {
      const slim = list.slice(0, 12).map((n, i) => i < 6 ? n : { ...n, note: { title: n.note?.title, tldr: n.note?.tldr } });
      localStorage.setItem(NOTES_KEY, JSON.stringify(slim));
    } catch { /* give up */ }
  }
}

/** Move a saved note into a folder ('' = unfiled). */
export function setNoteFolder(id: string, folder: string): void {
  const all = loadNotes();
  const target = all.find(n => n.id === id);
  if (!target) return;
  saveNote({ ...target, folder });
}

/** Compact display title for workspace listings (Notes, Problem Sets) — the
 * full title is always still available via a `title=` tooltip attribute at
 * the call site, this only shortens what's shown inline in a crowded list. */
export function shortTitle(title: string, max = 10): string {
  const clean = title.replace(/[\u{1F300}-\u{1FAFF}]/gu, '').trim() || title;
  return clean.length > max ? clean.slice(0, max) + '…' : clean;
}

/** Distinct folder names across saved notes (per current account/browser). */
export function listNoteFolders(): string[] {
  const set = new Set<string>();
  loadNotes().forEach(n => { if (n.folder) set.add(n.folder); });
  return [...set].sort();
}

export function deleteNote(id: string): void {
  try { localStorage.setItem(NOTES_KEY, JSON.stringify(loadNotes().filter(n => n.id !== id))); } catch {}
}

/**
 * Fuzzy-attaches an image/source link (from ARI's Gemma research) to the
 * most recent saved note whose title matches `matchTitle`. Returns true if
 * a match was found and updated.
 */
export function attachToNote(matchTitle: string, patch: { imageUrl?: string; sourceUrl?: string; sourceLabel?: string }): boolean {
  const all = loadNotes();
  const needle = matchTitle.trim().toLowerCase();
  if (!needle) return false;
  const match = all.find(n => n.title.toLowerCase().includes(needle) || needle.includes(n.title.toLowerCase()));
  if (!match) return false;
  const updated: SavedNote = {
    ...match,
    note: {
      ...match.note,
      attachedImage: patch.imageUrl ?? match.note?.attachedImage,
      attachedSourceUrl: patch.sourceUrl ?? match.note?.attachedSourceUrl,
      attachedSourceLabel: patch.sourceLabel ?? match.note?.attachedSourceLabel,
    },
  };
  saveNote(updated);
  return true;
}

export function timeRemaining(expiresAt: number): string {
  const ms = expiresAt - Date.now();
  if (ms <= 0) return 'expired';
  const h = Math.floor(ms / 3600000);
  const m = Math.ceil((ms % 3600000) / 60000);
  return h >= 1 ? `${h}h left` : `${m}m left`;
}

// ── Graphs ────────────────────────────────────────────────────────────────
export function loadGraphs(subjectFilter?: string): SavedGraph[] {
  const all = parse<SavedGraph>(GRAPHS_KEY);
  return subjectFilter ? all.filter(g => g.subject === subjectFilter) : all;
}

export function saveGraph(g: SavedGraph): void {
  const list = loadGraphs().filter(x => x.id !== g.id);
  list.unshift(g);
  try { localStorage.setItem(GRAPHS_KEY, JSON.stringify(list.slice(0, 30))); } catch {}
}

export function deleteGraph(id: string): void {
  try { localStorage.setItem(GRAPHS_KEY, JSON.stringify(loadGraphs().filter(g => g.id !== id))); } catch {}
}

/**
 * Fuzzy-attaches an image/source link (from ARI's Gemma research) to a node
 * (by label) in the most recently saved graph that contains it. Returns
 * true if a match was found and updated.
 */
export function attachToGraphNode(matchLabel: string, patch: { imageUrl?: string; sourceUrl?: string; sourceLabel?: string }): boolean {
  const graphs = loadGraphs();
  const needle = matchLabel.trim().toLowerCase();
  if (!needle) return false;
  for (const g of graphs) {
    const node = (g.nodes || []).find((n: any) => (n.label || '').toLowerCase().includes(needle) || needle.includes((n.label || '').toLowerCase()));
    if (node) {
      node.image_url = patch.imageUrl ?? node.image_url;
      node.source_url = patch.sourceUrl ?? node.source_url;
      node.source_label = patch.sourceLabel ?? node.source_label;
      saveGraph(g);
      return true;
    }
  }
  return false;
}

// ── Subject detection ─────────────────────────────────────────────────────

export const SUBJECT_META: Record<string, { icon: string; label: string }> = {
  math:       { icon: '📐', label: 'Math' },
  physics:    { icon: '⚡', label: 'Physics' },
  chemistry:  { icon: '🧪', label: 'Chemistry' },
  biology:    { icon: '🧬', label: 'Biology' },
  cs:         { icon: '💻', label: 'Programming' },
  history:    { icon: '📜', label: 'History' },
  literature: { icon: '📖', label: 'Literature' },
  economics:  { icon: '📈', label: 'Economics' },
  philosophy: { icon: '🤔', label: 'Philosophy' },
  english:    { icon: '🗣', label: 'English' },
  other:      { icon: '📝', label: 'Other' },
};

const SUBJECT_KEYWORDS: Record<string, string[]> = {
  math:       ['math', 'toán', 'calculus', 'algebra', 'geometry', 'statistics', 'xác suất', 'vi tích phân', 'đại số', 'hình học', 'số học'],
  physics:    ['physics', 'vật lý', 'mechanics', 'electro', 'thermodynamics', 'quantum', 'lực', 'điện', 'nhiệt', 'quang'],
  chemistry:  ['chemistry', 'hoá', 'chemical', 'molecule', 'reaction', 'acid', 'base', 'nguyên tử', 'phân tử'],
  biology:    ['biology', 'sinh', 'cell', 'dna', 'gene', 'organism', 'tế bào', 'sinh vật', 'di truyền'],
  cs:         ['programming', 'lập trình', 'algorithm', 'code', 'software', 'database', 'network', 'javascript', 'python', 'java', 'c++', 'typescript', 'react'],
  history:    ['history', 'lịch sử', 'war', 'revolution', 'dynasty', 'empire', 'chiến tranh', 'triều đại'],
  literature: ['literature', 'văn', 'poem', 'novel', 'essay', 'grammar', 'thơ', 'truyện', 'ngữ pháp'],
  economics:  ['economics', 'kinh tế', 'market', 'supply', 'demand', 'gdp', 'finance', 'tài chính', 'thị trường'],
  philosophy: ['philosophy', 'triết', 'ethics', 'logic', 'metaphysics', 'đạo đức', 'tư duy'],
  english:    ['english', 'tiếng anh', 'vocabulary', 'toeic', 'ielts', 'toefl', 'pronunciation', 'grammar'],
};

export function detectSubject(text: string): string {
  const lower = text.toLowerCase();
  for (const [subject, keywords] of Object.entries(SUBJECT_KEYWORDS)) {
    if (keywords.some(kw => lower.includes(kw))) return subject;
  }
  return 'other';
}

// ── Today's study subject (asked once per day in the daily time prompt) ───
const TODAY_SUBJECT_KEY = 'lyceum_today_subject';
const TODAY_SUBJECT_DATE_KEY = 'lyceum_today_subject_date';

export function loadTodayStudySubject(): string | null {
  try {
    if (localStorage.getItem(TODAY_SUBJECT_DATE_KEY) !== new Date().toDateString()) return null;
    return localStorage.getItem(TODAY_SUBJECT_KEY);
  } catch { return null; }
}

export function saveTodayStudySubject(subject: string) {
  try {
    localStorage.setItem(TODAY_SUBJECT_KEY, subject);
    localStorage.setItem(TODAY_SUBJECT_DATE_KEY, new Date().toDateString());
  } catch { /* quota */ }
}

// ── Onboarding answers — persisted (previously only sent once to the
// pricing-plan analyzer, then discarded) so features like the DeepSeek
// roadmap generator can read the student's stated learning-style
// preference (q7) and study intensity (q1/q3) later, not just at signup.
const ONBOARDING_ANSWERS_KEY = 'lyceum_onboarding_answers';

export function saveOnboardingAnswers(answers: Record<string, string | string[]>): void {
  try { localStorage.setItem(ONBOARDING_ANSWERS_KEY, JSON.stringify(answers)); } catch { /* quota */ }
}

export function loadOnboardingAnswers(): Record<string, string | string[]> {
  try { return JSON.parse(localStorage.getItem(ONBOARDING_ANSWERS_KEY) || '{}'); } catch { return {}; }
}

// ── Learning style sliders (10 values 0-100) ────────────────────────────
const LEARNING_STYLE_KEY = 'lyceum_learning_style';

export function saveLearningStyle(style: Record<string, number>): void {
  try { localStorage.setItem(LEARNING_STYLE_KEY, JSON.stringify(style)); } catch { /* quota */ }
}

export function loadLearningStyle(): Record<string, number> | null {
  try {
    const raw = localStorage.getItem(LEARNING_STYLE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

// ── Selected personas (up to 3 persona IDs, in user-chosen order) ───────
const SELECTED_PERSONAS_KEY = 'lyceum_selected_personas';

export function saveSelectedPersonas(personaIds: string[]): void {
  try { localStorage.setItem(SELECTED_PERSONAS_KEY, JSON.stringify(personaIds.slice(0, 3))); } catch { /* quota */ }
}

export function loadSelectedPersonas(): string[] {
  try { return JSON.parse(localStorage.getItem(SELECTED_PERSONAS_KEY) || '[]'); } catch { return []; }
}

// ── Reference Bank (Gemma research results, auto-categorized by subject) ──
const REFERENCES_KEY = 'lyceum_reference_bank_v1';

export interface ReferenceEntry {
  id: string;
  topic: string;
  category: string;      // SUBJECT_META key, via detectSubject(topic)
  summary: string;
  imageUrl?: string;      // kept for backward compat — first of imageUrls
  imageUrls?: string[];   // up to 3 images (Google Knowledge Graph + Wikipedia)
  sourceUrl?: string;     // real citable reference (Wikipedia/KG entity page)
  savedAt: number;
}

export function loadReferences(categoryFilter?: string): ReferenceEntry[] {
  const all = parse<ReferenceEntry>(REFERENCES_KEY);
  return categoryFilter ? all.filter(r => r.category === categoryFilter) : all;
}

export function saveReference(entry: Omit<ReferenceEntry, 'id' | 'category' | 'savedAt'> & { category?: string }): void {
  const list = loadReferences();
  const full: ReferenceEntry = {
    ...entry,
    id: `ref-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    category: entry.category || detectSubject(entry.topic),
    savedAt: Date.now(),
  };
  list.unshift(full);
  try { localStorage.setItem(REFERENCES_KEY, JSON.stringify(list.slice(0, 200))); } catch { /* quota exceeded */ }
}

export function deleteReference(id: string): void {
  try { localStorage.setItem(REFERENCES_KEY, JSON.stringify(loadReferences().filter(r => r.id !== id))); } catch {}
}

// ── Helpers ───────────────────────────────────────────────────────────────
export function timeAgo(ts: number): string {
  const diff = Date.now() - ts;
  const min = Math.floor(diff / 60000);
  if (min < 1)  return 'just now';
  if (min < 60) return `${min}m ago`;
  const h = Math.floor(min / 60);
  if (h < 24)   return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}
