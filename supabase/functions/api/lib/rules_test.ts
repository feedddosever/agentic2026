import { assertEquals, assert } from "jsr:@std/assert@1.0.13";
import { parseNote, maskNumber, requiredChannels } from "./rules.ts";
import { detectCountry } from "./countries.ts";
import { computeFees } from "./office.ts";

Deno.test("masks numbers like the official list", () => {
  assertEquals(maskNumber("EL6551234"), "EL655* * * *");
  assertEquals(maskNumber("12"), "* * * *");
});

Deno.test("parses an Italian operator note with a foreign passport and cash", () => {
  const f = parseNote("Portafoglio nero con passaporto americano EL6551234 e 40 euro, consegnato da ATAC", "Termini");
  assert(f.objects.includes("PORTAFOGLI"));
  assert(f.objects.some((o) => o.startsWith("PASSAPORTO ESTERO - Nr: EL655* * * *")));
  assert(f.objects.some((o) => o.startsWith("DENARO EURO 40")));
  assertEquals(f.nationality, "US");
  assertEquals(f.colour, "NERO");
  assertEquals(f.finder_channel, "ATAC");
  assertEquals(f.cash_eur, 40);
  assert(!JSON.stringify(f.objects).includes("EL6551234"), "full number must never be stored");
});

Deno.test("parses an English note", () => {
  const f = parseNote("Black Samsonite backpack with a Japanese passport, found on bus 64");
  assert(f.objects.includes("ZAINO"));
  assert(f.objects.includes("PASSAPORTO ESTERO"));
  assertEquals(f.nationality, "JP");
  assertEquals(f.brand, "SAMSONITE");
});

Deno.test("detects countries without false positives on 'us' inside words", () => {
  assertEquals(detectCountry("a bus ticket")?.code ?? null, null);
  assertEquals(detectCountry("US passport")?.code, "US");
});

Deno.test("routing policy", () => {
  const base = { id: "IN-1", objects: [], date_acquired: "2026-11-13", nationality: null };
  assertEquals(requiredChannels({ ...base, id_doc: "italian" }).required.map((r) => r.channel), ["app_io"]);
  assertEquals(requiredChannels({ ...base, id_doc: "foreign", nationality: "FR" }).required.map((r) => r.channel), ["embassy"]);
  assert(requiredChannels({ ...base, id_doc: "foreign" }).hold_reason?.includes("unknown nationality"));
  assertEquals(requiredChannels({ ...base, id_doc: "mixed", nationality: "DE" }).required.length, 2);
  assert(requiredChannels({ ...base, id_doc: "none" }).hold_reason);
});

Deno.test("fees: documents free, storage after 30 days, embassy exempt from custody", () => {
  assertEquals(computeFees(["PASSAPORTO ESTERO - Nr: X* *"], "2026-01-01", new Date("2026-11-01")).total, 0);
  assertEquals(computeFees(["ZAINO"], "2026-11-01", new Date("2026-11-10")).total, 10.4);
  assertEquals(computeFees(["ZAINO"], "2026-01-01", new Date("2026-11-10")).total, 27.8);
  assertEquals(computeFees(["ZAINO"], "2026-11-01", new Date("2026-11-10"), "embassy").total, 5.8);
});

Deno.test("description never contains a full document number", () => {
  const f = parseNote("Passaporto americano EL6559123 trovato");
  assert(!f.description_en.includes("EL6559123"));
  assert(f.description_en.includes("EL655* * * *"));
});

import { normObject, prefixesOf, idDocKind } from "./engine.ts";
Deno.test("model output is normalised to the catalogue spelling", () => {
  const objs = ["Carta d'identità estera - NR: 23AB4* * * *", "telefono cellulare - imei: 35366* * * *"].map(normObject);
  assertEquals(objs[0], "CARTA IDENTITA' ESTERA - Nr: 23AB4* * * *");
  assertEquals(prefixesOf(objs), ["23AB4", "35366"]);
  assertEquals(idDocKind(objs), "foreign");
});
