import type { LoopStage } from "./core";

// ---------------------------------------------------------------------------
// Run Registry / Control Plane (v0.1.28)
//
// MECHANISM, NOT POLICY. The per-run `.cw/runs/<id>/state.json` is the single
// source of truth (see loadRunFromCwd). The registry below is a DERIVED,
// rebuildable index over those runs — never authoritative. Every record carries
// a `sourceFingerprint` and a `freshness` so a reader can tell whether the cache
// still matches source, exactly like the v0.1.25 state-explosion summaries.
// Lifecycle is CLASSIFIED from existing state, never invented. Archive is an
// overlay (mark), never a delete. Rerun creates a NEW run that links back to the
// original via provenance; the failed run is preserved.
// ---------------------------------------------------------------------------

/** Documented run lifecycle. Derived from source state, never invented.
 *  `archived` is an overlay disposition; `RunRecord.derivedLifecycle` always
 *  preserves the underlying source-derived state so search can still match it. */
export type RunLifecycleState =
  | "queued"
  | "running"
  | "blocked"
  | "completed"
  | "failed"
  | "archived";

/** Per-record freshness against the run's source state.json. `missing` means the
 *  source vanished — fail closed, never fabricated as success. */
export type RunRecordFreshness = "valid" | "stale" | "missing";

/** Index-level freshness, same vocabulary as the state-explosion report. */
export type RunRegistryFreshness = "valid" | "stale" | "absent";

/** Provenance link recorded when a failed run is re-run as a NEW run. The failed
 *  original is never overwritten; this is how the new run points back to it. */
export interface RunProvenance {
  /** The immediate failed run this run was derived from. */
  rerunOf?: string;
  /** Repo root that owns the original run (cross-repo rerun is allowed). */
  rerunOfRepo?: string;
  /** Root of the rerun chain (the very first run). */
  originRunId?: string;
  /** 1 for a first rerun, 2 for a rerun of a rerun, etc. */
  generation?: number;
  reason?: string;
  createdAt?: string;
}

/** One derived row in the registry. Everything here is recomputed from source. */
export interface RunRecord {
  schemaVersion: 1;
  runId: string;
  appId?: string;
  appVersion?: string;
  workflowId: string;
  title?: string;
  /** Absolute repo root (the cwd that owns this run's `.cw/runs/`). */
  repo: string;
  /** Absolute path to `.cw/runs/<id>`. */
  runDir: string;
  /** Absolute path to the source `state.json`. */
  statePath: string;
  createdAt: string;
  updatedAt: string;
  loopStage: LoopStage;
  /** Lifecycle as surfaced (includes the archive overlay). */
  lifecycle: RunLifecycleState;
  /** Lifecycle derived purely from source state, ignoring the archive overlay. */
  derivedLifecycle: RunLifecycleState;
  archived: boolean;
  archivedAt?: string;
  archiveReason?: string;
  tasks: {
    total: number;
    pending: number;
    running: number;
    failed: number;
    completed: number;
  };
  commitCount: number;
  verifierGatedCommitCount: number;
  openFeedbackCount: number;
  /** Distinct execution backends used by this run's dispatches (sorted). Empty
   *  when no backend was ever selected (pre-v0.1.29 / default-only runs). */
  backends?: string[];
  /** Bounded, deterministic digest of run inputs so free-text search can match
   *  run metadata (e.g. the question) without bloating the index. */
  inputsDigest?: string;
  /** Fingerprint of the source state.json that this record was derived from. */
  sourceFingerprint: string;
  freshness: RunRecordFreshness;
  provenance?: RunProvenance;
}

/** A durable, ordered queue entry. Plain files; the host still executes workers.
 *  Lower `priority` drains first; ties break by `enqueuedAt` then `id`. */
export interface RunQueueEntry {
  schemaVersion: 1;
  id: string;
  /** Optional existing planned run id this entry will continue. */
  runId?: string;
  appId?: string;
  workflowId?: string;
  repo: string;
  priority: number;
  enqueuedAt: string;
  status: "pending" | "ready" | "draining" | "drained" | "cancelled";
  drainedAt?: string;
  inputs?: Record<string, unknown>;
  provenance?: RunProvenance;
  note?: string;
}

/** Lifecycle-policy knobs. POLICY, not mechanism — kept out of the index and
 *  configurable. Retention windows and archive thresholds live here. */
export interface RunRegistryPolicy {
  schemaVersion: 1;
  /** Archive completed/failed runs older than this many days (0 = disabled). */
  archiveOlderThanDays: number;
  /** Lifecycle states eligible for retention archiving. */
  archiveStates: RunLifecycleState[];
  /** Default queue priority for new entries. */
  defaultQueuePriority: number;
}

