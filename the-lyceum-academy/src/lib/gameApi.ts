/**
 * Client for thelyceum.site/game — the public, no-login marketing quiz.
 * Entirely unauthenticated (no Firebase token), separate from the rest of
 * lyceumApi.ts's authed workspace surface.
 */
import { getApiBaseUrl } from './apiBase';

const API_BASE = getApiBaseUrl();

async function postJson<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.detail || `Request failed (${res.status})`);
  return res.json();
}

async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`);
  if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.detail || `Request failed (${res.status})`);
  return res.json();
}

export type Subject = 'sinh' | 'toan' | 'hoa' | 'ly';

export interface SpotMistakeItem {
  id: string; type: 'spot_mistake'; order: number; difficulty: number;
  question: string; shown_answer: string; choices: string[];
}
export interface ConceptExplainItem {
  id: string; type: 'concept_explain'; order: number; difficulty: string;
  concept: string; prompt: string;
}
export interface ImageMultiselectItem {
  id: string; type: 'image_multiselect'; order: number;
  image_prompt: string; options: string[]; max_select: number;
}
export type GameItem = SpotMistakeItem | ConceptExplainItem | ImageMultiselectItem;

export interface StartGameResult { session_id: string; items: GameItem[]; }

export function startGame(subject: Subject, curriculum: string, playerName: string): Promise<StartGameResult> {
  return postJson('/game/start', { subject, curriculum, player_name: playerName });
}

export interface AnswerResult {
  correct: boolean; delta: number; taunt: string;
  correct_choice_index?: number; explanation?: string; correct_options?: string[];
}

export function answerItem(
  sessionId: string, itemId: string, selected: number[], skipped = false,
): Promise<AnswerResult> {
  return postJson('/game/answer', { session_id: sessionId, item_id: itemId, selected, skipped });
}

export interface ConceptAnswerResult { gave_up: boolean; delta: number; taunt: string; }

export function conceptAnswer(
  sessionId: string, itemId: string, mode: 'text' | 'audio' | 'skip', text = '', durationSeconds = 0,
): Promise<ConceptAnswerResult> {
  return postJson('/game/concept-answer', {
    session_id: sessionId, item_id: itemId, mode, text, duration_seconds: durationSeconds,
  });
}

export function gameImageUrl(sessionId: string, itemId: string): string {
  return `${API_BASE}/game/image/${sessionId}/${itemId}`;
}

export interface LeaderboardEntry {
  player_name: string; subject: string; curriculum: string; score: number; created_at: string;
}

export interface FinishResult {
  score: number; tier: { label: string; copy: string }; rank: number; leaderboard: LeaderboardEntry[];
}

export function finishGame(sessionId: string): Promise<FinishResult> {
  return postJson('/game/finish', { session_id: sessionId });
}

export function getLeaderboard(limit = 20): Promise<{ entries: LeaderboardEntry[] }> {
  return getJson(`/game/leaderboard?limit=${limit}`);
}
