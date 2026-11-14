// Translations of the register's object names (table object_terms, built once with Claude from the top labels).
// Two uses: show tourists "Wallet" next to "PORTAFOGLI", and turn a search typed in English, Spanish, French,
// German or Chinese into the Italian catalogue terms the search understands.
import type { SupabaseClient } from "npm:@supabase/supabase-js@2.49.4";

export const UI_LANGS = ["en", "es", "fr", "de", "zh"] as const;
type Lang = typeof UI_LANGS[number];
type Row = { it: string } & Record<Lang, string> & { n: number };

let cache: { at: number; rows: Row[]; byIt: Map<string, Row>; itVocab: Set<string> } | null = null;
export async function ensureTerms(db: SupabaseClient) {
  if (cache && Date.now() - cache.at < 600_000) return;
  const { data } = await db.from("object_terms").select("it, en, es, fr, de, zh, n");
  const rows = (data ?? []) as Row[];
  // Italian words of the register, minus anything that also appears in the English labels (brands and loanwords
  // such as PHONE, CARD, CREDIT, IPHONE), which still need translating to the Italian object type.
  const enVocab = new Set(rows.flatMap((r) => norm(r.en ?? "").split(/[^a-z0-9]+/)));
  const itVocab = new Set(rows.flatMap((r) => norm(r.it).split(/[^a-z0-9]+/).filter((w) => w.length >= 3 && !enVocab.has(w))));
  cache = { at: Date.now(), rows, byIt: new Map(rows.map((r) => [r.it, r])), itVocab };
}

const NO: Record<Lang, string> = { en: "No.", es: "N.º", fr: "N°", de: "Nr.", zh: "号码" };
const norm = (s: string) => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();

/** "PASSAPORTO ESTERO - NR: EL655* * * *" -> "Foreign passport – No. EL655* * * *" (null if unknown). */
export function translateObject(o: string, lang: string): string | null {
  if (!cache || !(UI_LANGS as readonly string[]).includes(lang)) return null;
  const l = lang as Lang;
  const m = o.match(/^(.*?)\s*-\s*(NR|IMEI|N\.)\s*:?\s*(.*)$/i);
  const base = (m ? m[1] : o).replace(/\s*-\s*$/, "").replace(/\s+/g, " ").trim();
  let t = cache.byIt.get(base)?.[l] ?? null;
  if (!t && base.includes(" - ")) {
    // Long tail: translate the generic head ("TELEFONO CELLULARE SENZA SIM") and keep the brand/model part.
    const [head, ...rest] = base.split(" - ");
    const h = cache.byIt.get(head.trim())?.[l];
    if (h) t = `${h} – ${rest.join(" - ")}`;
  }
  if (!t) return null;
  if (!m) return t;
  const label = m[2].toUpperCase() === "IMEI" ? "IMEI" : NO[l];
  return `${t} – ${label} ${m[3]}`.trim();
}

const STOP = new Set(["ESTERA", "ESTERO", "ESTERE", "ITA", "ITALIANA", "ITALIANE", "ITALIANO", "VARIE", "VARI", "CON", "SENZA", "DEI", "DEL", "DELLA", "DELLE", "PER", "ALTRO"]);
const COLOURS: Record<string, string[]> = {
  nero: ["black", "negro", "negra", "noir", "noire", "schwarz", "黑"], bianco: ["white", "blanco", "blanca", "blanc", "blanche", "weiss", "weiß", "白"],
  rosso: ["red", "rojo", "roja", "rouge", "rot", "红"], blu: ["blue", "azul", "bleu", "blau", "蓝"], verde: ["green", "vert", "grun", "grün", "绿"],
  marrone: ["brown", "marron", "braun", "棕"], grigio: ["grey", "gray", "gris", "grau", "灰"], giallo: ["yellow", "amarillo", "jaune", "gelb", "黄"],
  rosa: ["pink", "rose", "粉"], viola: ["purple", "morado", "violet", "lila", "紫"], arancione: ["orange", "naranja", "橙"],
  argento: ["silver", "plata", "argent", "silber", "银"], oro: ["gold", "or", "金"], beige: ["beige"],
};

