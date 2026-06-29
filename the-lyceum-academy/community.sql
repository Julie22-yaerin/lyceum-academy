-- ══════════════════════════════════════════════════════
--  Lyceum Community — run this in Supabase SQL Editor
--  Settings → SQL Editor → New query → paste → Run
-- ══════════════════════════════════════════════════════

-- ── Profiles ───────────────────────────────────────────
create table if not exists community_profiles (
  user_id     text primary key,          -- Firebase UID or dev UUID
  display_name text not null default 'Learner',
  avatar_emoji text not null default '📚',
  avatar_color text not null default '#C5A059',
  created_at   timestamptz default now(),
  updated_at   timestamptz default now()
);

-- ── Chat rooms ─────────────────────────────────────────
create table if not exists community_rooms (
  id              uuid default gen_random_uuid() primary key,
  name            text not null,
  description     text default '',
  course_tag      text default '',          -- e.g. "Calculus I", "Algorithms"
  created_by      text not null,            -- user_id
  created_by_name text not null default 'Learner',
  created_at      timestamptz default now(),
  last_active     timestamptz default now(),
  message_count   int  default 0,
  member_count    int  default 1,
  is_active       boolean default true      -- AI can set false to archive
);

-- ── Messages ────────────────────────────────────────────
create table if not exists community_messages (
  id           uuid default gen_random_uuid() primary key,
  room_id      uuid references community_rooms(id) on delete cascade,
  user_id      text not null,
  display_name text not null default 'Learner',
  avatar_emoji text not null default '📚',
  avatar_color text not null default '#C5A059',
  content      text not null,
  created_at   timestamptz default now(),
  is_flagged   boolean default false        -- AI moderation flag
);

-- ── Indexes ─────────────────────────────────────────────
create index if not exists idx_community_messages_room on community_messages(room_id, created_at);
create index if not exists idx_community_rooms_active  on community_rooms(is_active, last_active desc);
create index if not exists idx_community_rooms_tag     on community_rooms(course_tag);

-- ── Row Level Security (permissive for dev) ─────────────
alter table community_profiles enable row level security;
alter table community_rooms     enable row level security;
alter table community_messages  enable row level security;

-- Drop old policies if re-running
drop policy if exists "public_profiles_read"   on community_profiles;
drop policy if exists "public_profiles_write"  on community_profiles;
drop policy if exists "public_rooms_read"      on community_rooms;
drop policy if exists "public_rooms_insert"    on community_rooms;
drop policy if exists "public_rooms_update"    on community_rooms;
drop policy if exists "public_messages_read"   on community_messages;
drop policy if exists "public_messages_insert" on community_messages;

create policy "public_profiles_read"   on community_profiles for select using (true);
create policy "public_profiles_write"  on community_profiles for all    using (true) with check (true);
create policy "public_rooms_read"      on community_rooms    for select using (true);
create policy "public_rooms_insert"    on community_rooms    for insert with check (true);
create policy "public_rooms_update"    on community_rooms    for update using (true);
create policy "public_messages_read"   on community_messages for select using (true);
create policy "public_messages_insert" on community_messages for insert with check (true);

-- ── Enable Realtime ──────────────────────────────────────
-- Also go to: Supabase Dashboard → Database → Replication → community_messages ✓
alter publication supabase_realtime add table community_messages;
alter publication supabase_realtime add table community_rooms;
