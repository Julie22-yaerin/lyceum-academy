/**
 * ShatterTool (Tier 2 · Prediction Error Shatter) — the brain releases the
 * most dopamine (and encodes hardest) on a Prediction Error: when reality
 * violently contradicts the prediction. The "Axiom Destructor": the student
 * proposes a hypothesis to run a system. If it breaks a law (thermodynamics,
 * conservation…), the 3D system doesn't print "wrong" — it shatters into
 * shards the student must pick back up (re-assemble the axioms) to rebuild.
 *
 * Brain: Analytical-Logical. Thinking: First-Principles.
 * Subjects: Thermodynamics, Electromagnetism.
 *
 * Raw three.js: an intact icosahedron = the coherent system. A law-violating
 * hypothesis explodes it into flying fragments; the student clicks each shard
 * to reclaim it, and once all are reclaimed the system re-forms.
 */
import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';

const CHALLENGES = [
  {
    prompt: 'Mô hình làm mát bay hơi: đề xuất giả thuyết vận hành hệ thống.',
    law: 'Định luật 2 Nhiệt động lực học (entropy không tự giảm).',
    violates: (h: string) => /nhiệt tự truyền từ lạnh sang nóng|entropy giảm|tự làm mát mãi mãi|100% hiệu suất|vĩnh cửu|perpetual/i.test(h),
    goodHint: 'Đúng hướng: bay hơi hấp thụ nhiệt ẩn, cần nguồn năng lượng để duy trì.',
  },
  {
    prompt: 'Mạch điện: đề xuất cách tạo dòng điện duy trì.',
    law: 'Bảo toàn năng lượng (không có năng lượng miễn phí).',
    violates: (h: string) => /tự sinh năng lượng|không cần nguồn|năng lượng miễn phí|free energy|vĩnh cửu|perpetual|tự chạy mãi/i.test(h),
    goodHint: 'Đúng hướng: cần một suất điện động (nguồn) chuyển hoá năng lượng.',
  },
];

