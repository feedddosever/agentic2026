#!/usr/bin/env bash
# Clear operational demo data (intakes, alerts, outbox, custody events, agent runs, calls).
# The official catalogue and dataset fingerprints are kept. Usage: scripts/reset-demo.sh
set -euo pipefail
cd "$(dirname "$0")/.."
python3 -I - <<'PY'
import sys; sys.path.insert(0, "pipeline"); import load_supabase as l
print(l.sql("izrggntqsssfzazjfhht", """
  delete from public.outbox; delete from public.custody_events; delete from public.agent_runs; delete from public.calls;
  update public.alerts set matched_item_id = null; delete from public.alerts;
  delete from public.items where source = 'intake';
  update public.items set status = 'in_custody', routing_decision = null, routing_reason = null, routed_at = null, returned_at = null
   where status <> 'in_custody' or routing_decision is not null;
  select count(*) as items from public.items;"""))
PY
