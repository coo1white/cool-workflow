"use strict";
// Node Snapshot / Diff / Replay (v0.1.35) — per-node granularity over the eval
// harness. Snapshot one StateNode into a DERIVED, sha256-fingerprinted projection,
// diff two snapshots structurally, and deterministically replay one node in
// isolation.
//
// BSD discipline:
//  - MECHANISM, not policy: the caller names the node id; nothing decides which
//    node "matters".
//  - FAIL CLOSED ON SOURCE DRIFT [load-bearing]: a snapshot carries a
//    sourceFingerprint over the RAW node (id:status:updatedAt + artifact/evidence
//    ids+paths). loadNodeSnapshot recomputes it from the current source; on
//    divergence (`stale`) or a missing node/artifact (`absent`) diff/replay REFUSE
//    with a structured error — never a silent stale replay.
//  - REUSE, don't fork: operates on the real StateNode (getRunNode) and reuses the
//    eval harness's normalizeValue/replayStableStringify and state-explosion's
//    fingerprintStrings. No parallel node type, normalizer, or replay engine.
//  - DETERMINISTIC: `now` is injected; the deterministic payload (normalized body
//    + outputFingerprint) carries zero wall-clock, so two replays are byte-identical.
//
// Additive: StateNode and STATE_NODE_SCHEMA_VERSION are unchanged. See
// docs/node-snapshot-diff-replay.7.md.
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.NodeSnapshotError = exports.NODE_SNAPSHOT_SCHEMA_VERSION = void 0;
exports.readNodeSnapshot = readNodeSnapshot;
exports.readNodeReplay = readNodeReplay;
exports.snapshotNode = snapshotNode;
exports.loadNodeSnapshot = loadNodeSnapshot;
exports.diffNodeSnapshots = diffNodeSnapshots;
exports.replayNodeSnapshot = replayNodeSnapshot;
exports.verifyNodeReplay = verifyNodeReplay;
const node_fs_1 = __importDefault(require("node:fs"));
const node_path_1 = __importDefault(require("node:path"));
const pipeline_runner_1 = require("./pipeline-runner");
const state_1 = require("./state");
const multi_agent_eval_1 = require("./multi-agent-eval");
const node_projection_1 = require("./node-projection");
const state_explosion_1 = require("./state-explosion");
const validation_1 = require("./validation");
exports.NODE_SNAPSHOT_SCHEMA_VERSION = 1;
/** Structured fail-closed error (mirrors the PipelineContractError shape). */
class NodeSnapshotError extends Error {
    code;
    freshness;
    details;
    constructor(code, message, options = {}) {
        super(message);
        this.name = "NodeSnapshotError";
        this.code = code;
        this.freshness = options.freshness;
        this.details = options.details;
    }
}
exports.NodeSnapshotError = NodeSnapshotError;
const SNAPSHOT_SECTIONS = [
    "status",
    "inputs",
    "outputs",
    "artifacts",
    "evidence",
    "errors",
    "links",
    "metadata"
];
/** The normalized projection of a node — timestamps/paths stripped by the eval
 *  normalizer, so it is byte-stable across captures of the same logical state. The
 *  canonical field set lives in node-projection.ts (shared with reclamation.ts so
 *  the projection can never drift across the two). */
function snapshotBody(node) {
    return (0, node_projection_1.projectNodeBody)(node);
}
/** RAW fingerprint (NOT normalized): any transition (updatedAt/status) or
 *  artifact/evidence change flips it, which is how drift is detected. */
