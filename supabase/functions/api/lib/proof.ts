/** Merkle proofs for official-list records, matching pipeline/load_supabase.py (record_leaf, merkle_root):
 * leaf = sha256 of {"date","id","objects"} as compact JSON with sorted keys; parents = sha256(min(a,b) || max(a,b)). */
export async function sha256(b: Uint8Array): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", new Uint8Array(b)));
}
export const toHex = (b: Uint8Array) => "0x" + [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
export const fromHex = (h: string) => Uint8Array.from((h.replace(/^0x/, "").match(/../g) ?? []).map((x) => parseInt(x, 16)));
const cmp = (a: Uint8Array, b: Uint8Array) => {
  for (let i = 0; i < Math.min(a.length, b.length); i++) if (a[i] !== b[i]) return a[i] - b[i];
  return a.length - b.length;
};
const concat = (a: Uint8Array, b: Uint8Array) => { const o = new Uint8Array(a.length + b.length); o.set(a); o.set(b, a.length); return o; };

export function recordLeaf(r: { id: string; date: string; objects: string[] }) {
  return sha256(new TextEncoder().encode(JSON.stringify({ date: r.date, id: r.id, objects: r.objects })));
}

export async function foldProof(leaf: Uint8Array, proof: string[]): Promise<Uint8Array> {
  let h = leaf;
  for (const p of proof) {
    const s = fromHex(p);
    h = cmp(h, s) <= 0 ? await sha256(concat(h, s)) : await sha256(concat(s, h));
  }
  return h;
}

export const HOW_TO_VERIFY =
  "leaf = sha256 of {\"date\",\"id\",\"objects\"} as compact JSON with sorted keys; for each proof hash p: " +
  "h = sha256(min(h,p) || max(h,p)), comparing bytes; the result must equal merkleRoot in the DatasetAnchored " +
  "event of the anchor transaction on Avalanche.";
