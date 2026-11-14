// Deterministic layer: intake note parser (no-LLM fallback), routing policy, message templates.
// The LLM agent proposes; this policy decides what is *required* and fills any gap.
import { OFFICE } from "./office.ts";
import { detectCountry, countryByCode } from "./countries.ts";

export type IntakeFields = {
  objects: string[];        // catalogue-style Italian object lines, numbers already masked
  colour: string;
  brand: string;
  nationality: string;      // ISO-2 of foreign identity documents, "" if none/unknown
  found_where: string;
  finder_channel: string;
  cash_eur: number;         // -1 if none
  description_en: string;
};

const OBJECT_WORDS: [RegExp, string][] = [
  [/\b(portafogli[oa]?|wallet|purse)\b/i, "PORTAFOGLI"],
  [/\b(passaporto|passport)\b/i, "PASSAPORTO"],
  [/\b(carta d'?identit[aà]|identity card|id card|carta identita)\b/i, "CARTA IDENTITA'"],
  [/\b(patente|driving licen[cs]e|driver'?s licen[cs]e)\b/i, "PATENTE DI GUIDA"],
  [/\b(tessera sanitaria|health (insurance )?card)\b/i, "TESSERA SANITARIA"],
  [/\b(permesso di soggiorno|residence permit)\b/i, "PERMESSO DI SOGGIORNO"],
  [/\b(iphone|smartphone|cellulare|telefono|phone|mobile)\b/i, "TELEFONO CELLULARE"],
  [/\b(chiavi|keys?)\b/i, "CHIAVI"],
  [/\b(zaino|backpack|rucksack)\b/i, "ZAINO"],
  [/\b(borsa|borsetta|handbag|bag)\b/i, "BORSA"],
  [/\b(pochette|clutch)\b/i, "POCHETTE"],
  [/\b(trolley|valigia|suitcase|luggage)\b/i, "TROLLEY/VALIGIA"],
  [/\b(occhiali da sole|sunglasses)\b/i, "OCCHIALE DA SOLE"],
  [/\b(occhiali|glasses|spectacles)\b/i, "OCCHIALE DA VISTA"],
  [/\b(carta di credito|credit card|visa|mastercard|amex)\b/i, "CARTA DI CREDITO"],
  [/\b(bancomat|debit card)\b/i, "BANCOMAT"],
  [/\b(laptop|pc portatile|notebook|macbook)\b/i, "PC PORTATILE"],
  [/\b(ipad|tablet)\b/i, "TABLET"],
  [/\b(cuffie|auricolar[ei]|airpods|headphones|earbuds)\b/i, "AURICOLARE"],
  [/\b(orologio|watch)\b/i, "OROLOGIO"],
  [/\b(ombrello|umbrella)\b/i, "OMBRELLO"],
  [/\b(giacca|giubbotto|cappotto|jacket|coat|felpa|sciarpa|scarf)\b/i, "INDUMENTI VARI"],
  [/\b(anello|collana|bracciale|orecchini|ring|necklace|bracelet|earrings)\b/i, "GIOIELLI"],
  [/\b(macchina fotografica|fotocamera|camera)\b/i, "MACCHINA FOTOGRAFICA"],
];
const COLOURS: [RegExp, string][] = [
  [/\b(ner[oa]|black)\b/i, "NERO"], [/\b(bianc[oa]|white)\b/i, "BIANCO"], [/\b(ross[oa]|red)\b/i, "ROSSO"],
  [/\b(blu|navy|blue)\b/i, "BLU"], [/\b(azzurr[oa]|light blue)\b/i, "AZZURRO"], [/\b(verde|green)\b/i, "VERDE"],
  [/\b(grigi[oa]|grey|gray)\b/i, "GRIGIO"], [/\b(marrone|brown|cuoio|leather)\b/i, "MARRONE"],
  [/\b(giall[oa]|yellow)\b/i, "GIALLO"], [/\b(rosa|pink)\b/i, "ROSA"], [/\b(beige)\b/i, "BEIGE"],
];
const BRANDS = ["apple", "samsung", "xiaomi", "huawei", "google pixel", "louis vuitton", "gucci", "prada", "michael kors",
  "eastpak", "samsonite", "nike", "adidas", "the north face", "ray-ban", "rolex", "swatch", "invicta", "lenovo", "hp", "dell"];
const CHANNELS: [RegExp, string][] = [
  [/\batac\b|metro|bus\b|tram/i, "ATAC"], [/trenitalia|stazione|train/i, "Trenitalia"], [/\bitalo\b/i, "Italo"],
  [/\btaxi\b/i, "taxi"], [/polizia|carabinieri|police/i, "Polizia"], [/cittadin|citizen|passer-?by/i, "cittadino"],
];

/** Mask a document/IMEI number like the official list: first 5 characters, then "* * * *". */
export const maskNumber = (n: string) => {
  const clean = n.toUpperCase().replace(/[^A-Z0-9]/g, "");
  return clean.length <= 4 ? "* * * *" : `${clean.slice(0, 5)}* * * *`;
};

// Document / card / IMEI / phone numbers: tokens of 6+ letters-and-digits with at least 3 digits
// (e.g. EL6559123, L01X00T47, 356789104455667). URLs and Ritrovo record ids are left alone.
const ID_LIKE = /\b(?=(?:[A-Z]*\d){3})[A-Z0-9]{6,24}\b/gi;
const PROTECT = /https?:\/\/\S+|\bIN-\d{6}-[A-Z0-9]{4}\b|\{VERIFY_URL\}/gi;

/** Mask every identifier-like token in free text (operator notes, model output, message bodies). */
// Cash amounts are an ownership secret: the official list writes "DENARO EURO" with no amount, and the office asks
// the claimant how much was inside. Public text never carries an amount.
const MONEY = /(?:€|\$|£)\s*\d+(?:[.,]\d{1,2})?|\b\d+(?:[.,]\d{1,2})?\s*(?:€|euros?|eur|dollars?|dollari|usd|pounds?|sterline|gbp)\b/gi;
export function maskMoney(s: string): string {
  return s.replace(MONEY, "cash").replace(/\bcash(\s+in)?\s+cash\b/gi, "cash");
}
/** "DENARO EURO 40" -> "DENARO EURO" (any money object loses its amount). */
export function stripCashAmount(o: string): string {
  return o.startsWith("DENARO") ? o.replace(/\s*[-:]?\s*\d[\d.,]*\s*$/, "").replace(/\s+\d[\d.,]*(?=\s)/g, "").trim() : o;
}
/** Canonical form of a stated cash amount for hashing: "40", "40,50" -> "40.5". */
export function cashKey(v: unknown): string | null {
  const n = typeof v === "number" ? v : Number(String(v ?? "").replace(",", ".").replace(/[^\d.-]/g, ""));
  return Number.isFinite(n) && n > 0 ? String(Math.round(n * 100) / 100) : null;
}

/** Full ID-like numbers in a raw note. Used only to derive salted ownership checks; never stored or logged. */
export function idTokens(s: string): string[] {
  return [...s.replace(PROTECT, " ").matchAll(ID_LIKE)].map((m) => m[0].toUpperCase());
}

/** The secret part of a number: its last four characters, when they don't overlap the published first five. */
export function secretSuffix(token: string): string | null {
  const clean = token.toUpperCase().replace(/[^A-Z0-9]/g, "");
  return clean.length >= 9 ? clean.slice(-4) : null;
}

export function maskIds(s: string): string {
  const kept: string[] = [];
  const shielded = s.replace(PROTECT, (m) => { kept.push(m); return `\u0000${kept.length - 1}\u0000`; });
  return shielded.replace(ID_LIKE, (m) => maskNumber(m)).replace(/\u0000(\d+)\u0000/g, (_, i) => kept[Number(i)]);
}

export function parseNote(note: string, foundWhere = "", finderChannel = ""): IntakeFields {
  const text = `${note} ${foundWhere}`;
  const country = detectCountry(note);
  const foreign = !!country && country.code !== "IT";
  const numbers = [...note.replace(PROTECT, " ").matchAll(ID_LIKE)].map((m) => m[0]);
  let numIdx = 0;
  const objects: string[] = [];
  for (const [re, label] of OBJECT_WORDS) {
    if (!re.test(text) || objects.some((o) => o.startsWith(label))) continue;
    let line = label;
    if (["PASSAPORTO", "CARTA IDENTITA'", "PATENTE DI GUIDA", "TESSERA SANITARIA"].includes(label) && foreign) {
      line += label === "PASSAPORTO" ? " ESTERO" : " ESTERA";
    }
    if (["PASSAPORTO", "CARTA IDENTITA'", "PATENTE DI GUIDA"].includes(label) && numbers[numIdx]) {
      line += ` - Nr: ${maskNumber(numbers[numIdx++])}`;
    }
    objects.push(line);
  }
  const cash = note.match(/(\d+(?:[.,]\d{1,2})?)\s*(€|euro|eur)\b/i) ?? note.match(/€\s*(\d+(?:[.,]\d{1,2})?)/);
  if (cash && !objects.some((o) => o.startsWith("DENARO"))) objects.push("DENARO EURO");
  const brand = BRANDS.find((b) => text.toLowerCase().includes(b)) ?? "";
  return {
    objects: objects.length ? objects : ["ALTRO (Oggettistica)"],
    colour: COLOURS.find(([re]) => re.test(note))?.[1] ?? "",
    brand: brand.toUpperCase(),
    nationality: foreign ? country!.code : "",
    found_where: foundWhere || (note.match(/\b(?:a|at|in|presso|near)\s+([A-Z][\w' ]{2,40})/)?.[1] ?? ""),
    finder_channel: finderChannel || CHANNELS.find(([re]) => re.test(note))?.[1] || "",
    cash_eur: cash ? Number(cash[1].replace(",", ".")) : -1,
    description_en: maskMoney(maskIds(note)).slice(0, 300),
  };
}

// ---------- routing policy ----------

export type ItemForRouting = {
  id: string; objects: string[]; id_doc: string; nationality: string | null; date_acquired: string;
};
export type RequiredChannel =
  | { channel: "app_io"; reason: string }
  | { channel: "embassy"; country_code: string; reason: string };

export function requiredChannels(item: ItemForRouting): { required: RequiredChannel[]; hold_reason: string | null } {
  const required: RequiredChannel[] = [];
  let hold: string | null = null;
  if (item.id_doc === "italian" || item.id_doc === "mixed") {
    required.push({ channel: "app_io", reason: "Italian identity document: the holder can be identified and notified through App IO." });
  }
  if (item.id_doc === "foreign" || item.id_doc === "mixed") {
    if (item.nationality) {
      required.push({ channel: "embassy", country_code: item.nationality, reason: `Foreign identity document (${item.nationality}): the consulate is informed, as the office already does by hand.` });
    } else {
      hold = "Foreign identity document of unknown nationality: operator to check the issuing country.";
    }
  }
  if (!required.length && !hold) hold = "No identity document: kept in custody, searchable, and matched against citizens' alerts.";
  return { required, hold_reason: hold };
}

// ---------- templates (used when the LLM is unavailable or skipped a required channel) ----------

const recordLabel = (id: string) => (id.startsWith("IN-") ? id : `${id.split("-")[1]}/${id.split("-")[0]}`);
const objectsList = (objs: string[]) => objs.map((o) => `• ${o}`).join("\n");

export function templateAppIo(item: ItemForRouting, pickupUrl: string) {
  return {
    channel: "app_io" as const,
    recipient_label: "Titolare del documento (notifica App IO)",
    language: "it",
    subject: "Un tuo documento è stato ritrovato",
    body:
      `Gentile cittadina/o,\nil Reparto Oggetti Rinvenuti di Roma Capitale custodisce un oggetto che contiene un tuo documento ` +
      `(reperto ${recordLabel(item.id)}, acquisito il ${item.date_acquired}):\n${objectsList(item.objects)}\n\n` +
      `Puoi ritirarlo in ${OFFICE.address}. Orari: ${OFFICE.hours.it}\nI documenti d'identità sono restituiti gratuitamente.\n` +
      `Istruzioni e delega precompilata: ${pickupUrl}\n\n` +
      `Ritrovo non ti chiederà mai pagamenti online né dati bancari. Verifica l'autenticità di questo messaggio: {VERIFY_URL}`,
  };
}

export function templateEmbassy(item: ItemForRouting, countryCode: string, missionName: string | null, pickupUrl: string) {
  const c = countryByCode(countryCode);
  const recipient = missionName ?? `Consular section of ${c?.en ?? countryCode} in Rome`;
  return {
    channel: "embassy" as const,
    recipient_label: recipient,
    language: "en",
    subject: `Found property of a ${c?.en ?? countryCode} citizen – Roma Capitale lost and found, record ${recordLabel(item.id)}`,
    body:
      `Dear Consular Section,\n\nRome's lost-and-found office (Reparto Oggetti Rinvenuti, Polizia Locale di Roma Capitale) ` +
      `holds an item containing an identity document apparently issued by ${c?.en ?? countryCode} ` +
      `(record ${recordLabel(item.id)}, received ${item.date_acquired}):\n${objectsList(item.objects)}\n\n` +
      `Document numbers are masked as in the public list. We would be grateful if you could inform the holder. ` +
      `Embassies and consulates are exempt from custody fees; identity documents are returned free of charge.\n` +
      `Office: ${OFFICE.address} – ${OFFICE.phone.join(", ")} – ${OFFICE.email}. Hours: ${OFFICE.hours.en}\n` +
      `Pickup information: ${pickupUrl}\nVerify this message: {VERIFY_URL}\n\n` +
      `— Gentile Sezione Consolare, il Reparto Oggetti Rinvenuti di Roma Capitale custodisce il reperto ${recordLabel(item.id)} ` +
      `contenente un documento del vostro Paese. Vi preghiamo di informarne il titolare.`,
  };
}

export function templateAlertMatch(item: ItemForRouting, language: string, pickupUrl: string, channel: "sms" | "email" | "call") {
  const it = language.startsWith("it");
  return {
    channel,
    recipient_label: "Citizen who filed the alert",
    language: it ? "it" : "en",
    subject: it ? "Potrebbe essere il tuo oggetto" : "We may have found your item",
    body: it
      ? `Buone notizie: un oggetto compatibile con la tua segnalazione è arrivato al Reparto Oggetti Rinvenuti di Roma ` +
        `(reperto ${recordLabel(item.id)}, ${item.date_acquired}): ${item.objects.join("; ")}.\nDettagli e ritiro: ${pickupUrl}\n` +
        `Verifica questo messaggio: {VERIFY_URL}`
      : `Good news: an item matching your alert reached Rome's lost-and-found office (record ${recordLabel(item.id)}, ` +
        `${item.date_acquired}): ${item.objects.join("; ")}.\nDetails and pickup: ${pickupUrl}\nVerify this message: {VERIFY_URL}`,
  };
}
