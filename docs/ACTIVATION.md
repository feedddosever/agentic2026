# Activation checklist (when keys and funds arrive)

Status: steps 1–5 done (keys in, voice agent created, 32 consulates built, contract deployed + agent 302 registered on Fuji). Remaining: 6 (APP_URL), 7 (GitHub secrets).

Everything is deployed already; each step switches one integration from fallback to live.
Check progress any time with:

```bash
set -a; . ./.env; set +a; curl -s $API_BASE/admin/status -H "x-operator-token: $OPERATOR_TOKEN"
```

## 1. Sponsor keys → Supabase secrets (builder)
Dashboard → project `agentic2026` → Edge Functions → Secrets. Exact names:
`ANTHROPIC_API_KEY`, `ELEVENLABS_API_KEY`, `EXA_API_KEY`. Secrets apply on the next cold start; redeploy the
function to apply them at once.

## 2. Claude
Nothing else to do. Test with an intake: `understanding.mode` and `routing.mode` become `llm`.

## 3. Exa
```bash
scripts/build-embassies.sh            # ~32 consulates, each with its source URL
```

## 4. ElevenLabs
```bash
curl -s -X POST $API_BASE/admin/setup-voice-agent -H "x-operator-token: $OPERATOR_TOKEN"   # → agent_id
```
Then set secret `ELEVENLABS_AGENT_ID` to that id (the web widget reads it from `GET /config`).
Optional phone line: import a Twilio number in ElevenLabs, assign it to the agent, and set
`ELEVENLABS_PHONE_NUMBER_ID` → alert matches trigger real outbound calls instead of voice notes.

## 5. Avalanche (Fuji)
Fund `AGENT_ADDRESS` (in `.env`) with test AVAX, then:
```bash
cd contracts && npm run deploy:fuji && npm run register:fuji      # writes deployments/fuji.json
```
Set secrets `CUSTODY_CONTRACT` and `ERC8004_AGENT_ID` from `deployments/fuji.json`, redeploy, then:
```bash
curl -s -X POST $API_BASE/chain/anchor-datasets -H "x-operator-token: $OPERATOR_TOKEN"
curl -s -X POST $API_BASE/chain/flush -H "x-operator-token: $OPERATOR_TOKEN"
```
If team1 requires mainnet: fund on C-Chain and use `--network avalanche` + `CHAIN_ID=43114`.

## 6. Front end
Set secret `APP_URL` to the Lovable app URL (pickup and verify links in messages then point to the app).

## 7. Sentinel workflow
GitHub repo → Settings → Secrets → Actions: `SUPABASE_ACCESS_TOKEN` (personal access token) and
`RITROVO_OPERATOR_TOKEN`. Run "Import official found-items list" once from the Actions tab.

## 8. Before the demo
```bash
scripts/reset-demo.sh && scripts/smoke.sh
```
