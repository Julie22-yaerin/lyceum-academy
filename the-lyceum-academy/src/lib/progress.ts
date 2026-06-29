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
}

const KEY = 'lyceum_progress';

export function loadProgress(): GradeRecord[] {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

export function saveGradeSession(record: GradeRecord) {
  const all = loadProgress();
  all.push(record);
  const trimmed = all.slice(-100); // keep last 100 sessions
  try { localStorage.setItem(KEY, JSON.stringify(trimmed)); } catch {}
}

export function clearProgress() {
  localStorage.removeItem(KEY);
}
