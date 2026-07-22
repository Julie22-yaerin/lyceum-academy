/**
 * AuditoryGatingTool (Tier 2 · Adaptive Auditory Gating) — the prefrontal
 * cortex sharpens focus when forced to filter noise for a core signal
 * (sensory gating). During a hard logic task the tool plays binaural beats
 * mixed with shifting white noise; as the student answers correctly the mix
 * gets clearer (consonant), and a wrong turn injects a slight dissonance that
 * jolts the brain into noticing the logical anomaly.
 *
 * Brain: Auditory / ADHD-leaning. Thinking: Convergent (one answer from chaos).
 * Subjects: Discrete Mathematics, Algorithms & Data Structures.
 *
 * Native Web Audio API: two detuned oscillators (binaural) + a noise buffer
 * whose gain and the oscillator detune are driven by a live "clarity" value.
 */
import { useEffect, useRef, useState } from 'react';

// A short chain of convergent logic puzzles (one right answer from options).
const PUZZLES = [
  { q: 'Số phần tử của tập lũy thừa (power set) của một tập 4 phần tử?', options: ['8', '12', '16', '32'], answer: 2 },
  { q: 'Độ phức tạp trung bình của tìm kiếm nhị phân?', options: ['O(1)', 'O(log n)', 'O(n)', 'O(n log n)'], answer: 1 },
  { q: 'Một đồ thị đơn 5 đỉnh đầy đủ (K5) có bao nhiêu cạnh?', options: ['5', '10', '15', '20'], answer: 1 },
  { q: 'Cấu trúc dữ liệu nào cho push/pop O(1) theo LIFO?', options: ['Queue', 'Stack', 'Heap', 'Tree'], answer: 1 },
];

