/**
 * ForumChat — reusable chat panel for a forum group feed (thread_id =
 * 'group:<id>') or a 1:1 DM (thread_id = 'dm:<emailA>|<emailB>'). Polls
 * every 5s (no realtime infra exists in this app — see forum.py's header
 * comment). Supports plain messages and a structured "pitch for feedback"
 * template; every message can carry a threaded comment list where each
 * comment must pick one of three verdicts before it can be submitted.
 */
import { useEffect, useRef, useState } from 'react';
import {
  listForumMessages, postForumMessage, postForumComment,
  type ForumMessage, type ForumComment,
} from '../lib/forum';

const POLL_MS = 5000;

function timeAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const m = Math.floor(ms / 60000), h = Math.floor(ms / 3600000), d = Math.floor(ms / 86400000);
  if (d > 0) return `${d}d ago`;
  if (h > 0) return `${h}h ago`;
  if (m > 0) return `${m}m ago`;
  return 'just now';
}

const VERDICTS: { key: ForumComment['verdict']; label: string; emoji: string }[] = [
  { key: 'good', label: 'Ổn đó', emoji: '👍' },
  { key: 'mixed', label: 'Tạm được, cần xem xét', emoji: '🤔' },
  { key: 'bad', label: 'Không ổn, chê', emoji: '👎' },
];

function CommentComposer({ messageId, onPosted }: { messageId: string; onPosted: () => void }) {
  const [verdict, setVerdict] = useState<ForumComment['verdict'] | ''>('');
  const [content, setContent] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit() {
    if (!verdict || busy) return;
    setBusy(true);
    try {
      await postForumComment(messageId, verdict, content.trim());
      setContent(''); setVerdict('');
      onPosted();
    } finally { setBusy(false); }
  }

  return (
    <div className="mt-2 pl-3 border-l border-white/10">
      <div className="flex gap-1.5 mb-1.5">
        {VERDICTS.map(v => (
          <button key={v.key} type="button" onClick={() => setVerdict(v.key)}
            className={`px-2 py-1 rounded-lg text-[10px] ${verdict === v.key ? 'glass-pill-active' : 'glass-pill'}`}>
            {v.emoji} {v.label}
          </button>
        ))}
      </div>
      {verdict && (
        <div className="flex gap-1.5">
          <input value={content} onChange={e => setContent(e.target.value)} placeholder="Nhận xét (tuỳ chọn)…"
            className="flex-1 bg-white/5 rounded-lg px-2.5 py-1.5 text-xs text-white/90 outline-none border border-white/10" />
          <button onClick={submit} disabled={busy} className="glass-btn rounded-lg px-3 py-1.5 text-[10px] uppercase tracking-wider disabled:opacity-30">
            Gửi
          </button>
        </div>
      )}
    </div>
  );
}

function PitchCard({ msg, selfEmail, onCommented }: { msg: ForumMessage; selfEmail: string; onCommented: () => void }) {
  return (
    <div className="glass rounded-2xl p-4">
      <p className="text-[11px] text-slate-500 mb-2">{msg.author_email === selfEmail ? 'Bạn' : msg.author_email} · {timeAgo(msg.created_at)} · <span className="text-purple-300 uppercase tracking-wider">Xin góp ý</span></p>
      <div className="flex flex-col gap-2 text-sm text-slate-200">
        <div><span className="text-[10px] uppercase tracking-wider text-slate-500">Bối cảnh &amp; Constraint</span><p>{msg.pitch_context}</p></div>
        <div><span className="text-[10px] uppercase tracking-wider text-slate-500">Quyết định đề xuất</span><p>{msg.pitch_hypothesis}</p></div>
        {msg.pitch_reasoning && <div><span className="text-[10px] uppercase tracking-wider text-slate-500">Chuỗi logic</span><p>{msg.pitch_reasoning}</p></div>}
        {msg.pitch_risk && <div><span className="text-[10px] uppercase tracking-wider text-slate-500">Rủi ro tự nhận diện</span><p>{msg.pitch_risk}</p></div>}
      </div>

      {msg.comments.length > 0 && (
        <div className="flex flex-col gap-2 mt-3 pt-3 border-t border-white/10">
          {msg.comments.map(c => {
            const v = VERDICTS.find(x => x.key === c.verdict)!;
            return (
              <div key={c.id} className="text-xs">
                <span className="text-slate-500">{c.author_email === selfEmail ? 'Bạn' : c.author_email}</span>{' '}
                <span>{v.emoji} {v.label}</span>
                {c.content && <span className="text-slate-300"> — {c.content}</span>}
              </div>
            );
          })}
        </div>
      )}
      <CommentComposer messageId={msg.id} onPosted={onCommented} />
    </div>
  );
}

