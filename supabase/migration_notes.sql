-- Migration: notes table
-- Run in Supabase SQL Editor → New query → paste → Run

create table if not exists notes (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid references auth.users(id) on delete cascade not null,
  title       text not null default '',
  content     text not null default '',
  created_at  timestamptz default now(),
  updated_at  timestamptz default now()
);

alter table notes enable row level security;

create policy "users see own notes"
  on notes for all
  using (auth.uid() = user_id);

create index if not exists idx_notes_user on notes(user_id, updated_at);
