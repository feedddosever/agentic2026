# Ritrovo: Lovable build prompts

Paste these into Lovable **one at a time, in order**, and check each screen before the next.
Each prompt is self-contained so Lovable doesn't need to remember earlier turns.
Keep credits for fixes: if a prompt's result is mostly right, fix with a short follow-up rather than re-running it.

**Before you start**
- Create a new Lovable project named `ritrovo`. **Do not enable Lovable Cloud / Supabase in Lovable**: the
  backend already exists; the app only calls the API below with `fetch`.
- Connect GitHub (Lovable → GitHub → Connect) so the code lands in a public repo for the submission.
- Facts used below:
  - `API_BASE = https://izrggntqsssfzazjfhht.supabase.co/functions/v1/api`
  - Operator token: in the repo's local `.env` (`OPERATOR_TOKEN`), ask Claude for it in the session if needed.
    It is typed into the operator login screen and kept in `sessionStorage`; never hard-code it.
  - ElevenLabs agent id: given after P3 (prompt 4 has a placeholder).

---

## Prompt 1: foundation and design system

```
Build "Ritrovo", a web app that helps people in Rome get back objects they lost. It is a prototype built at a
hackathon for Rome's lost-and-found office; it is NOT an official Roma Capitale website: never use the city's
logo or coat of arms, and show a small footer line "Prototype – not an official Roma Capitale service.
Data: public lists of the Reparto Oggetti Rinvenuti."

Stack: React + TypeScript + Tailwind + shadcn/ui, react-router. No database, no auth provider, no Lovable Cloud.
All data comes from a REST API. Create src/lib/api.ts with:
  export const API_BASE = "https://izrggntqsssfzazjfhht.supabase.co/functions/v1/api";
  async function get<T>(path: string): Promise<T>  and  async function post<T>(path: string, body: unknown): Promise<T>
  (JSON in/out, throw an Error with the response's `error` field on non-2xx; post() adds header
  "x-operator-token" from sessionStorage key "ritrovo_operator_token" when present).

Design: calm, trustworthy civic service, mobile-first (most users are tourists on a phone).
- Colours as CSS variables with light and dark themes: warm off-white background (#FBF8F3), ink text (#1F2328),
  primary terracotta (#B5502F), secondary deep teal (#1F5E63), success green, warning amber. Dark theme equivalents.
- Typography: "Fraunces" for headings (Google Fonts), "Inter" for body. Generous spacing, 16px base, rounded-xl cards.
- Header: wordmark "Ritrovo" (Fraunces, with a small key icon from lucide-react), nav: "Find my item", "Get alerted",
  "Verify a message", and on the right a language switcher (EN / IT) and a discreet "Operator" link.
- Footer as described above.

Routes (create empty placeholder pages now, later prompts fill them):
  /                   Home + search
  /item/:id           Item page
  /pickup/:id         Pickup pack
  /alert              Get alerted
  /verify/:messageId  Verify a message from Ritrovo
  /operator           Operator console (login, intake, queue)
  /about              About the data

i18n: a tiny dictionary-based t() helper with "en" and "it", default from the browser language, switcher in the
header, persisted in localStorage (wrap localStorage access in try/catch).
```

## Prompt 2: home and search

```
Fill the "/" page of Ritrovo.

Hero: headline "Lost something in Rome?" (IT: "Hai perso qualcosa a Roma?"), sub-line
"Rome's lost-and-found office logs about 600 objects a month. Search them here, in your language."
Below it, live numbers from GET {API_BASE}/stats which returns
  {items, with_identity_doc, with_foreign_doc, with_ownership_prefix, first_date, last_date}
shown as three stat tiles: "objects in custody" (items), "contain an identity document" (with_identity_doc),
"belong to visitors from abroad" (with_foreign_doc), plus "updated to {last_date}".

Search card with two modes (tabs):
1. "I know a document or phone number" – one input "First characters of the document number or IMEI"
   (hint: "e.g. the first 5 characters of your passport number. We never show full numbers.").
   Calls POST {API_BASE}/tools/search with {"prefix": value}.
2. "Describe it" – inputs: what (text, placeholder "black wallet with a US passport"), date lost (date picker,
   optional, sends lost_from and lost_to as YYYY-MM-DD), category select (optional) with values
   documenti, carte di pagamento, portafogli e borse, telefoni ed elettronica, chiavi, denaro, abbigliamento,
   occhiali, gioielli, altro (show translated labels, send these Italian values).
   The catalogue is written in Italian: before calling the API, map common English words to Italian catalogue
   terms with a small dictionary in src/lib/terms.ts (wallet→portafogli, bag→borsa, backpack→zaino,
   phone→telefono cellulare, passport→passaporto, identity card→carta identita, driving licence→patente,
   keys→chiavi, glasses→occhiale, credit card→carta di credito, debit card→bancomat, suitcase→trolley valigia,
   laptop→pc portatile, headphones→auricolare, jacket→indumenti, umbrella→ombrello, money/cash→denaro,
   foreign→estero estera, US/American/British/French/German/Spanish/Chinese etc.→estero). Keep unknown words.
   Send {"query": mappedText, "lost_from", "lost_to", "category"} to POST {API_BASE}/tools/search.

The API returns:
  { total_matches: number, window: {found_from, found_to} | null,
    results: [{ id, found_date, summary, objects: string[], categories: string[],
                contains_identity_document: boolean, prefix_match?: boolean, status }],
    guidance: string }
Show "N possible matches" and result cards: found date, summary (objects joined; keep Italian text but show a
small translated category badge), a green "Number matches" badge when prefix_match is true, and a button
"This could be mine" → /item/:id. Empty state: "Nothing yet. New lists arrive every week" with a button
"Get alerted when it turns up" → /alert (pass the search text in the query string to prefill).
Loading skeletons, error toast on failure.
```

