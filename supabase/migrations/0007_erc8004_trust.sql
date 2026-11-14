-- ERC-8004 trust layer and proofs of publication.

-- Proof that an official-list record is in the anchored list: Merkle siblings from its leaf to the dataset root
-- (sha256 of {"date","id","objects"} canonical JSON; sorted leaves; sorted-pair hashing; see pipeline/load_supabase.py).
alter table public.items add column if not exists dataset_id bigint references public.datasets(id);
alter table public.items add column if not exists merkle_proof text[];

-- ERC-8004 transactions Ritrovo sends: office feedback on returns (Reputation Registry) and the office's
-- validation of each routing decision (Validation Registry). Payloads are public decision summaries, no personal data.
create table if not exists public.erc8004_events (
  id           bigserial primary key,
  item_id      text references public.items(id) on delete set null,
  kind         text not null check (kind in ('feedback', 'validation_request', 'validation_response')),
  request_hash text,
  score        int,
  payload      jsonb,
  tx_hash      text,
  error        text,
  created_at   timestamptz not null default now()
);
create index if not exists erc8004_events_item on public.erc8004_events(item_id, created_at);
alter table public.erc8004_events enable row level security;
create policy erc8004_events_public_read on public.erc8004_events for select using (true);
