-- Intakes confirmed (and possibly edited) by the operator before saving.
alter table public.agent_runs drop constraint if exists agent_runs_mode_check;
alter table public.agent_runs add constraint agent_runs_mode_check check (mode in ('llm', 'rules', 'operator'));
