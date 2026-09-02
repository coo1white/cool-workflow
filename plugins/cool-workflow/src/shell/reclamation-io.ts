// shell/reclamation-io.ts — gc plan/run/verify's write-ahead reclamation
// transaction, plus the orphan-run sweep and the clone cache gc.
//
// MILESTONE 10 (plugins/cool-workflow/project/docs/rebuild/PLAN.md build order, step 10). Byte-exact port of the
// old build's src/reclamation.ts + src/reclamation/hash.ts +
// src/run-registry/{gc,orphans}.ts + src/clones.ts. Reuses
// shell/fs-atomic.ts's `withFileLock` directly (no reimplementation, per
// the task's instruction) and core/state/node-projection.ts's
// `replayStableStringify`/`nodeProjectionDigestInput` so the tombstone
// hash-chain input shares the exact same canonical bytes as node-
// snapshot.ts (never re-derived).
//
// WRITE-AHEAD ORDER (the safety property; SPEC/scheduling-registry.md
// section E, "Rebuild risks" #2): extractSkeleton -> validateSkeleton +
// validateSkeletonAgainstRun (refuse skeleton-incomplete) -> under the
// per-run lock: planReclamation + buildTombstone + commitTombstone
// (durable fsync) -> prepareFree (re-point node artifacts off scratch,
// persist state.json durably, prove no dangling reference; refuse
// repoint-incomplete) -> freeBulk. A crash between any two steps leaves
// EITHER the full run OR a complete tombstone, never half-deleted.
//
// tombstoneHash reproducibility: `freeable` MUST be sorted by path bytes
// BEFORE it is hashed (this is exactly what the tombstonesort-*.case.js
// conformance cases pin) — see `planReclamation`'s explicit sort below.
//
// Evidence: SPEC/scheduling-registry.md sections E, F, G;
// plugins/cool-workflow/src/reclamation.ts, src/reclamation/hash.ts,
// src/run-registry/{gc,orphans}.ts, src/clones.ts (byte-exact source).

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { isContainedPath, realResolve, withFileLock, writeJson } from "./fs-atomic";
import { recordTrustAuditEvent, listTrustAuditEvents } from "./trust-audit";
import { snapshotNode } from "./node-store";
import { loadNodeSnapshot } from "../core/state/node-snapshot";
import { nodeProjectionDigestInput, replayStableStringify } from "../core/state/node-projection";
import { sha256, sha256Bytes } from "../core/hash";
import { stableCompare } from "../core/util/collate";
import { StateNode, WorkflowRun } from "../core/state/types";
import {
  compareBytes,
  DEFAULT_RUN_REGISTRY_POLICY,
  RunLifecycleState,
  RunCapability,
  RunCapabilityReason,
  RunRecord,
  RunRegistryIndex,
  RunRegistryPolicy,
} from "./run-registry-io";

// ---------------------------------------------------------------------------
// Content addressing + byte measurement (in-process, no `du`) — carried
// forward from src/reclamation/hash.ts.
// ---------------------------------------------------------------------------

export function sha256OfString(value: string): string {
  return sha256(value);
}

export function sha256OfFile(file: string): string {
  return `sha256:${sha256Bytes(fs.readFileSync(file))}`;
}

/** Walk a path and sum file sizes IN-PROCESS. Returns 0 if absent. */
export function dirBytes(p: string): number {
  let stat: fs.Stats;
  try {
    stat = fs.statSync(p);
  } catch {
    return 0;
  }
  if (stat.isFile()) return stat.size;
  if (!stat.isDirectory()) return 0;
  let total = 0;
  for (const entry of fs.readdirSync(p, { withFileTypes: true })) {
    total += dirBytes(path.join(p, entry.name));
  }
  return total;
}

/** Stable content digest of a path (file = its bytes; dir = digest over
 *  each member's relative path + bytes, sorted). */
function contentDigest(p: string): string {
  const stat = fs.statSync(p);
  if (stat.isFile()) return sha256OfFile(p);
  const parts: string[] = [];
  const walk = (dir: string, rel: string): void => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => compareBytes(a.name, b.name))) {
      const abs = path.join(dir, entry.name);
      const r = path.join(rel, entry.name);
      if (entry.isDirectory()) walk(abs, r);
      else parts.push(`${r}:${sha256OfFile(abs)}`);
    }
  };
  walk(p, "");
  return sha256OfString(parts.join("\n"));
}

// ---------------------------------------------------------------------------
// Reclamation types (byte-exact port of src/types/reclamation.ts)
// ---------------------------------------------------------------------------

export type ReclaimKind = "scratch" | "reconstructable-snapshot" | "candidate" | "reference-free-blackboard" | "commit-snapshot";

export interface ReconstructionRecipe {
  recipeKind: string;
  inputDigests: string[];
  inputsDigest: string;
  expectDigest: string;
  sourceRef?: string;
}

export interface FreedManifestEntry {
  path: string;
  kind: ReclaimKind;
  bytes: number;
  sha256: string;
  recipe?: ReconstructionRecipe;
}

export interface ReclamationSkeleton {
  schemaVersion: 1;
  runId: string;
  finalVerdict: { lifecycle: RunLifecycleState; loopStage: string; terminal: boolean; commitGated: boolean };
  commits: Array<{
    id: string;
    verifierGated: boolean;
    checkpoint: boolean;
    candidateId?: string;
    selectionId?: string;
    verifierNodeId?: string;
    evidenceCount: number;
    acceptanceRationale?: Record<string, unknown>;
  }>;
  evidenceDigests: Array<{ ref: string; digest: string }>;
  attestationChain: { auditLogDigest: string; eventCount: number; events: Array<{ id: string; kind: string; decision: string; createdAt: string }> };
  costRecord: { tasks: Array<{ taskId: string; model?: string; source?: string }>; metricsDigest?: string };
  auditLog: { path: string; digest: string };
  collaborationLog: { digest: string; approvals: number; comments: number; handoffs: number };
  stateDigest: string;
}

export interface ReclamationTombstone {
  schemaVersion: 1;
  runId: string;
  tombstoneId: string;
  reclaimedAt: string;
  actor?: string;
  policyDigest: string;
  freed: FreedManifestEntry[];
  bytesFreed: number;
  skeleton: ReclamationSkeleton;
  capability: RunCapability;
  capabilityReason: RunCapabilityReason;
  prevTombstoneHash: string;
  tombstoneHash: string;
}

export interface ReclaimedOverlay {
  schemaVersion: 1;
  runId: string;
  tombstones: ReclamationTombstone[];
  /** true when reclaimed.json EXISTS but failed to parse/validate — distinct
   *  from a genuinely absent file (no tombstones is the correct, fail-open
   *  reading for "never reclaimed"). A corrupted log must fail CLOSED: never
   *  read as empty and never durably overwritten with a fresh genesis
   *  tombstone. See buildTombstone, reclaimEligibility, verifyReclamation. */
  corrupted?: boolean;
}

export type ReclaimRefusalCode =
  | "not-archived"
  | "within-retention"
  | "non-terminal"
  | "open-feedback"
  | "unreadable"
  | "already-reclaimed"
  | "reclamation-log-corrupted"
  | "skeleton-incomplete";

export type ReclaimVerifyCode =
  | "not-reclaimed"
  | "reclamation-log-corrupted"
  | "skeleton-incomplete"
  | "tombstone-digest-mismatch"
  | "tombstone-chain-broken"
  | "reconstruction-digest-mismatch"
  | "ineligible-when-reclaimed"
  | "reclaim-proof-deleted";

export interface GcPlanFreeable {
  path: string;
  kind: ReclaimKind;
  bytes: number;
}
export interface GcPlanEntry {
  runId: string;
  repo: string;
  eligible: boolean;
  reason: string;
  tier: string;
  capability: RunCapability;
  capabilityReason: RunCapabilityReason;
  bytesToFree: number;
  byKind: Partial<Record<ReclaimKind, number>>;
  freeable: GcPlanFreeable[];
}
export interface GcPlanResult {
  schemaVersion: 1;
  scope: "repo" | "home";
  generatedAt: string;
  policy: { reclaimAfterArchiveDays: number; keepSnapshots: boolean; keepScratch: boolean; keepCommits: boolean; reclaimStates: RunLifecycleState[] };
  total: number;
  eligibleCount: number;
  bytesToFree: number;
  entries: GcPlanEntry[];
  nextAction: string;
}
export interface GcRunReclaimed {
  runId: string;
  bytesFreed: number;
  tombstoneHash: string;
  capability: RunCapability;
  capabilityReason: RunCapabilityReason;
}
export interface GcRunRefused {
  runId: string;
  code: ReclaimRefusalCode;
}
export interface GcRunResult {
  schemaVersion: 1;
  scope: "repo" | "home";
  generatedAt: string;
  dryRun: boolean;
  reclaimed: GcRunReclaimed[];
  refused: GcRunRefused[];
  totalBytesFreed: number;
  nextAction: string;
}
export interface GcVerifyCheck {
  name: string;
  pass: boolean;
  code?: ReclaimVerifyCode;
  detail?: string;
}
export interface GcVerifyResult {
  schemaVersion: 1;
  runId: string;
  reclaimed: boolean;
  verified: boolean;
  tier: string;
  capability: RunCapability;
  capabilityReason?: RunCapabilityReason;
  tombstoneHash?: string;
  chainLength: number;
  checks: GcVerifyCheck[];
  nextAction: string;
}

