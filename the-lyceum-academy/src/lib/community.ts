/**
 * Community lib — Supabase helpers for profiles, rooms, messages + realtime.
 */
import { supabase } from './supabase';

// ── Types ───────────────────────────────────────────────────────────────────

export interface CommunityProfile {
  user_id: string;
  display_name: string;
  avatar_emoji: string;
  avatar_color: string;
}

export interface CommunityRoom {
  id: string;
  name: string;
  description: string;
  course_tag: string;
  created_by: string;
  created_by_name: string;
  created_at: string;
  last_active: string;
  message_count: number;
  member_count: number;
  is_active: boolean;
}

export interface CommunityMessage {
  id: string;
  room_id: string;
  user_id: string;
  display_name: string;
  avatar_emoji: string;
  avatar_color: string;
  content: string;
  created_at: string;
  is_flagged: boolean;
}

// ── Dev user ID ─────────────────────────────────────────────────────────────

export function getDevUserId(): string {
  try {
    let id = localStorage.getItem('lyceum_dev_uid');
    if (!id) {
      id = 'dev-' + Math.random().toString(36).slice(2, 10);
      localStorage.setItem('lyceum_dev_uid', id);
    }
    return id;
  } catch { return 'dev-anon'; }
}

// ── Profile ─────────────────────────────────────────────────────────────────

const PROFILE_CACHE_KEY = 'lyceum_community_profile';

export function getCachedProfile(): CommunityProfile | null {
  try {
    const raw = localStorage.getItem(PROFILE_CACHE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

export function setCachedProfile(p: CommunityProfile) {
  try { localStorage.setItem(PROFILE_CACHE_KEY, JSON.stringify(p)); } catch {}
}

export async function loadProfile(userId: string): Promise<CommunityProfile | null> {
  const { data } = await supabase
    .from('community_profiles')
    .select('*')
    .eq('user_id', userId)
    .single();
  if (data) setCachedProfile(data as CommunityProfile);
  return data as CommunityProfile | null;
}

export async function upsertProfile(profile: CommunityProfile): Promise<void> {
  setCachedProfile(profile);
  await supabase
    .from('community_profiles')
    .upsert({ ...profile, updated_at: new Date().toISOString() }, { onConflict: 'user_id' });
}

// ── Rooms ────────────────────────────────────────────────────────────────────

export async function getRooms(search = '', tag = ''): Promise<CommunityRoom[]> {
  let q = supabase
    .from('community_rooms')
    .select('*')
    .eq('is_active', true)
    .order('last_active', { ascending: false })
    .limit(60);
  if (tag) q = q.eq('course_tag', tag);
  if (search) q = q.ilike('name', `%${search}%`);
  const { data } = await q;
  return (data || []) as CommunityRoom[];
}

export async function createRoom(
  name: string, description: string, courseTag: string, profile: CommunityProfile
): Promise<CommunityRoom | null> {
  const { data } = await supabase
    .from('community_rooms')
    .insert({
      name: name.trim(),
      description: description.trim(),
      course_tag: courseTag.trim(),
      created_by: profile.user_id,
      created_by_name: profile.display_name,
      message_count: 0,
      member_count: 1,
      is_active: true,
      last_active: new Date().toISOString(),
    })
    .select()
    .single();
  return data as CommunityRoom | null;
}

// ── Messages ─────────────────────────────────────────────────────────────────

export async function getMessages(roomId: string, limit = 80): Promise<CommunityMessage[]> {
  const { data } = await supabase
    .from('community_messages')
    .select('*')
    .eq('room_id', roomId)
    .eq('is_flagged', false)
    .order('created_at', { ascending: true })
    .limit(limit);
  return (data || []) as CommunityMessage[];
}

export async function sendMessage(
  roomId: string, content: string, profile: CommunityProfile
): Promise<void> {
  await supabase.from('community_messages').insert({
    room_id: roomId,
    user_id: profile.user_id,
    display_name: profile.display_name,
    avatar_emoji: profile.avatar_emoji,
    avatar_color: profile.avatar_color,
    content: content.trim(),
  });
  // Update room last_active + message_count
  // Update last_active
  await supabase.from('community_rooms')
    .update({ last_active: new Date().toISOString() })
    .eq('id', roomId);
}

// ── Realtime subscription ────────────────────────────────────────────────────

export function subscribeToRoom(
  roomId: string,
  onMessage: (msg: CommunityMessage) => void
): () => void {
  const channel = supabase
    .channel(`community:${roomId}`)
    .on(
      'postgres_changes' as any,
      { event: 'INSERT', schema: 'public', table: 'community_messages', filter: `room_id=eq.${roomId}` },
      (payload: any) => {
        if (!payload.new.is_flagged) onMessage(payload.new as CommunityMessage);
      }
    )
    .subscribe();

  return () => { supabase.removeChannel(channel); };
}

// ── Avatar constants ─────────────────────────────────────────────────────────

export const STUDY_EMOJIS = [
  '📚','🧠','✏️','🔬','🎓','⚗️','📐','🌍','🧮','📝',
  '💡','🔭','🧬','📊','🏆','⚙️','🎯','🌱','✨','🦉',
];

export const AVATAR_COLORS = [
  '#C5A059','#4A7C59','#2563EB','#7C3AED','#DC2626',
  '#0891B2','#D97706','#059669','#DB2777','#1F2937',
];

export function fmtTime(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  if (diffMs < 60000)  return 'just now';
  if (diffMs < 3600000) return `${Math.floor(diffMs / 60000)}m`;
  if (diffMs < 86400000) return `${Math.floor(diffMs / 3600000)}h`;
  return d.toLocaleDateString('en-US', { day: '2-digit', month: '2-digit' });
}
