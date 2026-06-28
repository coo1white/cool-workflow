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

import fs from "node:fs";
import path from "node:path";
import { getRunNode } from "./pipeline-runner";
import { writeJson, safeFileName } from "./state";
import { normalizeValue, replayStableStringify } from "./multi-agent-eval";
import { projectNodeBody } from "./node-projection";
import { fingerprintStrings } from "./util/fingerprint";
import {
  NodeReplayRun,
  NodeReplayVerdict,
  NodeSnapshot,
  NodeSnapshotBody,
  NodeSnapshotDiff,
  NodeSnapshotFreshness,
  NodeSnapshotSection,
  StateNode,
  WorkflowRun
} from "./types";
import { validateNodeReplayRun, validateNodeSnapshot } from "./validation";

export const NODE_SNAPSHOT_SCHEMA_VERSION = 1;

/** Structured fail-closed error (mirrors the PipelineContractError shape). */
export class NodeSnapshotError extends Error {
  code: string;
  freshness?: NodeSnapshotFreshness;
  details?: Record<string, unknown>;
  constructor(code: string, message: string, options: { freshness?: NodeSnapshotFreshness; details?: Record<string, unknown> } = {}) {
    super(message);
    this.name = "NodeSnapshotError";
    this.code = code;
    this.freshness = options.freshness;
    this.details = options.details;
  }
}

