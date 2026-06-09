// Run Retention & Provable Reclamation (v0.1.39) — the core write-ahead, fail-closed
// reclamation transaction. Frees disk WITHOUT violating the audit/replay moat:
// freeing bytes leaves behind a hash-chained tombstone proving what was freed is
// reconstructable-or-worthless and that the audit-essential subset is sealed.
//
// BSD / Unix discipline (each tenet is a hard constraint; load-bearing ones flagged):
//
//  - THE INVARIANT [LOAD-BEARING]: never delete what is audit-essential AND
//    irreproducible. A byte is freeable ONLY if it is (1) reconstructable from
//    retained inputs + a recorded recipe + an `expectDigest`, or (2) pure scratch
//    with zero audit value — AND referenced by no surviving evidence locator or
//    audit event. Any UNCLASSIFIED path defaults to RETAINED.
//  - WRITE-AHEAD, FAIL-CLOSED SEQUENCING [LOAD-BEARING]: extract+seal skeleton →
//    write full tombstone (pre-deletion sha256 per path) → fsync/commit into the
//    append-only overlay → ONLY THEN free the bulk. A crash between any steps
//    leaves EITHER the full run OR a complete tombstone — never half-deleted.
//  - APPEND-ONLY [LOAD-BEARING]: the tombstone is a NEW `reclaimed.json` overlay;
//    only bulk DATA bytes are freed — no existing audit/state/commit record is ever
//    rewritten. Hash-chained: tombstoneHash recomputed from freed-manifest + sealed
//    skeleton + prevTombstoneHash (genesis = sha256 of the sealed skeleton).
//  - CAPABILITY DOWNGRADE IS EXPLICIT [LOAD-BEARING for replay]: reclaiming a
//    snapshot downgrades re-runnable → verify-only (or re-runnable-by-reconstruction
//    when inputs + expectDigest are retained), surfaced as a closed-enum reason.
//
// This module is LOW-LEVEL (no import of run-registry); the registry composes
// these primitives. See docs/run-retention-reclamation.7.md.

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { normalizeValue, stableStringify } from "./multi-agent-eval";
import { loadNodeSnapshot, snapshotNode } from "./node-snapshot";
import { recordTrustAuditEvent } from "./trust-audit";
import {
  FreedManifestEntry,
  ReclaimKind,
  ReclamationSkeleton,
  ReclamationTombstone,
  ReclaimedOverlay,
  ReconstructionRecipe,
  RunCapability,
  RunCapabilityReason,
  RunLifecycleState,
  StateNode,
  WorkflowRun
} from "./types";

export const RECLAMATION_SCHEMA_VERSION = 1;

/** The skeleton schema is the contract for what MUST survive every reclamation.
 *  Machine-checkable via validateSkeleton(). If extraction can't produce all of
 *  these, reclamation fails closed and frees nothing. */
export const SKELETON_REQUIRED_KEYS = [
  "runId",
  "finalVerdict",
  "commits",
  "evidenceDigests",
  "attestationChain",
  "costRecord",
  "auditLog",
  "collaborationLog",
  "stateDigest"
] as const;

/** Synthetic abort thrown by runReclamation({ faultAfter }) — a TESTABLE crash
 *  injection that never kills the process. */
export class ReclamationAbort extends Error {
  step: string;
  constructor(step: string) {
    super(`ReclamationAbort after step: ${step}`);
    this.name = "ReclamationAbort";
    this.step = step;
  }
}

/** Fail-closed refusal: a real reason reclamation freed nothing (distinct code). */
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

// ---------------------------------------------------------------------------
// Content addressing + byte measurement (NO `du` — in-process only).
// ---------------------------------------------------------------------------

function sha256Hex(value: string | Buffer): string {
  return crypto.createHash("sha256").update(value).digest("hex");
}
export function sha256OfString(value: string): string {
  return `sha256:${sha256Hex(value)}`;
}
export function sha256OfFile(file: string): string {
  return `sha256:${sha256Hex(fs.readFileSync(file))}`;
}

/** Walk a path and sum file sizes IN-PROCESS (no `du`). Returns 0 if absent. A
 *  file returns its own size; a dir returns the recursive sum. */
export function dirBytes(p: string): number {
  let total = 0;
  let stat: fs.Stats;
  try {
    stat = fs.statSync(p);
  } catch {
    return 0;
  }
  if (stat.isFile()) return stat.size;
  if (!stat.isDirectory()) return 0;
  for (const entry of fs.readdirSync(p, { withFileTypes: true })) {
    total += dirBytes(path.join(p, entry.name));
  }
  return total;
}

