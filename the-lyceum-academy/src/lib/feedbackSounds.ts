/**
 * Correct/incorrect answer feedback — synthesized tones (Web Audio API, no
 * audio files to host) plus spoken encouragement (Web Speech API) for wrong
 * answers.
 */

let _ctx: AudioContext | null = null;
function getCtx(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  const Ctor = window.AudioContext || (window as any).webkitAudioContext;
  if (!Ctor) return null;
  if (!_ctx) _ctx = new Ctor();
  if (_ctx.state === 'suspended') _ctx.resume().catch(() => {});
  return _ctx;
}

function playTone(ctx: AudioContext, freq: number, startTime: number, duration: number, type: OscillatorType, peakGain: number) {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, startTime);
  gain.gain.setValueAtTime(0, startTime);
  gain.gain.linearRampToValueAtTime(peakGain, startTime + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.001, startTime + duration);
  osc.connect(gain).connect(ctx.destination);
  osc.start(startTime);
  osc.stop(startTime + duration + 0.02);
}

/** Cheerful ascending arpeggio for a correct answer. */
export function playCorrectSound(): void {
  const ctx = getCtx();
  if (!ctx) return;
  const now = ctx.currentTime;
  [523.25, 659.25, 783.99, 1046.5].forEach((freq, i) => {
    playTone(ctx, freq, now + i * 0.09, 0.3, 'triangle', 0.18);
  });
}

/** Descending "aw shucks" tone for a wrong answer. */
export function playWrongSound(): void {
  const ctx = getCtx();
  if (!ctx) return;
  const now = ctx.currentTime;
  [392.0, 349.23, 329.63, 311.13].forEach((freq, i) => {
    playTone(ctx, freq, now + i * 0.19, 0.55, 'sawtooth', 0.1);
  });
}

/** Spoken encouragement — cancels any utterance already in flight first. */
export function speak(text: string): void {
  if (typeof window === 'undefined' || !window.speechSynthesis) return;
  window.speechSynthesis.cancel();
  const utter = new SpeechSynthesisUtterance(text);
  utter.rate = 0.95;
  utter.pitch = 1.05;
  window.speechSynthesis.speak(utter);
}
