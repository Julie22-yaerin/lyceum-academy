import { auth } from './firebase';
import { getApiBaseUrl } from './apiBase';
import { getCurrentLang } from '../i18n/I18nContext';
import { buildLanguageDirective } from '../lib/locale';

const API_BASE = getApiBaseUrl();

/**
 * Fetch wrapper that automatically attaches the current user's Firebase ID token.
 * Falls back to unauthenticated if no user is signed in (dev/testing).
 */
export async function authFetch(url: string, options: RequestInit = {}): Promise<Response> {
  const token = await auth.currentUser?.getIdToken().catch(() => null);
  const headers = new Headers(options.headers);
  if (token) headers.set('Authorization', `Bearer ${token}`);
  return fetch(url, { ...options, headers });
}

/**
 * Route an external image through the backend's /media/proxy so hosts that
 * block hotlinking (Referer checks / opaque-response blocking) still render.
 * The proxy only accepts the trusted image CDNs the research pipeline uses.
 */
export function proxiedImageUrl(url: string): string {
  return `${API_BASE}/media/proxy?url=${encodeURIComponent(url)}`;
}

export interface ChatMsg { role: string; content: string; }

export async function chatMessage(messages: ChatMsg[], _devMode = false) {
  const res = await authFetch(`${API_BASE}/ai/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ messages, temperature: 0.7, max_tokens: 2048 }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Backend ${res.status}: ${body || res.statusText}`);
  }
  const data = await res.json();
  // Backend returns { text, model, usage } — normalise to { reply }
  return { reply: data.text as string, model: data.model, tokens: data.usage?.total_tokens };
}

export async function generateGraph(topic: string) {
  // Backend endpoint: /ai/topic-map  returns { topic, nodes, edges }
  const res = await authFetch(`${API_BASE}/ai/topic-map`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ topic }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Backend ${res.status}: ${body || res.statusText}`);
  }
  const data = await res.json();
  // Backend: { topic, nodes: [{id,label,type,description}], edges: [{source,target,label}] }
  // Frontend expects: { nodes: [{id,label,group}], edges: [{source,target}] }
  return {
    nodes: (data.nodes || []).map((n: any) => ({ id: n.id, label: n.label, group: n.type })),
    edges: (data.edges || []).map((e: any) => ({ source: e.source, target: e.target })),
  };
}

export async function getNodeSummary(concept: string) {
  // Backend endpoint: /ai/node-summary
  const res = await authFetch(`${API_BASE}/ai/node-summary`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ label: concept, node_type: 'concept', description: '', connections: [] }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Backend ${res.status}: ${body || res.statusText}`);
  }
  return res.json() as Promise<{
    summary?: string; definition?: string;
    image_url?: string; image_urls?: string[]; source_url?: string;
    equations?: string[]; example?: string; key_insight?: string;
  }>;
}

/**
 * Server-side rate-limit + bot-check gate for the email/password login and
 * signup form. Email/password auth itself goes straight from the browser to
 * Firebase (our backend never sees it), so this pure gate call is what
 * actually caps repeated attempts from the same IP (2 per 5 minutes) and
 * verifies the reCAPTCHA v3 token before we let Firebase try the credentials.
 */
export async function checkLoginAttempt(recaptchaToken: string | null = null): Promise<void> {
  const res = await authFetch(`${API_BASE}/auth/login-attempt`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ recaptcha_token: recaptchaToken }),
  });
  if (res.status === 429) {
    throw new Error('Too many attempts. Please wait a few minutes and try again.');
  }
  if (res.status === 403) {
    throw new Error('Automated request detected. Please try again.');
  }
}

/**
 * Establish (or refresh) the backend's HttpOnly __session cookie for the
 * current Firebase user. Supplementary to the app's real auth mechanism
 * (the Bearer token every authFetch call already sends) — best-effort, so
 * failures here never block sign-in.
 */
export async function establishSessionCookie(idToken: string): Promise<void> {
  try {
    await fetch(`${API_BASE}/auth/session`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id_token: idToken }),
    });
  } catch {
    // best-effort only
  }
}

