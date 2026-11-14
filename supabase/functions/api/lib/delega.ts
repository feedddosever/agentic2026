// Pre-fills the official delega form (Modello 3) by drawing text over its blank lines.
// Coordinates were measured on the official PDF (A4, origin top-left in PyMuPDF; converted to pdf-lib bottom-left).
import { PDFDocument, StandardFonts, rgb } from "npm:pdf-lib@1.17.1";
import anyAscii from "npm:any-ascii@0.3.2";
import { DELEGA_PDF_B64 } from "./delega_template.ts";

const PAGE_H = 841.92;
// [x, baseline y from top] for each blank on the form
const SPOTS = {
  owner_line1: [133, 234.5],    // "Io sottoscritto/a ______"
  reperto: [142, 249.8],        // "Reperto n. ______"
  delegate_line2: [243, 249.8], // "dal Sig ______"
  owner_sign: [126, 290.8],     // "Il Proprietario: ______"
  delegate_sign: [153, 316.3],  // "La persona delegata: ______"
} as const;

function b64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** The PDF's standard font only covers Latin-1 (WinAnsi). Names in other scripts (Chinese, Cyrillic, Arabic,
 * Vietnamese...) are transliterated to Latin letters, as on a passport's machine-readable page. */
export function pdfSafe(text: string): string {
  return [...text].map((ch) => {
    const c = ch.codePointAt(0)!;
    return (c >= 0x20 && c <= 0x7e) || (c >= 0xa0 && c <= 0xff) ? ch : anyAscii(ch);
  }).join("").replace(/\s+/g, " ").trim();
}

export async function fillDelega(opts: { reperto: string; owner?: string; delegate?: string }): Promise<Uint8Array> {
  const pdf = await PDFDocument.load(b64ToBytes(DELEGA_PDF_B64));
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const page = pdf.getPages()[0];
  const draw = (text: string | undefined, [x, yTop]: readonly [number, number], size = 10) => {
    if (!text) return;
    const clean = pdfSafe(text.replace(/[^\p{L}\p{M}\p{N} .,'\-\/]/gu, "")).slice(0, 60);
    page.drawText(clean, { x, y: PAGE_H - yTop, size, font, color: rgb(0.05, 0.1, 0.45) });
  };
  draw(opts.owner, SPOTS.owner_line1);
  draw(opts.reperto, SPOTS.reperto);
  draw(opts.delegate, SPOTS.delegate_line2);
  page.drawText("Precompilato con Ritrovo – firmare a mano / pre-filled with Ritrovo – sign by hand",
    { x: 64, y: 60, size: 7, font, color: rgb(0.4, 0.4, 0.4) });
  return await pdf.save();
}
