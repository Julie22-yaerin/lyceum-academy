/**
 * IllustrationTool — "Xiaohei Illustrations": paste an article, note, or
 * concept and get a short shot list plus generated 16:9 hand-drawn
 * illustrations, each starring Xiaohei — a small, solid-black, deadpan
 * creature that must perform the core action of the image, not decorate it.
 *
 * Adapted from the "ian-xiaohei-illustrations" style guide (MIT) into a
 * real Lyceum feature — see backend app.services.illustration. Generation
 * runs on the same local CPU tiny-diffusion pipeline Game Builder uses, so
 * it's slow (a minute or more per image) and a rough sketch approximation
 * of the style rather than a polished render.
 */
import { useState } from 'react';
import { generateIllustrations, type IllustrationShot } from '../../lib/lyceumApi';

export default function IllustrationTool() {
  const [text, setText] = useState('');
  const [maxShots, setMaxShots] = useState(5);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState('');
  const [shots, setShots] = useState<IllustrationShot[] | null>(null);
  const [error, setError] = useState('');

  async function handleGenerate() {
    if (!text.trim() || busy) return;
    setBusy(true); setError(''); setShots(null);
    setProgress('Reading content and planning shots…');
    try {
      const result = await generateIllustrations(text.trim(), maxShots);
      setShots(result.shots);
    } catch (e: any) {
      setError(e?.message || 'Illustration generation failed — please try again.');
    } finally {
      setBusy(false); setProgress('');
    }
  }

  return (
    <div className="p-4 flex flex-col gap-4">
      {!shots && (
        <>
          <p className="text-[11px] text-white/50 leading-relaxed">
            Paste an article, note, or a single concept. Xiaohei — a small black, deadpan creature —
            will act out one core idea per illustration: white background, hand-drawn black line, sparse
            colored annotations.
          </p>
          <textarea
            value={text} onChange={e => setText(e.target.value)} rows={8}
            placeholder="Paste text here…"
            className="w-full bg-white/5 rounded-xl px-3 py-2.5 text-sm text-white/85 outline-none border border-white/10 focus:border-white/25 resize-y"
          />
          <div className="flex items-center gap-3">
            <label className="text-[11px] text-white/50">Shots</label>
            <input
              type="range" min={1} max={9} value={maxShots}
              onChange={e => setMaxShots(Number(e.target.value))}
              className="flex-1 accent-purple-400"
            />
            <span className="text-xs text-white/70 w-4 text-center">{maxShots}</span>
          </div>
          <button
            onClick={handleGenerate}
            disabled={!text.trim() || busy}
            className="self-end rounded-xl px-5 py-2.5 text-[11px] uppercase tracking-[2px] bg-purple-400/15 text-purple-200 hover:bg-purple-400/25 disabled:opacity-40 transition-colors flex items-center gap-2"
          >
            {busy && <div className="w-3 h-3 border border-purple-200/40 border-t-purple-200 rounded-full animate-spin" />}
            {busy ? 'Generating…' : 'Generate illustrations'}
          </button>
          {busy && (
            <p className="text-[11px] text-white/40 text-center">
              {progress || 'Rendering locally — this can take a few minutes for several images. Leave this open.'}
            </p>
          )}
          {error && <p className="text-xs text-red-300/80">{error}</p>}
        </>
      )}

      {shots && (
        <div className="flex flex-col gap-4">
          <div className="flex items-center justify-between">
            <p className="text-[11px] uppercase tracking-[2px] text-white/40">{shots.length} shot{shots.length !== 1 ? 's' : ''}</p>
            <button onClick={() => { setShots(null); setText(''); }}
              className="text-[11px] text-white/50 hover:text-white/80 transition-colors">
              ← New illustration set
            </button>
          </div>
          {shots.map((s, i) => (
            <div key={i} className="rounded-2xl bg-white/[0.03] p-4 flex flex-col gap-2">
              <div className="flex items-center justify-between">
                <p className="text-sm text-white/90 font-medium">{i + 1}. {s.topic}</p>
                <span className="text-[9px] uppercase tracking-[2px] text-white/30">{s.structure_type}</span>
              </div>
              <p className="text-xs text-white/50">{s.core_idea}</p>
              {s.image_base64 ? (
                <img src={`data:image/png;base64,${s.image_base64}`} alt={s.topic}
                  className="w-full rounded-xl border border-white/10" />
              ) : (
                <div className="rounded-xl border border-white/10 bg-black/30 p-4 text-xs text-red-300/70">
                  Image generation unavailable{s.error ? `: ${s.error}` : '.'}
                </div>
              )}
              <p className="text-[10px] text-white/30">Xiaohei: {s.xiaohei_action}</p>
              {s.annotations?.length > 0 && (
                <p className="text-[10px] text-white/30">Annotations: {s.annotations.join(' · ')}</p>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
