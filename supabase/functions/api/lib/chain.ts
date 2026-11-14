// Avalanche layer: custody log writes, agent message signatures, ERC-8004 identity info.
// Works without chain config: signatures still work (agent key), custody events stay "pending" until
// CUSTODY_CONTRACT is set and the agent wallet has gas; /chain/flush retries them.
import {
  createPublicClient, createWalletClient, http, keccak256, encodePacked, parseAbi, parseEventLogs, toHex, stringToBytes,
  recoverMessageAddress, type Hex,
} from "npm:viem@2.57.12";
import { privateKeyToAccount, nonceManager } from "npm:viem@2.57.12/accounts";
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
// ERC-8004 trust registries (official deployments). Mainnet addresses come from env when needed.
export const REPUTATION_REGISTRY = (Deno.env.get("REPUTATION_REGISTRY") ?? (CHAIN_ID === 43114 ? "" : "0x8004B663056A597Dffe9eCcC1965A193B7388713")) as Hex;
export const VALIDATION_REGISTRY = (Deno.env.get("VALIDATION_REGISTRY") ?? (CHAIN_ID === 43114 ? "" : "0x8004Cb1BF31DAf7788923b405b754f57acEB4272")) as Hex;
const EXPLORER = CHAIN_ID === 43114 ? "https://snowtrace.io" : "https://testnet.snowtrace.io";

let account: ReturnType<typeof privateKeyToAccount> | null = null;
try {
  account = PK ? privateKeyToAccount(PK, { nonceManager }) : null;
} catch (e) {
  console.error("invalid AGENT_PRIVATE_KEY", e);
}
export const agentAddress = account?.address ?? null;
const publicClient = createPublicClient({ chain, transport: http() });
const walletClient = account ? createWalletClient({ account, chain, transport: http() }) : null;

// The office (Reparto Oggetti Rinvenuti) has its own key: ERC-8004 forbids an agent's owner from rating or
// validating its own agent, so feedback and validations come from the office, as they would in production.
const RAW_OFFICE = (Deno.env.get("OFFICE_PRIVATE_KEY") ?? "").trim();
let officeAccount: ReturnType<typeof privateKeyToAccount> | null = null;
try {
  if (/^(0x)?[0-9a-fA-F]{64}$/.test(RAW_OFFICE)) officeAccount = privateKeyToAccount((RAW_OFFICE.startsWith("0x") ? RAW_OFFICE : `0x${RAW_OFFICE}`) as Hex, { nonceManager });
} catch (e) {
  console.error("invalid OFFICE_PRIVATE_KEY", e);
}
export const officeAddress = officeAccount?.address ?? null;
const officeClient = officeAccount ? createWalletClient({ account: officeAccount, chain, transport: http() }) : null;

const REPUTATION_ABI = parseAbi([
  "function giveFeedback(uint256 agentId, int128 value, uint8 valueDecimals, string tag1, string tag2, string endpoint, string feedbackURI, bytes32 feedbackHash)",
  "function getSummary(uint256 agentId, address[] clientAddresses, string tag1, string tag2) view returns (uint64 count, int128 summaryValue, uint8 summaryValueDecimals)",
]);
const VALIDATION_ABI = parseAbi([
  "function validationRequest(address validatorAddress, uint256 agentId, string requestURI, bytes32 requestHash)",
  "function validationResponse(bytes32 requestHash, uint8 response, string responseURI, bytes32 responseHash, string tag)",
  "function getSummary(uint256 agentId, address[] validatorAddresses, string tag) view returns (uint64 count, uint8 avgResponse)",
]);
const ANCHOR_EVENT = parseAbi(["event DatasetAnchored(bytes32 indexed pdfSha256, bytes32 merkleRoot, uint32 records, string sourceUrl)"]);

export const trustEnabled = () => !!(officeClient && walletClient && AGENT_ID && REPUTATION_REGISTRY && VALIDATION_REGISTRY);

/** Office feedback on agent #AGENT_ID after a completed return (ERC-8004 Reputation Registry). */
export async function giveReturnFeedback(itemId: string, verifiedWith: string, feedbackURI: string) {
  if (!trustEnabled()) return { tx_hash: null as string | null, error: "trust layer not configured" };
  try {
    const hash = await officeClient!.writeContract({
      address: REPUTATION_REGISTRY, abi: REPUTATION_ABI, functionName: "giveFeedback",
      args: [BigInt(AGENT_ID!), 100n, 0, "returned", verifiedWith.slice(0, 32), "", feedbackURI, itemHash(itemId)],
    });
    return { tx_hash: hash as string, error: null };
  } catch (e) {
    return { tx_hash: null, error: String((e as Error).message ?? e).slice(0, 300) };
  }
}

