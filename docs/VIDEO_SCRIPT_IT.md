# Ritrovo – script del video (3:00, italiano)

Formato: registrazione dello schermo dell'app pubblicata, con voce narrante in italiano.
La scena 4 contiene una telefonata reale con l'agente vocale, in inglese e sottotitolata in italiano: mostra che la
linea risponde nella lingua di chi chiama.

| # | Tempo | Sullo schermo | Voce narrante |
|---|---|---|---|
| 1 | 0:00–0:20 | Pagina 1 dell'elenco ufficiale (PDF) → riquadro con il testo copiato: solo simboli | **Il problema** |
| 2 | 0:20–0:45 | Tabella dei glifi decifrati → home di Ritrovo, con evidenziati 15.843 reperti e 7.649 con documento | **La decifrazione** |
| 3 | 0:45–1:17 | Console operatore: nota → proposta dell'IA (numero oscurato, importo del denaro non pubblicato) → conferma → "Inoltrato al consolato" → transazione su Avalanche | **L'ufficio** |
| 4 | 1:17–2:22 | Sito pubblico guidato dalla telefonata: risultati per prefisso, scheda del reperto (nomi tradotti), verifica con gli ultimi 4 caratteri, pacchetto ritiro con i contatti dell'ambasciata | **Il cittadino**, poi la telefonata |
| 5 | 2:22–2:44 | Pagina "Verifica un messaggio" (agente ERC-8004 n. 302) → curriculum su Avalanche (restituzioni registrate dall'ufficio, convalida delle decisioni) → prova di pubblicazione di un reperto | **La fiducia** |
| 6 | 2:44–3:00 | Pagina "Get alerted" → cartolina finale (link all'app e al repository) | **Chiusura** |

## Testi della voce narrante

**1 · Il problema**
Ogni mese, a Roma, vengono ritrovati circa seicento oggetti: portafogli, telefoni, passaporti. Il Comune li pubblica
in un elenco PDF di cinquecento pagine. Ma provate a copiarne il testo: escono solo simboli. Non si può cercare nulla.

**2 · La decifrazione**
Noi quel font l'abbiamo decifrato, forma per forma: quindicimila ottocentoquarantatré reperti, ricostruiti senza un
errore. E quasi la metà contiene un documento d'identità: il proprietario si può trovare. Ritrovo nasce da qui: invece
di aspettare che qualcuno cerchi, restituisce.

**3 · L'ufficio**
Allo sportello, l'operatore detta una nota. L'intelligenza artificiale propone la scheda del registro e oscura il numero
del documento; l'operatore controlla e conferma. Poi l'agente di restituzione decide chi avvisare: è un passaporto
americano, quindi prepara il messaggio per l'Ambasciata degli Stati Uniti, con i contatti trovati da Exa. Ogni
passaggio di custodia viene registrato su Avalanche.

**4 · Il cittadino** (poi parte la telefonata)
La sera, il proprietario chiama Ritrovo. A qualsiasi ora, nella sua lingua.

**5 · La fiducia**
Ogni messaggio è firmato dall'agente Ritrovo, registrato su Avalanche con lo standard ERC ottomilaquattro. L'ufficio
convalida ogni decisione automatica e registra ogni restituzione: è il curriculum pubblico dell'agente. Sulla
blockchain, mai dati personali.

**6 · Chiusura**
E quando il Comune pubblica un nuovo elenco, Ritrovo lo importa da solo e avvisa chi lo stava cercando. Ritrovo:
smettiamo di aspettare che le persone cerchino, e iniziamo a restituire.

## Telefonata (scena 4)

Chi chiama, in inglese:
1. *"Hi, I lost my wallet with my passport yesterday evening, on metro line A near Termini."*
2. *"The passport number starts with Z R 4 8 2."*
3. *"Yes, that sounds like mine. The last four are 7, 3, 1, 6."*

L'agente usa gli strumenti reali. I primi cinque caratteri sono pubblici, quindi servono solo a trovare il reperto. Per
la proprietà chiede gli ultimi quattro, che sono registrati allo sportello e mai pubblicati. Poi conferma e dà il
pacchetto ritiro. Lo schermo segue la conversazione attraverso i client tool (`show_search_results`, `show_item`,
`show_pickup_pack`). Due didascalie spiegano il passaggio chiave. I sottotitoli in italiano sono in
`scripts/video/s4_subs.ass`.

## Come è stato prodotto

- **Voce narrante:** ElevenLabs, voce "Alice", modello multilingue, tramite la rotta operatore `/admin/tts`.
- **Telefonata:** conversazione reale con l'agente pubblicato, sul suo WebSocket (`scripts/video/capture_call.py`).
  - Le battute di chi chiama sono inviate come testo, e la voce "Brian" le legge nel video.
  - L'audio dell'agente è il suo output originale.
  - I tagli (pause e due frasi lunghe) sono stati individuati con lo speech-to-text di ElevenLabs (`/admin/stt`).
- **Schermo:** Playwright sull'app pubblicata, in 1280×720 e con fuso orario Europe/Rome (`scripts/video/rec_*.js`).
  - Le attese per l'IA e per la blockchain sono state tagliate in montaggio.
  - Il risultato della scena 3 è uno screenshot reale della stessa registrazione, mostrato con una panoramica.
- **Montaggio:** `scripts/video/build.py`, con ffmpeg e loudness a -16 LUFS.
  - Gli offset nel file valgono per le registrazioni di questa ripresa.
  - Se registri di nuovo, ricavali con `blackdetect`: ogni registrazione ha un fotogramma nero di sincronizzazione.
- **Dopo la registrazione:** eseguire `scripts/reset-demo.sh`, che ripristina i dati di esempio.

## Se registri con la tua voce
Leggi i testi con calma, una scena per volta: sono circa due minuti di voce in tutto. Per la telefonata reale usa il
widget del sito (pulsante "Start a call") e parla in inglese come sopra.
