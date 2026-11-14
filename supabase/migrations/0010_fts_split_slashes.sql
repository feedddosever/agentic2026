-- "TROLLEY/VALIGIA" was indexed as one file-path token, so "valigia" (or "trolley") never matched. Split on "/".
drop index if exists public.items_fts_idx;
alter table public.items drop column if exists fts;
alter table public.items add column fts tsvector generated always as (
  to_tsvector('simple'::regconfig, public.f_unaccent(lower(translate(public.f_join(objects, ' ') || ' ' ||
    coalesce(colour, '') || ' ' || coalesce(brand, '') || ' ' || coalesce(found_where, ''), '/\', '  '))))
) stored;
create index items_fts_idx on public.items using gin (fts);