export default function AuditoryGatingTool() {
  const [active, setActive] = useState(false);
  const [idx, setIdx] = useState(0);
  const [clarity, setClarity] = useState(0.15);   // 0 = pure noise, 1 = clean signal
  const [feedback, setFeedback] = useState('');
  const [done, setDone] = useState(false);

  const ctxRef = useRef<AudioContext | null>(null);
  const clarityRef = useRef(clarity);
  const nodesRef = useRef<{ noiseGain: GainNode; oscL: OscillatorNode; oscR: OscillatorNode; stop: () => void } | null>(null);
  clarityRef.current = clarity;

  function start() {
    const AC = window.AudioContext || (window as any).webkitAudioContext;
    if (!AC) return;
    const ctx: AudioContext = new AC();
    ctxRef.current = ctx;

    // White noise (the distractor to be gated out).
    const size = 2 * ctx.sampleRate;
    const buf = ctx.createBuffer(1, size, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < size; i++) data[i] = Math.random() * 2 - 1;
    const noise = ctx.createBufferSource(); noise.buffer = buf; noise.loop = true;
    const noiseGain = ctx.createGain(); noiseGain.gain.value = 0.12;
    noise.connect(noiseGain).connect(ctx.destination);

    // Binaural pair — a base tone in each ear, slightly detuned.
    const oscL = ctx.createOscillator(); oscL.type = 'sine'; oscL.frequency.value = 220;
    const oscR = ctx.createOscillator(); oscR.type = 'sine'; oscR.frequency.value = 228;
    const gL = ctx.createGain(); gL.gain.value = 0.05;
    const gR = ctx.createGain(); gR.gain.value = 0.05;
    const panL = new StereoPannerNode(ctx, { pan: -1 });
    const panR = new StereoPannerNode(ctx, { pan: 1 });
    oscL.connect(gL).connect(panL).connect(ctx.destination);
    oscR.connect(gR).connect(panR).connect(ctx.destination);

    noise.start(); oscL.start(); oscR.start();
    nodesRef.current = {
      noiseGain, oscL, oscR,
      stop: () => { noise.stop(); oscL.stop(); oscR.stop(); ctx.close(); },
    };

    // Drive the mix from clarity every frame.
    const loop = () => {
      if (!ctxRef.current) return;
      const c = clarityRef.current;
      noiseGain.gain.value = 0.16 * (1 - c);              // clearer = less noise
      oscR.frequency.value = 228 - 6 * c;                 // converge toward a consonant beat
      requestAnimationFrame(loop);
    };
    loop();
    setActive(true);
  }

  function stop() {
    try { nodesRef.current?.stop(); } catch { /* closed */ }
    nodesRef.current = null; ctxRef.current = null; setActive(false);
  }

  useEffect(() => () => stop(), []);

  // Briefly inject dissonance (detune the beat hard) then settle.
  function dissonancePulse() {
    const n = nodesRef.current; const ctx = ctxRef.current;
    if (!n || !ctx) return;
    n.oscR.frequency.setValueAtTime(228, ctx.currentTime);
    n.oscR.frequency.linearRampToValueAtTime(260, ctx.currentTime + 0.12);
    n.oscR.frequency.linearRampToValueAtTime(228, ctx.currentTime + 0.5);
  }

  function answer(choice: number) {
    if (done) return;
    const p = PUZZLES[idx];
    if (choice === p.answer) {
      setClarity(c => Math.min(1, c + 0.22));
      setFeedback('✓ Đúng — tín hiệu trong hơn.');
      setTimeout(() => {
        if (idx + 1 >= PUZZLES.length) { setDone(true); setFeedback('✦ Hoàn tất — bạn đã lọc được tín hiệu khỏi nhiễu.'); }
        else { setIdx(i => i + 1); setFeedback(''); }
      }, 700);
    } else {
      setClarity(c => Math.max(0.1, c - 0.15));
      setFeedback('✗ Lệch hướng — nghe thấy độ chói? Đó là tín hiệu logic bất thường.');
      dissonancePulse();
    }
  }

  const p = PUZZLES[idx];
  return (
    <div className="p-4 flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <p className="text-[11px] uppercase tracking-[2px] text-white/40">Auditory Gating</p>
        <button onClick={active ? stop : start}
          className={`rounded-full px-3 py-1 text-[10px] uppercase tracking-[2px] transition-colors ${
            active ? 'bg-red-400/20 text-red-200' : 'bg-white/10 text-white/60 hover:bg-white/20'
          }`}>
          {active ? '◉ audio on' : '○ bật âm thanh'}
        </button>
      </div>

      {!active && (
        <p className="text-xs text-white/50 leading-relaxed">
          Bật âm thanh (đeo tai nghe). Bạn sẽ nghe binaural beats trộn tiếng ồn trắng. Giải đúng → âm thanh trong trẻo dần;
          lệch hướng → có độ chói (dissonance) để ép não nhận ra bất thường.
        </p>
      )}

      {/* Clarity meter */}
      <div>
        <div className="flex items-center justify-between text-[10px] text-white/40 mb-1">
          <span>NHIỄU</span><span>TÍN HIỆU SẠCH</span>
        </div>
        <div className="h-2 rounded-full bg-white/10 overflow-hidden">
          <div className="h-full rounded-full transition-all duration-500"
            style={{ width: `${clarity * 100}%`, background: 'linear-gradient(to right, #f87171, #7ee0d0)' }} />
        </div>
      </div>

      {!done && (
        <div className="rounded-2xl bg-white/[0.03] p-4">
          <p className="text-sm text-white/90 mb-3">{p.q}</p>
          <div className="grid grid-cols-2 gap-2">
            {p.options.map((o, i) => (
              <button key={i} onClick={() => answer(i)}
                className="rounded-xl px-3 py-2.5 text-sm text-white/80 bg-white/5 hover:bg-white/10 border border-white/10 transition-colors">
                {o}
              </button>
            ))}
          </div>
        </div>
      )}

      {feedback && <p className={`text-xs ${feedback.startsWith('✓') || feedback.startsWith('✦') ? 'text-emerald-300' : 'text-amber-300'}`}>{feedback}</p>}
      <p className="text-[10px] text-white/30">{done ? 'Xong.' : `Câu ${idx + 1}/${PUZZLES.length}`}</p>
    </div>
  );
}