function sourceFingerprint(node) {
    return (0, state_explosion_1.fingerprintStrings)([
        `node:${node.id}:${node.status}:${node.updatedAt}`,
        ...node.artifacts.map((artifact) => `artifact:${artifact.id}:${artifact.path}`),
        ...node.evidence.map((evidence) => `evidence:${evidence.id}:${evidence.path || ""}`)
    ]);
}
function tryGetNode(run, nodeId) {
    try {
        return (0, pipeline_runner_1.getRunNode)(run, nodeId);
    }
    catch {
        return undefined;
    }
}
function snapshotsRoot(run) {
    const base = run.paths.stateNodesDir || node_path_1.default.join(run.paths.runDir, "nodes");
    return node_path_1.default.join(base, "snapshots");
}
function snapshotDir(run, nodeId) {
    return node_path_1.default.join(snapshotsRoot(run), (0, state_1.safeFileName)(nodeId));
}
/** Load a persisted snapshot by id (scans the per-node snapshot dirs). */
function readNodeSnapshot(run, snapshotId) {
    const root = snapshotsRoot(run);
    if (node_fs_1.default.existsSync(root)) {
        for (const nodeDir of node_fs_1.default.readdirSync(root)) {
            const file = node_path_1.default.join(root, nodeDir, `${snapshotId}.json`);
            if (node_fs_1.default.existsSync(file))
                return (0, validation_1.validateNodeSnapshot)(JSON.parse(node_fs_1.default.readFileSync(file, "utf8")));
        }
    }
    throw new NodeSnapshotError("snapshot-not-found", `Node snapshot ${snapshotId} not found in run ${run.id}`, { freshness: "absent" });
}
/** Load a persisted replay run by id. */
function readNodeReplay(run, replayId) {
    const root = snapshotsRoot(run);
    if (node_fs_1.default.existsSync(root)) {
        for (const nodeDir of node_fs_1.default.readdirSync(root)) {
            const file = node_path_1.default.join(root, nodeDir, "replays", `${replayId}.json`);
            if (node_fs_1.default.existsSync(file))
                return (0, validation_1.validateNodeReplayRun)(JSON.parse(node_fs_1.default.readFileSync(file, "utf8")));
        }
    }
    throw new NodeSnapshotError("replay-not-found", `Node replay ${replayId} not found in run ${run.id}`, { freshness: "absent" });
}
/** Snapshot one StateNode by id. Throws (fail closed) if the node is absent. */
function snapshotNode(run, nodeId, options = {}) {
    const node = tryGetNode(run, nodeId);
    if (!node) {
        throw new NodeSnapshotError("node-absent", `Cannot snapshot: node ${nodeId} not found in run ${run.id}`, { freshness: "absent" });
    }
    const fingerprint = sourceFingerprint(node);
    const snapshot = {
        schemaVersion: 1,
        snapshotId: `snap-${(0, state_1.safeFileName)(nodeId)}-${fingerprint.replace("sha256:", "").slice(0, 12)}`,
        runId: run.id,
        nodeId,
        capturedAt: options.now || new Date().toISOString(),
        sourceFingerprint: fingerprint,
        body: snapshotBody(node)
    };
    if (options.persist !== false) {
        (0, state_1.writeJson)(node_path_1.default.join(snapshotDir(run, nodeId), `${snapshot.snapshotId}.json`), snapshot);
    }
    return snapshot;
}
/** Recompute freshness from current source. valid | stale | absent. */
function loadNodeSnapshot(run, snapshot) {
    const node = tryGetNode(run, snapshot.nodeId);
    if (!node) {
        return { snapshot, freshness: "absent", reason: `source node ${snapshot.nodeId} is gone from run ${run.id}` };
    }
    const missingArtifact = node.artifacts.find((artifact) => artifact.path && !node_fs_1.default.existsSync(artifact.path));
    if (missingArtifact) {
        return { snapshot, freshness: "absent", reason: `referenced artifact path is unreadable: ${missingArtifact.id}` };
    }
    if (sourceFingerprint(node) !== snapshot.sourceFingerprint) {
        return { snapshot, freshness: "stale", reason: `source node ${snapshot.nodeId} changed since capture` };
    }
    return { snapshot, freshness: "valid" };
}
function sectionValue(body, section) {
    if (section === "links")
        return { parents: body.parents, children: body.children };
    return body[section];
}
/** Stable, structural diff of two snapshots (same node id or two explicit ids). */
function diffNodeSnapshots(baseline, candidate) {
    const sections = SNAPSHOT_SECTIONS.map((section) => {
        const baselineValue = sectionValue(baseline.body, section);
        const candidateValue = sectionValue(candidate.body, section);
        const sameBytes = (0, multi_agent_eval_1.replayStableStringify)(baselineValue) === (0, multi_agent_eval_1.replayStableStringify)(candidateValue);
        let change;
        if (sameBytes)
            change = "same";
        else if (baselineValue === undefined)
            change = "added";
        else if (candidateValue === undefined)
            change = "removed";
        else
            change = "changed";
        const entry = { section, change };
        if (change !== "same") {
            entry.baseline = baselineValue;
            entry.candidate = candidateValue;
        }
        return entry;
    });
    return {
        schemaVersion: 1,
        runId: baseline.runId,
        baselineSnapshotId: baseline.snapshotId,
        candidateSnapshotId: candidate.snapshotId,
        baselineNodeId: baseline.nodeId,
        candidateNodeId: candidate.nodeId,
        changed: sections.some((entry) => entry.change !== "same"),
        sections
    };
}
/** Deterministically replay one node from its snapshot, fail-closed on drift.
 *  `now` is injected; the deterministic payload (body + outputFingerprint) has
 *  zero wall-clock, so two replays are byte-identical. */