/** Stable content digest of a path (file = its bytes; dir = digest over each
 *  member's relative path + bytes, sorted). Lets the freed-manifest record a
 *  single sha per freed dir. */
function contentDigest(p: string): string {
  const stat = fs.statSync(p);
  if (stat.isFile()) return sha256OfFile(p);
  const parts: string[] = [];
  const walk = (dir: string, rel: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
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
// Durable write (temp → fsync → rename → fsync dir). The tombstone commit MUST
// be durable before any byte is freed — order is the safety property.
// ---------------------------------------------------------------------------

function writeJsonDurable(file: string, value: unknown): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp-${sha256Hex(file).slice(0, 8)}`;
  const fd = fs.openSync(tmp, "w");
  try {
    fs.writeFileSync(fd, `${JSON.stringify(value, null, 2)}\n`, "utf8");
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  fs.renameSync(tmp, file);
  try {
    const dirFd = fs.openSync(path.dirname(file), "r");
    try {
      fs.fsyncSync(dirFd);
    } finally {
      fs.closeSync(dirFd);
    }
  } catch {
    /* directory fsync is best-effort (not supported on every platform) */
  }
}

/** Persist a run's authoritative state.json DURABLY (temp → fsync → rename). The
 *  re-point that scratch reclamation depends on MUST be persisted this way BEFORE
 *  any byte is freed — see prepareFree(). Mirrors saveCheckpoint but atomic. */
function persistRunDurable(run: WorkflowRun): void {
  run.updatedAt = new Date().toISOString();
  writeJsonDurable(run.paths.state, run);
}

// ---------------------------------------------------------------------------
// Per-run reclamation lock (P1-C) — serialize the read-modify-write on
// reclaimed.json so two concurrent reclaimers can never lose a tombstone
// (freed-without-proof). Portable advisory lock via O_EXCL (`wx`), with a stale
// steal so a crashed holder can never wedge the run forever.
// ---------------------------------------------------------------------------

const RECLAIM_LOCK_STALE_MS = 30_000;

function sleepSync(ms: number): void {
  // Synchronous, deterministic sleep without busy-spinning the CPU.
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function lockPath(run: WorkflowRun): string {
  return path.join(run.paths.runDir, ".reclaim.lock");
}

function acquireRunLock(run: WorkflowRun): () => void {
  const file = lockPath(run);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  for (let attempt = 0; attempt < 200; attempt++) {
    try {
      const fd = fs.openSync(file, "wx");
      fs.writeFileSync(fd, `${process.pid}@${new Date().toISOString()}\n`, "utf8");
      fs.closeSync(fd);
      return () => {
        try {
          fs.rmSync(file, { force: true });
        } catch {
          /* releasing a missing lock is fine */
        }
      };
    } catch (error) {
      if (!(error && typeof error === "object" && (error as { code?: string }).code === "EEXIST")) throw error;
      // Steal a stale lock (a crashed holder must not wedge the run forever).
      try {
        const age = Date.now() - fs.statSync(file).mtimeMs;
        if (age > RECLAIM_LOCK_STALE_MS) {
          fs.rmSync(file, { force: true });
          continue;
        }
      } catch {
        /* lock vanished between open and stat — retry immediately */
        continue;
      }
      sleepSync(25);
    }
  }
  throw new ReclamationError("reclaim-locked", `could not acquire reclamation lock for run ${run.id}`);
}

/** Run `fn` while holding the per-run reclamation lock; always released. */
function withRunLock<T>(run: WorkflowRun, fn: () => T): T {
  const release = acquireRunLock(run);
  try {
    return fn();
  } finally {
    release();
  }
}

// ---------------------------------------------------------------------------
// The per-run reclamation log (`reclaimed.json`) — an append-only chain of
// tombstones, a PEER of archive.json, in the ALLOW-LIST (never freed).
// ---------------------------------------------------------------------------

export function reclaimedLogPath(run: WorkflowRun): string {
  return path.join(run.paths.runDir, "reclaimed.json");
}

export function loadReclamationLog(run: WorkflowRun): ReclaimedOverlay {
  const file = reclaimedLogPath(run);
  if (!fs.existsSync(file)) return { schemaVersion: 1, runId: run.id, tombstones: [] };
  try {
    const parsed = JSON.parse(fs.readFileSync(file, "utf8")) as ReclaimedOverlay;
    return { schemaVersion: 1, runId: run.id, tombstones: Array.isArray(parsed.tombstones) ? parsed.tombstones : [] };
  } catch {
    // A malformed overlay must NOT brick the run — fail closed to an empty chain.
    return { schemaVersion: 1, runId: run.id, tombstones: [] };
  }
}

// ---------------------------------------------------------------------------
// Skeleton extraction — the audit-essential subset that must survive.
// ---------------------------------------------------------------------------

function deriveTerminalLifecycle(run: WorkflowRun): RunLifecycleState {
  const tasks = run.tasks || [];
  const running = tasks.filter((t) => t.status === "running").length;
  const failed = tasks.filter((t) => t.status === "failed").length;
  const completed = tasks.filter((t) => t.status === "completed").length;
  const total = tasks.length;
  const pending = tasks.filter((t) => t.status === "pending").length;
  const openFeedback = (run.feedback || []).filter((f) => f.status === "open" || f.status === "tasked").length;
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
  // Prefer the file's content digest when the locator resolves to a real path.
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

/** STEP 1: extract + seal the skeleton. Pure read over the run; never mutates. */
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
    acceptanceRationale: commit.acceptanceRationale as Record<string, unknown> | undefined
  }));

  const evidenceSources: Array<{ locator?: string; path?: string; summary?: string; id?: string }> = [];
  for (const node of run.nodes || []) for (const e of node.evidence || []) evidenceSources.push(e);
  for (const candidate of run.candidates || []) for (const e of candidate.evidence || []) evidenceSources.push(e);
  for (const selection of run.candidateSelections || []) for (const e of selection.evidence || []) evidenceSources.push(e);
  for (const commit of run.commits || []) for (const e of commit.evidence || []) evidenceSources.push(e);
  const evidenceMap = new Map<string, string>();
  for (const e of evidenceSources) {
    const digested = digestEvidenceEntry(e);
    if (digested) evidenceMap.set(digested.ref, digested.digest);
  }
  const evidenceDigests = [...evidenceMap.entries()]
    .map(([ref, digest]) => ({ ref, digest }))
    .sort((a, b) => a.ref.localeCompare(b.ref));

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
    tasks: (run.tasks || []).map((task) => ({ taskId: task.id, model: task.usage?.model, source: task.usage?.source })),
    metricsDigest: fs.existsSync(metricsReport) ? sha256OfFile(metricsReport) : undefined
  };

  const collaboration = run.collaboration;
  const collaborationLog = {
    digest: sha256OfString(stableStringify(collaboration || {})),
    approvals: collaboration?.approvals?.length || 0,
    comments: collaboration?.comments?.length || 0,
    handoffs: collaboration?.handoffs?.length || 0
  };

  // Empty (not a hash-of-empty) when state.json is absent, so the skeleton fails
  // closed — you cannot seal a run whose authoritative state is gone.
  const stateDigest = fs.existsSync(run.paths.state) ? sha256OfFile(run.paths.state) : "";

  return {
    schemaVersion: 1,
    runId: run.id,
    finalVerdict: {
      lifecycle,
      loopStage: run.loopStage,
      terminal: lifecycle === "completed" || lifecycle === "failed",
      commitGated: (run.commits || []).some((c) => c.verifierGated)
    },
    commits,
    evidenceDigests,
    attestationChain: { auditLogDigest, eventCount: events.length, events },
    costRecord,
    auditLog: { path: path.relative(run.paths.runDir, eventLog), digest: auditLogDigest },
    collaborationLog,
    stateDigest
  };
}

/** Return the list of SKELETON_REQUIRED_KEYS that are missing/empty. Empty array
 *  ⇒ schema-complete. The runId + a populated finalVerdict are load-bearing. */
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
  }
  return missing;
}

// ---------------------------------------------------------------------------
// Reference graph — the load-bearing classifier guard. A candidate/blackboard
// path referenced by ANY surviving evidence locator / audit event forces
// retention (fail closed). Scratch is the carved exception: its raw result.md is
// referenced by the result node, but that reference is REPOINTED (not retained).
// ---------------------------------------------------------------------------

function buildReferenceGraph(run: WorkflowRun): Set<string> {
  const refs = new Set<string>();
  const add = (value: unknown) => {
    if (typeof value === "string" && value.trim()) refs.add(value.trim());
  };
  for (const node of run.nodes || []) {
    for (const e of node.evidence || []) {
      add(e.locator);
      add(e.path);
      add(e.id);
    }
  }
  for (const candidate of run.candidates || []) for (const e of candidate.evidence || []) add(e.locator);
  for (const commit of run.commits || []) for (const e of commit.evidence || []) add(e.locator);
  for (const artifact of run.blackboard?.artifacts || []) {
    add(artifact.id);
    add((artifact as { path?: string }).path);
  }
  for (const message of run.blackboard?.messages || []) add(message.id);
  return refs;
}

// ---------------------------------------------------------------------------
// Classifier / planner — tags each candidate freeable path with a ReclaimKind,
// defaults unclassified → RETAINED. Pure over run + policy; frees nothing.
// ---------------------------------------------------------------------------

export interface PlannedFree {
  /** Path RELATIVE to the run dir. */
  path: string;
  /** Absolute path (for measurement / freeing). */
  absPath: string;
  kind: ReclaimKind;
  bytes: number;
  recipe?: ReconstructionRecipe;
  /** For scratch: the result node whose `worker-result` artifact must be re-pointed. */
  repointResultNodeId?: string;
}

export interface ReclamationPlan {
  freeable: PlannedFree[];
  bytesToFree: number;
  byKind: Partial<Record<ReclaimKind, number>>;
  capability: RunCapability;
  capabilityReason: RunCapabilityReason;
}

function snapshotProjectionDigest(node: StateNode): string {
  // Mirror node-snapshot.ts's deterministic projection so reconstruction matches.
  const body = normalizeValue({
    id: node.id,
    kind: node.kind,
    status: node.status,
    loopStage: node.loopStage,
    inputs: node.inputs,
    outputs: node.outputs,
    artifacts: node.artifacts,
    evidence: node.evidence,
    errors: node.errors,
    parents: node.parents,
    children: node.children,
    contractId: node.contractId,
    metadata: node.metadata
  });
  return sha256OfString(stableStringify(body));
}

/** Body digest of the RETAINED node (lives in state.json). The reconstruction
 *  verifier re-derives the projection from this retained input. */
function nodeBodyDigest(node: StateNode): string {
  return sha256OfString(stableStringify(rawNodeBody(node)));
}

function rawNodeBody(node: StateNode): Record<string, unknown> {
  return {
    id: node.id,
    kind: node.kind,
    status: node.status,
    loopStage: node.loopStage,
    inputs: node.inputs,
    outputs: node.outputs,
    artifacts: node.artifacts,
    evidence: node.evidence,
    errors: node.errors,
    parents: node.parents,
    children: node.children,
    contractId: node.contractId,
    metadata: node.metadata
  };
}

/** Build the retention plan: which paths are freeable under `policy`, of what
 *  kind, how many bytes, and the resulting capability downgrade. */
export function planReclamation(run: WorkflowRun, policy: ReclamationPolicyInput = {}): ReclamationPlan {
  const runDir = run.paths.runDir;
  const freeable: PlannedFree[] = [];
  const rel = (abs: string) => path.relative(runDir, abs);

  // (1) Worker scratch dirs — pure scratch with zero audit value. result.md is
  // already copied to results/<task>.md (evidence-gated). The whole workerDir is
  // freeable once the result node's worker-result artifact is re-pointed.
  let reclaimedScratch = false;
  if (!policy.keepScratch) {
    const workersDir = run.paths.workersDir || path.join(runDir, "workers");
    for (const scope of run.workers || []) {
      const workerDir = scope.workerDir;
      if (!workerDir || !fs.existsSync(workerDir)) continue;
      // Only reclaim a worker whose output was accepted (result retained under results/).
      const task = (run.tasks || []).find((t) => t.id === scope.taskId);
      const resultNodeId = scope.resultNodeId || task?.resultNodeId;
      const resultsCopy = task?.resultPath;
      if (!resultNodeId || !resultsCopy || !fs.existsSync(resultsCopy)) continue;
      const bytes = dirBytes(workerDir);
      if (bytes <= 0) continue;
      freeable.push({
        path: rel(workerDir),
        absPath: workerDir,
        kind: "scratch",
        bytes,
        repointResultNodeId: resultNodeId
      });
      reclaimedScratch = true;
    }
    void workersDir;
  }

  // A node whose scratch is being re-pointed THIS pass must NOT also have its
  // snapshot freed in the same pass — re-pointing mutates the node body, which
  // would make the snapshot's reconstruction recipe mismatch. Fail closed: retain
  // such snapshots (a later pass, after the body settles, can reclaim them).
  const repointNodeIds = new Set(freeable.filter((f) => f.repointResultNodeId).map((f) => f.repointResultNodeId));

  // (2) Reconstructable node snapshots — deterministic projection of a RETAINED
  // node (state.json). Reclaim the persisted snapshot file; retain the recipe +
  // expectDigest so the projection re-derives without the freed bytes.
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
          let snap: { nodeId?: string };
          try {
            snap = JSON.parse(fs.readFileSync(snapFile, "utf8")) as { nodeId?: string };
          } catch {
            continue; // unreadable snapshot → retain (fail closed)
          }
          const node = (run.nodes || []).find((n) => n.id === snap.nodeId);
          if (!node) continue; // source node gone → cannot reconstruct → retain
          if (repointNodeIds.has(node.id)) continue; // body will be re-pointed → retain
          const bytes = dirBytes(snapFile);
          if (bytes <= 0) continue;
          const inputDigest = nodeBodyDigest(node);
          const recipe: ReconstructionRecipe = {
            recipeKind: "node-snapshot-projection",
            inputDigests: [inputDigest],
            inputsDigest: sha256OfString(stableStringify([inputDigest])),
            expectDigest: snapshotProjectionDigest(node),
            sourceRef: node.id
          };
          freeable.push({ path: rel(snapFile), absPath: snapFile, kind: "reconstructable-snapshot", bytes, recipe });
          reclaimedSnapshot = true;
          reconstructableSnapshot = true;
        }
      }
    }
  }

  // (3 / 4) candidate + reference-free blackboard artifacts are RETAINED by
  // default in v0.1.39 (fail closed): a referenced blackboard digest forces
  // retention, and we do not yet auto-capture reconstruction recipes for them.
  // The reference graph is consulted so the door is closed, not merely unbuilt.
  void buildReferenceGraph;

  const byKind: Partial<Record<ReclaimKind, number>> = {};
  let bytesToFree = 0;
  for (const entry of freeable) {
    byKind[entry.kind] = (byKind[entry.kind] || 0) + entry.bytes;
    bytesToFree += entry.bytes;
  }

  // Capability projection (closed enum). Reclaiming a reconstructable snapshot →
  // re-runnable-by-reconstruction; a non-reconstructable snapshot → verify-only;
  // scratch/none → re-runnable (scratch is pure waste, replay is unaffected).
  let capability: RunCapability = "re-runnable";
  let capabilityReason: RunCapabilityReason = "scratch-only-reclaimed";
  if (reclaimedSnapshot && reconstructableSnapshot) {
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
// Tombstone construction + hash chain.
// ---------------------------------------------------------------------------

export interface ReclamationPolicyInput {
  keepScratch?: boolean;
  keepSnapshots?: boolean;
}

function policyDigestOf(policy: Record<string, unknown>): string {
  return sha256OfString(stableStringify(policy));
}

/** genesis prevTombstoneHash = sha256 of the sealed skeleton. */
export function genesisPrevHash(skeleton: ReclamationSkeleton): string {
  return sha256OfString(stableStringify(skeleton));
}

/** The canonical bytes a tombstoneHash binds: freed-manifest + sealed skeleton +
 *  prevTombstoneHash + capability. Recomputed independently by `gc verify`. */
function tombstoneHashInput(t: Omit<ReclamationTombstone, "tombstoneHash">): string {
  return stableStringify({
    runId: t.runId,
    tombstoneId: t.tombstoneId,
    reclaimedAt: t.reclaimedAt,
    actor: t.actor || null,
    policyDigest: t.policyDigest,
    freed: t.freed.map((f) => ({ path: f.path, kind: f.kind, bytes: f.bytes, sha256: f.sha256, recipe: f.recipe || null })),
    bytesFreed: t.bytesFreed,
    skeletonDigest: sha256OfString(stableStringify(t.skeleton)),
    capability: t.capability,
    capabilityReason: t.capabilityReason,
    prevTombstoneHash: t.prevTombstoneHash
  });
}

export function computeTombstoneHash(t: Omit<ReclamationTombstone, "tombstoneHash">): string {
  return sha256OfString(tombstoneHashInput(t));
}

let tombstoneCounter = 0;
function tombstoneId(run: WorkflowRun, now: string): string {
  tombstoneCounter += 1;
  const stamp = now.replace(/[-:.TZ]/g, "").slice(0, 14);
  return `tomb-${stamp}-${String(tombstoneCounter).padStart(3, "0")}`;
}

export interface BuildTombstoneOptions {
  now?: string;
  actor?: string;
  policy?: Record<string, unknown>;
}

/** STEP 2: build the FULL tombstone (pre-deletion sha256 per freed path + the
 *  hash chain). Reads the freed files (still present); mutates nothing on disk. */
export function buildTombstone(
  run: WorkflowRun,
  skeleton: ReclamationSkeleton,
  plan: ReclamationPlan,
  options: BuildTombstoneOptions = {}
): ReclamationTombstone {
  const now = options.now || new Date().toISOString();
  const prior = loadReclamationLog(run).tombstones;
  const prevTombstoneHash = prior.length ? prior[prior.length - 1].tombstoneHash : genesisPrevHash(skeleton);
  const freed: FreedManifestEntry[] = plan.freeable.map((entry) => ({
    path: entry.path,
    kind: entry.kind,
    bytes: entry.bytes,
    sha256: contentDigest(entry.absPath),
    recipe: entry.recipe
  }));
  const base: Omit<ReclamationTombstone, "tombstoneHash"> = {
    schemaVersion: 1,
    runId: run.id,
    tombstoneId: tombstoneId(run, now),
    reclaimedAt: now,
    actor: options.actor,
    policyDigest: policyDigestOf(options.policy || {}),
    freed,
    bytesFreed: freed.reduce((sum, f) => sum + f.bytes, 0),
    skeleton,
    capability: plan.capability,
    capabilityReason: plan.capabilityReason,
    prevTombstoneHash
  };
  return { ...base, tombstoneHash: computeTombstoneHash(base) };
}

/** STEP 3: commit the tombstone DURABLY into the append-only overlay (temp →
 *  fsync → rename) and record the attestation through the append-only audit log.
 *  No byte is freed here — write-ahead order is the safety property. */
export function commitTombstone(run: WorkflowRun, tombstone: ReclamationTombstone): void {
  const log = loadReclamationLog(run);
  log.tombstones.push(tombstone);
  writeJsonDurable(reclaimedLogPath(run), log);
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
        actor: tombstone.actor
      }
    });
  } catch {
    // The tombstone is already durable; an audit-append hiccup must not unwind it.
  }
}

/** STEP 4 (preparation, P1-A + P1-B): re-point every surviving node's artifacts
 *  off the scratch paths about to vanish, DURABLY persist that state.json change,
 *  and PROVE no surviving node still references a freed path (and that each
 *  re-pointed result node's snapshot stays `valid`) — BEFORE a single byte is
 *  freed. Fail closed (`repoint-incomplete`) if the proof does not hold, so a
 *  crash can never leave state.json pointing at a freed path. */
export function prepareFree(run: WorkflowRun, tombstone: ReclamationTombstone): void {
  const runDir = run.paths.runDir;
  const scratchDirs = tombstone.freed.filter((f) => f.kind === "scratch").map((f) => path.resolve(path.join(runDir, f.path)));
  if (!scratchDirs.length) return; // nothing references a freed path; no state change needed.

  const repointed = new Set<string>();
  for (const scratchDir of scratchDirs) {
    for (const id of repointResultNodeArtifacts(run, scratchDir)) repointed.add(id);
  }

  // Durably persist the re-point so it survives a crash BEFORE the free runs.
  persistRunDurable(run);

  // PROOF 1: no surviving node artifact may resolve inside any freed scratch dir.
  for (const node of run.nodes || []) {
    for (const artifact of node.artifacts || []) {
      if (!artifact.path) continue;
      const resolved = path.resolve(artifact.path);
      for (const scratchDir of scratchDirs) {
        if (resolved === scratchDir || resolved.startsWith(scratchDir + path.sep)) {
          throw new ReclamationError("repoint-incomplete", `node ${node.id} artifact ${artifact.id} still references freed scratch path ${artifact.path}`, {
            nodeId: node.id,
            artifactId: artifact.id,
            path: artifact.path
          });
        }
      }
    }
  }

  // PROOF 2: each re-pointed result node's snapshot stays `valid` (not `absent`).
  for (const nodeId of repointed) {
    try {
      const fresh = snapshotNode(run, nodeId, { persist: false });
      const { freshness } = loadNodeSnapshot(run, fresh);
      if (freshness === "absent") {
        throw new ReclamationError("repoint-incomplete", `re-pointed node ${nodeId} snapshot is absent (dangling artifact)`, { nodeId });
      }
    } catch (error) {
      if (error instanceof ReclamationError) throw error;
      throw new ReclamationError("repoint-incomplete", `could not prove re-pointed node ${nodeId} stays valid: ${(error as Error).message}`, { nodeId });
    }
  }
}

/** STEP 5: free the bulk DATA bytes. Pure deletion — every re-point is already
 *  done and DURABLY persisted by prepareFree(), so a crash here can never leave a
 *  surviving node referencing a freed path. */
export function freeBulk(run: WorkflowRun, tombstone: ReclamationTombstone): number {
  const runDir = run.paths.runDir;
  let freedBytes = 0;
  for (const entry of tombstone.freed) {
    const abs = path.join(runDir, entry.path);
    const before = dirBytes(abs);
    fs.rmSync(abs, { recursive: true, force: true });
    freedBytes += before;
  }
  return freedBytes;
}

/** Re-point a node's artifacts off `freedScratchDir` to the retained `result`
 *  copy. Returns the ids of nodes actually changed (for the validity proof). */
function repointResultNodeArtifacts(run: WorkflowRun, freedScratchDir: string): string[] {
  const freedPrefix = path.resolve(freedScratchDir) + path.sep;
  const changedIds: string[] = [];
  for (const node of run.nodes || []) {
    if (!node.artifacts) continue;
    let changed = false;
    for (const artifact of node.artifacts) {
      if (!artifact.path) continue;
      const resolved = path.resolve(artifact.path);
      if (resolved === path.resolve(freedScratchDir) || resolved.startsWith(freedPrefix)) {
        // Re-point to the retained results/<task>.md copy (the `result` artifact).
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

// ---------------------------------------------------------------------------
// The composed transaction — discrete steps with a TESTABLE fault injector.
// ---------------------------------------------------------------------------

export interface RunReclamationOptions {
  now?: string;
  actor?: string;
  policy?: Record<string, unknown>;
  reclaimPolicy?: ReclamationPolicyInput;
  /** Synthetic crash point (TESTABLE; never kills the process). */
  faultAfter?: "skeleton" | "tombstone-write" | "tombstone-commit";
}

export interface RunReclamationResult {
  tombstone: ReclamationTombstone;
  bytesFreed: number;
  plan: ReclamationPlan;
}

/** Execute the write-ahead, fail-closed reclamation transaction. Ordering is the
 *  safety property: extract+seal skeleton → [under the per-run lock: build
 *  tombstone → commit (fsync)] → re-point + DURABLY persist state + prove no
 *  dangling reference → free bulk. The lock (P1-C) makes the chain read-modify-
 *  write atomic so a concurrent reclaimer can never lose a tombstone. The durable
 *  re-point BEFORE free (P1-A) means a crash can never leave state.json pointing
 *  at a freed path. `faultAfter` aborts after the named step so crash-safety is
 *  testable by design — a crash leaves EITHER the full run OR a complete
 *  tombstone, never a half-deleted run with no proof. */
export function runReclamation(run: WorkflowRun, options: RunReclamationOptions = {}): RunReclamationResult {
  // STEP 1 — extract + seal skeleton. Fail closed if incomplete (free nothing).
  const skeleton = extractSkeleton(run);
  const missing = validateSkeleton(skeleton);
  if (missing.length) {
    throw new ReclamationError("skeleton-incomplete", `Skeleton missing required keys: ${missing.join(", ")}`, { missing });
  }
  if (options.faultAfter === "skeleton") throw new ReclamationAbort("skeleton");

  // STEPS 2-3 — under the per-run lock so the chain's read (prevTombstoneHash) and
  // append are atomic: build the full tombstone (pre-deletion sha256 + chain) and
  // commit it durably (fsync) into the append-only overlay.
  const { plan, tombstone } = withRunLock(run, () => {
    const builtPlan = planReclamation(run, options.reclaimPolicy || {});
    const builtTombstone = buildTombstone(run, skeleton, builtPlan, { now: options.now, actor: options.actor, policy: options.policy });
    if (options.faultAfter === "tombstone-write") throw new ReclamationAbort("tombstone-write");
    commitTombstone(run, builtTombstone);
    return { plan: builtPlan, tombstone: builtTombstone };
  });
  if (options.faultAfter === "tombstone-commit") throw new ReclamationAbort("tombstone-commit");

  // STEP 4 — re-point surviving nodes off the scratch, DURABLY persist that
  // state change, and PROVE no node references a freed path — all before freeing.
  prepareFree(run, tombstone);

  // STEP 5 — ONLY NOW free the bulk bytes.
  const bytesFreed = freeBulk(run, tombstone);
  return { tombstone, bytesFreed, plan };
}

// ---------------------------------------------------------------------------
// Reconstruction — re-derive a freed artifact from its RETAINED inputs, NEVER
// the freed source bytes. Distinct code path from live verifyNodeReplay.
// ---------------------------------------------------------------------------

/** Re-derive a reconstructable artifact's expectDigest from the retained run.
 *  Returns the recomputed digest (to compare to recipe.expectDigest). */
export function reconstructArtifact(run: WorkflowRun, recipe: ReconstructionRecipe): { inputsDigest: string; expectDigest: string } {
  if (recipe.recipeKind === "node-snapshot-projection") {
    const node = (run.nodes || []).find((n) => n.id === recipe.sourceRef);
    if (!node) {
      return { inputsDigest: sha256OfString("absent"), expectDigest: sha256OfString("absent") };
    }
    const inputDigest = nodeBodyDigest(node);
    const inputsDigest = sha256OfString(stableStringify([inputDigest]));
    const expectDigest = snapshotProjectionDigest(node);
    return { inputsDigest, expectDigest };
  }
  // Unknown recipe kind → fail closed (digest can't match expectDigest).
  return { inputsDigest: sha256OfString("unknown-recipe"), expectDigest: sha256OfString("unknown-recipe") };
}

// ---------------------------------------------------------------------------
// Verification — re-prove a reclaimed run independently.
// ---------------------------------------------------------------------------

export interface VerifyCheck {
  name: string;
  pass: boolean;
  code?: string;
  detail?: string;
}

/** Re-prove the whole reclamation chain for a run: skeleton schema-complete,
 *  tombstoneHash/prevTombstoneHash chain recomputed-and-untampered, and each
 *  reconstructable artifact re-derived from RETAINED inputs to its expectDigest.
 *  Recomputes every hash independently — never trusts the stored value. */
export function verifyReclamation(run: WorkflowRun): { reclaimed: boolean; verified: boolean; checks: VerifyCheck[]; tombstones: ReclamationTombstone[] } {
  const log = loadReclamationLog(run);
  const tombstones = log.tombstones;
  const checks: VerifyCheck[] = [];
  if (!tombstones.length) {
    return { reclaimed: false, verified: false, checks: [{ name: "reclaimed", pass: false, code: "not-reclaimed" }], tombstones };
  }

  // (a) chain linkage FIRST (priority): genesis = sha256 of the (first) skeleton.
  let chainOk = true;
  for (let i = 0; i < tombstones.length; i++) {
    const expectedPrev = i === 0 ? genesisPrevHash(tombstones[0].skeleton) : tombstones[i - 1].tombstoneHash;
    const pass = tombstones[i].prevTombstoneHash === expectedPrev;
    if (!pass) chainOk = false;
    checks.push({ name: `chain-link[${i}]`, pass, code: pass ? undefined : "tombstone-chain-broken" });
  }

  // (b) per-tombstone independent hash recompute (digest integrity).
  let digestsOk = true;
  for (let i = 0; i < tombstones.length; i++) {
    const { tombstoneHash, ...rest } = tombstones[i];
    const recomputed = computeTombstoneHash(rest);
    const pass = recomputed === tombstoneHash;
    if (!pass) digestsOk = false;
    checks.push({ name: `tombstone-hash[${i}]`, pass, code: pass ? undefined : "tombstone-digest-mismatch" });
  }

  // (c) skeleton schema completeness (each tombstone seals a complete skeleton).
  let skeletonOk = true;
  for (let i = 0; i < tombstones.length; i++) {
    const missing = validateSkeleton(tombstones[i].skeleton);
    const pass = missing.length === 0;
    if (!pass) skeletonOk = false;
    checks.push({ name: `skeleton[${i}]`, pass, code: pass ? undefined : "skeleton-incomplete", detail: missing.join(",") || undefined });
  }

  // (d) reconstruction — re-derive each reconstructable artifact from RETAINED
  // inputs (NOT the freed source) to its expectDigest.
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
        detail: pass ? undefined : `inputs=${inputsMatch} expect=${expectMatch}`
      });
    }
  }

  const verified = chainOk && digestsOk && skeletonOk && reconstructionOk;
  return { reclaimed: true, verified, checks, tombstones };
}

/** Pick the priority failure code from a check list (chain > digest >
 *  reconstruction > skeleton). Used to surface the single dominant code. */
export function dominantFailureCode(checks: VerifyCheck[]): string | undefined {
  const order = ["tombstone-chain-broken", "tombstone-digest-mismatch", "reconstruction-digest-mismatch", "skeleton-incomplete", "not-reclaimed"];
  for (const code of order) {
    if (checks.some((c) => !c.pass && c.code === code)) return code;
  }
  return undefined;
}