/** Fail-closed refusal: a real reason reclamation froze nothing. */
export class ReclamationError extends Error {
  code: string;
  details?: Record<string, unknown>;
  constructor(code: string, message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = "ReclamationError";
    this.code = code;
    this.details = details;
  }
}

/** Synthetic abort thrown by runReclamation({ faultAfter }) — a TESTABLE
 *  crash injection that never kills the process. */
export class ReclamationAbort extends Error {
  step: string;
  constructor(step: string) {
    super(`ReclamationAbort after step: ${step}`);
    this.name = "ReclamationAbort";
    this.step = step;
  }
}

export const SKELETON_REQUIRED_KEYS = [
  "runId",
  "finalVerdict",
  "commits",
  "evidenceDigests",
  "attestationChain",
  "costRecord",
  "auditLog",
  "collaborationLog",
  "stateDigest",
] as const;

/** Same lock every other state.json writer holds (saveCheckpoint,
 *  withRunStateLock — shell/run-store.ts) across its write, so a GC pass's
 *  persist can never land invisibly inside another writer's critical
 *  section. */
function persistRunDurable(run: WorkflowRun): void {
  withFileLock(run.paths.state, () => {
    run.updatedAt = new Date().toISOString();
    writeJson(run.paths.state, run, { durable: true });
  });
}

function withRunLock<T>(run: WorkflowRun, fn: () => T): T {
  return withFileLock(reclaimedLogPath(run), fn);
}

export function reclaimedLogPath(run: WorkflowRun): string {
  return path.join(run.paths.runDir, "reclaimed.json");
}

/** Fail-OPEN on absence/corruption: a malformed overlay must never brick
 *  the run (SPEC/scheduling-registry.md "Rebuild risks" #1). */
export function loadReclamationLog(run: WorkflowRun): ReclaimedOverlay {
  const file = reclaimedLogPath(run);
  if (!fs.existsSync(file)) return { schemaVersion: 1, runId: run.id, tombstones: [] };
  try {
    const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
    if (!parsed || typeof parsed !== "object" || parsed.schemaVersion !== 1 || !Array.isArray(parsed.tombstones)) {
      return { schemaVersion: 1, runId: run.id, tombstones: [], corrupted: true };
    }
    return { schemaVersion: 1, runId: run.id, tombstones: parsed.tombstones as ReclamationTombstone[] };
  } catch {
    return { schemaVersion: 1, runId: run.id, tombstones: [], corrupted: true };
  }
}

// ---------------------------------------------------------------------------
// Skeleton extraction
// ---------------------------------------------------------------------------

function deriveTerminalLifecycle(run: WorkflowRun): RunLifecycleState {
  const tasks = run.tasks || [];
  const running = tasks.filter((t) => t.status === "running").length;
  const failed = tasks.filter((t) => t.status === "failed").length;
  const completed = tasks.filter((t) => t.status === "completed").length;
  const total = tasks.length;
  const pending = tasks.filter((t) => t.status === "pending").length;
  const openFeedback = ((run.feedback as Array<{ status: string }> | undefined) || []).filter(
    (f) => f.status === "open" || f.status === "tasked"
  ).length;
  const verifierGated = (run.commits || []).filter((c) => c.verifierGated).length;
  if (running > 0) return "running";
  if (openFeedback > 0) return "blocked";
  if (failed > 0) return "failed";
  if (total > 0 && completed === total) return "completed";
  if (verifierGated > 0 && pending === 0) return "completed";
  if (completed > 0) return "running";
  return "queued";
}

function auditEventLogPath(run: WorkflowRun): string {
  return run.audit?.eventLogPath || path.join(run.paths.auditDir || path.join(run.paths.runDir, "audit"), "events.jsonl");
}

function digestEvidenceEntry(entry: { locator?: string; path?: string; summary?: string; id?: string }): { ref: string; digest: string } | undefined {
  const ref = entry.locator || entry.path || entry.summary || entry.id;
  if (!ref) return undefined;
  const candidatePath = entry.path || entry.locator;
  if (candidatePath && typeof candidatePath === "string" && !candidatePath.includes(":") && fs.existsSync(candidatePath)) {
    try {
      const stat = fs.statSync(candidatePath);
      if (stat.isFile()) return { ref, digest: sha256OfFile(candidatePath) };
    } catch {
      /* fall through to locator digest */
    }
  }
  return { ref, digest: sha256OfString(ref) };
}

interface EvidenceLike {
  locator?: string;
  path?: string;
  summary?: string;
  id?: string;
}

/** STEP 1: extract + seal the skeleton. Pure read over the run; never
 *  mutates. */
export function extractSkeleton(run: WorkflowRun): ReclamationSkeleton {
  const lifecycle = deriveTerminalLifecycle(run);
  const commits = (run.commits || []).map((commit) => ({
    id: commit.id,
    verifierGated: Boolean(commit.verifierGated),
    checkpoint: Boolean(commit.checkpoint),
    candidateId: commit.candidateId,
    selectionId: commit.selectionId,
    verifierNodeId: commit.verifierNodeId,
    evidenceCount: (commit.evidence || []).length,
    acceptanceRationale: commit.acceptanceRationale as Record<string, unknown> | undefined,
  }));

  const evidenceSources: EvidenceLike[] = [];
  for (const node of run.nodes || []) for (const e of node.evidence || []) evidenceSources.push(e);
  for (const candidate of (run.candidates as Array<{ evidence?: EvidenceLike[] }> | undefined) || [])
    for (const e of candidate.evidence || []) evidenceSources.push(e);
  for (const selection of (run.candidateSelections as Array<{ evidence?: EvidenceLike[] }> | undefined) || [])
    for (const e of selection.evidence || []) evidenceSources.push(e);
  for (const commit of run.commits || []) for (const e of commit.evidence || []) evidenceSources.push(e as EvidenceLike);
  const evidenceMap = new Map<string, string>();
  for (const e of evidenceSources) {
    const digested = digestEvidenceEntry(e);
    if (digested) evidenceMap.set(digested.ref, digested.digest);
  }
  const evidenceDigests = [...evidenceMap.entries()].map(([ref, digest]) => ({ ref, digest })).sort((a, b) => compareBytes(a.ref, b.ref));

  const eventLog = auditEventLogPath(run);
  const auditLogDigest = fs.existsSync(eventLog) ? sha256OfFile(eventLog) : sha256OfString("");
  const events = fs.existsSync(eventLog)
    ? fs
        .readFileSync(eventLog, "utf8")
        .split(/\n/g)
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line) => {
          try {
            const e = JSON.parse(line) as { id?: string; kind?: string; decision?: string; createdAt?: string };
            return { id: e.id || "", kind: e.kind || "", decision: e.decision || "", createdAt: e.createdAt || "" };
          } catch {
            return { id: "", kind: "malformed", decision: "", createdAt: "" };
          }
        })
    : [];

  const metricsReport = path.join(run.paths.runDir, "metrics", "metrics-report.json");
  const costRecord = {
    tasks: (run.tasks || []).map((task) => ({ taskId: task.id, model: task.model, source: task.agentType })),
    metricsDigest: fs.existsSync(metricsReport) ? sha256OfFile(metricsReport) : undefined,
  };

  const collaboration = run.collaboration as { approvals?: unknown[]; comments?: unknown[]; handoffs?: unknown[] } | undefined;
  const collaborationLog = {
    digest: sha256OfString(replayStableStringify(collaboration || {})),
    approvals: collaboration?.approvals?.length || 0,
    comments: collaboration?.comments?.length || 0,
    handoffs: collaboration?.handoffs?.length || 0,
  };

  const stateDigest = fs.existsSync(run.paths.state) ? sha256OfFile(run.paths.state) : "";

  return {
    schemaVersion: 1,
    runId: run.id,
    finalVerdict: {
      lifecycle,
      loopStage: run.loopStage,
      terminal: lifecycle === "completed" || lifecycle === "failed",
      commitGated: (run.commits || []).some((c) => c.verifierGated),
    },
    commits,
    evidenceDigests,
    attestationChain: { auditLogDigest, eventCount: events.length, events },
    costRecord,
    auditLog: { path: path.relative(run.paths.runDir, eventLog), digest: auditLogDigest },
    collaborationLog,
    stateDigest,
  };
}

