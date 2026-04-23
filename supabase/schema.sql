-- Run this once in your Supabase project: SQL Editor → New query → paste → Run

create table conversations (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid references auth.users(id) on delete cascade not null,
  title       text not null default 'Novi razgovor',
  language    text not null default 'sr' check (language in ('sr', 'en')),
  created_at  timestamptz default now(),
  updated_at  timestamptz default now()
);

create table messages (
  id               uuid primary key default gen_random_uuid(),
  conversation_id  uuid references conversations(id) on delete cascade not null,
  role             text not null check (role in ('user', 'assistant')),
  content          text not null,
  has_pdf          boolean not null default false,
  created_at       timestamptz default now()
);

alter table conversations enable row level security;
alter table messages enable row level security;

create policy "users see own conversations"
  on conversations for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "users see own messages"
  on messages for all
  using (
    conversation_id in (
      select id from conversations where user_id = auth.uid()
    )
  )
  with check (
    conversation_id in (
      select id from conversations where user_id = auth.uid()
    )
  );

create index on conversations(user_id);
create index on messages(conversation_id);
