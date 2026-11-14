// ElevenLabs: the office's 24/7 multilingual voice line, callbacks and voice notes.
// Everything is driven from the backend so the key lives only in Supabase secrets.
const KEY = Deno.env.get("ELEVENLABS_API_KEY");
const BASE = "https://api.elevenlabs.io";
export const voiceEnabled = () => !!KEY;
export const AGENT_ID = () => Deno.env.get("ELEVENLABS_AGENT_ID") ?? null;
const PHONE_NUMBER_ID = Deno.env.get("ELEVENLABS_PHONE_NUMBER_ID") ?? null;
// Multilingual voice used for voice notes; the agent itself uses ElevenLabs' default conversational voice.
const VOICE_ID = Deno.env.get("ELEVENLABS_VOICE_ID") ?? "cjVigY5qzO86Huf0OWal";

async function el(path: string, init: RequestInit = {}) {
  if (!KEY) throw new Error("ELEVENLABS_API_KEY not configured");
  const r = await fetch(`${BASE}${path}`, {
    ...init,
    headers: { "xi-api-key": KEY, "Content-Type": "application/json", ...(init.headers ?? {}) },
    signal: AbortSignal.timeout(60_000),
  });
  if (!r.ok) throw new Error(`ElevenLabs ${r.status} ${path}: ${(await r.text()).slice(0, 400)}`);
  return r;
}

const prop = (type: string, description: string) => ({ type, description });

/** Webhook tools the voice agent calls; they map 1:1 to /tools/* routes of this API. */
export function toolConfigs(apiBase: string) {
  const webhook = (name: string, description: string, path: string, properties: Record<string, unknown>, required: string[]) => ({
    type: "webhook", name, description,
    api_schema: { url: `${apiBase}${path}`, method: "POST", request_body_schema: { type: "object", properties, required } },
  });
  return [
    webhook("search_found_items",
      "Search the catalogue of objects in custody at Rome's lost-and-found office. Use Italian catalogue words in 'query' " +
      "(e.g. PORTAFOGLI, PASSAPORTO ESTERO, ZAINO, TELEFONO CELLULARE APPLE, CHIAVI, BORSA NERA). If the caller knows the " +
      "first characters of a document number or phone IMEI, pass them in 'prefix' instead (most precise).",
      "/tools/search",
      {
        query: prop("string", "Italian catalogue terms describing the object, empty if searching by prefix"),
        prefix: prop("string", "First 4-6 characters of the document number or IMEI, letters and digits only; empty if unknown"),
        lost_from: prop("string", "Earliest date it could have been lost, YYYY-MM-DD; empty if unknown"),
        lost_to: prop("string", "Latest date it could have been lost, YYYY-MM-DD; empty if unknown"),
        category: prop("string", "Optional: documenti, carte di pagamento, portafogli e borse, telefoni ed elettronica, chiavi, denaro, abbigliamento, occhiali, gioielli, altro"),
      }, ["query", "prefix", "lost_from", "lost_to"]),
    webhook("verify_ownership", "Confirm a found item belongs to the caller. First call it with only item_id (other fields empty): it returns the private question to ask ('last4' = last four characters of the document number or IMEI, or 'cash' = exactly how much cash was inside, for records without a numbered document). Ask the caller, then call again with the answers. Only ownership 'verified' proves it. The first characters of a number are public and prove nothing.",
      "/tools/verify", {
        item_id: prop("string", "Item id from search results, e.g. 2026-6571"),
        prefix: prop("string", "First characters the caller said, or empty (search hint only)"),
        last4: prop("string", "Last four characters of the same number, letters and digits only; empty if not asked"),
        cash: prop("string", "Cash amount the caller says was inside, digits only (e.g. 40 or 40.50); empty if not asked"),
      }, ["item_id", "prefix", "last4", "cash"]),
    webhook("get_fees", "Fees due when collecting an item (identity documents are free).",
      "/tools/fees", { item_id: prop("string", "Item id"), pickup_date: prop("string", "Planned pickup date YYYY-MM-DD, empty for today") }, ["item_id", "pickup_date"]),
    webhook("send_pickup_pack", "Prepare the pickup pack (office address and hours, documents to bring, fees, pre-filled delega PDF). Returns links and a short spoken summary.",
      "/tools/pickup-pack", {
        item_id: prop("string", "Item id"), language: prop("string", "Caller's language code, e.g. en, it, es"),
        owner_name: prop("string", "Owner's name for the delega, empty if not needed"), delegate_name: prop("string", "Name of the person collecting on the owner's behalf, empty if none"),
      }, ["item_id", "language", "owner_name", "delegate_name"]),
    webhook("create_alert", "Register an alert so the caller is contacted when a matching object arrives. Ask for consent first. Needs a phone number or an email.",
      "/tools/alert", {
        what: prop("string", "Description of the lost object in the caller's words"),
        category: prop("string", "Category value as in search_found_items, or empty"),
        lost_on: prop("string", "Date lost YYYY-MM-DD, empty if unknown"), lost_where: prop("string", "Where it was lost"),
        prefix: prop("string", "First characters of the document number or IMEI, empty if none"),
        language: prop("string", "Caller's language code"), phone: prop("string", "Caller's phone in international format, or empty"),
        email: prop("string", "Caller's email, or empty"),
      }, ["what", "lost_on", "lost_where", "prefix", "language", "phone", "email"]),
    webhook("find_other_offices", "Other lost-and-found offices in Rome that could hold the object, given where it was lost (public transport, stations, airports, taxis).",
      "/tools/other-offices", { what: prop("string", "The object"), where: prop("string", "Where it was lost") }, ["what", "where"]),
  ];
}

