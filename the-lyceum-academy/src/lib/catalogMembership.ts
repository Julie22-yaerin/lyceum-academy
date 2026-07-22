// ── Maps a workspace tab (SUBJECT_META key) to the admin-curated catalog
// workspace the student joined for it, so feature pages know which
// workspace_id to ask the Coach for. Kept separate from WorkspaceContext's
// tab list (a plain string[] of SUBJECT_META keys) to avoid touching that
// fragile, already-reworked-twice system again.
import { scopedGateKey } from './persist';

const KEY = 'lyceum_catalog_membership_v1';

export function loadMembership(): Record<string, string> {
  try {
    const raw = localStorage.getItem(scopedGateKey(KEY));
    return raw ? JSON.parse(raw) : {};
  } catch { return {}; }
}

export function saveMembership(map: Record<string, string>): void {
  try { localStorage.setItem(scopedGateKey(KEY), JSON.stringify(map)); } catch { /* quota */ }
}

export function joinWorkspace(subjectKey: string, workspaceId: string): void {
  const map = loadMembership();
  map[subjectKey] = workspaceId;
  saveMembership(map);
}

export function getWorkspaceId(subjectKey: string): string | null {
  return loadMembership()[subjectKey] || null;
}
