/**
 * CommunityView — Peer Terminal (dark glassmorphism)
 * Left: room list + search. Right: real-time chat.
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { useAuth } from '../context/AuthContext';
import {
  CommunityProfile, CommunityRoom, CommunityMessage,
  getCachedProfile, loadProfile, upsertProfile,
  getRooms, createRoom, getMessages, sendMessage, subscribeToRoom,
  getDevUserId, STUDY_EMOJIS, AVATAR_COLORS, fmtTime,
} from '../lib/community';

// ── Avatar ────────────────────────────────────────────────────────────────────
function Avatar({ emoji, color, size = 32 }: { emoji: string; color: string; size?: number }) {
  return (
    <div style={{
      width: size, height: size, borderRadius: '50%', background: color,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontSize: size * 0.45, flexShrink: 0,
    }}>{emoji}</div>
  );
}

// ── Profile modal ─────────────────────────────────────────────────────────────
function ProfileModal({ initial, onSave, onClose }: {
  initial: CommunityProfile; onSave: (p: CommunityProfile) => void; onClose: () => void;
}) {
  const [name, setName] = useState(initial.display_name);
  const [emoji, setEmoji] = useState(initial.avatar_emoji);
  const [color, setColor] = useState(initial.avatar_color);

  return (
    <div className="fixed inset-0 z-[300] bg-black/70 backdrop-blur-sm flex items-center justify-center">
      <div className="glass-strong rounded-2xl p-8 w-[360px] shadow-2xl">
        <h3 className="font-serif text-xl text-white mb-6">Your Profile</h3>

        <div className="flex items-center gap-4 mb-6">
          <Avatar emoji={emoji} color={color} size={48} />
          <div>
            <div className="font-sans text-sm font-semibold text-white">{name || 'Learner'}</div>
            <div className="font-sans text-[10px] text-white/40 uppercase tracking-[1px]">Preview</div>
          </div>
        </div>

        <label className="font-sans text-[9px] uppercase tracking-[2px] text-white/40 block mb-2">Display name</label>
        <input
          value={name}
          onChange={e => setName(e.target.value)}
          maxLength={30}
          className="glass-input w-full rounded-xl px-4 py-2.5 text-sm text-white mb-5 outline-none"
        />

        <label className="font-sans text-[9px] uppercase tracking-[2px] text-white/40 block mb-3">Avatar</label>
        <div className="flex flex-wrap gap-2 mb-5">
          {STUDY_EMOJIS.map(e => (
            <button key={e} onClick={() => setEmoji(e)}
              className={`w-9 h-9 text-lg rounded-lg border-2 transition-all ${emoji === e ? 'border-white/60 bg-white/10' : 'border-transparent bg-white/5 hover:bg-white/10'}`}>
              {e}
            </button>
          ))}
        </div>

        <label className="font-sans text-[9px] uppercase tracking-[2px] text-white/40 block mb-3">Color</label>
        <div className="flex gap-3 mb-7">
          {AVATAR_COLORS.map(c => (
            <button key={c} onClick={() => setColor(c)}
              className={`w-7 h-7 rounded-full border-2 transition-all ${color === c ? 'border-white scale-110' : 'border-transparent opacity-70 hover:opacity-100'}`}
              style={{ background: c }} />
          ))}
        </div>

        <div className="flex gap-3">
          <button onClick={onClose}
            className="flex-1 py-2.5 border border-white/15 rounded-xl font-sans text-[10px] uppercase tracking-[2px] text-white/60 hover:bg-white/5 transition-colors">
            Cancel
          </button>
          <button
            onClick={() => onSave({ ...initial, display_name: name.trim() || 'Learner', avatar_emoji: emoji, avatar_color: color })}
            className="flex-1 glass-btn rounded-xl py-2.5 font-sans text-[10px] uppercase tracking-[2px] font-semibold">
            Save
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Create room modal ─────────────────────────────────────────────────────────
function CreateRoomModal({ onCreated, onClose }: {
  onCreated: (room: CommunityRoom) => void; onClose: () => void;
}) {
  const [name, setName] = useState('');
  const [desc, setDesc] = useState('');
  const [tag, setTag] = useState('');
  const [busy, setBusy] = useState(false);
  const { user, devMode } = useAuth();

  async function handleCreate() {
    if (!name.trim()) return;
    setBusy(true);
    try {
      const userId = user?.uid || getDevUserId();
      const cached = getCachedProfile() || { user_id: userId, display_name: 'Learner', avatar_emoji: '📚', avatar_color: '#C5A059' };
      const room = await createRoom(name, desc, tag, cached);
      if (room) onCreated(room);
    } finally { setBusy(false); }
  }

  return (
    <div className="fixed inset-0 z-[300] bg-black/70 backdrop-blur-sm flex items-center justify-center">
      <div className="glass-strong rounded-2xl p-8 w-[400px] shadow-2xl">
        <h3 className="font-serif text-xl text-white mb-6">Create a chat room</h3>

        <label className="font-sans text-[9px] uppercase tracking-[2px] text-white/40 block mb-2">Room name *</label>
        <input value={name} onChange={e => setName(e.target.value)}
          placeholder="e.g. Calculus I — Study Group" maxLength={60}
          className="glass-input w-full rounded-xl px-4 py-2.5 text-sm text-white mb-4 outline-none" />

        <label className="font-sans text-[9px] uppercase tracking-[2px] text-white/40 block mb-2">Course / subject</label>
        <input value={tag} onChange={e => setTag(e.target.value)}
          placeholder="VD: Calculus I, Algorithms, Physics II" maxLength={40}
          className="glass-input w-full rounded-xl px-4 py-2.5 text-sm text-white mb-4 outline-none" />

        <label className="font-sans text-[9px] uppercase tracking-[2px] text-white/40 block mb-2">Description (optional)</label>
        <textarea value={desc} onChange={e => setDesc(e.target.value)}
          placeholder="What this room is about…" rows={2} maxLength={120}
          className="glass-input w-full rounded-xl px-4 py-2.5 text-sm text-white mb-6 outline-none resize-none" />

        <div className="flex gap-3">
          <button onClick={onClose}
            className="flex-1 py-2.5 border border-white/15 rounded-xl font-sans text-[10px] uppercase tracking-[2px] text-white/60 hover:bg-white/5 transition-colors">
            Cancel
          </button>
          <button onClick={handleCreate} disabled={!name.trim() || busy}
            className="flex-[1.6] glass-btn rounded-xl py-2.5 font-sans text-[10px] uppercase tracking-[2px] font-semibold disabled:opacity-30 transition-all">
            {busy ? '…' : 'Create room'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Chat room ─────────────────────────────────────────────────────────────────
function ChatRoom({ room, profile }: { room: CommunityRoom; profile: CommunityProfile }) {
  const [messages, setMessages] = useState<CommunityMessage[]>([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [loading, setLoading] = useState(true);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef  = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    setMessages([]); setLoading(true);
    getMessages(room.id).then(msgs => { setMessages(msgs); setLoading(false); });
  }, [room.id]);

  useEffect(() => {
    const unsub = subscribeToRoom(room.id, msg => {
      setMessages(prev => prev.find(m => m.id === msg.id) ? prev : [...prev, msg]);
    });
    return unsub;
  }, [room.id]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length]);

  async function handleSend() {
    const txt = input.trim();
    if (!txt || sending) return;
    setSending(true); setInput('');
    try { await sendMessage(room.id, txt, profile); }
    catch { setInput(txt); }
    finally { setSending(false); setTimeout(() => inputRef.current?.focus(), 50); }
  }

  function handleKey(e: React.KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); }
  }

  const grouped: { msg: CommunityMessage; showHeader: boolean }[] = messages.map((msg, i) => ({
    msg,
    showHeader: i === 0 || messages[i - 1].user_id !== msg.user_id ||
      new Date(msg.created_at).getTime() - new Date(messages[i - 1].created_at).getTime() > 300000,
  }));

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-5 py-4 border-b border-white/10 flex-shrink-0">
        <div className="font-serif text-base text-white/90 mb-1"># {room.name}</div>
        <div className="flex items-center gap-3 flex-wrap">
          {room.course_tag && (
            <span className="font-sans text-[9px] uppercase tracking-[1px] border border-white/15 px-2 py-0.5 text-white/40">
              {room.course_tag}
            </span>
          )}
          {room.description && (
            <span className="font-sans text-xs text-white/35 italic">{room.description}</span>
          )}
          <span className="font-sans text-[10px] text-white/25 ml-auto">
            {room.message_count} tin · {fmtTime(room.last_active)}
          </span>
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-5 py-4 flex flex-col gap-1">
        {loading && (
          <div className="text-center py-8 font-sans text-xs text-white/30">Loading…</div>
        )}
        {!loading && messages.length === 0 && (
          <div className="flex flex-col items-center justify-center py-12 text-white/25">
            <span className="text-3xl mb-3">💬</span>
            <p className="font-sans text-sm">No messages yet. Start the discussion!</p>
          </div>
        )}
        {grouped.map(({ msg, showHeader }) => (
          <div key={msg.id} className={`flex gap-3 ${showHeader ? 'mt-3' : ''} items-start`}>
            <div className="w-8 flex-shrink-0">
              {showHeader && <Avatar emoji={msg.avatar_emoji} color={msg.avatar_color} size={32} />}
            </div>
            <div className="flex-1 min-w-0">
              {showHeader && (
                <div className="flex items-baseline gap-2 mb-1">
                  <span className="font-sans text-xs font-semibold" style={{ color: msg.avatar_color }}>
                    {msg.display_name}
                  </span>
                  <span className="font-sans text-[10px] text-white/25">{fmtTime(msg.created_at)}</span>
                </div>
              )}
              <p className={`font-sans text-sm leading-relaxed text-white/80 break-words ${
                msg.user_id === profile.user_id
                  ? 'bg-white/5 px-3 py-1.5 rounded-lg inline-block'
                  : ''
              }`}>{msg.content}</p>
            </div>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div className="px-5 py-4 border-t border-white/10 flex-shrink-0 flex gap-3 items-end">
        <Avatar emoji={profile.avatar_emoji} color={profile.avatar_color} size={30} />
        <textarea
          ref={inputRef}
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={handleKey}
          placeholder={`Message #${room.name}…`}
          rows={1}
          className="flex-1 glass-input rounded-xl px-4 py-2.5 text-sm text-white resize-none outline-none leading-relaxed"
          style={{ maxHeight: 120 }}
        />
        <button
          onClick={handleSend}
          disabled={!input.trim() || sending}
          className="glass-btn rounded-xl px-4 py-2.5 font-sans text-[10px] uppercase tracking-[2px] font-bold disabled:opacity-30 transition-all flex-shrink-0"
        >
          {sending ? '…' : '↑ Send'}
        </button>
      </div>
    </div>
  );
}

// ── Room list item ─────────────────────────────────────────────────────────────
function RoomItem({ room, active, onClick }: { room: CommunityRoom; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`w-full text-left px-4 py-3 border-l-2 transition-all hover:bg-white/5 ${
        active ? 'border-violet-400/70 bg-white/5' : 'border-transparent'
      }`}
    >
      <div className="flex items-center justify-between mb-0.5">
        <span className={`font-sans text-xs truncate ${active ? 'font-semibold text-white/90' : 'text-white/60'}`}>
          # {room.name}
        </span>
        <span className="font-sans text-[9px] text-white/25 flex-shrink-0 ml-2">{fmtTime(room.last_active)}</span>
      </div>
      {room.course_tag && (
        <span className="font-sans text-[9px] text-white/30 border border-white/10 px-1.5 py-0.5 rounded">
          {room.course_tag}
        </span>
      )}
    </button>
  );
}

// ── Main view ─────────────────────────────────────────────────────────────────
export default function CommunityView() {
  const { user, devMode } = useAuth();
  const userId = user?.uid || (devMode ? getDevUserId() : null);

  const [profile, setProfile] = useState<CommunityProfile | null>(null);
  const [rooms, setRooms] = useState<CommunityRoom[]>([]);
  const [activeRoom, setActiveRoom] = useState<CommunityRoom | null>(null);
  const [search, setSearch] = useState('');
  const [showProfileModal, setShowProfileModal] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [loadingRooms, setLoadingRooms] = useState(true);

  useEffect(() => {
    if (!userId) return;
    const cached = getCachedProfile();
    if (cached && cached.user_id === userId) { setProfile(cached); return; }
    loadProfile(userId).then(p => {
      if (p) { setProfile(p); return; }
      const defaultP: CommunityProfile = {
        user_id: userId,
        display_name: user?.displayName || (devMode ? 'Dev Learner' : 'Learner'),
        avatar_emoji: '📚',
        avatar_color: '#C5A059',
      };
      upsertProfile(defaultP).then(() => setProfile(defaultP));
    });
  }, [userId]);

  const fetchRooms = useCallback(async () => {
    setLoadingRooms(true);
    try { setRooms(await getRooms(search)); }
    finally { setLoadingRooms(false); }
  }, [search]);

  useEffect(() => { fetchRooms(); }, [fetchRooms]);

  useEffect(() => {
    const interval = setInterval(() => fetchRooms(), 30000);
    return () => clearInterval(interval);
  }, [fetchRooms]);

  async function handleSaveProfile(p: CommunityProfile) {
    await upsertProfile(p);
    setProfile(p);
    setShowProfileModal(false);
  }

  function handleRoomCreated(room: CommunityRoom) {
    setRooms(prev => [room, ...prev]);
    setActiveRoom(room);
    setShowCreateModal(false);
  }

  if (!userId) {
    return (
      <div className="flex items-center justify-center" style={{ minHeight: '60vh' }}>
        <p className="font-serif text-xl text-white/40">Sign in to join the community</p>
      </div>
    );
  }

  return (
    <div className="flex" style={{ height: 'calc(100vh - 80px)', overflow: 'hidden' }}>
      {showProfileModal && profile && (
        <ProfileModal initial={profile} onSave={handleSaveProfile} onClose={() => setShowProfileModal(false)} />
      )}
      {showCreateModal && (
        <CreateRoomModal onCreated={handleRoomCreated} onClose={() => setShowCreateModal(false)} />
      )}

      {/* ── Sidebar ── */}
      <div className="w-64 flex-shrink-0 border-r border-white/10 flex flex-col overflow-hidden">
        {/* Profile button */}
        <div className="p-4 border-b border-white/10 flex-shrink-0">
          <button
            onClick={() => setShowProfileModal(true)}
            className="w-full flex items-center gap-3 glass rounded-xl px-3 py-2.5 hover:bg-white/5 transition-colors"
          >
            {profile && <Avatar emoji={profile.avatar_emoji} color={profile.avatar_color} size={34} />}
            <div className="text-left min-w-0 flex-1">
              <div className="font-sans text-sm text-white/85 font-medium truncate">{profile?.display_name || '…'}</div>
              <div className="font-sans text-[10px] text-white/35">Edit profile</div>
            </div>
            <span className="text-white/25 text-sm flex-shrink-0">✎</span>
          </button>
        </div>

        {/* Search */}
        <div className="px-4 pt-3 pb-2 flex-shrink-0">
          <div className="relative mb-3">
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search rooms, courses…"
              className="glass-input w-full rounded-xl px-4 py-2 text-xs text-white outline-none pl-8"
            />
            <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-white/30 text-xs">🔍</span>
          </div>
          <button
            onClick={() => setShowCreateModal(true)}
            className="w-full glass-btn rounded-xl py-2 font-sans text-[10px] uppercase tracking-[2px] font-bold"
          >
            + Create room
          </button>
          <button className="w-full mt-2 border border-white/10 rounded-xl py-2 font-sans text-[10px] uppercase tracking-[2px] text-white/50 hover:bg-white/5 transition-colors">
            🤝 Find study buddies (AI)
          </button>
        </div>

        {/* Room list */}
        <div className="flex-1 overflow-y-auto">
          <div className="px-4 py-2 font-sans text-[9px] uppercase tracking-[2px] text-white/30">
            Active rooms
          </div>
          {loadingRooms ? (
            <div className="px-4 py-6 text-center font-sans text-xs text-white/25">Loading…</div>
          ) : rooms.length === 0 ? (
            <div className="px-4 py-6 text-center font-sans text-xs text-white/30 leading-relaxed">
              No rooms yet.{'\n'}Be the first to create one!
            </div>
          ) : rooms.map(room => (
            <RoomItem key={room.id} room={room as CommunityRoom} active={activeRoom?.id === room.id}
              onClick={() => setActiveRoom(room as CommunityRoom)} />
          ))}
        </div>

        {/* Moderation notice */}
        <div className="px-4 py-3 border-t border-white/10 flex-shrink-0">
          <p className="font-sans text-[9px] text-white/25 leading-relaxed">
            🛡 Chat rooms are AI-moderated weekly. Academic content only.
          </p>
        </div>
      </div>

      {/* ── Chat area ── */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {activeRoom && profile ? (
          <ChatRoom room={activeRoom} profile={profile} />
        ) : (
          <div className="flex items-center justify-center h-full">
            <div className="text-center text-white/30">
              <div className="text-5xl mb-5">🏛</div>
              <p className="font-serif text-2xl text-white/50 mb-2">Welcome to Lyceum Community</p>
              <p className="font-sans text-sm mb-1">Pick a room to start discussing</p>
              <p className="font-sans text-xs opacity-70">or create a new one for your subject</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
