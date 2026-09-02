"use strict";
// core/state/node-snapshot.ts — snapshotNode / diffNodeSnapshots /
// replayNodeSnapshot / verifyNodeReplay.
//
// MILESTONE 3. Byte-exact port of the old build's node-snapshot module,
// split into a PURE half (this file) and a shell half (shell/node-
// store.ts, which supplies the actual `writeJson` persistence and file
// scans for readNodeSnapshot/readNodeReplay). Every function here is pure
// given `(run, clock)` — no direct fs/Date calls; `now` is always an
// explicit parameter, `persist` is always a caller-supplied callback.
//
// RAW vs NORMALIZED fingerprints [project/docs/rebuild/PLAN.md byte-compat item 8 — do not
// merge these two code paths]:
//   - `sourceFingerprint` is RAW: built from the node's raw id/status/
//     updatedAt plus raw artifact/evidence id+path strings. ANY transition
//     (even just `updatedAt` ticking) flips it — this is what freshness
//     detection needs.
//   - `body`/`outputFingerprint` are NORMALIZED via `projectNodeBody`/
//     `replayStableStringify` (node-projection.ts): no timestamps, scrubbed
//     paths, so replay output is byte-stable across recaptures of the same
//     logical state.
// These stay two separate functions (`sourceFingerprint` vs
// `snapshotBody`/`outputFingerprint`'s computation) — never one call.
//
// Evidence: SPEC/state-core.md "node-snapshot module — snapshot / diff /
// replay", "Raw vs. normalized fingerprints", "Snapshot freshness
// fail-closed".
Object.defineProperty(exports, "__esModule", { value: true });
exports.NodeSnapshotError = void 0;
exports.sourceFingerprint = sourceFingerprint;
exports.snapshotNode = snapshotNode;
exports.loadNodeSnapshot = loadNodeSnapshot;
exports.diffNodeSnapshots = diffNodeSnapshots;
exports.replayNodeSnapshot = replayNodeSnapshot;
exports.verifyNodeReplay = verifyNodeReplay;
const hash_1 = require("../hash");
const node_projection_1 = require("./node-projection");
/** Structured fail-closed error (mirrors PipelineContractError's shape). */
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
    "metadata",
];
/** Look up a StateNode by id in `run.nodes`, or `undefined` if absent. Pure
 *  data lookup — no fs. */
function findRunNode(run, nodeId) {
    return (run.nodes || []).find((candidate) => candidate.id === nodeId);
}
/** NORMALIZED projection of a node — timestamps/paths stripped, so it is
 *  byte-stable across captures of the same logical state. */
function snapshotBody(node) {
    return (0, node_projection_1.projectNodeBody)(node);
}
/** RAW fingerprint (NOT normalized): any transition (updatedAt/status) or
 *  artifact/evidence change flips it — this is how drift is detected. */
function sourceFingerprint(node) {
    return (0, hash_1.fingerprintStrings)([
        `node:${node.id}:${node.status}:${node.updatedAt}`,
        ...node.artifacts.map((artifact) => `artifact:${artifact.id}:${artifact.path}`),
        ...node.evidence.map((evidence) => `evidence:${evidence.id}:${evidence.path || ""}`),
    ]);
}
/** Snapshot one StateNode by id. Throws (fail closed) if the node is
 *  absent. */
