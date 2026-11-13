// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/// @title CustodyLog
/// @notice Tamper-evident custody log for found objects handled by Rome's lost-and-found office
///         (Ritrovo prototype, Agentic Hack Rome 2026).
/// @dev    Privacy by construction: only hashes go onchain.
///         - itemHash = keccak256(abi.encodePacked(itemId, salt)) with a per-item secret salt kept off-chain,
///           so nobody can enumerate item ids from the chain.
///         - evidence = keccak256 of the structured intake record (objects, cash amount, photo hash...),
///           so the record can't be quietly changed later (e.g. "€200" becoming "€20").
///         The writer is the Ritrovo agent, identified by an ERC-8004 Identity Registry entry.
contract CustodyLog {
    enum Stage {
        None,
        Intake,
        Routed,
        Returned
    }

    struct Record {
        Stage stage;
        uint64 updatedAt;
        bytes32 evidence; // latest evidence hash
    }

    address public owner;
    mapping(address => bool) public recorders;
    mapping(bytes32 => Record) public records;

    /// @notice ERC-8004 identity of the agent that writes this log.
    address public identityRegistry;
    uint256 public agentId;

    uint64 public intakeCount;
    uint64 public returnedCount;

    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);
    event RecorderSet(address indexed recorder, bool allowed);
    event AgentIdentitySet(address indexed registry, uint256 indexed agentId);
    event Intake(bytes32 indexed itemHash, bytes32 evidence, uint64 at);
    event Routed(bytes32 indexed itemHash, bytes32 indexed channel, bytes32 evidence, uint64 at);
    event Returned(bytes32 indexed itemHash, bytes32 evidence, uint64 at);
    event DatasetAnchored(bytes32 indexed pdfSha256, bytes32 merkleRoot, uint32 records, string sourceUrl);

    error NotOwner();
    error NotRecorder();
    error BadStage(Stage current);
    error ZeroHash();

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    modifier onlyRecorder() {
        if (!recorders[msg.sender]) revert NotRecorder();
        _;
    }

    constructor() {
        owner = msg.sender;
        recorders[msg.sender] = true;
        emit OwnershipTransferred(address(0), msg.sender);
        emit RecorderSet(msg.sender, true);
    }

    function transferOwnership(address newOwner) external onlyOwner {
        emit OwnershipTransferred(owner, newOwner);
        owner = newOwner;
    }

    function setRecorder(address recorder, bool allowed) external onlyOwner {
        recorders[recorder] = allowed;
        emit RecorderSet(recorder, allowed);
    }

    function setAgentIdentity(address registry, uint256 id) external onlyOwner {
        identityRegistry = registry;
        agentId = id;
        emit AgentIdentitySet(registry, id);
    }

    /// @notice A newly handed-in object enters custody.
    function logIntake(bytes32 itemHash, bytes32 evidence) external onlyRecorder {
        if (itemHash == bytes32(0)) revert ZeroHash();
        Record storage r = records[itemHash];
        if (r.stage != Stage.None) revert BadStage(r.stage);
        _set(r, Stage.Intake, evidence);
        unchecked {
            intakeCount++;
        }
        emit Intake(itemHash, evidence, uint64(block.timestamp));
    }

    /// @notice The return engine routed the object to an owner-contact channel (e.g. "embassy", "app_io").
    function logRouted(bytes32 itemHash, bytes32 channel, bytes32 evidence) external onlyRecorder {
        Record storage r = records[itemHash];
        if (r.stage != Stage.Intake && r.stage != Stage.Routed) revert BadStage(r.stage);
        _set(r, Stage.Routed, evidence);
        emit Routed(itemHash, channel, evidence, uint64(block.timestamp));
    }

    /// @notice The object was handed back. Allowed from None for objects logged before this system existed
    ///         (official-list items), but never twice.
    function logReturned(bytes32 itemHash, bytes32 evidence) external onlyRecorder {
        if (itemHash == bytes32(0)) revert ZeroHash();
        Record storage r = records[itemHash];
        if (r.stage == Stage.Returned) revert BadStage(r.stage);
        _set(r, Stage.Returned, evidence);
        unchecked {
            returnedCount++;
        }
        emit Returned(itemHash, evidence, uint64(block.timestamp));
    }

    /// @notice Fingerprint of an official published list: sha256 of the PDF and Merkle root of the decoded records.
    function anchorDataset(bytes32 pdfSha256, bytes32 merkleRoot, uint32 recordCount, string calldata sourceUrl)
        external
        onlyRecorder
    {
        emit DatasetAnchored(pdfSha256, merkleRoot, recordCount, sourceUrl);
    }

    function stageOf(bytes32 itemHash) external view returns (Stage) {
        return records[itemHash].stage;
    }

    function _set(Record storage r, Stage stage, bytes32 evidence) private {
        r.stage = stage;
        r.updatedAt = uint64(block.timestamp);
        r.evidence = evidence;
    }
}
