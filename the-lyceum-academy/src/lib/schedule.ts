// ── Weekly study schedule — drag-and-drop blocks placed at onboarding, later
// read by ScheduleLockManager to ask the AI whether to auto-open/lock a
// workspace tab for the subject that's "live" right now.
import { scopedGateKey } from './persist';
import { authFetch } from './api';
import { getApiBaseUrl } from './apiBase';

const API_BASE = getApiBaseUrl();
const SCHEDULE_KEY = 'lyceum_weekly_schedule_v1';

export interface ScheduleBlock {
  id: string;
  subjectKey: string;    // SUBJECT_META key
  dayOfWeek: number;     // 0 = Monday .. 6 = Sunday
  startMinute: number;   // minutes since midnight, local time
  durationMinutes: number;
}

export function loadSchedule(): ScheduleBlock[] {
  try {
    const raw = localStorage.getItem(scopedGateKey(SCHEDULE_KEY));
    const list = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? list : [];
  } catch { return []; }
}

export function saveSchedule(blocks: ScheduleBlock[]): void {
  try { localStorage.setItem(scopedGateKey(SCHEDULE_KEY), JSON.stringify(blocks)); } catch { /* quota */ }
}

/** Best-effort sync so the backend can pre-generate exercises even when no browser tab is open. */
export async function syncScheduleToServer(blocks: ScheduleBlock[]): Promise<void> {
  try {
    await authFetch(`${API_BASE}/schedule`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        blocks: blocks.map(b => ({
          day_of_week: b.dayOfWeek, start_minute: b.startMinute,
          duration_minutes: b.durationMinutes, subject_key: b.subjectKey,
        })),
      }),
    });
  } catch { /* best-effort — schedule still works locally via localStorage */ }
}

/** Is `block` "live" right now, in the browser's local time? */
export function isBlockLiveNow(block: ScheduleBlock, now: Date = new Date()): boolean {
  const day = (now.getDay() + 6) % 7; // JS: 0=Sun..6=Sat → convert to 0=Mon..6=Sun
  if (day !== block.dayOfWeek) return false;
  const minute = now.getHours() * 60 + now.getMinutes();
  return minute >= block.startMinute && minute < block.startMinute + block.durationMinutes;
}
