// Avalanche layer: custody log writes, agent message signatures, ERC-8004 identity info.
// Works without chain config: signatures still work (agent key), custody events stay "pending" until
// CUSTODY_CONTRACT is set and the agent wallet has gas; /chain/flush retries them.
import {
  createPublicClient, createWalletClient, http, keccak256, encodePacked, parseAbi, toHex, stringToBytes,
  recoverMessageAddress, type Hex,
} from "npm:viem@2.57.12";
import { privateKeyToAccount } from "npm:viem@2.57.12/accounts";
import { avalanche, avalancheFuji } from "npm:viem@2.57.12/chains";

const RAW_PK = (Deno.env.get("AGENT_PRIVATE_KEY") ?? "").trim();
const PK = (/^(0x)?[0-9a-fA-F]{64}$/.test(RAW_PK) ? (RAW_PK.startsWith("0x") ? RAW_PK : `0x${RAW_PK}`) : undefined) as Hex | undefined;
const CONTRACT = Deno.env.get("CUSTODY_CONTRACT") as Hex | undefined;
const CHAIN_ID = Number(Deno.env.get("CHAIN_ID") ?? "43113");
const ITEM_SALT = Deno.env.get("ITEM_SALT") ?? "";
export const AGENT_ID = Deno.env.get("ERC8004_AGENT_ID") ?? null;

const chain = CHAIN_ID === 43114 ? avalanche : avalancheFuji;
export const IDENTITY_REGISTRY = CHAIN_ID === 43114
  ? "0x8004A169FB4a3325136EB29fA0ceB6D2e539a432"
  : "0x8004A818BFB912233c491871b3d84c89A494BD9e";
const EXPLORER = CHAIN_ID === 43114 ? "https://snowtrace.io" : "https://testnet.snowtrace.io";

let account: ReturnType<typeof privateKeyToAccount> | null = null;
try {
  account = PK ? privateKeyToAccount(PK) : null;
} catch (e) {
  console.error("invalid AGENT_PRIVATE_KEY", e);
}
export const agentAddress = account?.address ?? null;
const publicClient = createPublicClient({ chain, transport: http() });
const walletClient = account ? createWalletClient({ account, chain, transport: http() }) : null;

const ABI = parseAbi([
  "function logIntake(bytes32 itemHash, bytes32 evidence)",
  "function logRouted(bytes32 itemHash, bytes32 channel, bytes32 evidence)",
  "function logReturned(bytes32 itemHash, bytes32 evidence)",
  "function stageOf(bytes32 itemHash) view returns (uint8)",
  "function anchorDataset(bytes32 pdfSha256, bytes32 merkleRoot, uint32 recordCount, string sourceUrl)",
]);

export const explorerTx = (hash: string | null) => (hash ? `${EXPLORER}/tx/${hash}` : null);
export const explorerAddress = (addr: string) => `${EXPLORER}/address/${addr}`;
export const chainInfo = () => ({
  chain: chain.name, chain_id: CHAIN_ID, custody_contract: CONTRACT ?? null,
  custody_contract_url: CONTRACT ? explorerAddress(CONTRACT) : null,
  agent_address: agentAddress, erc8004_agent_id: AGENT_ID, identity_registry: IDENTITY_REGISTRY,
  agent_registry: `eip155:${CHAIN_ID}:${IDENTITY_REGISTRY}`,
});

/** Deterministic JSON (sorted keys) so hashes are reproducible. */
export function canonical(v: unknown): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v);
  if (Array.isArray(v)) return "[" + v.map(canonical).join(",") + "]";
  const o = v as Record<string, unknown>;
  return "{" + Object.keys(o).sort().filter((k) => o[k] !== undefined).map((k) => JSON.stringify(k) + ":" + canonical(o[k])).join(",") + "}";
}
export const hashJson = (v: unknown): Hex => keccak256(stringToBytes(canonical(v)));

/** Onchain key for an item: keccak256(itemId, secret salt) so ids can't be enumerated from the chain. */
export const itemHash = (itemId: string): Hex => keccak256(encodePacked(["string", "string"], [itemId, ITEM_SALT]));

// ---------- signatures (EIP-191) ----------

export async function signPayload(payload: Record<string, unknown>) {
  const payload_hash = hashJson(payload);
  if (!account) return { payload_hash, signature: null, signer: null };
  const signature = await account.signMessage({ message: `Ritrovo outbox v1:${payload_hash}` });
  return { payload_hash, signature, signer: account.address };
}

export async function recoverSigner(payload_hash: Hex, signature: Hex) {
  return await recoverMessageAddress({ message: `Ritrovo outbox v1:${payload_hash}`, signature });
}

// ---------- custody writes ----------

export type CustodyEvent = "intake" | "routed" | "returned";

export async function writeCustody(event: CustodyEvent, itemId: string, evidence: Hex, channel?: string) {
  if (!walletClient || !CONTRACT) return { tx_hash: null as string | null, error: "chain not configured" };
  try {
    const ih = itemHash(itemId);
    const fn = event === "intake" ? "logIntake" : event === "routed" ? "logRouted" : "logReturned";
    const args = (event === "routed"
      ? [ih, toHex(stringToBytes((channel ?? "").slice(0, 31)), { size: 32 }), evidence]
      : [ih, evidence]) as never;
    const hash = await walletClient.writeContract({ address: CONTRACT, abi: ABI, functionName: fn, args });
    // Fuji finalises in ~2 s; wait so the console can show a confirmed tx.
    await publicClient.waitForTransactionReceipt({ hash, timeout: 20_000 }).catch(() => null);
    return { tx_hash: hash as string, error: null };
  } catch (e) {
    return { tx_hash: null, error: String((e as Error).message ?? e).slice(0, 300) };
  }
}

export async function agentBalance() {
  if (!agentAddress) return null;
  try {
    return (await publicClient.getBalance({ address: agentAddress })).toString();
  } catch {
    return null;
  }
}

/** Anchor an official list's fingerprint (sha256 of the PDF + Merkle root of decoded records). */
export async function anchorDataset(pdfSha256: Hex, merkleRoot: Hex, records: number, sourceUrl: string) {
  if (!walletClient || !CONTRACT) return { tx_hash: null as string | null, error: "chain not configured" };
  try {
    const hash = await walletClient.writeContract({ address: CONTRACT, abi: ABI, functionName: "anchorDataset", args: [pdfSha256, merkleRoot, records, sourceUrl] });
    await publicClient.waitForTransactionReceipt({ hash, timeout: 20_000 }).catch(() => null);
    return { tx_hash: hash as string, error: null };
  } catch (e) {
    return { tx_hash: null, error: String((e as Error).message ?? e).slice(0, 300) };
  }
}
