/**
 * CommunityView — Discord-style mini community.
 * Left: room list + search by course.
 * Right: real-time chat.
 * Top-right: avatar + profile.
 * Rooms moderated weekly by Meta Llama 70B.
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { useAuth } from '../context/AuthContext';
import {
  CommunityProfile, CommunityRoom, CommunityMessage,
  getCachedProfile, loadProfile, upsertProfile,
  getRooms, createRoom, getMessages, sendMessage, subscribeToRoom,
  getDevUserId, STUDY_EMOJIS, AVATAR_COLORS, fmtTime,
} from '../lib/community';

// ── Avatar bubble ─────────────────────────────────────────────────────────────
function Avatar({ emoji, color, size = 32 }: { emoji: string; color: string; size?: number }) {
  return (
    <div style={{
      width: size, height: size, borderRadius: '50%', background: color,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontSize: size * 0.45, flexShrink: 0,
    }}>{emoji}</div>
  );
}

// ── Profile editor modal ──────────────────────────────────────────────────────
function ProfileModal({
  initial, onSave, onClose,
}: { initial: CommunityProfile; onSave: (p: CommunityProfile) => void; onClose: () => void }) {
  const [name, setName] = useState(initial.display_name);
  const [emoji, setEmoji] = useState(initial.avatar_emoji);
  const [color, setColor] = useState(initial.avatar_color);

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 300, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ background: 'white', borderRadius: 8, padding: 32, width: 340, boxShadow: '0 16px 60px rgba(0,0,0,0.3)' }}>
        <h3 style={{ fontFamily: 'Georgia, serif', fontSize: 18, marginBottom: 24 }}>Hồ sơ của bạn</h3>

        {/* Preview */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 24 }}>
          <Avatar emoji={emoji} color={color} size={48} />
          <div>
            <div style={{ fontFamily: 'sans-serif', fontWeight: 600, fontSize: 15 }}>{name || 'Learner'}</div>
            <div style={{ fontFamily: 'sans-serif', fontSize: 11, color: 'rgba(0,0,0,0.4)' }}>Preview</div>
          </div>
        </div>

        {/* Display name */}
        <label style={{ fontFamily: 'sans-serif', fontSize: 10, letterSpacing: 2, textTransform: 'uppercase', color: 'rgba(0,0,0,0.4)', display: 'block', marginBottom: 6 }}>Tên hiển thị</label>
        <input value={name} onChange={e => setName(e.target.value)} maxLength={30}
          style={{ width: '100%', padding: '10px 14px', border: '1.5px solid rgba(0,0,0,0.15)', borderRadius: 5, fontFamily: 'sans-serif', fontSize: 14, outline: 'none', boxSizing: 'border-box', marginBottom: 20 }} />

        {/* Emoji picker */}
        <label style={{ fontFamily: 'sans-serif', fontSize: 10, letterSpacing: 2, textTransform: 'uppercase', color: 'rgba(0,0,0,0.4)', display: 'block', marginBottom: 8 }}>Avatar</label>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 16 }}>
          {STUDY_EMOJIS.map(e => (
            <button key={e} onClick={() => setEmoji(e)}
              style={{ width: 36, height: 36, fontSize: 18, border: `2px solid ${emoji === e ? color : 'transparent'}`, borderRadius: 6, background: emoji === e ? `${color}18` : 'rgba(0,0,0,0.04)', cursor: 'pointer' }}>
              {e}
            </button>
          ))}
        </div>

        {/* Color picker */}
        <label style={{ fontFamily: 'sans-serif', fontSize: 10, letterSpacing: 2, textTransform: 'uppercase', color: 'rgba(0,0,0,0.4)', display: 'block', marginBottom: 8 }}>Màu</label>
        <div style={{ display: 'flex', gap: 8, marginBottom: 24 }}>
          {AVATAR_COLORS.map(c => (
            <button key={c} onClick={() => setColor(c)}
              style={{ width: 26, height: 26, borderRadius: '50%', background: c, border: `3px solid ${color === c ? 'rgba(0,0,0,0.6)' : 'transparent'}`, cursor: 'pointer' }} />
          ))}
        </div>

        <div style={{ display: 'flex', gap: 10 }}>
          <button onClick={onClose} style={{ flex: 1, padding: '10px', border: '1px solid rgba(0,0,0,0.15)', borderRadius: 5, fontFamily: 'sans-serif', fontSize: 12, cursor: 'pointer', background: 'white' }}>Hủy</button>
          <button onClick={() => onSave({ ...initial, display_name: name.trim() || 'Learner', avatar_emoji: emoji, avatar_color: color })}
            style={{ flex: 1, padding: '10px', border: 'none', borderRadius: 5, fontFamily: 'sans-serif', fontSize: 12, fontWeight: 700, cursor: 'pointer', background: color, color: 'white' }}>
            Lưu
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Create room modal ──────────────────────────────────────────────────────────
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
    <div style={{ position: 'fixed', inset: 0, zIndex: 300, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ background: 'white', borderRadius: 8, padding: 32, width: 380, boxShadow: '0 16px 60px rgba(0,0,0,0.3)' }}>
        <h3 style={{ fontFamily: 'Georgia, serif', fontSize: 18, marginBottom: 24 }}>Tạo phòng chat</h3>

        <label style={{ fontFamily: 'sans-serif', fontSize: 10, letterSpacing: 2, textTransform: 'uppercase', color: 'rgba(0,0,0,0.4)', display: 'block', marginBottom: 6 }}>Tên phòng *</label>
        <input value={name} onChange={e => setName(e.target.value)} placeholder="VD: Giải tích I — Nhóm ôn thi" maxLength={60}
          style={{ width: '100%', padding: '10px 14px', border: '1.5px solid rgba(0,0,0,0.15)', borderRadius: 5, fontFamily: 'sans-serif', fontSize: 14, outline: 'none', boxSizing: 'border-box', marginBottom: 14 }} />

        <label style={{ fontFamily: 'sans-serif', fontSize: 10, letterSpacing: 2, textTransform: 'uppercase', color: 'rgba(0,0,0,0.4)', display: 'block', marginBottom: 6 }}>Khoá học / môn học</label>
        <input value={tag} onChange={e => setTag(e.target.value)} placeholder="VD: Calculus I, Algorithms, Physics II" maxLength={40}
          style={{ width: '100%', padding: '10px 14px', border: '1.5px solid rgba(0,0,0,0.15)', borderRadius: 5, fontFamily: 'sans-serif', fontSize: 14, outline: 'none', boxSizing: 'border-box', marginBottom: 14 }} />

        <label style={{ fontFamily: 'sans-serif', fontSize: 10, letterSpacing: 2, textTransform: 'uppercase', color: 'rgba(0,0,0,0.4)', display: 'block', marginBottom: 6 }}>Mô tả (tuỳ chọn)</label>
        <textarea value={desc} onChange={e => setDesc(e.target.value)} placeholder="Phòng thảo luận về…" rows={2} maxLength={120}
          style={{ width: '100%', padding: '10px 14px', border: '1.5px solid rgba(0,0,0,0.15)', borderRadius: 5, fontFamily: 'sans-serif', fontSize: 13, outline: 'none', boxSizing: 'border-box', resize: 'none', marginBottom: 22 }} />

        <div style={{ display: 'flex', gap: 10 }}>
          <button onClick={onClose} style={{ flex: 1, padding: '10px', border: '1px solid rgba(0,0,0,0.15)', borderRadius: 5, fontFamily: 'sans-serif', fontSize: 12, cursor: 'pointer', background: 'white' }}>Hủy</button>
          <button onClick={handleCreate} disabled={!name.trim() || busy}
            style={{ flex: 1.6, padding: '10px', border: 'none', borderRadius: 5, fontFamily: 'sans-serif', fontSize: 12, fontWeight: 700, cursor: name.trim() ? 'pointer' : 'not-allowed', background: name.trim() ? '#C5A059' : 'rgba(0,0,0,0.1)', color: name.trim() ? '#1a1a1a' : 'rgba(0,0,0,0.3)' }}>
            {busy ? '…' : 'Tạo phòng'}
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

  // Load history
  useEffect(() => {
    setMessages([]);
    setLoading(true);
    getMessages(room.id).then(msgs => { setMessages(msgs); setLoading(false); });
  }, [room.id]);

  // Realtime subscription
  useEffect(() => {
    const unsub = subscribeToRoom(room.id, msg => {
      setMessages(prev => {
        if (prev.find(m => m.id === msg.id)) return prev;
        return [...prev, msg];
      });
    });
    return unsub;
  }, [room.id]);

  // Scroll to bottom on new messages
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length]);

  async function handleSend() {
    const txt = input.trim();
    if (!txt || sending) return;
    setSending(true);
    setInput('');
    try { await sendMessage(room.id, txt, profile); }
    catch { setInput(txt); }
    finally { setSending(false); setTimeout(() => inputRef.current?.focus(), 50); }
  }

  function handleKey(e: React.KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); }
  }

  // Group messages by sender (consecutive)
  const grouped: { msg: CommunityMessage; showHeader: boolean }[] = messages.map((msg, i) => ({
    msg,
    showHeader: i === 0 || messages[i - 1].user_id !== msg.user_id ||
      new Date(msg.created_at).getTime() - new Date(messages[i - 1].created_at).getTime() > 300000,
  }));

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Room header */}
      <div style={{ padding: '14px 20px', borderBottom: '1px solid rgba(0,0,0,0.08)', flexShrink: 0, background: 'white' }}>
        <div style={{ fontFamily: 'Georgia, serif', fontSize: 16, marginBottom: 2 }}># {room.name}</div>
        <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
          {room.course_tag && (
            <span style={{ fontFamily: 'sans-serif', fontSize: 10, letterSpacing: 1, textTransform: 'uppercase', border: '1px solid rgba(0,0,0,0.15)', padding: '1px 7px', color: 'rgba(0,0,0,0.5)' }}>{room.course_tag}</span>
          )}
          {room.description && <span style={{ fontFamily: 'sans-serif', fontSize: 12, color: 'rgba(0,0,0,0.45)', fontStyle: 'italic' }}>{room.description}</span>}
          <span style={{ fontFamily: 'sans-serif', fontSize: 11, color: 'rgba(0,0,0,0.3)', marginLeft: 'auto' }}>{room.message_count} tin • hoạt động {fmtTime(room.last_active)}</span>
        </div>
      </div>

      {/* Messages */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '12px 20px', display: 'flex', flexDirection: 'column', gap: 2, background: '#FAFAF8' }}>
        {loading && <div style={{ fontFamily: 'sans-serif', fontSize: 11, color: 'rgba(0,0,0,0.3)', textAlign: 'center', padding: 24 }}>Đang tải…</div>}
        {!loading && messages.length === 0 && (
          <div style={{ textAlign: 'center', padding: '40px 0', color: 'rgba(0,0,0,0.3)' }}>
            <div style={{ fontSize: 32, marginBottom: 10 }}>💬</div>
            <p style={{ fontFamily: 'sans-serif', fontSize: 13 }}>Chưa có tin nhắn nào. Hãy bắt đầu cuộc thảo luận!</p>
          </div>
        )}
        {grouped.map(({ msg, showHeader }) => (
          <div key={msg.id} style={{ display: 'flex', gap: 10, marginTop: showHeader ? 10 : 0, alignItems: 'flex-start' }}>
            <div style={{ width: 32, flexShrink: 0 }}>
              {showHeader && <Avatar emoji={msg.avatar_emoji} color={msg.avatar_color} size={32} />}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              {showHeader && (
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 2 }}>
                  <span style={{ fontFamily: 'sans-serif', fontSize: 13, fontWeight: 600, color: msg.avatar_color }}>{msg.display_name}</span>
                  <span style={{ fontFamily: 'sans-serif', fontSize: 10, color: 'rgba(0,0,0,0.3)' }}>{fmtTime(msg.created_at)}</span>
                </div>
              )}
              <p style={{
                margin: 0, fontFamily: 'sans-serif', fontSize: 13.5, lineHeight: 1.5,
                color: 'rgba(0,0,0,0.82)', wordBreak: 'break-word',
                background: msg.user_id === profile.user_id ? 'rgba(197,160,89,0.1)' : 'transparent',
                padding: msg.user_id === profile.user_id ? '4px 8px' : '0',
                borderRadius: 4,
              }}>{msg.content}</p>
            </div>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div style={{ padding: '12px 20px', borderTop: '1px solid rgba(0,0,0,0.08)', background: 'white', flexShrink: 0, display: 'flex', gap: 10, alignItems: 'flex-end' }}>
        <Avatar emoji={profile.avatar_emoji} color={profile.avatar_color} size={30} />
        <textarea
          ref={inputRef}
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={handleKey}
          placeholder={`Nhắn tin vào #${room.name}…`}
          rows={1}
          style={{
            flex: 1, padding: '9px 14px', border: '1.5px solid rgba(0,0,0,0.12)', borderRadius: 6,
            fontFamily: 'sans-serif', fontSize: 13.5, resize: 'none', outline: 'none',
            lineHeight: 1.45, maxHeight: 120, overflowY: 'auto',
            background: '#FAFAF8',
          }}
        />
        <button onClick={handleSend} disabled={!input.trim() || sending}
          style={{
            padding: '8px 18px', border: 'none', borderRadius: 6, fontFamily: 'sans-serif',
            fontSize: 12, fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase',
            cursor: input.trim() ? 'pointer' : 'not-allowed',
            background: input.trim() ? '#C5A059' : 'rgba(0,0,0,0.08)',
            color: input.trim() ? '#1a1a1a' : 'rgba(0,0,0,0.25)',
            transition: 'all 0.15s', flexShrink: 0,
          }}>
          {sending ? '…' : '↑ Gửi'}
        </button>
      </div>
    </div>
  );
}

