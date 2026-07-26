/**
 * thelyceum.site/{math,chemistry,biology,physics} — TRIP.
 *
 * The whole product loop, on one preset concept, with no account: read the
 * note, listen to the podcast while writing along, watch the short reel,
 * teach the concept back to Leo (the real Feynman-listener role), lay it out
 * on a Lotus Map. Nothing here is saved anywhere — it's a taste, not a
 * workspace, and the page says so.
 *
 * Standalone route (see App.tsx path-based routing), same pattern as
 * GamePage: no auth, no Quanta, no Second Brain.
 */
import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, Headphones, MessageCircleQuestion, Sparkles } from 'lucide-react';
import {
  getTripPreset, tripPodcastUrl, postTeachBack,
  type TripPreset, type TripSubject, type TeachBackResult,
} from '../lib/tripApi';
import LotusMapTool from '../components/tools/LotusMapTool';

const ACCENT: Record<TripSubject, string> = {
  math: 'text-violet-300',
  chemistry: 'text-cyan-300',
  biology: 'text-emerald-300',
  physics: 'text-amber-300',
};

function TeachBackPanel({ subject }: { subject: TripSubject }) {
  const [explanation, setExplanation] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<TeachBackResult | null>(null);
  const [error, setError] = useState('');
  const [turns, setTurns] = useState(0);

  // A demo, not a chat product: capped so one visitor on one browser tab
  // can't turn a free public page into an unmetered model-call loop.
  const MAX_TURNS = 3;

  async function submit() {
    if (busy || !explanation.trim() || turns >= MAX_TURNS) return;
    setBusy(true);
    setError('');
    try {
      const r = await postTeachBack(subject, explanation.trim());
      setResult(r);
      setTurns(t => t + 1);
    } catch {
      setError('Leo đang bận — thử lại sau vài giây.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="glass-card rounded-3xl p-6 flex flex-col gap-4">
      <div className="flex items-center gap-2">
        <MessageCircleQuestion className="w-5 h-5 text-white/70" />
        <h3 className="font-serif text-xl text-white">Giảng lại cho Leo</h3>
      </div>
      <p className="text-xs text-slate-400 leading-relaxed">
        Leo là một đứa trẻ 5 tuổi tò mò — không biết gì về chủ đề này. Giảng
        lại cho nó nghe. Nếu bạn chỉ học vẹt, nó sẽ hỏi ra ngay chỗ hổng.
      </p>
      <textarea
        value={explanation}
        onChange={e => setExplanation(e.target.value)}
        rows={4}
        placeholder="Giảng lại bằng lời của bạn…"
        className="w-full bg-white/5 rounded-xl px-3 py-2.5 text-sm text-slate-200 outline-none border border-white/10 focus:border-white/25 resize-y"
      />
      {error && <p className="text-xs text-red-300/80">{error}</p>}
      <button
        onClick={submit}
        disabled={busy || !explanation.trim() || turns >= MAX_TURNS}
        className="self-start rounded-xl px-5 py-2.5 text-[11px] uppercase tracking-[2px] bg-white/10 text-white hover:bg-white/15 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
      >
        {busy ? 'Leo đang nghe…' : turns >= MAX_TURNS ? 'Hết lượt thử miễn phí' : 'Giảng cho Leo nghe'}
      </button>

      {result && (
        <div className="mt-2 rounded-2xl bg-white/5 border border-white/10 p-4 flex flex-col gap-3">
          <p className="text-sm text-slate-200 leading-relaxed">{result.reaction}</p>
          {result.mode === 'questioning' && result.questions.length > 0 && (
            <ul className="flex flex-col gap-2">
              {result.questions.map((q, i) => (
                <li key={i} className="text-sm text-slate-300 leading-relaxed pl-3 border-l border-white/15">
                  {q}
                </li>
              ))}
            </ul>
          )}
          {result.mode === 'guidance' && result.guidance_content && (
            <p className="text-sm text-slate-300 leading-relaxed">{result.guidance_content}</p>
          )}
          {result.encouragement && (
            <p className="text-xs text-emerald-300/80">{result.encouragement}</p>
          )}
        </div>
      )}
    </div>
  );
}

export default function TripView({ subject }: { subject: TripSubject }) {
  const [preset, setPreset] = useState<TripPreset | null>(null);
  const [error, setError] = useState('');
  const [notes, setNotes] = useState('');
  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    getTripPreset(subject)
      .then(p => { if (!cancelled) setPreset(p); })
      .catch(() => { if (!cancelled) setError('Không tải được nội dung TRIP lúc này.'); });
    return () => { cancelled = true; };
  }, [subject]);

  const accent = ACCENT[subject];

  return (
    <div className="min-h-screen bg-[#050508] text-slate-200 font-sans antialiased">
      <div className="max-w-2xl mx-auto px-5 py-10 flex flex-col gap-8">
        <div className="flex items-center justify-between">
          <a href="/" className="flex items-center gap-1.5 text-xs text-slate-400 hover:text-white transition-colors">
            <ArrowLeft className="w-3.5 h-3.5" /> Về trang chủ
          </a>
          <p className="text-[10px] uppercase tracking-[3px] text-slate-500">TRIP · miễn phí · không cần đăng nhập</p>
        </div>

        {error && <p className="text-sm text-red-300/80">{error}</p>}

        {!preset ? (
          <div className="py-24 text-center font-serif text-xl tracking-[3px] uppercase text-white/30 animate-pulse">
            The Lyceum
          </div>
        ) : (
          <>
            <div>
              <p className={`text-xs uppercase tracking-[2px] mb-2 ${accent}`}>{preset.subject_label}</p>
              <h1 className="font-serif text-3xl text-white leading-tight">{preset.note_title}</h1>
              <p className="text-sm text-slate-500 mt-1">{preset.concept}</p>
            </div>

            {/* 1. Ready-made material */}
            <div className="glass-card rounded-3xl p-6">
              <p className="text-xs uppercase tracking-[2px] text-slate-400 mb-3">Tài liệu</p>
              <div className="text-[15px] text-slate-200 leading-[1.8] whitespace-pre-line">
                {preset.note_body}
              </div>
            </div>

            {/* 2. Podcast — listen and write along */}
            <div className="glass-card rounded-3xl p-6 flex flex-col gap-4">
              <div className="flex items-center gap-2">
                <Headphones className="w-5 h-5 text-white/70" />
                <h3 className="font-serif text-xl text-white">Nghe và chép lại</h3>
              </div>
              <audio ref={audioRef} controls preload="none" className="w-full" src={tripPodcastUrl(subject)} />
              <textarea
                value={notes}
                onChange={e => setNotes(e.target.value)}
                rows={4}
                placeholder="Vừa nghe vừa chép ý chính ở đây… (chỉ lưu trên máy bạn trong phiên này)"
                className="w-full bg-white/5 rounded-xl px-3 py-2.5 text-sm text-slate-200 outline-none border border-white/10 focus:border-white/25 resize-y"
              />
            </div>

            {/* 3. Brainrot short reel */}
            <div className="glass-card rounded-3xl p-6 flex flex-col items-center gap-3">
              <p className="text-xs uppercase tracking-[2px] text-slate-400 self-start">Reel giải trí ~14 giây</p>
              <video
                src={preset.reel_src}
                poster={preset.reel_poster}
                controls
                playsInline
                muted
                className="w-full max-w-[280px] aspect-[9/16] rounded-2xl bg-black/60 object-cover"
              />
            </div>

            {/* 4. Teach back to Leo */}
            <TeachBackPanel subject={subject} />

            {/* 5. Lotus Map, pre-seeded */}
            <div className="glass-card rounded-3xl overflow-hidden">
              <div className="p-6 pb-0 flex items-center gap-2">
                <Sparkles className="w-5 h-5 text-white/70" />
                <h3 className="font-serif text-xl text-white">Lotus Map</h3>
              </div>
              <LotusMapTool seedTopic={preset.lotus_seed} />
            </div>

            <div className="glass-card rounded-3xl p-6 text-center flex flex-col items-center gap-3">
              <p className="text-sm text-slate-300">
                Đây chỉ là một góc nhỏ. Bản đầy đủ có cả 4 môn, lịch học theo tuần,
                nhịp 45 phút học – nghỉ, và ôn tập theo lịch 3–7–21–30 ngày.
              </p>
              <a
                href="/?auth=1"
                className="rounded-xl px-6 py-3 text-[11px] uppercase tracking-[2px] bg-white text-black hover:bg-white/90 transition-colors"
              >
                Tạo tài khoản
              </a>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
