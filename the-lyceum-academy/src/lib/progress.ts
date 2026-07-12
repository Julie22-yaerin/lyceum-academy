export interface GradeRecord {
  sessionId: string;
  date: number;
  filename: string;
  grades: {
    questionId: string;
    passed: boolean;
    concepts: string[];
    difficulty: string;
  }[];
  /** SUBJECT_META key — the workspace tab active when this session was graded. */
  subject?: string;
}

const KEY = 'lyceum_progress';

export function loadProgress(subjectFilter?: string): GradeRecord[] {
  try {
    const raw = localStorage.getItem(KEY);
    const all: GradeRecord[] = raw ? JSON.parse(raw) : [];
    return subjectFilter ? all.filter(r => r.subject === subjectFilter) : all;
  } catch { return []; }
}

export function saveGradeSession(record: GradeRecord) {
  const all = loadProgress();
  all.push(record);
  const trimmed = all.slice(-100); // keep last 100 sessions
  try { localStorage.setItem(KEY, JSON.stringify(trimmed)); } catch {}
}

export function clearProgress(subjectFilter?: string) {
  if (!subjectFilter) { localStorage.removeItem(KEY); return; }
  try {
    const remaining = loadProgress().filter(r => r.subject !== subjectFilter);
    localStorage.setItem(KEY, JSON.stringify(remaining));
  } catch {}
}
