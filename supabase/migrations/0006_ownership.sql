-- Ownership proof. The official list publishes only the first five characters of a document/IMEI number, so they
-- can't prove anything. At intake the operator holds the document: we keep a salted hash of its LAST four
-- characters (never the number). A caller who knows them is the owner; attempts are rate-limited.
create table if not exists public.item_secrets (
  item_id     text not null references public.items(id) on delete cascade,
  prefix      text not null,
  suffix_hash text not null,
  created_at  timestamptz not null default now()
);
create index if not exists item_secrets_item on public.item_secrets(item_id);

create table if not exists public.verify_attempts (
  id         bigserial primary key,
  item_id    text not null references public.items(id) on delete cascade,
  ok         boolean not null,
  created_at timestamptz not null default now()
);
create index if not exists verify_attempts_item on public.verify_attempts(item_id, created_at);

-- Service role only: no policies, no grants.
alter table public.item_secrets enable row level security;
alter table public.verify_attempts enable row level security;
revoke all on public.item_secrets, public.verify_attempts from anon, authenticated;
