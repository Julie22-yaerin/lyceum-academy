// ── Coach — admin-curated materials selected by the Coach AI, per workspace ─
import { authFetch } from './api';
import { getApiBaseUrl } from './apiBase';

const API_BASE = getApiBaseUrl();

export interface CatalogItem {
  id: string;
  workspace_id: string;
  concept_name: string;
  item_type: 'lesson' | 'exercise-set' | 'tool' | 'game';
  title: string;
  content: any;
  ordinal: number;
}

export interface CatalogWorkspace {
  id: string;
  title: string;
  subject_key: string;
  field: string;
  description: string | null;
  is_published: boolean;
}

export async function fetchPublishedWorkspaces(): Promise<{ workspaces: CatalogWorkspace[] }> {
  const res = await authFetch(`${API_BASE}/workspaces/catalog`);
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Backend ${res.status}: ${body || res.statusText}`);
  }
  return res.json();
}

export async function fetchTodayMaterials(workspaceId: string): Promise<{ today: CatalogItem[]; studied: CatalogItem[] }> {
  const res = await authFetch(`${API_BASE}/coach/today?workspace_id=${encodeURIComponent(workspaceId)}`);
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Backend ${res.status}: ${body || res.statusText}`);
  }
  return res.json();
}