/** Clear the __session cookie on sign-out. */
export async function clearSessionCookie(): Promise<void> {
  try {
    await fetch(`${API_BASE}/auth/session`, { method: 'DELETE', credentials: 'include' });
  } catch {
    // best-effort only
  }
}

/** WolframAlpha exact computation (SOC-17 plugin) — used by Ari's compute_math tool call. */
export async function computeMath(query: string): Promise<{ result: string | null; configured: boolean }> {
  const res = await authFetch(`${API_BASE}/ai/compute`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Backend ${res.status}: ${body || res.statusText}`);
  }
  return res.json();
}

/** GPT (NVIDIA gpt-oss-20b) text fallback for ARI when Gemini Live's WS is down. */
export async function voiceFallbackChat(messages: { role: string; content: string }[], systemInstruction: string): Promise<string> {
  const res = await authFetch(`${API_BASE}/ai/voice-fallback`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ messages, system_instruction: systemInstruction }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Backend ${res.status}: ${body || res.statusText}`);
  }
  const data = await res.json();
  return data.text || '';
}

export async function uploadProblemSet(file: File) {
  const form = new FormData();
  form.append('file', file);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 180_000);
  try {
    const res = await authFetch(`${API_BASE}/ai/upload-pset`, { method: 'POST', body: form, signal: controller.signal });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`Backend ${res.status}: ${body || res.statusText}`);
    }
    const data = await res.json();
    // Backend returns { summary, problems: [...], figures: [...], pages?: [...], lens_mode?: bool }
    return {
      ...data,
      lensMode: data.lens_mode ?? false,
      totalPages: data.total_pages ?? (data.pages?.length ?? 0),
      pages: data.pages || [],
      questions: (data.problems || []).map((p: any) => ({
        id: p.id,
        label: p.label,      // exact printed question marker (locator code), e.g. "1B-2"
        prompt: p.prompt || p.title || '',
        difficulty: p.difficulty || 'medium',
        concepts: p.concepts || [],
        page: p.page,        // 0-based page index (lens mode)
        yStart: p.y_start,   // % from top (lens mode)
        yEnd: p.y_end,       // % from top (lens mode)
        image_url: p.image_crop ? `data:${p.image_mime || 'image/jpeg'};base64,${p.image_crop}` : undefined,
      })),
    };
  } catch (e: any) {
    if (e.name === 'AbortError') throw new Error('Upload timed out (3 min). The NVIDIA model may be busy — try again.');
    if (e.message?.includes('Failed to fetch') || e.message?.includes('NetworkError')) {
      throw new Error('Cannot reach backend at localhost:8000 — is it running?');
    }
    throw e;
  } finally {
    clearTimeout(timeout);
  }
}

export async function decomposeProblemSet(text: string) {
  // Backend expects { pset_text }, not { text }
  const res = await authFetch(`${API_BASE}/ai/decompose`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pset_text: text }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Backend ${res.status}: ${body || res.statusText}`);
  }
  const data = await res.json();
  // Normalise problems → questions
  return {
    ...data,
    questions: (data.problems || []).map((p: any) => ({
      id: p.id,
      prompt: p.prompt || p.title || '',
      difficulty: p.difficulty || 'medium',
      concepts: p.concepts || [],
    })),
  };
}

export async function checkMastery(question: string, answer: string, concepts: string[] = [], subject = '') {
  // Backend expects { problem, solution }, returns { correct, mastery_delta, feedback }
  // concepts/subject feed the shared personalization profile — see lib/profile.ts
  const res = await authFetch(`${API_BASE}/ai/mastery`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ problem: question, solution: answer, concepts, subject }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Backend ${res.status}: ${body || res.statusText}`);
  }
  const data = await res.json();
  // Normalise correct → passed
  return {
    passed: data.correct ?? data.passed ?? false,
    feedback: data.feedback || '',
  } as { passed: boolean; feedback: string };
}

