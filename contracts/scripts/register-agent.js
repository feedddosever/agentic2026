// Register the Ritrovo agent in the ERC-8004 Identity Registry and bind it to CustodyLog.
// Run after deploy.js: npx hardhat run scripts/register-agent.js --network fuji
const { ethers, network } = require("hardhat");
const fs = require("fs");
const path = require("path");

// Official ERC-8004 deployments (github.com/erc-8004/erc-8004-contracts)
const IDENTITY_REGISTRY = {
  fuji: "0x8004A818BFB912233c491871b3d84c89A494BD9e",
  avalanche: "0x8004A169FB4a3325136EB29fA0ceB6D2e539a432",
};
const ABI = [
  "function register(string agentURI) returns (uint256 agentId)",
  "function tokenURI(uint256 tokenId) view returns (string)",
  "function ownerOf(uint256 tokenId) view returns (address)",
  "event Registered(uint256 indexed agentId, string agentURI, address indexed owner)",
];
const AGENT_URI = process.env.AGENT_URI || "https://izrggntqsssfzazjfhht.supabase.co/functions/v1/api/agent-registration.json";

async function main() {
  const [signer] = await ethers.getSigners();
  const outFile = path.join(__dirname, `../deployments/${network.name}.json`);
  const dep = JSON.parse(fs.readFileSync(outFile, "utf8"));
  const registry = new ethers.Contract(IDENTITY_REGISTRY[network.name], ABI, signer);

  if (!dep.agentId) {
    const tx = await registry.register(AGENT_URI);
    const r = await tx.wait();
    const ev = r.logs.map((l) => { try { return registry.interface.parseLog(l); } catch { return null; } }).find((e) => e && e.name === "Registered");
    dep.agentId = ev.args.agentId.toString();
    dep.identityRegistry = IDENTITY_REGISTRY[network.name];
    dep.registerTx = r.hash;
    console.log(`registered agentId ${dep.agentId} tx ${r.hash}`);
  }
  console.log("tokenURI:", await registry.tokenURI(dep.agentId), "owner:", await registry.ownerOf(dep.agentId));

  const log = await ethers.getContractAt("CustodyLog", dep.custodyLog);
  if ((await log.agentId()).toString() !== dep.agentId) {
    const r = await (await log.setAgentIdentity(dep.identityRegistry, dep.agentId)).wait();
    dep.bindTx = r.hash;
    console.log("CustodyLog bound to agent", dep.agentId, "tx", r.hash);
  }
  fs.writeFileSync(outFile, JSON.stringify(dep, null, 2));
}

main().catch((e) => { console.error(e.message || e); process.exitCode = 1; });