function snapshotNode(run, nodeId, options = {}) {
    const node = findRunNode(run, nodeId);
    if (!node) {
        throw new NodeSnapshotError("node-absent", `Cannot snapshot: node ${nodeId} not found in run ${run.id}`, {
            freshness: "absent",
        });
    }
    const fingerprint = sourceFingerprint(node);
    const snapshot = {
        schemaVersion: 1,
        snapshotId: `snap-${safeFileNamePure(nodeId)}-${fingerprint.replace("sha256:", "").slice(0, 12)}`,
        runId: run.id,
        nodeId,
        capturedAt: options.now || new Date(0).toISOString(),
        sourceFingerprint: fingerprint,
        body: snapshotBody(node),
    };
    if (options.persist !== false && typeof options.persist === "function")
        options.persist(snapshot);
    return snapshot;
}
/** Recompute freshness from the CURRENT source. `valid | stale | absent`. */
function loadNodeSnapshot(run, snapshot, pathExists = () => true) {
    const node = findRunNode(run, snapshot.nodeId);
    if (!node) {
        return { snapshot, freshness: "absent", reason: `source node ${snapshot.nodeId} is gone from run ${run.id}` };
    }
    const missingArtifact = node.artifacts.find((artifact) => artifact.path && !pathExists(artifact.path));
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
/** Stable, structural diff of two snapshots: 8 sections, in fixed order. */
function diffNodeSnapshots(baseline, candidate) {
    const sections = SNAPSHOT_SECTIONS.map((section) => {
        const baselineValue = sectionValue(baseline.body, section);
        const candidateValue = sectionValue(candidate.body, section);
        const sameBytes = (0, node_projection_1.replayStableStringify)(baselineValue) === (0, node_projection_1.replayStableStringify)(candidateValue);
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
        sections,
    };
}
/** Deterministically replay one node from its snapshot, fail-closed on
 *  drift: freshness not `valid` throws `snapshot-stale`/`snapshot-absent`
 *  BEFORE any replay bytes are built. */
function replayNodeSnapshot(run, snapshot, options = {}) {
    const { freshness, reason } = loadNodeSnapshot(run, snapshot, options.pathExists);
    if (freshness !== "valid") {
        throw new NodeSnapshotError(freshness === "stale" ? "snapshot-stale" : "snapshot-absent", reason || `cannot replay a ${freshness} snapshot of node ${snapshot.nodeId}`, { freshness, details: { runId: run.id, nodeId: snapshot.nodeId } });
    }
    const body = (0, node_projection_1.normalizeValue)(snapshot.body);
    const outputFingerprint = (0, hash_1.fingerprintStrings)([(0, node_projection_1.replayStableStringify)(body)]);
    const replay = {
        schemaVersion: 1,
        replayId: `replay-${snapshot.snapshotId}-${outputFingerprint.replace("sha256:", "").slice(0, 8)}`,
        runId: run.id,
        nodeId: snapshot.nodeId,
        snapshotId: snapshot.snapshotId,
        replayedAt: options.now || new Date(0).toISOString(),
        freshness: "valid",
        contractValidated: Boolean(snapshot.body.contractId),
        outputFingerprint,
        body,
    };
    if (options.persist !== false && typeof options.persist === "function")
        options.persist(replay);
    return replay;
}
/** Compare a replay to a FRESH (non-persisted) snapshot of the source node;
 *  pass = byte-identical normalized body. Never throws — a drifted source
 *  is a `pass:false` finding, not an exception. */
function verifyNodeReplay(run, replay, options = {}) {
    const fresh = findRunNode(run, replay.nodeId);
    if (!fresh) {
        return {
            schemaVersion: 1,
            runId: run.id,
            nodeId: replay.nodeId,
            replayId: replay.replayId,
            pass: false,
            freshness: "absent",
            findings: [{ id: "source-absent", severity: "error", category: "source", reason: `source node ${replay.nodeId} is gone` }],
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
        replayRef: replay.replayId,
    }));
    return {
        schemaVersion: 1,
        runId: run.id,
        nodeId: replay.nodeId,
        replayId: replay.replayId,
        pass: findings.length === 0,
        freshness: "valid",
        findings,
    };
}
/** Pure re-implementation of shell/fs-atomic.ts's naming rule (replaces
 *  every run of chars outside `[a-zA-Z0-9_.:-]` with a single `_`), needed
 *  here purely as a STRING transform for id formatting — no fs. Kept in
 *  sync with `safeFileName` by the same regex; both are pinned by the same
 *  SPEC line (state-core.md's `safeFileName(value)`). */
function safeFileNamePure(value) {
    return value.replace(/[^a-zA-Z0-9_.:-]+/g, "_");
}
