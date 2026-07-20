/**
 * TeamSpace — the group plan's shared workspace controls + chat room.
 * Rendered inside Settings. A team is up to 3 accounts sharing one
 * workspace, the AI-provided library, and this chat room.
 */
import { useEffect, useRef, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import {
  getMyTeam, createTeam, inviteTeamMember, acceptTeamInvite, leaveTeam,
  getTeamChat, postTeamChat, type TeamInfo, type TeamChatMessage,
} from '../lib/lyceumApi';

function ChatRoom({ team }: { team: TeamInfo }) {
  const { user } = useAuth();
  const [messages, setMessages] = useState<TeamChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const lastIdRef = useRef(0);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let stop = false;
    async function poll() {
      try {
        const { messages: fresh } = await getTeamChat(lastIdRef.current);
        if (!stop && fresh.length) {
          lastIdRef.current = fresh[fresh.length - 1].id;
          setMessages(prev => [...prev, ...fresh].slice(-200));
        }
      } catch { /* offline — keep polling */ }
    }
    poll();
    const iv = setInterval(poll, 4000);
    return () => { stop = true; clearInterval(iv); };
  }, [team.id]);

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages]);

  async function send() {
    const content = input.trim();
    if (!content || sending) return;
    setSending(true);
    try {
      await postTeamChat(content, user?.displayName || user?.email || '');
      setInput('');
      const { messages: fresh } = await getTeamChat(lastIdRef.current);
      if (fresh.length) {
        lastIdRef.current = fresh[fresh.length - 1].id;
        setMessages(prev => [...prev, ...fresh].slice(-200));
      }
    } catch { /* ignore */ } finally { setSending(false); }
  }

  return (
    <div className="border-t border-white/10 pt-4 mt-4">
      <p className="text-[10px] uppercase tracking-[2px] text-white/40 mb-2">Team chat</p>
      <div className="h-52 overflow-y-auto rounded-xl bg-white/5 px-3 py-2 flex flex-col gap-2 mb-2">
        {messages.length === 0 && (
          <p className="text-xs text-white/30 m-auto">No messages yet — say hi to your team.</p>
        )}
        {messages.map(m => {
          const mine = m.user_id === user?.uid;
          return (
            <div key={m.id} className={`max-w-[85%] ${mine ? 'self-end text-right' : 'self-start'}`}>
              <p className="text-[9px] text-white/30">{mine ? 'You' : (m.author || m.user_id.slice(0, 6))}</p>
              <p className={`text-xs px-3 py-1.5 rounded-xl inline-block ${mine ? 'bg-purple-400/20 text-white/90' : 'bg-white/10 text-white/80'}`}>
                {m.content}
              </p>
            </div>
          );
        })}
        <div ref={bottomRef} />
      </div>
      <div className="flex gap-2">
        <input
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') send(); }}
          placeholder="Message your team…"
          className="flex-1 bg-white/5 rounded-xl px-3 py-2 text-xs text-white/85 outline-none border border-white/10 focus:border-white/25"
        />
        <button onClick={send} disabled={sending || !input.trim()}
          className="glass-btn rounded-xl px-4 py-2 text-[10px] uppercase tracking-[2px] disabled:opacity-30">
          Send
        </button>
      </div>
    </div>
  );
}

export default function TeamSpace() {
  const [team, setTeam] = useState<TeamInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState('');
  const [inviteEmail, setInviteEmail] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function refresh() {
    try { setTeam((await getMyTeam()).team); } catch { /* ignore */ }
    setLoading(false);
  }
  useEffect(() => { refresh(); }, []);

  async function run(action: () => Promise<unknown>) {
    setError(''); setBusy(true);
    try { await action(); await refresh(); }
    catch (e: any) { setError(e?.message || 'Something went wrong'); }
    finally { setBusy(false); }
  }

  return (
    <div className="glass-card rounded-3xl p-6">
      <p className="text-[10px] uppercase tracking-[2px] text-white/40 mb-1">Team workspace</p>
      <p className="text-xs text-white/30 mb-4">
        Group plan: up to 3 accounts sharing one workspace, one AI library, and a private chat room.
      </p>

      {loading ? (
        <p className="text-xs text-white/40">Loading…</p>
      ) : team ? (
        <>
          <div className="flex items-center justify-between mb-3">
            <div>
              <p className="text-sm text-white/85 font-semibold">{team.name}</p>
              <p className="text-[10px] text-white/40">{team.members.length}/{team.max_seats} seats used</p>
            </div>
            <button onClick={() => run(leaveTeam)} disabled={busy}
              className="text-[10px] uppercase tracking-[2px] text-red-300/70 hover:text-red-300 disabled:opacity-30">
              Leave team
            </button>
          </div>

          <div className="flex flex-col gap-1.5 mb-3">
            {team.members.map(m => (
              <div key={m.user_id} className="flex items-center justify-between glass-pill rounded-xl px-3 py-2">
                <span className="text-xs text-white/75 truncate">{m.email || m.user_id.slice(0, 10)}</span>
                <span className="text-[9px] uppercase tracking-[1.5px] text-white/35">{m.role}</span>
              </div>
            ))}
            {team.pending_invites.map(i => (
              <div key={i.id} className="flex items-center justify-between glass-pill rounded-xl px-3 py-2 opacity-60">
                <span className="text-xs text-white/60 truncate">{i.email}</span>
                <span className="text-[9px] uppercase tracking-[1.5px] text-amber-300/70">Invited</span>
              </div>
            ))}
          </div>

          {team.members.length + team.pending_invites.length < team.max_seats && (
            <div className="flex gap-2 mb-1">
              <input
                value={inviteEmail}
                onChange={e => setInviteEmail(e.target.value)}
                placeholder="teammate@email.com"
                className="flex-1 bg-white/5 rounded-xl px-3 py-2 text-xs text-white/85 outline-none border border-white/10 focus:border-white/25"
              />
              <button
                onClick={() => run(async () => { await inviteTeamMember(inviteEmail); setInviteEmail(''); })}
                disabled={busy || !inviteEmail.includes('@')}
                className="glass-btn rounded-xl px-4 py-2 text-[10px] uppercase tracking-[2px] disabled:opacity-30"
              >
                Invite
              </button>
            </div>
          )}

          <ChatRoom team={team} />
        </>
      ) : (
        <>
          <div className="flex gap-2 mb-2">
            <input
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="Team name (e.g. Study Squad)"
              className="flex-1 bg-white/5 rounded-xl px-3 py-2 text-xs text-white/85 outline-none border border-white/10 focus:border-white/25"
            />
            <button
              onClick={() => run(async () => { await createTeam(name || 'My Team'); })}
              disabled={busy}
              className="glass-btn rounded-xl px-4 py-2 text-[10px] uppercase tracking-[2px] disabled:opacity-30"
            >
              Create team
            </button>
          </div>
          <button
            onClick={() => run(acceptTeamInvite)}
            disabled={busy}
            className="text-[10px] uppercase tracking-[2px] text-white/40 hover:text-white/70 disabled:opacity-30"
          >
            I was invited — join my team
          </button>
        </>
      )}
      {error && <p className="text-xs text-red-300/80 mt-3">{error}</p>}
    </div>
  );
}
