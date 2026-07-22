/**
 * TopoLockTool (Tier 2 · Morphological Computation) — in biology, form
 * determines function; advanced biological thinking is 3D geometric, not
 * memorising enzyme names. The "Topological Lock": a target substrate floats
 * in 3D and the student bends/scales a virtual active site to wrap snugly
 * around it. The closer the geometric fit, the higher the affinity score —
 * forcing spatial reasoning over rote sequence recall.
 *
 * Brain: Visual-Spatial. Thinking: Geometric / Top-Down.
 * Subjects: Molecular Biology, Biochemistry.
 *
 * Raw three.js: the substrate has a hidden target shape (width/height/twist);
 * the student drives three sliders to morph the active-site cage; affinity is
 * the inverse distance between the cage params and the target.
 */
import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';

export default function TopoLockTool() {
  const mountRef = useRef<HTMLDivElement>(null);
  const [target] = useState(() => ({
    w: 0.4 + Math.random() * 0.5,
    h: 0.4 + Math.random() * 0.5,
    twist: Math.random() * Math.PI,
  }));
  const [w, setW] = useState(0.7);
  const [h, setH] = useState(0.7);
  const [twist, setTwist] = useState(0.5);
  const paramRef = useRef({ w, h, twist });
  paramRef.current = { w, h, twist };

  const affinity = Math.max(0, 1 - (
    Math.abs(w - target.w) + Math.abs(h - target.h) + Math.abs(twist * Math.PI - target.twist) / Math.PI
  ) / 2.2);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;
    const W = mount.clientWidth, H = 300;
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(50, W / H, 0.1, 100);
    camera.position.set(0, 0, 6);
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setSize(W, H); renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    mount.appendChild(renderer.domElement);
    scene.add(new THREE.AmbientLight(0xffffff, 0.8));
    const dl = new THREE.DirectionalLight(0xffffff, 0.7); dl.position.set(3, 4, 5); scene.add(dl);

    // Substrate — the fixed target molecule.
    const substrate = new THREE.Mesh(
      new THREE.TorusKnotGeometry(0.6, 0.22, 80, 12),
      new THREE.MeshStandardMaterial({ color: 0xf9a8d4, flatShading: true }),
    );
    substrate.scale.set(target.w * 1.6, target.h * 1.6, 1);
    substrate.rotation.z = target.twist;
    scene.add(substrate);

    // Active-site cage — the thing the student morphs.
    const cage = new THREE.Mesh(
      new THREE.BoxGeometry(2, 2, 2, 2, 2, 2),
      new THREE.MeshBasicMaterial({ color: 0x7ee0d0, wireframe: true, transparent: true, opacity: 0.5 }),
    );
    scene.add(cage);

    let raf = 0;
    const tick = () => {
      raf = requestAnimationFrame(tick);
      const p = paramRef.current;
      cage.scale.set(1 + p.w, 1 + p.h, 1.4);
      cage.rotation.z = p.twist * Math.PI;
      substrate.rotation.y += 0.006;
      cage.rotation.y = substrate.rotation.y;
      // Colour cage green as it converges on the target.
      const aff = Math.max(0, 1 - (Math.abs(p.w - target.w) + Math.abs(p.h - target.h) + Math.abs(p.twist * Math.PI - target.twist) / Math.PI) / 2.2);
      (cage.material as THREE.MeshBasicMaterial).color.setRGB(1 - aff, 0.4 + aff * 0.5, 0.5 + aff * 0.3);
      (cage.material as THREE.MeshBasicMaterial).opacity = 0.3 + aff * 0.5;
      renderer.render(scene, camera);
    };
    tick();
    return () => { cancelAnimationFrame(raf); renderer.dispose(); mount.removeChild(renderer.domElement); };
  }, [target]);

  const locked = affinity > 0.9;
  return (
    <div className="p-4 flex flex-col gap-3">
      <p className="text-[11px] uppercase tracking-[2px] text-white/40">Topological Lock</p>
      <div ref={mountRef} className="rounded-2xl bg-black overflow-hidden" style={{ height: 300 }} />

      <div>
        <div className="flex justify-between text-[10px] text-white/40 mb-1">
          <span>Affinity score</span><span className={locked ? 'text-emerald-300' : ''}>{Math.round(affinity * 100)}%</span>
        </div>
        <div className="h-2 rounded-full bg-white/10 overflow-hidden">
          <div className="h-full rounded-full transition-all" style={{ width: `${affinity * 100}%`, background: locked ? '#34d399' : 'linear-gradient(to right,#f87171,#7ee0d0)' }} />
        </div>
      </div>

      {[
        ['Bề rộng ổ khoá', w, setW],
        ['Chiều cao ổ khoá', h, setH],
        ['Độ xoắn', twist, setTwist],
      ].map(([label, val, set], i) => (
        <div key={i}>
          <p className="text-[10px] text-white/40 mb-0.5">{label as string}</p>
          <input type="range" min={0} max={100} value={Math.round((val as number) * 100)}
            onChange={e => (set as (n: number) => void)(Number(e.target.value) / 100)}
            className="w-full accent-emerald-400" />
        </div>
      ))}

      <p className={`text-xs ${locked ? 'text-emerald-300' : 'text-white/50'}`}>
        {locked
          ? '✦ Khớp cấu trúc! Ổ khoá (active site) bọc vừa khít cơ chất — cấu trúc quyết định chức năng.'
          : 'Nắn ổ khoá để bọc vừa khít cơ chất đang xoay. Càng khít, affinity càng cao.'}
      </p>
    </div>
  );
}
