// ── Game Builder — locally-persisted 2D scenes built from generated sprites ─
const SCENES_KEY = 'lyceum_game_scenes_v1';
const MAX_SCENES = 20;

export type Behavior = 'none' | 'fall' | 'bounce' | 'disappear' | 'patrol';

export interface GameObject {
  id: string;
  imageBase64: string; // raw base64, no data-URI prefix
  x: number;
  y: number;
  width: number;
  height: number;
  behavior: Behavior;
}

export interface GameScene {
  id: string;
  name: string;
  savedAt: number;
  objects: GameObject[];
}

export function loadScenes(): GameScene[] {
  try {
    const raw = localStorage.getItem(SCENES_KEY);
    const list = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? list : [];
  } catch { return []; }
}

export function saveScene(scene: GameScene): void {
  const list = loadScenes().filter(s => s.id !== scene.id);
  list.unshift(scene);
  try { localStorage.setItem(SCENES_KEY, JSON.stringify(list.slice(0, MAX_SCENES))); } catch { /* quota exceeded */ }
}

export function deleteScene(id: string): void {
  try { localStorage.setItem(SCENES_KEY, JSON.stringify(loadScenes().filter(s => s.id !== id))); } catch { /* ignore */ }
}
