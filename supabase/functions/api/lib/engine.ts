// Return engine: intake → understand → custody → route (agent + policy guard) → signed outbox → alerts.
import type { SupabaseClient } from "npm:@supabase/supabase-js@2.49.4";
import { understandIntake, runToolLoop, llmEnabled, MODEL, type ToolSpec, type Step } from "./llm.ts";
import { parseNote, maskNumber, maskIds, maskMoney, stripCashAmount, cashKey, idTokens, secretSuffix, requiredChannels, templateAppIo, templateEmbassy, templateAlertMatch, type ItemForRouting } from "./rules.ts";
import { countryByCode } from "./countries.ts";
import { exaEnabled, findMission } from "./exa.ts";
import { signPayload, writeCustody, hashJson, explorerTx, validateDecision, giveReturnFeedback, type CustodyEvent } from "./chain.ts";
import { voiceEnabled, outboundCall, voiceNote } from "./voice.ts";
import { romeDate } from "./office.ts";

export type Ctx = { db: SupabaseClient; pickupUrl: (id: string, lang: string) => string; verifyUrl: (outboxId: string) => string; apiUrl: (path: string) => string };

// Work that may finish after the response (onchain trust records). Supabase keeps the isolate alive for it.
declare const EdgeRuntime: { waitUntil(p: Promise<unknown>): void } | undefined;
function background(p: Promise<unknown>) {
  const safe = p.catch((e) => console.error("background task failed", e));
  try { if (typeof EdgeRuntime !== "undefined") EdgeRuntime.waitUntil(safe); } catch { /* not running on Supabase */ }
}

