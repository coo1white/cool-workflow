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

import { fingerprintStrings } from "../hash";
import { projectNodeBody, replayStableStringify, normalizeValue } from "./node-projection";
import {
  NodeReplayRun,
  NodeReplayVerdict,
  NodeSnapshot,
  NodeSnapshotBody,
  NodeSnapshotDiff,
  NodeSnapshotFreshness,
  NodeSnapshotSection,
  StateNode,
  WorkflowRun,
} from "./types";

export const NODE_SNAPSHOT_SCHEMA_VERSION = 1;

/** Structured fail-closed error (mirrors PipelineContractError's shape). */
export class NodeSnapshotError extends Error {
  code: string;
  freshness?: NodeSnapshotFreshness;
  details?: Record<string, unknown>;
  constructor(
    code: string,
    message: string,
    options: { freshness?: NodeSnapshotFreshness; details?: Record<string, unknown> } = {}
  ) {
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
  "metadata",
];

/** Look up a StateNode by id in `run.nodes`, or `undefined` if absent. Pure
 *  data lookup — no fs. */
function findRunNode(run: WorkflowRun, nodeId: string): StateNode | undefined {
  return (run.nodes || []).find((candidate) => candidate.id === nodeId);
}

/** NORMALIZED projection of a node — timestamps/paths stripped, so it is
 *  byte-stable across captures of the same logical state. */
function snapshotBody(node: StateNode): NodeSnapshotBody {
  return projectNodeBody(node);
}

/** RAW fingerprint (NOT normalized): any transition (updatedAt/status) or
 *  artifact/evidence change flips it — this is how drift is detected. */
export function sourceFingerprint(node: StateNode): string {
  return fingerprintStrings([
    `node:${node.id}:${node.status}:${node.updatedAt}`,
    ...node.artifacts.map((artifact) => `artifact:${artifact.id}:${artifact.path}`),
    ...node.evidence.map((evidence) => `evidence:${evidence.id}:${evidence.path || ""}`),
  ]);
}

export interface SnapshotOptions {
  now?: string;
  /** Called with the built snapshot + its persist path segments when
   *  `persist !== false`; shell/node-store.ts wires this to a real
   *  `writeJson` call. Absent/`persist:false` writes nothing. */
  persist?: false | ((snapshot: NodeSnapshot) => void);
}

/** Snapshot one StateNode by id. Throws (fail closed) if the node is
 *  absent. */
export function snapshotNode(run: WorkflowRun, nodeId: string, options: SnapshotOptions = {}): NodeSnapshot {
  const node = findRunNode(run, nodeId);
  if (!node) {
    throw new NodeSnapshotError("node-absent", `Cannot snapshot: node ${nodeId} not found in run ${run.id}`, {
      freshness: "absent",
    });
  }
  const fingerprint = sourceFingerprint(node);
  const snapshot: NodeSnapshot = {
    schemaVersion: 1,
    snapshotId: `snap-${safeFileNamePure(nodeId)}-${fingerprint.replace("sha256:", "").slice(0, 12)}`,
    runId: run.id,
    nodeId,
    capturedAt: options.now || new Date(0).toISOString(),
    sourceFingerprint: fingerprint,
    body: snapshotBody(node),
  };
  if (options.persist !== false && typeof options.persist === "function") options.persist(snapshot);
  return snapshot;
}

/** Recompute freshness from the CURRENT source. `valid | stale | absent`. */
export function loadNodeSnapshot(
  run: WorkflowRun,
  snapshot: NodeSnapshot,
  pathExists: (p: string) => boolean = () => true
): { snapshot: NodeSnapshot; freshness: NodeSnapshotFreshness; reason?: string } {
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

function sectionValue(body: NodeSnapshotBody, section: NodeSnapshotSection["section"]): unknown {
  if (section === "links") return { parents: body.parents, children: body.children };
  return (body as unknown as Record<string, unknown>)[section];
}

/** Stable, structural diff of two snapshots: 8 sections, in fixed order. */
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
    sections,
  };
}

export interface ReplayOptions {
  now?: string;
  persist?: false | ((replay: NodeReplayRun) => void);
  pathExists?: (p: string) => boolean;
}

/** Deterministically replay one node from its snapshot, fail-closed on
 *  drift: freshness not `valid` throws `snapshot-stale`/`snapshot-absent`
 *  BEFORE any replay bytes are built. */
export function replayNodeSnapshot(run: WorkflowRun, snapshot: NodeSnapshot, options: ReplayOptions = {}): NodeReplayRun {
  const { freshness, reason } = loadNodeSnapshot(run, snapshot, options.pathExists);
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
    replayedAt: options.now || new Date(0).toISOString(),
    freshness: "valid",
    contractValidated: Boolean(snapshot.body.contractId),
    outputFingerprint,
    body,
  };
  if (options.persist !== false && typeof options.persist === "function") options.persist(replay);
  return replay;
}

/** Compare a replay to a FRESH (non-persisted) snapshot of the source node;
 *  pass = byte-identical normalized body. Never throws — a drifted source
 *  is a `pass:false` finding, not an exception. */
export function verifyNodeReplay(run: WorkflowRun, replay: NodeReplayRun, options: { now?: string } = {}): NodeReplayVerdict {
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
      severity: "error" as const,
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
function safeFileNamePure(value: string): string {
  return value.replace(/[^a-zA-Z0-9_.:-]+/g, "_");
}
