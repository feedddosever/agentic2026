// Facts about the Reparto Oggetti Rinvenuti, Roma Capitale (Polizia Locale).
// Sources: comune.roma.it service page "Ritirare un oggetto smarrito" (INF39645) and office page (UFF103808),
// checked 13 Nov 2026. Fees: Deliberazione Giunta Capitolina n. 421 del 15/12/2023.

export const OFFICE = {
  name: "Reparto Oggetti Rinvenuti – Polizia Locale di Roma Capitale",
  address: "Circonvallazione Ostiense 191, 00154 Roma",
  map_url: "https://www.google.com/maps/search/?api=1&query=Circonvallazione+Ostiense+191+Roma",
  phone: ["+39 06 6769 3220", "+39 06 6769 3268", "+39 06 6769 3214"],
  email: "oggettismarriti@comune.roma.it",
  pec: "protocollo.polizialocale.com@pec.comune.roma.it",
  hours: {
    it: "Lun, mar, mer, ven 8:30–13:00; gio 8:30–17:00 (orario continuato). Dal 25 giugno al 10 settembre: lun–ven 8:30–13:00.",
    en: "Mon, Tue, Wed, Fri 8:30–13:00; Thu 8:30–17:00. From 25 June to 10 September: Mon–Fri 8:30–13:00.",
  },
  service_url: "https://www.comune.roma.it/web/it/scheda-servizi.page?contentId=INF39645",
};

export const FEES = { custody: 4.6, processing: 5.8, storage: 17.4, storage_after_days: 30 };

const ID_DOC = /(CARTA IDENTITA'|CARTA D'IDENTITA'|PASSAPORTO|PATENTE DI GUIDA|PERMESSO DI SOGGIORNO|DOCUMENTO DI (IDENTITA'|RICONOSCIMENTO|VIAGGIO))/;

export type FeeBreakdown = {
  currency: "EUR";
  lines: { label: string; amount: number }[];
  total: number;
  notes: string[];
  days_in_custody: number;
};

/** Fees due at pickup. Identity documents are returned free; embassies don't pay custody fees. */
export function computeFees(objects: string[], acquired: string, pickup: Date, requester: "owner" | "embassy" = "owner"): FeeBreakdown {
  const days = Math.max(0, Math.floor((pickup.getTime() - new Date(acquired + "T00:00:00Z").getTime()) / 86_400_000));
  const notes: string[] = [];
  const onlyIdDocs = objects.length > 0 && objects.every((o) => ID_DOC.test(o));
  if (onlyIdDocs) {
    notes.push("Identity documents are returned free of charge.");
    return { currency: "EUR", lines: [], total: 0, notes, days_in_custody: days };
  }
  const lines = [] as { label: string; amount: number }[];
  if (requester === "embassy") notes.push("Embassies and consulates are exempt from custody fees.");
  else lines.push({ label: "Custody fee (diritti di custodia)", amount: FEES.custody });
  lines.push({ label: "Processing and search fee (diritti di istruttoria e ricerca)", amount: FEES.processing });
  if (days > FEES.storage_after_days) lines.push({ label: `Storage fee (deposito, ${days} days > 30)`, amount: FEES.storage });
  else notes.push(`Pick up within ${FEES.storage_after_days - days} days to avoid the €${FEES.storage.toFixed(2)} storage fee.`);
  if (objects.some((o) => ID_DOC.test(o))) notes.push("Identity documents in this record are returned free; fees apply to the other objects.");
  notes.push("Payment at the office (reversale SIREWEB).");
  const total = Math.round(lines.reduce((s, l) => s + l.amount, 0) * 100) / 100;
  return { currency: "EUR", lines, total, notes, days_in_custody: days };
}

/** Art. 929 c.c.: after one year from publication an unclaimed item may go to the finder. Indicative only. */
export function claimHorizon(acquired: string): string {
  const d = new Date(acquired + "T00:00:00Z");
  d.setUTCFullYear(d.getUTCFullYear() + 1);
  return d.toISOString().slice(0, 10);
}

export function documentsToBring(language: string) {
  const en = [
    "A valid identity document of the person collecting the item.",
    "If available, the police report of loss or theft describing the item (not needed for items of no commercial value).",
    "Anything that proves the item is yours (receipts, photos, IMEI box, keys that match, contents you can describe).",
    "If someone collects on your behalf: the signed delega (pre-filled below), a copy of your ID, and their own ID.",
  ];
  const it = [
    "Documento d'identità valido di chi ritira.",
    "Se disponibile, la denuncia di smarrimento o furto con la descrizione dell'oggetto (non necessaria per oggetti senza valore commerciale).",
    "Ogni elemento utile a dimostrare la proprietà (scontrini, foto, scatola con IMEI, contenuto descrivibile).",
    "Se ritira un'altra persona: delega firmata (precompilata qui sotto), copia del documento del delegante e documento del delegato.",
  ];
  return language.startsWith("it") ? it : en;
}
