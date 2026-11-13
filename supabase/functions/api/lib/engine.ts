// Return engine: intake → understand → custody → route (agent + policy guard) → signed outbox → alerts.
import type { SupabaseClient } from "npm:@supabase/supabase-js@2.49.4";
import { understandIntake, runToolLoop, llmEnabled, MODEL, type ToolSpec, type Step } from "./llm.ts";
import { parseNote, maskNumber, requiredChannels, templateAppIo, templateEmbassy, templateAlertMatch, type ItemForRouting } from "./rules.ts";
import { countryByCode } from "./countries.ts";
import { exaEnabled, findMission } from "./exa.ts";
import { signPayload, writeCustody, hashJson, explorerTx, type CustodyEvent } from "./chain.ts";

export type Ctx = { db: SupabaseClient; pickupUrl: (id: string, lang: string) => string; verifyUrl: (outboxId: string) => string };

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
const ITA_DOC = /^(CARTA IDENTITA'|CARTA D'IDENTITA'|PATENTE DI GUIDA|TESSERA SANITARIA|CODICE FISCALE|PERMESSO DI SOGGIORNO|PASSAPORTO)(?!.*ESTER)/;
const FOR_DOC = /(PASSAPORTO ESTERO|CARTA IDENTITA' ESTERA|PATENTE DI GUIDA ESTERA|TESSERA SANITARIA ESTERA|DOCUMENTO DI IDENTITA' ESTER)/;
export function idDocKind(objs: string[]) {
  const ita = objs.some((o) => ITA_DOC.test(o)), fore = objs.some((o) => FOR_DOC.test(o));
  return ita && fore ? "mixed" : ita ? "italian" : fore ? "foreign" : "none";
}
const PREFIX = /(?:\bNr|\bIMEI)\s*:\s*([A-Z0-9][A-Z0-9 ./\-]*?)\s*\*/g;
export const prefixesOf = (objs: string[]) =>
  [...new Set(objs.flatMap((o) => [...o.matchAll(PREFIX)].map((m) => m[1].toUpperCase().replace(/[^A-Z0-9]/g, "")).filter((p) => p.length >= 3)))];
/** Remove full document/card/IMEI numbers from free text (operator notes). */
export const maskFreeText = (s: string) => s.replace(/\b([A-Z]{1,3}\d{5,9}|\d{9,19})\b/gi, (m) => maskNumber(m));
export const maskContact = (phone?: string | null, email?: string | null) =>
  phone ? phone.slice(0, 3) + " " + phone.slice(3).replace(/\d(?=\d{2})/g, "*") : email ? email.replace(/^(.).*(@.*)$/, "$1***$2") : "";

async function sha256Hex(bytes: Uint8Array) {
  const d = await crypto.subtle.digest("SHA-256", new Uint8Array(bytes));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
const b64ToBytes = (b64: string) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));

