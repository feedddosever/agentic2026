-- Cache of searches typed in languages the glossary doesn't cover, turned into the register's Italian terms by Claude.
create table if not exists public.query_translations (
  q          text primary key,
  terms      text[] not null,
  created_at timestamptz not null default now()
);
alter table public.query_translations enable row level security;
