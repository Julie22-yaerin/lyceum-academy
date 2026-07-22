/**
 * MembraneFlowTool (Tier 2 · Dynamic Flow & Membrane Simulation) — chemistry
 * (polarity, molecular size, H-bonding) is understood deepest as a live
 * dynamic system, not print. The "Purification Sandbox": the student is given
 * a stream of molecules (a Three.js particle system) and must tune a filter
 * membrane (pore size, surface charge) so the right species pass and the rest
 * are rejected. Wrong theory → the flow clogs or throws a side reaction.
 *
 * Brain: Visual-Spatial. Thinking: Applied first-principles.
 * Subjects: Physical Chemistry, Chemical Engineering.
 *
 * Raw three.js particles: each particle has size + charge; the membrane at
 * x=0 passes a particle only when pore ≥ size AND charge rule is satisfied.
 */
import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';

export default function MembraneFlowTool() {
  const mountRef = useRef<HTMLDivElement>(null);
  const [pore, setPore] = useState(0.5);       // 0..1 pore size
  const [charge, setCharge] = useState(0);     // -1 attract-neg .. +1 attract-pos
  const poreRef = useRef(pore); poreRef.current = pore;
  const chargeRef = useRef(charge); chargeRef.current = charge;
  const [stats, setStats] = useState({ passed: 0, rejected: 0 });

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;
    const W = mount.clientWidth, H = 300;

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(50, W / H, 0.1, 100);
    camera.position.set(0, 0, 9);
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setSize(W, H); renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    mount.appendChild(renderer.domElement);

    // The membrane plane at x = 0.
    const membrane = new THREE.Mesh(
      new THREE.PlaneGeometry(0.15, 7),
      new THREE.MeshBasicMaterial({ color: 0x60a5fa, transparent: true, opacity: 0.4, side: THREE.DoubleSide }),
    );
    scene.add(membrane);

    const N = 120;
    const geo = new THREE.SphereGeometry(1, 8, 8);
    type P = { mesh: THREE.Mesh; size: number; charge: number; vx: number; y: number; z: number; passed: boolean };
    const parts: P[] = [];
    let passed = 0, rejected = 0;

    function spawn(p?: P): P {
      const size = 0.15 + Math.random() * 0.45;
      const chg = Math.random() < 0.5 ? -1 : 1;
      const mesh = p?.mesh ?? new THREE.Mesh(geo, new THREE.MeshBasicMaterial());
      (mesh.material as THREE.MeshBasicMaterial).color.set(chg < 0 ? 0xf87171 : 0x34d399);
      mesh.scale.setScalar(size);
      mesh.position.set(-4.5, (Math.random() - 0.5) * 5.5, (Math.random() - 0.5) * 2);
      if (!p) scene.add(mesh);
      const np: P = p ?? { mesh, size, charge: chg, vx: 0.02 + Math.random() * 0.02, y: 0, z: 0, passed: false };
      np.size = size; np.charge = chg; np.vx = 0.02 + Math.random() * 0.02; np.passed = false;
      return np;
    }
    for (let i = 0; i < N; i++) parts.push(spawn());

    let raf = 0, frame = 0;
    const tick = () => {
      raf = requestAnimationFrame(tick);
      frame++;
      const poreSize = poreRef.current * 0.6;   // max passable size
      const chargeRule = chargeRef.current;      // >0 passes +, <0 passes -, ~0 passes both
      parts.forEach(p => {
        p.mesh.position.x += p.vx;
        // At the membrane, decide pass/reject.
        if (!p.passed && p.mesh.position.x >= -0.05 && p.mesh.position.x <= 0.1) {
          const fits = p.size <= poreSize;
          const chargeOk = Math.abs(chargeRule) < 0.2 || (chargeRule > 0 ? p.charge > 0 : p.charge < 0);
          if (fits && chargeOk) { p.passed = true; passed++; }
          else {
            // Rejected: bounce back left.
            p.vx = -(Math.abs(p.vx)); rejected++;
          }
          if ((passed + rejected) % 5 === 0) setStats({ passed, rejected });
        }
        // Respawn when off-screen either side.
        if (p.mesh.position.x > 5 || p.mesh.position.x < -5.5) spawn(p);
      });
      // Clog visual: if pore very small, membrane reddens.
      (membrane.material as THREE.MeshBasicMaterial).color.set(poreRef.current < 0.18 ? 0xf87171 : 0x60a5fa);
      renderer.render(scene, camera);
    };
    tick();

    return () => { cancelAnimationFrame(raf); renderer.dispose(); mount.removeChild(renderer.domElement); };
  }, []);

  return (
    <div className="p-4 flex flex-col gap-3">
      <p className="text-[11px] uppercase tracking-[2px] text-white/40">Purification Sandbox</p>
      <div ref={mountRef} className="rounded-2xl bg-black overflow-hidden" style={{ height: 300 }} />

      <div className="flex gap-4 text-[11px] text-white/60">
        <span>Đi qua: <span className="text-emerald-300">{stats.passed}</span></span>
        <span>Bị chặn: <span className="text-red-300">{stats.rejected}</span></span>
        <span className="text-white/40">🔴 âm · 🟢 dương</span>
      </div>

      <div>
        <div className="flex justify-between text-[10px] text-white/40 mb-1">
          <span>Kích thước lỗ màng</span><span>{Math.round(pore * 100)}%</span>
        </div>
        <input type="range" min={0} max={100} value={Math.round(pore * 100)}
          onChange={e => setPore(Number(e.target.value) / 100)} className="w-full accent-blue-400" />
      </div>
      <div>
        <div className="flex justify-between text-[10px] text-white/40 mb-1">
          <span>Điện tích bề mặt: hút ÂM</span><span>trung tính</span><span>hút DƯƠNG</span>
        </div>
        <input type="range" min={-100} max={100} value={Math.round(charge * 100)}
          onChange={e => setCharge(Number(e.target.value) / 100)} className="w-full" />
      </div>
      <p className="text-[10px] text-white/40">
        Tinh chỉnh lỗ màng & điện tích để chỉ đúng loại phân tử đi qua. Lỗ quá nhỏ → màng tắc (đỏ). Sai điện tích → phân tử bị đẩy ngược.
      </p>
    </div>
  );
}
