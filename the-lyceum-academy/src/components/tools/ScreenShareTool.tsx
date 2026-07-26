/**
 * ScreenShareTool — "Share Screen with AI".
 *
 * Capture/crop mechanics live in ScreenCropCapture (shared with the
 * Illustration tool's "scan a region" step) — this component owns what
 * happens after: the crop pins as a chip on a chat panel that slides in on
 * the right. Free-form questions stay Socratic (the house rule — a question
 * back, not an answer), but the two quick-command presets ("Kiểm tra",
 * "Tại sao") are explicit answer requests and get real answers — see
 * backend/app/services/ai.py's _SCREEN_SHARE_COMMAND_PROMPTS. "Tạo
 * illustration" routes the crop through the illustration pipeline instead
 * of the chat model entirely (POST /ai/screen-share/illustrate).
 *
 * Mounted directly by ToolDock (bypassing its generic modal wrapper) so
 * this can own the whole viewport instead of living in a centered card.
 */
import { useEffect, useRef, useState } from 'react';
import {
  analyzeScreenShare, illustrateScreenShare, type ScreenShareCommand, type IllustrationShot,
} from '../../lib/lyceumApi';
import ScreenCropCapture from './ScreenCropCapture';

type ChatTurn =
  | { role: 'user'; kind: 'command'; label: string }
  | { role: 'user'; kind: 'text'; text: string }
  | { role: 'ai'; kind: 'comment'; text: string }
  | { role: 'ai'; kind: 'illustration'; shots: IllustrationShot[] }
  | { role: 'ai'; kind: 'error'; text: string };

const QUICK_COMMANDS: { id: ScreenShareCommand; label: string }[] = [
  { id: 'kiem_tra', label: 'Kiểm tra' },
  { id: 'tai_sao', label: 'Tại sao' },
];

