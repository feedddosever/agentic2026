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
  - Operator token: in the repo's local `.env` (`OPERATOR_TOKEN`). It is typed into the operator login screen and
    kept in `sessionStorage`; never hard-code it.
  - The ElevenLabs agent id is read at runtime from `GET /config`; nothing to paste.

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
contains_identity_document, status}. Show the record ("Record {number} of {year}" from the id "YEAR-NUMBER";
for ids starting with "IN-" show the id as is), found date, the list of objects (masked numbers like
"Nr: CA718* * * *" are shown as they are), and an "Is it yours?" box: input "First characters of your document
number or IMEI" → POST {API_BASE}/tools/verify with {"item_id": id, "prefix": value} → {match: boolean, note}.
On match show a green confirmation and a big button "Get my pickup pack" → /pickup/:id. On no match, say it does
not match this record and suggest searching again. If the item has no numbers at all, skip the check and show the
pickup button directly with the note "Bring anything that proves it's yours".

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
→ {alert_id, message, possible_matches_now: [items like the search results]}. Show the message and the alert id
in a success card; if possible_matches_now is not empty, show them below as "It may already be here" with links
to /item/:id.

Voice assistant: on every page show the ElevenLabs Conversational AI widget (bottom-right). Load
https://unpkg.com/@elevenlabs/convai-widget-embed@0.22.0 (script type="text/javascript", async) once in
index.html. At startup GET {API_BASE}/config → {voice_agent_id: string|null, app_url, chain}; when
voice_agent_id is not null render <elevenlabs-convai agent-id="{voice_agent_id}"></elevenlabs-convai>,
otherwise render nothing.
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
    Response: { item: {id, objects[], colour, brand, nationality, id_doc, categories[], description_en},
                understanding: { mode: "llm"|"rules", model: string|null, error: string|null },
                routing: { decision: "app_io"|"embassy"|"alert_match"|"hold", reason: string, mode: "llm"|"rules",
                           outbox_ids: string[], drafted: [{channel, outbox_id, country_code?, alert_id?}],
                           policy_guard_added: string[], custody: {event, tx_hash, explorer_url} | null },
                custody: { event: "intake", tx_hash: string|null, explorer_url: string|null } }
    Show a result panel with three steps animating in: "Understood" (the structured fields as chips, with a
    small badge "AI" when understanding.mode is "llm", else "rules"), "Routed" (decision + reason in plain
    language, one chip per drafted message; if policy_guard_added is not empty add a note "policy guard added:
    …"), "Logged" (custody tx with explorer link; "pending onchain" when tx_hash is null). Add a link
    "Show agent trace" that opens a drawer with GET {API_BASE}/items/{id}/trace (operator header) →
    [{kind: "intake"|"route"|"match", mode, model, steps: [{tool, input, output, ms}], result, error, created_at}]
    rendered as a vertical timeline of tool calls (tool name, short JSON of input/output, duration).
    This can take ~10–30 s: show progress text while waiting.
```

## Prompt 6: operator console – queue, outbox, returns

```
Add tabs 2–5 to "/operator" in Ritrovo (same auth header as tab 1).

Tab 2 "Queue": GET {API_BASE}/queue returns
  [{ id, created_at, date_acquired, objects[], id_doc, nationality, status: "in_custody"|"routed"|"returned",
     decision, reason, photo_path }]
Table with filters by status; row click opens a side sheet with the custody timeline from
GET {API_BASE}/items/{id}/custody → [{event, created_at, tx_hash, explorer_url, status}], and a button
"Mark as returned" → POST {API_BASE}/items/{id}/return with {verified_with: "prefix"|"id_document"|"description"}
→ {status, custody:{tx_hash, explorer_url}}.

Tab 3 "Outbox": GET {API_BASE}/outbox returns
  [{ id, created_at, item_id, channel: "app_io"|"embassy"|"email"|"sms"|"call", recipient_label, language,
     subject, body, status: "draft"|"demo_sent", verify_url }]
Group by channel. Embassy messages grouped by recipient_label as "today's batch for {recipient}". Show each
message as a card with subject/body, the recipient, a "Verify" link (verify_url) and a big notice at the top:
"Demo mode: nothing is sent to real embassies or citizens." If a body contains an "Audio: <url>" line, render an
audio player for that URL.

Tab 4 "Alerts": GET {API_BASE}/alerts returns
  [{ id, created_at, what, lost_on, lost_where, language, status, matched_item_id, contact: "+39 3** *** **12" }]
(contacts arrive already masked). Show as a list with status badges.

Tab 5 "System": GET {API_BASE}/admin/status returns
  { integrations: { claude: {enabled, model}, exa: {enabled}, elevenlabs: {enabled, agent_id, phone_line},
                    chain: {chain, chain_id, custody_contract, custody_contract_url, agent_address,
                            erc8004_agent_id, agent_registry, agent_balance_wei} },
    counts: { items, outbox, alerts, custody_pending } }
Show one status row per integration with a green/grey dot, the counts as tiles, and links to the contract and
agent address on the explorer. Below, GET {API_BASE}/embassies → [{country_code, country, mission_name, email,
phone, address, hours, source_url, refreshed_at}] as a compact table ("Consulate directory, built with Exa").
Buttons: "Retry pending onchain logs" → POST {API_BASE}/chain/flush; "Refresh call stats" → POST
{API_BASE}/admin/sync-calls.
```

## Prompt 7: verify page and about page

```
Fill "/verify/:messageId" and "/about" in Ritrovo.

/verify/:messageId: GET {API_BASE}/verify/{messageId} returns
  { valid: boolean, reason: string, message: {channel, recipient_label, subject, created_at, item_id} | undefined,
    agent: {name, chain, chain_id, agent_address, erc8004_agent_id, agent_registry, identity_registry,
            custody_contract, custody_contract_url, explorer_url},
    signature: string|null, recovered_signer: string|null, payload_hash: string|null }
Explain in plain words: "This message was sent by Ritrovo's registered agent" (green shield) or "We could not
verify this message – do not pay anything or share documents" (red). Show the agent identity (ERC-8004 agent
id, chain) with a link to the explorer. Add an input to paste a message id manually.