export function validateSkeleton(skeleton: Partial<ReclamationSkeleton> | undefined): string[] {
  const missing: string[] = [];
  if (!skeleton) return [...SKELETON_REQUIRED_KEYS];
  for (const key of SKELETON_REQUIRED_KEYS) {
    const value = (skeleton as Record<string, unknown>)[key];
    if (value === undefined || value === null) {
      missing.push(key);
      continue;
    }
    if (key === "runId" && !String(value).trim()) missing.push(key);
    if (key === "stateDigest" && !String(value).trim()) missing.push(key);
    if (key === "finalVerdict" && (typeof value !== "object" || !(value as { lifecycle?: string }).lifecycle)) missing.push(key);
    if (key === "auditLog" && (typeof value !== "object" || !(value as { digest?: string }).digest)) missing.push(key);
    if (key === "attestationChain" && (typeof value !== "object" || typeof (value as { auditLogDigest?: string }).auditLogDigest !== "string"))
      missing.push(key);
    if (key === "commits" && !Array.isArray(value)) missing.push(key);
    if (key === "evidenceDigests" && !Array.isArray(value)) missing.push(key);
  }
  return missing;
}

/** Refuse if extraction dropped audit content the run actually has. */
export function validateSkeletonAgainstRun(run: WorkflowRun, skeleton: ReclamationSkeleton): string[] {
  const failures: string[] = [];
  const runCommits = (run.commits || []).length;
  if (runCommits > 0 && skeleton.commits.length !== runCommits) {
    failures.push(`commits-dropped(run=${runCommits},sealed=${skeleton.commits.length})`);
  }
  const runHasEvidence =
    (run.nodes || []).some((n) => (n.evidence || []).length) ||
    ((run.candidates as Array<{ evidence?: unknown[] }> | undefined) || []).some((c) => (c.evidence || []).length) ||
    ((run.candidateSelections as Array<{ evidence?: unknown[] }> | undefined) || []).some((s) => (s.evidence || []).length) ||
    (run.commits || []).some((c) => (c.evidence || []).length);
  if (runHasEvidence && skeleton.evidenceDigests.length === 0) {
    failures.push("evidence-dropped");
  }
  if (!skeleton.finalVerdict || !skeleton.finalVerdict.lifecycle) failures.push("verdict-missing");
  return failures;
}

// ---------------------------------------------------------------------------
// Classifier / planner
// ---------------------------------------------------------------------------

export interface PlannedFree {
  path: string;
  absPath: string;
  kind: ReclaimKind;
  bytes: number;
  recipe?: ReconstructionRecipe;
  repointResultNodeId?: string;
}

export interface ReclamationPlan {
  freeable: PlannedFree[];
  bytesToFree: number;
  byKind: Partial<Record<ReclaimKind, number>>;
  capability: RunCapability;
  capabilityReason: RunCapabilityReason;
}

export interface ReclamationPolicyInput {
  keepScratch?: boolean;
  keepSnapshots?: boolean;
  keepCommits?: boolean;
}

function snapshotProjectionDigest(node: StateNode): string {
  return sha256OfString(nodeProjectionDigestInput(node));
}

function nodeBodyDigest(node: StateNode): string {
  return sha256OfString(nodeProjectionDigestInput(node));
}

interface WorkerScopeLike {
  workerDir?: string;
  taskId?: string;
  resultNodeId?: string;
}

/** Build the retention plan: which paths are freeable under `policy`, of
 *  what kind, how many bytes, and the resulting capability downgrade. */
export function planReclamation(run: WorkflowRun, policy: ReclamationPolicyInput = {}): ReclamationPlan {
  const runDir = run.paths.runDir;
  const freeable: PlannedFree[] = [];
  const rel = (abs: string) => path.relative(runDir, abs);

  // (1) Worker scratch dirs — pure scratch with zero audit value.
  let reclaimedScratch = false;
  if (!policy.keepScratch) {
    for (const scope of (run.workers as WorkerScopeLike[] | undefined) || []) {
      const workerDir = scope.workerDir;
      if (!workerDir || !fs.existsSync(workerDir)) continue;
      const task = (run.tasks || []).find((t) => t.id === scope.taskId);
      const resultNodeId = scope.resultNodeId || task?.resultNodeId;
      const resultsCopy = task?.resultPath;
      if (!resultNodeId || !resultsCopy || !fs.existsSync(resultsCopy)) continue;
      const bytes = dirBytes(workerDir);
      if (bytes <= 0) continue;
      freeable.push({ path: rel(workerDir), absPath: workerDir, kind: "scratch", bytes, repointResultNodeId: resultNodeId });
      reclaimedScratch = true;
    }
  }

  const repointNodeIds = new Set(freeable.filter((f) => f.repointResultNodeId).map((f) => f.repointResultNodeId));

  // (2) Reconstructable node snapshots.
  let reclaimedSnapshot = false;
  let reconstructableSnapshot = false;
  if (!policy.keepSnapshots) {
    const nodesDir = run.paths.stateNodesDir || path.join(runDir, "nodes");
    const snapshotsRoot = path.join(nodesDir, "snapshots");
    if (fs.existsSync(snapshotsRoot)) {
      for (const nodeDirName of fs.readdirSync(snapshotsRoot, { withFileTypes: true })) {
        if (!nodeDirName.isDirectory()) continue;
        const nodeDir = path.join(snapshotsRoot, nodeDirName.name);
        for (const file of fs.readdirSync(nodeDir, { withFileTypes: true })) {
          if (!file.isFile() || !file.name.endsWith(".json")) continue;
          const snapFile = path.join(nodeDir, file.name);
          let snap: unknown;
          try {
            snap = JSON.parse(fs.readFileSync(snapFile, "utf8"));
          } catch {
            continue;
          }
          if (!snap || typeof snap !== "object" || typeof (snap as Record<string, unknown>).nodeId !== "string") continue;
          const nodeId = (snap as Record<string, unknown>).nodeId as string;
          const node = (run.nodes || []).find((n) => n.id === nodeId);
          if (!node) continue;
          if (repointNodeIds.has(node.id)) continue;
          const bytes = dirBytes(snapFile);
          if (bytes <= 0) continue;
          const inputDigest = nodeBodyDigest(node);
          const recipe: ReconstructionRecipe = {
            recipeKind: "node-snapshot-projection",
            inputDigests: [inputDigest],
            inputsDigest: sha256OfString(replayStableStringify([inputDigest])),
            expectDigest: snapshotProjectionDigest(node),
            sourceRef: node.id,
          };
          freeable.push({ path: rel(snapFile), absPath: snapFile, kind: "reconstructable-snapshot", bytes, recipe });
          reclaimedSnapshot = true;
          reconstructableSnapshot = true;
        }
      }
    }
  }

  // (3) Superseded, non-verifier-gated commit snapshots. Each commitState()
  // call writes only the commit's own small record into commits/<id>.json
  // (not the whole run), but these files still add up over a long run with
  // no reclamation path today. Only the run's LATEST commit and any
  // verifier-gated commit (the actual audit-significant milestones) are
  // kept — an intermediate, non-gated "checkpoint" commit's only value is
  // as a point-in-time snapshot, and state.json (not commits/) is the
  // source of truth for resume. Treated as not reconstructable (no recipe)
  // on purpose, kept conservative: a commit snapshot is not offered a
  // projection path derivable from retained data.
  let reclaimedCommitSnapshot = false;
  if (!policy.keepCommits) {
    const commits = run.commits || [];
    for (let i = 0; i < commits.length - 1; i++) {
      const commit = commits[i];
      if (commit.verifierGated) continue;
      if (!commit.snapshotPath || !fs.existsSync(commit.snapshotPath)) continue;
      const bytes = dirBytes(commit.snapshotPath);
      if (bytes <= 0) continue;
      freeable.push({ path: rel(commit.snapshotPath), absPath: commit.snapshotPath, kind: "commit-snapshot", bytes });
      reclaimedCommitSnapshot = true;
    }
  }

  // Determinism (HARD constraint): sort by path BEFORE anything hashes it,
  // so tombstoneHash is reproducible across hosts regardless of
  // fs.readdirSync's filesystem-dependent order.
  freeable.sort((a, b) => compareBytes(a.path, b.path));

  const byKind: Partial<Record<ReclaimKind, number>> = {};
  let bytesToFree = 0;
  for (const entry of freeable) {
    byKind[entry.kind] = (byKind[entry.kind] || 0) + entry.bytes;
    bytesToFree += entry.bytes;
  }

  let capability: RunCapability = "re-runnable";
  let capabilityReason: RunCapabilityReason = "scratch-only-reclaimed";
  // A reclaimed commit snapshot is never reconstructable (a genuine
  // point-in-time capture, no recipe) — it caps capability at "verify-only"
  // regardless of what node-snapshot reclamation achieved, same as an
  // unreconstructable node snapshot would.
  if (reclaimedCommitSnapshot) {
    capability = "verify-only";
    capabilityReason = "snapshot-reclaimed-no-reconstruction";
  } else if (reclaimedSnapshot && reconstructableSnapshot) {
    capability = "re-runnable-by-reconstruction";
    capabilityReason = "inputs-and-expectdigest-retained";
  } else if (reclaimedSnapshot) {
    capability = "verify-only";
    capabilityReason = "snapshot-reclaimed-no-reconstruction";
  } else if (reclaimedScratch) {
    capability = "re-runnable";
    capabilityReason = "scratch-only-reclaimed";
  }

  return { freeable, bytesToFree, byKind, capability, capabilityReason };
}

