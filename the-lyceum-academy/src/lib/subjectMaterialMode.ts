/**
 * Per-subject material-source mode: how a student intends to feed material
 * into a workspace tab. Asked once per subject node, right after it's
 * created in onboarding — chosen once, not re-asked every session.
 *
 *   upload       — bring material fresh before each session (recommended
 *                   for students who get material handed to them on a
 *                   schedule; nothing persists, cheapest).
 *   second-brain — the student already has all the material; input it once
 *                   and the AI distills + stores it (POST /me/brain/add,
 *                   already exists — see lyceumApi.addToMyBrain). Costs
 *                   Quanta.
 *   ai-research  — the student has none; the AI synthesizes material for a
 *                   named topic and saves it (POST /me/brain/research —
 *                   lyceumApi.aiResearchSubject). Costs more Quanta — a full
 *                   synthesis pass, not a paste-and-clean.
 */
import { scopedGateKey } from './persist';

export type MaterialMode = 'upload' | 'second-brain' | 'ai-research';

const KEY = 'lyceum_subject_material_mode_v1';

export function loadMaterialModes(): Record<string, MaterialMode> {
  try {
    const raw = localStorage.getItem(scopedGateKey(KEY));
    return raw ? JSON.parse(raw) : {};
  } catch { return {}; }
}

export function setMaterialMode(subjectKey: string, mode: MaterialMode): void {
  const map = loadMaterialModes();
  map[subjectKey] = mode;
  try { localStorage.setItem(scopedGateKey(KEY), JSON.stringify(map)); } catch { /* quota */ }
}

export function getMaterialMode(subjectKey: string): MaterialMode | null {
  return loadMaterialModes()[subjectKey] || null;
}