const SNAPSHOT_SECTIONS: NodeSnapshotSection["section"][] = [
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
function snapshotBody(node: StateNode): NodeSnapshotBody {
  return projectNodeBody(node);
}

/** RAW fingerprint (NOT normalized): any transition (updatedAt/status) or
 *  artifact/evidence change flips it, which is how drift is detected. */
function sourceFingerprint(node: StateNode): string {
  return fingerprintStrings([
    `node:${node.id}:${node.status}:${node.updatedAt}`,
    ...node.artifacts.map((artifact) => `artifact:${artifact.id}:${artifact.path}`),
    ...node.evidence.map((evidence) => `evidence:${evidence.id}:${evidence.path || ""}`)
  ]);
}

function tryGetNode(run: WorkflowRun, nodeId: string): StateNode | undefined {
  try {
    return getRunNode(run, nodeId);
  } catch {
    return undefined;
  }
}

function snapshotsRoot(run: WorkflowRun): string {
  const base = run.paths.stateNodesDir || path.join(run.paths.runDir, "nodes");
  return path.join(base, "snapshots");
}

function snapshotDir(run: WorkflowRun, nodeId: string): string {
  return path.join(snapshotsRoot(run), safeFileName(nodeId));
}

/** Load a persisted snapshot by id (scans the per-node snapshot dirs). */
export function readNodeSnapshot(run: WorkflowRun, snapshotId: string): NodeSnapshot {
  const root = snapshotsRoot(run);
  if (fs.existsSync(root)) {
    for (const nodeDir of fs.readdirSync(root)) {
      const file = path.join(root, nodeDir, `${snapshotId}.json`);
      if (fs.existsSync(file)) return validateNodeSnapshot(JSON.parse(fs.readFileSync(file, "utf8")));
    }
  }
  throw new NodeSnapshotError("snapshot-not-found", `Node snapshot ${snapshotId} not found in run ${run.id}`, { freshness: "absent" });
}

/** Load a persisted replay run by id. */
export function readNodeReplay(run: WorkflowRun, replayId: string): NodeReplayRun {
  const root = snapshotsRoot(run);
  if (fs.existsSync(root)) {
    for (const nodeDir of fs.readdirSync(root)) {
      const file = path.join(root, nodeDir, "replays", `${replayId}.json`);
      if (fs.existsSync(file)) return validateNodeReplayRun(JSON.parse(fs.readFileSync(file, "utf8")));
    }
  }
  throw new NodeSnapshotError("replay-not-found", `Node replay ${replayId} not found in run ${run.id}`, { freshness: "absent" });
}

export interface SnapshotOptions {
  now?: string;
  persist?: boolean;
}

/** Snapshot one StateNode by id. Throws (fail closed) if the node is absent. */
export function snapshotNode(run: WorkflowRun, nodeId: string, options: SnapshotOptions = {}): NodeSnapshot {
  const node = tryGetNode(run, nodeId);
  if (!node) {
    throw new NodeSnapshotError("node-absent", `Cannot snapshot: node ${nodeId} not found in run ${run.id}`, { freshness: "absent" });
  }
  const fingerprint = sourceFingerprint(node);
  const snapshot: NodeSnapshot = {
    schemaVersion: 1,
    snapshotId: `snap-${safeFileName(nodeId)}-${fingerprint.replace("sha256:", "").slice(0, 12)}`,
    runId: run.id,
    nodeId,
    capturedAt: options.now || new Date().toISOString(),
    sourceFingerprint: fingerprint,
    body: snapshotBody(node)
  };
  if (options.persist !== false) {
    writeJson(path.join(snapshotDir(run, nodeId), `${snapshot.snapshotId}.json`), snapshot);
  }
  return snapshot;
}

/** Recompute freshness from current source. valid | stale | absent. */
export function loadNodeSnapshot(
  run: WorkflowRun,
  snapshot: NodeSnapshot
): { snapshot: NodeSnapshot; freshness: NodeSnapshotFreshness; reason?: string } {
  const node = tryGetNode(run, snapshot.nodeId);
  if (!node) {
    return { snapshot, freshness: "absent", reason: `source node ${snapshot.nodeId} is gone from run ${run.id}` };
  }
  const missingArtifact = node.artifacts.find((artifact) => artifact.path && !fs.existsSync(artifact.path));
  if (missingArtifact) {
    return { snapshot, freshness: "absent", reason: `referenced artifact path is unreadable: ${missingArtifact.id}` };
  }
  if (sourceFingerprint(node) !== snapshot.sourceFingerprint) {
    return { snapshot, freshness: "stale", reason: `source node ${snapshot.nodeId} changed since capture` };
  }
  return { snapshot, freshness: "valid" };
}

function sectionValue(body: NodeSnapshotBody, section: NodeSnapshotSection["section"]): unknown {
  if (section === "links") return { parents: body.parents, children: body.children };
  return (body as unknown as Record<string, unknown>)[section];
}

/** Stable, structural diff of two snapshots (same node id or two explicit ids). */
export function diffNodeSnapshots(baseline: NodeSnapshot, candidate: NodeSnapshot): NodeSnapshotDiff {
  const sections: NodeSnapshotSection[] = SNAPSHOT_SECTIONS.map((section) => {
    const baselineValue = sectionValue(baseline.body, section);
    const candidateValue = sectionValue(candidate.body, section);
    const sameBytes = replayStableStringify(baselineValue) === replayStableStringify(candidateValue);
    let change: NodeSnapshotSection["change"];
    if (sameBytes) change = "same";
    else if (baselineValue === undefined) change = "added";
    else if (candidateValue === undefined) change = "removed";
    else change = "changed";
    const entry: NodeSnapshotSection = { section, change };
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

export interface ReplayOptions {
  now?: string;
  persist?: boolean;
}

/** Deterministically replay one node from its snapshot, fail-closed on drift.
 *  `now` is injected; the deterministic payload (body + outputFingerprint) has
 *  zero wall-clock, so two replays are byte-identical. */
export function replayNodeSnapshot(run: WorkflowRun, snapshot: NodeSnapshot, options: ReplayOptions = {}): NodeReplayRun {
  const { freshness, reason } = loadNodeSnapshot(run, snapshot);
  if (freshness !== "valid") {
    throw new NodeSnapshotError(
      freshness === "stale" ? "snapshot-stale" : "snapshot-absent",
      reason || `cannot replay a ${freshness} snapshot of node ${snapshot.nodeId}`,
      { freshness, details: { runId: run.id, nodeId: snapshot.nodeId } }
    );
  }
  const body = normalizeValue(snapshot.body) as NodeSnapshotBody;
  const outputFingerprint = fingerprintStrings([replayStableStringify(body)]);
  const replay: NodeReplayRun = {
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
    writeJson(path.join(snapshotDir(run, snapshot.nodeId), "replays", `${replay.replayId}.json`), replay);
  }
  return replay;
}

/** Compare a replay to a fresh snapshot of the source node; pass = byte-identical
 *  normalized body. Findings reuse the eval harness severity/category shape. */
export function verifyNodeReplay(run: WorkflowRun, replay: NodeReplayRun, options: { now?: string } = {}): NodeReplayVerdict {
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
      severity: "error" as const,
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