// ---------------------------------------------------------------------------
// Tombstone construction + hash chain
// ---------------------------------------------------------------------------

function policyDigestOf(policy: Record<string, unknown>): string {
  return sha256OfString(replayStableStringify(policy));
}

/** genesis prevTombstoneHash = sha256 of the sealed skeleton. */
export function genesisPrevHash(skeleton: ReclamationSkeleton): string {
  return sha256OfString(replayStableStringify(skeleton));
}

function tombstoneHashInput(t: Omit<ReclamationTombstone, "tombstoneHash">): string {
  return replayStableStringify({
    runId: t.runId,
    tombstoneId: t.tombstoneId,
    reclaimedAt: t.reclaimedAt,
    actor: t.actor || null,
    policyDigest: t.policyDigest,
    freed: t.freed.map((f) => ({ path: f.path, kind: f.kind, bytes: f.bytes, sha256: f.sha256, recipe: f.recipe || null })),
    bytesFreed: t.bytesFreed,
    skeletonDigest: sha256OfString(replayStableStringify(t.skeleton)),
    capability: t.capability,
    capabilityReason: t.capabilityReason,
    prevTombstoneHash: t.prevTombstoneHash,
  });
}

export function computeTombstoneHash(t: Omit<ReclamationTombstone, "tombstoneHash">): string {
  return sha256OfString(tombstoneHashInput(t));
}

function tombstoneId(seq: number): string {
  return `tomb-${String(seq).padStart(3, "0")}`;
}

export interface BuildTombstoneOptions {
  now?: string;
  actor?: string;
  policy?: Record<string, unknown>;
}

/** STEP 2: build the FULL tombstone (pre-deletion sha256 per freed path +
 *  the hash chain). Reads the freed files (still present); mutates
 *  nothing on disk. */
export function buildTombstone(run: WorkflowRun, skeleton: ReclamationSkeleton, plan: ReclamationPlan, options: BuildTombstoneOptions = {}): ReclamationTombstone {
  const now = options.now || new Date().toISOString();
  const priorLog = loadReclamationLog(run);
  // Fail closed, not open: a CORRUPTED log must never be read as "no prior
  // tombstones" — that reading is only correct for a genuinely absent file.
  // Minting a fresh genesis tombstone over a corrupted log would durably
  // overwrite it (commitTombstone), destroying whatever history the
  // corruption hid. This is defense in depth on top of reclaimEligibility's
  // own "reclamation-log-corrupted" refusal — direct callers of
  // buildTombstone are stopped here too.
  if (priorLog.corrupted) {
    throw new ReclamationError(
      "reclamation-log-corrupted",
      `Refusing to build a tombstone: ${reclaimedLogPath(run)} exists but failed to parse/validate. Restore or manually inspect it before reclaiming this run.`,
      { runId: run.id }
    );
  }
  const prior = priorLog.tombstones;
  const prevTombstoneHash = prior.length ? prior[prior.length - 1].tombstoneHash : genesisPrevHash(skeleton);
  const freed: FreedManifestEntry[] = plan.freeable.map((entry) => ({
    path: entry.path,
    kind: entry.kind,
    bytes: entry.bytes,
    sha256: contentDigest(entry.absPath),
    recipe: entry.recipe,
  }));
  const base: Omit<ReclamationTombstone, "tombstoneHash"> = {
    schemaVersion: 1,
    runId: run.id,
    tombstoneId: tombstoneId(prior.length + 1),
    reclaimedAt: now,
    actor: options.actor,
    policyDigest: policyDigestOf(options.policy || {}),
    freed,
    bytesFreed: freed.reduce((sum, f) => sum + f.bytes, 0),
    skeleton,
    capability: plan.capability,
    capabilityReason: plan.capabilityReason,
    prevTombstoneHash,
  };
  return { ...base, tombstoneHash: computeTombstoneHash(base) };
}

/** STEP 3: commit the tombstone DURABLY into the append-only overlay
 *  (temp -> fsync -> rename) and record the attestation. No byte is freed
 *  here — write-ahead order is the safety property. */
export function commitTombstone(run: WorkflowRun, tombstone: ReclamationTombstone): void {
  const log = loadReclamationLog(run);
  log.tombstones.push(tombstone);
  writeJson(reclaimedLogPath(run), log, { durable: true });
  try {
    recordTrustAuditEvent(run, {
      kind: "run.reclamation",
      decision: "recorded",
      source: "cw-validated",
      metadata: {
        tombstoneId: tombstone.tombstoneId,
        tombstoneHash: tombstone.tombstoneHash,
        prevTombstoneHash: tombstone.prevTombstoneHash,
        bytesFreed: tombstone.bytesFreed,
        freedPaths: tombstone.freed.length,
        capability: tombstone.capability,
        capabilityReason: tombstone.capabilityReason,
        actor: tombstone.actor,
      },
    });
  } catch {
    // The tombstone is already durable; an audit-append hiccup must not unwind it.
  }
}

interface StateArtifactLike {
  id: string;
  path?: string;
}
interface StateNodeLike {
  id: string;
  artifacts?: StateArtifactLike[];
  updatedAt?: string;
}

/** STEP 4: re-point every surviving node's artifacts off the scratch
 *  paths about to vanish, DURABLY persist that state.json change, and
 *  PROVE no surviving node still references a freed path — BEFORE a
 *  single byte is freed. Fail closed (`repoint-incomplete`) if the proof
 *  does not hold. */
export function prepareFree(run: WorkflowRun, tombstone: ReclamationTombstone): void {
  const runDir = run.paths.runDir;
  const scratchDirs = tombstone.freed.filter((f) => f.kind === "scratch").map((f) => realResolve(path.join(runDir, f.path)));
  const commitSnapshotPaths = tombstone.freed.filter((f) => f.kind === "commit-snapshot").map((f) => realResolve(path.join(runDir, f.path)));
  if (!scratchDirs.length && !commitSnapshotPaths.length) return;

  const repointed = new Set<string>();
  for (const scratchDir of scratchDirs) {
    for (const id of repointResultNodeArtifacts(run, scratchDir)) repointed.add(id);
  }
  // Unlike scratch (which has a retained "result" artifact to repoint to),
  // a reclaimed commit snapshot has no surviving alternative — its OWN
  // StateNode's "snapshot" artifact (recordCommitNode, shell/commit.ts) is
  // the only reference to it, so it is stripped outright rather than
  // repointed. node.outputs.snapshotPath (a plain metadata string, not an
  // artifact the check below inspects) is left as a historical record,
  // same as commit.snapshotPath itself staying in state.json.
  stripCommitSnapshotArtifacts(run, commitSnapshotPaths);

  persistRunDurable(run);

  for (const node of (run.nodes as StateNodeLike[] | undefined) || []) {
    for (const artifact of node.artifacts || []) {
      if (!artifact.path) continue;
      const resolved = realResolve(artifact.path);
      for (const scratchDir of scratchDirs) {
        if (resolved === scratchDir || resolved.startsWith(scratchDir + path.sep)) {
          throw new ReclamationError(
            "repoint-incomplete",
            `node ${node.id} artifact ${artifact.id} still references freed scratch path ${artifact.path}`,
            { nodeId: node.id, artifactId: artifact.id, path: artifact.path }
          );
        }
      }
      if (commitSnapshotPaths.includes(resolved)) {
        throw new ReclamationError(
          "repoint-incomplete",
          `node ${node.id} artifact ${artifact.id} still references freed commit snapshot ${artifact.path}`,
          { nodeId: node.id, artifactId: artifact.id, path: artifact.path }
        );
      }
    }
  }

  for (const nodeId of repointed) {
    try {
      const fresh = snapshotNode(run, nodeId, { persist: false });
      const { freshness } = loadNodeSnapshot(run, fresh, fs.existsSync);
      if (freshness === "absent") {
        throw new ReclamationError("repoint-incomplete", `re-pointed node ${nodeId} snapshot is absent (dangling artifact)`, { nodeId });
      }
    } catch (error) {
      if (error instanceof ReclamationError) throw error;
      throw new ReclamationError("repoint-incomplete", `could not prove re-pointed node ${nodeId} stays valid: ${(error as Error).message}`, {
        nodeId,
      });
    }
  }
}

/** STEP 5: free the bulk DATA bytes. Pure deletion — every re-point is
 *  already done and DURABLY persisted by prepareFree(). */
export function freeBulk(run: WorkflowRun, tombstone: ReclamationTombstone): number {
  const runDir = run.paths.runDir;
  let freedBytes = 0;
  for (const entry of tombstone.freed) {
    const abs = path.join(runDir, entry.path);
    // planReclamation always derives entry.path as a relative path already
    // confined under runDir, but a tampered/imported state.json could carry a
    // worker/artifact path that resolves outside it — re-check containment
    // right before the recursive delete so that can never turn into an
    // out-of-tree rmSync.
    if (!isContainedPath(abs, runDir)) {
      throw new ReclamationError("unsafe-free-path", `refusing to free path outside the run directory: ${entry.path}`, {
        path: entry.path,
      });
    }
    const before = dirBytes(abs);
    fs.rmSync(abs, { recursive: true, force: true });
    freedBytes += before;
  }
  return freedBytes;
}

