# Submission form (deadline Sat 14 Nov 2026, 14:00)

- **Nome del progetto:** Ritrovo
- **Nome del team lead:** _(you)_
- **Email del team lead:** _(the one used on Lu.ma)_
- **Altri membri del team:** none (solo)
- **Sfida scelta:** 03 – Oggetti smarriti
- **Descrizione in una riga:** Ritrovo decodes Rome's unsearchable lost-and-found lists and returns items to
  their owners: a multilingual voice line, smart intake, consulate routing and verifiable custody.
- **Cosa fa il vostro progetto?** Rome publishes ~600 found objects a month in PDFs whose fonts make them
  unsearchable; we rebuilt all 15,843 records exactly. On top, an agentic return engine routes identity documents
  to their holders or consulates, matches citizens' alerts and answers callers 24/7 in their language, with every
  message signed by an ERC-8004 agent and custody logged on Avalanche.
- **Link al progetto online:** _(Lovable app URL)_
- **URL della repository:** https://github.com/feedddosever/agentic2026 _(make public)_
- **Link al video:** _(YouTube unlisted)_
- **Tecnologie chiave e tool agentici utilizzati:** Claude (vision, structured outputs, tool-use agent with
  policy guard), ElevenLabs Agents (webhook tools, multilingual, callbacks, TTS voice notes), Exa (deep-lite
  search with structured output for consulates and other offices), Avalanche (CustodyLog contract, ERC-8004
  identity, EIP-191 signatures), Lovable (front end), Supabase (Postgres + Edge Functions), GitHub Actions
  (daily list import), PyMuPDF (font-level PDF decoding).
- **Deploy su Avalanche:** _(CustodyLog address on Fuji/C-Chain + ERC-8004 agentId, from contracts/deployments/)_
