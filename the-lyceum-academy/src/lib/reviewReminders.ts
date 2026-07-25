/**
 * Review reminders — the 3-7-21-30 spaced-repetition schedule (step 7 of the
 * house topic pipeline, see backend user_brain.LYCEUM_PIPELINE_PROMPT). When a
 * student learns something (a saved note, a completed lesson), we register the
 * topic and queue four review checkpoints: +3, +7, +21 and +30 days out. On
 * each due checkpoint the workspace surfaces a popup that makes them
 * re-explain the core idea in their own words, then answer a couple of short
 * retention questions against a compact summary of the old material.
 *
 * Storage is local (per browser). Questions/summary are generated lazily by
 * the AI when a checkpoint comes due, so nothing heavy runs at learn-time.
 *
 * The storage key is versioned: bumping it to _v2 (rather than migrating)
 * retires queues built on the old 3-checkpoint shape, whose `checkpoints`
 * arrays are one entry short and would otherwise never schedule a day-30
 * review. Losing a few pending reminders is the cheaper trade.
 */

const KEY = 'lyceum_review_3_7_21_30_v2';
const DAY = 86400000;
const OFFSETS_DAYS = [3, 7, 21, 30];
export type ReviewStage = 3 | 7 | 21 | 30;

export interface ReviewItem {
  id: string;              // stable id (note id / lesson id)
  topic: string;
  subject: string;
  summarySeed: string;     // raw material the AI compresses into the recap
  learnedAt: number;
  /** epoch ms for each checkpoint; null once that checkpoint is cleared. */
  checkpoints: (number | null)[];
}

function load(): ReviewItem[] {
  try { return JSON.parse(localStorage.getItem(KEY) || '[]'); } catch { return []; }
}

function save(items: ReviewItem[]): void {
  try { localStorage.setItem(KEY, JSON.stringify(items.slice(0, 300))); } catch { /* quota */ }
}

/** Register a freshly-learned topic. Idempotent on id. */
export function registerLearned(id: string, topic: string, subject: string, summarySeed: string): void {
  const items = load();
  if (items.some(i => i.id === id)) return;
  const now = Date.now();
  items.push({
    id, topic, subject, summarySeed: summarySeed.slice(0, 4000), learnedAt: now,
    checkpoints: OFFSETS_DAYS.map(d => now + d * DAY),
  });
  save(items);
}

/** The single most-overdue checkpoint that's due right now, if any. */
export function nextDueReview(): { item: ReviewItem; checkpointIndex: number; stage: ReviewStage } | null {
  const now = Date.now();
  const items = load();
  let best: { item: ReviewItem; checkpointIndex: number; due: number } | null = null;
  for (const item of items) {
    item.checkpoints.forEach((due, idx) => {
      if (due !== null && due <= now && (!best || due < best.due)) {
        best = { item, checkpointIndex: idx, due };
      }
    });
  }
  if (!best) return null;
  return { item: best.item, checkpointIndex: best.checkpointIndex, stage: OFFSETS_DAYS[best.checkpointIndex] as ReviewStage };
}

/** Mark a checkpoint cleared so it stops surfacing. */
export function clearCheckpoint(id: string, checkpointIndex: number): void {
  const items = load();
  const item = items.find(i => i.id === id);
  if (!item) return;
  item.checkpoints[checkpointIndex] = null;
  // Once every checkpoint is cleared, drop the item entirely.
  if (item.checkpoints.every(c => c === null)) {
    save(items.filter(i => i.id !== id));
  } else {
    save(items);
  }
}

/** Snooze a due checkpoint by a day (student dismissed the popup). */
export function snoozeCheckpoint(id: string, checkpointIndex: number): void {
  const items = load();
  const item = items.find(i => i.id === id);
  if (!item || item.checkpoints[checkpointIndex] === null) return;
  item.checkpoints[checkpointIndex] = Date.now() + DAY;
  save(items);
}
