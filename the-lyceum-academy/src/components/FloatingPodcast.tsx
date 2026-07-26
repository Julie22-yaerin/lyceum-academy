/**
 * FloatingPodcast — a draggable, always-on-top mini player, independent of
 * the Tool Dock's modal system on purpose: the whole point is listening
 * while doing something else (Lotus Map, Sheet of Paper, a problem set).
 *
 * Primary flow: generate a produced script from the student's OWN material
 * (their Second Brain notes for the active subject) via the Elite Audio
 * Producer prompt (POST /ai/podcast/script — see backend/app/services/
 * podcast_script.py), then narrate that. Podcasts are built from material,
 * not from whatever gets pasted in — pasting is kept only as a fallback
 * ("Dán tay") for the rare case of narrating something that isn't in the
 * Second Brain yet (e.g. a quick external snippet).
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
import { useWorkspace } from '../context/WorkspaceContext';
import {
  getTtsStatus, synthesizeSpeech, getPodcastMaterialStatus, generatePodcastScript,
  type PodcastFormat,
} from '../lib/lyceumApi';
import { SUBJECT_META } from '../lib/persist';

const FORMATS: { id: PodcastFormat; label: string; hint: string }[] = [
  { id: '1', label: 'Storyteller', hint: '1 người · độc thoại' },
  { id: '2', label: 'Explorers', hint: '2 người · Expert & học trò' },
  { id: '3', label: 'Gladiators', hint: '2 người · tranh biện' },
];

export default function FloatingPodcast() {
  const { podcastOpen, podcastSeedText, closePodcast } = useToolDock();
  const { activeTab } = useWorkspace();
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

  const [mode, setMode] = useState<'generate' | 'paste'>('generate');
  const [subject, setSubject] = useState(() => (activeTab && SUBJECT_META[activeTab] ? activeTab : 'other'));
  const [format, setFormat] = useState<PodcastFormat>('1');
  const [topic, setTopic] = useState('');
  const [hasMaterial, setHasMaterial] = useState<boolean | null>(null);
  const [generating, setGenerating] = useState(false);
  const [genError, setGenError] = useState('');

  useEffect(() => {
    if (activeTab && SUBJECT_META[activeTab]) setSubject(activeTab);
  }, [activeTab]);

  // Ask once whether the server can narrate; falls back silently if not.
  useEffect(() => {
    getTtsStatus().then(s => setServerTts(s.available)).catch(() => setServerTts(false));
  }, []);

  useEffect(() => {
    if (mode !== 'generate') return;
    let cancelled = false;
    setHasMaterial(null);
    getPodcastMaterialStatus(subject)
      .then(r => { if (!cancelled) setHasMaterial(r.has_material); })
      .catch(() => { if (!cancelled) setHasMaterial(null); });
    return () => { cancelled = true; };
  }, [subject, mode]);

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
    if (podcastSeedText) { setText(podcastSeedText); setMode('paste'); }
  }, [podcastSeedText]);

  useEffect(() => {
    // Stop narration if the widget is closed outright.
    if (!podcastOpen) { window.speechSynthesis.cancel(); releaseAudio(); setSpeaking(false); setPaused(false); }
  }, [podcastOpen]);

  useEffect(() => () => { window.speechSynthesis.cancel(); releaseAudio(); }, []);

  const supported = typeof window !== 'undefined' && 'speechSynthesis' in window;

  async function generateScript() {
    if (generating) return;
    setGenerating(true);
    setGenError('');
    try {
      const r = await generatePodcastScript(subject, format, topic.trim());
      setText(r.script);
    } catch (e) {
      setGenError(e instanceof Error ? e.message : 'Không tạo được kịch bản.');
    } finally {
      setGenerating(false);
    }
  }

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
      className="fixed bottom-6 right-6 z-[250] w-96 dock rounded-2xl p-3 flex flex-col gap-2.5 cursor-grab active:cursor-grabbing"
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

      <div className="cursor-auto flex gap-1 bg-white/5 rounded-lg p-0.5">
        <button
          onClick={() => setMode('generate')}
          className={`flex-1 rounded-md py-1.5 text-[10px] uppercase tracking-[1.5px] transition-colors ${mode === 'generate' ? 'bg-purple-400/20 text-purple-200' : 'text-white/45 hover:text-white/70'}`}
        >
          Tạo từ tài liệu
        </button>
        <button
          onClick={() => setMode('paste')}
          className={`flex-1 rounded-md py-1.5 text-[10px] uppercase tracking-[1.5px] transition-colors ${mode === 'paste' ? 'bg-purple-400/20 text-purple-200' : 'text-white/45 hover:text-white/70'}`}
        >
          Dán tay
        </button>
      </div>

      {mode === 'generate' ? (
        <div className="cursor-auto flex flex-col gap-2">
          <div className="flex gap-2">
            <select
              value={subject} onChange={e => setSubject(e.target.value)}
              className="flex-1 bg-white/5 rounded-lg px-2 py-1.5 text-[11px] text-white/80 outline-none border border-white/10 focus:border-white/25"
            >
              {Object.entries(SUBJECT_META).map(([key, meta]) => (
                <option key={key} value={key} className="bg-[#141824]">{meta.icon} {meta.label}</option>
              ))}
            </select>
          </div>

          <div className="flex gap-1.5">
            {FORMATS.map(f => (
              <button
                key={f.id}
                onClick={() => setFormat(f.id)}
                title={f.hint}
                className={`flex-1 rounded-lg px-1.5 py-1.5 text-[10px] transition-colors ${format === f.id ? 'bg-purple-400/20 text-purple-200 border border-purple-400/40' : 'bg-white/5 text-white/55 hover:bg-white/10 border border-transparent'}`}
              >
                {f.label}
              </button>
            ))}
          </div>

          <input
            value={topic} onChange={e => setTopic(e.target.value)}
            placeholder="Công thức/khái niệm cụ thể (bỏ trống = AI tự chọn)"
            className="w-full bg-white/5 rounded-lg px-2.5 py-1.5 text-[11px] text-white/80 outline-none border border-white/10 focus:border-white/25 placeholder:text-white/25"
          />

          {hasMaterial === false && (
            <p className="text-[10px] text-amber-300/80 leading-relaxed">
              Chưa có tài liệu cho môn này. Upload tài liệu, tạo Second Brain, hoặc dùng AI Research trước — nếu để trống AI vẫn thử tạo từ chủ đề bạn nhập ở trên.
            </p>
          )}
          {genError && <p className="text-[10px] text-red-300/80">{genError}</p>}

          <button
            onClick={generateScript}
            disabled={generating || (hasMaterial === false && !topic.trim())}
            className="rounded-xl px-3 py-2 text-[10px] uppercase tracking-[2px] bg-purple-400/15 text-purple-200 hover:bg-purple-400/25 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
          >
            {generating ? 'Đang dựng kịch bản…' : 'Tạo kịch bản'}
          </button>

          {text.trim() && !generating && (
            <p className="text-[10px] text-white/35 line-clamp-2 leading-relaxed">{text.trim()}</p>
          )}
        </div>
      ) : (
        <textarea
          value={text} onChange={e => setText(e.target.value)}
          placeholder="Dán một đoạn văn để đọc trực tiếp (không qua bước tạo kịch bản)…"
          rows={3}
          className="cursor-auto w-full bg-white/5 rounded-lg px-2.5 py-2 text-[11px] text-white/80 outline-none border border-white/10 focus:border-white/25 resize-none"
        />
      )}

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
