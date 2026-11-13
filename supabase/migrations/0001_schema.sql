-- Ritrovo schema: catalogue of found items, citizen alerts, routing outbox, custody log.
create extension if not exists pg_trgm with schema extensions;
create extension if not exists unaccent with schema extensions;

-- Immutable wrapper so unaccent can be used in generated columns / indexes.
create or replace function public.f_unaccent(text) returns text
language sql immutable parallel safe strict as $$ select extensions.unaccent('extensions.unaccent', $1) $$;

create or replace function public.f_join(text[], text) returns text
language sql immutable parallel safe as $$ select coalesce(array_to_string($1, $2), '') $$;

create table public.items (
  id             text primary key,                 -- '2026-123' (official list) or 'IN-xxxxxx' (intake)
  source         text not null check (source in ('official_list', 'intake')),
  year           int,
  number         int,
  date_acquired  date not null,
  page           int,
  objects        text[] not null,
  description    text generated always as (public.f_join(objects, ' | ')) stored,
  categories     text[] not null default '{}',
  id_doc         text not null default 'none' check (id_doc in ('none', 'italian', 'foreign', 'mixed')),
  prefixes       text[] not null default '{}',     -- masked doc-number / IMEI prefixes as published
  colour         text,
  brand          text,
  found_where    text,
  finder_channel text,
  nationality    text,                             -- ISO country code of foreign documents (intake only)
  photo_path     text,
  status         text not null default 'in_custody' check (status in ('in_custody', 'routed', 'returned')),
  created_at     timestamptz not null default now(),
  fts            tsvector generated always as (
                   to_tsvector('simple'::regconfig, public.f_unaccent(lower(public.f_join(objects, ' ') || ' ' ||
                     coalesce(colour, '') || ' ' || coalesce(brand, '') || ' ' || coalesce(found_where, ''))))
                 ) stored
);
create index items_fts_idx on public.items using gin (fts);
create index items_desc_trgm_idx on public.items using gin (description extensions.gin_trgm_ops);
create index items_prefixes_idx on public.items using gin (prefixes);
create index items_date_idx on public.items (date_acquired);
create index items_categories_idx on public.items using gin (categories);

create table public.alerts (
  id              uuid primary key default gen_random_uuid(),
  created_at      timestamptz not null default now(),
  language        text not null default 'it',
  what            text not null,
  category        text,
  lost_on         date,
  lost_where      text,
  prefix          text,
  contact_phone   text,
  contact_email   text,
  status          text not null default 'open' check (status in ('open', 'matched', 'closed')),
  matched_item_id text references public.items (id)
);

create table public.embassies (
  country_code       text primary key,             -- ISO 3166-1 alpha-2
  country            text not null,
  mission_name       text,
  email              text,
  pec                text,
  phone              text,
  address            text,
  hours              text,
  lost_passport_note text,
  source_url         text,
  refreshed_at       timestamptz not null default now()
);

create table public.outbox (
  id              uuid primary key default gen_random_uuid(),
  item_id         text references public.items (id),
  alert_id        uuid references public.alerts (id),
  channel         text not null check (channel in ('app_io', 'embassy', 'email', 'sms', 'call')),
  recipient_label text not null,                  -- e.g. 'Consulate of the United States, Rome' (never a real send)
  language        text not null default 'it',
  subject         text,
  body            text not null,
  status          text not null default 'draft' check (status in ('draft', 'demo_sent')),
  agent_signature text,                             -- signature by the registered agent key, for /verify
  created_at      timestamptz not null default now()
);

create table public.custody_events (
  id         bigint generated always as identity primary key,
  item_id    text not null references public.items (id),
  event      text not null check (event in ('intake', 'routed', 'returned')),
  item_hash  text not null,
  tx_hash    text,
  chain_id   int,
  created_at timestamptz not null default now()
);

create table public.calls (
  conversation_id text primary key,
  language        text,
  intent          text,
  item_type       text,
  outcome         text,
  duration_s      int,
  created_at      timestamptz not null default now()
);

create table public.datasets (
  id          bigint generated always as identity primary key,
  source_url  text not null,
  pdf_sha256  text not null unique,
  records     int not null,
  merkle_root text not null,
  tx_hash     text,
  imported_at timestamptz not null default now()
);

-- Row level security: the public (anon) can read the catalogue, embassies and datasets.
-- Alerts, outbox, calls and custody writes go through the edge function (service role).
alter table public.items enable row level security;
alter table public.alerts enable row level security;
alter table public.embassies enable row level security;
alter table public.outbox enable row level security;
alter table public.custody_events enable row level security;
alter table public.calls enable row level security;
alter table public.datasets enable row level security;

create policy items_public_read on public.items for select using (true);
create policy embassies_public_read on public.embassies for select using (true);
create policy datasets_public_read on public.datasets for select using (true);
create policy custody_public_read on public.custody_events for select using (true);
-- outbox is read by the operator console through the edge function; no anon policy.
-- alerts: no anon policy at all (contact details).
