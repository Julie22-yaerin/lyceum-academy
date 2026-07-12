import { detectSubject, SUBJECT_META } from './persist';
import { recordProfileEvent } from './profile';

export interface MistakeEntry {
  id: string;
  mistake: string;
  location: string;
  subject: string;
  explanation: string;
  createdAt: number;
  /** Which concept this mistake belongs to, if known — feeds the personalization profile. */
  concept?: string;
  /** Set via ARI's [ATTACH: mistake | ...] tag after a Gemma research lookup. */
  attachedImage?: string;
  attachedSourceUrl?: string;
  attachedSourceLabel?: string;
}

const KEY = 'lyceum_mistakes_v1';

export function loadMistakes(): MistakeEntry[] {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export function saveMistake(entry: Omit<MistakeEntry, 'id' | 'createdAt' | 'subject'> & { subject?: string }): MistakeEntry {
  const all = loadMistakes();
  const subject = entry.subject || detectSubject(entry.mistake + ' ' + entry.location);
  const full: MistakeEntry = {
    ...entry,
    id: crypto.randomUUID(),
    subject,
    createdAt: Date.now(),
  };
  all.unshift(full);
  try {
    localStorage.setItem(KEY, JSON.stringify(all.slice(0, 200)));
  } catch {}
  // Every mistake is direct evidence of a knowledge gap — feed the shared
  // personalization profile so all AI features see it, not just this bank.
  recordProfileEvent(entry.concept || entry.mistake.slice(0, 60), subject, 'confusion');
  return full;
}

export function deleteMistake(id: string): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(loadMistakes().filter(m => m.id !== id)));
  } catch {}
}

export function clearMistakes(subjectFilter?: string): void {
  try {
    if (!subjectFilter) { localStorage.removeItem(KEY); return; }
    localStorage.setItem(KEY, JSON.stringify(loadMistakes().filter(m => m.subject !== subjectFilter)));
  } catch {}
}

export function getSubjectIcon(subject: string): string {
  return SUBJECT_META[subject]?.icon || '📝';
}

export function getSortedMistakes(subjectFilter?: string): MistakeEntry[] {
  const all = loadMistakes();
  const filtered = subjectFilter ? all.filter(m => m.subject === subjectFilter) : all;
  return filtered.sort((a, b) => b.createdAt - a.createdAt);
}

export function getAllSubjects(): string[] {
  const subjects = new Set(loadMistakes().map(m => m.subject));
  return Array.from(subjects).sort();
}

/**
 * Fuzzy-attaches an image/source link (from ARI's Gemma research) to the
 * most recent Mistake Bank entry whose text matches `matchText`. Returns
 * true if a match was found and updated.
 */
export function attachToMistake(matchText: string, patch: { imageUrl?: string; sourceUrl?: string; sourceLabel?: string }): boolean {
  const all = loadMistakes();
  const needle = matchText.trim().toLowerCase();
  if (!needle) return false;
  const match = all.find(m => m.mistake.toLowerCase().includes(needle) || needle.includes(m.mistake.toLowerCase()));
  if (!match) return false;
  const updated = all.map(m => m.id === match.id ? {
    ...m,
    attachedImage: patch.imageUrl ?? m.attachedImage,
    attachedSourceUrl: patch.sourceUrl ?? m.attachedSourceUrl,
    attachedSourceLabel: patch.sourceLabel ?? m.attachedSourceLabel,
  } : m);
  try { localStorage.setItem(KEY, JSON.stringify(updated)); return true; } catch { return false; }
}
