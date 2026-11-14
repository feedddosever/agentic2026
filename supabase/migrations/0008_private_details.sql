-- Ownership questions beyond the document number: the cash amount (never published, like the official list).
alter table public.item_secrets add column if not exists kind text not null default 'last4' check (kind in ('last4', 'cash'));
alter table public.item_secrets alter column prefix drop not null;
-- The operator's raw note is no longer kept in the public record (it lives in the operator-only agent trace).
update public.items set intake_note = null where intake_note is not null;
