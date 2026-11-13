#!/usr/bin/env bash
# Build the consulate directory with Exa (needs EXA_API_KEY in Supabase secrets).
# Countries most represented among Rome's visitors. Usage: scripts/build-embassies.sh [CC ...]
set -euo pipefail
cd "$(dirname "$0")/.."; set -a; . ./.env; set +a
CODES=${*:-"US GB FR DE ES CN JP KR BR AR MX CA AU IN NL BE CH AT PL RO UA PT IE SE NO DK GR TR IL PH CO PE"}
for cc in $CODES; do
  printf '%s ' "$cc"
  curl -sS -X POST "$API_BASE/admin/embassy" -H "x-operator-token: $OPERATOR_TOKEN" -H 'content-type: application/json' \
    -d "{\"country_code\":\"$cc\"}" | python3 -c "import json,sys; d=json.load(sys.stdin); m=d.get('mission') or {}; print(m.get('mission_name') or d.get('error') or 'not found', '|', m.get('email',''), '|', m.get('source_url',''))"
done
