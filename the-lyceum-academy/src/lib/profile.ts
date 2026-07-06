/**
 * Client for the shared personalization profile (backend:
 * app/services/mastery_profile.py). Every AI feature in the app reads the
 * same per-concept bars and per-subject affinity here, instead of each
 * feature guessing at the student's level independently.
 *
 * Writes are fire-and-forget — a failed profile update must never block
 * the feature that triggered it (mistake logging, grading, etc. all still
 * work even if this silently fails offline).
 */
import { authFetch } from './api';

const API_BASE = (import.meta.env.VITE_API_BASE as string) || 'http://localhost:8000';

export type ProfileEventType =
  | 'confusion'            // tần suất hiểu lầm
  | 'not_understood'       // số lần bảo chưa hiểu khi được dạy
  | 'question_asked'       // số lần đặt câu hỏi trên 1 concept
  | 'self_discovered_gap'  // số lần tự phát hiện lỗ hổng khi giảng lại
  | 'voiced_uncertainty';  // số lần nói ra lỗ hổng/điều chưa chắc

export interface ConceptProfile {
  concept: string;
  subject: string;
  baseline_proficiency_bar: number;
  confusion_frequency_bar: number;
  knowledge_gap_bar: number;
  not_understood_bar: number;
  questions_asked_bar: number;
  self_discovered_gap_bar: number;
  voiced_uncertainty_bar: number;
  question_frequency_bar: number;
  teaching_style: { baby_mode_pct: number; cross_subject_link_pct: number; reverse_hypothesis_pct: number };
  raw: Record<string, number>;
}

export interface SubjectAffinity {
  subject: string;
  love_bar: number;
  fear_bar: number;
  study_events: number;
  community_events: number;
}

export interface FullProfile {
  concepts: ConceptProfile[];
  subjects: SubjectAffinity[];
  needs_attention: { concept: string; subject: string }[];
  discovery_interest_subjects: string[];
}

async function post(path: string, body: unknown): Promise<void> {
  try {
    await authFetch(`${API_BASE}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch { /* offline/best-effort — never surfaces to the caller */ }
}

/** Record one raw signal for a concept. Call this at the moment it actually happens — don't batch or infer. */
export function recordProfileEvent(concept: string, subject: string, eventType: ProfileEventType): void {
  if (!concept?.trim()) return;
  void post('/profile/event', { concept: concept.trim().toLowerCase(), subject: subject || 'other', event_type: eventType });
}

/** Set/refresh a concept's pre-learning proficiency baseline (1-20). */
export function recordProfileBaseline(concept: string, subject: string, score: number): void {
  if (!concept?.trim()) return;
  void post('/profile/baseline', { concept: concept.trim().toLowerCase(), subject: subject || 'other', score });
}

/** kind: 'study' (time spent on the subject) or 'community' (peer interaction). */
export function recordSubjectActivity(subject: string, kind: 'study' | 'community'): void {
  if (!subject?.trim()) return;
  void post('/profile/subject-activity', { subject, kind });
}

export async function getFullProfile(): Promise<FullProfile | null> {
  try {
    const res = await authFetch(`${API_BASE}/profile/full`);
    if (!res.ok) return null;
    return res.json();
  } catch { return null; }
}

export async function getConceptProfile(concept: string): Promise<ConceptProfile | null> {
  try {
    const res = await authFetch(`${API_BASE}/profile/concept/${encodeURIComponent(concept.trim().toLowerCase())}`);
    if (!res.ok) return null;
    return res.json();
  } catch { return null; }
}