function repointResultNodeArtifacts(run: WorkflowRun, freedScratchDir: string): string[] {
  const freedReal = realResolve(freedScratchDir);
  const freedPrefix = freedReal + path.sep;
  const changedIds: string[] = [];
  for (const node of (run.nodes as StateNodeLike[] | undefined) || []) {
    if (!node.artifacts) continue;
    let changed = false;
    for (const artifact of node.artifacts) {
      if (!artifact.path) continue;
      const resolved = realResolve(artifact.path);
      if (resolved === freedReal || resolved.startsWith(freedPrefix)) {
        const retained = node.artifacts.find((a) => a.id === "result" && a.path && fs.existsSync(a.path));
        if (retained && retained.path) {
          artifact.path = retained.path;
          changed = true;
        }
      }
    }
    if (changed) {
      node.updatedAt = new Date().toISOString();
      changedIds.push(node.id);
    }
  }
  return changedIds;
}

/** Removes the "snapshot" artifact entry from any node that references one
 *  of `freedCommitSnapshotPaths` — there is no retained alternative to
 *  repoint to (unlike a scratch dir's "result" copy), so the reference is
 *  dropped outright. StateArtifact.path is a required string, so the
 *  artifact entry is filtered out rather than nulled. */
function stripCommitSnapshotArtifacts(run: WorkflowRun, freedCommitSnapshotPaths: string[]): string[] {
  if (!freedCommitSnapshotPaths.length) return [];
  const freedSet = new Set(freedCommitSnapshotPaths);
  const changedIds: string[] = [];
  for (const node of (run.nodes as StateNodeLike[] | undefined) || []) {
    if (!node.artifacts || !node.artifacts.length) continue;
    const before = node.artifacts.length;
    node.artifacts = node.artifacts.filter((artifact) => !artifact.path || !freedSet.has(realResolve(artifact.path)));
    if (node.artifacts.length !== before) {
      node.updatedAt = new Date().toISOString();
      changedIds.push(node.id);
    }
  }
  return changedIds;
}

// ---------------------------------------------------------------------------
// The composed transaction
// ---------------------------------------------------------------------------

export interface RunReclamationOptions {
  now?: string;
  actor?: string;
  policy?: Record<string, unknown>;
  reclaimPolicy?: ReclamationPolicyInput;
  faultAfter?: "skeleton" | "tombstone-write" | "tombstone-commit";
}

export interface RunReclamationResult {
  tombstone: ReclamationTombstone;
  bytesFreed: number;
  plan: ReclamationPlan;
}

/** Execute the write-ahead, fail-closed reclamation transaction. */
export function runReclamation(run: WorkflowRun, options: RunReclamationOptions = {}): RunReclamationResult {
  const skeleton = extractSkeleton(run);
  const missing = validateSkeleton(skeleton);
  if (missing.length) {
    throw new ReclamationError("skeleton-incomplete", `Skeleton missing required keys: ${missing.join(", ")}`, { missing });
  }
  const contentLoss = validateSkeletonAgainstRun(run, skeleton);
  if (contentLoss.length) {
    throw new ReclamationError("skeleton-incomplete", `Skeleton dropped audit content: ${contentLoss.join(", ")}`, { contentLoss });
  }
  if (options.faultAfter === "skeleton") throw new ReclamationAbort("skeleton");

  const { plan, tombstone } = withRunLock(run, () => {
    const builtPlan = planReclamation(run, options.reclaimPolicy || {});
    const builtTombstone = buildTombstone(run, skeleton, builtPlan, { now: options.now, actor: options.actor, policy: options.policy });
    if (options.faultAfter === "tombstone-write") throw new ReclamationAbort("tombstone-write");
    commitTombstone(run, builtTombstone);
    return { plan: builtPlan, tombstone: builtTombstone };
  });
  if (options.faultAfter === "tombstone-commit") throw new ReclamationAbort("tombstone-commit");

  prepareFree(run, tombstone);

  const bytesFreed = freeBulk(run, tombstone);
  return { tombstone, bytesFreed, plan };
}

// ---------------------------------------------------------------------------
// Reconstruction + verification
// ---------------------------------------------------------------------------

function reconstructArtifact(run: WorkflowRun, recipe: ReconstructionRecipe): { inputsDigest: string; expectDigest: string } {
  if (recipe.recipeKind === "node-snapshot-projection") {
    const node = (run.nodes || []).find((n) => n.id === recipe.sourceRef);
    if (!node) {
      return { inputsDigest: sha256OfString("absent"), expectDigest: sha256OfString("absent") };
    }
    const inputDigest = nodeBodyDigest(node);
    const inputsDigest = sha256OfString(replayStableStringify([inputDigest]));
    const expectDigest = snapshotProjectionDigest(node);
    return { inputsDigest, expectDigest };
  }
  return { inputsDigest: sha256OfString("unknown-recipe"), expectDigest: sha256OfString("unknown-recipe") };
}

export interface VerifyCheck {
  name: string;
  pass: boolean;
  code?: string;
  detail?: string;
}

/** Re-prove the whole reclamation chain for a run. Recomputes every hash
 *  independently — never trusts the stored value. */
export function verifyReclamation(run: WorkflowRun): { reclaimed: boolean; verified: boolean; checks: VerifyCheck[]; tombstones: ReclamationTombstone[] } {
  const log = loadReclamationLog(run);
  const tombstones = log.tombstones;
  const checks: VerifyCheck[] = [];
  if (log.corrupted) {
    // Distinct from "not-reclaimed": a corrupted log means the run's
    // reclamation status genuinely cannot be read, not that it was never
    // reclaimed. Reporting "not-reclaimed" here would look identical to the
    // honest empty-log case and hide the corruption from an operator running
    // `cw gc verify` directly.
    return {
      reclaimed: false,
      verified: false,
      checks: [{ name: "reclaimed", pass: false, code: "reclamation-log-corrupted", detail: `${reclaimedLogPath(run)} exists but failed to parse/validate` }],
      tombstones,
    };
  }
  if (!tombstones.length) {
    return { reclaimed: false, verified: false, checks: [{ name: "reclaimed", pass: false, code: "not-reclaimed" }], tombstones };
  }

  let chainOk = true;
  for (let i = 0; i < tombstones.length; i++) {
    const expectedPrev = i === 0 ? genesisPrevHash(tombstones[0].skeleton) : tombstones[i - 1].tombstoneHash;
    const pass = tombstones[i].prevTombstoneHash === expectedPrev;
    if (!pass) chainOk = false;
    checks.push({ name: `chain-link[${i}]`, pass, code: pass ? undefined : "tombstone-chain-broken" });
  }

  let digestsOk = true;
  for (let i = 0; i < tombstones.length; i++) {
    const { tombstoneHash, ...rest } = tombstones[i];
    const recomputed = computeTombstoneHash(rest);
    const pass = recomputed === tombstoneHash;
    if (!pass) digestsOk = false;
    checks.push({ name: `tombstone-hash[${i}]`, pass, code: pass ? undefined : "tombstone-digest-mismatch" });
  }

  let skeletonOk = true;
  for (let i = 0; i < tombstones.length; i++) {
    const missing = validateSkeleton(tombstones[i].skeleton);
    const pass = missing.length === 0;
    if (!pass) skeletonOk = false;
    checks.push({ name: `skeleton[${i}]`, pass, code: pass ? undefined : "skeleton-incomplete", detail: missing.join(",") || undefined });
  }

  let reconstructionOk = true;
  for (let i = 0; i < tombstones.length; i++) {
    for (const entry of tombstones[i].freed) {
      if (!entry.recipe) continue;
      const recomputed = reconstructArtifact(run, entry.recipe);
      const inputsMatch = recomputed.inputsDigest === entry.recipe.inputsDigest;
      const expectMatch = recomputed.expectDigest === entry.recipe.expectDigest;
      const pass = inputsMatch && expectMatch;
      if (!pass) reconstructionOk = false;
      checks.push({
        name: `reconstruct[${i}]:${entry.path}`,
        pass,
        code: pass ? undefined : "reconstruction-digest-mismatch",
        detail: pass ? undefined : `inputs=${inputsMatch} expect=${expectMatch}`,
      });
    }
  }

  const verified = chainOk && digestsOk && skeletonOk && reconstructionOk;
  return { reclaimed: true, verified, checks, tombstones };
}

// ---------------------------------------------------------------------------
// GcHost contract + gc plan/run/verify (byte-exact port of
// src/run-registry/gc.ts)
// ---------------------------------------------------------------------------

export interface GcHost {
  buildIndex(scope: "repo" | "home"): RunRegistryIndex;
  locate(runId: string, scope: "repo" | "home"): { record: RunRecord; from: "repo" | "home" } | undefined;
  loadRun(repo: string, runId: string): WorkflowRun;
}

export function reclamationPolicy(overrides: Partial<RunRegistryPolicy> = {}): RunRegistryPolicy {
  return { ...DEFAULT_RUN_REGISTRY_POLICY, ...overrides };
}