export default function ForumChat({ threadId, selfEmail, onClose }: { threadId: string; selfEmail: string; onClose: () => void }) {
  const [messages, setMessages] = useState<ForumMessage[]>([]);
  const [mode, setMode] = useState<'text' | 'pitch'>('text');
  const [body, setBody] = useState('');
  const [pitchContext, setPitchContext] = useState('');
  const [pitchHypothesis, setPitchHypothesis] = useState('');
  const [pitchReasoning, setPitchReasoning] = useState('');
  const [pitchRisk, setPitchRisk] = useState('');
  const [error, setError] = useState('');
  const cursorRef = useRef<string | undefined>(undefined);

  async function refresh(full = false) {
    try {
      const res = await listForumMessages(threadId, full ? undefined : cursorRef.current);
      if (res.messages.length === 0) return;
      cursorRef.current = res.messages[res.messages.length - 1].created_at;
      setMessages(prev => full ? res.messages : [...prev, ...res.messages]);
    } catch { /* keep last known state on a transient poll failure */ }
  }

  useEffect(() => {
    setMessages([]); cursorRef.current = undefined;
    refresh(true);
    const id = setInterval(() => refresh(false), POLL_MS);
    return () => clearInterval(id);
  }, [threadId]);

  async function submit() {
    setError('');
    try {
      if (mode === 'text') {
        if (!body.trim()) return;
        await postForumMessage(threadId, 'text', body.trim());
        setBody('');
      } else {
        if (!pitchContext.trim() && !pitchHypothesis.trim()) return;
        await postForumMessage(threadId, 'pitch', '', {
          context: pitchContext.trim(), hypothesis: pitchHypothesis.trim(),
          reasoning: pitchReasoning.trim(), risk: pitchRisk.trim(),
        });
        setPitchContext(''); setPitchHypothesis(''); setPitchReasoning(''); setPitchRisk('');
      }
      refresh(true);
    } catch (e: any) {
      setError(e?.message || 'Không gửi được — thử lại.');
    }
  }

  return (
    <div className="fixed inset-0 z-[200] bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="glass-card rounded-3xl p-6 w-full max-w-xl max-h-[85vh] flex flex-col">
        <div className="flex items-center justify-between mb-4">
          <p className="text-xs uppercase tracking-[2px] text-purple-300">{threadId.startsWith('dm:') ? 'Trò chuyện riêng' : 'Forum group'}</p>
          <button onClick={onClose} className="text-white/40 hover:text-white/80">✕</button>
        </div>

        <div className="flex-1 overflow-y-auto flex flex-col gap-3 mb-4">
          {messages.length === 0 && <p className="text-center text-slate-500 text-sm py-8">Chưa có tin nhắn nào.</p>}
          {messages.map(m => m.message_type === 'pitch' ? (
            <PitchCard key={m.id} msg={m} selfEmail={selfEmail} onCommented={() => refresh(true)} />
          ) : (
            <div key={m.id} className="glass-pill rounded-2xl px-4 py-2.5 max-w-[85%] self-start">
              <p className="text-[10px] text-slate-500 mb-0.5">{m.author_email === selfEmail ? 'Bạn' : m.author_email} · {timeAgo(m.created_at)}</p>
              <p className="text-sm text-slate-200">{m.body}</p>
            </div>
          ))}
        </div>

        <div className="flex gap-2 mb-2">
          <button onClick={() => setMode('text')} className={`px-3 py-1.5 rounded-xl text-[11px] uppercase tracking-wider ${mode === 'text' ? 'glass-pill-active' : 'glass-pill'}`}>Tin nhắn</button>
          <button onClick={() => setMode('pitch')} className={`px-3 py-1.5 rounded-xl text-[11px] uppercase tracking-wider ${mode === 'pitch' ? 'glass-pill-active' : 'glass-pill'}`}>Xin góp ý</button>
        </div>

        {mode === 'text' ? (
          <div className="flex gap-2">
            <input value={body} onChange={e => setBody(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') submit(); }}
              placeholder="Nhắn gì đó…" className="flex-1 bg-white/5 rounded-xl px-3 py-2.5 text-sm text-white/90 outline-none border border-white/10" />
            <button onClick={submit} className="glass-btn rounded-xl px-4 py-2 text-[10px] uppercase tracking-[2px]">Gửi</button>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            <textarea value={pitchContext} onChange={e => setPitchContext(e.target.value)} rows={2}
              placeholder="Bối cảnh & Constraint: $X tiền, $Y thời gian, tệp KH cụ thể…"
              className="w-full bg-white/5 rounded-xl px-3 py-2 text-sm text-white/90 outline-none border border-white/10 resize-y" />
            <textarea value={pitchHypothesis} onChange={e => setPitchHypothesis(e.target.value)} rows={2}
              placeholder="Quyết định đề xuất: Tao định làm A để đạt B…"
              className="w-full bg-white/5 rounded-xl px-3 py-2 text-sm text-white/90 outline-none border border-white/10 resize-y" />
            <textarea value={pitchReasoning} onChange={e => setPitchReasoning(e.target.value)} rows={2}
              placeholder="Chuỗi logic: Tao tin A → B vì giả định 1, giả định 2…"
              className="w-full bg-white/5 rounded-xl px-3 py-2 text-sm text-white/90 outline-none border border-white/10 resize-y" />
            <textarea value={pitchRisk} onChange={e => setPitchRisk(e.target.value)} rows={2}
              placeholder="Rủi ro tự nhận diện: Tao đang sợ điểm nào nhất?"
              className="w-full bg-white/5 rounded-xl px-3 py-2 text-sm text-white/90 outline-none border border-white/10 resize-y" />
            <div className="flex justify-end"><button onClick={submit} className="glass-btn rounded-xl px-4 py-2 text-[10px] uppercase tracking-[2px]">Đăng để xin góp ý</button></div>
          </div>
        )}
        {error && <p className="text-xs text-red-300/80 mt-2">{error}</p>}
      </div>
    </div>
  );
}