// ── Room list item ─────────────────────────────────────────────────────────────
function RoomItem({ room, active, onClick }: { room: CommunityRoom; active: boolean; onClick: () => void }) {
  return (
    <button onClick={onClick} style={{
      width: '100%', textAlign: 'left', padding: '10px 16px',
      background: active ? 'rgba(197,160,89,0.12)' : 'transparent',
      border: 'none', borderLeft: active ? '3px solid #C5A059' : '3px solid transparent',
      cursor: 'pointer', transition: 'all 0.12s',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
        <span style={{ fontFamily: 'sans-serif', fontSize: 12, fontWeight: active ? 700 : 500, color: active ? '#8B6914' : 'rgba(0,0,0,0.75)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
          # {room.name}
        </span>
        <span style={{ fontFamily: 'sans-serif', fontSize: 10, color: 'rgba(0,0,0,0.3)', flexShrink: 0 }}>{fmtTime(room.last_active)}</span>
      </div>
      {room.course_tag && (
        <span style={{ fontFamily: 'sans-serif', fontSize: 10, color: 'rgba(0,0,0,0.4)', border: '1px solid rgba(0,0,0,0.1)', padding: '0px 5px', borderRadius: 2 }}>{room.course_tag}</span>
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

  // Load profile
  useEffect(() => {
    if (!userId) return;
    const cached = getCachedProfile();
    if (cached && cached.user_id === userId) { setProfile(cached); }
    else {
      loadProfile(userId).then(p => {
        if (p) { setProfile(p); }
        else {
          // First visit — create default profile
          const defaultP: CommunityProfile = {
            user_id: userId,
            display_name: user?.displayName || (devMode ? 'Dev Learner' : 'Learner'),
            avatar_emoji: '📚',
            avatar_color: '#C5A059',
          };
          upsertProfile(defaultP).then(() => setProfile(defaultP));
        }
      });
    }
  }, [userId]);

  // Load rooms
  const fetchRooms = useCallback(async () => {
    setLoadingRooms(true);
    try { setRooms(await getRooms(search)); }
    finally { setLoadingRooms(false); }
  }, [search]);

  useEffect(() => { fetchRooms(); }, [fetchRooms]);

  // Realtime: new rooms appear in sidebar
  useEffect(() => {
    const ch = (window as any).__supabase_community_rooms_ch;
    // simple poll every 30s for new rooms
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
      <div className="flex items-center justify-center h-full" style={{ minHeight: '60vh' }}>
        <div style={{ textAlign: 'center' }}>
          <p className="font-serif text-xl opacity-50 mb-4">Đăng nhập để tham gia cộng đồng</p>
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', height: 'calc(100vh - 80px)', background: '#FAFAF8', overflow: 'hidden' }}>
      {showProfileModal && profile && (
        <ProfileModal initial={profile} onSave={handleSaveProfile} onClose={() => setShowProfileModal(false)} />
      )}
      {showCreateModal && (
        <CreateRoomModal onCreated={handleRoomCreated} onClose={() => setShowCreateModal(false)} />
      )}

      {/* ── Sidebar ── */}
      <div style={{ width: 260, flexShrink: 0, borderRight: '1px solid rgba(0,0,0,0.08)', display: 'flex', flexDirection: 'column', background: 'white', overflowY: 'hidden' }}>
        {/* My profile */}
        <div style={{ padding: '16px 16px 12px', borderBottom: '1px solid rgba(0,0,0,0.06)', flexShrink: 0 }}>
          <button onClick={() => setShowProfileModal(true)}
            style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%', background: 'rgba(0,0,0,0.03)', border: '1px solid rgba(0,0,0,0.08)', borderRadius: 8, padding: '8px 12px', cursor: 'pointer', transition: 'background 0.15s' }}>
            {profile && <Avatar emoji={profile.avatar_emoji} color={profile.avatar_color} size={34} />}
            <div style={{ textAlign: 'left', minWidth: 0, flex: 1 }}>
              <div style={{ fontFamily: 'sans-serif', fontSize: 13, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{profile?.display_name || '…'}</div>
              <div style={{ fontFamily: 'sans-serif', fontSize: 10, color: 'rgba(0,0,0,0.4)' }}>Chỉnh sửa hồ sơ</div>
            </div>
            <span style={{ fontSize: 14, opacity: 0.35 }}>✎</span>
          </button>
        </div>

        {/* Search + create */}
        <div style={{ padding: '12px 12px 8px', flexShrink: 0 }}>
          <div style={{ position: 'relative', marginBottom: 8 }}>
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Tìm phòng, khoá học…"
              style={{ width: '100%', padding: '8px 12px 8px 32px', border: '1px solid rgba(0,0,0,0.12)', borderRadius: 6, fontFamily: 'sans-serif', fontSize: 12, outline: 'none', background: '#F5F5F3', boxSizing: 'border-box' }}
            />
            <span style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', fontSize: 13, opacity: 0.35 }}>🔍</span>
          </div>
          <button onClick={() => setShowCreateModal(true)}
            style={{ width: '100%', padding: '8px', border: 'none', borderRadius: 6, background: '#C5A059', color: '#1a1a1a', fontFamily: 'sans-serif', fontSize: 11, fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase', cursor: 'pointer' }}>
            + Tạo phòng
          </button>
        </div>

        {/* Room list */}
        <div style={{ flex: 1, overflowY: 'auto' }}>
          <div style={{ padding: '4px 16px 6px', fontFamily: 'sans-serif', fontSize: 9, letterSpacing: 2, textTransform: 'uppercase', color: 'rgba(0,0,0,0.35)' }}>
            Phòng đang hoạt động
          </div>
          {loadingRooms ? (
            <div style={{ padding: '24px 16px', fontFamily: 'sans-serif', fontSize: 11, color: 'rgba(0,0,0,0.3)', textAlign: 'center' }}>Đang tải…</div>
          ) : rooms.length === 0 ? (
            <div style={{ padding: '24px 16px', fontFamily: 'sans-serif', fontSize: 12, color: 'rgba(0,0,0,0.4)', textAlign: 'center', lineHeight: 1.6 }}>
              Chưa có phòng nào.{'\n'}Hãy tạo phòng đầu tiên!
            </div>
          ) : rooms.map(room => (
            <RoomItem key={room.id} room={room as CommunityRoom} active={activeRoom?.id === room.id} onClick={() => { setActiveRoom(room as CommunityRoom); }} />
          ))}
        </div>

        {/* AI moderation notice */}
        <div style={{ padding: '10px 14px', borderTop: '1px solid rgba(0,0,0,0.06)', flexShrink: 0 }}>
          <p style={{ fontFamily: 'sans-serif', fontSize: 9, color: 'rgba(0,0,0,0.3)', margin: 0, lineHeight: 1.5, letterSpacing: 0.3 }}>
            🛡 Phòng chat được AI kiểm duyệt hằng tuần. Chỉ nội dung học thuật.
          </p>
        </div>
      </div>

      {/* ── Chat area ── */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        {activeRoom && profile ? (
          <ChatRoom room={activeRoom} profile={profile} />
        ) : (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%' }}>
            <div style={{ textAlign: 'center', color: 'rgba(0,0,0,0.35)' }}>
              <div style={{ fontSize: 48, marginBottom: 16 }}>🏛</div>
              <p style={{ fontFamily: 'Georgia, serif', fontSize: 20, marginBottom: 8, color: 'rgba(0,0,0,0.5)' }}>Chào mừng đến Lyceum Community</p>
              <p style={{ fontFamily: 'sans-serif', fontSize: 13 }}>Chọn một phòng để bắt đầu thảo luận</p>
              <p style={{ fontFamily: 'sans-serif', fontSize: 12, marginTop: 4, opacity: 0.7 }}>hoặc tạo phòng mới theo môn học của bạn</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
