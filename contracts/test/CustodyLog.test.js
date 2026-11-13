const { expect } = require("chai");
const { ethers } = require("hardhat");

const h = (s) => ethers.keccak256(ethers.toUtf8Bytes(s));
const Stage = { None: 0n, Intake: 1n, Routed: 2n, Returned: 3n };

describe("CustodyLog", function () {
  let log, owner, recorder, stranger;
  const item = h("IN-0001|salt-abc");
  const evidence1 = h('{"objects":["PORTAFOGLI","DENARO EURO 200"]}');

  beforeEach(async () => {
    [owner, recorder, stranger] = await ethers.getSigners();
    log = await (await ethers.getContractFactory("CustodyLog")).deploy();
  });

  it("deployer is owner and recorder", async () => {
    expect(await log.owner()).to.equal(owner.address);
    expect(await log.recorders(owner.address)).to.equal(true);
  });

  it("runs the full intake → routed → returned lifecycle", async () => {
    await expect(log.logIntake(item, evidence1)).to.emit(log, "Intake");
    expect(await log.stageOf(item)).to.equal(Stage.Intake);
    const channel = ethers.encodeBytes32String("embassy");
    await expect(log.logRouted(item, channel, evidence1)).to.emit(log, "Routed");
    await expect(log.logReturned(item, h("returned|verified_with=prefix"))).to.emit(log, "Returned");
    expect(await log.stageOf(item)).to.equal(Stage.Returned);
    expect(await log.intakeCount()).to.equal(1n);
    expect(await log.returnedCount()).to.equal(1n);
    const rec = await log.records(item);
    expect(rec.evidence).to.equal(h("returned|verified_with=prefix"));
  });

  it("refuses double intake and double return", async () => {
    await log.logIntake(item, evidence1);
    await expect(log.logIntake(item, evidence1)).to.be.revertedWithCustomError(log, "BadStage");
    await log.logReturned(item, evidence1);
    await expect(log.logReturned(item, evidence1)).to.be.revertedWithCustomError(log, "BadStage");
  });

  it("refuses routing an object that never entered custody", async () => {
    await expect(log.logRouted(item, ethers.ZeroHash, evidence1)).to.be.revertedWithCustomError(log, "BadStage");
  });

  it("allows returning an official-list object logged before the system existed", async () => {
    await expect(log.logReturned(h("2026-6571|salt"), evidence1)).to.emit(log, "Returned");
  });

  it("rejects zero hashes", async () => {
    await expect(log.logIntake(ethers.ZeroHash, evidence1)).to.be.revertedWithCustomError(log, "ZeroHash");
  });

  it("only recorders write, only owner manages recorders and identity", async () => {
    await expect(log.connect(stranger).logIntake(item, evidence1)).to.be.revertedWithCustomError(log, "NotRecorder");
    await expect(log.connect(stranger).setRecorder(stranger.address, true)).to.be.revertedWithCustomError(log, "NotOwner");
    await log.setRecorder(recorder.address, true);
    await expect(log.connect(recorder).logIntake(item, evidence1)).to.emit(log, "Intake");
    await log.setRecorder(recorder.address, false);
    await expect(log.connect(recorder).logReturned(item, evidence1)).to.be.revertedWithCustomError(log, "NotRecorder");
  });

  it("stores the ERC-8004 agent identity", async () => {
    const registry = "0x8004A818BFB912233c491871b3d84c89A494BD9e";
    await expect(log.setAgentIdentity(registry, 42n)).to.emit(log, "AgentIdentitySet").withArgs(registry, 42n);
    expect(await log.agentId()).to.equal(42n);
  });

  it("anchors a dataset fingerprint", async () => {
    const sha = "0x" + "e29cb948ada8f790".padEnd(64, "0");
    await expect(log.anchorDataset(sha, h("root"), 6940, "https://www.comune.roma.it/x.pdf"))
      .to.emit(log, "DatasetAnchored").withArgs(sha, h("root"), 6940, "https://www.comune.roma.it/x.pdf");
  });
});