/** The agent asks the office to validate a routing decision; the office answers with a 0-100 score
 * (ERC-8004 Validation Registry). The response waits for the request to be mined. */
export async function validateDecision(requestURI: string, summary: unknown, score: number) {
  if (!trustEnabled()) return { request_hash: null as string | null, request_tx: null as string | null, response_tx: null as string | null, error: "trust layer not configured" };
  const requestHash = hashJson(summary);
  try {
    const req = await walletClient!.writeContract({
      address: VALIDATION_REGISTRY, abi: VALIDATION_ABI, functionName: "validationRequest",
      args: [officeAddress as Hex, BigInt(AGENT_ID!), requestURI, requestHash],
    });
    await publicClient.waitForTransactionReceipt({ hash: req, timeout: 30_000 });
    const res = await officeClient!.writeContract({
      address: VALIDATION_REGISTRY, abi: VALIDATION_ABI, functionName: "validationResponse",
      args: [requestHash, Math.max(0, Math.min(100, Math.round(score))), requestURI, hashJson({ requestHash, score }), "policy"],
    });
    return { request_hash: requestHash as string, request_tx: req as string, response_tx: res as string, error: null };
  } catch (e) {
    return { request_hash: requestHash as string, request_tx: null, response_tx: null, error: String((e as Error).message ?? e).slice(0, 300) };
  }
}

/** Public, verifiable track record of the agent, read from the ERC-8004 registries. */
export async function trackRecord() {
  if (!AGENT_ID || !officeAddress || !REPUTATION_REGISTRY || !VALIDATION_REGISTRY) return null;
  const office = [officeAddress as Hex];
  const [rep, val] = await Promise.all([
    publicClient.readContract({ address: REPUTATION_REGISTRY, abi: REPUTATION_ABI, functionName: "getSummary", args: [BigInt(AGENT_ID), office, "returned", ""] }),
    publicClient.readContract({ address: VALIDATION_REGISTRY, abi: VALIDATION_ABI, functionName: "getSummary", args: [BigInt(AGENT_ID), office, "policy"] }),
  ]);
  return {
    agent_id: AGENT_ID, office_address: officeAddress, office_url: explorerAddress(officeAddress),
    returns: { count: Number(rep[0]), registry: REPUTATION_REGISTRY, registry_url: explorerAddress(REPUTATION_REGISTRY), tag: "returned" },
    policy_validation: { count: Number(val[0]), avg_score: Number(val[1]), registry: VALIDATION_REGISTRY, registry_url: explorerAddress(VALIDATION_REGISTRY), tag: "policy" },
  };
}

/** Read an anchored list fingerprint back from its Avalanche transaction. */
export async function anchoredList(txHash: Hex) {
  const receipt = await publicClient.getTransactionReceipt({ hash: txHash });
  const [log] = parseEventLogs({ abi: ANCHOR_EVENT, logs: receipt.logs, eventName: "DatasetAnchored" });
  if (!log) return null;
  const block = await publicClient.getBlock({ blockNumber: receipt.blockNumber });
  return {
    pdf_sha256: log.args.pdfSha256 as string, merkle_root: log.args.merkleRoot as string, records: Number(log.args.records),
    source_url: log.args.sourceUrl, anchored_at: new Date(Number(block.timestamp) * 1000).toISOString(),
  };
}

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

export async function writeCustody(event: CustodyEvent, itemId: string, evidence: Hex, channel?: string, opts: { wait?: boolean } = {}) {
  if (!walletClient || !CONTRACT) return { tx_hash: null as string | null, error: "chain not configured" };
  try {
    const ih = itemHash(itemId);
    const fn = event === "intake" ? "logIntake" : event === "routed" ? "logRouted" : "logReturned";
    const args = (event === "routed"
      ? [ih, toHex(stringToBytes((channel ?? "").slice(0, 31)), { size: 32 }), evidence]
      : [ih, evidence]) as never;
    const hash = await walletClient.writeContract({ address: CONTRACT, abi: ABI, functionName: fn, args });
    // The hash is known as soon as the tx is sent and Fuji finalises in ~2 s, so by default we don't block the
    // operator on the receipt (the nonce manager keeps intake → routed → returned in order).
    if (opts.wait) await publicClient.waitForTransactionReceipt({ hash, timeout: 20_000 }).catch(() => null);
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
