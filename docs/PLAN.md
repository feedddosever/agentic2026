# Ritrovo: build plan

Agentic Hack Rome, 2nd edition. Challenge 03 (Oggetti smarriti).
Deadline: **Sat 14 Nov 2026, 14:00 CET** (repo public, live link, 3-minute video, form).
Plan written Fri 13 Nov, 18:30 CET. All times below are Rome time.

This file is the source of truth. Tasks are ticked as they are done. Any change to the plan
is recorded in the change log at the bottom with the reason; nothing is silently dropped.

---

## 1. Product in one paragraph

Rome's Reparto Oggetti Rinvenuti logs ~600 found objects a month and publishes them as
PDFs that cannot be searched (Type 3 fonts, no Unicode map). Ritrovo decodes those lists
(done: 15,843 records), then **returns items instead of waiting to be searched**: an operator
intake turns a photo and a dictated note into a structured record; a return-engine agent
routes every item to the right channel (Italian identity documents → App IO notice,
foreign documents → that country's consulate in Rome, everything else → matching against
citizens' alerts); a 24/7 multilingual phone agent answers citizens, verifies ownership
from the document/IMEI prefix the city already publishes, and prepares the pickup pack;
custody and returns are logged on Avalanche under a verifiable agent identity (ERC-8004).

North-star metric: **share of items returned to their owner**, and days from intake to
first owner contact.

## 2. Ground rules (non-negotiable)

1. **No real outreach.** Nothing is ever sent to a real embassy, citizen or the city.
   Embassy batches, App IO notices and emails go to an outbox table shown in the UI.
   Voice calls and SMS go only to phone numbers the builder registers for the demo.
2. **No personal data public or onchain.** Onchain data is hashes only. Alert contact
   details live behind RLS and are never returned by public endpoints. Document numbers
   stay masked exactly as in the official list.
3. **Secrets never in git or chat.** API keys go through the environment's secure
   credential form or Supabase secrets. The testnet deploy key lives in an ignored `.env`.
4. **Every sponsor integration must sit on the main user journey.** No decorative calls.
5. **Demo safety:** every live dependency (phone, Exa, chain, LLM) has a recorded or
   offline fallback that the demo can switch to.

## 3. Scope

**In scope (must ship)**
- M1 Official-list decoder + catalogue (done) and scheduled re-import of new lists.
- M2 Backend: database, search with ownership-prefix check, fees, pickup pack, alerts.
- M3 Phone/voice agent (ElevenLabs) using the backend as tools; multilingual.
- M4 Return engine agent (Claude + Exa): channel decision, embassy routing, outbox.
- M5 Operator intake: photo + dictation → structured item → return engine.
- M6 Alerts ("Sentinel"): new items matched against alerts → callback.
- M7 Avalanche: custody log contract, ERC-8004 agent registration, dataset anchor.
- M8 Lovable front end: citizen app + operator console (built by the builder from my prompts).
- M9 README, architecture doc, demo script, video script, submission checklist.

**Nice to have (only after M1–M9 are green)**
- N1 ERC-8004 reputation entries for completed returns (public return rate).
- N2 Exa external sightings (public "found wallet in Rome" posts), clearly labelled.
- N3 Small insights page (what Rome loses, when) for the council committee.
- N4 Real Twilio phone number with inbound + outbound calls (fallback: browser voice widget).

**Out of scope**
- Real integration with App IO, SIREWEB payments or the office's internal database.
- Authentication beyond a single demo operator login.

## 4. Architecture

```
 comune.roma.it PDFs ──► pipeline/ (Python: decode → parse → build)  ◄── GitHub Action (daily)
                                   │ upsert
                                   ▼
                        Supabase Postgres  (items, alerts, embassies, outbox,
                                   ▲        custody_events, calls, datasets)
                                   │
              Supabase Edge Function `api` (TypeScript, one router)
     ┌──────────────┬──────────────┼───────────────┬────────────────┬──────────────┐
  /tools/*       /intake       /engine/route    /alerts/match   /webhooks/eleven  /chain/*
  (agent tools)  (Claude       (return-engine    (Sentinel →     (post-call       (viem → Avalanche
                  vision)       agent: Claude     outbound call)   analysis)        Fuji/C-Chain)
                                + Exa)
     ▲                                                                   
     │ server tools (webhooks)                                           
 ElevenLabs agent ◄── phone (Twilio) / browser widget ◄── citizens       
                                                                         
 Lovable app (citizen + operator console) ──► Supabase (anon key, RPC + api)
```

Choices and why:
- **Supabase** for the database and the API: Lovable connects to it natively, I can manage
  it from this session, and Postgres full-text + trigram search is enough because the
  catalogue uses a small, fixed Italian vocabulary. No embeddings: the LLM agent translates
  "black wallet with my US passport" into catalogue terms through tool parameters.
- **One edge function with a router** instead of many: one deploy, one set of secrets.
- **Python stays offline** (PyMuPDF decoder) and runs in GitHub Actions, not in Deno.
- **Claude** is the reasoning model for intake (vision) and the return engine.
  The ElevenLabs agent uses its own hosted LLM so the phone path has no extra hop.

## 5. Data model (Postgres)

| Table | Key columns |
|---|---|
| `items` | `id` text pk (`2026-123`, `intake-…`), `source` (`official_list`/`intake`), `year`, `number`, `date_acquired`, `objects` text[], `description`, `categories` text[], `foreign_doc` bool, `id_doc` (`none`/`italian`/`foreign`), `prefixes` text[] (doc-number and IMEI prefixes), `colour`, `brand`, `found_where`, `finder_channel`, `nationality`, `photo_path`, `status` (`in_custody`/`routed`/`returned`), `fts` tsvector |
| `alerts` | `id`, `language`, `what`, `category`, `lost_on`, `lost_where`, `prefix`, `contact_phone`, `contact_email`, `status`, `matched_item_id` (RLS: no public read) |
| `embassies` | `country_code`, `country`, `mission_name`, `email`, `pec`, `phone`, `address`, `hours`, `lost_passport_note`, `source_url`, `refreshed_at` |
| `outbox` | `id`, `item_id`, `channel` (`app_io`/`embassy`/`email`/`sms`/`call`), `recipient_label`, `language`, `subject`, `body`, `status` (`draft`/`demo_sent`), `created_at` |
| `custody_events` | `id`, `item_id`, `event` (`intake`/`routed`/`returned`), `item_hash`, `tx_hash`, `chain_id`, `created_at` |
| `calls` | `conversation_id`, `language`, `intent`, `item_type`, `outcome`, `created_at` |
| `datasets` | `source_url`, `pdf_sha256`, `records`, `merkle_root`, `tx_hash`, `imported_at` |

## 6. API / agent tool contract (`/functions/v1/api`)

| Route | Used by | Input → output |
|---|---|---|
| `POST /tools/search` | voice agent, app | `{query, category?, lost_from?, lost_to?, prefix?}` → top 10 items with masked objects, date, why-matched |
| `POST /tools/verify` | voice agent | `{item_id, prefix}` → `{match: bool, object}` |
| `POST /tools/fees` | voice agent, app | `{item_id, pickup_date?}` → custody €4.60 + processing €5.80 + storage €17.40 if > 30 days; embassy and ID-document exemptions |
| `POST /tools/pickup-pack` | voice agent, app | `{item_id, language, owner_name?, delegate_name?}` → link to pickup page (fees, hours, map, documents, pre-filled delega PDF) |
| `POST /tools/alert` | voice agent, app | `{what, lost_on, lost_where, prefix?, language, phone?, email?}` → alert id |
| `POST /tools/other-offices` | voice agent, app | `{what, where, when}` → Exa-backed list of other lost-and-found offices (ATAC, Trenitalia, Italo, airports, taxi, Vatican) |
| `POST /intake/preview` | operator console | photo + dictation → proposed register entry, nothing saved |
| `POST /intake` | operator console | photo + dictation text → structured item (Claude vision) → insert → route | (accepts operator-confirmed `fields`) |
| `POST /engine/route` | intake, importer | `{item_id}` → decision + outbox rows + custody event |
| `POST /alerts/match` | intake, importer | `{item_ids}` → matches → callback (call or demo notification) |
| `POST /webhooks/elevenlabs` | ElevenLabs | post-call data → `calls` |
| `GET  /verify/:message_id` | citizens | proves an outbox message came from the registered Ritrovo agent |
| `GET  /queue` · `GET /outbox` · `GET /alerts` | operator console | recent items with routing decision · outbox messages · alerts with masked contacts |
| `GET  /items/:id/custody` · `POST /items/:id/return` | console | custody timeline with explorer links · mark returned (custody event) |
| `GET  /datasets` | about page | official-list fingerprints with anchor tx |

## 7. Phases, tasks and acceptance criteria

### P0 Setup and feasibility (18:30–19:00)
- [x] Check toolchain: Supabase MCP access, Deno or Supabase CLI, Foundry or solc/viem, Node.
- [x] Supabase project: using `agentic2026` (ref `izrggntqsssfzazjfhht`, eu-west-1) on a new account; see change log.
- [x] Repo skeleton: `pipeline/`, `supabase/`, `contracts/`, `agents/`, `lovable/`, `docs/`.
- [ ] Ask the builder for keys (secure form, when needed, not all at once): Anthropic, ElevenLabs, Exa; later Twilio (optional).
- **Accept:** project exists, skeleton committed, list of blocked items known.

### P1 Data into the database (19:00–20:00)
- [x] Extend `build_dataset.py`: `id_doc` type, `prefixes` (doc numbers before `*`, IMEI prefixes), `foreign_doc`.
- [x] pytest for decoder/parser on fixed pages (page 1 of each year) and prefix extraction.
- [x] Migration: tables, indexes (GIN on `fts`, trigram on `description`, GIN on `prefixes`), RLS.
- [x] Load 15,843 items; `datasets` row with PDF sha256 + Merkle root.
- **Accept:** `select count(*) from items` = 15,843; search for `EL655` returns the record; RLS blocks anonymous reads of `alerts`.

### P2 Search and citizen tools (20:00–22:00)
- [x] SQL function `search_items` (fts + trigram + prefix + date window + category, ranked).
- [x] Edge function `api` with `/tools/search|verify|fees|pickup-pack|alert`.
- [x] Pickup page + delega PDF generation (pre-filled from the official form layout).
- [x] Smoke test script `scripts/smoke.sh` hitting every route.
- **Accept:** smoke script green against the deployed function; English query "black wallet with US passport" returns relevant items when the agent passes Italian terms.

### P3 ElevenLabs voice agent (22:00–23:30)  · needs ElevenLabs key
- [x] `agents/elevenlabs/agent.json`: prompt, languages (it, en, es, fr, de, zh, ja…), server tools mapped to P2 routes, knowledge base (service page, Delibera 421/2023 fees, c.c. 927–931, hours).
- [x] `agents/elevenlabs/setup.ts` creates/updates the agent through the API (reproducible).
- [x] Post-call data collection → `/webhooks/elevenlabs` → `calls`.
- [x] Browser widget embed snippet for the Lovable app; Twilio number if the builder provides one.
- **Accept:** a test conversation in English finds a passport by prefix, states fees, sends the pickup pack link; a conversation in Italian files an alert.

### P4 Exa: embassies and other offices (23:30–01:00)  · needs Exa key
- [x] `agents/exa/build_embassies.ts`: Exa Agent API run per country with structured output → `embassies` (start with the 30 countries most present among tourists; expand if time).
- [x] `/tools/other-offices`: Exa search + contents restricted to official domains, Claude summarises to a short list with hours and contacts.
- [x] Exa Monitor (or scheduled re-run) to keep embassy contacts fresh.
- **Accept:** `embassies` has ≥ 30 rows with a source URL each; "lost my bag on metro line A" returns ATAC's office with current contacts.

### P5 Return engine and operator intake (01:00–03:30)  · needs Anthropic key
- [x] `/intake`: photo + dictation → Claude vision → structured fields (objects, colour, brand, nationality of documents, found where, finder channel); masks document numbers like the official list.
- [x] `/engine/route`: agent loop with tools `classify`, `lookup_embassy`, `exa_find_mission` (fallback), `draft_notice`, `log_custody`; writes `outbox` rows in the right language; Italian docs → App IO-style notice; foreign docs → embassy batch; others → `/alerts/match`.
- [x] Daily embassy batch view (grouped outbox per mission).
- **Accept:** a photo of a wallet with a (sample) foreign passport ends as an embassy outbox draft addressed to the right consulate, plus a custody event.

### P6 Avalanche (03:30–05:00)  · needs a funded testnet wallet
- [x] `contracts/CustodyLog.sol` (events: Intake, Routed, Returned, DatasetAnchored; owner-only writes) + tests.
- [x] Deploy to Fuji (mainnet only if team1 requires it); verify on the explorer.
- [x] Register the Ritrovo agent in the ERC-8004 Identity Registry (agent card JSON hosted with the app).
- [x] `/chain/*` helper in the edge function (viem); `/verify/:message_id` page data.
- [x] Anchor both datasets (PDF hash + Merkle root).
- **Accept:** explorer shows contract, dataset anchors and at least one intake → return lifecycle; the agent id resolves in an ERC-8004 explorer.

### P7 Sentinel automation (05:00–06:30)
- [x] `/alerts/match`: match new items against open alerts (category + prefix + date window + text), Claude double-checks borderline matches.
- [x] Callback: ElevenLabs outbound call to the alert's registered demo number (fallback: in-app voice message generated with ElevenLabs TTS).
- [x] GitHub Action `import-official-list.yml`: daily; detects a new PDF on the service page, decodes, upserts, anchors, triggers matching.
- **Accept:** registering an alert, then doing an intake that matches it, produces a callback within a minute.

### P8 Lovable front end (from 21:00, builder drives, in parallel)
- [x] `lovable/PROMPTS.md`: ordered prompts, one screen per prompt, with the API contract and Supabase keys to use.
- [ ] Citizen app: search in any language, item page with ownership check, pickup pack, alert sign-up, voice widget, `verify message` page.
- [ ] Operator console: intake (camera + dictation), return queue/outbox, embassy batches, custody timeline with explorer links.
- **Accept:** both apps live on a public URL and working against the real backend.

### P9 Hardening and docs (06:30–10:00)
- [ ] End-to-end rehearsal of the demo script three times; fix anything flaky.
- [ ] Fallback switches (`DEMO_MODE` env: recorded Exa results, pre-signed chain txs, text chat instead of voice).
- [x] README (problem, numbers, architecture, how to run, sponsor usage), `docs/ARCHITECTURE.md`, `docs/DEMO.md`.
- [ ] Check every judging criterion against the product (idea/impact, technical execution, demo).
- **Accept:** a fresh reader can run the pipeline and deploy from the README; demo runs in < 3:00.

### P10 Video and submission (10:00–13:30, feature freeze 12:00)
- [x] Video script (3:00) and shot list; builder records it.
- [ ] Repo public; live link; submission form fields filled (`docs/SUBMISSION.md`), Avalanche contract address included.
- **Accept:** submitted before 13:30 (30-minute buffer).

## 8. Demo script (target 2:50)

1. 0:00 The problem: copy text from the official PDF → gibberish. "Rome publishes 600 found objects a month in a file nobody can read."
2. 0:20 Decoded: 15,843 items; 48% contain an identity document — the city could return them.
3. 0:40 Operator intake: photo of a wallet with a foreign passport → structured record → return engine routes it to the consulate (outbox) → custody event on Avalanche.
4. 1:30 Phone call in English: "I lost my wallet…" → prefix check → fees → pickup pack by text.
5. 2:10 Sentinel: an alert filed earlier matches a new intake → the agent calls back.
6. 2:40 Verify-message page: the call came from the registered ERC-8004 agent. Close on the metric.

## 9. Risks and fallbacks

| Risk | Fallback |
|---|---|
| Venue Wi-Fi or phone network fails | Browser voice widget over hotspot; recorded call in the video |
| ElevenLabs/Exa/Claude rate limits or outage | `DEMO_MODE` cached responses for the scripted flow |
| Fuji faucet empty / no AVAX | Ask team1 for test AVAX; pre-deploy early; read-only explorer links in demo |
| Lovable credits run out | I build a minimal static front end against the same API |
| Supabase limits | Catalogue also served from a static JSON in the app |
| Embassy contacts wrong | Each row shows its source URL; outbox is draft-only anyway |

## 10. What the builder must provide (and when)

| Item | Needed by | How |
|---|---|---|
| Supabase access (MCP connected) | P0 | already connected, to be confirmed |
| Anthropic API key | P5 (earlier if possible) | secure credential form |
| ElevenLabs API key (Creator code from Discord) | P3 | secure credential form |
| Exa API key (promo code from WhatsApp) | P4 | secure credential form |
| Testnet AVAX to the deploy address I generate | P6 | Fuji faucet / team1 |
| Ask team1: Fuji OK or mainnet required? | P6 | at the venue |
| Lovable account + credits; run the prompts | P8 | Lovable |
| Twilio account + number (optional) | P3/P7 | Twilio console |
| Make the GitHub repo public | P10 | GitHub settings |
| Record the video | P10 | screen recording |

## 11. Change log

- [0] 18:30 Plan written. (Later entries are numbered in order; all of them were made on Friday
  between 18:30 and 19:30 CET, ahead of the schedule above.)
- [1] P0: the original Supabase account hit the free 2-project limit; the builder chose a new
  account instead of pausing a project. Access is through a personal access token (Management API)
  instead of the Supabase MCP connector. The new account's existing project `agentic2026` is used.
  A dedicated cloud environment `agentic2026` (limited network) holds this project's secrets.
- [2] P1 done: 15,843 items loaded; `id_doc` + `prefixes` added (9,109 records with an ownership
  prefix); both datasets fingerprinted (PDF sha256 + Merkle root).
- [3] P2 done: `api` edge function deployed (verify_jwt off; public tools, operator routes will check
  `x-operator-token`); 15/15 smoke tests pass; delega PDF pre-fill verified visually. The pickup *page* is
  served as JSON by the API and rendered by the Lovable app (P8).
- [4] Keys: `api.anthropic.com` bypasses the egress proxy, so injected credentials can't reach it from
  this container. Decision: every sponsor/LLM key lives only in Supabase Edge Function secrets, and
  one-off jobs (ElevenLabs agent setup, embassy directory build) run as operator-only routes of the edge
  function. The builder enters each key once, in the Supabase dashboard.
- [5] Order change while keys are pending: P6 (contract, no key needed) and P8 prompts move ahead of
  P3/P4/P5; those start as soon as the keys are in.
- [6] P8 prompts written (8 prompts); operator routes added to the API contract (section 6) so the
  front end and P5–P7 build against the same spec. Agent/deploy wallet generated (address in `.env`, testnet only).
- [7] P6 (code) done: CustodyLog.sol, 9 Hardhat tests, deploy + ERC-8004 register scripts (dry-run OK on a
  local chain). Live deploy waits for test AVAX. Note: ERC-8004 forbids an agent owner from giving its own agent
  feedback, so N1 (public return rate via the Reputation Registry) needs a separate office wallet as reviewer.
- [8] P5 + P7 matcher done in rules mode (no keys): intake → custody → routing agent (Claude tool loop when the
  key exists; deterministic policy guard always) → signed outbox (EIP-191 by the agent key; /verify detects
  tampering) → alert matching → returns. Privacy fix: full document numbers are masked before anything is
  stored, logged or sent to the LLM. 7 rule tests + 20 smoke checks pass.
- [9] P3/P4/P7 code done ahead of keys. Changes vs plan: the ElevenLabs setup runs as an operator route of the
  edge function (`/admin/setup-voice-agent`, key stays in Supabase) instead of a local `setup.ts`; call analytics
  are pulled with `/admin/sync-calls` instead of a post-call webhook (no workspace webhook secret needed);
  `/tools/other-offices` uses Exa's structured output directly (no extra Claude call). Sentinel importer verified
  against the live city page (idempotent) and on a simulated new list (40 items re-imported, prefix alert
  notified). `scripts/reset-demo.sh` clears demo data.
- [10] Docs: README, ARCHITECTURE, DEMO (script, Q&A, fallbacks, video plan), ACTIVATION (what to run when
  each key/fund arrives), SUBMISSION (form fields). Lovable prompts updated to the final API (agent trace drawer,
  system tab, widget id from `/config`). Added operator routes `/items/:id/trace` and `/embassies`.
- [11] Keys in. Live and tested end to end:
  - ElevenLabs agent `agent_3401m7b4cffre9cvd3wcyzzazdge` (LLM claude-sonnet-5-5, ElevenLabs' recommendation for
    tool use; 6 webhook tools; 8 languages; widget language selector). Tested over its public WebSocket in
    English (prefix → verify → fees → pickup pack, all correct) and Italian (no false match; offers alert).
    Change: prompt uses the `timezone` setting instead of a `{{system__time_utc}}` placeholder; the knowledge
    base is replaced by tool results (office facts come from the API, so they can't drift).
  - Exa: 32 consulates built (each with an official source URL, ~6 s each); other-offices tool live.
  - Claude intake + routing agent: 27 s per intake (3 s understanding, ~20 s routing in 3 turns with parallel
    tools). Fixed: model spellings normalised to the catalogue (CARTA IDENTITA', Nr:) so prefixes/doc kind work.
  - Full scenario: alert → intake → US Embassy draft (real consular address) + email to alert author + ElevenLabs
    voice note (MP3), all signed. The policy guard did not need to add anything.
  - Embassy refresh is a re-run of `scripts/build-embassies.sh` (not an Exa Monitor): simpler, same result.
- [12] P6 live on Fuji: CustodyLog 0xa5aAb3b1743922ED1eabaB6C2647787B92807B48, both lists anchored, agent registered as
  ERC-8004 agentId 302 and bound to the contract; registration file lists the registration back. Full lifecycle
  (intake → routed → returned) confirmed by receipts (blocks 61019494/508/511). Setup gas cost ≈ 0.0000000002 AVAX.
  Source verification on Snowtrace not done (optional).
- [13] Voice autofill (builder's idea). Citizen side: 4 ElevenLabs client tools (show_search_results, show_item,
  show_pickup_pack, fill_alert_form), fire-and-forget, registered by the widget; tested over WebSocket (all four
  fired with correct parameters, "yesterday" resolved via timezone). Operator side: `POST /intake/preview` (4.9 s,
  nothing saved) + `fields` on `/intake` (mode "operator" in the trace). Lovable prompts 9–10. APP_URL set to
  https://screenshot-to-spark-3870.lovable.app (not yet published at the time of writing).
- [14] Browser test of the published app (https://screenshot-to-spark-3870.lovable.app): citizen search, ownership
  check, pickup pack (voice-filled names), alert form (voice-filled), verify page, operator console (intake preview →
  confirm → routed → onchain, agent trace, queue sheet, outbox batches with voice note, system tab with 32 consulates)
  all work. Privacy bug found and fixed: alphanumeric document numbers (e.g. German ID L01X00T47) and phone numbers
  in operator notes were not masked in the stored note and the agent trace. New shared `maskIds` (6+ alphanumeric
  chars with ≥3 digits; URLs and record ids protected) is used everywhere; regression tests added (10 rule tests).
  Operator token rotated after testing. Lovable prompt 11 for three small UI fixes.
