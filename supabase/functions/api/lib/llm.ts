// Claude calls: intake understanding (vision + structured output) and a generic tool-use loop.
// Both return null when ANTHROPIC_API_KEY is missing, so callers fall back to the rule layer.
import Anthropic from "npm:@anthropic-ai/sdk@1.3.0";

const KEY = Deno.env.get("ANTHROPIC_API_KEY");
export const MODEL = Deno.env.get("CLAUDE_MODEL") ?? "claude-opus-5-5";
const EFFORT = (Deno.env.get("CLAUDE_EFFORT") ?? "low") as "low" | "medium" | "high";
export const llmEnabled = () => !!KEY;
const client = KEY ? new Anthropic({ apiKey: KEY, maxRetries: 2, timeout: 90_000 }) : null;

// Server-side fallback on refusals (routes by refusal category; no model list to maintain).
const FALLBACK = { betas: ["server-side-fallback-2026-07-01"] as Anthropic.Beta.AnthropicBeta[], fallbacks: "default" as const };

const INTAKE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    objects: {
      type: "array",
      items: { type: "string" },
      description:
        "One line per object in the style of Rome's official found-items list: Italian, UPPERCASE, e.g. " +
        "\"PORTAFOGLI\", \"PASSAPORTO ESTERO - Nr: EL655* * * *\", \"CARTA DI CREDITO ESTERA VISA\", " +
        "\"TELEFONO CELLULARE - APPLE IPHONE\", \"DENARO EURO 40\". For identity documents add ESTERO/ESTERA when not Italian. " +
        "Use the register's exact spellings: CARTA IDENTITA' (never CARTA D'IDENTITA'), PATENTE DI GUIDA, TESSERA SANITARIA, " +
        "PASSAPORTO, PERMESSO DI SOGGIORNO, with ESTERO/ESTERA for foreign ones, and numbers written as \" - Nr: XXXXX* * * *\" " +
        "(IMEI as \" - IMEI: XXXXX* * * *\"): keep only the first 5 characters followed by \"* * * *\".",
    },
    colour: { type: "string", description: "Main colour in Italian uppercase (NERO, MARRONE...) or empty" },
    brand: { type: "string", description: "Brand in uppercase or empty" },
    nationality: { type: "string", description: "ISO 3166-1 alpha-2 code of the country that issued foreign identity documents; empty if none, Italian, or unknown" },
    found_where: { type: "string", description: "Where it was found, if stated" },
    finder_channel: { type: "string", description: "Who handed it in: cittadino, ATAC, Trenitalia, Italo, taxi, Polizia, altro, or empty" },
    cash_eur: { type: "number", description: "Cash amount in euro if any banknotes/coins are visible or stated, else -1" },
    description_en: { type: "string", description: "One neutral English sentence describing the item(s), without any personal data" },
  },
  required: ["objects", "colour", "brand", "nationality", "found_where", "finder_channel", "cash_eur", "description_en"],
};

export type LlmIntake = {
  objects: string[]; colour: string; brand: string; nationality: string; found_where: string;
  finder_channel: string; cash_eur: number; description_en: string;
};

