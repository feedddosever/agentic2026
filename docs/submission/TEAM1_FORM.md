# team1 project page: text to paste

## Short description (272 / 280)

Rome publishes its found objects as PDFs no one can search. Ritrovo decoded all 15,843 records and returns items to their owners: search in 6 languages, a voice assistant in 20, AI intake for the office, and ownership, custody and agent reputation verifiable on Avalanche.

## Description (Markdown)

```markdown
## The problem
Rome's lost-and-found office (Polizia Locale, Reparto Oggetti Rinvenuti) logs about 600 found objects a month and publishes them as yearly PDF lists of 500+ pages whose text can't be copied or searched. To know if your passport was handed in, you scroll the PDF or call on a weekday morning. Yet **48% of the records contain an identity document: the owner can be found.**

## How it works
- **Decoded:** the PDFs use fonts with no text map. We identified all 102 glyph shapes and rebuilt **15,843 records** exactly, now published as open data.
- **Find:** search in Italian, English, Spanish, French, German or Chinese, with object names translated, or talk to the **voice assistant in 20 languages**, which drives the website during the call.
- **Prove it's yours:** the first characters of a document number are public, so they only find the item. Ownership is proved with a detail that is **never published** (the last four characters, or the cash amount).
- **Return:** at the counter the operator takes a photo and dictates a note. Claude proposes the register entry with numbers masked, and a **return agent checked by fixed rules** drafts the message for the right consulate (contacts found with Exa) and alerts citizens who were looking. Tourists who lost a passport learn how to get an emergency travel document.
- Prototype in demo mode: nothing is sent to real consulates or citizens, and App IO is not integrated yet.

## Built on Avalanche (Fuji)
- **Signed messages:** every message is signed by Ritrovo's **ERC-8004 agent #302**. Anyone can verify it; scammers can't fake it.
- **Custody log:** the `CustodyLog` contract records intake → routed → returned for every item, as salted hashes only.
- **Public track record:** a separate office wallet records every return in the **ERC-8004 Reputation Registry** and scores every AI decision in the **Validation Registry**. The agent can't rate itself.
- **Proof of publication:** both official lists are anchored (PDF sha256 + Merkle root), and any record's Merkle proof is checked against the onchain event.
- No personal data onchain.

[Live app](https://screenshot-to-spark-3870.lovable.app) · [Code (EUPL-1.2)](https://github.com/feedddosever/agentic2026) · [Live track record](https://izrggntqsssfzazjfhht.supabase.co/functions/v1/api/agent/track-record) · CustodyLog `0xa5aAb3b1743922ED1eabaB6C2647787B92807B48`
```

## Categories
**Consumer**, plus **Other (Specify): Civic tech / public sector**.

## Technologies (pick from the list)
Solidity · TypeScript · React · Node.js · Python · PostgreSQL · Hardhat · viem

## How it's made (Markdown)

```markdown
## Stack
- **Front end:** React app built with **Lovable**: the citizen site and the operator console, in 6 languages.
- **Back end:** **Supabase** (PostgreSQL in the EU with row-level security) and one Deno/**TypeScript** Edge Function as the API: voice-agent tools, intake, return engine, verification.
- **Data:** **Python** + PyMuPDF decoder; a daily GitHub Action imports each new official list.
- **AI:** **Claude** (vision + structured outputs for intake, a tool-use return agent, translations); **ElevenLabs Agents** (7 webhook tools, 4 client tools, automatic language detection, Scribe speech-to-text, TTS voice notes); **Exa** (deep search with structured output for consulate contacts and other lost-and-found offices).
- **Chain:** **Solidity** `CustodyLog` (**Hardhat**, 9 tests, verified source), **viem** with a nonce manager, and the ERC-8004 Identity, Reputation and Validation registries on **Avalanche Fuji**.

## Hacky or innovative parts
- **Reading unreadable PDFs:** the fonts are Type 3 with no Unicode map. Each glyph is identified by the sha1 of its drawing (102 hand-labelled shapes), so there are no OCR errors.
- **"The LLM proposes, the policy decides":** the agent drafts; a deterministic guard adds any legally required notice it skipped; the office scores each decision onchain (ERC-8004 validation).
- **Fast enough to demo live:** context prefetch and an early stop cut routing from 31 s to about 11 s; onchain trust records are written after the response.
- **Private ownership questions:** salted hashes of the last four characters or the cash amount, rate-limited. The amount is never published, just like in the official list.
- **Voice drives the screen:** client tools open results, the item and the pickup pack while the agent talks, and the agent switches language mid-call.
- **Multilingual search on an Italian register:** the 800 most common object names were translated once with Claude, so "wallet", "Reisepass" or "钱包" find "PORTAFOGLI".
- **Proof of publication:** Merkle proofs for all 15,843 records, checked against the anchoring event read back from Avalanche.
```

## Images
- Cover (16:9): `docs/submission/0-cover.png`
- Screenshots (16:9), in this order: `1-home.png`, `2-search-in-english.png`, `3-ownership-last-four.png`, `4-operator-intake.png`, `5-verify-and-track-record.png`
- Logo: `docs/brand/logo-mark-512.png` (square), `docs/brand/logo-wordmark.png` (horizontal), SVG sources next to them.
