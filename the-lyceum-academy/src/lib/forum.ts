/**
 * Client for thelyceum.site/forum — the founder community. Signup happens
 * before any Lyceum account exists, so browse/apply calls are unauthenticated
 * (same reasoning as applications.py's submitApplication/getApplicationStatus).
 * Chat/connection calls carry the forum-issued token (stored in localStorage
 * after apply/login) since real user-to-user interaction needs more than a
 * client-supplied email to say who's posting.
 */
import { getApiBaseUrl } from './apiBase';

const API_BASE = getApiBaseUrl();
const TOKEN_KEY = 'lyceum_forum_token';

export function getForumToken(): string {
  return localStorage.getItem(TOKEN_KEY) || '';
}

export function setForumToken(token: string): void {
  localStorage.setItem(TOKEN_KEY, token);
}

export function clearForumToken(): void {
  localStorage.removeItem(TOKEN_KEY);
}

async function publicGetJson<T>(path: string): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`);
  if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.detail || `Request failed (${res.status})`);
  return res.json();
}

async function publicPostJson<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.detail || `Request failed (${res.status})`);
  return res.json();
}

async function authedGetJson<T>(path: string): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, { headers: { 'X-Forum-Token': getForumToken() } });
  if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.detail || `Request failed (${res.status})`);
  return res.json();
}

async function authedPostJson<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Forum-Token': getForumToken() },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.detail || `Request failed (${res.status})`);
  return res.json();
}

export interface ForumGroup {
  id: string;
  name: string;
  kind: 'stage' | 'industry';
  description: string;
  is_active: number;
  member_count: number;
}

export function listForumGroups(): Promise<{ groups: ForumGroup[] }> {
  return publicGetJson('/forum/groups');
}

export type ForumRole = 'founder' | 'visitor';

export interface ForumApplyPayload {
  name: string;
  email: string;
  linkedin_url: string;
  role: ForumRole;
  business_email?: string;
  business_name?: string;
  industry?: string;
  stage?: string;
  photo_url?: string;
  looking_for_customers?: boolean;
  target_customer_description?: string;
}

export interface ForumMember {
  email: string;
  name: string;
  role: ForumRole;
  business_email: string;
  business_name: string;
  industry: string;
  stage: string;
  linkedin_url: string;
  photo_url: string;
  looking_for_customers: number;
  target_customer_description: string;
  referral_code: string;
  referred_by: string;
  joined_at: string;
  last_active_at: string;
  foundi_balance: number;
  groups: ForumGroup[];
}

export interface ForumApplyResult { ok: boolean; member: ForumMember; already_joined: boolean; forum_token: string; }

export async function applyToForum(payload: ForumApplyPayload): Promise<ForumApplyResult> {
  const res = await publicPostJson<ForumApplyResult>('/forum/apply', payload);
  setForumToken(res.forum_token);
  return res;
}

export async function forumLogin(email: string): Promise<{ member: ForumMember; forum_token: string }> {
  const res = await publicPostJson<{ member: ForumMember; forum_token: string }>('/forum/login', { email });
  setForumToken(res.forum_token);
  return res;
}

export function getForumMember(email: string): Promise<{ member: ForumMember }> {
  return publicGetJson(`/forum/me?email=${encodeURIComponent(email)}`);
}

// ── Suggested connections ───────────────────────────────────────────────────

export interface ForumConnection {
  id: string;
  member_email: string;
  match_email: string;
  kind: 'customer' | 'founder';
  reason: string;
  computed_at: string;
  match: ForumMember;
}

export function getForumConnections(): Promise<{ customers: ForumConnection[]; founders: ForumConnection[] }> {
  return authedGetJson('/forum/connections');
}

export function dismissForumConnection(id: string): Promise<{ ok: boolean }> {
  return authedPostJson(`/forum/connections/${encodeURIComponent(id)}/dismiss`, {});
}

// ── Chat — thread_id is 'group:<group_id>' or 'dm:<emailA>|<emailB>' (sorted) ─

export function dmThreadId(emailA: string, emailB: string): string {
  const [a, b] = [emailA.trim().toLowerCase(), emailB.trim().toLowerCase()].sort();
  return `dm:${a}|${b}`;
}

export interface ForumPitch { context: string; hypothesis: string; reasoning: string; risk: string; }

export interface ForumComment {
  id: string;
  message_id: string;
  author_email: string;
  verdict: 'good' | 'mixed' | 'bad';
  content: string;
  created_at: string;
}

export interface ForumMessage {
  id: string;
  thread_id: string;
  author_email: string;
  message_type: 'text' | 'pitch';
  body: string;
  pitch_context: string;
  pitch_hypothesis: string;
  pitch_reasoning: string;
  pitch_risk: string;
  created_at: string;
  comments: ForumComment[];
}

export function listForumMessages(threadId: string, since?: string): Promise<{ messages: ForumMessage[] }> {
  const qs = since ? `?since=${encodeURIComponent(since)}` : '';
  return authedGetJson(`/forum/threads/${encodeURIComponent(threadId)}/messages${qs}`);
}

export function postForumMessage(
  threadId: string, messageType: 'text' | 'pitch', body: string, pitch?: ForumPitch,
): Promise<{ ok: boolean; id: string; created_at: string }> {
  return authedPostJson(`/forum/threads/${encodeURIComponent(threadId)}/messages`, {
    message_type: messageType, body, pitch,
  });
}

export function postForumComment(
  messageId: string, verdict: 'good' | 'mixed' | 'bad', content: string,
): Promise<{ ok: boolean; id: string; created_at: string }> {
  return authedPostJson(`/forum/messages/${encodeURIComponent(messageId)}/comments`, { verdict, content });
}