export interface RunRegistryCounts {
  total: number;
  queued: number;
  running: number;
  blocked: number;
  completed: number;
  failed: number;
  archived: number;
}

/** The derived, rebuildable index. Persisted under `.cw/registry/` (per-repo) or
 *  `$CW_HOME/registry/` (cross-repo). Rebuildable from source at any time. */
export interface RunRegistryIndex {
  schemaVersion: 1;
  scope: "repo" | "home";
  /** Repo root (repo scope) or home dir (home scope). */
  root: string;
  generatedAt: string;
  /** Fingerprint over all member records' source fingerprints + repo set. */
  sourceFingerprint: string;
  /** Repo roots covered (home scope); single repo for repo scope. */
  repos: string[];
  records: RunRecord[];
  queue: RunQueueEntry[];
  counts: RunRegistryCounts;
}

/** A registry read with explicit freshness against current source state. The
 *  fail-closed contract: a stale/absent index reports it and recommends rebuild;
 *  records are always re-derived from source, never fabricated from the cache. */
export interface RunRegistryReport {
  schemaVersion: 1;
  scope: "repo" | "home";
  root: string;
  generatedAt: string;
  freshness: {
    status: RunRegistryFreshness;
    persistedFingerprint?: string;
    currentFingerprint: string;
    /** runIds whose source state changed since the index was persisted. */
    staleRuns: string[];
    /** runIds present in the persisted index whose source state is gone. */
    missingRuns: string[];
  };
  index: RunRegistryIndex;
  counts: RunRegistryCounts;
  nextAction: string;
}

/** Deterministic, paginated search result over the registry. */
export interface RunSearchResult {
  schemaVersion: 1;
  scope: "repo" | "home";
  query: RunSearchQuery;
  freshness: RunRegistryFreshness;
  total: number;
  offset: number;
  limit: number;
  records: RunRecord[];
  nextAction: string;
}

export interface RunSearchQuery {
  text?: string;
  app?: string;
  status?: RunLifecycleState;
  repo?: string;
  since?: string;
  until?: string;
  includeArchived: boolean;
  offset: number;
  limit: number;
}

/** Resolve + continue an interrupted run from durable state. Read-only over
 *  source: it locates the run across repos and returns the next steps; the host
 *  executes them. Source state.json is never mutated by resume. */
export interface RunResumeResult {
  schemaVersion: 1;
  runId: string;
  repo: string;
  runDir: string;
  statePath: string;
  resolvedFrom: "repo" | "home";
  lifecycle: RunLifecycleState;
  derivedLifecycle: RunLifecycleState;
  loopStage: LoopStage;
  freshness: RunRecordFreshness;
  resumable: boolean;
  reason?: string;
  record: RunRecord;
  nextTasks: Array<{ id: string; phase?: string; status: string; taskPath?: string }>;
  nextActions: Array<{ command: string; reason: string }>;
}

/** Rerun a failed run as a NEW run that links to the original via provenance. */
export interface RunRerunResult {
  schemaVersion: 1;
  originalRunId: string;
  originalRepo: string;
  originalLifecycle: RunLifecycleState;
  newRunId: string;
  repo: string;
  appId?: string;
  workflowId: string;
  statePath: string;
  reportPath: string;
  pendingTasks: number;
  provenance: RunProvenance;
  nextActions: Array<{ command: string; reason: string }>;
}

/** Resolve a single run by id across the registry, fail-closed on missing source. */
export interface RunShowResult {
  schemaVersion: 1;
  runId: string;
  found: boolean;
  freshness: RunRecordFreshness;
  resolvedFrom?: "repo" | "home";
  repo?: string;
  record?: RunRecord;
  /** Last-known persisted record when source is missing — clearly flagged, never
   *  surfaced as a live status. */
  persisted?: RunRecord;
  nextAction: string;
}

/** Cross-repo unified timeline entry, newest first. */
export interface RunHistoryEntry {
  runId: string;
  repo: string;
  appId?: string;
  workflowId: string;
  lifecycle: RunLifecycleState;
  loopStage: LoopStage;
  createdAt: string;
  updatedAt: string;
  freshness: RunRecordFreshness;
  provenance?: RunProvenance;
}

export interface RunHistoryResult {
  schemaVersion: 1;
  scope: "repo" | "home";
  freshness: RunRegistryFreshness;
  total: number;
  offset: number;
  limit: number;
  repos: string[];
  entries: RunHistoryEntry[];
  nextAction: string;
}
