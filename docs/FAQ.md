# FAQ

**Is Ritrovo an official service of Roma Capitale?**
No. It is a prototype built at Agentic Hack Rome 2026 (challenge 03) on the city's public lists. It runs in demo
mode: nothing is sent to real consulates, citizens or the office; outgoing messages wait in an outbox.

**Is App IO integrated?**
No. For Italian identity documents Ritrovo drafts the notice the office could send through App IO. A real
integration needs the city's IO onboarding (Roma Capitale already uses App IO) and the holder's tax code, which is
printed on the electronic ID card and the health card but not on passports or most foreign documents.

**Is there a phone number to call?**
Not yet. The voice assistant works in the browser, like any voice assistant, in 20 languages; it switches to the
caller's language automatically. Anyone who prefers a person sees the office's numbers on the site, and the agent
gives them on request: +39 06 6769 3220 / 3268 / 3214.

**The list shows the first characters of my passport number. How is that proof?**
It isn't, and Ritrovo doesn't treat it as proof: the first characters only find the item. Ownership is checked
with a detail that is never published and is recorded at the counter: the last four characters of the number, or
exactly how much cash was inside. Ritrovo stores only salted hashes of them; wrong answers are limited to 5 an hour
per item. Records from the old PDFs have no such details, so the office checks the ID at the counter.

**Why a blockchain? Wouldn't an eIDAS qualified timestamp or electronic seal do?**
For legal value in the EU, yes: in production the office would seal its messages and register with a qualified
trust service, and that is what a court recognises. The Avalanche log adds what a seal does not: anyone (a consulate,
a citizen, a journalist) can check, for free and without an account, that a message came from the registered agent,
that custody records were not changed, that a record was in the city's published list, and what the agent's public
track record is (returns recorded by the office, and its validation of each AI decision, through ERC-8004). Only
hashes and scores go onchain, never personal data. The two are complementary.

**What does the AI decide, and what if it is wrong?**
Claude proposes; people and rules decide. At intake the operator reviews and confirms every field. The return
agent's decisions are checked by a fixed policy that adds any notice the law requires, and the office scores each
decision onchain. Messages are drafts until the office sends them.

**Where are the data?**
The database runs in the EU (Supabase, Ireland). Claude, ElevenLabs and Exa process text and voice for their tasks;
a production deployment would use their EU data residency options and a data-protection impact assessment. Full
document numbers are masked before anything is stored, logged or sent to a model; the operator's raw note is not
kept in the public record.

**Can tourists use it?**
Yes: search works in English, Spanish, French, German and Chinese (the register is Italian; Ritrovo adds its terms),
object names are shown translated, the voice assistant speaks 20 languages, and anyone who lost a passport is told
how to get an emergency travel document from their consulate, with its contacts.

**Where do fees and rules come from?**
Fees from Delibera di Giunta Capitolina 421/2023 (custody €4.60, processing €5.80, storage €17.40 after 30 days;
identity documents free); procedure and terms from articles 927–931 of the Civil Code and the office's service page.

**Is the data open?**
Yes: `data/open/` (CSV and JSON, CC BY 4.0, source Roma Capitale), plus a live API. The code is under EUPL-1.2.
