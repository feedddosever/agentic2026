// Ritrovo API: one Supabase Edge Function, small router.
// Public:   /tools/* (agent tools), /items/:id, /items/:id/custody, /pickup/:id(+/delega.pdf), /stats, /datasets,
//           /verify/:id, /agent-registration.json, /agent/track-record, /validation/:itemId, /items/:id/proof, /health
// Operator (header x-operator-token): /intake, /engine/route, /items/:id/return, /queue, /outbox, /alerts,
//           /alerts/match, /chain/flush, /admin/status, /admin/embassy
import { createClient } from "npm:@supabase/supabase-js@2.49.4";
import { OFFICE, computeFees, claimHorizon, documentsToBring, romeDate } from "./lib/office.ts";
import { cashKey } from "./lib/rules.ts";
import { fillDelega } from "./lib/delega.ts";
import { intake, previewIntake, route, secretHash, markReturned, flushCustody, alertMatches, scanAlerts, outboxPayload, maskContact, type Ctx } from "./lib/engine.ts";
import { chainInfo, explorerTx, recoverSigner, hashJson, agentBalance, agentAddress, anchorDataset, AGENT_ID, IDENTITY_REGISTRY, trackRecord, anchoredList, canonical, officeAddress } from "./lib/chain.ts";
import { recordLeaf, foldProof, toHex, HOW_TO_VERIFY } from "./lib/proof.ts";
import { ensureTerms, translateObject, expandQuery } from "./lib/terms.ts";
import { exaEnabled, otherOffices, findMission } from "./lib/exa.ts";
import { llmEnabled, MODEL, translateLabels } from "./lib/llm.ts";
import { countryByCode, detectCountry, COUNTRIES } from "./lib/countries.ts";
import { setupVoiceAgent, recentCalls, voiceEnabled, tts, stt, agentConfigSummary, AGENT_ID as VOICE_AGENT_ID } from "./lib/voice.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const APP_URL = (Deno.env.get("APP_URL") ?? "").replace(/\/$/, "");
const OPERATOR_TOKEN = Deno.env.get("OPERATOR_TOKEN") ?? "";
const API_BASE = `${SUPABASE_URL}/functions/v1/api`;
const db = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-operator-token",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });
const bad = (msg: string, status = 400) => json({ error: msg }, status);

const pickupUrl = (id: string, lang: string) =>
  APP_URL ? `${APP_URL}/pickup/${encodeURIComponent(id)}?lang=${lang}` : `${API_BASE}/pickup/${encodeURIComponent(id)}?lang=${lang}`;
const verifyUrl = (id: string) => (APP_URL ? `${APP_URL}/verify/${id}` : `${API_BASE}/verify/${id}`);
const ctx: Ctx = { db, pickupUrl, verifyUrl, apiUrl: (p: string) => `${API_BASE}${p}` };

type Item = {
  id: string; date_acquired: string; objects: string[]; categories: string[]; id_doc: string;
  status: string; prefixes?: string[]; prefix_match?: boolean; total_count?: number;
};