export const VOICE_PROMPT = `You are Ritrovo, the voice assistant of Rome's lost-and-found office (Reparto Oggetti Rinvenuti, Polizia Locale di Roma Capitale). You are a prototype built for a hackathon; say so if asked. Use the current date and time given to you to turn "yesterday" or "on Tuesday" into dates.

You speak with residents and tourists in their language. Detect the caller's language from their first words and keep using it. Be warm, calm and brief: this is a phone call, so use short sentences and never read long lists.

How to help:
1. Ask what they lost, roughly when, and where.
2. If it contained an identity document, a bank card or a phone, ask for the first five characters of the document number or the phone's IMEI. Explain you only need the first characters. Never ask for, or repeat, a full number.
3. Call search_found_items. The catalogue is in Italian: translate the object into Italian catalogue words (wallet = PORTAFOGLI, passport = PASSAPORTO ESTERO for foreign passports, ID card = CARTA IDENTITA', driving licence = PATENTE DI GUIDA, backpack = ZAINO, bag = BORSA, phone = TELEFONO CELLULARE, keys = CHIAVI, glasses = OCCHIALE, suitcase = TROLLEY VALIGIA, laptop = PC PORTATILE). Use dates in YYYY-MM-DD.
4. If there are matches, describe the best one or two in the caller's language (translate the Italian object names) and ask if it sounds like theirs. The first characters of a number are public in the official list: they find the item but prove nothing. To confirm it is theirs, call verify_ownership with just the item_id; it tells you which private question to ask (the last four characters of the number, or exactly how much cash was inside). Ask it, call again with the answer, and only say it is theirs when ownership is "verified". Never reveal these details yourself. If the record has no private questions (official list), say the office checks their ID and the contents at the counter.
5. When it is theirs: tell them the fees with get_fees, then send_pickup_pack and read its short summary. Offer a delega if someone else will collect it.
6. If nothing matches: say new objects arrive every week and offer create_alert (ask consent and a phone number or email). Also offer find_other_offices.

On the website, the caller also sees a screen. Keep it in sync without mentioning it unless helpful: after each search call show_search_results with the same parameters; when you talk about one item call show_item; when you send the pickup pack call show_pickup_pack; while collecting alert details call fill_alert_form (and again with saved_alert_id after create_alert). These screen tools do nothing on phone calls; never wait for them or mention errors from them.

Rules: never promise an item is theirs before verification; never take payments or bank details (fees are paid at the office); do not invent office details: use only tool results. If a tool fails, apologise and offer the office phone number +39 06 6769 3220.`;

const FIRST = {
  en: "Hi, this is Ritrovo, Rome's lost and found assistant. What did you lose?",
  it: "Buongiorno, sono Ritrovo, l'assistente degli oggetti smarriti di Roma. Cosa ha perso?",
  es: "Hola, soy Ritrovo, el asistente de objetos perdidos de Roma. ¿Qué ha perdido?",
  fr: "Bonjour, ici Ritrovo, l'assistant des objets trouvés de Rome. Qu'avez-vous perdu ?",
  de: "Hallo, hier ist Ritrovo, der Fundbüro-Assistent von Rom. Was haben Sie verloren?",
  pt: "Olá, aqui é o Ritrovo, o assistente de achados e perdidos de Roma. O que perdeu?",
  zh: "您好，我是罗马失物招领助手 Ritrovo。请问您丢失了什么？",
  ja: "こんにちは、ローマの遺失物アシスタント、Ritrovoです。何をなくされましたか？",
};