/** Add the Italian catalogue words for a query typed in another language. Returns the expanded query and the
 * words added (shown to the user as "also searched for"). Italian queries come back unchanged. */
export function expandQuery(q: string): { q: string; added: string[] } {
  if (!cache || !q.trim()) return { q, added: [] };
  const nq = norm(q);
  const allTokens = nq.split(/[^a-z0-9]+/).filter((t) => t.length >= 3);
  // Only words the Italian catalogue doesn't already know need translating ("iphone", "zaino" stay as they are).
  const itVariants = new Set<string>();
  const tokens = allTokens.filter((t) => {
    if (cache!.itVocab.has(t)) return false;
    // Italian singular/plural ("portafoglio" -> PORTAFOGLI, "zaini" -> ZAINO): use the register's form.
    if (t.length >= 5) {
      for (const v of cache!.itVocab) {
        if (v.length >= 5 && Math.abs(v.length - t.length) <= 2 && (t.startsWith(v) || v.startsWith(t.slice(0, -1)))) { itVariants.add(v); return false; }
      }
    }
    return true;
  });
  const cjk = (q.match(/[\u3400-\u9fff]+/g) ?? []).join("");
  const added = new Set<string>(itVariants);
  for (const [it, words] of Object.entries(COLOURS)) {
    if (words.some((w) => tokens.includes(norm(w)) || (/[\u3400-\u9fff]/.test(w) && cjk.includes(w)))) added.add(it);
  }
  const colourWords = new Set(Object.values(COLOURS).flat().map(norm));
  const objectTokens = tokens.filter((t) => !colourWords.has(t));
  const phrase = objectTokens.join(" ");
  let best: { row: Row; hits: number; exact: boolean } | null = null;
  if (objectTokens.length || cjk) {
    for (const row of cache.rows) {
      let hits = 0;
      // A label whose translation IS the search ("bag" -> BORSA "Bag") beats one that merely contains it ("Clutch bag").
      const exact = (!!phrase && UI_LANGS.some((l) => l !== "zh" && norm(row[l] ?? "").replace(/[^a-z0-9]+/g, " ").trim() === phrase)) ||
        (!!cjk && (row.zh === cjk || (row.zh ?? "").replace(/^外国/, "") === cjk));
      for (const t of objectTokens) {
        if (UI_LANGS.some((l) => l !== "zh" && norm(row[l] ?? "").split(/[^a-z0-9]+/).some((w) => w.length >= 3 && (w === t || w.startsWith(t) || (w.length >= 5 && t.startsWith(w) && t.length - w.length <= 2))))) hits++;
      }
      if (cjk) {
        const zh = (row.zh ?? "").replace(/^外国/, "");
        if (zh.length >= 2 && (cjk.includes(zh) || zh.includes(cjk))) hits++;
      }
      if (!hits) continue;
      // Exact translation first, then most query words matched, then the most common label, then the shortest.
      const better = !best || (exact && !best.exact) || (exact === best.exact && (hits > best.hits || (hits === best.hits && (row.n > best.row.n || (row.n === best.row.n && row.it.length < best.row.it.length)))));
      if (better) best = { row, hits, exact };
    }
  }
  if (best) {
    // Brand, bank and card-network names are kept untranslated, so a word also found in the English label is a
    // name, not an object type: don't add it (it would pull in unrelated items of that brand).
    const enWords = new Set(norm(best.row.en ?? "").split(/[^a-z0-9]+/));
    for (const w of norm(best.row.it).split(/[^a-z0-9']+/)) {
      if (w.length >= 3 && !STOP.has(w.toUpperCase()) && !enWords.has(w)) added.add(w);
    }
  }
  for (const w of [...added]) if (allTokens.includes(w)) added.delete(w);
  return added.size ? { q: `${q} ${[...added].join(" ")}`, added: [...added] } : { q, added: [] };
}