/** Fail-closed eligibility, checked IN ORDER (SPEC "Rebuild risks" #6):
 *  reclamation-log-corrupted -> already-reclaimed -> non-terminal ->
 *  open-feedback -> not-archived -> within-retention. `null` means eligible.
 *
 *  reclamation-log-corrupted is checked FIRST, ahead of even
 *  already-reclaimed: record.tier is derived from the same corrupted
 *  reclaimed.json (loadReclaimedFromDir), so a corrupted log makes `tier`
 *  itself unreliable — it reads "live", not "reclaimed", exactly the
 *  reading that would let a run past the already-reclaimed gate and into a
 *  destructive re-reclaim (self-audit-cool-workflow-v0.2.6.md P2). */
export function reclaimEligibility(record: RunRecord, policy: RunRegistryPolicy, nowMs: number): ReclaimRefusalCode | null {
  if (record.reclamationLogCorrupted) return "reclamation-log-corrupted";
  if (record.tier === "reclaimed") return "already-reclaimed";
  const terminalStates = policy.reclaimStates && policy.reclaimStates.length ? policy.reclaimStates : ["completed", "failed"];
  if (record.derivedLifecycle !== "completed" && record.derivedLifecycle !== "failed") return "non-terminal";
  if (!terminalStates.includes(record.derivedLifecycle)) return "non-terminal";
  if (record.openFeedbackCount > 0) return "open-feedback";
  if (!record.archived) return "not-archived";
  const days = policy.reclaimAfterArchiveDays ?? 0;
  if (days > 0) {
    const archivedAtMs = record.archivedAt ? Date.parse(record.archivedAt) : NaN;
    if (!Number.isFinite(archivedAtMs)) return "within-retention";
    if (archivedAtMs > nowMs - days * 24 * 60 * 60 * 1000) return "within-retention";
  }
  return null;
}

function recordsForRunId(host: GcHost, runId: string, scope: "repo" | "home"): RunRecord[] {
  const located = host.locate(runId, scope);
  return located ? [located.record] : [];
}

export function gcPlan(host: GcHost, options: { scope?: "repo" | "home"; runId?: string; policy?: Partial<RunRegistryPolicy>; now?: string } = {}): GcPlanResult {
  const scope = options.scope || "home";
  const policy = reclamationPolicy(options.policy);
  const nowIso = options.now || new Date().toISOString();
  const nowMs = Date.parse(nowIso);
  const records = options.runId ? recordsForRunId(host, options.runId, scope) : host.buildIndex(scope).records;
  const entries: GcPlanEntry[] = [];
  let bytesToFree = 0;
  let eligibleCount = 0;
  for (const record of records) {
    const refusal = reclaimEligibility(record, policy, nowMs);
    let plan;
    try {
      const run = host.loadRun(record.repo, record.runId);
      plan = planReclamation(run, { keepScratch: policy.keepScratch, keepSnapshots: policy.keepSnapshots, keepCommits: policy.keepCommits });
    } catch {
      entries.push({
        runId: record.runId,
        repo: record.repo,
        eligible: false,
        reason: "unreadable",
        tier: record.tier || "live",
        capability: record.capability || "re-runnable",
        capabilityReason: record.capabilityReason || "live-full",
        bytesToFree: 0,
        byKind: {},
        freeable: [],
      });
      continue;
    }
    const eligible = refusal === null;
    const entry: GcPlanEntry = {
      runId: record.runId,
      repo: record.repo,
      eligible,
      reason: eligible ? "eligible" : refusal!,
      tier: record.tier || "live",
      capability: plan.capability,
      capabilityReason: plan.capabilityReason,
      bytesToFree: eligible ? plan.bytesToFree : 0,
      byKind: eligible ? plan.byKind : {},
      freeable: eligible ? plan.freeable.map((f) => ({ path: f.path, kind: f.kind, bytes: f.bytes })) : [],
    };
    entries.push(entry);
    if (eligible) {
      eligibleCount += 1;
      bytesToFree += plan.bytesToFree;
    }
  }
  return {
    schemaVersion: 1,
    scope,
    generatedAt: nowIso,
    policy: {
      reclaimAfterArchiveDays: policy.reclaimAfterArchiveDays ?? 0,
      keepSnapshots: Boolean(policy.keepSnapshots),
      keepScratch: Boolean(policy.keepScratch),
      keepCommits: Boolean(policy.keepCommits),
      reclaimStates: policy.reclaimStates && policy.reclaimStates.length ? policy.reclaimStates : ["completed", "failed"],
    },
    total: entries.length,
    eligibleCount,
    bytesToFree,
    entries,
    nextAction: eligibleCount ? "cw gc run" : "cw run search",
  };
}

export function gcRun(
  host: GcHost,
  options: { scope?: "repo" | "home"; runId?: string; policy?: Partial<RunRegistryPolicy>; now?: string; actor?: string; limit?: number } = {}
): GcRunResult {
  const scope = options.scope || "home";
  const policy = reclamationPolicy(options.policy);
  const nowIso = options.now || new Date().toISOString();
  const nowMs = Date.parse(nowIso);
  const records = options.runId ? recordsForRunId(host, options.runId, scope) : host.buildIndex(scope).records;
  const maxRuns = options.limit ?? (policy.maxReclaimRuns || 0);
  const maxBytes = policy.maxReclaimBytes || 0;
  const reclaimed: GcRunReclaimed[] = [];
  const refused: GcRunRefused[] = [];
  let totalBytesFreed = 0;
  for (const record of records) {
    const refusal = reclaimEligibility(record, policy, nowMs);
    if (refusal) {
      refused.push({ runId: record.runId, code: refusal });
      continue;
    }
    if (maxRuns > 0 && reclaimed.length >= maxRuns) break;
    let run: WorkflowRun;
    try {
      run = host.loadRun(record.repo, record.runId);
    } catch {
      refused.push({ runId: record.runId, code: "unreadable" });
      continue;
    }
    try {
      const result = runReclamation(run, {
        now: nowIso,
        actor: options.actor,
        policy: { reclaimAfterArchiveDays: policy.reclaimAfterArchiveDays, keepScratch: policy.keepScratch, keepSnapshots: policy.keepSnapshots, keepCommits: policy.keepCommits },
        reclaimPolicy: { keepScratch: policy.keepScratch, keepSnapshots: policy.keepSnapshots, keepCommits: policy.keepCommits },
      });
      reclaimed.push({
        runId: record.runId,
        bytesFreed: result.bytesFreed,
        tombstoneHash: result.tombstone.tombstoneHash,
        capability: result.tombstone.capability,
        capabilityReason: result.tombstone.capabilityReason,
      });
      recordTrustAuditEvent(run, {
        kind: "run.reclaimed",
        decision: "recorded",
        source: "cw-validated",
        metadata: { tombstoneHash: result.tombstone.tombstoneHash, bytesFreed: result.bytesFreed, capability: result.tombstone.capability },
      });
      totalBytesFreed += result.bytesFreed;
      if (maxBytes > 0 && totalBytesFreed >= maxBytes) break;
    } catch (error) {
      if (error instanceof ReclamationError) refused.push({ runId: record.runId, code: error.code as ReclaimRefusalCode });
      else throw error;
    }
  }
  return {
    schemaVersion: 1,
    scope,
    generatedAt: nowIso,
    dryRun: false,
    reclaimed,
    refused,
    totalBytesFreed,
    nextAction: reclaimed.length ? "cw gc verify <run-id>" : "cw gc plan",
  };
}

export function gcVerify(host: GcHost, runId: string, options: { scope?: "repo" | "home" } = {}): GcVerifyResult {
  const scope = options.scope || "home";
  const located = host.locate(runId, scope);
  if (!located) {
    return {
      schemaVersion: 1,
      runId,
      reclaimed: false,
      verified: false,
      tier: "live",
      capability: "re-runnable",
      chainLength: 0,
      checks: [{ name: "located", pass: false, code: "not-reclaimed", detail: "run source not found" }],
      nextAction: "cw registry refresh" + (scope === "home" ? " --scope home" : ""),
    };
  }
  const run = host.loadRun(located.record.repo, runId);
  const result = verifyReclamation(run);
  const checks: GcVerifyCheck[] = result.checks.map((c) => ({ name: c.name, pass: c.pass, code: c.code as ReclaimVerifyCode, detail: c.detail }));
  let eligibleWhenReclaimed = result.reclaimed;
  for (const tombstone of result.tombstones) {
    const terminal = tombstone.skeleton.finalVerdict?.terminal === true;
    if (!terminal) {
      eligibleWhenReclaimed = false;
      checks.push({ name: `eligible-when-reclaimed:${tombstone.tombstoneId}`, pass: false, code: "ineligible-when-reclaimed", detail: "non-terminal verdict sealed" });
    }
  }
  const last = result.tombstones[result.tombstones.length - 1];
  const witnessed = listTrustAuditEvents(run).some((event) => event.kind === "run.reclaimed");
  const proofDeleted = witnessed && !result.reclaimed;
  if (proofDeleted) {
    checks.push({ name: "reclaim-witness", pass: false, code: "reclaim-proof-deleted", detail: "trust-audit attests reclamation but reclaimed.json is missing/empty" });
  }
  const reclaimed = result.reclaimed || proofDeleted;
  const verified = result.verified && eligibleWhenReclaimed && !proofDeleted;
  return {
    schemaVersion: 1,
    runId,
    reclaimed,
    verified,
    tier: located.record.tier || (reclaimed ? "reclaimed" : "live"),
    capability: located.record.capability || "re-runnable",
    capabilityReason: located.record.capabilityReason,
    tombstoneHash: last?.tombstoneHash,
    chainLength: result.tombstones.length,
    checks,
    nextAction: verified ? "cw run show " + runId : "cw gc plan",
  };
}