export async function getSocraticHint(question: string) {
  const res = await authFetch(`${API_BASE}/ai/hint`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ problem: question, level: 1 }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Backend ${res.status}: ${body || res.statusText}`);
  }
  const data = await res.json();
  return (data.hint || data.text || data.reply || '') as string;
}

export async function validateToolMap(columns: object) {
  // Backend endpoint: /ai/tool-map/validate
  const res = await authFetch(`${API_BASE}/ai/tool-map/validate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(columns),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Backend ${res.status}: ${body || res.statusText}`);
  }
  return res.json() as Promise<{ feedback: string }>;
}

export interface MindMapStatus {
  tier: string;
  document_limit: number | null;
  used_in_document: number;
  remaining: number | null;
  can_use: boolean;
}

export interface MindMapFinding {
  location: 'input' | 'systems' | 'output' | 'connection' | 'custom' | string;
  issue: string;
  detail: string;
}

export interface MindMapInspectionResult extends MindMapStatus {
  verdict: string;
  summary: string;
  findings: MindMapFinding[];
  missing: string[];
  suggestions: string[];
}

export async function getMindMapStatus(documentId = ''): Promise<MindMapStatus> {
  const qs = documentId ? `?document_id=${encodeURIComponent(documentId)}` : '';
  const res = await authFetch(`${API_BASE}/ai/mind-map/status${qs}`, { method: 'GET' });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Backend ${res.status}: ${body || res.statusText}`);
  }
  return res.json() as Promise<MindMapStatus>;
}

export async function inspectMindMap(image: string, context = '', documentId = ''): Promise<MindMapInspectionResult> {
  const res = await authFetch(`${API_BASE}/ai/mind-map/inspect`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ image, context, document_id: documentId }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Backend ${res.status}: ${body || res.statusText}`);
  }
  return res.json() as Promise<MindMapInspectionResult>;
}

export interface ProviderUsage {
  prompt: number;
  completion: number;
  requests: number;
}

export interface UsageData {
  total_tokens: number;
  total_calls: number;
  by_provider: Record<string, ProviderUsage>;
}

export async function getUsage(): Promise<UsageData | null> {
  try {
    const res = await fetch(`${API_BASE}/ai/usage`);
    if (!res.ok) return null;
    const data = await res.json();
    return {
      total_tokens: data?.total?.total_tokens ?? 0,
      total_calls:  data?.total?.requests ?? 0,
      by_provider:  data?.by_provider ?? {},
    };
  } catch { return null; }
}

export async function cleanQuestion(prompt: string, context = '') {
  const res = await authFetch(`${API_BASE}/ai/clean-question`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt, context }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Backend ${res.status}: ${body || res.statusText}`);
  }
  return res.json() as Promise<{ clean: string }>;
}

export interface NoteConcept {
  emoji: string;
  concept: string;
  definition: string;
  explanation: string;
  equation: string;         // LaTeX formula or ""
  wiki_search?: string;
  image_url?: string | null;
}

export interface NoteResult {
  title: string;
  tldr: string;
  summary: string;
  key_concepts: NoteConcept[];
  socratic_questions: string[];
  key_insight: string;
  source_type?: string;
  video_id?: string;
  error?: string;
  section_images?: { heading: string; images: string[]; search_query?: string }[];
  overall_map_svg?: string;
}

export async function synthesizeNoteFromFile(file: File): Promise<NoteResult> {
  const form = new FormData();
  form.append('file', file);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 120_000);
  try {
    const res = await authFetch(`${API_BASE}/ai/note-upload`, { method: 'POST', body: form, signal: controller.signal });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`Backend ${res.status}: ${body || res.statusText}`);
    }
    return res.json();
  } catch (e: any) {
    if (e.name === 'AbortError') throw new Error('Upload timed out (2 min).');
    throw e;
  } finally {
    clearTimeout(timeout);
  }
}