export default function ShatterTool() {
  const mountRef = useRef<HTMLDivElement>(null);
  const shatterRef = useRef<(() => void) | null>(null);
  const reformRef = useRef<(() => void) | null>(null);
  const [challengeIdx] = useState(() => Math.floor(Math.random() * CHALLENGES.length));
  const [hypothesis, setHypothesis] = useState('');
  const [state, setState] = useState<'intact' | 'shattered' | 'reformed'>('intact');
  const [msg, setMsg] = useState('');
  const [shardsLeft, setShardsLeft] = useState(0);

  const challenge = CHALLENGES[challengeIdx];

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;
    const W = mount.clientWidth, H = 300;

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(50, W / H, 0.1, 100);
    camera.position.set(0, 0, 6);
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setSize(W, H);
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    mount.appendChild(renderer.domElement);
    scene.add(new THREE.AmbientLight(0xffffff, 0.7));
    const dir = new THREE.DirectionalLight(0xffffff, 0.8); dir.position.set(3, 4, 5); scene.add(dir);

    // The intact system.
    const core = new THREE.Mesh(
      new THREE.IcosahedronGeometry(1.6, 1),
      new THREE.MeshStandardMaterial({ color: 0x7ee0d0, flatShading: true, metalness: 0.2, roughness: 0.5 }),
    );
    scene.add(core);

    // Shards (hidden until shatter).
    const shards: THREE.Mesh[] = [];
    const shardVel: THREE.Vector3[] = [];
    const reclaimed = new Set<number>();
    for (let i = 0; i < 14; i++) {
      const m = new THREE.Mesh(
        new THREE.TetrahedronGeometry(0.4 + Math.random() * 0.3),
        new THREE.MeshStandardMaterial({ color: 0xf87171, flatShading: true }),
      );
      m.visible = false;
      m.userData.idx = i;
      shards.push(m); scene.add(m);
      shardVel.push(new THREE.Vector3((Math.random() - 0.5), (Math.random() - 0.5), (Math.random() - 0.5)).multiplyScalar(0.05));
    }

    let shattered = false;
    shatterRef.current = () => {
      shattered = true; core.visible = false;
      shards.forEach((s, i) => { s.visible = true; s.position.set(0, 0, 0); reclaimed.delete(i); });
      setShardsLeft(shards.length);
    };
    reformRef.current = () => {
      shattered = false; core.visible = true;
      shards.forEach(s => s.visible = false);
    };

    // Click a shard to reclaim it.
    const ray = new THREE.Raycaster();
    const onClick = (e: MouseEvent) => {
      if (!shattered) return;
      const rect = renderer.domElement.getBoundingClientRect();
      const mouse = new THREE.Vector2(
        ((e.clientX - rect.left) / rect.width) * 2 - 1,
        -((e.clientY - rect.top) / rect.height) * 2 + 1,
      );
      ray.setFromCamera(mouse, camera);
      const hit = ray.intersectObjects(shards.filter(s => s.visible))[0];
      if (hit) {
        const idx = (hit.object as THREE.Mesh).userData.idx as number;
        hit.object.visible = false;
        reclaimed.add(idx);
        const left = shards.length - reclaimed.size;
        setShardsLeft(left);
        if (left === 0) { reformRef.current?.(); setState('reformed'); setMsg('✦ Bạn đã ghép lại hệ thống từ nguyên lý gốc.'); }
      }
    };
    renderer.domElement.addEventListener('click', onClick);

    let raf = 0;
    const tick = () => {
      raf = requestAnimationFrame(tick);
      if (!shattered) { core.rotation.y += 0.006; core.rotation.x += 0.003; }
      else shards.forEach((s, i) => {
        if (!s.visible) return;
        s.position.addScaledVector(shardVel[i], 1);
        s.rotation.x += 0.04; s.rotation.y += 0.05;
        // Keep them roughly in frame.
        if (s.position.length() > 3.2) shardVel[i].multiplyScalar(-1);
      });
      renderer.render(scene, camera);
    };
    tick();

    return () => {
      cancelAnimationFrame(raf);
      renderer.domElement.removeEventListener('click', onClick);
      renderer.dispose();
      mount.removeChild(renderer.domElement);
    };
  }, []);

  function submit() {
    const h = hypothesis.trim();
    if (!h) return;
    if (challenge.violates(h)) {
      setState('shattered');
      setMsg('✗ Giả thuyết vi phạm ' + challenge.law + ' — hệ thống vỡ nát. Nhặt lại từng mảnh Axiom (bấm vào các mảnh).');
      shatterRef.current?.();
    } else {
      setState('intact');
      setMsg('✓ Không vi phạm định luật rõ ràng. ' + challenge.goodHint);
    }
  }

  return (
    <div className="p-4 flex flex-col gap-3">
      <p className="text-[11px] uppercase tracking-[2px] text-white/40">Axiom Destructor</p>
      <div ref={mountRef} className="rounded-2xl bg-black overflow-hidden" style={{ height: 300 }} />
      <p className="text-sm text-white/80">{challenge.prompt}</p>
      <p className="text-[10px] text-white/40">Ràng buộc: {challenge.law}</p>

      {state !== 'shattered' && (
        <div className="flex gap-2">
          <input
            value={hypothesis} onChange={e => setHypothesis(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') submit(); }}
            placeholder="Nhập giả thuyết vận hành hệ thống…"
            className="flex-1 bg-white/5 rounded-xl px-3 py-2 text-sm text-white/85 outline-none border border-white/10 focus:border-white/25"
          />
          <button onClick={submit}
            className="rounded-xl px-4 py-2 text-[11px] uppercase tracking-[2px] bg-purple-400/15 text-purple-200 hover:bg-purple-400/25 transition-colors">
            Chạy
          </button>
        </div>
      )}
      {state === 'shattered' && (
        <p className="text-xs text-red-300">Còn {shardsLeft} mảnh cần nhặt lại — bấm vào từng mảnh vỡ trong khung 3D.</p>
      )}
      {msg && <p className={`text-xs ${state === 'shattered' ? 'text-red-300/90' : state === 'reformed' ? 'text-emerald-300' : 'text-white/60'}`}>{msg}</p>}
    </div>
  );
}
