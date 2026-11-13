#!/usr/bin/env bash
# Smoke test for the deployed Ritrovo API. Usage: scripts/smoke.sh [api_base]
set -euo pipefail
B=${1:-https://izrggntqsssfzazjfhht.supabase.co/functions/v1/api}
pass=0; fail=0
check() { # name, expected substring, curl args...
  local name=$1 want=$2; shift 2
  local out; out=$(curl -sS "$@" 2>&1 || true)
  if [[ "$out" == *"$want"* ]]; then echo "PASS $name"; pass=$((pass+1)); else echo "FAIL $name -> ${out:0:300}"; fail=$((fail+1)); fi
}
post() { echo -X POST "$B$1" -H content-type:application/json -d "$2"; }
check health        '"ok":true'            "$B/health"
check stats         '"items":15843'        "$B/stats"
check search-prefix '"id":"2025-255"'      $(post /tools/search '{"prefix":"EL6551234"}')
check search-text   '"total_matches"'      $(post /tools/search '{"query":"portafogli passaporto estero","lost_from":"2026-10-20","lost_to":"2026-10-25"}')
check search-none   '"total_matches":0'    $(post /tools/search '{"prefix":"ZZZZ9999"}')
check verify-yes    '"match":true'         $(post /tools/verify '{"item_id":"2025-255","prefix":"EL655"}')
check verify-no     '"match":false'        $(post /tools/verify '{"item_id":"2025-255","prefix":"AB123"}')
check fees-docs     '"total":0'            $(post /tools/fees '{"item_id":"2025-5","pickup_date":"2025-01-10"}')
check fees-storage  '"total":27.8'         $(post /tools/fees '{"item_id":"2026-3","pickup_date":"2026-11-14"}')
check pickup-pack   '"delega_pdf_url"'     $(post /tools/pickup-pack '{"item_id":"2026-3","language":"en"}')
check pickup-page   '"documents_to_bring"' "$B/pickup/2026-3?lang=en"
check delega-pdf    '%PDF'                 "$B/pickup/2026-3/delega.pdf?owner=Mario%20Rossi&delegate=Anna%20Bianchi"
check item          '"id":"2026-3"'        "$B/items/2026-3"
check alert-bad     '"error"'              $(post /tools/alert '{}')
check unknown-route '"error"'              "$B/nope"
check datasets      '"merkle_root"'        "$B/datasets"
check agent-card    'registration-v1'      "$B/agent-registration.json"
check verify-404    '"valid":false'        "$B/verify/00000000-0000-0000-0000-000000000000"
check op-locked     'operator token'       "$B/queue"
check offices       '"guidance"'           $(post /tools/other-offices '{"what":"zaino","where":"metro A"}')
if [[ -n "${OPERATOR_TOKEN:-}" ]]; then
  check op-status   '"integrations"'       "$B/admin/status" -H "x-operator-token: $OPERATOR_TOKEN"
  check op-queue    '['                    "$B/queue" -H "x-operator-token: $OPERATOR_TOKEN"
fi
echo "passed $pass, failed $fail"; [[ $fail -eq 0 ]]