export default function ScreenShareTool({ onClose }: { onClose: () => void }) {
  const [cropDataUrl, setCropDataUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [turns, setTurns] = useState<ChatTurn[]>([]);
  const [input, setInput] = useState('');
  const chatEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => { chatEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [turns]);

  function handleCropped(dataUrl: string) {
    setCropDataUrl(dataUrl);
    setTurns([]);
  }

  async function sendCommand(command: ScreenShareCommand, label: string) {
    if (!cropDataUrl || busy) return;
    setBusy(true);
    setTurns(t => [...t, { role: 'user', kind: 'command', label }]);
    try {
      const result = await analyzeScreenShare(cropDataUrl, '', command);
      setTurns(t => [...t, { role: 'ai', kind: 'comment', text: result.comment }]);
    } catch (e) {
      setTurns(t => [...t, { role: 'ai', kind: 'error', text: e instanceof Error ? e.message : 'Không phân tích được.' }]);
    } finally {
      setBusy(false);
    }
  }

  async function sendIllustrate() {
    if (!cropDataUrl || busy) return;
    setBusy(true);
    setTurns(t => [...t, { role: 'user', kind: 'command', label: 'Tạo illustration' }]);
    try {
      const result = await illustrateScreenShare(cropDataUrl);
      setTurns(t => [...t, { role: 'ai', kind: 'illustration', shots: result.shots }]);
    } catch (e) {
      setTurns(t => [...t, { role: 'ai', kind: 'error', text: e instanceof Error ? e.message : 'Không tạo được illustration.' }]);
    } finally {
      setBusy(false);
    }
  }

  async function sendText() {
    const text = input.trim();
    if (!text || !cropDataUrl || busy) return;
    setInput('');
    setBusy(true);
    setTurns(t => [...t, { role: 'user', kind: 'text', text }]);
    try {
      const result = await analyzeScreenShare(cropDataUrl, text, '');
      setTurns(t => [...t, { role: 'ai', kind: 'comment', text: result.comment }]);
    } catch (e) {
      setTurns(t => [...t, { role: 'ai', kind: 'error', text: e instanceof Error ? e.message : 'Không phân tích được.' }]);
    } finally {
      setBusy(false);
    }
  }

  if (!cropDataUrl) {
    return <ScreenCropCapture title="Kéo chuột để chọn vùng cần hỏi AI" onCropped={handleCropped} onCancel={onClose} />;
  }

  return (
    <div className="fixed inset-0 z-[195] bg-[#050508] flex">
      <div className="flex-1 flex items-center justify-center bg-black/40 p-6">
        <img src={cropDataUrl} alt="Vùng đã chọn" className="max-w-full max-h-full rounded-xl border border-white/10 shadow-2xl" />
      </div>
      <div className="w-[400px] shrink-0 border-l border-white/10 bg-[#0a0c14] flex flex-col">
        <div className="flex items-center justify-between px-4 py-3 border-b border-white/10">
          <p className="text-sm font-serif text-white">Hỏi AI về vùng này</p>
          <button onClick={onClose} className="text-white/40 hover:text-white/80">
            <span className="material-symbols-outlined text-[18px]">close</span>
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-3 flex flex-col gap-3">
          {turns.map((turn, i) => (
            <div key={i} className={turn.role === 'user' ? 'self-end max-w-[85%]' : 'self-start max-w-[92%]'}>
              {turn.role === 'user' && turn.kind === 'command' && (
                <p className="rounded-2xl rounded-br-md px-3 py-1.5 text-xs bg-purple-400/20 text-purple-100">{turn.label}</p>
              )}
              {turn.role === 'user' && turn.kind === 'text' && (
                <p className="rounded-2xl rounded-br-md px-3 py-1.5 text-xs bg-white/10 text-white/90">{turn.text}</p>
              )}
              {turn.role === 'ai' && turn.kind === 'comment' && (
                <p className="rounded-2xl rounded-bl-md px-3 py-2 text-xs bg-white/[0.04] text-white/80 leading-relaxed">{turn.text}</p>
              )}
              {turn.role === 'ai' && turn.kind === 'error' && (
                <p className="rounded-2xl rounded-bl-md px-3 py-2 text-xs bg-red-400/10 text-red-300">{turn.text}</p>
              )}
              {turn.role === 'ai' && turn.kind === 'illustration' && (
                <div className="rounded-2xl bg-white/[0.04] p-2.5 flex flex-col gap-2">
                  {turn.shots.map((s, si) => (
                    s.image_base64 ? (
                      <img key={si} src={`data:image/png;base64,${s.image_base64}`} alt={s.topic || 'illustration'} className="rounded-lg w-full" />
                    ) : (
                      <p key={si} className="text-[11px] text-red-300/80">{s.error || 'Không tạo được ảnh.'}</p>
                    )
                  ))}
                </div>
              )}
            </div>
          ))}
          {busy && <p className="text-[11px] text-white/35">AI đang xem…</p>}
          <div ref={chatEndRef} />
        </div>

        <div className="p-3 border-t border-white/10 flex flex-col gap-2">
          {/* The crop stays pinned here as a chip — every send below reuses it. */}
          <div className="flex items-center gap-2 bg-white/5 rounded-xl px-2 py-1.5">
            <img src={cropDataUrl} alt="" className="w-8 h-8 rounded object-cover border border-white/10" />
            <span className="text-[10px] text-white/40 flex-1">Vùng đã chọn</span>
            <button onClick={() => setCropDataUrl(null)} className="text-white/30 hover:text-white/70 text-[10px] uppercase tracking-[1.5px]">
              Chọn lại
            </button>
          </div>

          <div className="flex gap-1.5 flex-wrap">
            {QUICK_COMMANDS.map(c => (
              <button key={c.id} onClick={() => sendCommand(c.id, c.label)} disabled={busy}
                className="rounded-lg px-3 py-1.5 text-[10px] uppercase tracking-[1.5px] bg-white/5 text-white/65 hover:bg-white/10 disabled:opacity-30 transition-colors">
                {c.label}
              </button>
            ))}
            <button onClick={sendIllustrate} disabled={busy}
              className="rounded-lg px-3 py-1.5 text-[10px] uppercase tracking-[1.5px] bg-white/5 text-white/65 hover:bg-white/10 disabled:opacity-30 transition-colors">
              Tạo illustration
            </button>
          </div>

          <div className="flex gap-2">
            <input
              value={input} onChange={e => setInput(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') sendText(); }}
              placeholder="Hỏi gì đó về vùng này…"
              className="flex-1 bg-white/5 rounded-xl px-3 py-2 text-xs text-white/85 outline-none border border-white/10 focus:border-white/25"
            />
            <button onClick={sendText} disabled={!input.trim() || busy}
              className="rounded-xl px-3 py-2 text-white/70 hover:text-white disabled:opacity-30">
              <span className="material-symbols-outlined text-[18px]">send</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