export async function analyzePage(pageData: string, pageIndex: number, totalPages: number) {
  const res = await authFetch(`${API_BASE}/ai/analyze-page`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ page_data: pageData, page_index: pageIndex, total_pages: totalPages }),
  });
  if (!res.ok) throw new Error(`Backend ${res.status}`);
  const data = await res.json();
  return (data.problems || []).map((p: any) => ({
    id: p.id,
    label: p.label,
    prompt: p.prompt || p.title || '',
    difficulty: p.difficulty || 'medium',
    concepts: p.concepts || [],
    page: p.page,
    yStart: p.y_start,
    yEnd: p.y_end,
  }));
}

export interface GradeSuggestion {
  concept: string;
  ask_lyceum: string;
  google_links: { title: string; url: string }[];
}

export async function gradeDual(
  questions: { id: string; prompt: string; answer: string; image_b64?: string; concepts?: string[]; subject?: string }[]
): Promise<{ grades: { id: string; passed: boolean; feedback: string; suggestions?: GradeSuggestion }[] }> {
  const res = await authFetch(`${API_BASE}/ai/grade-dual`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ questions }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Backend ${res.status}: ${body || res.statusText}`);
  }
  return res.json();
}

export async function gradeAll(questions: { id: string; prompt: string; answer: string; concepts?: string[]; subject?: string }[]) {
  const res = await authFetch(`${API_BASE}/ai/grade-all`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ questions }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Backend ${res.status}: ${body || res.statusText}`);
  }
  return res.json() as Promise<{ grades: { id: string; passed: boolean; feedback: string }[] }>;
}

export async function analyzeOnboarding(answers: Record<string, string | string[]>, learningStyle?: Record<string, number>, personaIds?: string[]) {
  const res = await authFetch(`${API_BASE}/ai/onboarding-analyze`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      answers: Object.fromEntries(
        Object.entries(answers).map(([k, v]) => [k, Array.isArray(v) ? v.join(', ') : v])
      ),
      learning_style: learningStyle ?? null,
      persona_ids: personaIds ?? null,
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Backend ${res.status}: ${body || res.statusText}`);
  }
  return res.json() as Promise<{
    recommended_plan_id?: string;
    plan_name?: string;
    reasoning?: string;
    alternatives?: { plan_id: string; reason: string }[];
    error?: string;
  }>;
}

export interface Persona {
  id: string;
  name: string;
  field: string;
  era: string;
  bio_highlights: string;
  epistemological_style: string;
  special_trait: string;
  special_trait_value: number;
  cognitive_indices: Record<string, number>;
}

export async function fetchPersonas(): Promise<Persona[]> {
  const res = await authFetch(`${API_BASE}/personas/`);
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Backend ${res.status}: ${body || res.statusText}`);
  }
  const data = await res.json();
  return (data.personas || []) as Persona[];
}

export interface RoadmapResult {
  topic: string;
  prerequisites: { name: string; why: string; priority: 'required' | 'recommended' }[];
  roadmap_steps: { order: number; title: string; description: string; approach: 'top_down' | 'bottom_up' | 'just_in_time' }[];
  style_summary: string;
  learning_style: { top_down_pct: number; bottom_up_pct: number; just_in_time_pct: number };
  study_mode: string;
  error?: string;
}

/**
 * DeepSeek roadmap generator (see backend /ai/roadmap) — a reasoning model
 * with reasoning_effort="high" genuinely takes 1-2 minutes, not seconds.
 * Callers must show a real loading state, not a quick spinner.
 */
export async function generateRoadmap(topic: string, onboardingAnswers: Record<string, string | string[]>): Promise<RoadmapResult> {
  const q7 = onboardingAnswers['q7'];
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 170_000);
  try {
    const res = await authFetch(`${API_BASE}/ai/roadmap`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        topic,
        q1_goal: typeof onboardingAnswers['q1'] === 'string' ? onboardingAnswers['q1'] : '',
        q3_hours: typeof onboardingAnswers['q3'] === 'string' ? onboardingAnswers['q3'] : '',
        q7_learning_style: Array.isArray(q7) ? q7 : [],
      }),
      signal: controller.signal,
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`Backend ${res.status}: ${body || res.statusText}`);
    }
    return res.json();
  } catch (e: any) {
    if (e.name === 'AbortError') throw new Error('Roadmap generation timed out — try again.');
    throw e;
  } finally {
    clearTimeout(timeout);
  }
}

