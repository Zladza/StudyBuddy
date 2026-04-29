-- Migration: add share_token to conversations + study groups tables
-- Run in Supabase SQL Editor → New query → paste → Run

-- 1. Share token on conversations
alter table conversations add column if not exists share_token uuid unique;

-- 2. Study groups
create table if not exists study_groups (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  created_by  uuid references auth.users(id) on delete cascade not null,
  created_at  timestamptz default now()
);

create table if not exists group_members (
  id          uuid primary key default gen_random_uuid(),
  group_id    uuid references study_groups(id) on delete cascade not null,
  user_id     uuid references auth.users(id) on delete cascade not null,
  joined_at   timestamptz default now(),
  unique (group_id, user_id)
);

create table if not exists group_messages (
  id           uuid primary key default gen_random_uuid(),
  group_id     uuid references study_groups(id) on delete cascade not null,
  user_id      uuid references auth.users(id) on delete set null,
  content      text not null,
  is_ai        boolean not null default false,
  display_name text,
  created_at   timestamptz default now()
);

-- 3. RLS
alter table study_groups   enable row level security;
alter table group_members  enable row level security;
alter table group_messages enable row level security;

create policy "members see their groups"
  on study_groups for select
  using (
    id in (select group_id from group_members where user_id = auth.uid())
  );

create policy "members manage group_members"
  on group_members for all
  using (
    group_id in (select group_id from group_members where user_id = auth.uid())
  )
  with check (
    group_id in (select group_id from group_members where user_id = auth.uid())
  );

create policy "members see group messages"
  on group_messages for select
  using (
    group_id in (select group_id from group_members where user_id = auth.uid())
  );

create policy "members send group messages"
  on group_messages for insert
  with check (
    group_id in (select group_id from group_members where user_id = auth.uid())
  );

-- 4. Indexes
create index if not exists idx_group_members_user on group_members(user_id);
create index if not exists idx_group_members_group on group_members(group_id);
create index if not exists idx_group_messages_group on group_messages(group_id, created_at);

-- 5. Enable Realtime for group_messages
-- After running this SQL, also go to:
--   Supabase Dashboard → Database → Replication
--   and enable "group_messages" table under the supabase_realtime publication
