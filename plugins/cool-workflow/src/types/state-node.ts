import type { LoopStage, StateNodeKind, StateNodeStatus } from "./core";
import type { StateArtifact, StateEvidence } from "./result";

export interface StateNodeError {
  code: string;
  message: string;
  at: string;
  nodeId?: string;
  path?: string;
  retryable?: boolean;
  details?: Record<string, unknown>;
}

export interface StateNode {
  schemaVersion: 1;
  id: string;
  kind: StateNodeKind;
  status: StateNodeStatus;
  loopStage: LoopStage;
  createdAt: string;
  updatedAt: string;
  inputs: Record<string, unknown>;
  outputs: Record<string, unknown>;
  artifacts: StateArtifact[];
  evidence: StateEvidence[];
  errors: StateNodeError[];
  parents: string[];
  children: string[];
  contractId?: string;
  metadata?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Node Snapshot / Diff / Replay (v0.1.35). Per-node granularity over the eval
// harness: DERIVED, sha256-fingerprinted projections of a single StateNode that
// can be diffed structurally and replayed deterministically. Additive — the
// source StateNode and STATE_NODE_SCHEMA_VERSION are unchanged.
// ---------------------------------------------------------------------------

/** Freshness of a node snapshot vs current source (v0.1.25 pattern). */
export type NodeSnapshotFreshness = "valid" | "stale" | "absent";

/** The normalized, derived projection of one StateNode (timestamps/paths
 *  stripped via the eval harness normalizer, so it is byte-stable across
 *  captures of the same logical state). */
export interface NodeSnapshotBody {
  id: string;
  kind: StateNodeKind;
  status: StateNodeStatus;
  loopStage: LoopStage;
  inputs: Record<string, unknown>;
  outputs: Record<string, unknown>;
  artifacts: StateArtifact[];
  evidence: StateEvidence[];
  errors: StateNodeError[];
  parents: string[];
  children: string[];
  contractId?: string;
  metadata?: Record<string, unknown>;
}

export interface NodeSnapshot {
  schemaVersion: 1;
  snapshotId: string;
  runId: string;
  nodeId: string;
  capturedAt: string;
  /** sha256 over raw id:status:updatedAt + artifact/evidence ids+paths — detects
   *  source drift (any transition flips it). Raw, NOT normalized. */
  sourceFingerprint: string;
  body: NodeSnapshotBody;
}

export interface NodeSnapshotSection {
  section: "status" | "inputs" | "outputs" | "artifacts" | "evidence" | "errors" | "links" | "metadata";
  change: "added" | "removed" | "changed" | "same";
  baseline?: unknown;
  candidate?: unknown;
}

export interface NodeSnapshotDiff {
  schemaVersion: 1;
  runId: string;
  baselineSnapshotId: string;
  candidateSnapshotId: string;
  baselineNodeId: string;
  candidateNodeId: string;
  changed: boolean;
  sections: NodeSnapshotSection[];
}

export interface NodeReplayRun {
  schemaVersion: 1;
  replayId: string;
  runId: string;
  nodeId: string;
  snapshotId: string;
  replayedAt: string;
  freshness: NodeSnapshotFreshness;
  contractValidated: boolean;
  /** Deterministic digest of the reconstructed normalized node — no wall-clock,
   *  so two replays of one snapshot are byte-identical. */
  outputFingerprint: string;
  body: NodeSnapshotBody;
}

export interface NodeReplayFinding {
  id: string;
  severity: "info" | "warn" | "error";
  category: string;
  reason: string;
  baselineRef?: string;
  replayRef?: string;
}

export interface NodeReplayVerdict {
  schemaVersion: 1;
  runId: string;
  nodeId: string;
  replayId: string;
  pass: boolean;
  freshness: NodeSnapshotFreshness;
  findings: NodeReplayFinding[];
}
