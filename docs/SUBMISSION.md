# Submission (deadline Sat 14 Nov 2026, 14:00) – hub.team1.network

Steps: register for the hackathon → create the project → stage **MVP** → challenge **03 – Oggetti smarriti** →
"In gara per": **Exa, ElevenLabs, Lovable, team1 (Avalanche)** → paste the fields below → submit. If anything
changes before 14:00, update the submission.

Fields in the order of the manual's checklist (team lead name and email: yours, the email used on Lu.ma).

- **Nome del progetto:** Ritrovo
- **Nome del team lead:** _(your name)_
- **Email del team lead:** _(your Lu.ma email)_
- **Altri membri del team:** nessuno (solo)
- **Sfida scelta:** 03 – Oggetti smarriti
- **Link al progetto online:** https://screenshot-to-spark-3870.lovable.app
- **URL della repository:** https://github.com/feedddosever/agentic2026
- **Link al video (3 minuti):** _(YouTube unlisted link)_
- **Deploy su Avalanche:** CustodyLog `0xa5aAb3b1743922ED1eabaB6C2647787B92807B48` (Fuji); ERC-8004 agent 302

**Cosa fa il vostro progetto? (2–3 frasi)**
Rome publishes its found objects as PDF lists that can't be searched; Ritrovo decoded all 15,843 records into a
catalogue that tourists can search in six languages and ask about by voice in 20. At the counter, Claude turns a
photo and a note into the register entry, and a return agent checked by fixed rules alerts the right consulate or
citizen; ownership is proved with details never published. Every message is signed by an ERC-8004 agent and custody,
returns and the office's validation of each AI decision are verifiable on Avalanche, with no personal data onchain.

**Descrizione in una riga**
Ritrovo decodes Rome's unsearchable lost-and-found lists and returns items to their owners: a searchable catalogue
in six languages, a voice assistant in 20 languages, AI intake for the office, consulate routing, and ownership
checks and custody that anyone can verify on Avalanche.

**Longer description (if the form has room)**
Rome's lost-and-found office publishes ~600 found objects a month in PDFs whose text can't be searched. We decoded
all 15,843 records exactly, and they're open data now. Half of them contain an identity document, so the owner can
be found: Ritrovo returns items instead of waiting to be searched.
- Citizens and tourists search in their language (the register is Italian; Ritrovo adds its terms and translates
  object names) or talk to a voice assistant in 20 languages that drives the website during the call.
- The first characters of a document number only find an item. Ownership is proved with a detail that is never
  published (the last four characters, or the cash amount), and the pickup pack comes with fees, a pre-filled
  delega, and, for passports, how to get an emergency travel document from the consulate.
- At the counter, the operator dictates a note; Claude proposes the register entry with numbers masked; the
  operator confirms. A return agent, checked by fixed rules, drafts the message for the right consulate (contacts
  found with Exa) or an App IO notice (not integrated yet) and matches citizens' alerts.
- Every message is signed by an ERC-8004 agent; custody, the office's validation of each AI decision and every
  return are recorded on Avalanche, and any record can be proven to be in the city's official list. Only hashes and
  scores go onchain. Demo mode: nothing is sent to real consulates or citizens.

**Tecnologie e tool agentici**
- **Claude:** vision intake with structured output; tool-use return agent with a policy guard; translations.
- **ElevenLabs:** voice agent with 7 webhook tools, 4 client tools that drive the site, 20 languages with automatic
  switching, Scribe speech-to-text, TTS voice notes.
- **Exa:** deep search with structured output for consulate contacts (32 countries, more on demand) and other
  lost-and-found offices.
- **Avalanche Fuji:** CustodyLog contract (verified source), ERC-8004 identity, reputation and validation registries.
- **Lovable:** front end. **Supabase:** Postgres and Edge Functions. **GitHub Actions:** daily list import.
- **PyMuPDF:** font-level PDF decoding.

**Avalanche (Fuji testnet)**
- **CustodyLog:** `0xa5aAb3b1743922ED1eabaB6C2647787B92807B48` (source verified on the explorer).
- **ERC-8004 agent:** 302 in the Identity Registry `0x8004A818BFB912233c491871b3d84c89A494BD9e`.
- **Reputation and Validation registries:** `0x8004B663…388713` and `0x8004Cb1B…EB4272`.
- **Office wallet:** `0xA5cdA457e2053320FDF10099d14049C263612890`.
- **Live track record:** https://izrggntqsssfzazjfhht.supabase.co/functions/v1/api/agent/track-record
