// Exa: knowledge outside the office.
//  - findMission(country): the country's embassy/consulate in Rome with structured contacts (cached in `embassies`)
//  - otherOffices(what, where): other lost-and-found offices relevant to where the loss happened
// API: POST https://api.exa.ai/search (exa.ai/docs/reference/search). Inactive without EXA_API_KEY.
const EXA_KEY = Deno.env.get("EXA_API_KEY");
export const exaEnabled = () => !!EXA_KEY;

type ExaResult = { title?: string; url?: string; highlights?: string[]; text?: string };
type ExaResponse = { results?: ExaResult[]; output?: { content?: unknown } & Record<string, unknown>; costDollars?: unknown };

async function exaSearch(body: Record<string, unknown>): Promise<ExaResponse> {
  if (!EXA_KEY) throw new Error("EXA_API_KEY not configured");
  const r = await fetch("https://api.exa.ai/search", {
    method: "POST",
    headers: { "x-api-key": EXA_KEY, "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(45_000),
  });
  if (!r.ok) throw new Error(`Exa ${r.status}: ${(await r.text()).slice(0, 300)}`);
  return await r.json();
}

const outputContent = (r: ExaResponse) => {
  const o = r.output as Record<string, unknown> | undefined;
  return (o && typeof o === "object" && "content" in o ? o.content : o) as Record<string, unknown> | undefined;
};

export type Mission = {
  mission_name: string; address: string; phone: string; email: string; pec: string; hours: string;
  lost_passport_note: string; source_url: string;
};

/** Find the country's diplomatic mission in Rome (to Italy, consular section) with contacts. */
export async function findMission(countryEn: string): Promise<Mission | null> {
  const r = await exaSearch({
    query: `${countryEn} embassy in Rome Italy consular section contact email phone address lost passport`,
    type: "deep-lite",
    numResults: 6,
    contents: { highlights: { query: "consular section email phone address lost or stolen passport" } },
    systemPrompt:
      "Prefer the mission's own official website or the country's foreign ministry. Ignore visa agencies, " +
      "travel blogs and directories. The mission must be the one in Rome accredited to Italy (not to the Holy See).",
    outputSchema: {
      type: "object",
      properties: {
        mission_name: { type: "string", description: "Official name of the embassy or consulate in Rome" },
        address: { type: "string", description: "Street address in Rome" },
        phone: { type: "string", description: "Consular phone number" },
        email: { type: "string", description: "Consular email address, empty if not published" },
        pec: { type: "string", description: "Italian certified email (PEC), empty if not published" },
        hours: { type: "string", description: "Consular opening hours" },
        lost_passport_note: { type: "string", description: "One sentence on what a citizen should do for a lost passport" },
        source_url: { type: "string", description: "URL of the official page these contacts come from" },
      },
      required: ["mission_name", "address", "phone", "email", "pec", "hours", "lost_passport_note", "source_url"],
    },
  });
  const c = outputContent(r);
  if (!c || typeof c.mission_name !== "string" || !c.mission_name) return null;
  const s = (k: string) => (typeof c[k] === "string" ? (c[k] as string).trim().slice(0, 400) : "");
  return {
    mission_name: s("mission_name"), address: s("address"), phone: s("phone"), email: s("email"), pec: s("pec"),
    hours: s("hours"), lost_passport_note: s("lost_passport_note"),
    source_url: s("source_url") || r.results?.[0]?.url || "",
  };
}

export type Office = { name: string; when_relevant: string; contact: string; url: string };

/** Other lost-and-found offices in Rome that may hold the item, given where it was lost. */
export async function otherOffices(what: string, where: string): Promise<{ offices: Office[]; sources: string[] }> {
  const r = await exaSearch({
    query: `Rome lost and found office ufficio oggetti smarriti ${where} ${what}`.trim(),
    type: "deep-lite",
    numResults: 8,
    contents: { highlights: { query: "oggetti smarriti lost property office address phone email hours" } },
    systemPrompt:
      "List lost-property offices in Rome other than the city's Reparto Oggetti Rinvenuti that could hold an item " +
      "lost at the given place: public transport (ATAC metro/bus/tram), railway stations (Trenitalia, Italo), " +
      "airports (Fiumicino, Ciampino), taxis, the Vatican. Official sources only. Most relevant first.",
    outputSchema: {
      type: "object",
      properties: {
        offices: {
          type: "array",
          items: {
            type: "object",
            properties: {
              name: { type: "string" },
              when_relevant: { type: "string", description: "Which losses this office handles" },
              contact: { type: "string", description: "Address, phone, email or form, as published" },
              url: { type: "string" },
            },
            required: ["name", "when_relevant", "contact", "url"],
          },
        },
      },
      required: ["offices"],
    },
  });
  const c = outputContent(r);
  const offices = Array.isArray(c?.offices) ? (c!.offices as Office[]).slice(0, 5) : [];
  return { offices, sources: (r.results ?? []).map((x) => x.url ?? "").filter(Boolean).slice(0, 6) };
}