export interface FeynmanResult {
  reaction: string;
  questions: string[];
  score: number;
  score_reason: string;
  gaps: string[];
  transcript: string;
}

export async function feynmanTest(
  audio: Blob,
  noteTitle: string,
  keyConcepts: string[],
  subject = '',
): Promise<FeynmanResult> {
  const form = new FormData();
  form.append('audio', audio, 'recording.webm');
  form.append('note_title', noteTitle);
  form.append('key_concepts', JSON.stringify(keyConcepts));
  form.append('subject', subject);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 60_000);
  try {
    const res = await authFetch(`${API_BASE}/ai/feynman`, {
      method: 'POST',
      body: form,
      signal: controller.signal,
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`Backend ${res.status}: ${body || res.statusText}`);
    }
    return res.json();
  } catch (e: any) {
    if (e.name === 'AbortError') throw new Error('Timeout — try again with a shorter clip');
    throw e;
  } finally {
    clearTimeout(timeout);
  }
}

export async function noteChatMessage(
  userMessages: ChatMsg[],
  noteContext: { title: string; summary: string; key_concepts: { concept: string; definition: string; explanation: string }[]; key_insight?: string; subject?: string },
  otherNotes?: { title: string; summary: string }[]
) {
  let extraContext = '';
  if (otherNotes && otherNotes.length > 0) {
    extraContext = '\n\nOTHER NOTES IN THIS SUBJECT:\n' +
      otherNotes.map(n => `• ${n.title}: ${(n.summary || '').slice(0, 500)}`).join('\n') +
      '\n\nUse these related notes to provide a more comprehensive, cross-referenced understanding.';
  }

  const lang = getCurrentLang();
  const systemMsg: ChatMsg = {
    role: 'system',
    content: `You are Lyceum — a witty, sharp study companion with mild sarcasm. You have full access to this note and help the student understand, explore, and customize it.

NOTE CONTENT:
Title: ${noteContext.title}
Summary: ${noteContext.summary}
Key Concepts: ${noteContext.key_concepts.map(kc => `• ${kc.concept}: ${kc.definition}. ${kc.explanation}`).join('\n')}
${noteContext.key_insight ? `Key Insight: ${noteContext.key_insight}` : ''}
${noteContext.subject ? `Subject: ${noteContext.subject}` : ''}${extraContext}

Socratic first: when the student asks something the note already covers, do NOT just hand them the explanation. Ask what THEY think or would guess first, one short direct question, then build from their answer — react to what they specifically said, push back, ask a follow-up. Only fully explain once they've had a real attempt or explicitly say they don't know, and even then keep opening it back up with a question instead of lecturing.

You can:
- Ask questions that guide them back to this note's content
- Elaborate on any section in more depth, once they've engaged with it
- Give concrete examples or analogies
- Suggest edits or additions to the note
- Create tables, comparisons, or summaries on demand
- When providing structured content, use markdown (## headers, | tables |, **bold**, etc.)
- Reference other notes in the same subject to connect ideas

Tone: smart friend, not textbook. Short punchy answers unless asked for depth.${buildLanguageDirective(lang)}`,
  };
  return chatMessage([systemMsg, ...userMessages]);
}

export type FeynmanMode = 'baby' | 'scientist';

