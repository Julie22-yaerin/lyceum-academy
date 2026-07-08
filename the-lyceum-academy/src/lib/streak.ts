// ── Daily streak tracking ────────────────────────────────────────────────
// Enabled once the student sets a goal date at the end of onboarding
// (SOC-7 follow-up). Every calendar day they open the workspace counts as
// one streak; the icon is a glass pawn day-to-day, and turns into a glass
// king for good on the day the streak reaches the goal date.

const STREAK_KEY = 'lyceum_streak_v1';

export interface StreakState {
  goalDate: string;       // 'YYYY-MM-DD'
  goalLabel: string;      // free-text note, e.g. "Giữa kỳ Giải tích"
  streakCount: number;
  longestStreak: number;
  lastVisitDate: string | null; // 'YYYY-MM-DD'
  goalAchieved: boolean;  // true once a visit lands on/after goalDate with an unbroken streak
}

function toDateStr(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function dayBefore(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() - 1);
  return toDateStr(d);
}

function load(): StreakState | null {
  try {
    const raw = localStorage.getItem(STREAK_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

function save(state: StreakState): void {
  try { localStorage.setItem(STREAK_KEY, JSON.stringify(state)); } catch { /* quota */ }
}

/** Called once at the end of onboarding, when the student picks a goal date. */
export function startStreakGoal(goalDate: string, goalLabel: string): StreakState {
  const state: StreakState = {
    goalDate, goalLabel,
    streakCount: 0,
    longestStreak: 0,
    lastVisitDate: null,
    goalAchieved: false,
  };
  save(state);
  return recordDailyVisit() as StreakState;
}

export function hasStreakGoal(): boolean {
  return load() !== null;
}

export function getStreakState(): StreakState | null {
  return load();
}

/**
 * Call once per day the workspace is opened. No-ops if no goal has been
 * set yet, or if today was already recorded. Returns the updated state
 * (or null if streak isn't enabled).
 */
export function recordDailyVisit(): StreakState | null {
  const state = load();
  if (!state) return null;

  const today = toDateStr(new Date());
  if (state.lastVisitDate === today) return state;

  state.streakCount = state.lastVisitDate === dayBefore(today) ? state.streakCount + 1 : 1;
  state.lastVisitDate = today;
  state.longestStreak = Math.max(state.longestStreak, state.streakCount);
  if (!state.goalAchieved && today >= state.goalDate) state.goalAchieved = true;

  save(state);
  return state;
}

export function daysUntilGoal(state: StreakState): number {
  const today = new Date(toDateStr(new Date()) + 'T00:00:00Z');
  const goal = new Date(state.goalDate + 'T00:00:00Z');
  return Math.round((goal.getTime() - today.getTime()) / 86400000);
}
