/**
 * Client for Quanta — the XP-like point system (backend:
 * app/services/quanta.py). Points are always computed server-side from the
 * event type; this client only reports that an event happened.
 *
 * Fire-and-forget, same spirit as profile.ts — a failed award must never
 * block the feature that triggered it (saving a mind map still works even
 * if the network call silently fails).
 */
import { authFetch } from './api';
import { getApiBaseUrl } from './apiBase';

const API_BASE = getApiBaseUrl();

export interface QuantaAwardResult {
  awarded: number;
  event_type: string;
  total_points: number;
  level: number;
  leveled_up: boolean;
}

export interface QuantaProfile {
  total_points: number;
  level: number;
  points_into_level: number;
  points_to_next_level: number;
  recent_events: { event_type: string; points: number; context: string; created_at: string }[];
}

async function post(path: string, body: unknown): Promise<QuantaAwardResult | null> {
  try {
    const res = await authFetch(`${API_BASE}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) return null;
    const result: QuantaAwardResult = await res.json();
    // No shared state/context wired up for Quanta — the badge listens for
    // this instead, matching this app's light, prop-drilling-free style.
    window.dispatchEvent(new CustomEvent('quanta:awarded', { detail: result }));
    return result;
  } catch { return null; }
}

/** Call right after a NEW mind map/knowledge graph is saved (not on edits to an existing one). */
export function awardMindMapCreated(graphId: string): void {
  void post('/quanta/award', { event_type: 'mind_map_created', context: graphId });
}

export async function getQuantaProfile(): Promise<QuantaProfile | null> {
  try {
    const res = await authFetch(`${API_BASE}/quanta/me`);
    if (!res.ok) return null;
    return res.json();
  } catch { return null; }
}