// ---------------------------------------------------------------------------
// Human formatting for gc (CLI-only)
// ---------------------------------------------------------------------------

export function formatGcPlan(result: GcPlanResult): string {
  const lines = [
    `GC Plan (${result.scope}): ${result.eligibleCount}/${result.total} eligible, ${result.bytesToFree} byte(s) would be freed [DRY-RUN, frees nothing]`,
    `  policy: reclaimAfterArchiveDays=${result.policy.reclaimAfterArchiveDays} keepScratch=${result.policy.keepScratch} keepSnapshots=${result.policy.keepSnapshots} keepCommits=${result.policy.keepCommits}`,
  ];
  for (const entry of result.entries) {
    if (entry.eligible) {
      const kinds = Object.entries(entry.byKind)
        .map(([k, v]) => `${k}=${v}`)
        .join(" ");
      lines.push(`  [eligible] ${entry.runId} -> ${entry.capability} (${entry.capabilityReason}) ${entry.bytesToFree}B {${kinds}}`);
    } else {
      lines.push(`  [skip:${entry.reason}] ${entry.runId} (tier=${entry.tier})`);
    }
  }
  if (!result.entries.length) lines.push("  (no runs in scope)");
  return lines.join("\n");
}

export function formatGcRun(result: GcRunResult): string {
  const lines = [`GC Run (${result.scope}): reclaimed ${result.reclaimed.length} run(s), freed ${result.totalBytesFreed} byte(s)`];
  for (const r of result.reclaimed) lines.push(`  [reclaimed] ${r.runId} -> ${r.capability} (${r.capabilityReason}) ${r.bytesFreed}B tombstone=${r.tombstoneHash.slice(0, 19)}`);
  for (const r of result.refused) lines.push(`  [refused:${r.code}] ${r.runId}`);
  if (!result.reclaimed.length && !result.refused.length) lines.push("  (nothing eligible)");
  return lines.join("\n");
}

export function formatGcVerify(result: GcVerifyResult): string {
  const lines = [
    `GC Verify ${result.runId}: reclaimed=${result.reclaimed} verified=${result.verified} tier=${result.tier} capability=${result.capability}${
      result.tombstoneHash ? ` tombstone=${result.tombstoneHash.slice(0, 19)}` : ""
    }`,
  ];
  for (const check of result.checks) lines.push(`  ${check.pass ? "PASS" : "FAIL"} ${check.name}${check.code ? ` [${check.code}]` : ""}${check.detail ? ` (${check.detail})` : ""}`);
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Orphan Run Sweep (byte-exact port of src/run-registry/orphans.ts)
// ---------------------------------------------------------------------------

export interface OrphanRunEntry {
  repo: string;
  runId: string;
  path: string;
  ageMinutes: number;
  bytes: number;
}
export interface OrphanRunsListResult {
  schemaVersion: 1;
  scope: "repo" | "home";
  repos: string[];
  count: number;
  totalBytes: number;
  entries: OrphanRunEntry[];
}
export interface OrphanRunsGcResult {
  schemaVersion: 1;
  scope: "repo" | "home";
  removed: Array<{ repo: string; runId: string; path: string; bytes: number }>;
  freedBytes: number;
  keptCount: number;
  minAgeMinutes: number | null;
  all: boolean;
}

export const DEFAULT_ORPHAN_MIN_AGE_MINUTES = 60;

function resolveNowMs(now?: string): number {
  if (now === undefined) return Date.now();
  const ms = new Date(now).getTime();
  if (!Number.isFinite(ms)) throw new Error(`--now must be a valid ISO date (got ${now})`);
  return ms;
}

/** Walk a directory tree; return total bytes + the newest mtime found
 *  anywhere in it (including the directory itself). Best-effort. */
function walk(dir: string): { bytes: number; newestMs: number } {
  let bytes = 0;
  let newestMs = 0;
  const bump = (p: string): void => {
    let st: fs.Stats;
    try {
      st = fs.lstatSync(p);
    } catch {
      return;
    }
    if (st.mtimeMs > newestMs) newestMs = st.mtimeMs;
    if (st.isDirectory()) {
      let names: string[];
      try {
        names = fs.readdirSync(p);
      } catch {
        return;
      }
      for (const name of names) bump(path.join(p, name));
    } else {
      bytes += st.size;
    }
  };
  bump(dir);
  return { bytes, newestMs };
}

function runsDirFor(repo: string): string {
  return path.join(repo, ".cw", "runs");
}

function candidatesFor(repo: string, knownDirs: Set<string>, nowMs: number): OrphanRunEntry[] {
  const runsDir = runsDirFor(repo);
  let dirents: fs.Dirent[];
  try {
    dirents = fs.readdirSync(runsDir, { withFileTypes: true });
  } catch {
    return [];
  }
  const out: OrphanRunEntry[] = [];
  for (const entry of dirents) {
    if (!entry.isDirectory()) continue;
    const dir = path.join(runsDir, entry.name);
    if (knownDirs.has(path.resolve(dir))) continue;
    if (fs.existsSync(path.join(dir, "state.json"))) continue; // gc.ts's territory
    const { bytes, newestMs } = walk(dir);
    const ageMinutes = Math.max(0, Math.round((nowMs - newestMs) / 60000));
    out.push({ repo, runId: entry.name, path: dir, ageMinutes, bytes });
  }
  return out;
}

function scan(host: GcHost, scope: "repo" | "home", nowMs: number): { repos: string[]; entries: OrphanRunEntry[] } {
  const index = host.buildIndex(scope);
  const known = new Set(index.records.map((r) => path.resolve(r.runDir)));
  const entries: OrphanRunEntry[] = [];
  for (const repo of index.repos) entries.push(...candidatesFor(repo, known, nowMs));
  return { repos: index.repos, entries };
}

/** `cw orphans list` (read-only). */
export function listOrphanRuns(host: GcHost, options: { scope?: "repo" | "home"; now?: string } = {}): OrphanRunsListResult {
  const scope = options.scope || "home";
  const { repos, entries } = scan(host, scope, resolveNowMs(options.now));
  return {
    schemaVersion: 1,
    scope,
    repos,
    count: entries.length,
    totalBytes: entries.reduce((sum, e) => sum + e.bytes, 0),
    entries,
  };
}

/** `cw orphans gc [--min-age-minutes N] [--all]` — reclaim orphan run
 *  directories. The re-check (state.json still absent) and the delete
 *  run inside the SAME `state.json.lock` held by `saveCheckpoint`, via
 *  `withFileLock` reused directly from shell/fs-atomic.ts. */
export function gcOrphanRuns(
  host: GcHost,
  options: { scope?: "repo" | "home"; minAgeMinutes?: number; all?: boolean; now?: string } = {}
): OrphanRunsGcResult {
  const scope = options.scope || "home";
  const all = Boolean(options.all);
  let minAgeMinutes: number | null = null;
  if (!all) {
    minAgeMinutes = options.minAgeMinutes ?? DEFAULT_ORPHAN_MIN_AGE_MINUTES;
    if (!Number.isFinite(minAgeMinutes) || minAgeMinutes < 0) {
      throw new Error(`--min-age-minutes must be a non-negative number (got ${String(options.minAgeMinutes)})`);
    }
  }
  const nowMs = resolveNowMs(options.now);
  const { entries } = scan(host, scope, nowMs);

  const removed: OrphanRunsGcResult["removed"] = [];
  let freedBytes = 0;
  for (const entry of entries) {
    if (!all && entry.ageMinutes < (minAgeMinutes as number)) continue;
    const runsDirResolved = path.resolve(runsDirFor(entry.repo));
    const resolved = path.resolve(entry.path);
    if (!resolved.startsWith(runsDirResolved + path.sep)) continue; // containment, fail closed
    const statePath = path.join(resolved, "state.json");
    const deleted = withFileLock(statePath, () => {
      if (fs.existsSync(statePath)) return false; // a checkpoint landed between scan and here
      fs.rmSync(resolved, { recursive: true, force: true });
      return true;
    });
    if (!deleted) continue;
    removed.push({ repo: entry.repo, runId: entry.runId, path: entry.path, bytes: entry.bytes });
    freedBytes += entry.bytes;
  }
  return {
    schemaVersion: 1,
    scope,
    removed,
    freedBytes,
    keptCount: entries.length - removed.length,
    minAgeMinutes,
    all,
  };
}

function humanBytesLocal(n: number): string {
  if (n < 1024) return `${n}B`;
  const units = ["KiB", "MiB", "GiB"];
  let v = n / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i += 1;
  }
  return `${v.toFixed(1)}${units[i]}`;
}

