// ── Subject workspace tabs — which subjects a student has "open" (like
// Chrome tabs), and which one is active right now. Everything downstream
// (Dialogue, Notes, Problem Sets, Mistake Bank, Knowledge Map, Progress,
// Reference Bank) filters/tags its data by the active tab's subject key.
import { scopedGateKey, detectSubject, loadPSets, loadNotes, loadGraphs, SUBJECT_META } from './persist';
import { loadProgress } from './progress';

const OPEN_TABS_KEY = 'lyceum_open_subject_tabs';
const ACTIVE_TAB_KEY = 'lyceum_active_subject_tab';
const MIGRATION_DONE_KEY = 'lyceum_subject_migration_done';

export function loadOpenTabs(): string[] {
  try {
    const raw = localStorage.getItem(scopedGateKey(OPEN_TABS_KEY));
    const list = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? list.filter((k: string) => SUBJECT_META[k]) : [];
  } catch { return []; }
}

export function saveOpenTabs(keys: string[]): void {
  try {
    const deduped = Array.from(new Set(keys.filter(k => SUBJECT_META[k])));
    localStorage.setItem(scopedGateKey(OPEN_TABS_KEY), JSON.stringify(deduped));
  } catch { /* quota */ }
}

export function loadActiveTab(): string | null {
  try {
    const key = localStorage.getItem(scopedGateKey(ACTIVE_TAB_KEY));
    return key && SUBJECT_META[key] ? key : null;
  } catch { return null; }
}

export function saveActiveTab(key: string): void {
  try { localStorage.setItem(scopedGateKey(ACTIVE_TAB_KEY), key); } catch { /* quota */ }
}

/**
 * One-time backfill for data saved before workspace tabs existed. Runs at
 * most once per account (gated) — never deletes anything, only fills in a
 * missing subject/category field so nothing silently disappears once views
 * start filtering by the active tab. Mistakes/References already carry a
 * subject/category from detectSubject at save time, so they're untouched.
 */
export function migrateLegacySubjectTags(): void {
  try {
    if (localStorage.getItem(scopedGateKey(MIGRATION_DONE_KEY))) return;

    const psets = loadPSets();
    psets.forEach((p: any) => {
      if (!p.subject) {
        const text = p.name || (p.questions || []).map((q: any) => q.prompt).join(' ');
        p.subject = detectSubject(text || '');
      }
    });
    if (psets.length) localStorage.setItem('lyceum_psets_v2', JSON.stringify(psets));

    const notes = loadNotes();
    notes.forEach((n: any) => {
      if (!n.subject) n.subject = detectSubject(n.title || n.note?.title || n.note?.tldr || '');
    });
    if (notes.length) localStorage.setItem('lyceum_notes_v1', JSON.stringify(notes));

    const graphs = loadGraphs();
    graphs.forEach((g: any) => {
      if (!g.subject) g.subject = detectSubject(g.topic || '');
    });
    if (graphs.length) localStorage.setItem('lyceum_graphs_v1', JSON.stringify(graphs));

    const progress = loadProgress();
    progress.forEach((r: any) => {
      if (!r.subject) r.subject = detectSubject(r.filename || '');
    });
    if (progress.length) localStorage.setItem('lyceum_progress', JSON.stringify(progress));

    // Mistakes/References already have subject/category via detectSubject
    // at save time — nothing to backfill for those.

    localStorage.setItem(scopedGateKey(MIGRATION_DONE_KEY), '1');
  } catch { /* best-effort, never blocks app load */ }
}