## Prompt 3: item page and pickup pack

```
Fill "/item/:id" and "/pickup/:id" in Ritrovo.

/item/:id: GET {API_BASE}/items/{id} returns {id, found_date, summary, objects[], categories[],
contains_identity_document, status}. Show the record ("Record {number} of {year}" from the id "YEAR-NUMBER"),
found date, the list of objects (masked numbers like "Nr: CA718* * * *" are shown as they are), and an
"Is it yours?" box: input "First characters of your document number or IMEI" → POST {API_BASE}/tools/verify
with {"item_id": id, "prefix": value} → {match: boolean, note}. On match show a green confirmation and a big
button "Get my pickup pack" → /pickup/:id. On no match, say it does not match this record and suggest searching
again. If the item has no numbers at all, skip the check and show the pickup button directly with the note
"Bring anything that proves it's yours".

/pickup/:id: GET {API_BASE}/pickup/{id}?lang={en|it} returns
  { item: {...as above}, fees_today: {currency, lines:[{label, amount}], total, notes:[], days_in_custody},
    claim_horizon: {date, note}, office: {name, address, map_url, phone:[], email, hours, service_url},
    documents_to_bring: string[], page_url, delega_pdf_url }
Layout as a printable checklist:
  1. Where and when: office name, address with "Open in Maps" (map_url), hours, phone numbers (tel: links).
  2. What to bring: documents_to_bring as a checklist.
  3. Fees: table of lines and total in EUR (or "Free – identity documents are returned at no cost" when total is 0),
     plus notes.
  4. Someone collecting for you? Two inputs (your name, their name) and a button "Download pre-filled delega
     (PDF)" that opens delega_pdf_url with ?owner=...&delegate=... (URL-encode; the base URL has no query string).
  5. Deadline note from claim_horizon (small, muted).
Buttons: "Print" (window.print with a clean print stylesheet) and "Share" (navigator.share with the page URL).
```

## Prompt 4: get alerted + voice assistant

```
Fill "/alert" in Ritrovo and add the voice assistant.

/alert form: what did you lose (required, prefilled from ?q=), category (same values as search), date lost,
where (free text, e.g. "Metro A, Termini"), first characters of the document number or IMEI (optional),
language (en/it/es/fr/de/zh/ja...), and how to reach you: phone and/or email (at least one required).
Consent checkbox: "Ritrovo may contact me about this item. My contact details are never published."
Submit → POST {API_BASE}/tools/alert with
  {what, category, lost_on, lost_where, prefix, language, phone, email}
→ {alert_id, message}. Show the message and the alert id in a success card.

Voice assistant: on every page show a floating button "Talk to Ritrovo" (bottom-right). Use the ElevenLabs
Conversational AI web widget: load https://unpkg.com/@elevenlabs/convai-widget-embed@0.22.0 (script type="text/javascript",
async) once in index.html and render <elevenlabs-convai agent-id="AGENT_ID_PLACEHOLDER"></elevenlabs-convai>.
Put the agent id in src/lib/config.ts as VOICE_AGENT_ID so it is easy to change. If the id is still
"AGENT_ID_PLACEHOLDER", hide the widget.
On the home page add a short line under the hero: "Prefer to talk? Ask our assistant in any language."
```

## Prompt 5: operator console – login and intake

