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

/** Unauthenticated variants — applications happen before any account exists,
 * so these must NOT go through authFetch (no Firebase user to attach a token
 * for yet). */
async function publicPostJson<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.detail || `Request failed (${res.status})`);
  return res.json();
}

async function publicGetJson<T>(path: string): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`);
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

// ── Unlimited test access (replaces the free-trial program) ────────────────

export function redeemUnlimitedAccess(code: string): Promise<{ ok: boolean; unlimited: boolean }> {
  return postJson('/account/redeem-unlimited', { code });
}

// ── Per-workspace tools, prefs & personal Second Brain ─────────────────────

/** Which Tool Dock tools this account may see (admin+Opus curated). */
export function getMyTools(): Promise<{ tools: string[]; curated: boolean }> {
  return getJson('/me/tools');
}

export function getMyPrefs(): Promise<{ allow_training: boolean }> {
  return getJson('/me/prefs');
}

export function setTrainingPref(allow: boolean): Promise<{ ok: boolean; allow_training: boolean }> {
  return postJson('/me/prefs/training', { allow_training: allow });
}

export interface BrainNote { id: string; title: string; content: string; subject: string; source: string; created_at: string; }

export function listMyBrain(): Promise<{ notes: BrainNote[] }> {
  return getJson('/me/brain');
}

/** Add material to my OWN Second Brain, AI-distilled — costs Quanta. */
export function addToMyBrain(title: string, content: string, subject = ''): Promise<{ ok: boolean; id: string; title: string }> {
  return postJson('/me/brain/add', { title, content, subject });
}

// ── Applications (registration is closed — this is the waitlist gate) ──────

export interface LearningVector {
  /** 0 = Spatial/Visual, 1 = Verbal/Narrative */
  encoding_channel: number;
  /** 0 = Global/Intuitive, 1 = Sequential/Procedural */
  processing_structure: number;
  /** 0 = Active/Derivation, 1 = Reflective/Conceptual */
  engagement_mode: number;
  target_sandbox: 'stem' | 'physics' | 'chemistry' | 'math' | 'general_research';
  /** 0 = Low friction, 1 = High — "Pure Lyceum Mode" */
  cognitive_friction: number;
}

export interface ApplicationAnswers {
  grade_level: string;
  subjects: string;          // free text — which subjects they need to learn
  purpose: string;           // free text — what they're learning it for
  learning_goal: string;     // free text — their concrete study goal
  does_research: 'yes' | 'no';
  research_frequency: string;
  biggest_difficulty: string;
  budget_usd: number;
  /** Waitlist deposit — amount signals urgency; required to join. */
  deposit_usd: number;
}

export function submitApplication(
  email: string, name: string, answers: ApplicationAnswers, vector: LearningVector, referralCode = '',
): Promise<{ ok: boolean; status: string; priority: boolean; resubmitted?: boolean; already_decided?: boolean }> {
  return publicPostJson('/applications/apply', { email, name, answers, vector, referral_code: referralCode });
}

export function getApplicationStatus(email: string): Promise<{ status: 'not_found' | 'pending' | 'accepted' | 'declined'; priority: boolean }> {
  return publicGetJson(`/applications/status?email=${encodeURIComponent(email)}`);
}

// ── Library (thelyceum.site/library) ────────────────────────────────────────

export interface LibraryPost {
  id: string; author_uid: string; author_name: string; title: string;
  type: 'blog' | 'paper'; body: string; paper_url: string; created_at: string;
  comment_count: number; reactions: Record<string, number>;
}

export interface LibraryComment { id: string; author_name: string; content: string; created_at: string; }

export interface LibraryPostDetail extends LibraryPost { comments: LibraryComment[]; }

export function listLibraryPosts(limit = 30, offset = 0): Promise<{ posts: LibraryPost[] }> {
  return publicGetJson(`/library/posts?limit=${limit}&offset=${offset}`);
}

export function getLibraryPost(id: string): Promise<LibraryPostDetail> {
  return publicGetJson(`/library/posts/${id}`);
}

export function createLibraryPost(title: string, body: string, type: 'blog' | 'paper' = 'blog', paperUrl = ''): Promise<{ ok: boolean; id: string }> {
  return postJson('/library/posts', { title, body, type, paper_url: paperUrl });
}

export function addLibraryComment(postId: string, content: string): Promise<{ ok: boolean; id: string }> {
  return postJson(`/library/posts/${postId}/comments`, { content });
}

export function reactToLibraryPost(postId: string, emoji: string): Promise<{ ok: boolean; action: 'added' | 'removed'; reactions: Record<string, number> }> {
  return postJson(`/library/posts/${postId}/react`, { emoji });
}

// ── Personal Second Brain (thelyceum.site/secondbrain) + Orders ────────────

export interface AiScheduleBlock { id: string; subjectKey: string; dayOfWeek: number; startMinute: number; durationMinutes: number; }

export function generateAiSchedule(weeklyHours: number, subjectKeys: string[], documentTitles: string[]): Promise<{ blocks: AiScheduleBlock[] }> {
  return postJson('/ai/generate-schedule', { weekly_hours: weeklyHours, subject_keys: subjectKeys, document_titles: documentTitles });
}

export interface OrderRecord {
  id: string; documents: { id: string; title: string }[]; schedule: AiScheduleBlock[];
  ai_generated: boolean; note: string; status: 'pending' | 'accepted' | 'declined'; created_at: string;
}

export function submitOrder(
  documents: { id: string; title: string }[], schedule: AiScheduleBlock[], aiGenerated: boolean, note = '',
): Promise<{ ok: boolean; id: string }> {
  return postJson('/orders', { documents, schedule, ai_generated: aiGenerated, note });
}

export function listMyOrders(): Promise<{ orders: OrderRecord[] }> {
  return getJson('/orders/mine');
}

// ── Note generation from the Second Brain ───────────────────────────────────

export function synthesizeNoteFromTopic(topic: string, subject = '', language = 'en'): Promise<any> {
  return postJson('/ai/generate-note', { topic, subject, language });
}

// ── Coach lesson package (note + 2 card sets + break games) ─────────────────

export interface LessonCard {
  id: string; question: string; difficulty: 'easy' | 'medium' | 'hard' | 'extreme';
  concepts: string[]; subject: string; topic: string; source: string; is_past_paper: boolean;
}

export interface BreakGame { title: string; description: string; concepts: string[]; }

export interface LessonPackage {
  note: any;
  daily_cards: LessonCard[];
  past_paper_cards: LessonCard[];
  break_games: BreakGame[];
}

export function generateLessonPackage(subject: string, topic = '', language = 'en'): Promise<LessonPackage> {
  return postJson('/ai/generate-lesson', { subject, topic, language });
}

// ── Open-Sora (local video) ─────────────────────────────────────────────────

export function getVideoStatus(): Promise<{ available: boolean; url: string }> {
  return getJson('/ai/video/status');
}

export function generateVideo(prompt: string): Promise<{ video_base64?: string; video_url?: string }> {
  return postJson('/ai/generate-video', { prompt });
}
