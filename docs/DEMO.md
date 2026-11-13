# Demo script (3:00) and video plan

Judging weights: idea & impact 1/3, technical execution 1/3, demo 1/3. One flow, start to finish, no slides.

## Setup (before entering the room)
- `scripts/reset-demo.sh`, then file **one alert** from the citizen app: "black leather wallet with my US passport",
  lost today at Metro A Termini, prefix `EL655`, your own email.
- Tabs open: official PDF (comune.roma.it), Ritrovo home, operator console (logged in), voice widget ready,
  Snowtrace with the CustodyLog contract.
- Phone on hotspot as Wi-Fi fallback. Physical prop: a black wallet with a printed fake "US passport" page
  showing number `EL6559123` (fake).

## Script
| Time | Show | Say |
|---|---|---|
| 0:00 | Official PDF; select text, paste it in a text box → gibberish | "Rome finds about 600 objects a month. This is how it tells you: a 500-page PDF that can't even be searched." |
| 0:20 | Ritrovo home: stats tiles | "We cracked the font: 102 glyph shapes, 15,843 records, exact. And 48% contain an identity document: the city could give them back." |
| 0:40 | Operator console: photo of the prop wallet + dictated note → result panel | "At the counter, the operator takes a photo. The agent writes the register entry, masks the passport number, and routes it." |
| 1:10 | Routing result: embassy draft + alert match; "Show agent trace" | "Foreign passport: the US consulate gets a draft, as the office does by hand today. And a citizen's alert matches the passport prefix: she's notified, with a voice note in her language." |
| 1:40 | Voice widget, speak English: "I lost my wallet with my passport near Termini today" → prefix → fees → pickup pack | "Or she just calls, at 10 pm, in any language." |
| 2:20 | Open the notification → Verify page (green) → Snowtrace custody events | "Every message is signed by the agent's ERC-8004 identity: scammers can't fake it. Custody is logged on Avalanche: hashes only, no personal data." |
| 2:45 | Back to stats | "Ritrovo stops waiting for people to search and starts returning things. Built for the office, open source, live today." |

## Likely questions
- **Privacy?** Only what the city already publishes; full numbers are masked before storage or AI; contacts
  behind RLS; chain stores salted hashes.
- **Is App IO real?** Mocked: the notice is drafted in the outbox. The real integration is App IO's message
  API keyed by codice fiscale, which the office can derive from the document.
- **Why blockchain?** Two concrete jobs: anti-scam message verification (anyone can check a message came from
  the registered agent) and tamper-evident custody of cash and valuables.
- **What if the AI is wrong?** The policy guard guarantees mandatory notifications; outbox is draft-first; alert
  notifications need a prefix match or several consistent details.
- **Cost?** One intake ≈ one vision call + a short tool loop; the voice line runs on ElevenLabs.

## Fallbacks
- No network: recorded video segment for the voice call.
- Voice widget fails: same flow in the app's search box (identical tools).
- Chain not ready: custody shows "pending onchain"; Verify still works (signatures don't need gas).

## Video (3:00, required)
Record the same script with OBS: screen + voice-over, one take per row above, cut together. Export 1080p,
upload unlisted to YouTube; link in the submission form.
