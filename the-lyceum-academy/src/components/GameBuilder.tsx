import { useState, useRef, useEffect, useCallback, type DragEvent as ReactDragEvent, type MouseEvent as ReactMouseEvent } from 'react';
import { generateSpriteImage } from '../lib/api';
import { getVideoStatus, generateVideo } from '../lib/lyceumApi';
import { loadNotes, loadPSets, type SavedNote, type SavedPSet } from '../lib/persist';
import { loadScenes, saveScene, deleteScene, type GameObject, type GameScene, type Behavior } from '../lib/gameBuilder';

const STAGE_WIDTH = 800;
const STAGE_HEIGHT = 500;
const DEFAULT_OBJ_SIZE = 96;
const BEHAVIORS: Behavior[] = ['none', 'fall', 'bounce', 'disappear', 'patrol'];

interface Asset {
  id: string;
  prompt: string;
  imageBase64: string;
}

function rectsOverlap(a: { x: number; y: number; width: number; height: number }, b: { x: number; y: number; width: number; height: number }) {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
}

export default function GameBuilder() {
  const [prompt, setPrompt] = useState('');
  const [generating, setGenerating] = useState(false);
  const [genError, setGenError] = useState('');
  const [assets, setAssets] = useState<Asset[]>([]);
  const [objects, setObjects] = useState<GameObject[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const [dragAssetId, setDragAssetId] = useState<string | null>(null);
  const [sceneName, setSceneName] = useState('My Game');
  const [savedScenes, setSavedScenes] = useState<GameScene[]>(() => loadScenes());

  const stageRef = useRef<HTMLDivElement>(null);
  const dragObjRef = useRef<{ id: string; offsetX: number; offsetY: number } | null>(null);
  const patrolOrigin = useRef<Record<string, number>>({});
  const rafRef = useRef<number | null>(null);

  // ── Build a game from your own notes / quest sets ────────────────────────
  const [sources] = useState(() => ({ notes: loadNotes(), psets: loadPSets() }));
  const [buildingFrom, setBuildingFrom] = useState('');
  const [buildProgress, setBuildProgress] = useState('');

  // ── Open-Sora local video (cutscenes) ────────────────────────────────────
  const [soraAvailable, setSoraAvailable] = useState<boolean | null>(null);
  const [videoPrompt, setVideoPrompt] = useState('');
  const [videoBusy, setVideoBusy] = useState(false);
  const [videoSrc, setVideoSrc] = useState('');
  const [videoError, setVideoError] = useState('');

  useEffect(() => {
    getVideoStatus().then(s => setSoraAvailable(s.available)).catch(() => setSoraAvailable(false));
  }, []);

  /** Pull the key concepts out of a saved note or quest set. */
  function conceptsOf(source: SavedNote | SavedPSet): string[] {
    if ('note' in source) {
      const kcs = (source.note?.key_concepts || []) as { concept: string }[];
      return kcs.map(k => k.concept).filter(Boolean);
    }
    const set = new Set<string>();
    (source.questions || []).forEach((q: any) => (q.concepts || []).forEach((c: string) => set.add(c)));
    return [...set];
  }

  /** Generate one sprite per key concept (up to 4) — the study material
   * becomes the game's cast. Slow (local CPU diffusion), so run serially
   * with a progress line. */
  async function buildFromSource(source: SavedNote | SavedPSet, label: string) {
    if (generating || buildingFrom) return;
    const concepts = conceptsOf(source).slice(0, 4);
    if (concepts.length === 0) { setGenError('This item has no extracted concepts to build from.'); return; }
    setBuildingFrom(label);
    setGenError('');
    setSceneName(label);
    if (!videoPrompt) setVideoPrompt(`A short 2D game cutscene about ${concepts.join(', ')}`);
    try {
      for (let i = 0; i < concepts.length; i++) {
        setBuildProgress(`Sprite ${i + 1}/${concepts.length}: ${concepts[i]}`);
        const result = await generateSpriteImage(`${concepts[i]}, cute mascot character`);
        setAssets(prev => [{ id: `asset-${Date.now()}-${i}`, prompt: concepts[i], imageBase64: result.image }, ...prev]);
      }
    } catch (e: any) {
      setGenError(e.message || 'Sprite generation failed — please try again.');
    } finally {
      setBuildingFrom('');
      setBuildProgress('');
    }
  }

  async function handleGenerateVideo() {
    if (!videoPrompt.trim() || videoBusy) return;
    setVideoBusy(true); setVideoError(''); setVideoSrc('');
    try {
      const result = await generateVideo(videoPrompt.trim());
      if (result.video_base64) setVideoSrc(`data:video/mp4;base64,${result.video_base64}`);
      else if (result.video_url) setVideoSrc(result.video_url);
      else setVideoError('Open-Sora returned no video.');
    } catch (e: any) {
      setVideoError(e.message || 'Video generation failed.');
    } finally { setVideoBusy(false); }
  }

  async function handleGenerate() {
    if (!prompt.trim() || generating) return;
    setGenerating(true);
    setGenError('');
    try {
      const result = await generateSpriteImage(prompt.trim());
      setAssets(prev => [{ id: `asset-${Date.now()}`, prompt: prompt.trim(), imageBase64: result.image }, ...prev]);
      setPrompt('');
    } catch (e: any) {
      setGenError(e.message || 'Could not generate — please try again.');
    } finally {
      setGenerating(false);
    }
  }

  function dropOnStage(e: ReactDragEvent) {
    e.preventDefault();
    if (!dragAssetId || !stageRef.current) return;
    const asset = assets.find(a => a.id === dragAssetId);
    if (!asset) return;
    const rect = stageRef.current.getBoundingClientRect();
    const x = Math.max(0, Math.min(STAGE_WIDTH - DEFAULT_OBJ_SIZE, e.clientX - rect.left - DEFAULT_OBJ_SIZE / 2));
    const y = Math.max(0, Math.min(STAGE_HEIGHT - DEFAULT_OBJ_SIZE, e.clientY - rect.top - DEFAULT_OBJ_SIZE / 2));
    const obj: GameObject = {
      id: `obj-${Date.now()}`, imageBase64: asset.imageBase64,
      x, y, width: DEFAULT_OBJ_SIZE, height: DEFAULT_OBJ_SIZE, behavior: 'none',
    };
    setObjects(prev => [...prev, obj]);
    setDragAssetId(null);
  }

  function startDragObject(e: ReactMouseEvent, obj: GameObject) {
    if (playing) return;
    setSelectedId(obj.id);
    const rect = stageRef.current?.getBoundingClientRect();
    if (!rect) return;
    dragObjRef.current = { id: obj.id, offsetX: e.clientX - rect.left - obj.x, offsetY: e.clientY - rect.top - obj.y };
  }

  useEffect(() => {
    if (playing) return;
    function onMove(e: MouseEvent) {
      const drag = dragObjRef.current;
      const rect = stageRef.current?.getBoundingClientRect();
      if (!drag || !rect) return;
      setObjects(prev => prev.map(o => o.id === drag.id
        ? { ...o, x: Math.max(0, Math.min(STAGE_WIDTH - o.width, e.clientX - rect.left - drag.offsetX)), y: Math.max(0, Math.min(STAGE_HEIGHT - o.height, e.clientY - rect.top - drag.offsetY)) }
        : o));
    }
    function onUp() { dragObjRef.current = null; }
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); };
  }, [playing]);

  function setBehavior(id: string, behavior: Behavior) {
    setObjects(prev => prev.map(o => o.id === id ? { ...o, behavior } : o));
  }

  function removeObject(id: string) {
    setObjects(prev => prev.filter(o => o.id !== id));
    if (selectedId === id) setSelectedId(null);
  }

  function handlePlayClick(obj: GameObject) {
    if (!playing) return;
    if (obj.behavior === 'disappear') {
      setObjects(prev => prev.filter(o => o.id !== obj.id));
    } else if (obj.behavior === 'bounce') {
      setObjects(prev => prev.map(o => o.id === obj.id ? { ...o, y: Math.max(0, o.y - 60) } : o));
    }
  }

  // ── Play loop: gravity for 'fall', oscillation for 'patrol' ──────────────
  const tick = useCallback(() => {
    setObjects(prev => prev.map(o => {
      if (o.behavior === 'fall') {
        const next = { ...o, y: o.y + 4 };
        const hitsFloor = next.y + next.height >= STAGE_HEIGHT;
        const hitsOther = prev.some(other => other.id !== o.id && rectsOverlap({ ...next }, other) && other.y >= o.y);
        if (hitsFloor) next.y = STAGE_HEIGHT - next.height;
        else if (hitsOther) return o; // stop just above whatever it landed on
        return next;
      }
      if (o.behavior === 'patrol') {
        const origin = patrolOrigin.current[o.id] ?? (patrolOrigin.current[o.id] = o.x);
        const t = Date.now() / 500;
        const x = Math.max(0, Math.min(STAGE_WIDTH - o.width, origin + Math.sin(t) * 100));
        return { ...o, x };
      }
      return o;
    }));
    rafRef.current = requestAnimationFrame(tick);
  }, []);

  useEffect(() => {
    if (playing) {
      rafRef.current = requestAnimationFrame(tick);
    } else if (rafRef.current) {
      cancelAnimationFrame(rafRef.current);
    }
    return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current); };
  }, [playing, tick]);

  function handleSaveScene() {
    const scene: GameScene = { id: `scene-${Date.now()}`, name: sceneName || 'Untitled', savedAt: Date.now(), objects };
    saveScene(scene);
    setSavedScenes(loadScenes());
  }

  function handleLoadScene(scene: GameScene) {
    setObjects(scene.objects);
    setSceneName(scene.name);
    setSelectedId(null);
    setPlaying(false);
  }

  function handleDeleteScene(id: string) {
    deleteScene(id);
    setSavedScenes(loadScenes());
  }

  const selected = objects.find(o => o.id === selectedId) || null;

  return (
    <div className="w-full max-w-6xl mx-auto flex flex-col gap-8 py-8">
      <div className="text-center">
        <span className="font-sans text-[10px] font-semibold text-on-surface opacity-50 tracking-[2px] uppercase block mb-2">Socrat</span>
        <h2 className="font-serif text-2xl text-on-surface">2D Game Builder</h2>
        <p className="font-sans text-xs opacity-50 mt-2">Turn your notes and quest sets into a playable 2D scene — generate sprites locally (CPU — can take up to ~2 minutes), drag them onto the stage, and give them behavior.</p>
      </div>

      {/* Build from your study material */}
      {(sources.notes.length > 0 || sources.psets.length > 0) && (
        <div className="bg-surface border border-outline/10 p-6">
          <label className="font-sans text-[10px] uppercase tracking-[2px] opacity-50 mb-3 block">Create a game from your material</label>
          {buildingFrom ? (
            <div className="flex items-center gap-3 py-2">
              <div className="w-3 h-3 border border-on-surface/30 border-t-on-surface rounded-full animate-spin" />
              <p className="font-sans text-xs opacity-60">Building "{buildingFrom}" — {buildProgress || 'starting…'}</p>
            </div>
          ) : (
            <div className="flex flex-wrap gap-2">
              {sources.notes.slice(0, 6).map(n => (
                <button key={n.id} onClick={() => buildFromSource(n, n.title)}
                  className="border border-outline/20 px-3 py-1.5 font-sans text-[11px] hover:bg-surface-container-highest transition-colors">
                  🧠 {n.title.slice(0, 32)}
                </button>
              ))}
              {sources.psets.slice(0, 6).map(p => (
                <button key={p.id} onClick={() => buildFromSource(p, p.name)}
                  className="border border-outline/20 px-3 py-1.5 font-sans text-[11px] hover:bg-surface-container-highest transition-colors">
                  📚 {p.name.slice(0, 32)}
                </button>
              ))}
            </div>
          )}
          <p className="font-sans text-[10px] opacity-40 mt-3">Each key concept becomes a sprite you can drop onto the stage.</p>
        </div>
      )}

      {/* Asset generation */}
      <div className="bg-surface border border-outline/10 p-6">
        <label className="font-sans text-[10px] uppercase tracking-[2px] opacity-50 mb-3 block">Generate a sprite</label>
        <div className="flex gap-3">
          <input
            value={prompt}
            onChange={e => setPrompt(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') handleGenerate(); }}
            placeholder="e.g. a small green dragon, pixel art"
            disabled={generating}
            className="flex-1 bg-transparent border-b border-outline/30 px-0 py-2 font-sans text-sm outline-none focus:border-on-surface transition-colors disabled:opacity-50"
          />
          <button
            onClick={handleGenerate}
            disabled={generating || !prompt.trim()}
            className="px-6 py-2 bg-on-surface text-surface font-sans text-[10px] uppercase tracking-[2px] font-bold disabled:opacity-30 flex items-center gap-2"
          >
            {generating && <div className="w-3 h-3 border border-surface/40 border-t-surface rounded-full animate-spin" />}
            {generating ? 'Generating…' : 'Generate'}
          </button>
        </div>
        {generating && (
          <p className="font-sans text-[11px] opacity-50 mt-2">Running locally on CPU — this can take up to ~2 minutes. Please be patient.</p>
        )}
        {genError && <p className="font-sans text-sm text-red-600 mt-2">{genError}</p>}

        {assets.length > 0 && (
          <div className="flex flex-wrap gap-3 mt-5 pt-5 border-t border-outline/10">
            {assets.map(a => (
              <img
                key={a.id}
                src={`data:image/png;base64,${a.imageBase64}`}
                alt={a.prompt}
                title={`${a.prompt} — drag onto the stage`}
                draggable
                onDragStart={() => setDragAssetId(a.id)}
                onDragEnd={() => setDragAssetId(null)}
                className="w-16 h-16 object-cover border border-outline/20 cursor-grab bg-surface-container-lowest"
              />
            ))}
          </div>
        )}
      </div>

      {/* Stage */}
      <div className="flex gap-6 items-start flex-wrap">
        <div>
          <div className="flex items-center gap-3 mb-3">
            <button
              onClick={() => setPlaying(v => !v)}
              className={`px-5 py-2 font-sans text-[10px] uppercase tracking-[2px] font-bold ${playing ? 'bg-red-500 text-white' : 'bg-on-surface text-surface'}`}
            >
              {playing ? '■ Stop' : '▶ Play'}
            </button>
            <span className="font-sans text-[11px] opacity-50">{objects.length} object{objects.length === 1 ? '' : 's'}</span>
          </div>
          <div
            ref={stageRef}
            onDragOver={e => e.preventDefault()}
            onDrop={dropOnStage}
            style={{ width: STAGE_WIDTH, height: STAGE_HEIGHT }}
            className="relative bg-surface-container-lowest border border-outline/20 overflow-hidden"
          >
            {objects.map(o => (
              <img
                key={o.id}
                src={`data:image/png;base64,${o.imageBase64}`}
                onMouseDown={e => startDragObject(e, o)}
                onClick={() => { if (playing) handlePlayClick(o); else setSelectedId(o.id); }}
                style={{
                  position: 'absolute', left: o.x, top: o.y, width: o.width, height: o.height,
                  cursor: playing ? 'pointer' : 'grab',
                  outline: selectedId === o.id && !playing ? '2px solid #C5A059' : 'none',
                  transition: o.behavior === 'bounce' || o.behavior === 'disappear' ? 'top 0.3s, opacity 0.3s' : undefined,
                }}
                draggable={false}
                alt=""
              />
            ))}
          </div>
        </div>

        {/* Inspector */}
        {!playing && (
          <div className="w-56 bg-surface border border-outline/10 p-5">
            <span className="font-sans text-[10px] uppercase tracking-[2px] opacity-50 block mb-3">Inspector</span>
            {selected ? (
              <div className="flex flex-col gap-3">
                <select
                  value={selected.behavior}
                  onChange={e => setBehavior(selected.id, e.target.value as Behavior)}
                  className="border border-outline/30 bg-transparent px-2 py-1.5 font-sans text-sm outline-none"
                >
                  {BEHAVIORS.map(b => <option key={b} value={b}>{b}</option>)}
                </select>
                <button
                  onClick={() => removeObject(selected.id)}
                  className="text-left font-sans text-[10px] uppercase tracking-[2px] text-red-600 opacity-70 hover:opacity-100"
                >
                  Delete object
                </button>
              </div>
            ) : (
              <p className="font-sans text-xs opacity-40">Select an object on the stage.</p>
            )}
          </div>
        )}
      </div>

      {/* Open-Sora cutscene (local video generation) */}
      <div className="bg-surface border border-outline/10 p-6">
        <div className="flex items-center gap-2 mb-3">
          <label className="font-sans text-[10px] uppercase tracking-[2px] opacity-50">Cutscene — Open-Sora (local)</label>
          {soraAvailable === true && <span className="font-sans text-[9px] uppercase tracking-[1px] text-emerald-600">● online</span>}
          {soraAvailable === false && <span className="font-sans text-[9px] uppercase tracking-[1px] text-red-500">● offline</span>}
        </div>
        <div className="flex gap-3">
          <input
            value={videoPrompt}
            onChange={e => setVideoPrompt(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') handleGenerateVideo(); }}
            placeholder="Describe the cutscene — e.g. a pixel-art hero exploring a chemistry lab"
            disabled={videoBusy}
            className="flex-1 bg-transparent border-b border-outline/30 px-0 py-2 font-sans text-sm outline-none focus:border-on-surface transition-colors disabled:opacity-50"
          />
          <button
            onClick={handleGenerateVideo}
            disabled={videoBusy || !videoPrompt.trim() || soraAvailable === false}
            className="px-6 py-2 bg-on-surface text-surface font-sans text-[10px] uppercase tracking-[2px] font-bold disabled:opacity-30 flex items-center gap-2"
          >
            {videoBusy && <div className="w-3 h-3 border border-surface/40 border-t-surface rounded-full animate-spin" />}
            {videoBusy ? 'Rendering…' : 'Generate video'}
          </button>
        </div>
        {soraAvailable === false && (
          <p className="font-sans text-[11px] opacity-50 mt-2">Open-Sora isn't reachable — start the local server (OPEN_SORA_URL) to enable cutscenes.</p>
        )}
        {videoBusy && (
          <p className="font-sans text-[11px] opacity-50 mt-2">Rendering locally — this can take several minutes. Leave this tab open.</p>
        )}
        {videoError && <p className="font-sans text-sm text-red-600 mt-2">{videoError}</p>}
        {videoSrc && (
          <video src={videoSrc} controls loop className="mt-4 w-full max-w-lg border border-outline/20 bg-black" />
        )}
      </div>

      {/* Save / Load */}
      <div className="bg-surface border border-outline/10 p-6">
        <label className="font-sans text-[10px] uppercase tracking-[2px] opacity-50 mb-3 block">Save Scene</label>
        <div className="flex gap-3 mb-5">
          <input
            value={sceneName}
            onChange={e => setSceneName(e.target.value)}
            className="flex-1 bg-transparent border-b border-outline/30 px-0 py-2 font-sans text-sm outline-none focus:border-on-surface transition-colors"
          />
          <button onClick={handleSaveScene} className="px-6 py-2 bg-on-surface text-surface font-sans text-[10px] uppercase tracking-[2px] font-bold">
            Save
          </button>
        </div>
        {savedScenes.length > 0 && (
          <div className="flex flex-col gap-2">
            {savedScenes.map(s => (
              <div key={s.id} className="flex items-center justify-between border border-outline/10 px-4 py-2.5">
                <button onClick={() => handleLoadScene(s)} className="font-sans text-sm text-left hover:underline">
                  {s.name} <span className="opacity-40 text-xs">({s.objects.length} objects)</span>
                </button>
                <button onClick={() => handleDeleteScene(s.id)} className="font-sans text-[10px] uppercase tracking-[1.5px] text-red-600 opacity-60 hover:opacity-100">
                  Delete
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
