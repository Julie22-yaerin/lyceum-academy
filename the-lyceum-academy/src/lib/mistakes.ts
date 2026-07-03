import { detectSubject, SUBJECT_META } from './persist';

export interface MistakeEntry {
  id: string;
  mistake: string;
  location: string;
  subject: string;
  explanation: string;
  createdAt: number;
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

export function saveMistake(entry: Omit<MistakeEntry, 'id' | 'createdAt' | 'subject'>): MistakeEntry {
  const all = loadMistakes();
  const subject = detectSubject(entry.mistake + ' ' + entry.location);
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
  return full;
}

export function deleteMistake(id: string): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(loadMistakes().filter(m => m.id !== id)));
  } catch {}
}

export function clearMistakes(): void {
  try {
    localStorage.removeItem(KEY);
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