```
Fill "/operator" in Ritrovo: a console for the staff of the lost-and-found office. Desktop-first but usable on a
tablet at the counter.

Login: a single field "Operator token" stored in sessionStorage "ritrovo_operator_token" (no other auth).
A "Log out" button clears it. All operator calls send header x-operator-token (api.ts already does it for post;
add the same for a new getOp<T>(path) helper).

Tab 1 "Intake": register a newly handed-in object.
  - Photo: camera capture on mobile (<input type="file" accept="image/*" capture="environment">) or upload;
    preview; resize client-side to max 1280px JPEG and send as base64 (no data: prefix).
  - "Dictate a note" button using the browser SpeechRecognition API (it-IT) if available, else a textarea.
    Example placeholder: "Portafoglio nero con passaporto americano, consegnato da ATAC a Termini".
  - Optional fields: found where, handed in by (select: cittadino, ATAC, Trenitalia, taxi, Polizia, altro).
  - Submit → POST {API_BASE}/intake with {photo_base64, note, found_where, finder_channel}.
    Response: { item: {id, objects[], colour, brand, nationality, id_doc, categories[]},
                routing: { decision: "app_io"|"embassy"|"alert_match"|"hold", reason: string,
                           outbox_ids: string[], alert_matches: [{alert_id, score}] },
                custody: { event: "intake", tx_hash, explorer_url } }
    Show a result panel with three steps animating in: "Understood" (the structured fields as chips),
    "Routed" (decision + reason in plain language), "Logged" (custody tx with explorer link; show "pending" if
    tx_hash is null). This can take ~10–20 s: show progress text while waiting.
```

## Prompt 6: operator console – queue, outbox, returns

```
Add tabs 2–4 to "/operator" in Ritrovo (same auth header as tab 1).

Tab 2 "Queue": GET {API_BASE}/queue returns
  [{ id, created_at, objects[], id_doc, status: "in_custody"|"routed"|"returned", decision, reason }]
Table with filters by status; row click opens a side sheet with the custody timeline from
GET {API_BASE}/items/{id}/custody → [{event, created_at, tx_hash, explorer_url}], and a button
"Mark as returned" → POST {API_BASE}/items/{id}/return with {verified_with: "prefix"|"id_document"|"description"}
→ {status, custody:{tx_hash, explorer_url}}.

Tab 3 "Outbox": GET {API_BASE}/outbox returns
  [{ id, created_at, item_id, channel: "app_io"|"embassy"|"email"|"sms"|"call", recipient_label, language,
     subject, body, status: "draft"|"demo_sent", verify_url }]
Group by channel. Embassy messages grouped by recipient_label as "today's batch for {recipient}". Show each
message as a card with subject/body, the recipient, a "Verify" link (verify_url) and a big notice at the top:
"Demo mode: nothing is sent to real embassies or citizens."

Tab 4 "Alerts": GET {API_BASE}/alerts returns
  [{ id, created_at, what, lost_on, lost_where, language, status, matched_item_id, contact: "+39 3** *** **12" }]
(contacts arrive already masked). Show as a list with status badges.
```

## Prompt 7: verify page and about page

```
Fill "/verify/:messageId" and "/about" in Ritrovo.

/verify/:messageId: GET {API_BASE}/verify/{messageId} returns
  { valid: boolean, message: {channel, recipient_label, subject, created_at, item_id},
    agent: {name, erc8004_agent_id, address, registry, chain, explorer_url},
    signature: string, recovered_signer: string }
Explain in plain words: "This message was sent by Ritrovo's registered agent" (green shield) or "We could not
verify this message – do not pay anything or share documents" (red). Show the agent identity with a link to
the explorer and the agent id. Add an input to paste a message id manually.

/about: what Ritrovo is, the numbers from /stats, how the official PDF lists are decoded (the PDFs use fonts
with no text map, so search and copy-paste don't work; Ritrovo identifies each of the 102 glyph shapes and
rebuilds all 15,843 records), the data sources with links (comune.roma.it service page), privacy (no personal
data published; numbers stay masked like the official list; onchain records are hashes only), and the
open-data fingerprints from GET {API_BASE}/datasets → [{source_url, pdf_sha256, records, merkle_root,
tx_hash, explorer_url}].
```

## Prompt 8: polish

```
Polish Ritrovo: check every page at 375px width (no horizontal scroll, 16px side padding), keyboard focus
styles, colour contrast in light and dark mode, loading and error states for every API call, and Italian
translations for every visible string. Add a favicon (key icon) and page titles per route
("Ritrovo – Find my item", etc.).
```
