// Ritrovo API: one Supabase Edge Function, small router.
// Public:   /tools/* (agent tools), /items/:id, /items/:id/custody, /pickup/:id(+/delega.pdf), /stats, /datasets,
//           /verify/:id, /agent-registration.json, /health
// Operator (header x-operator-token): /intake, /engine/route, /items/:id/return, /queue, /outbox, /alerts,
//           /alerts/match, /chain/flush, /admin/status, /admin/embassy
import { createClient } from "npm:@supabase/supabase-js@2.49.4";
import { OFFICE, computeFees, claimHorizon, documentsToBring } from "./lib/office.ts";
import { fillDelega } from "./lib/delega.ts";
import { intake, previewIntake, route, markReturned, flushCustody, alertMatches, scanAlerts, outboxPayload, maskContact, type Ctx } from "./lib/engine.ts";
import { chainInfo, explorerTx, recoverSigner, hashJson, agentBalance, agentAddress, anchorDataset, AGENT_ID, IDENTITY_REGISTRY } from "./lib/chain.ts";
import { exaEnabled, otherOffices, findMission } from "./lib/exa.ts";
import { llmEnabled, MODEL } from "./lib/llm.ts";
import { countryByCode } from "./lib/countries.ts";
import { setupVoiceAgent, recentCalls, voiceEnabled, AGENT_ID as VOICE_AGENT_ID } from "./lib/voice.ts";

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
const ctx: Ctx = { db, pickupUrl, verifyUrl };

type Item = {
  id: string; date_acquired: string; objects: string[]; categories: string[]; id_doc: string;
  status: string; prefixes?: string[]; prefix_match?: boolean; total_count?: number;
};

const isoDate = (s: unknown): string | null => (typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null);
const addDays = (iso: string, n: number) => {
  const d = new Date(iso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const today = () => new Date().toISOString().slice(0, 10);

/** Objects as spoken/read to a citizen: drop empty "Nr: N/D" noise, keep masked numbers. */
const tidy = (objects: string[]) =>
  objects.map((o) => o.replace(/\s*-\s*Nr:\s*(N\/D|\*[\s*]*)$/i, "").replace(/\s+/g, " ").trim()).filter(Boolean);

function itemCard(i: Item) {
  const objs = tidy(i.objects);
  return {
    id: i.id,
    found_date: i.date_acquired,
    summary: objs.slice(0, 4).join("; ") + (objs.length > 4 ? `; +${objs.length - 4} more` : ""),
    objects: objs,
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
  const { data, error } = await db.rpc("search_items", {
    q: typeof b.query === "string" && b.query.trim() ? b.query : null,
    p_category: typeof b.category === "string" && b.category ? b.category : null,
    p_from: from, p_to: to,
    p_prefix: typeof b.prefix === "string" && b.prefix ? b.prefix : null,
    p_limit: Math.min(Number(b.limit) || 5, 20),
  });
  if (error) return bad(error.message, 500);
  const rows = (data ?? []) as Item[];
  const total = rows[0]?.total_count ?? 0;
  const prefixGiven = typeof b.prefix === "string" && b.prefix.length > 0;
  return json({
    total_matches: total,
    window: from || to ? { found_from: from, found_to: to } : null,
    results: rows.map(itemCard),
    guidance: prefixGiven
      ? (total ? "Ownership prefix matches. Offer fees and the pickup pack." : "No record with that document/IMEI prefix. Offer a search by description or an alert.")
      : total > 5
      ? "Many candidates. Ask for the first characters of the document number or IMEI, or a narrower date."
      : total === 0
      ? "Nothing found. Offer to file an alert and suggest other lost-and-found offices."
      : "Read the closest matches and ask the caller to confirm.",
  });
}

async function toolVerify(b: Record<string, unknown>) {
  const id = String(b.item_id ?? ""), said = String(b.prefix ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (!id || said.length < 4) return bad("item_id and a prefix of at least 4 characters are required");
  const item = await getItem(id);
  if (!item) return bad("unknown item", 404);
  const hit = (item.prefixes ?? []).find((p) => p.length >= 4 && (said.startsWith(p) || p.startsWith(said)));
  return json({ item_id: id, match: !!hit, note: hit ? "The number matches the published record." : "Does not match this record." });
}

async function toolFees(b: Record<string, unknown>) {
  const item = await getItem(String(b.item_id ?? ""));
  if (!item) return bad("unknown item", 404);
  const pickup = isoDate(b.pickup_date) ?? today();
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
  const already = ((hits ?? []) as Item[]).filter((h) => !row.prefix || h.prefix_match).map(itemCard);
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

async function pickupPage(id: string, url: URL) {
  const item = await getItem(id);
  if (!item) return bad("unknown item", 404);
  const lang = url.searchParams.get("lang") ?? "en";
  return json({
    item: itemCard(item),
    fees_today: computeFees(item.objects, item.date_acquired, new Date()),
    claim_horizon: { date: claimHorizon(item.date_acquired), note: "Art. 929 c.c.: after one year from publication an unclaimed item may be assigned to the finder. Indicative date." },
    office: { ...OFFICE, hours: lang.startsWith("it") ? OFFICE.hours.it : OFFICE.hours.en },
    documents_to_bring: documentsToBring(lang),
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
    supportedTrust: ["reputation"],
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
      if (path === "/config") return json({ voice_agent_id: VOICE_AGENT_ID(), app_url: APP_URL || null, chain: chainInfo() });
      if ((m = path.match(/^\/verify\/([\w-]+)$/))) return await verifyMessage(m[1]);
      if ((m = path.match(/^\/items\/([\w-]+)\/custody$/))) return await custodyTimeline(m[1]);
      if ((m = path.match(/^\/items\/([\w-]+)$/))) {
        const item = await getItem(m[1]);
        return item ? json(itemCard(item)) : bad("unknown item", 404);
      }
      if ((m = path.match(/^\/pickup\/([\w-]+)\/delega\.pdf$/))) return await delegaPdf(m[1], url);
      if ((m = path.match(/^\/pickup\/([\w-]+)$/))) return await pickupPage(m[1], url);
      if (!isOperator) return bad(`no route for GET ${path} (or operator token required)`, 404);
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
