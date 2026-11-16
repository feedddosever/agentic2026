-- The daily import now goes through the API (operator token only, no Supabase account token in GitHub).
-- Bulk-set each record's Merkle proof for a dataset.
create or replace function public.import_set_proofs(p_dataset_id bigint, p_rows jsonb) returns int
language sql security definer set search_path = public as $$
  with v as (
    select r->>'id' as id, array(select jsonb_array_elements_text(r->'proof')) as proof
    from jsonb_array_elements(p_rows) r
  ), u as (
    update public.items i set dataset_id = p_dataset_id, merkle_proof = v.proof from v where i.id = v.id returning 1
  )
  select count(*)::int from u;
$$;
revoke all on function public.import_set_proofs(bigint, jsonb) from public, anon, authenticated;
grant execute on function public.import_set_proofs(bigint, jsonb) to service_role;
