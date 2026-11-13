// Deploy CustodyLog and anchor the official-list fingerprints.
// Run: npx hardhat run scripts/deploy.js --network fuji   (key from ../.env AGENT_PRIVATE_KEY)
const { ethers, network } = require("hardhat");
const fs = require("fs");
const path = require("path");

async function main() {
  const [signer] = await ethers.getSigners();
  const bal = await ethers.provider.getBalance(signer.address);
  console.log(`network ${network.name} (${network.config.chainId}) signer ${signer.address} balance ${ethers.formatEther(bal)} AVAX`);
  if (bal === 0n) throw new Error("Deployer has no AVAX: fund it from the Fuji faucet first.");

  const outFile = path.join(__dirname, `../deployments/${network.name}.json`);
  const dep = fs.existsSync(outFile) ? JSON.parse(fs.readFileSync(outFile, "utf8")) : {};

  let log;
  if (dep.custodyLog) {
    log = await ethers.getContractAt("CustodyLog", dep.custodyLog);
    console.log("CustodyLog already deployed at", dep.custodyLog);
  } else {
    log = await (await ethers.getContractFactory("CustodyLog")).deploy();
    const receipt = await log.deploymentTransaction().wait();
    dep.custodyLog = await log.getAddress();
    dep.deployTx = receipt.hash;
    dep.deployBlock = receipt.blockNumber;
    console.log("CustodyLog deployed", dep.custodyLog, "tx", receipt.hash);
  }
  dep.chainId = network.config.chainId;
  dep.anchors = dep.anchors || {};

  const datasets = JSON.parse(fs.readFileSync(path.join(__dirname, "../../data/processed/datasets.json"), "utf8"));
  for (const d of datasets) {
    if (dep.anchors[d.pdf_sha256]) continue;
    const tx = await log.anchorDataset(d.pdf_sha256, d.merkle_root, d.records, d.source_url);
    const r = await tx.wait();
    dep.anchors[d.pdf_sha256] = r.hash;
    console.log(`anchored ${d.year} (${d.records} records) tx ${r.hash}`);
  }
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  fs.writeFileSync(outFile, JSON.stringify(dep, null, 2));
  console.log("saved", outFile);
}

main().catch((e) => { console.error(e.message || e); process.exitCode = 1; });
