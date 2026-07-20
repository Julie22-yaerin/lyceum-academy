/**
 * Client for the ship-day Lyceum backend surface (backend:
 * app/routers/lyceum.py): Quanta wallet, referral, plans catalog, teams
 * (group plan), authored documents, Second Brain customization, Open-Sora.
 */
import { authFetch } from './api';
import { getApiBaseUrl } from './apiBase';

const API_BASE = getApiBaseUrl();

async function getJson<T>(path: string): Promise<T> {
  const res = await authFetch(`${API_BASE}${path}`);
  if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.detail || `Request failed (${res.status})`);
  return res.json();
}

async function postJson<T>(path: string, body: unknown, method = 'POST'): Promise<T> {
  const res = await authFetch(`${API_BASE}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.detail || `Request failed (${res.status})`);
  return res.json();
}

// ── Quanta wallet ───────────────────────────────────────────────────────────

export interface QuantaBalance {
  plan_id: string;
  plan_name: string;
  cycle: string;
  tokens_per_quanta: number;
  standard_allowance: number;
  standard_spent: number;
  standard_remaining: number;
  coach_allowance: number;
  coach_spent: number;
  coach_remaining: number;
  extra_credits: number;
  earned_points: number;
}

export function getQuantaBalance(): Promise<QuantaBalance> {
  return getJson('/quanta/balance');
}

export function buyExtraCredits(quanta: number): Promise<{ ok: boolean; added_quanta: number; balance: QuantaBalance }> {
  return postJson('/quanta/extra-credits', { quanta });
}

// ── Referral ────────────────────────────────────────────────────────────────

export interface ReferralInfo { code: string; invited_count: number; quanta_earned: number; }

export function getReferralInfo(): Promise<ReferralInfo> {
  return getJson('/referral/me');
}

export function redeemReferral(code: string): Promise<{ ok: boolean }> {
  return postJson('/referral/redeem', { code });
}

export function buildInviteLink(code: string): string {
  return `${window.location.origin}/?invite=${encodeURIComponent(code)}`;
}

// ── Plans ───────────────────────────────────────────────────────────────────

export interface LyceumPlan {
  id: string; name: string; kind: 'personal' | 'team';
  standard_tokens: number; coach_tokens: number;
  standard_quanta: number; coach_quanta: number;
  seats: number; emoji: string;
}

export interface PlanCatalog { tokens_per_quanta: number; billing_cycles: string[]; plans: LyceumPlan[]; }

export function getPlanCatalog(): Promise<PlanCatalog> {
  return getJson('/plans/catalog');
}

export interface CurrentPlan { plan: LyceumPlan; cycle: string; selected_at: string | null; is_default: boolean; }

export function getCurrentPlan(): Promise<CurrentPlan> {
  return getJson('/plans/current');
}

export function selectPlan(planId: string, cycle: 'monthly' | 'annual'): Promise<CurrentPlan> {
  return postJson('/plans/select', { plan_id: planId, cycle });
}

// ── Teams (group plan) ──────────────────────────────────────────────────────

export interface TeamMember { user_id: string; email: string; role: string; joined_at: string; }
export interface TeamInfo {
  id: string; name: string; owner_uid: string; created_at: string;
  members: TeamMember[]; pending_invites: { id: string; email: string }[]; max_seats: number;
}

export function getMyTeam(): Promise<{ team: TeamInfo | null }> {
  return getJson('/teams/me');
}

export function createTeam(name: string): Promise<{ ok: boolean; team: TeamInfo }> {
  return postJson('/teams/create', { name });
}

export function inviteTeamMember(email: string): Promise<{ ok: boolean; team: TeamInfo }> {
  return postJson('/teams/invite', { email });
}

export function acceptTeamInvite(): Promise<{ ok: boolean; team: TeamInfo }> {
  return postJson('/teams/accept-invite', {});
}

export function leaveTeam(): Promise<{ ok: boolean }> {
  return postJson('/teams/leave', {});
}

export interface TeamChatMessage { id: number; user_id: string; author: string; content: string; created_at: string; }

export function getTeamChat(afterId = 0): Promise<{ ok: boolean; messages: TeamChatMessage[] }> {
  return getJson(`/teams/chat?after_id=${afterId}`);
}

export function postTeamChat(content: string, author = ''): Promise<{ ok: boolean }> {
  return postJson('/teams/chat', { content, author });
}

// ── Authored documents ──────────────────────────────────────────────────────

export interface AuthoredDocMeta {
  id: string; title: string; folder: string; visibility: string;
  author_uid?: string; team_id?: string | null; created_at: string; updated_at: string;
}

export function listDocuments(): Promise<{ mine: AuthoredDocMeta[]; team: AuthoredDocMeta[]; public: AuthoredDocMeta[] }> {
  return getJson('/documents');
}

export function getDocument(id: string): Promise<AuthoredDocMeta & { content: string }> {
  return getJson(`/documents/${id}`);
}

export function saveDocument(doc: {
  title: string; content: string; doc_id?: string; folder?: string; visibility?: 'private' | 'team' | 'public';
}): Promise<{ ok: boolean; id: string }> {
  return postJson('/documents', doc);
}

export function deleteDocument(id: string): Promise<{ ok: boolean }> {
  return postJson(`/documents/${id}`, undefined, 'DELETE');
}

// ── Second Brain customization ──────────────────────────────────────────────

export function addSecondBrainNote(title: string, content: string, subject = ''): Promise<{ ok: boolean; id: string }> {
  return postJson('/second-brain/custom', { title, content, subject });
}

export function listSecondBrainCustom(): Promise<{ notes: { id: string; title: string; subject: string }[] }> {
  return getJson('/second-brain/custom');
}

// ── Note generation from the Second Brain ───────────────────────────────────

export function synthesizeNoteFromTopic(topic: string, subject = '', language = 'en'): Promise<any> {
  return postJson('/ai/generate-note', { topic, subject, language });
}

// ── Open-Sora (local video) ─────────────────────────────────────────────────

export function getVideoStatus(): Promise<{ available: boolean; url: string }> {
  return getJson('/ai/video/status');
}

export function generateVideo(prompt: string): Promise<{ video_base64?: string; video_url?: string }> {
  return postJson('/ai/generate-video', { prompt });
}