export async function feynmanChat(
  messages: ChatMsg[],
  noteTitle: string,
  keyConcepts: string[],
  mode: FeynmanMode,
): Promise<{ reply: string }> {
  const lang = getCurrentLang();
  const conceptsStr = keyConcepts.slice(0, 6).join(', ') || 'the main topic';

  const modePrompts: Record<FeynmanMode, string> = {
    baby:
      "You are a super curious 5-year-old child. You know absolutely NOTHING about science, math, "
      + "engineering, or any technical field. Someone is trying to explain something to you.\n\n"
      + "Rules:\n"
      + "- React HONESTLY — what makes sense? What's confusing?\n"
      + "- Ask simple, childlike 'but why?' questions\n"
      + "- Use very simple words, short sentences\n"
      + "- Be enthusiastic when something clicks, confused when it doesn't\n"
      + "- If they use a big word you don't know, say you don't understand\n"
      + "- Reply in the EXACT SAME LANGUAGE the person used\n"
      + "- Keep responses short (2-4 sentences)",
    scientist:
      "You are a sharp, knowledgeable scientist and critical thinker. You're having a "
      + "peer-level discussion with someone who understands the material.\n\n"
      + "Rules:\n"
      + "- Engage with depth — ask probing questions, challenge assumptions\n"
      + "- Draw connections to related concepts and real-world applications\n"
      + "- When you disagree or see a gap, explain why respectfully\n"
      + "- Use technical terminology appropriately but explain when needed\n"
      + "- Suggest thought experiments, edge cases, or counterexamples\n"
      + "- Reply in the EXACT SAME LANGUAGE the person used\n"
      + "- Keep responses substantive but concise (3-5 sentences)",
  };

  const systemMsg: ChatMsg = {
    role: 'system',
    content: `${modePrompts[mode]}${buildLanguageDirective(lang)}\n\nTopic they're discussing: ${noteTitle}\nKey concepts: ${conceptsStr}`,
  };

  return chatMessage([systemMsg, ...messages]);
}

export async function classifySubject(title: string, content: string = ''): Promise<{ subject: string; confidence: number }> {
  const res = await authFetch(`${API_BASE}/ai/classify-subject`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title, content }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Backend ${res.status}: ${body || res.statusText}`);
  }
  return res.json();
}

export async function analyzeMistake(mistake: string, location: string): Promise<{ subject: string; explanation: string }> {
  const res = await authFetch(`${API_BASE}/ai/analyze-mistake`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ mistake, location }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Backend ${res.status}: ${body || res.statusText}`);
  }
  return res.json();
}

export async function describeDrawing(imageData: string) {
  // Strip data URI prefix if present
  const base64 = imageData.replace(/^data:[^;]+;base64,/, '');
  const res = await authFetch(`${API_BASE}/ai/describe-drawing`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ image: base64 }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Backend ${res.status}: ${body || res.statusText}`);
  }
  return res.json() as Promise<{ text: string }>;
}

// Local CPU image generation (Playground game-asset sprites) — genuinely
// slow (tens of seconds to ~2 minutes), runs on the backend's own CPU with
// no GPU/paid API. Generous timeout, no fake-fast UI expectation.
export async function generateSpriteImage(prompt: string, width = 384, height = 384): Promise<{ image: string }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 150_000);
  try {
    const res = await authFetch(`${API_BASE}/ai/generate-sprite`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt, width, height }),
      signal: controller.signal,
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`Backend ${res.status}: ${body || res.statusText}`);
    }
    return res.json();
  } catch (e: any) {
    if (e.name === 'AbortError') throw new Error('Sprite generation timed out — try a simpler prompt or try again.');
    throw e;
  } finally {
    clearTimeout(timeout);
  }
}

export interface PsetAnalysis {
  overall_topic: string;
  question_types: Record<string, string>;
  difficulty_distribution: Record<string, number>;
  estimated_time_per_question: { id: string; estimated_minutes: number }[];
  total_estimated_time: number;
}

export async function analyzePSetQuestions(questions: { id: string; prompt: string; difficulty: string; concepts: string[] }[]): Promise<PsetAnalysis> {
  const res = await authFetch(`${API_BASE}/ai/analyze-pset-questions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ questions }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Backend ${res.status}: ${body || res.statusText}`);
  }
  return res.json() as Promise<PsetAnalysis>;
}

// ── REVERSE_BUILD rescue (3 wrong attempts on the same pset question) ──────

export interface RevealedSolution {
  solution: string;
  required_tools: string[];
}

export async function revealSolution(problem: string, concepts: string[] = [], subject = ''): Promise<RevealedSolution> {
  const res = await authFetch(`${API_BASE}/ai/reveal-solution`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ problem, concepts, subject }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Backend ${res.status}: ${body || res.statusText}`);
  }
  return res.json() as Promise<RevealedSolution>;
}