function replayNodeSnapshot(run, snapshot, options = {}) {
    const { freshness, reason } = loadNodeSnapshot(run, snapshot);
    if (freshness !== "valid") {
        throw new NodeSnapshotError(freshness === "stale" ? "snapshot-stale" : "snapshot-absent", reason || `cannot replay a ${freshness} snapshot of node ${snapshot.nodeId}`, { freshness, details: { runId: run.id, nodeId: snapshot.nodeId } });
    }
    const body = (0, multi_agent_eval_1.normalizeValue)(snapshot.body);
    const outputFingerprint = (0, state_explosion_1.fingerprintStrings)([(0, multi_agent_eval_1.replayStableStringify)(body)]);
    const replay = {
        schemaVersion: 1,
        replayId: `replay-${snapshot.snapshotId}-${outputFingerprint.replace("sha256:", "").slice(0, 8)}`,
        runId: run.id,
        nodeId: snapshot.nodeId,
        snapshotId: snapshot.snapshotId,
        replayedAt: options.now || new Date().toISOString(),
        freshness: "valid",
        contractValidated: Boolean(snapshot.body.contractId),
        outputFingerprint,
        body
    };
    if (options.persist !== false) {
        (0, state_1.writeJson)(node_path_1.default.join(snapshotDir(run, snapshot.nodeId), "replays", `${replay.replayId}.json`), replay);
    }
    return replay;
}
/** Compare a replay to a fresh snapshot of the source node; pass = byte-identical
 *  normalized body. Findings reuse the eval harness severity/category shape. */
function verifyNodeReplay(run, replay, options = {}) {
    const fresh = tryGetNode(run, replay.nodeId);
    if (!fresh) {
        return {
            schemaVersion: 1,
            runId: run.id,
            nodeId: replay.nodeId,
            replayId: replay.replayId,
            pass: false,
            freshness: "absent",
            findings: [{ id: "source-absent", severity: "error", category: "source", reason: `source node ${replay.nodeId} is gone` }]
        };
    }
    const freshSnapshot = snapshotNode(run, replay.nodeId, { now: options.now, persist: false });
    const diff = diffNodeSnapshots(freshSnapshot, { ...freshSnapshot, body: replay.body, snapshotId: replay.snapshotId });
    const findings = diff.sections
        .filter((section) => section.change !== "same")
        .map((section) => ({
        id: `drift:${section.section}`,
        severity: "error",
        category: section.section,
        reason: `replay diverged from source in ${section.section}`,
        baselineRef: replay.snapshotId,
        replayRef: replay.replayId
    }));
    return {
        schemaVersion: 1,
        runId: run.id,
        nodeId: replay.nodeId,
        replayId: replay.replayId,
        pass: findings.length === 0,
        freshness: "valid",
        findings
    };
}
