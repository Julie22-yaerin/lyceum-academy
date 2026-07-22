/**
 * NodeMapTool (Tier 2 · Spatial-Kinesthetic Node Mapping) — the hippocampus
 * encodes space far better than a linear string of symbols, so instead of a
 * flat 2D equation we float each cluster of variables as a 3D geometric body.
 * The student orbits the coordinate axes with the mouse to see the equation's
 * "hidden faces" — variables occluded from the default angle only reveal
 * themselves once you rotate to them.
 *
 * Brain: Visual-Spatial. Thinking: Geometric / Top-Down.
 * Subjects: Quantum physics (wavefunctions, state vectors), Multivariable Calculus.
 *
 * Raw three.js (no react-three-fiber dep). Each term is a labelled node; a
 * back-facing node is dimmed until the student rotates it into view, which is
 * the whole point — you must physically move to complete the picture.
 */
import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';

interface Term { label: string; pos: [number, number, number]; color: number; }

const PRESETS: { name: string; terms: Term[]; hint: string }[] = [
  {
    name: 'Schrödinger (time-dependent)',
    hint: 'iℏ ∂ψ/∂t = Ĥψ — rotate to find the operator hiding behind ψ.',
    terms: [
      { label: 'iℏ', pos: [-2.2, 1.1, 0.4], color: 0xc4a4ff },
      { label: '∂ψ/∂t', pos: [-0.4, 0.2, 1.6], color: 0x7ee0d0 },
      { label: '=', pos: [0.8, 0, 0], color: 0xffffff },
      { label: 'Ĥ', pos: [1.8, 0.7, -1.6], color: 0xfcd34d },
      { label: 'ψ', pos: [2.4, -0.9, -0.6], color: 0xf9a8d4 },
    ],
  },
  {
    name: 'Gradient (multivariable)',
    hint: '∇f = (∂f/∂x, ∂f/∂y, ∂f/∂z) — each partial lives on its own axis.',
    terms: [
      { label: '∇f', pos: [0, 1.6, 0], color: 0xc4a4ff },
      { label: '∂f/∂x', pos: [2.2, -0.6, 0], color: 0xf87171 },
      { label: '∂f/∂y', pos: [-1.1, -0.6, 1.9], color: 0x34d399 },
      { label: '∂f/∂z', pos: [-1.1, -0.6, -1.9], color: 0x60a5fa },
    ],
  },
];

function labelSprite(text: string, color: number): THREE.Sprite {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 128;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#' + color.toString(16).padStart(6, '0');
  ctx.font = 'bold 56px Georgia, serif';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(text, 128, 64);
  const tex = new THREE.CanvasTexture(c);
  const mat = new THREE.SpriteMaterial({ map: tex, transparent: true });
  const sprite = new THREE.Sprite(mat);
  sprite.scale.set(1.6, 0.8, 1);
  return sprite;
}

export default function NodeMapTool() {
  const mountRef = useRef<HTMLDivElement>(null);
  const [presetIdx, setPresetIdx] = useState(0);
  const [seen, setSeen] = useState(0);
  const presetRef = useRef(presetIdx);
  presetRef.current = presetIdx;

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;
    const W = mount.clientWidth, H = 320;

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(50, W / H, 0.1, 100);
    camera.position.set(0, 0, 7);
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setSize(W, H);
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    mount.appendChild(renderer.domElement);

    // Axes for spatial grounding.
    scene.add(new THREE.AxesHelper(3));

    const group = new THREE.Group();
    scene.add(group);

    const nodes: { mesh: THREE.Mesh; sprite: THREE.Sprite; revealed: boolean }[] = [];
    const preset = PRESETS[presetRef.current];
    preset.terms.forEach(t => {
      const geo = new THREE.IcosahedronGeometry(0.55, 0);
      const mat = new THREE.MeshBasicMaterial({ color: t.color, wireframe: true, transparent: true, opacity: 0.35 });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(...t.pos);
      group.add(mesh);
      const sprite = labelSprite(t.label, t.color);
      sprite.position.set(t.pos[0], t.pos[1] + 0.9, t.pos[2]);
      group.add(sprite);
      nodes.push({ mesh, sprite, revealed: false });
    });

    // Mouse-orbit.
    let dragging = false, px = 0, py = 0;
    const onDown = (e: PointerEvent) => { dragging = true; px = e.clientX; py = e.clientY; };
    const onUp = () => { dragging = false; };
    const onMove = (e: PointerEvent) => {
      if (!dragging) return;
      group.rotation.y += (e.clientX - px) * 0.01;
      group.rotation.x += (e.clientY - py) * 0.01;
      px = e.clientX; py = e.clientY;
    };
    renderer.domElement.addEventListener('pointerdown', onDown);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointermove', onMove);

    // A node counts as "seen" once it faces the camera (z in world > 0).
    const camDir = new THREE.Vector3();
    let raf = 0;
    const tick = () => {
      raf = requestAnimationFrame(tick);
      if (!dragging) group.rotation.y += 0.0025;
      const world = new THREE.Vector3();
      nodes.forEach(n => {
        n.mesh.getWorldPosition(world);
        camera.getWorldDirection(camDir);
        const facing = world.clone().sub(camera.position).normalize().dot(camDir);
        const front = facing < 0.15; // roughly facing the camera
        const targetOp = front ? 0.95 : 0.18;
        const m = n.mesh.material as THREE.MeshBasicMaterial;
        m.opacity += (targetOp - m.opacity) * 0.1;
        n.sprite.material.opacity += ((front ? 1 : 0.15) - n.sprite.material.opacity) * 0.1;
        if (front && !n.revealed) { n.revealed = true; setSeen(s => s + 1); }
      });
      renderer.render(scene, camera);
    };
    tick();

    return () => {
      cancelAnimationFrame(raf);
      renderer.domElement.removeEventListener('pointerdown', onDown);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointermove', onMove);
      renderer.dispose();
      mount.removeChild(renderer.domElement);
    };
  }, [presetIdx]);

  const preset = PRESETS[presetIdx];
  return (
    <div className="p-4 flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <p className="text-[11px] uppercase tracking-[2px] text-white/40">Node Mapping · 3D</p>
        <select value={presetIdx} onChange={e => { setSeen(0); setPresetIdx(Number(e.target.value)); }}
          className="bg-white/5 border border-white/10 rounded-lg px-2 py-1 text-[11px] text-white/70 outline-none">
          {PRESETS.map((p, i) => <option key={i} value={i} className="bg-neutral-900">{p.name}</option>)}
        </select>
      </div>
      <div ref={mountRef} className="rounded-2xl bg-black overflow-hidden cursor-grab active:cursor-grabbing" style={{ height: 320 }} />
      <p className="text-xs text-white/60">{preset.hint}</p>
      <p className="text-[10px] text-white/40">
        Kéo để xoay trục toạ độ. Đã lộ diện {seen}/{preset.terms.length} biến số — xoay để tìm những biến đang khuất sau lưng.
      </p>
    </div>
  );
}
