import { auth } from './firebase';

const API_BASE = (import.meta.env.VITE_API_BASE as string) || 'http://localhost:8000';

/**
 * Fetch wrapper that automatically attaches the current user's Firebase ID token.
 * Falls back to unauthenticated if no user is signed in (dev/testing).
 */
async function authFetch(url: string, options: RequestInit = {}): Promise<Response> {
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

export async function checkMastery(question: string, answer: string) {
  // Backend expects { problem, solution }, returns { correct, mastery_delta, feedback }
  const res = await authFetch(`${API_BASE}/ai/mastery`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ problem: question, solution: answer }),
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

export async function synthesizeNoteFromUrl(url: string): Promise<NoteResult> {
  const res = await authFetch(`${API_BASE}/ai/note`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Backend ${res.status}: ${body || res.statusText}`);
  }
  return res.json();
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
  questions: { id: string; prompt: string; answer: string; image_b64?: string }[]
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

export async function gradeAll(questions: { id: string; prompt: string; answer: string }[]) {
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

export async function analyzeOnboarding(answers: Record<string, string | string[]>) {
  const res = await authFetch(`${API_BASE}/ai/onboarding-analyze`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ answers: Object.fromEntries(
      Object.entries(answers).map(([k, v]) => [k, Array.isArray(v) ? v.join(', ') : v])
    )}),
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
): Promise<FeynmanResult> {
  const form = new FormData();
  form.append('audio', audio, 'recording.webm');
  form.append('note_title', noteTitle);
  form.append('key_concepts', JSON.stringify(keyConcepts));

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

  const systemMsg: ChatMsg = {
    role: 'system',
    content: `You are Lyceum — a witty, sharp study companion with mild sarcasm. You have full access to this note and help the student understand, explore, and customize it.

NOTE CONTENT:
Title: ${noteContext.title}
Summary: ${noteContext.summary}
Key Concepts: ${noteContext.key_concepts.map(kc => `• ${kc.concept}: ${kc.definition}. ${kc.explanation}`).join('\n')}
${noteContext.key_insight ? `Key Insight: ${noteContext.key_insight}` : ''}
${noteContext.subject ? `Subject: ${noteContext.subject}` : ''}${extraContext}

You can:
- Answer questions about this note
- Elaborate on any section in more depth
- Give concrete examples or analogies
- Suggest edits or additions to the note
- Create tables, comparisons, or summaries on demand
- When providing structured content, use markdown (## headers, | tables |, **bold**, etc.)
- Reference other notes in the same subject to connect ideas

Tone: smart friend, not textbook. Short punchy answers unless asked for depth.`,
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
    content: `${modePrompts[mode]}\n\nTopic they're discussing: ${noteTitle}\nKey concepts: ${conceptsStr}`,
  };

  return chatMessage([systemMsg, ...messages]);
}

export interface CommunityBio {
  user_id: string;
  display_name: string;
  major?: string;
  school?: string;
  goal?: string;
  problems?: string[];
}

export interface CommunityMatchResult {
  matches: { user_id: string; compatibility_score: number; reason: string }[];
  summary: string;
}

// AI study-buddy matcher — ranks candidates by compatibility with the requester's
// bio (major/school/goals/pain points) for a focused, time-limited 1:1 chat.
export async function matchCommunityUsers(
  requester: CommunityBio, candidates: CommunityBio[]
): Promise<CommunityMatchResult> {
  const res = await authFetch(`${API_BASE}/ai/community/match`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      requester: { problems: [], major: '', school: '', goal: '', ...requester },
      candidates: candidates.map(c => ({ problems: [], major: '', school: '', goal: '', ...c })),
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Backend ${res.status}: ${body || res.statusText}`);
  }
  return res.json();
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
