// Ritrovo API: one Supabase Edge Function, small router.
// Public:   /tools/* (agent tools), /items/:id, /pickup/:id, /pickup/:id/delega.pdf, /stats
// Operator: routes added in later phases (/intake, /engine/*, /outbox) require x-operator-token.
import { createClient } from "npm:@supabase/supabase-js@2.49.4";
import { OFFICE, computeFees, claimHorizon, documentsToBring } from "./lib/office.ts";
import { fillDelega } from "./lib/delega.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const APP_URL = (Deno.env.get("APP_URL") ?? "").replace(/\/$/, "");
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
    page_url: APP_URL ? `${APP_URL}/pickup/${encodeURIComponent(id)}?lang=${lang}` : `${API_BASE}/pickup/${encodeURIComponent(id)}?lang=${lang}`,
    delega_pdf_url: `${API_BASE}/pickup/${encodeURIComponent(id)}/delega.pdf${q ? "?" + q : ""}`,
  };
}

async function toolPickupPack(b: Record<string, unknown>) {
  const item = await getItem(String(b.item_id ?? ""));
  if (!item) return bad("unknown item", 404);
  const lang = typeof b.language === "string" ? b.language.slice(0, 5) : "en";
  const fees = computeFees(item.objects, item.date_acquired, new Date());
  const links = pickupLinks(item.id, lang, b.owner_name as string | undefined, b.delegate_name as string | undefined);
  return json({
    item_id: item.id,
    ...links,
    spoken_summary:
      `Bring a valid ID to ${OFFICE.address}. ${OFFICE.hours.en} ` +
      (fees.total ? `Fees today: €${fees.total.toFixed(2)}. ` : "No fees for identity documents. ") +
      `Quote record number ${item.id.split("-")[1]} of ${item.id.split("-")[0]}.`,
  });
}

async function toolAlert(b: Record<string, unknown>) {
  const what = typeof b.what === "string" ? b.what.trim().slice(0, 500) : "";
  if (!what) return bad("'what' is required");
  const row = {
    what,
    language: typeof b.language === "string" ? b.language.slice(0, 5) : "it",
    category: typeof b.category === "string" ? b.category : null,
    lost_on: isoDate(b.lost_on),
    lost_where: typeof b.lost_where === "string" ? b.lost_where.slice(0, 200) : null,
    prefix: typeof b.prefix === "string" ? b.prefix.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 20) || null : null,
    contact_phone: typeof b.phone === "string" ? b.phone.replace(/[^+\d]/g, "").slice(0, 20) || null : null,
    contact_email: typeof b.email === "string" && /.+@.+\..+/.test(b.email) ? b.email.slice(0, 120) : null,
  };
  const { data, error } = await db.from("alerts").insert(row).select("id").single();
  if (error) return bad(error.message, 500);
  return json({ alert_id: data.id, message: "Alert saved. We will check every new list and contact you if a match appears." });
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
  const [year, n] = item.id.split("-");
  const bytes = await fillDelega({
    reperto: `${n} / ${year}`,
    owner: url.searchParams.get("owner") ?? undefined,
    delegate: url.searchParams.get("delegate") ?? undefined,
  });
  return new Response(bytes, { headers: { ...CORS, "Content-Type": "application/pdf", "Content-Disposition": `inline; filename="delega-${year}-${n}.pdf"` } });
}

async function stats() {
  const { data } = await db.from("catalogue_stats").select("*").single();
  return json(data);
}

// ---------- router ----------

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  const url = new URL(req.url);
  const path = url.pathname.replace(/^\/(functions\/v1\/)?api/, "") || "/";
  try {
    const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};
    if (req.method === "POST") {
      switch (path) {
        case "/tools/search": return await toolSearch(body);
        case "/tools/verify": return await toolVerify(body);
        case "/tools/fees": return await toolFees(body);
        case "/tools/pickup-pack": return await toolPickupPack(body);
        case "/tools/alert": return await toolAlert(body);
      }
    }
    if (req.method === "GET") {
      let m;
      if (path === "/" || path === "/health") return json({ ok: true, service: "ritrovo-api" });
      if (path === "/stats") return await stats();
      if ((m = path.match(/^\/items\/([\w-]+)$/))) {
        const item = await getItem(m[1]);
        return item ? json(itemCard(item)) : bad("unknown item", 404);
      }
      if ((m = path.match(/^\/pickup\/([\w-]+)\/delega\.pdf$/))) return await delegaPdf(m[1], url);
      if ((m = path.match(/^\/pickup\/([\w-]+)$/))) return await pickupPage(m[1], url);
    }
    return bad(`no route for ${req.method} ${path}`, 404);
  } catch (e) {
    console.error(e);
    return bad("internal error", 500);
  }
});