// ---------- catalogue helpers (mirror pipeline/build_dataset.py) ----------
const CATS: [string, string[]][] = [
  ["documenti", ["CARTA IDENTITA", "PASSAPORTO", "PATENTE", "PERMESSO DI SOGGIORNO", "TESSERA SANITARIA", "DOCUMENTO", "CODICE FISCALE", "CARTA DI CIRCOLAZIONE", "CERTIFICATO"]],
  ["carte di pagamento", ["CARTA DI CREDITO", "BANCOMAT", "CARTA PREPAGATA", "POSTEPAY"]],
  ["portafogli e borse", ["PORTAFOGLI", "PORTATESSERE", "PORTADOCUMENTI", "BORSA", "BORSELLO", "POCHETTE", "ZAINO", "TROLLEY", "VALIGIA", "BUSTA", "MARSUPIO"]],
  ["telefoni ed elettronica", ["TELEFONO", "CELLULARE", "SMARTPHONE", "IPAD", "TABLET", "PC PORTATILE", "AURICOLAR", "CUFFIE", "CARICA BATTERIA", "SIMCARD", "ELETTRONICA", "SMARTWATCH", "OROLOGIO", "MACCHINA FOTOGRAFICA", "POWERBANK"]],
  ["chiavi", ["CHIAVI", "PORTACHIAVI"]],
  ["denaro", ["DENARO"]],
  ["abbigliamento", ["INDUMENTI", "ABBIGLIAMENTO", "GIUBBOTTO", "GIACCA", "SCARPE", "CAPPELLO", "SCIARPA", "OMBRELLO"]],
  ["occhiali", ["OCCHIAL"]],
  ["gioielli", ["ANELLO", "COLLANA", "BRACCIALE", "ORECCHIN", "GIOIELL"]],
];
const categorize = (o: string) => CATS.find(([, kws]) => kws.some((k) => o.includes(k)))?.[0] ?? "altro";
/** Bring model output to the catalogue's spelling (so rules, prefixes and categories work). */
export const normObject = (o: string) =>
  o.toUpperCase()
    .replace(/À/g, "A'").replace(/[ÈÉ]/g, "E'").replace(/Ì/g, "I'").replace(/Ò/g, "O'").replace(/Ù/g, "U'")
    .replace(/\bCARTA\s+(D'|DI\s+)IDENTITA'?/g, "CARTA IDENTITA'")
    .replace(/\bNR\s*[:.]\s*/g, "Nr: ")
    .replace(/\s+/g, " ").trim();
const ITA_DOC = /^(CARTA IDENTITA'|CARTA D'IDENTITA'|PATENTE DI GUIDA|TESSERA SANITARIA|CODICE FISCALE|PERMESSO DI SOGGIORNO|PASSAPORTO)(?!.*ESTER)/;
const FOR_DOC = /(PASSAPORTO ESTERO|CARTA IDENTITA' ESTERA|PATENTE DI GUIDA ESTERA|TESSERA SANITARIA ESTERA|DOCUMENTO DI IDENTITA' ESTER)/;
export function idDocKind(objs: string[]) {
  const ita = objs.some((o) => ITA_DOC.test(o)), fore = objs.some((o) => FOR_DOC.test(o));
  return ita && fore ? "mixed" : ita ? "italian" : fore ? "foreign" : "none";
}
const PREFIX = /(?:\bNr|\bIMEI)\s*:\s*([A-Z0-9][A-Z0-9 ./\-]*?)\s*\*/gi;
export const prefixesOf = (objs: string[]) =>
  [...new Set(objs.flatMap((o) => [...o.matchAll(PREFIX)].map((m) => m[1].toUpperCase().replace(/[^A-Z0-9]/g, "")).filter((p) => p.length >= 3)))];
/** Remove full document/card/IMEI numbers from free text (operator notes). */
export const maskFreeText = (s: string) => maskIds(s);
export const maskContact = (phone?: string | null, email?: string | null) =>
  phone ? phone.slice(0, 3) + " " + phone.slice(3).replace(/\d(?=\d{2})/g, "*") : email ? email.replace(/^(.).*(@.*)$/, "$1***$2") : "";

async function sha256Hex(bytes: Uint8Array) {
  const d = await crypto.subtle.digest("SHA-256", new Uint8Array(bytes));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
const b64ToBytes = (b64: string) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));

// ---------- custody ----------
const ITEM_SALT = Deno.env.get("ITEM_SALT") ?? "";
/** Salted hash of the last four characters of an item's document/IMEI number (see migration 0006). */
export async function secretHash(itemId: string, last4: string) {
  return await sha256Hex(new TextEncoder().encode(`${ITEM_SALT}|${itemId}|${last4.toUpperCase()}`));
}

export async function custody(ctx: Ctx, event: CustodyEvent, itemId: string, evidence: `0x${string}`, channel?: string) {
  const { tx_hash, error } = await writeCustody(event, itemId, evidence, channel);
  const chain_id = Number(Deno.env.get("CHAIN_ID") ?? "43113");
  await ctx.db.from("custody_events").insert({ item_id: itemId, event, item_hash: evidence, tx_hash, chain_id });
  return { event, tx_hash, explorer_url: explorerTx(tx_hash), error };
}

// ---------- outbox (signed by the agent key) ----------
export async function createOutbox(ctx: Ctx, d: { channel: string; recipient_label: string; language: string; subject: string; body: string }, itemId: string | null, alertId: string | null) {
  const { data: row, error } = await ctx.db.from("outbox").insert({
    item_id: itemId, alert_id: alertId, channel: d.channel, recipient_label: d.recipient_label.slice(0, 200),
    language: d.language.slice(0, 5), subject: d.subject.slice(0, 200), body: "(pending)", status: "draft",
  }).select("id, created_at").single();
  if (error) throw new Error(error.message);
  const verify_url = ctx.verifyUrl(row.id);
  const body = maskFreeText(d.body).replaceAll("{VERIFY_URL}", verify_url).slice(0, 4000);
  const sig = await signPayload(outboxPayload({ ...d, id: row.id, item_id: itemId, created_at: row.created_at, body }));
  await ctx.db.from("outbox").update({ body, agent_signature: sig.signature, signer: sig.signer, payload_hash: sig.payload_hash }).eq("id", row.id);
  return { outbox_id: row.id as string, verify_url };
}
export const outboxPayload = (r: { id: string; item_id: string | null; channel: string; recipient_label: string; language: string; subject: string | null; body: string; created_at: string }) => ({
  id: r.id, item_id: r.item_id, channel: r.channel, recipient_label: r.recipient_label, language: r.language,
  subject: r.subject, body_hash: hashJson(r.body), created_at: new Date(r.created_at).toISOString(),
});

// ---------- alerts ----------
export async function alertMatches(ctx: Ctx, itemId: string) {
  const { data, error } = await ctx.db.rpc("match_alerts_for_item", { p_item_id: itemId, p_min_score: 0 });
  if (error) throw new Error(error.message);
  const rows = ((data ?? []) as { alert_id: string; score: number; reasons: string[] }[]).filter((m) => m.score >= 3).slice(0, 5);
  if (!rows.length) return [];
  const { data: alerts } = await ctx.db.from("alerts").select("id, what, lost_on, lost_where, language, contact_phone, contact_email, status").in("id", rows.map((r) => r.alert_id));
  return rows.map((m) => {
    const a = (alerts ?? []).find((x) => x.id === m.alert_id)!;
    return {
      alert_id: m.alert_id, score: Math.round(m.score * 10) / 10, reasons: m.reasons, what: a.what, lost_on: a.lost_on,
      lost_where: a.lost_where, language: a.language, contact: a.contact_phone ? "phone" : a.contact_email ? "email" : "none",
      contact_masked: maskContact(a.contact_phone, a.contact_email),
    };
  });
}

// ---------- intake ----------
type IntakeInput = { photo_base64?: string; media_type?: string; note?: string; found_where?: string; finder_channel?: string; fields?: Partial<IntakeFieldsIn> };
type IntakeFieldsIn = { objects: string[]; colour: string; brand: string; nationality: string; found_where: string; finder_channel: string; cash_eur: number; description_en: string };

/** Proposed register entry from photo + dictation, nothing saved (operator reviews, edits, then confirms). */
export async function previewIntake(input: IntakeInput) {
  const rawNote = (input.note ?? "").slice(0, 2000);
  const note = maskFreeText(rawNote);
  let f = parseNote(rawNote, input.found_where, input.finder_channel);
  let mode: "llm" | "rules" = "rules", model: string | null = null, error: string | null = null;
  if (llmEnabled()) {
    try {
      const r = await understandIntake({ photo_b64: input.photo_base64, media_type: input.media_type, note, found_where: input.found_where, finder_channel: input.finder_channel });
      if (r) { f = { ...r.fields, objects: r.fields.objects.map((o) => normObject(maskFreeText(o))).filter(Boolean), description_en: maskFreeText(r.fields.description_en) }; mode = "llm"; model = r.model; }
    } catch (e) { error = String((e as Error).message ?? e).slice(0, 300); }
  }
  // Show the operator the record exactly as it will be published: money without its amount (that stays in
  // the Cash field, which becomes a private ownership question).
  const objects = f.objects.length ? f.objects.map(stripCashAmount) : ["ALTRO (Oggettistica)"];
  f.description_en = maskMoney(f.description_en ?? "");
  return {
    fields: { ...f, objects, nationality: /^[A-Z]{2}$/.test(f.nationality ?? "") ? f.nationality : "" },
    derived: { id_doc: idDocKind(objects), prefixes: prefixesOf(objects), categories: [...new Set(objects.map(categorize))].sort() },
    mode, model, error,
  };
}

export async function intake(ctx: Ctx, input: IntakeInput) {
  // Full document/card numbers never leave this function: the LLM, logs and DB only see masked numbers.
  const rawNote = (input.note ?? "").slice(0, 2000); // only the local rule parser sees it (it masks its own output)
  const note = maskFreeText(rawNote);
  const steps: Step[] = [];
  let mode: "llm" | "rules" | "operator" = "rules", model: string | null = null, llmError: string | null = null;
  let f = parseNote(rawNote, input.found_where, input.finder_channel);
  if (llmEnabled() && !(input.fields && Array.isArray(input.fields.objects) && input.fields.objects.length)) {
    try {
      const t0 = Date.now();
      const r = await understandIntake({ photo_b64: input.photo_base64, media_type: input.media_type, note, found_where: input.found_where, finder_channel: input.finder_channel });
      if (r) {
        f = { ...r.fields, objects: r.fields.objects.map((o) => normObject(maskFreeText(o))).filter(Boolean), description_en: maskFreeText(r.fields.description_en) };
        if (!f.objects.length) f.objects = ["ALTRO (Oggettistica)"];
        mode = "llm"; model = r.model;
        steps.push({ tool: "understand_photo_and_note", input: { note, has_photo: !!input.photo_base64 }, output: f, ms: Date.now() - t0 });
      }
    } catch (e) {
      llmError = String((e as Error).message ?? e).slice(0, 300);
    }
  }
  if (input.fields && Array.isArray(input.fields.objects) && input.fields.objects.length) {
    // Operator reviewed (and possibly edited) the proposed entry: their version wins.
    const c = input.fields;
    f = {
      objects: (c.objects ?? []).map((o) => normObject(maskFreeText(String(o)))).filter(Boolean).slice(0, 20),
      colour: String(c.colour ?? ""), brand: String(c.brand ?? ""), nationality: String(c.nationality ?? "").toUpperCase(),
      found_where: String(c.found_where ?? input.found_where ?? ""), finder_channel: String(c.finder_channel ?? input.finder_channel ?? ""),
      cash_eur: Number.isFinite(Number(c.cash_eur)) ? Number(c.cash_eur) : -1, description_en: maskFreeText(String(c.description_en ?? "")),
    };
    mode = "operator";
    steps.length = 0;
    steps.push({ tool: "operator_confirmed_fields", input: { note }, output: f, ms: 0 });
  }
  if (mode === "rules") steps.push({ tool: "rule_parser", input: { note }, output: f, ms: 0 });

  const today = romeDate();
  const id = `IN-${today.replaceAll("-", "").slice(2)}-${crypto.randomUUID().slice(0, 4).toUpperCase()}`;
  let photo_path: string | null = null, photo_sha256: string | null = null;
  if (input.photo_base64) {
    const bytes = b64ToBytes(input.photo_base64);
    photo_sha256 = await sha256Hex(bytes);
    photo_path = `${id}.jpg`;
    await ctx.db.storage.from("intake").upload(photo_path, bytes, { contentType: input.media_type ?? "image/jpeg", upsert: true });
  }
  if (f.cash_eur > 0 && !f.objects.some((o) => o.startsWith("DENARO"))) f.objects.push("DENARO EURO");
  const objects = f.objects.map(stripCashAmount).slice(0, 20);
  const cash = cashKey(f.cash_eur);
  const cashHash = cash ? await secretHash(id, `cash:${cash}`) : null;
  // Salted: the cash amount must not be recoverable from this public hash.
  const evidence = hashJson({ id, date: today, objects, colour: f.colour, brand: f.brand, cash: cashHash, photo_sha256 });
  const nationality = /^[A-Z]{2}$/.test(f.nationality ?? "") ? f.nationality : null;
  const row = {
    id, source: "intake", date_acquired: today, objects, categories: [...new Set(objects.map(categorize))].sort(),
    id_doc: idDocKind(objects), prefixes: prefixesOf(objects), colour: f.colour || null, brand: f.brand || null,
    found_where: f.found_where || null, finder_channel: f.finder_channel || null, nationality, photo_path,
    // The operator's note stays in the operator-only agent trace, never in the public record.
    intake_note: null, evidence_hash: evidence, description_en: maskMoney(maskFreeText(f.description_en || "")) || null,
  };
  const { error } = await ctx.db.from("items").insert(row);
  if (error) throw new Error(error.message);
  // Ownership secrets: the public list shows only the first five characters, so we keep a salted hash of the last
  // four of each number the operator read from the document. The numbers themselves are never stored.
  if (ITEM_SALT) {
    const secrets: Record<string, unknown>[] = (await Promise.all([...new Set(idTokens(rawNote))].map(async (t) => {
      const last4 = secretSuffix(t);
      return last4 ? { item_id: id, kind: "last4", prefix: t.slice(0, 5), suffix_hash: await secretHash(id, last4) } : null;
    }))).filter((x): x is NonNullable<typeof x> => !!x);
    if (cashHash) secrets.push({ item_id: id, kind: "cash", prefix: null, suffix_hash: cashHash });
    if (secrets.length) await ctx.db.from("item_secrets").insert(secrets);
  }
  await ctx.db.from("agent_runs").insert({ item_id: id, kind: "intake", mode, model, steps, result: f, error: llmError });
  const [custodyRes, routing] = await Promise.all([custody(ctx, "intake", id, evidence), route(ctx, id)]);
  return {
    item: { id, objects, colour: row.colour, brand: row.brand, nationality, id_doc: row.id_doc, categories: row.categories, description_en: f.description_en },
    understanding: { mode, model, error: llmError },
    routing, custody: custodyRes,
  };
}

// ---------- callback to the alert's author (voice) ----------
async function callback(ctx: Ctx, alertId: string, itemId: string, objects: string[]) {
  if (!voiceEnabled()) return null;
  const { data: a } = await ctx.db.from("alerts").select("language, contact_phone").eq("id", alertId).maybeSingle();
  if (!a) return null;
  const it = (a.language ?? "en").startsWith("it");
  const { data: itemRow } = await ctx.db.from("items").select("description_en").eq("id", itemId).maybeSingle();
  const italianSummary = objects.slice(0, 3).map((o) => o.replace(/\s*-\s*(Nr|IMEI):.*$/i, "")).join(", ").toLowerCase();
  const summary = !it && itemRow?.description_en ? itemRow.description_en.replace(/\.$/, "") : italianSummary;
  try {
    if (a.contact_phone) {
      const call = await outboundCall(a.contact_phone, a.language ?? "en", summary);
      if (call.placed) {
        return await createOutbox(ctx, { channel: "call", recipient_label: `Alert author (${maskContact(a.contact_phone)})`, language: a.language ?? "en",
          subject: it ? "Chiamata del voice agent" : "Voice agent callback", body: `Outbound call placed by Ritrovo's voice agent (conversation ${call.conversation_id ?? "n/a"}). Verify: {VERIFY_URL}` }, itemId, alertId);
      }
    }
    const text = it
      ? `Ciao, sono Ritrovo, l'assistente degli oggetti smarriti di Roma. Un oggetto compatibile con la tua segnalazione è arrivato: ${summary}. Trovi i dettagli per il ritiro nel messaggio che ti abbiamo inviato.`
      : `Hi, this is Ritrovo, Rome's lost and found assistant. An item matching your alert has arrived: ${summary}. You'll find the pickup details in the message we sent you.`;
    const mp3 = await voiceNote(text);
    const path = `${itemId}-${alertId.slice(0, 8)}.mp3`;
    await ctx.db.storage.from("voice").upload(path, mp3, { contentType: "audio/mpeg", upsert: true });
    const url = ctx.db.storage.from("voice").getPublicUrl(path).data.publicUrl;
    return await createOutbox(ctx, { channel: "call", recipient_label: "Alert author (voice note)", language: a.language ?? "en",
      subject: it ? "Messaggio vocale" : "Voice message", body: `${text}\nAudio: ${url}\nVerify: {VERIFY_URL}` }, itemId, alertId);
  } catch (e) {
    console.error("callback failed", e);
    return null;
  }
}

// ---------- routing ----------
const ROUTING_SYSTEM = `You are the return engine of Ritrovo, working for Rome's lost-and-found office (Reparto Oggetti Rinvenuti, Polizia Locale di Roma Capitale).
Goal: get each found item back to its owner as fast as possible, using only legitimate channels.

Policy (the office's rules, already decided):
- Italian identity document → notify the holder with an "app_io" message in Italian (the city can identify the holder).
- Foreign identity document with known nationality → "embassy" message to that country's consulate in Rome, in English with a short Italian paragraph. Look up the mission first (lookup_embassy; if missing, research_embassy when available).
- Any item → check citizens' alerts (find_alert_matches). Notify an alert's author (channel "sms" if contact is phone, "email" if email) only when you are confident it is the same item: a document/IMEI prefix match, or several consistent details (category, date window, description). For weak matches do nothing.
- Never include full document or card numbers (keep the masked form "XXXXX* * * *"), never ask for payments or bank details, never invent contacts. Identity documents are returned free; embassies are exempt from custody fees.
- Every message must contain the placeholder {VERIFY_URL} (replaced with a signed verification link) and the pickup link you are given.
- Keep messages short and clear. Write alert notifications in the alert's language.
Work efficiently: the item, the consulate contact the policy needs and the alert matches are already looked up and given to you, so normally you draft all messages and call finish together in your first turn. Use the tools only for what is missing (e.g. research_embassy when no contact is cached).
When done, call finish with the main decision and a one-sentence reason for the operator.`;

export async function route(ctx: Ctx, itemId: string) {
  const { data: item } = await ctx.db.from("items").select("id, objects, id_doc, nationality, date_acquired, colour, brand, found_where, status").eq("id", itemId).single();
  if (!item) throw new Error("unknown item");
  const it = item as ItemForRouting & { colour: string | null; brand: string | null; found_where: string | null };
  const { required, hold_reason } = requiredChannels(it);
  const drafted: { channel: string; country_code?: string; alert_id?: string; outbox_id: string }[] = [];
  let decision: string | null = null, reason: string | null = null;
  let mode: "llm" | "rules" = "rules", model: string | null = null, llmError: string | null = null;
  let steps: Step[] = [];
  const pickupIt = ctx.pickupUrl(itemId, "it"), pickupEn = ctx.pickupUrl(itemId, "en");

  const lookupEmbassy = async (code: string) => {
    const { data } = await ctx.db.from("embassies").select("*").eq("country_code", code.toUpperCase()).maybeSingle();
    return data;
  };
  const researchEmbassy = async (code: string) => {
    const c = countryByCode(code);
    if (!c) throw new Error("unknown country code");
    const m = await findMission(c.en);
    if (!m) return { found: false };
    const row = { country_code: c.code, country: c.en, ...m, refreshed_at: new Date().toISOString() };
    await ctx.db.from("embassies").upsert(row);
    return { found: true, ...row };
  };

  if (llmEnabled()) {
    const tools: ToolSpec[] = [
      { name: "get_item", description: "The found item to route (objects as in the office register, masked numbers).", input_schema: obj({}), run: async () => it },
      { name: "lookup_embassy", description: "Look up the cached contacts of a country's embassy/consulate in Rome by ISO-2 code.", input_schema: obj({ country_code: str() }), run: async (i) => (await lookupEmbassy(String(i.country_code))) ?? { found: false } },
      ...(exaEnabled() ? [{ name: "research_embassy", description: "Search the web (Exa) for the country's mission in Rome, store and return its official contacts. Use only when lookup_embassy found nothing.", input_schema: obj({ country_code: str() }), run: async (i: Record<string, unknown>) => await researchEmbassy(String(i.country_code)) }] : []),
      { name: "find_alert_matches", description: "Citizens' open alerts that may describe this item, with a match score (prefix match = 10+) and reasons. Contacts are masked.", input_schema: obj({}), run: async () => await alertMatches(ctx, itemId) },
      {
        name: "draft_message",
        description: "Create one outgoing message in the outbox (demo mode: never actually sent). It is signed by the agent key.",
        input_schema: obj({
          channel: { type: "string", enum: ["app_io", "embassy", "sms", "email"] },
          recipient_label: str("Who receives it, e.g. 'Embassy of Japan in Rome – Consular Section (email@...)'"),
          language: str("ISO language code"), subject: str(), body: str("Must include {VERIFY_URL} and the pickup link"),
          alert_id: str("Alert id for alert notifications, else empty"), country_code: str("ISO-2 for embassy messages, else empty"),
        }),
        run: async (i) => {
          const r = await createOutbox(ctx, { channel: String(i.channel), recipient_label: String(i.recipient_label), language: String(i.language), subject: String(i.subject), body: String(i.body) }, itemId, i.alert_id ? String(i.alert_id) : null);
          drafted.push({ channel: String(i.channel), country_code: String(i.country_code || "") || undefined, alert_id: String(i.alert_id || "") || undefined, outbox_id: r.outbox_id });
          if (i.alert_id) await ctx.db.from("alerts").update({ status: "matched", matched_item_id: itemId }).eq("id", String(i.alert_id));
          return r;
        },
      },
      {
        name: "finish", description: "Record the routing decision for the operator.",
        input_schema: obj({ decision: { type: "string", enum: ["app_io", "embassy", "alert_match", "hold"] }, reason: str() }),
        run: async (i) => { decision = String(i.decision); reason = String(i.reason); return { ok: true }; },
      },
    ];
    try {
      // Context engineering: look up what the policy will certainly need before the first model turn.
      const embassyCode = required.find((r) => r.channel === "embassy")?.country_code;
      const t0 = Date.now();
      const [embassy, matches] = await Promise.all([embassyCode ? lookupEmbassy(embassyCode) : Promise.resolve(undefined), alertMatches(ctx, itemId)]);
      const pre: Step[] = [];
      if (embassyCode) pre.push({ tool: "lookup_embassy", input: { country_code: embassyCode }, output: embassy ?? { found: false }, ms: Date.now() - t0 });
      pre.push({ tool: "find_alert_matches", input: {}, output: matches, ms: Date.now() - t0 });
      const r = await runToolLoop({
        system: ROUTING_SYSTEM,
        user: `Route item ${itemId}: ${JSON.stringify(it)}\nPickup link (Italian): ${pickupIt}\nPickup link (English): ${pickupEn}\n` +
          `Required by policy: ${JSON.stringify(required)}${hold_reason ? `\nNote: ${hold_reason}` : ""}\n` +
          (embassyCode ? `Consulate contact (lookup_embassy ${embassyCode}): ${JSON.stringify(embassy ?? { found: false })}\n` : "") +
          `Alert matches (find_alert_matches): ${JSON.stringify(matches)}`,
        tools, maxTurns: 6, stopAfter: "finish",
      });
      if (r) { mode = "llm"; model = r.model; steps = [...pre, ...r.steps]; }
    } catch (e) {
      llmError = String((e as Error).message ?? e).slice(0, 300);
    }
  }

  // Policy guard: every required channel gets a message, whatever the agent did.
  const guard: string[] = [];
  for (const req of required) {
    if (req.channel === "app_io" && !drafted.some((d) => d.channel === "app_io")) {
      const r = await createOutbox(ctx, templateAppIo(it, pickupIt), itemId, null);
      drafted.push({ channel: "app_io", outbox_id: r.outbox_id }); guard.push("app_io");
    }
    if (req.channel === "embassy" && !drafted.some((d) => d.channel === "embassy")) {
      let mission = await lookupEmbassy(req.country_code);
      if (!mission && exaEnabled()) mission = await researchEmbassy(req.country_code).catch(() => null);
      const label = mission?.mission_name ? `${mission.mission_name}${mission.email ? ` (${mission.email})` : ""}` : null;
      const r = await createOutbox(ctx, templateEmbassy(it, req.country_code, label, pickupEn), itemId, null);
      drafted.push({ channel: "embassy", country_code: req.country_code, outbox_id: r.outbox_id }); guard.push("embassy");
    }
  }
  // Rules-mode alert notifications: only confident matches (prefix).
  if (mode === "rules") {
    for (const m of await alertMatches(ctx, itemId)) {
      if (m.score < 10 || m.contact === "none") continue;
      const r = await createOutbox(ctx, templateAlertMatch(it, m.language, ctx.pickupUrl(itemId, m.language), m.contact === "phone" ? "sms" : "email"), itemId, m.alert_id);
      await ctx.db.from("alerts").update({ status: "matched", matched_item_id: itemId }).eq("id", m.alert_id);
      drafted.push({ channel: m.contact === "phone" ? "sms" : "email", alert_id: m.alert_id, outbox_id: r.outbox_id });
    }
  }
  // Voice callback for every alert notified in this run (call if a phone line exists, else a voice note).
  for (const d of drafted.filter((x) => x.alert_id && x.channel !== "call")) {
    const cb = await callback(ctx, d.alert_id!, itemId, it.objects);
    if (cb) drafted.push({ channel: "call", alert_id: d.alert_id, outbox_id: cb.outbox_id });
  }
  if (!decision) {
    decision = required[0]?.channel ?? (drafted.some((d) => d.alert_id) ? "alert_match" : "hold");
    reason = required[0]?.reason ?? (drafted.some((d) => d.alert_id) ? "A citizen's alert matches this item; they have been notified." : hold_reason);
  }
  const status = drafted.length ? "routed" : "in_custody";
  await ctx.db.from("items").update({ routing_decision: decision, routing_reason: reason, routed_at: new Date().toISOString(), status }).eq("id", itemId);
  await ctx.db.from("agent_runs").insert({ item_id: itemId, kind: "route", mode, model: model ?? (mode === "llm" ? MODEL : null), steps, result: { decision, reason, drafted, guard }, error: llmError });
  let custodyRes = null;
  if (drafted.length) {
    const ev = hashJson({ id: itemId, decision, outbox: drafted.map((d) => d.outbox_id) });
    custodyRes = await custody(ctx, "routed", itemId, ev, decision);
  }
  // ERC-8004 validation: the office scores the AI's decision against the policy (100 = the agent covered every
  // required notice itself; each notice the policy guard had to add costs 50). Runs after the response.
  if (mode === "llm") {
    const summary = {
      item_id: itemId, decision, model, required: required.map((r) => r.channel).sort(),
      drafted: [...new Set(drafted.map((d) => d.channel))].sort(), policy_guard_added: guard,
    };
    background(recordValidation(ctx, itemId, summary, Math.max(0, 100 - 50 * guard.length)));
  }
  return { decision, reason, mode, outbox_ids: drafted.map((d) => d.outbox_id), drafted, policy_guard_added: guard, error: llmError, custody: custodyRes };
}

async function recordValidation(ctx: Ctx, itemId: string, summary: Record<string, unknown>, score: number) {
  const { data: row } = await ctx.db.from("erc8004_events").insert({ item_id: itemId, kind: "validation_request", score, payload: summary }).select("id").single();
  const r = await validateDecision(ctx.apiUrl(`/validation/${encodeURIComponent(itemId)}`), summary, score);
  if (row) await ctx.db.from("erc8004_events").update({ request_hash: r.request_hash, tx_hash: r.request_tx, error: r.error }).eq("id", row.id);
  if (r.response_tx) await ctx.db.from("erc8004_events").insert({ item_id: itemId, kind: "validation_response", request_hash: r.request_hash, score, tx_hash: r.response_tx });
}

async function recordFeedback(ctx: Ctx, itemId: string, verifiedWith: string) {
  const r = await giveReturnFeedback(itemId, verifiedWith, ctx.apiUrl(`/items/${encodeURIComponent(itemId)}/custody`));
  await ctx.db.from("erc8004_events").insert({ item_id: itemId, kind: "feedback", score: 100, payload: { tag1: "returned", tag2: verifiedWith }, tx_hash: r.tx_hash, error: r.error });
}

// ---------- new official items vs alerts (Sentinel) ----------
export async function scanAlerts(ctx: Ctx, itemIds: string[]) {
  const notified = [];
  for (const id of itemIds.slice(0, 2000)) {
    const matches = (await alertMatches(ctx, id)).filter((m) => m.score >= 10 && m.contact !== "none");
    if (!matches.length) continue;
    const { data: it } = await ctx.db.from("items").select("id, objects, id_doc, nationality, date_acquired").eq("id", id).single();
    for (const m of matches) {
      const r = await createOutbox(ctx, templateAlertMatch(it as ItemForRouting, m.language, ctx.pickupUrl(id, m.language), m.contact === "phone" ? "sms" : "email"), id, m.alert_id);
      await ctx.db.from("alerts").update({ status: "matched", matched_item_id: id }).eq("id", m.alert_id);
      const cb = await callback(ctx, m.alert_id, id, (it as ItemForRouting).objects);
      notified.push({ item_id: id, alert_id: m.alert_id, outbox_id: r.outbox_id, callback: cb?.outbox_id ?? null });
    }
  }
  await ctx.db.from("agent_runs").insert({ kind: "match", mode: "rules", steps: [], result: { scanned: itemIds.length, notified } });
  return { scanned: itemIds.length, notified };
}

// ---------- returns ----------
export async function markReturned(ctx: Ctx, itemId: string, verifiedWith: string) {
  const { data: item } = await ctx.db.from("items").select("id, status").eq("id", itemId).maybeSingle();
  if (!item) throw new Error("unknown item");
  if (item.status === "returned") throw new Error("already returned");
  await ctx.db.from("items").update({ status: "returned", returned_at: new Date().toISOString() }).eq("id", itemId);
  await ctx.db.from("alerts").update({ status: "closed" }).eq("matched_item_id", itemId);
  const ev = hashJson({ id: itemId, returned_at: new Date().toISOString().slice(0, 10), verified_with: verifiedWith });
  const custodyRes = await custody(ctx, "returned", itemId, ev);
  background(recordFeedback(ctx, itemId, verifiedWith)); // ERC-8004 reputation: the office records the return
  return { status: "returned", custody: custodyRes, reputation: "recording on Avalanche" };
}

export async function flushCustody(ctx: Ctx) {
  const { data } = await ctx.db.from("custody_events").select("id, item_id, event, item_hash").is("tx_hash", null).order("id").limit(20);
  const out = [];
  for (const e of data ?? []) {
    const { tx_hash, error } = await writeCustody(e.event, e.item_id, e.item_hash, e.event === "routed" ? "routed" : undefined);
    if (tx_hash) await ctx.db.from("custody_events").update({ tx_hash }).eq("id", e.id);
    out.push({ id: e.id, tx_hash, error });
    if (error) break;
  }
  return out;
}

// ---------- JSON-schema helpers for strict tools ----------
function str(description?: string) { return description ? { type: "string", description } : { type: "string" }; }
function obj(props: Record<string, unknown>) {
  return { type: "object", properties: props, required: Object.keys(props), additionalProperties: false };
}
