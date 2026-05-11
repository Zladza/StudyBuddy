-- Migration: files and conversation_files tables for Supabase Storage
-- Run in Supabase SQL Editor → New query → paste → Run

-- files table
create table if not exists public.files (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid references auth.users(id) on delete cascade not null,
  name         text not null,
  size         bigint not null,
  mime_type    text not null,
  storage_path text not null,
  created_at   timestamptz default now()
);

alter table public.files enable row level security;

create policy "users manage own files"
  on public.files for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- conversation_files join table
create table if not exists public.conversation_files (
  id               uuid primary key default gen_random_uuid(),
  conversation_id  uuid references public.conversations(id) on delete cascade not null,
  file_id          uuid references public.files(id) on delete cascade not null,
  created_at       timestamptz default now(),
  unique (conversation_id, file_id)
);

alter table public.conversation_files enable row level security;

create policy "users see own conversation files"
  on public.conversation_files for all
  using (
    exists (
      select 1 from public.conversations c
      where c.id = conversation_id and c.user_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from public.conversations c
      where c.id = conversation_id and c.user_id = auth.uid()
    )
  );

create index if not exists idx_files_user        on public.files(user_id, created_at);
create index if not exists idx_conv_files_conv   on public.conversation_files(conversation_id);
create index if not exists idx_conv_files_file   on public.conversation_files(file_id);

-- Storage RLS policies for study-files bucket
create policy "users upload own files"
  on storage.objects for insert
  to authenticated
  with check (bucket_id = 'study-files' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "users read own files"
  on storage.objects for select
  to authenticated
  using (bucket_id = 'study-files' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "users delete own files"
  on storage.objects for delete
  to authenticated
  using (bucket_id = 'study-files' and (storage.foldername(name))[1] = auth.uid()::text);
