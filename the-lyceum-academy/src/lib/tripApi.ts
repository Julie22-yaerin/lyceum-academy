/**
 * Client for thelyceum.site/{math,chemistry,biology,physics} — TRIP, the
 * public no-login demo. Entirely unauthenticated, same pattern as gameApi.ts.
 */
import { getApiBaseUrl } from './apiBase';

const API_BASE = getApiBaseUrl();

export type TripSubject = 'math' | 'chemistry' | 'biology' | 'physics';

export const TRIP_SUBJECTS: TripSubject[] = ['math', 'chemistry', 'biology', 'physics'];

export interface TripPreset {
  subject: TripSubject;
  subject_label: string;
  concept: string;
  note_title: string;
  note_body: string;
  lotus_seed: string;
  reel_src: string;
  reel_poster: string;
}

export interface TeachBackResult {
  mode: 'questioning' | 'guidance';
  reaction: string;
  questions: string[];
  guidance_content: string | null;
  gap_detected: string | null;
  encouragement: string;
}

export async function getTripPreset(subject: TripSubject): Promise<TripPreset> {
  const res = await fetch(`${API_BASE}/trip/${subject}`);
  if (!res.ok) throw new Error(`Request failed (${res.status})`);
  return res.json();
}

export function tripPodcastUrl(subject: TripSubject): string {
  return `${API_BASE}/trip/${subject}/podcast`;
}

export async function postTeachBack(subject: TripSubject, explanation: string): Promise<TeachBackResult> {
  const res = await fetch(`${API_BASE}/trip/teach-back`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ subject, explanation }),
  });
  if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.detail || `Request failed (${res.status})`);
  return res.json();
}
