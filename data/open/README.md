# Open data: Rome's found objects, decoded

The lost-and-found office of Roma Capitale (Polizia Locale, Reparto Oggetti Rinvenuti) publishes the objects it
holds as yearly PDF lists whose text cannot be copied or searched. Ritrovo decoded them glyph by glyph. These files
are the decoded lists in open, machine-readable formats.

| File | Content |
|---|---|
| `catalogue.csv`, `catalogue.json` | 15,843 records from the 2025 list and the 2026 list (to 11 Nov 2026) |
| `object_names.csv` | Translations of the 800 most common object names (91% of all objects) into English, Spanish, French, German and Chinese |
| `datasets.csv` | Fingerprint of each source PDF (sha256), Merkle root of its decoded records, and the Avalanche Fuji transaction that anchors them |

## Schema (`catalogue.csv`)
| Column | Meaning |
|---|---|
| `id` | `{list_year}-{record_number}` |
| `list_year`, `record_number` | The list and the row number ("REPERTO") in it |
| `date_acquired` | Date the office registered the object ("DATA ACQUISIZIONE"), ISO 8601 |
| `objects` | Objects in the record, as written in the list, separated by ` \| ` |
| `categories` | Ritrovo's categories (`documenti`, `carte di pagamento`, `portafogli e borse`, …), separated by `;` |
| `contains_identity_document`, `identity_document_kind` | Whether the record holds an identity document: `italian`, `foreign`, `mixed`, `none` |
| `ownership_prefixes` | The first characters of document/IMEI numbers exactly as the list shows them (already public, masked by the office) |
| `pdf_page` | Page of the source PDF |

`catalogue.json` holds the same fields, with arrays instead of separators.

## Privacy
Only what the office already publishes: document numbers stay masked exactly as in the official list
(`EL655* * * *`). Nothing from Ritrovo's own intakes, alerts or calls is included.

## Checking a record against the official list
`GET https://izrggntqsssfzazjfhht.supabase.co/functions/v1/api/items/{id}/proof` returns the record's Merkle proof
and checks it against the root anchored on Avalanche (`datasets.csv`). Rules: leaf = sha256 of
`{"date","id","objects"}` as compact JSON with sorted keys; parent = sha256(min(a,b) ‖ max(a,b)).

## Source and licence
Source: Roma Capitale, Polizia Locale, Reparto Oggetti Rinvenuti, "Rinvenimenti" lists on comune.roma.it (URLs in
`datasets.csv`). Under art. 52 of the Codice dell'Amministrazione Digitale, data that public administrations publish
without a licence are open by default. This decoded version is released under **CC BY 4.0**: please credit
"Roma Capitale (source), Ritrovo (decoding)". The translations in `object_names.csv` were made with Claude and are
not official.

## Live API
The same data, searchable in six languages: `POST /tools/search` (`query`, `prefix`, `lost_from`, `lost_to`, `lang`),
`GET /items/{id}?lang=en`, `GET /datasets`, `GET /stats` on `https://izrggntqsssfzazjfhht.supabase.co/functions/v1/api`.