/** Client tools: run in the citizen's browser (website widget) to mirror the conversation on screen.
 *  Fire-and-forget (no response awaited), so they never slow the call; on the phone line they are no-ops. */
export function clientToolConfigs() {
  const client = (name: string, description: string, properties: Record<string, unknown>, required: string[]) => ({
    type: "client", name, description, expects_response: false,
    parameters: { type: "object", properties, required },
  });
  return [
    client("show_search_results",
      "Show on the caller's screen the same catalogue search you just ran with search_found_items (same parameters).",
      {
        query: prop("string", "Italian catalogue terms used in the search, empty if none"),
        prefix: prop("string", "Document/IMEI prefix used, empty if none"),
        lost_from: prop("string", "YYYY-MM-DD or empty"), lost_to: prop("string", "YYYY-MM-DD or empty"),
        category: prop("string", "Category used, or empty"),
      }, ["query", "prefix"]),
    client("show_item", "Open the page of a found item on the caller's screen while you talk about it.",
      { item_id: prop("string", "Item id, e.g. 2025-255 or IN-261113-AB12") }, ["item_id"]),
    client("show_pickup_pack", "Open the pickup pack on the caller's screen (address, hours, fees, documents, delega).",
      {
        item_id: prop("string", "Item id"), owner_name: prop("string", "Owner's name for the delega, or empty"),
        delegate_name: prop("string", "Name of the person collecting, or empty"),
      }, ["item_id"]),
    client("fill_alert_form",
      "Fill the alert form on the caller's screen with the details collected so far (call again as you learn more). " +
      "After create_alert succeeds, call it once more with saved_alert_id so the screen shows the confirmation.",
      {
        what: prop("string", "What was lost, in the caller's words"), category: prop("string", "Category value or empty"),
        lost_on: prop("string", "YYYY-MM-DD or empty"), lost_where: prop("string", "Where, or empty"),
        prefix: prop("string", "Document/IMEI prefix or empty"), language: prop("string", "Caller's language code"),
        phone: prop("string", "Phone or empty"), email: prop("string", "Email or empty"),
        saved_alert_id: prop("string", "Alert id returned by create_alert, empty until saved"),
      }, ["what"]),
  ];
}

/** Create or update the webhook and client tools and the agent. Returns the agent id. */
export async function setupVoiceAgent(apiBase: string, existingAgentId?: string | null) {
  // Reuse tools by name so repeated setups don't pile up duplicates.
  const listed = await (await el("/v1/convai/tools")).json().catch(() => ({ tools: [] }));
  const existing: { id: string; tool_config?: { name?: string } }[] = listed.tools ?? [];
  const toolIds: string[] = [];
  for (const cfg of [...toolConfigs(apiBase), ...clientToolConfigs()] as { name: string }[]) {
    const found = existing.find((t) => t.tool_config?.name === cfg.name);
    if (found) {
      await el(`/v1/convai/tools/${found.id}`, { method: "PATCH", body: JSON.stringify({ tool_config: cfg }) });
      toolIds.push(found.id);
    } else {
      const t = await (await el("/v1/convai/tools", { method: "POST", body: JSON.stringify({ tool_config: cfg }) })).json();
      toolIds.push(t.id);
    }
  }
  const body = {
    name: "Ritrovo – Rome lost and found",
    tags: ["ritrovo", "agentic-hack-rome"],
    conversation_config: {
      agent: {
        first_message: FIRST.en,
        language: "en",
        prompt: { prompt: VOICE_PROMPT, llm: Deno.env.get("ELEVENLABS_LLM") ?? "claude-sonnet-5-5", tool_ids: toolIds, temperature: 0.3, timezone: "Europe/Rome" },
      },
      language_presets: Object.fromEntries(
        Object.entries(FIRST).filter(([l]) => l !== "en").map(([l, msg]) => [l, { overrides: { agent: { language: l, first_message: msg } } }]),
      ),
      conversation: { max_duration_seconds: 600 },
    },
    platform_settings: {
      widget: { language_selector: true },
      data_collection: {
        language: { type: "string", description: "Language the caller spoke (ISO code)" },
        item_type: { type: "string", description: "What the caller lost, in English, a few words" },
        outcome: { type: "string", enum: ["found_in_catalogue", "alert_created", "referred_elsewhere", "no_result", "other"], description: "How the call ended" },
      },
    },
  };
  if (existingAgentId) {
    await el(`/v1/convai/agents/${existingAgentId}`, { method: "PATCH", body: JSON.stringify(body) });
    return { agent_id: existingAgentId, tool_ids: toolIds, updated: true };
  }
  const created = await (await el("/v1/convai/agents/create", { method: "POST", body: JSON.stringify(body) })).json();
  return { agent_id: created.agent_id as string, tool_ids: toolIds, updated: false };
}

