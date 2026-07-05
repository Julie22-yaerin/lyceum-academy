/**
 * Browser-side YouTube transcript extraction — the fallback for when the
 * BACKEND's IP is rate-limited/blocked by YouTube (common for datacenter
 * hosts). The user's own browser fetches from public Piped/Invidious API
 * instances (CORS-enabled) over their residential IP, which YouTube doesn't
 * block, then the transcript text is submitted to /ai/note-text for
 * synthesis. youtube.com itself can't be fetched from a browser (no CORS).
 */

const PIPED_INSTANCES = [
  'https://pipedapi.kavin.rocks',
  'https://api.piped.yt',
  'https://pipedapi.adminforge.de',
];
const INVIDIOUS_INSTANCES = [
  'https://yewtu.be',
  'https://inv.nadeko.net',
  'https://invidious.nerdvpn.de',
];

export function parseYouTubeId(url: string): string | null {
  const m = url.match(/(?:v=|youtu\.be\/|shorts\/)([A-Za-z0-9_-]{11})/);
  return m ? m[1] : null;
}

function parseVtt(vtt: string): string {
  const seen = new Set<string>();
  const out: string[] = [];
  for (let line of vtt.split('\n')) {
    line = line.trim();
    if (!line || line.startsWith('WEBVTT') || line.includes('-->') || /^\d+$/.test(line) || /^\d{2}:\d{2}/.test(line)) continue;
    const clean = line.replace(/<[^>]+>/g, '').trim();
    if (clean && !seen.has(clean)) {
      seen.add(clean);
      out.push(clean);
    }
  }
  return out.join(' ');
}

async function fetchWithTimeout(url: string, ms = 8000): Promise<Response> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, { signal: ctrl.signal });
  } finally {
    clearTimeout(t);
  }
}

function pickSub<T extends Record<string, any>>(subs: T[], langKey: string): T | null {
  for (const want of ['en', 'vi']) {
    const hit = subs.find(s => String(s[langKey] || '').toLowerCase().startsWith(want));
    if (hit) return hit;
  }
  return subs[0] ?? null;
}

export interface BrowserYtResult { title: string; content: string; kind: 'transcript' | 'description'; }

export async function extractYouTubeInBrowser(url: string): Promise<BrowserYtResult | null> {
  const id = parseYouTubeId(url);
  if (!id) return null;
  let descFallback: BrowserYtResult | null = null;

  // Piped: /streams/{id} → { title, description, subtitles: [{url, code}] }
  for (const inst of PIPED_INSTANCES) {
    try {
      const r = await fetchWithTimeout(`${inst}/streams/${id}`);
      if (!r.ok) continue;
      const data = await r.json();
      const title: string = data.title || '';
      const sub = pickSub(data.subtitles || [], 'code');
      if (sub?.url) {
        const rs = await fetchWithTimeout(sub.url);
        if (rs.ok) {
          const transcript = parseVtt(await rs.text());
          if (transcript.length > 200) return { title, content: transcript, kind: 'transcript' };
        }
      }
      const desc: string = (data.description || '').trim();
      if (!descFallback && title && desc.length > 300) {
        descFallback = { title, content: `Video: ${title}\n\nDescription:\n${desc.slice(0, 4000)}`, kind: 'description' };
      }
    } catch { /* dead/slow instance — try the next */ }
  }

  // Invidious: /api/v1/videos/{id} → { title, description, captions: [{url, language_code}] }
  for (const inst of INVIDIOUS_INSTANCES) {
    try {
      const r = await fetchWithTimeout(`${inst}/api/v1/videos/${id}`);
      if (!r.ok) continue;
      const data = await r.json();
      const title: string = data.title || '';
      const cap = pickSub(data.captions || [], 'language_code');
      if (cap?.url) {
        const rs = await fetchWithTimeout(`${inst}${cap.url}`);
        if (rs.ok) {
          const transcript = parseVtt(await rs.text());
          if (transcript.length > 200) return { title, content: transcript, kind: 'transcript' };
        }
      }
      const desc: string = (data.description || '').trim();
      if (!descFallback && title && desc.length > 300) {
        descFallback = { title, content: `Video: ${title}\n\nDescription:\n${desc.slice(0, 4000)}`, kind: 'description' };
      }
    } catch { /* dead/slow instance — try the next */ }
  }

  return descFallback;
}
