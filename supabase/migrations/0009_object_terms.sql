-- Translations of the official register's object names (top labels), for tourists: shown next to the Italian
-- name and used to turn a search in English/Spanish/French/German/Chinese into catalogue terms.
create table if not exists public.object_terms (
  it text primary key,
  en text, es text, fr text, de text, zh text,
  n int not null default 0
);
alter table public.object_terms enable row level security;
create policy object_terms_public_read on public.object_terms for select using (true);