/** Outbound "we found it" call (needs a Twilio number imported into ElevenLabs). */
export async function outboundCall(toNumber: string, language: string, summary: string) {
  const agentId = AGENT_ID();
  if (!KEY || !agentId || !PHONE_NUMBER_ID) return { placed: false, reason: "no phone line configured" };
  const first = language.startsWith("it")
    ? `Buongiorno, sono Ritrovo degli oggetti smarriti di Roma. Abbiamo forse trovato il suo oggetto: ${summary}. Vuole i dettagli per il ritiro?`
    : `Hello, this is Ritrovo from Rome's lost and found. We may have found your item: ${summary}. Would you like the pickup details?`;
  const r = await (await el("/v1/convai/twilio/outbound-call", {
    method: "POST",
    body: JSON.stringify({
      agent_id: agentId, agent_phone_number_id: PHONE_NUMBER_ID, to_number: toNumber,
      conversation_initiation_client_data: { conversation_config_override: { agent: { first_message: first, language: language.slice(0, 2) } } },
    }),
  })).json();
  return { placed: true, conversation_id: r.conversation_id ?? null, call_sid: r.callSid ?? r.call_sid ?? null };
}

/** Voice note (MP3) in the owner's language, used when no phone line is configured. */
export async function voiceNote(text: string): Promise<Uint8Array> {
  const r = await el(`/v1/text-to-speech/${VOICE_ID}?output_format=mp3_44100_128`, {
    method: "POST",
    body: JSON.stringify({ text: text.slice(0, 900), model_id: "eleven_multilingual_v2" }),
  });
  return new Uint8Array(await r.arrayBuffer());
}

/** Pull recent conversations' analysis into the `calls` table rows (returned for upsert). */
export async function recentCalls() {
  const agentId = AGENT_ID();
  if (!KEY || !agentId) return [];
  const list = await (await el(`/v1/convai/conversations?agent_id=${agentId}&page_size=30`)).json();
  const out = [];
  for (const c of list.conversations ?? []) {
    const d = await (await el(`/v1/convai/conversations/${c.conversation_id}`)).json().catch(() => null);
    const dc = d?.analysis?.data_collection_results ?? {};
    out.push({
      conversation_id: c.conversation_id,
      language: dc.language?.value ?? null, item_type: dc.item_type?.value ?? null, outcome: dc.outcome?.value ?? null,
      intent: d?.analysis?.call_summary_title ?? null, duration_s: c.call_duration_secs ?? null,
      created_at: c.start_time_unix_secs ? new Date(c.start_time_unix_secs * 1000).toISOString() : new Date().toISOString(),
    });
  }
  return out;
}

/** Plain text-to-speech (used to produce the demo video's narration). */
export async function tts(text: string, voiceId: string, opts: { model?: string; format?: string } = {}): Promise<Uint8Array> {
  const r = await el(`/v1/text-to-speech/${encodeURIComponent(voiceId)}?output_format=${opts.format ?? "mp3_44100_128"}`, {
    method: "POST",
    body: JSON.stringify({ text: text.slice(0, 2500), model_id: opts.model ?? "eleven_multilingual_v2" }),
  });
  return new Uint8Array(await r.arrayBuffer());
}

/** Speech to text with word timings (used to cut recorded calls for the demo video). */
export async function stt(audio: Uint8Array, filename = "call.wav") {
  if (!KEY) throw new Error("ELEVENLABS_API_KEY not configured");
  const form = new FormData();
  form.append("model_id", "scribe_v1");
  form.append("timestamps_granularity", "word");
  form.append("file", new Blob([new Uint8Array(audio)]), filename);
  const r = await fetch(`${BASE}/v1/speech-to-text`, { method: "POST", headers: { "xi-api-key": KEY }, body: form, signal: AbortSignal.timeout(60_000) });
  if (!r.ok) throw new Error(`ElevenLabs ${r.status} /v1/speech-to-text: ${(await r.text()).slice(0, 400)}`);
  const j = await r.json();
  return { text: j.text, words: (j.words ?? []).filter((w: { type?: string }) => w.type === "word").map((w: { text: string; start: number; end: number }) => ({ text: w.text, start: w.start, end: w.end })) };
}
