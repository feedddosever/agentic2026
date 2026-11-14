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
  assert(f.objects.includes("DENARO EURO"), "money is listed without its amount, as in the official list");
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

import { maskIds } from "./rules.ts";
Deno.test("masks alphanumeric ids, IMEIs and phones but not words, dates, links or record ids", () => {
  const s = maskIds("Carta d'identita tedesca numero L01X00T47, IMEI 356789104455667, tel 3331234567, bus 64, " +
    "13/11/2026, 40 euro, record IN-261113-D572, https://x.app/verify/4612b5cc-269a-4fc1-9a88-61db89bed6c8 {VERIFY_URL}");
  assert(!s.includes("L01X00T47") && s.includes("L01X0* * * *"));
  assert(!s.includes("356789104455667") && !s.includes("3331234567"));
  for (const keep of ["bus 64", "13/11/2026", "40 euro", "IN-261113-D572", "4612b5cc-269a-4fc1-9a88-61db89bed6c8", "{VERIFY_URL}", "tedesca"]) {
    assert(s.includes(keep), keep);
  }
});

Deno.test("parser takes an alphanumeric document number as the ownership prefix", () => {
  const f = parseNote("Portafoglio con carta d'identita tedesca L01X00T47");
  assert(f.objects.some((o) => o === "CARTA IDENTITA' ESTERA - Nr: L01X0* * * *"), JSON.stringify(f.objects));
  assertEquals(f.nationality, "DE");
});

import { romeDate } from "./office.ts";
Deno.test("dates follow Rome time, not UTC", () => {
  assertEquals(romeDate(new Date("2026-11-13T23:30:00Z")), "2026-11-14");
  assertEquals(romeDate(new Date("2026-11-13T22:59:00Z")), "2026-11-13");
  assertEquals(romeDate(new Date("2026-07-01T22:00:00Z")), "2026-07-02");
});

import { idTokens, secretSuffix } from "./rules.ts";
Deno.test("ownership secrets come from the unpublished last four characters only", () => {
  assertEquals(idTokens("Passaporto ZR4827316, IMEI 356789104455667, record IN-261113-342D, bus 64"), ["ZR4827316", "356789104455667"]);
  assertEquals(secretSuffix("ZR4827316"), "7316");
  assertEquals(secretSuffix("AB1234"), null, "short numbers would overlap the published prefix");
});

import { recordLeaf, foldProof, toHex } from "./proof.ts";
Deno.test("record proofs match the Python tree builder (pipeline/load_supabase.py)", async () => {
  const root = "0x7fd08dd90636251dba33349ab5b506735f0d3174bbe85a6919ccab1659af7428";
  const r0 = { id: "2026-1", date: "2026-01-02", objects: ["PORTAFOGLI", "PASSAPORTO ESTERO - Nr: ZR482* * * *"] };
  const r2 = { id: "2026-3", date: "2026-01-03", objects: ["CARTA IDENTITA' ESTERA - Nr: 5813* * * *"] };
  assertEquals(toHex(await foldProof(await recordLeaf(r0), [
    "0x3a9f43fc920a50c157028eee99e53c125171e6d22307a349530943b59e3e806f",
    "0x45cb0e696ee5f8ff7b3de7e8c39aad917e749f02a630e5c76de9f7d2961cdcd5"])), root);
  assertEquals(toHex(await foldProof(await recordLeaf(r2), [
    "0x536f263f5aecbb3b3ff19cffe84f67b604f3cb37b9a768542553ae8f6ea62f12",
    "0x717049c99b4fff7d929a45e64c9e93f5ec5b15a4038b54ce8c4b5d0c38bdb54d"])), root);
  // A changed record no longer proves.
  assert(toHex(await foldProof(await recordLeaf({ ...r0, objects: ["PORTAFOGLI"] }), [
    "0x3a9f43fc920a50c157028eee99e53c125171e6d22307a349530943b59e3e806f",
    "0x45cb0e696ee5f8ff7b3de7e8c39aad917e749f02a630e5c76de9f7d2961cdcd5"])) !== root);
});

import { maskMoney, stripCashAmount, cashKey } from "./rules.ts";
Deno.test("cash amounts never reach public text; they become a private ownership question", () => {
  assertEquals(stripCashAmount("DENARO EURO 40"), "DENARO EURO");
  assertEquals(stripCashAmount("DENARO DOLLARO STATUNITENSE 120.50"), "DENARO DOLLARO STATUNITENSE");
  assertEquals(stripCashAmount("PORTAFOGLI"), "PORTAFOGLI");
  assertEquals(maskMoney("A black wallet with a US passport and 40 euros in cash."), "A black wallet with a US passport and cash.");
  assertEquals(maskMoney("Wallet with €35 and a card"), "Wallet with cash and a card");
  assert(!/\d/.test(maskMoney("200 dollars and 20 euro")));
  assertEquals(maskMoney("A black wallet containing two 20-euro banknotes, found with a passport."), "A black wallet containing cash, found with a passport.");
  assertEquals(maskMoney("a 50 euro note and 3 coins"), "cash and 3 coins");
  assertEquals(cashKey("40"), "40"); assertEquals(cashKey("40,50 €"), "40.5"); assertEquals(cashKey(""), null); assertEquals(cashKey(-1), null);
  const f = parseNote("Portafoglio con 40 euro e passaporto americano ZR4827316");
  assert(!JSON.stringify(f.objects).includes("40") && !f.description_en.includes("40"), JSON.stringify(f));
  assertEquals(f.cash_eur, 40);
});
