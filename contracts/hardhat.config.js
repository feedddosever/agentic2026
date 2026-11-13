require("@nomicfoundation/hardhat-ethers");
require("@nomicfoundation/hardhat-chai-matchers");
const fs = require("fs");
const path = require("path");

// Read the testnet key from the repo-root .env (never committed).
const env = Object.fromEntries(
  (fs.existsSync(path.join(__dirname, "../.env")) ? fs.readFileSync(path.join(__dirname, "../.env"), "utf8") : "")
    .split("\n").filter((l) => l.includes("=")).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).trim()])
);
const accounts = env.AGENT_PRIVATE_KEY ? [env.AGENT_PRIVATE_KEY] : [];

module.exports = {
  solidity: { version: "0.8.24", settings: { optimizer: { enabled: true, runs: 200 }, evmVersion: "cancun" } },
  networks: {
    fuji: { url: "https://api.avax-test.network/ext/bc/C/rpc", chainId: 43113, accounts },
    avalanche: { url: "https://api.avax.network/ext/bc/C/rpc", chainId: 43114, accounts },
  },
};
