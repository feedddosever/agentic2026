# Demo script (3:00) and video plan

Judging weights: idea & impact 1/3, technical execution 1/3, demo 1/3. One flow, start to finish, no slides.

## Setup (before entering the room)
- `scripts/reset-demo.sh`. Laptop on the venue Wi-Fi, phone hotspot ready, headset with microphone for the call.
- Tabs open, left to right: official PDF (comune.roma.it), Ritrovo home, operator console (logged in, Intake tab),
  a second Ritrovo home tab for the call, Snowtrace with the CustodyLog contract.
- Prop: a black wallet with a printed fake "US passport" page showing number `ZR4827316` (fake). The operator note:
  "Portafoglio nero in pelle con passaporto americano ZR4827316 e 40 euro. Consegnato da ATAC, metro A Termini."
- Have the video (docs/VIDEO_SCRIPT_IT.md) open in a background tab as the fallback for the call.

## Script (3:00, live)
Timings measured on the live system: AI proposal ~6 s, confirm + routing + both Avalanche txs ~12 s.

| Time | Show | Say |
|---|---|---|
| 0:00 | Official PDF: select a row, paste it in the search box → symbols | "Rome logs about 600 found objects a month in a 500-page PDF. Copy the text and you get this. Nobody can search it." |
| 0:15 | Ritrovo home: stats tiles | "We decoded the font, glyph by glyph: 15,843 records, exact. Half contain an ID document: the owner can be found." |
| 0:30 | Operator console: paste the note (or dictate) → "Check and edit" | "At the counter the operator dictates a note. Claude proposes the register entry and masks the passport number." |
| 0:45 | Confirm and save → (12 s) → Routed + Logged | "The operator confirms. The return agent decides who to tell: a US passport, so it drafts a message for the US consulate, with contacts Exa found. A fixed policy checks the agent: required notices always go out. Custody goes on Avalanche." |
| 1:05 | Second tab, voice widget: "I lost my wallet with my passport this morning near Termini" → first five ZR482 → item on screen → last four 7316 → "it's yours" → pickup pack | "And the owner just calls, any hour, any language. The first characters are public, so the agent asks for the last four, which only the owner and the office know." |
| 2:05 | Operator → Outbox → consulate message → Verify link (green, agent 302, track record) → item page "Proof of publication" | "Every message is signed by Ritrovo's ERC-8004 agent on Avalanche, so scammers can't fake it. The office scores every AI decision and records every return onchain: this is the agent's public track record. And any record can be proven to be in the city's official list. Onchain: only hashes." |
| 2:40 | Home | "When the city publishes a new list, Ritrovo imports it overnight and alerts people who were looking. Ritrovo stops waiting to be searched, and starts returning. Open source, live today." |

## Likely questions
- **The first five characters are public, so how is that proof?** It isn't, and we don't treat it as proof: they
  only find the item. At intake we keep salted hashes of details that are never published (the last four
  characters, the cash amount, which the official list never shows either); the owner must say one, with 5 tries
  an hour. Records from the old PDFs have no private details, so there the office checks the ID at the counter.
- **Privacy / GDPR?** Only what the city already publishes; full numbers are masked before storage or AI; contacts
  behind RLS; the chain stores salted hashes only.
- **Is App IO real?** Drafted in the outbox. Rome already sends App IO notices; the real integration is App IO's
  message API keyed by codice fiscale, which the office reads from the document.
- **Why blockchain?** Concrete jobs, all public and checkable: anyone can check a message really came from the
  registered agent (anti-scam); custody of cash and valuables is tamper-evident; the office publicly validates
  each AI decision and records each return (ERC-8004 validation and reputation), so the agent's track record can't
  be faked; and any record can be proven to be in the city's official list (Merkle proof against the anchored
  root), which matters because the one-year term of art. 929 c.c. runs from publication.
- **Why does the office have its own wallet?** ERC-8004 forbids an agent's owner from rating or validating its
  own agent. In production the office holds that key; Ritrovo runs the agent.
- **What if the AI is wrong?** The operator confirms every entry; the policy guard adds any required notice the
  agent skipped; messages are draft-first; alert notifications need a prefix match or several consistent details.
- **Would the office use it?** It is the challenge's brief (catalogue, pickup with delega and fees, quick intake,
  returns and ownership) built on their real lists, with the same masking and fees (DGC 421/2023).
- **Cost?** One intake is one short Claude call plus one tool turn; the phone line runs on ElevenLabs.

## Submission (before 14:00, hub.team1.network)
Register for the hackathon, create the project (stage **MVP**), choose challenge **03 Oggetti smarriti**, tick
**Exa, ElevenLabs, Lovable, team1** under "In gara per", paste the live link, the repo and the video link.
Re-submit if anything changes before 14:00.

## Fallbacks
- No network: recorded video segment for the voice call.
- Voice widget fails: same flow in the app's search box (identical tools).
- Chain not ready: custody shows "pending onchain"; Verify still works (signatures don't need gas).

## Video (3:00, required)
Produced: Italian narration, real call, see docs/VIDEO_SCRIPT_IT.md. Upload unlisted to YouTube; link in the form.
