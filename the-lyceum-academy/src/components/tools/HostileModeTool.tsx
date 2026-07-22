/**
 * HostileModeTool (Tier 2) — "Asymmetric Sensory Overload". Weaponises the
 * browser against the prefrontal cortex: the Web Audio API sends an
 * asymmetric binaural load (a fast tone sweep in one ear, white noise in the
 * other), while the problem text is blurred and glitching — it only sharpens
 * word-by-word as the student hovers each word. Reading becomes an act of
 * deliberate, effortful attention.
 */
import { useEffect, useRef, useState } from 'react';

export default function HostileModeTool() {
  const [text, setText] = useState('');
  const [active, setActive] = useState(false);
  const [revealed, setRevealed] = useState<Set<number>>(new Set());
  const ctxRef = useRef<AudioContext | null>(null);
  const nodesRef = useRef<{ stop: () => void } | null>(null);

  function startAudio() {
    const AC = window.AudioContext || (window as any).webkitAudioContext;
    if (!AC) return;
    const ctx: AudioContext = new AC();
    ctxRef.current = ctx;

    // Left ear: white noise.
    const bufferSize = 2 * ctx.sampleRate;
    const noiseBuf = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const data = noiseBuf.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) data[i] = Math.random() * 2 - 1;
    const noise = ctx.createBufferSource();
    noise.buffer = noiseBuf; noise.loop = true;
    const noiseGain = ctx.createGain(); noiseGain.gain.value = 0.06;
    const panL = new StereoPannerNode(ctx, { pan: -1 });
    noise.connect(noiseGain).connect(panL).connect(ctx.destination);

    // Right ear: an unsettling sweeping oscillator.
    const osc = ctx.createOscillator(); osc.type = 'sawtooth';
    osc.frequency.value = 220;
    const oscGain = ctx.createGain(); oscGain.gain.value = 0.04;
    const panR = new StereoPannerNode(ctx, { pan: 1 });
    osc.connect(oscGain).connect(panR).connect(ctx.destination);

    // Slow LFO on the sweep so it never settles.
    const lfo = ctx.createOscillator(); lfo.frequency.value = 0.2;
    const lfoGain = ctx.createGain(); lfoGain.gain.value = 140;
    lfo.connect(lfoGain).connect(osc.frequency);

    noise.start(); osc.start(); lfo.start();
    nodesRef.current = { stop: () => { noise.stop(); osc.stop(); lfo.stop(); ctx.close(); } };
  }

  function stopAudio() {
    try { nodesRef.current?.stop(); } catch { /* already closed */ }
    nodesRef.current = null; ctxRef.current = null;
  }

  useEffect(() => () => stopAudio(), []);

  function toggle() {
    if (active) { stopAudio(); setActive(false); }
    else { startAudio(); setActive(true); }
  }

  const words = text.split(/(\s+)/);

  return (
    <div className="p-4 flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <p className="text-[11px] uppercase tracking-[2px] text-white/40">Hostile Environment</p>
        <button onClick={toggle}
          className={`rounded-full px-3 py-1 text-[10px] uppercase tracking-[2px] transition-colors ${
            active ? 'bg-red-400/20 text-red-200' : 'bg-white/10 text-white/60 hover:bg-white/20'
          }`}>
          {active ? '◉ overload on' : '○ overload off'}
        </button>
      </div>

      {!text && (
        <textarea
          value={text} onChange={e => setText(e.target.value)} rows={4}
          placeholder="Paste the passage you must read under duress…"
          className="w-full bg-white/5 rounded-xl px-3 py-2 text-sm text-white/85 outline-none border border-white/10 focus:border-white/25 resize-y"
        />
      )}

      {text && (
        <div className={`rounded-2xl p-4 leading-loose text-[15px] min-h-[140px] ${active ? 'hostile-glitch' : ''}`}>
          {words.map((w, i) => {
            if (/^\s+$/.test(w)) return <span key={i}>{w}</span>;
            const shown = !active || revealed.has(i);
            return (
              <span
                key={i}
                onMouseEnter={() => active && setRevealed(s => new Set(s).add(i))}
                className="transition-all duration-150"
                style={{
                  filter: shown ? 'none' : 'blur(5px)',
                  opacity: shown ? 1 : 0.55,
                  color: shown ? 'rgba(255,255,255,0.92)' : 'rgba(255,255,255,0.5)',
                }}
              >
                {w}
              </span>
            );
          })}
        </div>
      )}

      {text && (
        <p className="text-[10px] text-white/30">
          {active
            ? 'Hover each word to bring it into focus. The audio load is asymmetric by design.'
            : 'Turn overload on to blur the text and load the asymmetric audio.'}
        </p>
      )}

      {text && (
        <button onClick={() => { setText(''); setRevealed(new Set()); }}
          className="self-end text-[10px] uppercase tracking-[2px] text-white/40 hover:text-white/70 transition-colors">
          new passage
        </button>
      )}

      <style>{`
        @keyframes hostileGlitch {
          0%,100% { transform: translate(0,0); }
          92% { transform: translate(0,0); }
          94% { transform: translate(-1px,1px); filter: hue-rotate(20deg); }
          96% { transform: translate(1px,-1px); }
          98% { transform: translate(-1px,0); }
        }
        .hostile-glitch { animation: hostileGlitch 2.4s infinite; }
      `}</style>
    </div>
  );
}
