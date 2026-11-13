-- Catalogue search used by the voice agent, the citizen app and the alert matcher.
-- q:        free text in catalogue vocabulary (Italian terms; the agent translates), OR-matched with prefixes
-- p_prefix: ownership prefix said by the caller (document number / IMEI); matches when either the caller's
--           string starts with the published prefix (caller knows more digits) or vice versa (min 4 chars)
create or replace function public.prefix_matches(published text[], said text)
returns boolean language sql immutable parallel safe as $$
  select said is not null and length(said) >= 4 and exists (
    select 1 from unnest(published) p
    where length(p) >= 4 and (said like p || '%' or p like said || '%'))
$$;

create or replace function public.search_items(
  q text default null,
  p_category text default null,
  p_from date default null,
  p_to date default null,
  p_prefix text default null,
  p_limit int default 8
) returns table (
  id text, date_acquired date, objects text[], categories text[], id_doc text, status text,
  prefix_match boolean, score real, total_count bigint
) language plpgsql stable security invoker set search_path = public, extensions as $$
declare
  pfx text := nullif(regexp_replace(upper(coalesce(p_prefix, '')), '[^A-Z0-9]', '', 'g'), '');
  tq text;
  tsq tsquery;
  words tsquery[];
begin
  if q is not null then
    select string_agg(w || ':*', ' | '), array_agg(to_tsquery('simple', w || ':*')) into tq, words
    from (select distinct w from unnest(regexp_split_to_array(public.f_unaccent(lower(q)), '[^a-z0-9]+')) w
          where length(w) >= 3) t;
    if tq is not null then tsq := to_tsquery('simple', tq); end if;
  end if;

  return query
  with hits as (
    select i.*, public.prefix_matches(i.prefixes, pfx) as pm
    from public.items i
    where (p_category is null or p_category = any (i.categories))
      and (p_from is null or i.date_acquired >= p_from)
      and (p_to is null or i.date_acquired <= p_to)
  )
  select h.id, h.date_acquired, h.objects, h.categories, h.id_doc, h.status,
         h.pm,
         (case when h.pm then 10 else 0 end
          + coalesce((select count(*) from unnest(words) wq where h.fts @@ wq), 0)
          + coalesce(ts_rank(h.fts, tsq), 0)
          + case when tsq is not null then similarity(h.description, q) else 0 end)::real as score,
         count(*) over () as total_count
  from hits h
  where case
          when pfx is not null then h.pm
          when tsq is not null then h.fts @@ tsq
          else true
        end
  order by score desc, h.date_acquired desc
  limit greatest(1, least(p_limit, 50));
end
$$;

grant execute on function public.search_items(text, text, date, date, text, int) to anon, authenticated;
grant execute on function public.prefix_matches(text[], text) to anon, authenticated;

-- Small public stats for the landing page and the pitch.
create or replace view public.catalogue_stats with (security_invoker = true) as
select count(*) as items,
       count(*) filter (where id_doc <> 'none') as with_identity_doc,
       count(*) filter (where id_doc in ('foreign', 'mixed')) as with_foreign_doc,
       count(*) filter (where cardinality(prefixes) > 0) as with_ownership_prefix,
       min(date_acquired) as first_date, max(date_acquired) as last_date
from public.items;
grant select on public.catalogue_stats to anon, authenticated;