/about: what Ritrovo is, the numbers from /stats, how the official PDF lists are decoded (the PDFs use fonts
with no text map, so search and copy-paste don't work; Ritrovo identifies each of the 102 glyph shapes and
rebuilds all 15,843 records), the data sources with links (comune.roma.it service page), privacy (no personal
data published; numbers stay masked like the official list; onchain records are hashes only), and the
open-data fingerprints from GET {API_BASE}/datasets → [{source_url, pdf_sha256, records, merkle_root,
tx_hash, explorer_url}] with "anchored on Avalanche" links.
```

## Prompt 8: polish

```
Polish Ritrovo: check every page at 375px width (no horizontal scroll, 16px side padding), keyboard focus
styles, colour contrast in light and dark mode, loading and error states for every API call, and Italian
translations for every visible string. Add a favicon (key icon) and page titles per route
("Ritrovo – Find my item", etc.).
```

## Prompt 9: voice fills the screen (citizen side)

```
In Ritrovo, make the voice assistant drive the screen while the person talks. The ElevenLabs agent calls
"client tools" that run in the browser; register them on the widget.

1. Create src/lib/voiceTools.ts with a function registerVoiceTools(widget: HTMLElement, navigate) that adds:
   widget.addEventListener("elevenlabs-convai:call", (event: any) => {
     event.detail.config.clientTools = {
       show_search_results: ({ query, prefix, lost_from, lost_to, category }) => navigate("/?" + params),
       show_item: ({ item_id }) => navigate(`/item/${item_id}`),
       show_pickup_pack: ({ item_id, owner_name, delegate_name }) => navigate(`/pickup/${item_id}?owner=..&delegate=..`),
       fill_alert_form: ({ what, category, lost_on, lost_where, prefix, language, phone, email, saved_alert_id }) =>
         navigate("/alert?" + params),
     };
   });
   Build the query strings with URLSearchParams and skip empty values. Each function returns nothing.
   Call registerVoiceTools from the component that renders <elevenlabs-convai> (useRef + useEffect after the element
   is in the DOM; pass react-router's navigate).

2. Make the pages read those query parameters:
   - "/": if any of q, prefix, lost_from, lost_to, category is present, switch to the right search tab, fill the
     fields (q goes into the "Describe it" text as is: it is already Italian catalogue terms) and run the search
     automatically, then scroll to the results.
   - "/pickup/:id": prefill "your name" from ?owner and "their name" from ?delegate.
   - "/alert": prefill every field from the query (what, category, lost_on, lost_where, prefix, language, phone,
     email). If saved_alert_id is present, show the success card ("Alert saved by voice", with the id) instead of
     the submit button.
   When a field is filled from the voice assistant, highlight it briefly (soft terracotta glow for 1.5 s) and show a
   small chip "Filled by voice" next to the form title.
```

## Prompt 10: dictate, review, confirm (operator intake)

```
Change Tab 1 "Intake" of "/operator" in Ritrovo to a two-step flow: the AI proposes, the operator confirms.

Step 1 – Propose: after a photo is selected, or when dictation stops (SpeechRecognition onend), or 1.5 s after the
operator stops typing the note, call POST {API_BASE}/intake/preview (operator header) with
{photo_base64, note, found_where, finder_channel}. Nothing is saved. Response:
  { fields: { objects: string[], colour, brand, nationality, found_where, finder_channel, cash_eur, description_en },
    derived: { id_doc: "none"|"italian"|"foreign"|"mixed", prefixes: string[], categories: string[] },
    mode: "llm"|"rules", model: string|null, error: string|null }
Show an editable form filled with these values: objects as an editable list (one line each, add/remove buttons),
colour, brand, nationality (2-letter country code), found where, handed in by, cash in euro (-1 = none, show as
empty), English description. Above it, badges from "derived" (document type, ownership prefixes, categories) and
"Proposed by AI (model)" or "Proposed by rules". Re-run the preview if the operator records a new note or photo,
but never overwrite fields the operator has edited by hand.

Step 2 – Confirm: button "Confirm and save" → POST {API_BASE}/intake with
{photo_base64, note, found_where, finder_channel, fields: <the edited form values>}. The response is the same as
before (item, understanding, routing, custody); understanding.mode is now "operator": show the badge
"Confirmed by operator". Keep the existing three-step result panel and the agent trace drawer.
```

## Prompt 11: fixes found in browser testing

```
Three small fixes in Ritrovo:
1. Home search: pressing Enter in either search tab must run the search (wrap each tab's fields in a <form> with
   onSubmit that calls the same handler as the Search button).
2. Agent trace drawer: the run "mode" can be "llm", "rules" or "operator". Show "AI · {model}" for llm,
   "Confirmed by operator" for operator, and "rules" only for rules (right now operator runs show "rules").
3. Operator intake: after "Confirm and save" succeeds, clear the Note textarea and the photo (the raw note may
   contain full document numbers; the saved record is already masked). Keep the result panel visible.
```

## Prompt 12: real ownership check on the item page

```
On the item page, the "Is it yours?" card calls POST {API}/tools/verify. Its response now also has
"ownership" ("not_checked" | "verified" | "failed" | "locked" | "not_available"), "last4_check_available" (boolean)
and "note" (one sentence, show it under the result). Update the card:
1. First step stays the same: "First characters of the number on your document or phone" + Check, sending
   { item_id, prefix }.
2. If the response has match = true and last4_check_available = true, show a second field "Last 4 characters of
   the same number" (maxLength 4, uppercase, letters and digits) with a Confirm button that sends
   { item_id, prefix, last4 }. Explain in small text: "The first characters are public in the official list; the
   last four are not, so they prove it's yours."
3. Result states: verified → green box "It's yours. Bring an ID and quote {item id}" with a button to the pickup
   pack; failed → amber "That doesn't match. Check the number, or ask at the office."; locked → grey "Too many
   attempts. Ownership can now only be checked at the office."; not_available with match → neutral "The first
   characters match. The office checks the full number against your ID at the counter."; match = false → as now.
Never store or log the characters the user types.
```

## Prompt 13: Avalanche trust on screen (track record and proof of publication)

```
Two new public cards. Both read the API (no auth).

1. Verify page, inside the "Signing agent" card, add a section "Track record on Avalanche" from
   GET {API}/agent/track-record. It returns { agent_id, office_address, office_url,
   returns: { count, registry_url }, policy_validation: { count, avg_score, registry_url },
   recent: [{ kind, item_id, score, explorer_url, created_at }] }. Show two big numbers side by side:
   - "{returns.count} returns recorded by the office" with a small link "ERC-8004 Reputation" → returns.registry_url
   - "{policy_validation.avg_score}/100 policy compliance over {policy_validation.count} decisions" with a small
     link "ERC-8004 Validation" → policy_validation.registry_url
   Under them, one line of small text: "Recorded by the office wallet {short office_address} (link office_url).
   The agent can't rate itself: ERC-8004 forbids it." Then a collapsible "Recent records" list with kind
   (feedback = "Return recorded", validation_request = "Decision submitted", validation_response = "Decision
   validated"), score, time and a link to explorer_url. Label the whole section "Fuji testnet".

2. Item page, new card "Proof of publication" under the objects card, from GET {API}/items/{id}/proof.
   - If in_official_list and verified: green shield, title "In the city's official list", text "This record is in
     the official list whose fingerprint Ritrovo anchored on Avalanche on {anchor.anchored_at as date}. The
     one-year term of art. 929 c.c. runs from publication." Link "View on Avalanche" → anchor.explorer_url.
     Collapsible "Technical details": leaf, number of proof steps (proof.length), computed_root, list.records,
     list.source_url, and how_to_verify as small monospace text.
   - If in_official_list is false: neutral card "Registered at the counter through Ritrovo. Its custody is logged
     on Avalanche." with the existing custody timeline link.
   - If verified is false but in_official_list is true: amber "Proof could not be checked right now".
Load both cards lazily (they call the chain) with a small skeleton; never block the rest of the page.
```

## Prompt 14: "Is it yours?" asks only what isn't public

```
On the item page, the "Is it yours?" card must no longer ask for the first characters of the number: they are
printed on the same page (and in the official list), so typing them proves nothing. Replace the card's logic:
1. When the item page loads, call POST {API}/tools/verify with { item_id } only. The response has
   "questions" (an array: [] or ["last4"] or ["cash"]), "ownership" and "note".
2. If questions is ["last4"]: one field "Last 4 characters of the document number or IMEI" (maxLength 4,
   uppercase letters and digits) and a "Check" button → POST { item_id, last4 }.
   If questions is ["cash"]: one field "How much cash was inside? (€)" (numeric) and "Check" → POST { item_id, cash }.
   Under the field, small text: "The first characters are public in the official list. This detail was recorded at
   the counter and is never shown, so only the owner knows it."
3. If questions is []: no field. Show a neutral note: "This record comes from the official list. The office
   checks ownership at the counter: bring an ID, and for documents they compare the full number." plus the
   "Get my pickup pack" button.
4. Result states stay as in prompt 12 (verified → green "It's yours. Bring an ID and quote {item id}" with the pickup
   pack button; failed → amber; locked → grey). Show the response "note" under the result.
Keep the prefix search on the home page as it is: there the first characters are used to FIND the item.
Never store or log what the user types.
```

## Prompt 15: more languages, and the call opens in the page's language

```
1. Replace the EN/IT toggle with a compact language dropdown: English, Italiano, Español, Français, Deutsch, 中文.
   Translate all interface text into the new languages (keep the official object names in Italian, exactly as in
   the city's register: they are data; category labels and everything else are translated). Remember the choice
   in localStorage; on first visit, use the browser language if it is one of these, else English.
2. Pass the current language to the voice widget: set the attribute override-language="{code}" on
   <elevenlabs-convai> (codes: en, it, es, fr, de, zh) and re-mount the widget when the language changes (use the
   language as the React key), so the next call starts in that language. Keep the client tools registration as is.
3. Under the home hero, change the voice line to: "Prefer to talk? Ask our assistant in 20 languages — it switches
   to yours automatically." (translated in each language).
4. About page: add a short "Languages" line: the voice assistant speaks English, Italian, Spanish, French, German,
   Portuguese, Chinese, Japanese, Korean, Russian, Ukrainian, Polish, Romanian, Arabic, Dutch, Hindi, Turkish,
   Filipino, Greek and Swedish, and switches automatically when the caller does.
```

## Prompt 16: translated object names, passport help, talk or call

```
Four improvements for tourists. Always send the current UI language code (en, it, es, fr, de, zh):
POST {API}/tools/search gets "lang" in the body; GET {API}/items/{id}?lang=..; GET {API}/pickup/{id}?lang=..

1. Translated object names. Search results and items now include "objects_translated" (same order as "objects",
   null where no translation exists) and "summary_translated". When the UI language is not Italian, show the
   translation as the main text and the official Italian name underneath in small grey text ("Official name:
   PORTAFOGLI"). Where the translation is null, show the Italian name only. In Italian, show only the Italian names.
2. Search feedback. If the search response has "also_searched_for" (e.g. ["portafogli"]), show a small line above the
   results: "Also searched the register for: portafogli". Tourists type in their language; the register is Italian.
3. Passport help. If a response (search, item or pickup) contains "passport_help" ({ title, text, consulates_url,
   consulate? }), show a card with the title, the text, and:
   - if passport_help.consulate is present: its mission_name, address (map link), phone (tel: link), email (mailto:);
   - otherwise a "Find your embassy or consulate" select filled from GET {API}/consulates (consulates[]: country,
     mission_name, address, phone, email) that shows the chosen one's details the same way.
4. Talk or call. On the home page and every item page, show two options side by side:
   - "Talk to Ritrovo": opens the voice assistant in the browser (the existing widget) with a line "Like any voice
     assistant, in 20 languages. No phone number needed."
   - "Prefer a person? Call the office": the phone numbers from GET {API}/config → office.phone as tel: links, and
     office.hours (Italian hours when the UI is Italian; .en otherwise).
5. About page: add one honest line: "App IO is not integrated yet: for Italian documents Ritrovo drafts the App IO
   notice for the office to send."
```