export interface ReverseBuildEval {
  tool_fidelity: { required_tools: string[]; used_tools: string[]; ok: boolean; mismatch_note?: string };
  conceptual_accuracy: 'pass' | 'partial' | 'fail';
  logical_flow: 'pass' | 'partial' | 'fail';
  completeness: 'pass' | 'partial' | 'fail';
  verdict: 'pass' | 'partial' | 'fail';
  next_state: 'TRANSFER_TEST' | 'REVERSE_BUILD_RETRY' | 'HINTING';
  feedback: string;
}

export async function evaluateReverseBuild(
  studentExplanation: string,
  originalProblem: string,
  requiredTools: string[] = [],
  subjectArea = 'math',
): Promise<ReverseBuildEval> {
  const res = await authFetch(`${API_BASE}/ai/reverse-build-eval`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      student_explanation: studentExplanation,
      original_problem: originalProblem,
      required_tools: requiredTools,
      subject_area: subjectArea,
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Backend ${res.status}: ${body || res.statusText}`);
  }
  return res.json() as Promise<ReverseBuildEval>;
}

export interface VariantQuestion {
  id: string;
  prompt: string;
  difficulty: string;
  concepts: string[];
}

export async function generateVariantQuestions(
  sources: { prompt: string; concepts: string[]; difficulty: string }[],
): Promise<{ questions: VariantQuestion[] }> {
  const res = await authFetch(`${API_BASE}/ai/generate-variants`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ source_questions: sources }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Backend ${res.status}: ${body || res.statusText}`);
  }
  return res.json() as Promise<{ questions: VariantQuestion[] }>;
}

export interface ExerciseCard {
  id: string;
  question: string;
  difficulty: 'easy' | 'medium' | 'hard' | 'extreme';
  concepts: string[];
  subject: string;
  topic: string;
  source: string;
}

export async function generateExercises(
  subject: string,
  topic: string = '',
  count: number = 10,
): Promise<{ cards: ExerciseCard[] }> {
  const res = await authFetch(`${API_BASE}/ai/generate-exercises`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ subject, topic, count }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Backend ${res.status}: ${body || res.statusText}`);
  }
  return res.json();
}

// ── Schedule-driven tab lock — AI decides whether to auto-open/lock a tab ──

export interface ScheduleDecision {
  allow_switch: boolean;
  recommended_subject: string | null;
  lock_minutes: number;
  reason: string;
}

export async function decideScheduleLock(
  schedule: { subjectKey: string; dayOfWeek: number; startMinute: number; durationMinutes: number }[],
  currentSubject: string | null,
  candidateSubject: string,
): Promise<ScheduleDecision> {
  const res = await authFetch(`${API_BASE}/ai/schedule-decide`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      schedule: schedule.map(b => ({
        subject_key: b.subjectKey, day_of_week: b.dayOfWeek,
        start_minute: b.startMinute, duration_minutes: b.durationMinutes,
      })),
      current_subject: currentSubject,
      candidate_subject: candidateSubject,
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Backend ${res.status}: ${body || res.statusText}`);
  }
  return res.json();
}

// ── User feedback (anonymous — star rating + optional comment) ─────────────

export async function submitFeedback(rating: number, comment = '', context = ''): Promise<void> {
  const raw = {
    page: typeof window !== 'undefined' ? window.location.pathname : '',
    userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : '',
    clientTime: new Date().toISOString(),
  };
  const res = await authFetch(`${API_BASE}/feedback`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ rating, comment, context, raw }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Backend ${res.status}: ${body || res.statusText}`);
  }
}