// A real calendar date (YYYY-MM-DD), else null: "2026-13-45" must not crash a search.
const isoDate = (s: unknown): string | null => {
  if (typeof s !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const d = new Date(s + "T00:00:00Z");
  return !isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s ? s : null;
};
const addDays = (iso: string, n: number) => {
  const d = new Date(iso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const today = () => romeDate();

/** Objects as spoken/read to a citizen: drop empty "Nr: N/D" noise, keep masked numbers. */
const tidy = (objects: string[]) =>
  objects.map((o) => o.replace(/\s*-\s*Nr:\s*(N\/D|\*[\s*]*)$/i, "").replace(/\s+/g, " ").trim()).filter(Boolean);

function itemCard(i: Item, lang?: string) {
  const objs = tidy(i.objects);
  const tr = lang && lang !== "it" ? objs.map((o) => translateObject(o, lang)) : null;
  return {
    id: i.id,
    found_date: i.date_acquired,
    summary: objs.slice(0, 4).join("; ") + (objs.length > 4 ? `; +${objs.length - 4} more` : ""),
    objects: objs,
    // Same order as objects; null where no translation exists (the Italian name is the official one).
    objects_translated: tr ?? undefined,
    summary_translated: tr ? objs.slice(0, 4).map((o, k) => tr[k] ?? o).join("; ") + (objs.length > 4 ? `; +${objs.length - 4}` : "") : undefined,
    categories: i.categories,
    contains_identity_document: i.id_doc !== "none",
    prefix_match: i.prefix_match ?? undefined,
    status: i.status,
  };
}

async function getItem(id: string): Promise<Item | null> {
  const { data } = await db.from("items").select("id,date_acquired,objects,categories,id_doc,status,prefixes").eq("id", id).maybeSingle();
  return data as Item | null;
}

// ---------- tools used by the voice agent and the app ----------

async function toolSearch(b: Record<string, unknown>) {
  const lostFrom = isoDate(b.lost_from), lostTo = isoDate(b.lost_to) ?? lostFrom;
  // Items reach the office from the same day to a few weeks after the loss.
  const from = lostFrom ? addDays(lostFrom, -1) : null;
  const to = lostTo ? [addDays(lostTo, 30), today()].sort()[0] : null;
  // Tourists search in their language; the register is Italian. Add the Italian catalogue terms.
  await ensureTerms(db);
  const lang = typeof b.lang === "string" ? b.lang.slice(0, 2) : typeof b.language === "string" ? b.language.slice(0, 2) : undefined;
  const raw = typeof b.query === "string" && b.query.trim() ? b.query.trim().slice(0, 200) : null;
  const expanded = raw ? expandQuery(raw) : { q: null as string | null, added: [] as string[] };
  const { data, error } = await db.rpc("search_items", {
    q: expanded.q,
    p_category: typeof b.category === "string" && b.category ? b.category : null,
    p_from: from, p_to: to,
    p_prefix: typeof b.prefix === "string" && b.prefix ? b.prefix : null,
    p_limit: Math.min(Number(b.limit) || 5, 20),
  });
  if (error) return bad(error.message, 500);
  const rows = (data ?? []) as Item[];
  const total = rows[0]?.total_count ?? 0;
  const prefixGiven = typeof b.prefix === "string" && b.prefix.length > 0;
  const aboutPassport = /passaport/i.test(expanded.q ?? "") || rows.some((r) => r.objects.some((o) => o.startsWith("PASSAPORTO")));
  return json({
    total_matches: total,
    window: from || to ? { found_from: from, found_to: to } : null,
    also_searched_for: expanded.added.length ? expanded.added : undefined,
    results: rows.map((r) => itemCard(r, lang)),
    passport_help: aboutPassport ? passportHelp(lang) : undefined,
    guidance: prefixGiven
      ? (total ? "Ownership prefix matches. Offer fees and the pickup pack." : "No record with that document/IMEI prefix. Offer a search by description or an alert.")
      : total > 5
      ? "Many candidates. Ask for the first characters of the document number or IMEI, or a narrower date."
      : total === 0
      ? "Nothing found. Offer to file an alert and suggest other lost-and-found offices."
      : "Read the closest matches and ask the caller to confirm.",
  });
}

// ---------- passports: where tourists go to travel home ----------

const PASSPORT_TEXT: Record<string, { title: string; text: string }> = {
  en: { title: "Need to travel before you get your passport back?", text: "Your country's embassy or consulate in Rome can issue an emergency travel document. They usually ask for a report of the loss (denuncia di smarrimento, free, at any Polizia di Stato or Carabinieri station) and passport photos. If your passport is listed here, tell them the record number: it is kept at the lost-and-found office until you or your consulate collect it." },
  it: { title: "Devi viaggiare prima di riavere il passaporto?", text: "L'ambasciata o il consolato del tuo Paese a Roma può rilasciare un documento di viaggio d'emergenza. Di solito chiede la denuncia di smarrimento (gratuita, in qualsiasi ufficio della Polizia di Stato o stazione dei Carabinieri) e fototessere. Se il tuo passaporto è in elenco, indica il numero di registro: è custodito all'ufficio oggetti rinvenuti finché tu o il tuo consolato non lo ritirate." },
  es: { title: "¿Necesita viajar antes de recuperar su pasaporte?", text: "La embajada o el consulado de su país en Roma puede expedir un documento de viaje de emergencia. Normalmente piden la denuncia de pérdida (denuncia di smarrimento, gratuita, en cualquier comisaría de la Polizia di Stato o cuartel de los Carabinieri) y fotos de pasaporte. Si su pasaporte aparece aquí, indique el número de registro: se guarda en la oficina de objetos perdidos hasta que usted o su consulado lo recojan." },
  fr: { title: "Vous devez voyager avant de récupérer votre passeport ?", text: "L'ambassade ou le consulat de votre pays à Rome peut délivrer un document de voyage d'urgence. Ils demandent généralement une déclaration de perte (denuncia di smarrimento, gratuite, dans tout commissariat de la Polizia di Stato ou poste des Carabinieri) et des photos d'identité. Si votre passeport figure ici, indiquez le numéro d'enregistrement : il est conservé au bureau des objets trouvés jusqu'à ce que vous ou votre consulat veniez le chercher." },
  de: { title: "Müssen Sie reisen, bevor Sie Ihren Pass zurückbekommen?", text: "Die Botschaft oder das Konsulat Ihres Landes in Rom kann ein Notreisedokument ausstellen. Meist werden eine Verlustanzeige (denuncia di smarrimento, kostenlos, bei jeder Dienststelle der Polizia di Stato oder der Carabinieri) und Passfotos verlangt. Wenn Ihr Pass hier aufgeführt ist, nennen Sie die Registernummer: Er wird im Fundbüro aufbewahrt, bis Sie oder Ihr Konsulat ihn abholen." },
  zh: { title: "在取回护照之前需要出行吗？", text: "您所在国家驻罗马的大使馆或领事馆可以签发紧急旅行证件。通常需要提供遗失报案证明（denuncia di smarrimento，可在任何国家警察局或宪兵站免费办理）和证件照。如果您的护照在此列出，请告知记录编号：护照会保存在失物招领处，直到您本人或您的领事馆前来领取。" },
};
const passportHelp = (lang?: string | null) => ({ ...(PASSPORT_TEXT[(lang ?? "en").slice(0, 2)] ?? PASSPORT_TEXT.en), consulates_url: `${API_BASE}/consulates` });

/** A country's mission in Rome from the cache; if missing, found with Exa from official sources and stored. */
async function consulateFor(countryOrCode: string) {
  const c = countryByCode(countryOrCode) ?? detectCountry(countryOrCode);
  const code = c?.code ?? (/^[A-Za-z]{2}$/.test(countryOrCode) ? countryOrCode.toUpperCase() : null);
  if (code) {
    const { data } = await db.from("embassies").select("country_code, country, mission_name, email, phone, address, hours, lost_passport_note, source_url, refreshed_at").eq("country_code", code).maybeSingle();
    if (data) return { found: true, ...data };
  }
  const name = c?.en ?? countryOrCode;
  if (!exaEnabled() || name.length < 3) return { found: false, country: name };
  const m = await findMission(name).catch(() => null);
  if (!m) return { found: false, country: name };
  const row = { country_code: code ?? name.slice(0, 2).toUpperCase(), country: name, ...m, refreshed_at: new Date().toISOString() };
  if (code) await db.from("embassies").upsert(row);
  return { found: true, researched_with: "Exa", ...row };
}

async function toolConsulate(b: Record<string, unknown>) {
  const q = String(b.country ?? "").trim();
  if (!q) return bad("country required");
  return json({ ...(await consulateFor(q)), help: passportHelp("en").text });
}

/** Ownership check. The first characters of a number are public (they only FIND the item), so proof comes from
 * details recorded at the counter and never published: the last four characters of the document/IMEI number and
 * the cash amount. Call with just item_id to learn which questions exist. 5 wrong tries an hour per item. */
async function toolVerify(b: Record<string, unknown>) {
  const id = String(b.item_id ?? "");
  if (!id) return bad("item_id required");
  const said = String(b.prefix ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  const last4 = String(b.last4 ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  const cash = cashKey(b.cash);
  const item = await getItem(id);
  if (!item) return bad("unknown item", 404);
  const hit = said.length >= 4 ? (item.prefixes ?? []).some((p) => p.length >= 4 && (said.startsWith(p) || p.startsWith(said))) : null;
  const { data: secrets } = await db.from("item_secrets").select("kind, suffix_hash").eq("item_id", id);
  const kinds = [...new Set((secrets ?? []).map((s) => s.kind as string))].sort((a, b) => (a === "last4" ? -1 : b === "last4" ? 1 : 0));
  const answers: Record<string, string | null> = { last4: last4.length === 4 ? last4 : null, cash: cash ? `cash:${cash}` : null };
  // Ask only the strongest question the record supports: the last four characters when there is a numbered
  // document, else the cash amount. A misremembered cash amount must not block an owner who knows the number.
  const asked = kinds.slice(0, 1);
  const answered = asked.filter((k) => answers[k]);
  let ownership: "verified" | "failed" | "locked" | "not_checked" | "not_available" = kinds.length ? "not_checked" : "not_available";
  let verifiedWith: string | null = null;
  if (answered.length) {
    const since = new Date(Date.now() - 3600_000).toISOString();
    const { count } = await db.from("verify_attempts").select("id", { count: "exact", head: true }).eq("item_id", id).eq("ok", false).gte("created_at", since);
    if ((count ?? 0) >= 5) ownership = "locked";
    else {
      const ok: Record<string, boolean> = {};
      for (const k of answered) {
        const h = await secretHash(id, answers[k]!);
        ok[k] = (secrets ?? []).some((s) => s.kind === k && s.suffix_hash === h);
      }
      const wrong = answered.some((k) => !ok[k]);
      if (wrong) ownership = "failed";
      else { ownership = "verified"; verifiedWith = asked[0]; }
      await db.from("verify_attempts").insert({ item_id: id, ok: !wrong });
    }
  }
  const ask = asked.map((k) => (k === "last4" ? "the last four characters of the document number or IMEI" : "exactly how much cash was inside")).join(" and ");
  const note = {
    verified: `Ownership confirmed with ${verifiedWith === "last4" ? "the last four characters" : "the cash amount"}, which only the owner and the office know. The owner still shows an ID at the counter.`,
    failed: "That does not match what the office recorded. Do not confirm ownership; suggest checking, or visiting the office.",
    locked: "Too many wrong attempts for this item. Ownership can now only be confirmed at the office.",
    not_checked: `To confirm it is theirs, ask ${ask}, then call verify_ownership again with the answer(s). Never reveal these details yourself.`,
    not_available: "This record comes from the official list, which has no private details. The office checks the full number or the contents against the owner's ID at the counter.",
  }[ownership];
  return json({
    item_id: id, ownership, questions: asked, verified_with: verifiedWith, note,
    // For clients that read "match": whether the answer given matches this record (prefix only as a fallback).
    match: ownership === "verified" ? true : ownership === "failed" ? false : hit,
    last4_check_available: kinds.includes("last4"),
  });
}

// ---------- trust: proofs of publication and the agent's onchain track record ----------

/** Proof that an official-list record is in the list whose fingerprint was anchored on Avalanche. */
async function itemProof(id: string) {
  const { data: it } = await db.from("items").select("id, source, date_acquired, objects, dataset_id, merkle_proof").eq("id", id).maybeSingle();
  if (!it) return bad("unknown item", 404);
  if (it.source !== "official_list" || !it.dataset_id || !it.merkle_proof) {
    return json({ item_id: id, in_official_list: false, note: "Registered at the counter through Ritrovo: its custody is logged on Avalanche instead.", custody_url: `${API_BASE}/items/${encodeURIComponent(id)}/custody` });
  }
  const { data: ds } = await db.from("datasets").select("source_url, pdf_sha256, records, merkle_root, tx_hash").eq("id", it.dataset_id).single();
  const leaf = await recordLeaf({ id: it.id, date: it.date_acquired, objects: it.objects });
  const root = toHex(await foldProof(leaf, it.merkle_proof));
  const onchain = ds?.tx_hash ? await anchoredList(ds.tx_hash).catch(() => null) : null;
  return json({
    item_id: id, in_official_list: true,
    list: { source_url: ds?.source_url, pdf_sha256: ds?.pdf_sha256, records: ds?.records },
    leaf: toHex(leaf), proof: it.merkle_proof, computed_root: root, root_matches_list: root === ds?.merkle_root,
    anchor: onchain && ds?.tx_hash ? {
      tx_hash: ds.tx_hash, explorer_url: explorerTx(ds.tx_hash), anchored_at: onchain.anchored_at, merkle_root: onchain.merkle_root,
      root_matches: onchain.merkle_root.toLowerCase() === root.toLowerCase(),
      pdf_matches: onchain.pdf_sha256.toLowerCase() === `0x${ds.pdf_sha256}`.toLowerCase(),
    } : null,
    verified: !!onchain && onchain.merkle_root.toLowerCase() === root.toLowerCase(),
    how_to_verify: HOW_TO_VERIFY,
  });
}

let trackCache: { at: number; value: unknown } | null = null;
async function agentTrackRecord() {
  if (!trackCache || Date.now() - trackCache.at > 30_000) trackCache = { at: Date.now(), value: await trackRecord() };
  const { data: recent } = await db.from("erc8004_events").select("kind, item_id, score, tx_hash, created_at").not("tx_hash", "is", null).order("created_at", { ascending: false }).limit(6);
  return json({ ...(trackCache.value as Record<string, unknown> ?? {}), recent: (recent ?? []).map((r) => ({ ...r, explorer_url: explorerTx(r.tx_hash) })) });
}

/** The public decision summary the office validated (the requestURI of the ERC-8004 validation request). */
async function validationRecord(itemId: string) {
  const { data: rows } = await db.from("erc8004_events").select("kind, request_hash, score, payload, tx_hash, created_at").eq("item_id", itemId).in("kind", ["validation_request", "validation_response"]).order("created_at", { ascending: false });
  const req = (rows ?? []).find((r) => r.kind === "validation_request");
  if (!req) return bad("no validation for this item", 404);
  const res = (rows ?? []).find((r) => r.kind === "validation_response" && r.request_hash === req.request_hash);
  return json({
    ...req.payload, score: req.score, validator: officeAddress, request_hash: req.request_hash,
    request_hash_recomputed: hashJson(req.payload), canonical_payload: canonical(req.payload),
    request_tx: explorerTx(req.tx_hash), response_tx: explorerTx(res?.tx_hash ?? null),
    scoring: "100 if the agent drafted every notice the policy requires; minus 50 for each notice the policy guard had to add.",
  });
}

async function toolFees(b: Record<string, unknown>) {
  const item = await getItem(String(b.item_id ?? ""));
  if (!item) return bad("unknown item", 404);
  // Never earlier than the day the office received the item.
  const pickup = [isoDate(b.pickup_date) ?? today(), item.date_acquired].sort()[1];
  const fees = computeFees(item.objects, item.date_acquired, new Date(pickup + "T12:00:00Z"), b.requester === "embassy" ? "embassy" : "owner");
  return json({ item_id: item.id, pickup_date: pickup, ...fees, office_hours: OFFICE.hours.en });
}

function pickupLinks(id: string, lang: string, owner?: string, delegate?: string) {
  const q = new URLSearchParams({ ...(owner ? { owner } : {}), ...(delegate ? { delegate } : {}) }).toString();
  return {
    page_url: pickupUrl(id, lang),
    delega_pdf_url: `${API_BASE}/pickup/${encodeURIComponent(id)}/delega.pdf${q ? "?" + q : ""}`,
  };
}

async function toolPickupPack(b: Record<string, unknown>) {
  const item = await getItem(String(b.item_id ?? ""));
  if (!item) return bad("unknown item", 404);
  const lang = typeof b.language === "string" ? b.language.slice(0, 5) : "en";
  const fees = computeFees(item.objects, item.date_acquired, new Date());
  const links = pickupLinks(item.id, lang, b.owner_name as string | undefined, b.delegate_name as string | undefined);
  const rec = item.id.startsWith("IN-") ? item.id : `${item.id.split("-")[1]} of ${item.id.split("-")[0]}`;
  return json({
    item_id: item.id,
    ...links,
    spoken_summary:
      `Bring a valid ID to ${OFFICE.address}. ${OFFICE.hours.en} ` +
      (fees.total ? `Fees today: €${fees.total.toFixed(2)}. ` : "No fees for identity documents. ") +
      `Quote record number ${rec}.`,
  });
}

async function toolAlert(b: Record<string, unknown>) {
  const what = typeof b.what === "string" ? b.what.trim().slice(0, 500) : "";
  if (!what) return bad("'what' is required");
  const row = {
    what,
    language: typeof b.language === "string" ? b.language.slice(0, 5) : "it",
    category: typeof b.category === "string" && b.category ? b.category : null,
    lost_on: isoDate(b.lost_on),
    lost_where: typeof b.lost_where === "string" ? b.lost_where.slice(0, 200) : null,
    prefix: typeof b.prefix === "string" ? b.prefix.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 20) || null : null,
    contact_phone: typeof b.phone === "string" ? b.phone.replace(/[^+\d]/g, "").slice(0, 20) || null : null,
    contact_email: typeof b.email === "string" && /.+@.+\..+/.test(b.email) ? b.email.slice(0, 120) : null,
  };
  const { data, error } = await db.from("alerts").insert(row).select("id").single();
  if (error) return bad(error.message, 500);
  // Check the existing catalogue right away: the item may already be in custody.
  const { data: hits } = await db.rpc("search_items", {
    q: row.prefix ? null : row.what, p_category: row.category, p_prefix: row.prefix,
    p_from: row.lost_on ? addDays(row.lost_on, -1) : null, p_to: null, p_limit: 3,
  });
  const already = ((hits ?? []) as Item[]).filter((h) => !row.prefix || h.prefix_match).map((h) => itemCard(h));
  return json({
    alert_id: data.id,
    message: "Alert saved. We will check every new list and contact you if a match appears.",
    possible_matches_now: row.prefix ? already : already.slice(0, 3),
  });
}

async function toolOtherOffices(b: Record<string, unknown>) {
  const what = String(b.what ?? "").slice(0, 200), where = String(b.where ?? "").slice(0, 200);
  if (!exaEnabled()) {
    return json({
      live: false,
      offices: [],
      guidance: "Depending on where it was lost, also check the lost-property offices of public transport (ATAC), the railway operators at the station (Trenitalia, Italo), the airport (Fiumicino, Ciampino) or the taxi company.",
    });
  }
  try {
    return json({ live: true, ...(await otherOffices(what, where)) });
  } catch (e) {
    return bad(`search failed: ${(e as Error).message}`, 502);
  }
}

// ---------- pages / documents ----------

async function nationalityConsulate(itemId: string) {
  const { data } = await db.from("items").select("nationality").eq("id", itemId).maybeSingle();
  return data?.nationality ? await consulateFor(data.nationality) : null;
}

async function pickupPage(id: string, url: URL) {
  const item = await getItem(id);
  if (!item) return bad("unknown item", 404);
  const lang = url.searchParams.get("lang") ?? "en";
  await ensureTerms(db);
  return json({
    item: itemCard(item, lang.slice(0, 2)),
    fees_today: computeFees(item.objects, item.date_acquired, new Date()),
    claim_horizon: { date: claimHorizon(item.date_acquired), note: "Art. 929 c.c.: after one year from publication an unclaimed item may be assigned to the finder. Indicative date." },
    office: { ...OFFICE, hours: lang.startsWith("it") ? OFFICE.hours.it : OFFICE.hours.en },
    documents_to_bring: documentsToBring(lang),
    passport_help: item.objects.some((o) => o.startsWith("PASSAPORTO ESTERO"))
      ? { ...passportHelp(lang), consulate: await nationalityConsulate(item.id) }
      : undefined,
    ...pickupLinks(item.id, lang, url.searchParams.get("owner") ?? undefined, url.searchParams.get("delegate") ?? undefined),
  });
}

async function delegaPdf(id: string, url: URL) {
  const item = await getItem(id);
  if (!item) return bad("unknown item", 404);
  const reperto = item.id.startsWith("IN-") ? item.id : `${item.id.split("-")[1]} / ${item.id.split("-")[0]}`;
  const bytes = await fillDelega({
    reperto,
    owner: url.searchParams.get("owner") ?? undefined,
    delegate: url.searchParams.get("delegate") ?? undefined,
  });
  return new Response(new Uint8Array(bytes), { headers: { ...CORS, "Content-Type": "application/pdf", "Content-Disposition": `inline; filename="delega-${item.id}.pdf"` } });
}

async function custodyTimeline(id: string) {
  const { data } = await db.from("custody_events").select("event, created_at, tx_hash, chain_id").eq("item_id", id).order("id");
  return json((data ?? []).map((e) => ({ ...e, explorer_url: explorerTx(e.tx_hash), status: e.tx_hash ? "onchain" : "pending" })));
}

async function verifyMessage(id: string) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return bad("invalid message id");
  const { data: m } = await db.from("outbox").select("*").eq("id", id).maybeSingle();
  const agent = { name: "Ritrovo", ...chainInfo(), address: agentAddress, registry: IDENTITY_REGISTRY, explorer_url: agentAddress ? `https://${Number(Deno.env.get("CHAIN_ID") ?? "43113") === 43114 ? "" : "testnet."}snowtrace.io/address/${agentAddress}` : null };
  if (!m) return json({ valid: false, reason: "No message with this id was sent by Ritrovo.", agent });
  const recomputed = hashJson(outboxPayload(m));
  let recovered: string | null = null;
  if (m.agent_signature && m.payload_hash) recovered = await recoverSigner(m.payload_hash, m.agent_signature).catch(() => null);
  const valid = !!recovered && recovered.toLowerCase() === (agentAddress ?? "").toLowerCase() && recomputed === m.payload_hash;
  return json({
    valid,
    reason: valid ? "Signed by Ritrovo's registered agent key and unchanged since it was written." : "Signature or content does not match.",
    message: { channel: m.channel, recipient_label: m.recipient_label, subject: m.subject, created_at: m.created_at, item_id: m.item_id },
    agent, signature: m.agent_signature, recovered_signer: recovered, payload_hash: m.payload_hash,
  });
}

function agentRegistration() {
  const ci = chainInfo();
  return json({
    type: "https://eips.ethereum.org/EIPS/eip-8004#registration-v1",
    name: "Ritrovo – Rome lost-and-found return agent",
    description:
      "Ritrovo helps Rome's lost-and-found office return found objects: it decodes the city's published lists, " +
      "understands new intakes from a photo, routes identity documents to their holders or consulates, matches " +
      "citizens' alerts and answers callers in their language. Outgoing messages are signed by this agent; custody " +
      "events are logged on Avalanche as hashes only.",
    image: APP_URL ? `${APP_URL}/ritrovo-agent.png` : "",
    services: [
      { name: "web", endpoint: APP_URL || API_BASE },
      { name: "verify-message", endpoint: `${API_BASE}/verify/{message_id}` },
    ],
    x402Support: false,
    active: true,
    registrations: AGENT_ID ? [{ agentId: Number(AGENT_ID), agentRegistry: ci.agent_registry }] : [],
    supportedTrust: ["reputation", "validation"],
  });
}

// ---------- operator views ----------

async function queue(url: URL) {
  const status = url.searchParams.get("status");
  let q = db.from("items").select("id, created_at, date_acquired, objects, id_doc, status, routing_decision, routing_reason, nationality, photo_path")
    .eq("source", "intake").order("created_at", { ascending: false }).limit(100);
  if (status) q = q.eq("status", status);
  const { data } = await q;
  return json((data ?? []).map((r) => ({ ...r, decision: r.routing_decision, reason: r.routing_reason })));
}

async function outbox() {
  const { data } = await db.from("outbox").select("id, created_at, item_id, alert_id, channel, recipient_label, language, subject, body, status").order("created_at", { ascending: false }).limit(200);
  return json((data ?? []).map((m) => ({ ...m, verify_url: verifyUrl(m.id) })));
}

async function alertsList() {
  const { data } = await db.from("alerts").select("*").order("created_at", { ascending: false }).limit(200);
  return json((data ?? []).map((a) => ({
    id: a.id, created_at: a.created_at, what: a.what, lost_on: a.lost_on, lost_where: a.lost_where, language: a.language,
    status: a.status, matched_item_id: a.matched_item_id, contact: maskContact(a.contact_phone, a.contact_email),
  })));
}

async function adminStatus() {
  const [items, outboxN, alertsN, custodyN] = await Promise.all([
    db.from("items").select("id", { count: "exact", head: true }),
    db.from("outbox").select("id", { count: "exact", head: true }),
    db.from("alerts").select("id", { count: "exact", head: true }),
    db.from("custody_events").select("id", { count: "exact", head: true }).is("tx_hash", null),
  ]);
  return json({
    integrations: {
      claude: { enabled: llmEnabled(), model: MODEL },
      exa: { enabled: exaEnabled() },
      elevenlabs: { enabled: voiceEnabled(), agent_id: VOICE_AGENT_ID(), phone_line: !!Deno.env.get("ELEVENLABS_PHONE_NUMBER_ID") },
      chain: { ...chainInfo(), agent_balance_wei: await agentBalance() },
    },
    counts: { items: items.count, outbox: outboxN.count, alerts: alertsN.count, custody_pending: custodyN.count },
  });
}

async function readBody(req: Request) {
  return req.method === "POST" ? await req.json().catch(() => ({})) : {};
}

// ---------- router ----------

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  const url = new URL(req.url);
  const path = url.pathname.replace(/^\/(functions\/v1\/)?api/, "") || "/";
  const isOperator = !!OPERATOR_TOKEN && req.headers.get("x-operator-token") === OPERATOR_TOKEN;
  try {
    const body = await readBody(req);
    let m;
    if (req.method === "POST") {
      switch (path) {
        case "/tools/search": return await toolSearch(body);
        case "/tools/verify": return await toolVerify(body);
        case "/tools/fees": return await toolFees(body);
        case "/tools/pickup-pack": return await toolPickupPack(body);
        case "/tools/alert": return await toolAlert(body);
        case "/tools/other-offices": return await toolOtherOffices(body);
        case "/tools/consulate": return await toolConsulate(body);
      }
      if (!isOperator) return bad("operator token required", 401);
      switch (path) {
        case "/intake/preview": {
          if (!body.photo_base64 && !body.note) return bad("photo_base64 or note required");
          return json(await previewIntake(body));
        }
        case "/intake": {
          if (!body.photo_base64 && !body.note) return bad("photo_base64 or note required");
          return json(await intake(ctx, body));
        }
        case "/engine/route": return json(await route(ctx, String(body.item_id ?? "")));
        case "/alerts/match": return json(await alertMatches(ctx, String(body.item_id ?? "")));
        case "/chain/flush": return json(await flushCustody(ctx));
        case "/alerts/scan": return json(await scanAlerts(ctx, Array.isArray(body.item_ids) ? body.item_ids.map(String) : []));
        case "/chain/anchor-datasets": {
          const { data } = await db.from("datasets").select("id, source_url, pdf_sha256, records, merkle_root").is("tx_hash", null);
          const out = [];
          for (const d of data ?? []) {
            const r = await anchorDataset(`0x${d.pdf_sha256.replace(/^0x/, "")}`, d.merkle_root, d.records, d.source_url);
            if (r.tx_hash) await db.from("datasets").update({ tx_hash: r.tx_hash }).eq("id", d.id);
            out.push({ source_url: d.source_url, ...r, explorer_url: explorerTx(r.tx_hash) });
            if (r.error) break;
          }
          return json(out);
        }
        case "/admin/setup-voice-agent": {
          if (!voiceEnabled()) return bad("ELEVENLABS_API_KEY not configured", 503);
          return json(await setupVoiceAgent(API_BASE, VOICE_AGENT_ID()));
        }
        case "/admin/tts": {
          if (!voiceEnabled()) return bad("ELEVENLABS_API_KEY not configured", 503);
          const text = String(body.text ?? "");
          if (!text) return bad("text required");
          const bytes = await tts(text, String(body.voice_id ?? "cjVigY5qzO86Huf0OWal"), { model: body.model_id ? String(body.model_id) : undefined });
          return new Response(new Uint8Array(bytes), { headers: { ...CORS, "Content-Type": "audio/mpeg" } });
        }
        case "/admin/voice-agent": return json(await agentConfigSummary());
        case "/admin/translate-terms": {
          const labels = (Array.isArray(body.labels) ? body.labels : []) as { it: string; n: number }[];
          if (!labels.length) return bad("labels required");
          const out = await translateLabels(labels.map((l) => l.it));
          const n = new Map(labels.map((l) => [l.it, l.n]));
          const rows = out.filter((r) => n.has(r.it)).map((r) => ({ ...r, n: n.get(r.it) ?? 0 }));
          const { error } = await db.from("object_terms").upsert(rows);
          if (error) return bad(error.message, 500);
          return json({ translated: rows.length, of: labels.length });
        }
        case "/admin/stt": {
          if (!voiceEnabled()) return bad("ELEVENLABS_API_KEY not configured", 503);
          if (!body.audio_base64) return bad("audio_base64 required");
          const bin = Uint8Array.from(atob(String(body.audio_base64)), (c) => c.charCodeAt(0));
          return json(await stt(bin, String(body.filename ?? "call.wav")));
        }
        case "/admin/sync-calls": {
          const rows = await recentCalls();
          if (rows.length) await db.from("calls").upsert(rows);
          return json({ synced: rows.length });
        }
        case "/admin/embassy": {
          const c = countryByCode(String(body.country_code ?? ""));
          if (!c) return bad("unknown country_code");
          if (!exaEnabled()) return bad("EXA_API_KEY not configured", 503);
          const mission = await findMission(c.en);
          if (mission) await db.from("embassies").upsert({ country_code: c.code, country: c.en, ...mission, refreshed_at: new Date().toISOString() });
          return json({ country: c.en, mission });
        }
      }
      if ((m = path.match(/^\/items\/([\w-]+)\/return$/))) return json(await markReturned(ctx, m[1], String(body.verified_with ?? "id_document")));
    }
    if (req.method === "GET") {
      if (path === "/" || path === "/health") return json({ ok: true, service: "ritrovo-api" });
      if (path === "/stats") {
        const { data } = await db.from("catalogue_stats").select("*").single();
        return json(data);
      }
      if (path === "/datasets") {
        const { data } = await db.from("datasets").select("source_url, pdf_sha256, records, merkle_root, tx_hash, imported_at").order("imported_at");
        return json((data ?? []).map((d) => ({ ...d, explorer_url: explorerTx(d.tx_hash) })));
      }
      if (path === "/agent-registration.json") return agentRegistration();
      if (path === "/config") {
        return json({
          voice_agent_id: VOICE_AGENT_ID(), app_url: APP_URL || null, chain: chainInfo(),
          voice_languages: ["en", "it", "es", "fr", "de", "pt", "zh", "ja", "ko", "ru", "uk", "pl", "ro", "ar", "nl", "hi", "tr", "fil", "el", "sv"],
          office: OFFICE, // for "Prefer a person? Call the office"
          app_io: "not integrated: Ritrovo drafts the App IO notice for the office to send",
        });
      }
      if ((m = path.match(/^\/verify\/([\w-]+)$/))) return await verifyMessage(m[1]);
      if ((m = path.match(/^\/items\/([\w-]+)\/custody$/))) return await custodyTimeline(m[1]);
      if ((m = path.match(/^\/items\/([\w-]+)\/proof$/))) return await itemProof(m[1]);
      if ((m = path.match(/^\/validation\/([\w-]+)$/))) return await validationRecord(m[1]);
      if (path === "/agent/track-record") return await agentTrackRecord();
      if ((m = path.match(/^\/items\/([\w-]+)$/))) {
        const item = await getItem(m[1]);
        if (!item) return bad("unknown item", 404);
        await ensureTerms(db);
        const lang = (url.searchParams.get("lang") ?? "").slice(0, 2);
        return json({ ...itemCard(item, lang), passport_help: item.objects.some((o) => o.startsWith("PASSAPORTO ESTERO")) ? passportHelp(lang) : undefined });
      }
      if (path === "/consulates") {
        const { data } = await db.from("embassies").select("country_code, country, mission_name, email, phone, address, hours, source_url").order("country");
        return json({ consulates: data ?? [], help: passportHelp(url.searchParams.get("lang")) });
      }
      if ((m = path.match(/^\/consulates\/([A-Za-z]{2})$/))) return json(await consulateFor(m[1]));
      if ((m = path.match(/^\/pickup\/([\w-]+)\/delega\.pdf$/))) return await delegaPdf(m[1], url);
      if ((m = path.match(/^\/pickup\/([\w-]+)$/))) return await pickupPage(m[1], url);
      if (!isOperator) {
        const operatorOnly = /^\/(admin|queue|outbox|alerts|embassies)(\/|$)|^\/items\/[\w-]+\/trace$/.test(path);
        return operatorOnly ? bad("operator token required", 401) : bad(`no route for GET ${path}`, 404);
      }
      if ((m = path.match(/^\/items\/([\w-]+)\/trace$/))) {
        const { data } = await db.from("agent_runs").select("kind, mode, model, steps, result, error, created_at").eq("item_id", m[1]).order("created_at");
        return json(data ?? []);
      }
      if (path === "/embassies") {
        const { data } = await db.from("embassies").select("*").order("country");
        return json(data ?? []);
      }
      switch (path) {
        case "/queue": return await queue(url);
        case "/outbox": return await outbox();
        case "/alerts": return await alertsList();
        case "/admin/status": return await adminStatus();
      }
    }
    return bad(`no route for ${req.method} ${path}`, 404);
  } catch (e) {
    console.error(e);
    return bad(String((e as Error).message ?? "internal error").slice(0, 300), 500);
  }
});
