-- Run this once in Supabase SQL Editor:
-- https://supabase.com/dashboard/project/olowfkgwkjtnhuwqljny/sql/new

-- Chat messages
create table if not exists pclick_messages (
  id         bigint generated always as identity primary key,
  user_id    text not null,
  role       text not null check (role in ('user','assistant')),
  content    text not null,
  created_at timestamptz default now()
);
create index if not exists pclick_messages_user on pclick_messages(user_id, created_at);

-- Uploaded documents metadata
create table if not exists pclick_documents (
  id         bigint generated always as identity primary key,
  user_id    text not null,
  name       text not null,
  size_kb    int  default 0,
  created_at timestamptz default now()
);
create index if not exists pclick_documents_user on pclick_documents(user_id, created_at);

-- Allow anon reads/writes for the web app (RLS off for dev)
alter table pclick_messages  disable row level security;
alter table pclick_documents disable row level security;