// ---------- custody ----------
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
export async function intake(ctx: Ctx, input: { photo_base64?: string; media_type?: string; note?: string; found_where?: string; finder_channel?: string }) {
  // Full document/card numbers never leave this function: the LLM, logs and DB only see masked numbers.
  const rawNote = (input.note ?? "").slice(0, 2000); // only the local rule parser sees it (it masks its own output)
  const note = maskFreeText(rawNote);
  const steps: Step[] = [];
  let mode: "llm" | "rules" = "rules", model: string | null = null, llmError: string | null = null;
  let f = parseNote(rawNote, input.found_where, input.finder_channel);
  if (llmEnabled()) {
    try {
      const t0 = Date.now();
      const r = await understandIntake({ photo_b64: input.photo_base64, media_type: input.media_type, note, found_where: input.found_where, finder_channel: input.finder_channel });
      if (r) {
        f = { ...r.fields, objects: r.fields.objects.map((o) => maskFreeText(o.toUpperCase())).filter(Boolean), description_en: maskFreeText(r.fields.description_en) };
        if (!f.objects.length) f.objects = ["ALTRO (Oggettistica)"];
        mode = "llm"; model = r.model;
        steps.push({ tool: "understand_photo_and_note", input: { note, has_photo: !!input.photo_base64 }, output: f, ms: Date.now() - t0 });
      }
    } catch (e) {
      llmError = String((e as Error).message ?? e).slice(0, 300);
    }
  }
  if (mode === "rules") steps.push({ tool: "rule_parser", input: { note }, output: f, ms: 0 });

  const today = new Date().toISOString().slice(0, 10);
  const id = `IN-${today.replaceAll("-", "").slice(2)}-${crypto.randomUUID().slice(0, 4).toUpperCase()}`;
  let photo_path: string | null = null, photo_sha256: string | null = null;
  if (input.photo_base64) {
    const bytes = b64ToBytes(input.photo_base64);
    photo_sha256 = await sha256Hex(bytes);
    photo_path = `${id}.jpg`;
    await ctx.db.storage.from("intake").upload(photo_path, bytes, { contentType: input.media_type ?? "image/jpeg", upsert: true });
  }
  if (f.cash_eur >= 0 && !f.objects.some((o) => o.startsWith("DENARO"))) f.objects.push(`DENARO EURO ${f.cash_eur}`);
  const objects = f.objects.slice(0, 20);
  const evidence = hashJson({ id, date: today, objects, colour: f.colour, brand: f.brand, cash_eur: f.cash_eur, photo_sha256 });
  const nationality = /^[A-Z]{2}$/.test(f.nationality ?? "") ? f.nationality : null;
  const row = {
    id, source: "intake", date_acquired: today, objects, categories: [...new Set(objects.map(categorize))].sort(),
    id_doc: idDocKind(objects), prefixes: prefixesOf(objects), colour: f.colour || null, brand: f.brand || null,
    found_where: f.found_where || null, finder_channel: f.finder_channel || null, nationality, photo_path,
    intake_note: note || null, evidence_hash: evidence,
  };
  const { error } = await ctx.db.from("items").insert(row);
  if (error) throw new Error(error.message);
  await ctx.db.from("agent_runs").insert({ item_id: id, kind: "intake", mode, model, steps, result: f, error: llmError });
  const custodyRes = await custody(ctx, "intake", id, evidence);
  const routing = await route(ctx, id);
  return {
    item: { id, objects, colour: row.colour, brand: row.brand, nationality, id_doc: row.id_doc, categories: row.categories, description_en: f.description_en },
    understanding: { mode, model, error: llmError },
    routing, custody: custodyRes,
  };
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
      const r = await runToolLoop({
        system: ROUTING_SYSTEM,
        user: `Route item ${itemId}. Pickup link (Italian): ${pickupIt}\nPickup link (English): ${pickupEn}\n` +
          `Required by policy: ${JSON.stringify(required)}${hold_reason ? `\nNote: ${hold_reason}` : ""}`,
        tools, maxTurns: 10,
      });
      if (r) { mode = "llm"; model = r.model; steps = r.steps; }
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
  return { decision, reason, mode, outbox_ids: drafted.map((d) => d.outbox_id), drafted, policy_guard_added: guard, error: llmError, custody: custodyRes };
}

// ---------- returns ----------
export async function markReturned(ctx: Ctx, itemId: string, verifiedWith: string) {
  const { data: item } = await ctx.db.from("items").select("id, status").eq("id", itemId).maybeSingle();
  if (!item) throw new Error("unknown item");
  if (item.status === "returned") throw new Error("already returned");
  await ctx.db.from("items").update({ status: "returned", returned_at: new Date().toISOString() }).eq("id", itemId);
  await ctx.db.from("alerts").update({ status: "closed" }).eq("matched_item_id", itemId);
  const ev = hashJson({ id: itemId, returned_at: new Date().toISOString().slice(0, 10), verified_with: verifiedWith });
  return { status: "returned", custody: await custody(ctx, "returned", itemId, ev) };
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
