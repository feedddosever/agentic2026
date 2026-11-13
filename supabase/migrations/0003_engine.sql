-- Return engine, intake, signed outbox, agent traces, alert matching.

alter table public.items
  add column if not exists routing_decision text,
  add column if not exists routing_reason text,
  add column if not exists routed_at timestamptz,
  add column if not exists returned_at timestamptz,
  add column if not exists intake_note text,
  add column if not exists evidence_hash text;

alter table public.outbox
  add column if not exists signer text,
  add column if not exists payload_hash text;

-- One row per agent run (intake understanding, routing), with the tool calls it made: shown in the console.
create table if not exists public.agent_runs (
  id          uuid primary key default gen_random_uuid(),
  item_id     text references public.items (id),
  kind        text not null check (kind in ('intake', 'route', 'match')),
  mode        text not null check (mode in ('llm', 'rules')),
  model       text,
  steps       jsonb not null default '[]',
  result      jsonb,
  error       text,
  created_at  timestamptz not null default now()
);
alter table public.agent_runs enable row level security;

-- Private bucket for intake photos (operator console reads through signed URLs).
insert into storage.buckets (id, name, public)
values ('intake', 'intake', false)
on conflict (id) do nothing;

-- Alert matching: score open alerts against one item.
--   prefix match (document/IMEI)            +10
--   category overlap                         +2
--   lost date within [-2, +30] days of intake +2
--   text similarity (trigram on what vs description) up to +3
create or replace function public.match_alerts_for_item(p_item_id text, p_min_score real default 4)
returns table (alert_id uuid, score real, reasons text[])
language sql stable security definer set search_path = public, extensions as $$
  with i as (select * from public.items where id = p_item_id)
  select a.id,
         (case when public.prefix_matches(i.prefixes, a.prefix) then 10 else 0 end
          + case when a.category is not null and a.category = any (i.categories) then 2 else 0 end
          + case when a.lost_on is not null and i.date_acquired between a.lost_on - 2 and a.lost_on + 30 then 2 else 0 end
          + 3 * similarity(lower(i.description), lower(a.what)))::real as score,
         array_remove(array[
           case when public.prefix_matches(i.prefixes, a.prefix) then 'document/IMEI prefix matches' end,
           case when a.category is not null and a.category = any (i.categories) then 'same category' end,
           case when a.lost_on is not null and i.date_acquired between a.lost_on - 2 and a.lost_on + 30 then 'found in the right time window' end,
           case when similarity(lower(i.description), lower(a.what)) > 0.15 then 'similar description' end
         ], null) as reasons
  from public.alerts a, i
  where a.status = 'open'
    and (a.lost_on is null or i.date_acquired >= a.lost_on - 2)
  order by score desc
$$;
revoke all on function public.match_alerts_for_item(text, real) from public, anon, authenticated;

-- Public bucket for voice notes sent to alert authors (contain only the item summary, random paths).
insert into storage.buckets (id, name, public) values ('voice', 'voice', true) on conflict (id) do nothing;