export async function understandIntake(input: { photo_b64?: string; media_type?: string; note: string; found_where?: string; finder_channel?: string }): Promise<{ fields: LlmIntake; model: string } | null> {
  if (!client) return null;
  const content: Anthropic.Beta.BetaContentBlockParam[] = [];
  if (input.photo_b64) {
    content.push({ type: "image", source: { type: "base64", media_type: (input.media_type ?? "image/jpeg") as "image/jpeg", data: input.photo_b64 } });
  }
  content.push({
    type: "text",
    text:
      "You help the staff of Rome's lost-and-found office (Reparto Oggetti Rinvenuti) register a newly handed-in item.\n" +
      "Describe what is in the photo and the operator's note as structured fields for the office register. " +
      "Never output full names, addresses, full document/card numbers or other personal data: numbers are masked as instructed.\n\n" +
      `Operator note: ${input.note || "(none)"}\nFound where: ${input.found_where || "(not stated)"}\nHanded in by: ${input.finder_channel || "(not stated)"}`,
  });
  const res = await client.beta.messages.create({
    model: MODEL,
    max_tokens: 16000,
    ...FALLBACK,
    output_config: { effort: EFFORT, format: { type: "json_schema", schema: INTAKE_SCHEMA } },
    messages: [{ role: "user", content }],
  });
  if (res.stop_reason === "refusal") throw new Error(`refusal: ${res.stop_details?.category ?? "unknown"}`);
  const text = res.content.find((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")?.text;
  if (!text) throw new Error(`no text output (stop_reason ${res.stop_reason})`);
  const f = JSON.parse(text) as LlmIntake;
  if (!Array.isArray(f.objects)) throw new Error("invalid intake output");
  return { fields: f, model: res.model };
}

// ---------- generic tool loop ----------

export type ToolSpec = {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
  run: (input: Record<string, unknown>) => Promise<unknown>;
};
export type Step = { tool: string; input: unknown; output: unknown; ms: number };

/** Manual agentic loop (strict tools, server-side refusal fallback). Returns the final text and the tool trace. */
const TERMS_SCHEMA = {
  type: "object", additionalProperties: false, required: ["items"],
  properties: {
    items: {
      type: "array",
      items: {
        type: "object", additionalProperties: false, required: ["it", "en", "es", "fr", "de", "zh"],
        properties: { it: { type: "string" }, en: { type: "string" }, es: { type: "string" }, fr: { type: "string" }, de: { type: "string" }, zh: { type: "string" } },
      },
    },
  },
};

/** Translate object names from the official Italian register into short labels for tourists. */
export async function translateLabels(labels: string[]): Promise<{ it: string; en: string; es: string; fr: string; de: string; zh: string }[]> {
  if (!client) throw new Error("ANTHROPIC_API_KEY not configured");
  const res = await client.beta.messages.create({
    model: MODEL, max_tokens: 16000, ...FALLBACK,
    output_config: { effort: EFFORT, format: { type: "json_schema", schema: TERMS_SCHEMA } },
    messages: [{
      role: "user",
      content:
        "These are object names from the register of Rome's lost-and-found office (Italian, upper case). Translate each " +
        "into English (en), Spanish (es), French (fr), German (de) and Simplified Chinese (zh) as a short label a tourist " +
        "would understand, in sentence case. Keep brand names, bank names and card networks as they are (VISA, APPLE, " +
        "INTESA SAN PAOLO...). ESTERO/ESTERA = foreign, ITA/ITALIANA = Italian, VARIE/VARI = various, " +
        "ALTRO (Oggettistica) = Other (objects). Examples: PORTAFOGLI → Wallet; CARTA DI CREDITO ESTERA VISA → Foreign VISA " +
        "credit card; PATENTE DI GUIDA ESTERA → Foreign driving licence; OCCHIALE DA SOLE → Sunglasses. Return every input " +
        "label exactly as given in \"it\", in the same order.\n\n" + labels.map((l) => `- ${l}`).join("\n"),
    }],
  });
  if (res.stop_reason === "refusal") throw new Error("refusal");
  const text = res.content.find((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")?.text;
  if (!text) throw new Error(`no text output (stop_reason ${res.stop_reason})`);
  return (JSON.parse(text) as { items: { it: string; en: string; es: string; fr: string; de: string; zh: string }[] }).items;
}

const QUERY_SCHEMA = {
  type: "object", additionalProperties: false, required: ["terms"],
  properties: { terms: { type: "array", items: { type: "string" } } },
};

/** A search typed in any language -> the Italian words Rome's lost-and-found register uses (fast model). */
export async function translateQuery(q: string): Promise<string[]> {
  if (!client) return [];
  const ask = (model: string) => client!.beta.messages.create({
    model, max_tokens: 400, ...FALLBACK,
    output_config: { effort: "low", format: { type: "json_schema", schema: QUERY_SCHEMA } },
    messages: [{
      role: "user",
      content: "Someone searched Rome's lost-and-found register, which lists objects in Italian (e.g. PORTAFOGLI, " +
        "ZAINO, BORSA, CHIAVI, PASSAPORTO, TELEFONO CELLULARE, OCCHIALE DA SOLE, OMBRELLO, TROLLEY/VALIGIA, CARTA DI " +
        "CREDITO, PATENTE DI GUIDA, CARTA IDENTITA'). Translate their search into the 1-4 Italian words the register " +
        "would use: the object type, plus a colour or brand if they gave one. Lower case, no articles.\n\nSearch: " +
        JSON.stringify(q.slice(0, 200)),
    }],
  });
  let res;
  try { res = await ask(Deno.env.get("CLAUDE_FAST_MODEL") ?? "claude-haiku-5-5"); } catch { res = await ask(MODEL); }
  const text = res.content.find((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")?.text;
  if (!text) return [];
  return ((JSON.parse(text) as { terms: string[] }).terms ?? []).map((t) => t.toLowerCase().trim()).filter((t) => t && t.length <= 40).slice(0, 4);
}

export async function runToolLoop(opts: { system: string; user: string; tools: ToolSpec[]; maxTurns?: number; stopAfter?: string }): Promise<{ text: string; steps: Step[]; model: string } | null> {
  if (!client) return null;
  const tools: Anthropic.Beta.BetaTool[] = opts.tools.map((t) => ({
    name: t.name, description: t.description, input_schema: t.input_schema as Anthropic.Beta.BetaTool.InputSchema, strict: true,
  }));
  const messages: Anthropic.Beta.BetaMessageParam[] = [{ role: "user", content: opts.user }];
  const steps: Step[] = [];
  let model = MODEL;
  for (let turn = 0; turn < (opts.maxTurns ?? 10); turn++) {
    const res = await client.beta.messages.create({
      model: MODEL, max_tokens: 16000, ...FALLBACK,
      output_config: { effort: EFFORT },
      system: opts.system, tools, messages,
    });
    model = res.model;
    if (res.stop_reason === "refusal") throw new Error(`refusal: ${res.stop_details?.category ?? "unknown"}`);
    messages.push({ role: "assistant", content: res.content });
    if (res.stop_reason === "pause_turn") continue;
    const uses = res.content.filter((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === "tool_use");
    if (res.stop_reason !== "tool_use" || !uses.length) {
      const text = res.content.filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text").map((b) => b.text).join("\n");
      return { text, steps, model };
    }
    const results: Anthropic.Beta.BetaToolResultBlockParam[] = [];
    for (const u of uses) {
      const spec = opts.tools.find((t) => t.name === u.name);
      const t0 = Date.now();
      try {
        if (!spec) throw new Error(`unknown tool ${u.name}`);
        const out = await spec.run((u.input ?? {}) as Record<string, unknown>);
        steps.push({ tool: u.name, input: u.input, output: out, ms: Date.now() - t0 });
        results.push({ type: "tool_result", tool_use_id: u.id, content: JSON.stringify(out) });
      } catch (e) {
        const msg = String((e as Error).message ?? e);
        steps.push({ tool: u.name, input: u.input, output: { error: msg }, ms: Date.now() - t0 });
        results.push({ type: "tool_result", tool_use_id: u.id, content: msg, is_error: true });
      }
    }
    // The agent's work is done once its closing tool has run: skip the extra model turn.
    if (opts.stopAfter && uses.some((u) => u.name === opts.stopAfter)) return { text: "", steps, model };
    messages.push({ role: "user", content: results });
  }
  return { text: "(stopped: turn limit)", steps, model };
}