export function formatOrphanRunsList(result: OrphanRunsListResult): string {
  if (!result.count) return `No orphan run(s) (${result.scope}): every ".cw/runs/" entry across ${result.repos.length} repo(s) is known to the registry.`;
  const lines = [`Orphan Runs (${result.scope}): ${result.count} in ${result.repos.length} repo(s), ${humanBytesLocal(result.totalBytes)} total`];
  for (const e of result.entries) lines.push(`  ${e.runId} (${e.repo}) age=${e.ageMinutes}m ${humanBytesLocal(e.bytes)}`);
  lines.push(`\nReclaim with: cw orphans gc --min-age-minutes ${DEFAULT_ORPHAN_MIN_AGE_MINUTES}   (or --all)`);
  return lines.join("\n");
}

export function formatOrphanRunsGc(result: OrphanRunsGcResult): string {
  const scope = result.all ? "all orphan candidates" : `orphans older than ${result.minAgeMinutes} minute(s)`;
  if (!result.removed.length) return `Nothing to reclaim (${scope}); ${result.keptCount} kept (${result.scope}).`;
  const lines = [`Reclaimed ${result.removed.length} orphan run(s) (${scope}) — freed ${humanBytesLocal(result.freedBytes)}; ${result.keptCount} kept`];
  for (const r of result.removed) lines.push(`  ${r.runId} (${r.repo}) ${humanBytesLocal(r.bytes)}`);
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Clone cache gc (byte-exact port of src/clones.ts)
// ---------------------------------------------------------------------------

export interface CloneEntry {
  hash: string;
  url: string;
  kind: string;
  ref: string | null;
  fetchedAt: string | null;
  commit: string | null;
  bytes: number;
}
export interface ClonesListResult {
  schemaVersion: 1;
  clonesDir: string;
  count: number;
  totalBytes: number;
  entries: CloneEntry[];
}
export interface ClonesGcResult {
  schemaVersion: 1;
  clonesDir: string;
  removed: Array<{ hash: string; url: string; bytes: number }>;
  freedBytes: number;
  keptCount: number;
  olderThanDays: number | null;
  all: boolean;
}

function isTrue(value: unknown): boolean {
  return value === true || value === "true" || value === "1" || value === 1;
}
function optionalNumber(value: unknown): number | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

function clonesRoot(env: NodeJS.ProcessEnv = process.env): string {
  return path.join(resolveCwHomeForClones(env), "clones");
}

// Local, tiny re-implementation of run-registry-io.ts's resolveCwHome so
// this module has no import-time dependency on that file beyond the type
// re-exports already pulled in above (keeps the module boundary the same
// shape as the old build's clones.ts -> run-registry.ts single-function
// import).
function resolveCwHomeForClones(env: NodeJS.ProcessEnv): string {
  if (env.CW_HOME && String(env.CW_HOME).trim()) return path.resolve(String(env.CW_HOME));
  if (env.XDG_STATE_HOME && String(env.XDG_STATE_HOME).trim()) {
    return path.join(path.resolve(String(env.XDG_STATE_HOME)), "cool-workflow");
  }
  return path.join(os.homedir(), ".local", "state", "cool-workflow");
}

function dirSize(dir: string): number {
  let total = 0;
  const walkDir = (d: string): void => {
    let names: string[];
    try {
      names = fs.readdirSync(d);
    } catch {
      return;
    }
    for (const name of names) {
      const p = path.join(d, name);
      let st: fs.Stats;
      try {
        st = fs.lstatSync(p);
      } catch {
        continue;
      }
      if (st.isDirectory()) walkDir(p);
      else total += st.size;
    }
  };
  walkDir(dir);
  return total;
}

function readCloneEntries(root: string): CloneEntry[] {
  let names: string[] = [];
  try {
    names = fs.readdirSync(root);
  } catch {
    return [];
  }
  const entries: CloneEntry[] = [];
  for (const hash of names) {
    if (hash.startsWith(".")) continue;
    const dir = path.join(root, hash);
    let st: fs.Stats;
    try {
      st = fs.statSync(dir);
    } catch {
      continue;
    }
    if (!st.isDirectory()) continue;
    let meta: Record<string, unknown> = {};
    try {
      meta = JSON.parse(fs.readFileSync(path.join(dir, ".cw-clone-meta.json"), "utf8"));
    } catch {
      /* legacy/partial entry without meta — still listable/reclaimable */
    }
    entries.push({
      hash,
      url: typeof meta.url === "string" ? meta.url : "(unknown)",
      kind: typeof meta.kind === "string" ? meta.kind : "git",
      ref: typeof meta.ref === "string" ? meta.ref : null,
      fetchedAt: typeof meta.fetchedAt === "string" ? meta.fetchedAt : null,
      commit: typeof meta.commit === "string" ? meta.commit : null,
      bytes: dirSize(dir),
    });
  }
  entries.sort((a, b) => stableCompare(a.fetchedAt || "", b.fetchedAt || ""));
  return entries;
}

/** `cw clones list` — every cached remote checkout with its origin,
 *  commit, age, and size. */
export function listClones(env: NodeJS.ProcessEnv = process.env): ClonesListResult {
  const root = clonesRoot(env);
  const entries = readCloneEntries(root);
  return { schemaVersion: 1, clonesDir: root, count: entries.length, totalBytes: entries.reduce((sum, e) => sum + e.bytes, 0), entries };
}

/** `cw clones gc [--older-than-days N] [--all]` — reclaim cached
 *  checkouts. Default keeps entries fetched within the last 30 days;
 *  `--all` removes every entry. Deletes ONLY paths proven inside the
 *  clones root (fail closed). */
export function gcClones(options: { olderThanDays?: unknown; all?: unknown; now?: unknown } = {}, env: NodeJS.ProcessEnv = process.env): ClonesGcResult {
  const root = clonesRoot(env);
  const all = isTrue(options.all);
  let olderThanDays: number | null = null;
  if (!all) {
    const raw = options.olderThanDays;
    olderThanDays = optionalNumber(raw) ?? 30;
    if (!Number.isFinite(olderThanDays) || olderThanDays < 0) {
      throw new Error(`--older-than-days must be a non-negative number (got ${String(raw)})`);
    }
  }
  let now = Date.now();
  if (options.now !== undefined) {
    now = new Date(String(options.now)).getTime();
    if (!Number.isFinite(now)) throw new Error(`--now must be a valid ISO date (got ${String(options.now)})`);
  }
  const cutoff = olderThanDays != null ? now - olderThanDays * 24 * 60 * 60 * 1000 : Infinity;
  const rootResolved = path.resolve(root);

  const removed: ClonesGcResult["removed"] = [];
  let freedBytes = 0;
  const entries = readCloneEntries(root);
  for (const entry of entries) {
    if (!all) {
      if (!entry.fetchedAt) continue;
      const age = new Date(entry.fetchedAt).getTime();
      if (!Number.isFinite(age) || age > cutoff) continue;
    }
    const dir = path.join(root, entry.hash);
    if (!path.resolve(dir).startsWith(rootResolved + path.sep)) continue; // containment, fail closed
    fs.rmSync(dir, { recursive: true, force: true });
    removed.push({ hash: entry.hash, url: entry.url, bytes: entry.bytes });
    freedBytes += entry.bytes;
  }
  return { schemaVersion: 1, clonesDir: root, removed, freedBytes, keptCount: entries.length - removed.length, olderThanDays, all };
}

export function formatClonesList(result: ClonesListResult): string {
  if (result.count === 0) return `No cached remote checkouts in ${result.clonesDir}.`;
  const rows = result.entries.map((e) => {
    const when = e.fetchedAt ? e.fetchedAt.replace("T", " ").replace(/\..*$/, "Z") : "unknown";
    return `  ${e.kind.padEnd(7)} ${humanBytesLocal(e.bytes).padStart(8)}  ${when}  ${e.url}${e.ref ? `@${e.ref}` : ""}`;
  });
  return [
    `${result.count} cached checkout${result.count === 1 ? "" : "s"} — ${humanBytesLocal(result.totalBytes)} in ${result.clonesDir}`,
    "  KIND       SIZE  FETCHED               SOURCE",
    ...rows,
    `\nReclaim with: cw clones gc --older-than-days 30   (or --all)`,
  ].join("\n");
}

export function formatClonesGc(result: ClonesGcResult): string {
  const scope = result.all ? "all entries" : `entries older than ${result.olderThanDays} day(s)`;
  if (result.removed.length === 0) return `Nothing to reclaim (${scope}); ${result.keptCount} kept in ${result.clonesDir}.`;
  const rows = result.removed.map((r) => `  ${humanBytesLocal(r.bytes).padStart(8)}  ${r.url}`);
  return [
    `Reclaimed ${result.removed.length} checkout${result.removed.length === 1 ? "" : "s"} (${scope}) — freed ${humanBytesLocal(result.freedBytes)}; ${result.keptCount} kept`,
    ...rows,
  ].join("\n");
}
