# Architecture

## Components

| Path | What | Tech |
|---|---|---|
| `pipeline/decode_pdf.py` | Decodes the official PDFs: each Type 3 glyph is identified by the sha1 of its CharProc stream and mapped through `glyph_table.json` (102 shapes, hand-labelled once) | Python, PyMuPDF |
| `pipeline/parse_records.py` | Rebuilds records from positioned lines (date → description → number layout, fixed-width wraps) | Python |
| `pipeline/build_dataset.py` | Repairs words glued at wraps, categories, identity-document kind, ownership prefixes | Python |
| `pipeline/load_supabase.py`, `fingerprint.py` | Loads the catalogue; sha256 of each PDF + Merkle root of its records | Management API SQL |
| `pipeline/import_new_list.py` + `.github/workflows/import-official-list.yml` | Sentinel: daily import of a new list, anchoring, alert scan | GitHub Actions |
| `supabase/migrations/` | Schema, search (`search_items`: full-text + trigram + prefix + date window), alert matching (`match_alerts_for_item`), RLS | Postgres |
| `supabase/functions/api/` | The API: citizen tools, intake, return engine, outbox, verify, operator views | Deno edge function |
| `contracts/` | `CustodyLog.sol`, tests, Fuji deploy, ERC-8004 registration | Solidity, Hardhat |
| `lovable/PROMPTS.md` | Front end (citizen app + operator console) built in Lovable against the API | React (Lovable) |

## Request flows

**Citizen (voice or app)** → `/tools/search` (prefix or Italian catalogue terms + date window) → `/tools/verify`
(prefix vs published record) → `/tools/fees` → `/tools/pickup-pack` (links + spoken summary + delega PDF) or
`/tools/alert` (+ `/tools/other-offices` via Exa).

**Operator intake** → `/intake`:
1. Claude vision + structured output (or the rule parser) → register entry, numbers masked.
2. Insert item, upload photo (private bucket), evidence hash, `CustodyLog.logIntake`.
3. `route()`:
   - The policy (`rules.ts › requiredChannels`) says which notifications are mandatory.
   - The Claude tool loop (`get_item`, `lookup_embassy`, `research_embassy` [Exa], `find_alert_matches`,
     `draft_message`, `finish`) does the work.
   - The **policy guard** adds any mandatory message the agent skipped.
   - Each message is signed with the agent key (EIP-191 over a canonical payload hash).
   - The owners of matched alerts get a callback: an outbound call, or else an ElevenLabs voice note.
   - `CustodyLog.logRouted`.
4. Returns: `/items/:id/return` → `CustodyLog.logReturned`, alert closed.

**Trust:** `/verify/:id` recomputes the payload hash from the stored message and recovers the signer; valid only
if both match the registered agent. `/agent-registration.json` is the ERC-8004 registration file the identity
registry points to.

## Design choices

- **LLM proposes, policy disposes.** Notifications that the law or the office's practice require are computed
  deterministically; the agent adds judgement (borderline alert matches, wording, language, consulate research).
- **No embeddings.** The catalogue vocabulary is small and Italian; the agent translates the caller's words into
  catalogue terms through tool parameters, and Postgres full-text + trigram ranks the results.
- **Ownership by published prefix.** The official list already shows the first characters of document numbers and
  IMEIs. Matching on them proves nothing new is leaked and gives a strong ownership signal.
- **Everything degrades gracefully.** Missing keys switch Claude/Exa/ElevenLabs/chain steps to rule-based or
  "pending" paths; `/admin/status` shows what is live; `/chain/flush` replays pending custody writes.
- **One edge function** with a router: one deploy, one set of secrets; sponsor keys never leave Supabase.
