/**
 * FloatingPodcast — a draggable, always-on-top mini player, independent of
 * the Tool Dock's modal system on purpose: the whole point is listening
 * while doing something else (Lotus Map, Sheet of Paper, a problem set).
 * Narrates pasted text or the seed text handed in via ToolDockContext
 * (e.g. "read this note aloud" / a script Coach wrote).
 *
 * Two narration backends: real server-side TTS (Cloudflare Workers AI, via
 * POST /ai/tts) when it's configured, otherwise the browser's own
 * speechSynthesis. The server voice sounds far better but needs a round trip,
 * so the fallback stays in place rather than being replaced — a student with
 * no TTS configured still gets audio.
 */
import { useEffect, useRef, useState } from 'react';
import { motion } from 'motion/react';
import { useToolDock } from '../context/ToolDockContext';
import { getTtsStatus, synthesizeSpeech } from '../lib/lyceumApi';

export default function FloatingPodcast() {
  const { podcastOpen, podcastSeedText, closePodcast } = useToolDock();
  const [text, setText] = useState(podcastSeedText || '');
  const [rate, setRate] = useState(1);
  const [speaking, setSpeaking] = useState(false);
  const [paused, setPaused] = useState(false);
  const [minimized, setMinimized] = useState(false);
  const [serverTts, setServerTts] = useState(false);
  const [loadingAudio, setLoadingAudio] = useState(false);
  const utterRef = useRef<SpeechSynthesisUtterance | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const audioUrlRef = useRef<string | null>(null);

  // Ask once whether the server can narrate; falls back silently if not.
  useEffect(() => {
    getTtsStatus().then(s => setServerTts(s.available)).catch(() => setServerTts(false));
  }, []);

  // The speed slider must affect audio already playing, not just the next
  // clip (speechSynthesis can't be re-rated mid-utterance, but audio can).
  useEffect(() => {
    if (audioRef.current) audioRef.current.playbackRate = rate;
  }, [rate]);

  function releaseAudio() {
    audioRef.current?.pause();
    audioRef.current = null;
    if (audioUrlRef.current) {
      URL.revokeObjectURL(audioUrlRef.current);
      audioUrlRef.current = null;
    }
  }

  useEffect(() => {
    if (podcastSeedText) setText(podcastSeedText);
  }, [podcastSeedText]);

  useEffect(() => {
    // Stop narration if the widget is closed outright.
    if (!podcastOpen) { window.speechSynthesis.cancel(); releaseAudio(); setSpeaking(false); setPaused(false); }
  }, [podcastOpen]);

  useEffect(() => () => { window.speechSynthesis.cancel(); releaseAudio(); }, []);

  const supported = typeof window !== 'undefined' && 'speechSynthesis' in window;

  function speakInBrowser() {
    if (!supported) return;
    window.speechSynthesis.cancel();
    const utter = new SpeechSynthesisUtterance(text.trim());
    utter.rate = rate;
    utter.onend = () => { setSpeaking(false); setPaused(false); };
    utter.onerror = () => { setSpeaking(false); setPaused(false); };
    utterRef.current = utter;
    window.speechSynthesis.speak(utter);
    setSpeaking(true); setPaused(false);
  }

  async function play() {
    if (!text.trim() || loadingAudio) return;
    if (!serverTts) { speakInBrowser(); return; }

    setLoadingAudio(true);
    try {
      releaseAudio();
      const url = await synthesizeSpeech(text.trim());
      audioUrlRef.current = url;
      const audio = new Audio(url);
      audio.playbackRate = rate;
      audio.onended = () => { setSpeaking(false); setPaused(false); };
      audio.onerror = () => { setSpeaking(false); setPaused(false); };
      audioRef.current = audio;
      await audio.play();
      setSpeaking(true); setPaused(false);
    } catch {
      // Server narration unavailable or refused — use the browser voice.
      speakInBrowser();
    } finally {
      setLoadingAudio(false);
    }
  }

  function togglePause() {
    if (!speaking) return;
    const audio = audioRef.current;
    if (audio) {
      if (paused) { audio.play().catch(() => {}); setPaused(false); }
      else { audio.pause(); setPaused(true); }
      return;
    }
    if (paused) { window.speechSynthesis.resume(); setPaused(false); }
    else { window.speechSynthesis.pause(); setPaused(true); }
  }

  function stop() {
    window.speechSynthesis.cancel();
    releaseAudio();
    setSpeaking(false); setPaused(false);
  }

  if (!podcastOpen) return null;

  if (minimized) {
    return (
      <motion.button
        drag dragMomentum={false}
        onClick={() => setMinimized(false)}
        className="fixed bottom-6 right-6 z-[250] w-12 h-12 rounded-full dock flex items-center justify-center text-white/80 hover:text-white cursor-grab active:cursor-grabbing"
        title="Reopen Floating Podcast"
      >
        <span className="material-symbols-outlined text-[20px]">{speaking ? 'graphic_eq' : 'podcasts'}</span>
      </motion.button>
    );
  }

  return (
    <motion.div
      drag dragMomentum={false} dragConstraints={{ left: -2000, right: 2000, top: -2000, bottom: 2000 }}
      className="fixed bottom-6 right-6 z-[250] w-80 dock rounded-2xl p-3 flex flex-col gap-2 cursor-grab active:cursor-grabbing"
    >
      <div className="flex items-center justify-between cursor-auto">
        <p className="text-[10px] uppercase tracking-[2px] text-white/50 flex items-center gap-1.5">
          <span className="material-symbols-outlined text-[14px]">podcasts</span> Floating Podcast
        </p>
        <div className="flex items-center gap-1">
          <button onClick={() => setMinimized(true)} className="text-white/40 hover:text-white/80 w-6 h-6 flex items-center justify-center">
            <span className="material-symbols-outlined text-[16px]">remove</span>
          </button>
          <button onClick={() => { stop(); closePodcast(); }} className="text-white/40 hover:text-white/80 w-6 h-6 flex items-center justify-center">
            <span className="material-symbols-outlined text-[16px]">close</span>
          </button>
        </div>
      </div>

      {!supported && (
        <p className="text-[11px] text-red-300/80 cursor-auto">Your browser doesn't support text-to-speech narration.</p>
      )}

      <textarea
        value={text} onChange={e => setText(e.target.value)}
        placeholder="Paste a note or article to narrate…"
        rows={3}
        className="cursor-auto w-full bg-white/5 rounded-lg px-2.5 py-2 text-[11px] text-white/80 outline-none border border-white/10 focus:border-white/25 resize-none"
      />

      <div className="cursor-auto flex items-center gap-2">
        <label className="text-[10px] text-white/40">Speed</label>
        <input type="range" min={0.6} max={1.6} step={0.1} value={rate}
          onChange={e => setRate(Number(e.target.value))}
          className="flex-1 accent-purple-400" />
        <span className="text-[10px] text-white/50 w-7 text-right">{rate.toFixed(1)}×</span>
      </div>

      <div className="cursor-auto flex gap-2">
        {!speaking ? (
          <button onClick={play} disabled={!supported || !text.trim()}
            className="flex-1 rounded-xl px-3 py-2 text-[10px] uppercase tracking-[2px] bg-purple-400/15 text-purple-200 hover:bg-purple-400/25 disabled:opacity-30 transition-colors">
            ▶ Play
          </button>
        ) : (
          <>
            <button onClick={togglePause}
              className="flex-1 rounded-xl px-3 py-2 text-[10px] uppercase tracking-[2px] bg-amber-400/15 text-amber-200 hover:bg-amber-400/25 transition-colors">
              {paused ? '▶ Resume' : '⏸ Pause'}
            </button>
            <button onClick={stop}
              className="flex-1 rounded-xl px-3 py-2 text-[10px] uppercase tracking-[2px] bg-white/10 text-white/60 hover:bg-white/20 transition-colors">
              ■ Stop
            </button>
          </>
        )}
      </div>
      <p className="cursor-auto text-[9px] text-white/25 text-center">Keep this open — drag it anywhere and keep working elsewhere.</p>
    </motion.div>
  );
}
