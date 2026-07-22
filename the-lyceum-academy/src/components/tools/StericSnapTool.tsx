/**
 * StericSnapTool (Tier 2 · Steric Repulsion Snapping) — "affordance": when the
 * system physically refuses an action that violates a natural law, the motor
 * cortex remembers the principle for good. For organic chemistry: dragging a
 * bulky group (e.g. tert-butyl) into a cramped SN2 backside position doesn't
 * throw a text error — the UI spring-bounces it back out, its interface
 * literally resisting the hand, simulating real steric hindrance.
 *
 * Brain: Kinesthetic. Thinking: Procedural (reaction mechanism).
 * Subjects: Organic Chemistry, reaction mechanisms.
 *
 * motion's spring animation snaps a too-bulky group back; a small enough group
 * seats and locks.
 */
import { useState } from 'react';
import { motion, useAnimationControls } from 'motion/react';

interface Group { id: string; label: string; bulk: number; }   // bulk: van-der-Waals size

const GROUPS: Group[] = [
  { id: 'h', label: '–H', bulk: 1 },
  { id: 'me', label: '–CH₃ (methyl)', bulk: 2 },
  { id: 'et', label: '–C₂H₅ (ethyl)', bulk: 3 },
  { id: 'tbu', label: '–C(CH₃)₃ (tert-butyl)', bulk: 6 },
];

// SN2 backside attack tolerates only small groups on the reacting carbon.
const POCKET_TOLERANCE = 3;

export default function StericSnapTool() {
  const [seated, setSeated] = useState<Group | null>(null);
  const [msg, setMsg] = useState('');
  const controls = useAnimationControls();

  async function tryPlace(g: Group) {
    if (g.bulk > POCKET_TOLERANCE) {
      // Too bulky — the pocket rejects it: hard spring bounce outward.
      setMsg(`✗ ${g.label} quá cồng kềnh (bulk ×${g.bulk}) — lực đẩy không gian (steric hindrance) bật nó ra. SN2 tấn công mặt sau bị chặn.`);
      await controls.start({
        x: [0, 40, -12, 0],
        transition: { type: 'spring', stiffness: 700, damping: 8, duration: 0.5 },
      });
    } else {
      setSeated(g);
      setMsg(`✓ ${g.label} vừa khít — mặt sau đủ thoáng cho SN2. Chuyển tiếp trạng thái chuyển tiếp.`);
    }
  }

  return (
    <div className="p-4 flex flex-col gap-4">
      <p className="text-[11px] uppercase tracking-[2px] text-white/40">Steric Repulsion · SN2 backside</p>

      {/* The reacting carbon's backside pocket. */}
      <div className="rounded-2xl bg-white/[0.03] p-6 flex items-center justify-center min-h-[130px]">
        <motion.div
          animate={controls}
          className="relative flex items-center justify-center rounded-full"
          style={{
            width: 96, height: 96,
            border: '2px dashed rgba(255,255,255,0.25)',
            background: seated ? 'rgba(126,224,208,0.12)' : 'rgba(255,255,255,0.02)',
          }}
        >
          <span className="absolute -top-3 text-[9px] uppercase tracking-[2px] text-white/30">pocket</span>
          <span className="font-serif text-lg text-white/85">
            {seated ? seated.label.split(' ')[0] : 'C⁻'}
          </span>
        </motion.div>
      </div>

      <div className="grid grid-cols-2 gap-2">
        {GROUPS.map(g => (
          <button key={g.id} onClick={() => tryPlace(g)}
            className="rounded-xl px-3 py-2.5 text-sm text-white/80 bg-white/5 hover:bg-white/10 border border-white/10 transition-colors flex items-center justify-between">
            <span>{g.label}</span>
            <span className="text-[9px] text-white/35">bulk×{g.bulk}</span>
          </button>
        ))}
      </div>

      {msg && <p className={`text-xs ${msg.startsWith('✓') ? 'text-emerald-300' : 'text-amber-300'}`}>{msg}</p>}
      <p className="text-[10px] text-white/40">
        Thử đặt từng nhóm thế vào vị trí phản ứng. Nhóm càng cồng kềnh, giao diện càng "chống cự" — bật ra như lò xo, đúng như steric hindrance ngoài đời.
      </p>
    </div>
  );
}
