// Run Registry / Control Plane (v0.1.28) — a DERIVED, rebuildable index over the
// runs that live under each repo's `.cw/runs/<id>/`, plus a home-level cross-repo
// registry. It manages many runs across repos: search, resume, archive, queue,
// cross-repo history, and failed-run rerun.
//
// BSD / Unix discipline (each non-trivial choice cites its tenet):
//
//  - SEPARATE MECHANISM FROM POLICY. The per-run `.cw/runs/<id>/state.json` is the
//    SINGLE SOURCE OF TRUTH (loadRunFromCwd) and is never owned or mutated here.
//    The registry is MECHANISM: a derived cache, rebuilt from source on demand.
//    Retention windows, queue ordering, and archive thresholds are POLICY and live
//    in RunRegistryPolicy / explicit flags, never baked into the index.
//
//  - DERIVED, NOT AUTHORITATIVE (fail closed). Every record carries a
//    `sourceFingerprint`; every read reports `valid|stale|absent` freshness, just
//    like the v0.1.25 state-explosion summaries. We ALWAYS re-derive a record from
//    source state when source is present, and surface `missing` (never a fabricated
//    status) when it is gone. An unreadable run is never treated as success.
//
//  - APPEND-ONLY HISTORY; NEVER MUTATE THE PAST. Resume continues an existing run
//    from durable state (read-only over source). Rerun creates a NEW run that
//    records a provenance link to the original; the failed run is preserved.
//    Archive is an overlay mark, not a delete — source truth stays in place and
//    stays searchable.
//
//  - EXPLICIT, INSPECTABLE STATE. Cross-repo discovery and the queue are plain
//    files under a home registry ($CW_HOME / XDG), readable and diffable. No hidden
//    database, no daemon required to read state.
//
//  - STABLE INTERFACES. Pre-v0.1.28 single-repo runs keep working with an empty /
//    rebuildable registry; nothing about `.cw/runs/` layout changes.

import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  GcPlanResult,
  GcRunResult,
  GcVerifyResult,
  LoopStage,
  ReclaimedOverlay,
  RunCapability,
  RunCapabilityReason,
  RunHistoryEntry,
  RunHistoryResult,
  RunLifecycleState,
  RunProvenance,
  RunQueueEntry,
  RunRecord,
  RunRecordFreshness,
  RunRegistryCounts,
  RunRegistryFreshness,
  RunRegistryIndex,
  RunRegistryPolicy,
  RunRegistryReport,
  RunRerunResult,
  RunResumeResult,
  RunSearchQuery,
  RunSearchResult,
  RunShowResult,
  RunTier,
  WorkflowRun
} from "./types";
import { createRunPaths, loadRunStateFile, readJson, withFileLock, writeJson } from "./state";
// planReclamation/runReclamation/verifyReclamation/ReclamationError moved with the
// GC cluster into ./run-registry/gc (FreeBSD-audit R2 deep).
import { compareBytes } from "./compare";
import {
  clampInt,
  compareHistory,
  compareQueue,
  compareRecords,
  countRecords,
  digestInputs,
  distinctBackends,
  isRunLifecycleState,
  loadReclaimedFromDir,
  matchesQuery,
  optionalLower
} from "./run-registry/derive";
import { gcPlan as gcPlanOp, gcRun as gcRunOp, gcVerify as gcVerifyOp, reclamationPolicy as reclamationPolicyOp, GcHost } from "./run-registry/gc";
import {
  loadQueue as loadQueueOp,
  queueAdd as queueAddOp,
  queueDrain as queueDrainOp,
  queueList as queueListOp,
  queueShow as queueShowOp,
  saveQueue as saveQueueOp,
  QueueHost
} from "./run-registry/queue";
import { DEFAULT_RUN_REGISTRY_POLICY, RUN_REGISTRY_SCHEMA_VERSION } from "./run-registry/policy";
// Re-export the pure helpers carved into ./run-registry/derive (FreeBSD-audit R2)
// so importers of "./run-registry" keep the unchanged surface.
export { compareQueue, isRunLifecycleState };
// POLICY constants now live in ./run-registry/policy (FreeBSD-audit R2 deep) to
// break the cycle with the carved gc/queue clusters. Re-exported so importers of
// "./run-registry" keep the unchanged surface.
export { DEFAULT_RUN_REGISTRY_POLICY, RUN_REGISTRY_SCHEMA_VERSION };

// ---------------------------------------------------------------------------
// Home registry location (EXPLICIT, INSPECTABLE STATE)
// ---------------------------------------------------------------------------

/** Resolve the home registry root: CW_HOME, then XDG_STATE_HOME/cool-workflow,
 *  then ~/.local/state/cool-workflow. Always a plain directory of plain files. */
export function resolveCwHome(env: NodeJS.ProcessEnv = process.env): string {
  if (env.CW_HOME && String(env.CW_HOME).trim()) return path.resolve(String(env.CW_HOME));
  if (env.XDG_STATE_HOME && String(env.XDG_STATE_HOME).trim()) {
    return path.join(path.resolve(String(env.XDG_STATE_HOME)), "cool-workflow");
  }
  return path.join(os.homedir(), ".local", "state", "cool-workflow");
}

interface ReposFile {
  schemaVersion: 1;
  repos: Array<{ root: string; addedAt: string }>;
}

interface ArchiveOverlay {
  schemaVersion: 1;
  archived: Record<string, { archivedAt: string; reason?: string }>;
}

interface ProvenanceOverlay {
  schemaVersion: 1;
  links: Record<string, RunProvenance>;
}

// QueueFile interface now lives with the queue cluster in ./run-registry/queue
// (FreeBSD-audit R2 deep).

interface RepoOverlays {
  archive: ArchiveOverlay;
  provenance: ProvenanceOverlay;
}

/** Minimal contract the registry needs to CREATE a new run for rerun. The
 *  CoolWorkflowRunner satisfies this structurally; we never fork run creation. */
export interface RunPlanner {
  plan(appId: string, options: Record<string, unknown>): WorkflowRun;
}

// ---------------------------------------------------------------------------
// Fingerprints (same shape/strength as state-explosion's)
// ---------------------------------------------------------------------------

function fingerprintStrings(values: string[]): string {
  const hash = crypto.createHash("sha256");
  hash.update(JSON.stringify([...values].sort()));
  return `sha256:${hash.digest("hex").slice(0, 32)}`;
}

/** Content fingerprint of a run's source state.json. Structural, not just mtime,
 *  so a tampered task status trips `stale` even if updatedAt is unchanged. */
function fingerprintRun(run: WorkflowRun): string {
  const parts: string[] = [
    `id:${run.id}`,
    `updatedAt:${run.updatedAt}`,
    `loopStage:${run.loopStage}`,
    `schema:${run.schemaVersion}`
  ];
  for (const task of [...run.tasks].sort((a, b) => compareBytes(a.id, b.id))) {
    parts.push(`task:${task.id}:${task.status}`);
  }
  for (const commit of [...run.commits].sort((a, b) => compareBytes(a.id, b.id))) {
    parts.push(`commit:${commit.id}:${commit.verifierGated ? "gated" : "checkpoint"}`);
  }
  for (const phase of [...run.phases].sort((a, b) => compareBytes(a.id, b.id))) {
    parts.push(`phase:${phase.id}:${phase.status}`);
  }
  for (const fb of [...(run.feedback || [])].sort((a, b) => compareBytes(a.id, b.id))) {
    parts.push(`feedback:${fb.id}:${fb.status}`);
  }
  return fingerprintStrings(parts);
}

// ---------------------------------------------------------------------------
// Lifecycle classification (THE STATE MACHINE — derived, never invented)
// ---------------------------------------------------------------------------

interface LifecycleInputs {
  total: number;
  pending: number;
  running: number;
  failed: number;
  completed: number;
  verifierGatedCommits: number;
  openFeedback: number;
  loopStage: LoopStage;
}

/**
 * Classify a run's lifecycle purely from its source state. First match wins:
 *   1. running > 0                                  -> running
 *   2. openFeedback > 0                             -> blocked   (failures under correction)
 *   3. failed > 0                                   -> failed
 *   4. total > 0 && completed === total            -> completed
 *   5. verifierGatedCommits > 0 && pending === 0   -> completed (commit-only runs)
 *   6. completed > 0                               -> running   (mid-flight)
 *   7. otherwise                                    -> queued
 * The classifier never invents status; `archived` is applied as an overlay on
 * top of this by deriveRecord, which keeps `derivedLifecycle` for search.
 */
export function deriveLifecycle(input: LifecycleInputs): RunLifecycleState {
  if (input.running > 0) return "running";
  if (input.openFeedback > 0) return "blocked";
  if (input.failed > 0) return "failed";
  if (input.total > 0 && input.completed === input.total) return "completed";
  if (input.verifierGatedCommits > 0 && input.pending === 0) return "completed";
  if (input.completed > 0) return "running";
  return "queued";
}

function lifecycleInputs(run: WorkflowRun): LifecycleInputs {
  const tasks = run.tasks || [];
  return {
    total: tasks.length,
    pending: tasks.filter((t) => t.status === "pending").length,
    running: tasks.filter((t) => t.status === "running").length,
    failed: tasks.filter((t) => t.status === "failed").length,
    completed: tasks.filter((t) => t.status === "completed").length,
    verifierGatedCommits: (run.commits || []).filter((c) => c.verifierGated).length,
    openFeedback: (run.feedback || []).filter((f) => f.status === "open" || f.status === "tasked").length,
    loopStage: run.loopStage
  };
}

// ---------------------------------------------------------------------------
// The registry
// ---------------------------------------------------------------------------

export class RunRegistry implements QueueHost, GcHost {
  readonly repoRoot: string;
  readonly homeRoot: string;
  private readonly planner?: RunPlanner;

  constructor(cwd: string = process.cwd(), planner?: RunPlanner, env: NodeJS.ProcessEnv = process.env) {
    this.repoRoot = path.resolve(cwd);
    this.homeRoot = resolveCwHome(env);
    this.planner = planner;
  }

  // ---- path helpers -------------------------------------------------------
  private repoRunsDir(repo: string): string {
    return path.join(repo, ".cw", "runs");
  }
  private repoRegistryDir(repo: string): string {
    return path.join(repo, ".cw", "registry");
  }
  // Public so the carved queue cluster (run-registry/queue.ts) can resolve the
  // home-registry dir without reaching into private state (QueueHost).
  homeRegistryDir(): string {
    return path.join(this.homeRoot, "registry");
  }

  // ---- per-repo overlays (plain files) ------------------------------------
  // Overlay reads distinguish ABSENT (clean default) from PRESENT-but-corrupt
  // (fail closed). readJson throws `Invalid JSON in <file>` on a present file
  // that won't parse; we let that propagate instead of swallowing it. Swallowing
  // is the absent-vs-corrupt conflation telemetry-ledger.ts flags as the bug that
  // "let a corrupt overlay verify green" — here it would silently un-archive every
  // archived run / drop every provenance link. This is authoritative durable state.
  private loadArchiveOverlay(repo: string): ArchiveOverlay {
    const file = path.join(this.repoRegistryDir(repo), "archive.json");
    if (!fs.existsSync(file)) return { schemaVersion: 1, archived: {} };
    const parsed = readJson(file) as ArchiveOverlay;
    return { schemaVersion: 1, archived: parsed.archived || {} };
  }
  private loadProvenanceOverlay(repo: string): ProvenanceOverlay {
    const file = path.join(this.repoRegistryDir(repo), "provenance.json");
    if (!fs.existsSync(file)) return { schemaVersion: 1, links: {} };
    const parsed = readJson(file) as ProvenanceOverlay;
    return { schemaVersion: 1, links: parsed.links || {} };
  }
  private loadRepoOverlays(repo: string): RepoOverlays {
    return {
      archive: this.loadArchiveOverlay(repo),
      provenance: this.loadProvenanceOverlay(repo)
    };
  }

  /** Default queue priority from POLICY (QueueHost). Exposed so the carved queue
   *  cluster never re-derives policy. */
  get defaultQueuePriority(): number {
    return DEFAULT_RUN_REGISTRY_POLICY.defaultQueuePriority;
  }

  // ---- home registry files ------------------------------------------------
  private reposFilePath(): string {
    return path.join(this.homeRegistryDir(), "repos.json");
  }
  private loadRepos(): ReposFile {
    const file = this.reposFilePath();
    // Absent => no registered repos. Present-but-corrupt must fail closed: a
    // swallowed parse error here silently drops every cross-repo root the
    // operator registered, shrinking the home index to the current repo with no
    // signal. Let readJson's `Invalid JSON` throw surface the corruption.
    if (!fs.existsSync(file)) return { schemaVersion: 1, repos: [] };
    const parsed = readJson(file) as ReposFile;
    return { schemaVersion: 1, repos: Array.isArray(parsed.repos) ? parsed.repos : [] };
  }
  /** Persisted union of registered repo roots and the current repo, deduped and
   *  sorted. Read-only: does NOT write repos.json (reads stay pure). */
  private knownRepos(): string[] {
    const roots = new Set<string>([this.repoRoot]);
    for (const entry of this.loadRepos().repos) roots.add(path.resolve(entry.root));
    return [...roots].sort();
  }
  /** Register a repo root into the home repos.json (idempotent). Only mutating
   *  operations call this; reads never do. */
  registerRepo(repo: string = this.repoRoot): { registered: boolean; repos: string[] } {
    const resolved = path.resolve(repo);
    const file = this.reposFilePath();
    // Cross-process read-modify-write: lock so a concurrent register can't drop a
    // repo (v0.1.40, P1-D), and persist durably.
    return withFileLock(file, () => {
      const current = this.loadRepos();
      const already = current.repos.some((entry) => path.resolve(entry.root) === resolved);
      if (!already) current.repos.push({ root: resolved, addedAt: new Date().toISOString() });
      current.repos.sort((a, b) => compareBytes(a.root, b.root));
      writeJson(file, current, { durable: true });
      return { registered: !already, repos: current.repos.map((entry) => entry.root) };
    });
  }

  // Queue file helpers + queueAdd/List/Show/Drain now live in ./run-registry/queue
  // (FreeBSD-audit R2 deep). These remain as thin delegators; `this` satisfies the
  // QueueHost contract structurally (repoRoot, defaultQueuePriority,
  // homeRegistryDir, registerRepo).
  private loadQueue(): RunQueueEntry[] {
    return loadQueueOp(this);
  }

  // Public queue accessors for the v0.1.37 control-plane scheduler (it operates ON
  // this queue store via pure functions in scheduling.ts; the queue file is never
  // duplicated). The scheduling-policy file lives beside the queue in the home
  // registry, plain and diffable.
  loadQueueEntries(): RunQueueEntry[] {
    return this.loadQueue();
  }
  saveQueueEntries(entries: RunQueueEntry[]): void {
    saveQueueOp(this, entries);
  }
  schedulingPolicyPath(): string {
    return path.join(this.homeRegistryDir(), "scheduling-policy.json");
  }

  // ---- record derivation (always from source) -----------------------------
  /** Derive a RunRecord from a run directory's source state.json. Returns the
   *  record, or null when source is unreadable/unsupported (caller decides how to
   *  surface `missing` — we never fabricate a status). */
  private deriveRecord(repo: string, runDir: string, overlays: RepoOverlays = this.loadRepoOverlays(repo)): RunRecord | null {
    const statePath = path.join(runDir, "state.json");
    if (!fs.existsSync(statePath)) return null;
    let run: WorkflowRun;
    try {
      const result = loadRunStateFile(statePath, { dryRun: true });
      if (result.report.status === "unsupported") return null;
      run = result.run;
    } catch {
      return null;
    }
    const li = lifecycleInputs(run);
    const derived = deriveLifecycle(li);
    const archive = overlays.archive.archived[run.id];
    const provenance = overlays.provenance.links[run.id];
    // Run Retention & Provable Reclamation (v0.1.39): the per-run reclaimed.json
    // overlay (if any) raises the disk-tier above `archived` and downgrades the
    // capability. Derived from source, never invented.
    const reclaim = loadReclaimedFromDir(runDir);
    const lastTombstone = reclaim.tombstones[reclaim.tombstones.length - 1];
    const tier: RunTier = lastTombstone ? "reclaimed" : archive ? "archived" : "live";
    const capability: RunCapability = lastTombstone ? lastTombstone.capability : "re-runnable";
    const capabilityReason: RunCapabilityReason = lastTombstone
      ? lastTombstone.capabilityReason
      : archive
        ? "archived-full"
        : "live-full";
    return {
      schemaVersion: 1,
      runId: run.id,
      appId: run.workflow.app?.id,
      appVersion: run.workflow.app?.version,
      workflowId: run.workflow.id,
      title: run.workflow.title,
      repo,
      runDir,
      statePath,
      createdAt: run.createdAt,
      updatedAt: run.updatedAt,
      loopStage: run.loopStage,
      lifecycle: lastTombstone ? "reclaimed" : archive ? "archived" : derived,
      derivedLifecycle: derived,
      archived: Boolean(archive),
      archivedAt: archive?.archivedAt,
      archiveReason: archive?.reason,
      tier,
      capability,
      capabilityReason,
      reclaimedAt: lastTombstone?.reclaimedAt,
      reclaimedBytes: reclaim.tombstones.reduce((sum, t) => sum + (t.bytesFreed || 0), 0) || undefined,
      tombstoneHash: lastTombstone?.tombstoneHash,
      tasks: {
        total: li.total,
        pending: li.pending,
        running: li.running,
        failed: li.failed,
        completed: li.completed
      },
      commitCount: (run.commits || []).length,
      verifierGatedCommitCount: li.verifierGatedCommits,
      openFeedbackCount: li.openFeedback,
      backends: distinctBackends(run),
      inputsDigest: digestInputs(run.inputs),
      sourceFingerprint: fingerprintRun(run),
      freshness: "valid",
      provenance
    };
  }

  /** Scan one repo's `.cw/runs/` and derive a record per run, deterministically
   *  ordered (createdAt asc, then runId). Unreadable runs are skipped here; the
   *  freshness layer is responsible for reporting persisted-but-missing runs. */
  private scanRepo(repo: string): RunRecord[] {
    const runsDir = this.repoRunsDir(repo);
    if (!fs.existsSync(runsDir)) return [];
    const overlays = this.loadRepoOverlays(repo);
    const records: RunRecord[] = [];
    for (const entry of fs.readdirSync(runsDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const record = this.deriveRecord(repo, path.join(runsDir, entry.name), overlays);
      if (record) records.push(record);
    }
    return records.sort(compareRecords);
  }

  // ---- index construction (current truth) ---------------------------------
  /** Build the CURRENT index fresh from source for the requested scope. This is
   *  the authoritative-from-source view; persistence/freshness is layered on top. */
  buildIndex(scope: "repo" | "home"): RunRegistryIndex {
    const repos = scope === "home" ? this.knownRepos() : [this.repoRoot];
    const records: RunRecord[] = [];
    for (const repo of repos) records.push(...this.scanRepo(repo));
    records.sort(compareRecords);
    const queue = scope === "home" ? this.loadQueue() : this.loadQueue().filter((q) => path.resolve(q.repo) === this.repoRoot);
    const sourceFingerprint = fingerprintStrings([
      ...repos.map((r) => `repo:${r}`),
      ...records.map((r) => `${r.runId}:${r.sourceFingerprint}:${r.lifecycle}`)
    ]);
    return {
      schemaVersion: 1,
      scope,
      root: scope === "home" ? this.homeRoot : this.repoRoot,
      generatedAt: new Date().toISOString(),
      sourceFingerprint,
      repos,
      records,
      queue,
      counts: countRecords(records)
    };
  }

  private persistedIndexPath(scope: "repo" | "home"): string {
    return scope === "home"
      ? path.join(this.homeRegistryDir(), "index.json")
      : path.join(this.repoRegistryDir(this.repoRoot), "index.json");
  }
  private loadPersistedIndex(scope: "repo" | "home"): RunRegistryIndex | undefined {
    const file = this.persistedIndexPath(scope);
    if (!fs.existsSync(file)) return undefined;
    try {
      const parsed = readJson(file) as RunRegistryIndex;
      if (!parsed || parsed.schemaVersion !== 1) return undefined;
      return parsed;
    } catch {
      return undefined;
    }
  }

  /** Refresh (recompute and persist) the index. registers the current repo into
   *  the home registry so cross-repo discovery finds it later. MECHANISM only:
   *  never touches source state.json. */
  refresh(options: { scope?: "repo" | "home" } = {}): RunRegistryReport {
    const scope = options.scope || "repo";
    // Registering the current repo is what makes a single-repo run discoverable
    // cross-repo. Always safe (idempotent) and never mutates run source.
    this.registerRepo(this.repoRoot);
    const index = this.buildIndex(scope);
    writeJson(this.persistedIndexPath(scope), index);
    if (scope === "repo") {
      // A repo refresh also keeps the home aggregate fresh enough to discover this
      // repo's runs, without forcing a full cross-repo rebuild.
      const homeIndex = this.buildIndex("home");
      writeJson(this.persistedIndexPath("home"), homeIndex);
    }
    return this.report(scope, index);
  }

  /** Read the index with explicit freshness against current source. Re-derives
   *  every record from source (never fabricates); compares to the persisted cache
   *  to report valid|stale|absent + staleRuns/missingRuns. */
  show(options: { scope?: "repo" | "home" } = {}): RunRegistryReport {
    const scope = options.scope || "repo";
    return this.report(scope, this.buildIndex(scope));
  }

  private report(scope: "repo" | "home", current: RunRegistryIndex): RunRegistryReport {
    const persisted = this.loadPersistedIndex(scope);
    const currentById = new Map(current.records.map((r) => [r.runId, r]));
    let status: RunRegistryFreshness = persisted ? "valid" : "absent";
    const staleRuns: string[] = [];
    const missingRuns: string[] = [];
    if (persisted) {
      if (persisted.sourceFingerprint !== current.sourceFingerprint) status = "stale";
      for (const prior of persisted.records) {
        const now = currentById.get(prior.runId);
        if (!now) {
          missingRuns.push(prior.runId);
        } else if (now.sourceFingerprint !== prior.sourceFingerprint) {
          staleRuns.push(prior.runId);
        }
      }
      if (staleRuns.length || missingRuns.length) status = "stale";
    }
    const refreshCmd = scope === "home" ? "node scripts/cw.js registry refresh --scope home" : "node scripts/cw.js registry refresh";
    return {
      schemaVersion: 1,
      scope,
      root: current.root,
      generatedAt: current.generatedAt,
      freshness: {
        status,
        persistedFingerprint: persisted?.sourceFingerprint,
        currentFingerprint: current.sourceFingerprint,
        staleRuns: staleRuns.sort(),
        missingRuns: missingRuns.sort()
      },
      index: current,
      counts: current.counts,
      nextAction: status === "valid" ? "node scripts/cw.js run search" : refreshCmd
    };
  }

  // ---- search (deterministic, paginated) ----------------------------------
  search(raw: Partial<RunSearchQuery> & { scope?: "repo" | "home" } = {}): RunSearchResult {
    const scope = raw.scope || "home";
    const index = this.buildIndex(scope);
    const report = this.report(scope, index);
    const query: RunSearchQuery = {
      text: optionalLower(raw.text),
      app: optionalLower(raw.app),
      status: raw.status,
      repo: raw.repo ? path.resolve(raw.repo) : undefined,
      since: raw.since,
      until: raw.until,
      includeArchived: raw.includeArchived ?? true,
      offset: clampInt(raw.offset, 0, 0),
      limit: clampInt(raw.limit, 50, 1)
    };
    let records = index.records.filter((record) => matchesQuery(record, query));
    if (!query.includeArchived) records = records.filter((record) => !record.archived);
    records.sort(compareRecords);
    const total = records.length;
    const page = records.slice(query.offset, query.offset + query.limit);
    return {
      schemaVersion: 1,
      scope,
      query,
      freshness: report.freshness.status,
      total,
      offset: query.offset,
      limit: query.limit,
      records: page,
      nextAction:
        report.freshness.status === "valid"
          ? "node scripts/cw.js run show <run-id>"
          : "node scripts/cw.js registry refresh"
    };
  }

  list(options: { scope?: "repo" | "home"; includeArchived?: boolean; limit?: number; offset?: number } = {}): RunSearchResult {
    return this.search({
      scope: options.scope || "home",
      includeArchived: options.includeArchived ?? true,
      limit: options.limit,
      offset: options.offset
    });
  }

  // ---- resolve one run by id (cross-repo, fail-closed) --------------------
  /** Resolve a run by id, preferring the current repo, then any registered repo.
   *  Returns found=false with freshness `missing` (and the last-known persisted
   *  record, clearly flagged) when source is gone. */
  showRun(runId: string, options: { scope?: "repo" | "home" } = {}): RunShowResult {
    const scope = options.scope || "home";
    const located = this.locate(runId, scope);
    if (located) {
      return {
        schemaVersion: 1,
        runId,
        found: true,
        freshness: "valid",
        resolvedFrom: located.from,
        repo: located.record.repo,
        record: located.record,
        nextAction: located.record.archived
          ? "node scripts/cw.js run resume " + runId
          : "node scripts/cw.js run show " + runId
      };
    }
    // Not present in source. Surface the last-known persisted record (if any),
    // flagged `missing` — never as a live status.
    const persisted = this.findPersisted(runId, scope);
    return {
      schemaVersion: 1,
      runId,
      found: false,
      freshness: "missing",
      repo: persisted?.repo,
      persisted,
      nextAction: "node scripts/cw.js registry refresh" + (scope === "home" ? " --scope home" : "")
    };
  }

  // Public so the carved gc cluster (run-registry/gc.ts) can resolve a run
  // repo-first without reaching into private state (GcHost).
  locate(runId: string, scope: "repo" | "home"): { record: RunRecord; from: "repo" | "home" } | undefined {
    // Current repo first (least astonishment: cwd wins).
    const here = this.deriveRecordForRun(this.repoRoot, runId);
    if (here) return { record: here, from: "repo" };
    if (scope === "repo") return undefined;
    for (const repo of this.knownRepos()) {
      if (path.resolve(repo) === this.repoRoot) continue;
      const record = this.deriveRecordForRun(repo, runId);
      if (record) return { record, from: "home" };
    }
    return undefined;
  }

  private deriveRecordForRun(repo: string, runId: string): RunRecord | null {
    const runDir = path.join(this.repoRunsDir(repo), runId);
    if (!fs.existsSync(path.join(runDir, "state.json"))) return null;
    return this.deriveRecord(repo, runDir);
  }

  private findPersisted(runId: string, scope: "repo" | "home"): RunRecord | undefined {
    for (const s of scope === "home" ? (["home", "repo"] as const) : (["repo"] as const)) {
      const persisted = this.loadPersistedIndex(s);
      const hit = persisted?.records.find((r) => r.runId === runId);
      if (hit) return hit;
    }
    return undefined;
  }

  // Public so the carved gc cluster (run-registry/gc.ts) can load source state
  // for a resolved run without reaching into private state (GcHost).
  loadRun(repo: string, runId: string): WorkflowRun {
    const statePath = path.join(this.repoRunsDir(repo), runId, "state.json");
    if (!fs.existsSync(statePath)) throw new Error(`Run not found: ${runId}`);
    const result = loadRunStateFile(statePath, { dryRun: true });
    if (result.report.status === "unsupported") {
      throw new Error(`Unsupported run state for ${runId}: ${result.report.errors.join("; ")}`);
    }
    return result.run;
  }

  // ---- resume (continue from durable state; read-only over source) --------
  resume(runId: string, options: { scope?: "repo" | "home"; limit?: number } = {}): RunResumeResult {
    const scope = options.scope || "home";
    const located = this.locate(runId, scope);
    if (!located) {
      throw new Error(`Cannot resume: run ${runId} not found in source state (fail closed; try registry refresh).`);
    }
    const record = located.record;
    const run = this.loadRun(record.repo, runId);
    const limit = clampInt(options.limit, 5, 1);
    const nextTasks = (run.tasks || [])
      .filter((t) => t.status === "pending" || t.status === "running")
      .slice(0, limit)
      .map((t) => ({ id: t.id, phase: t.phase, status: t.status, taskPath: t.taskPath }));
    const terminal = record.derivedLifecycle === "completed" || record.derivedLifecycle === "failed";
    const resumable = nextTasks.length > 0 || (!terminal && record.derivedLifecycle !== "completed");
    const nextActions: Array<{ command: string; reason: string }> = [];
    if (nextTasks.length) {
      nextActions.push({
        command: `node scripts/cw.js dispatch ${runId} --cwd ${record.repo}`,
        reason: `Continue ${nextTasks.length} pending/running task(s) from durable state.`
      });
      nextActions.push({
        command: `node scripts/cw.js multi-agent step ${runId} --cwd ${record.repo}`,
        reason: "Take one deterministic host step without spawning agents."
      });
    } else if (record.derivedLifecycle === "failed") {
      nextActions.push({
        command: `node scripts/cw.js run rerun ${runId}`,
        reason: "Run terminated as failed with no runnable tasks; rerun as a new linked run."
      });
    } else {
      nextActions.push({
        command: `node scripts/cw.js status ${runId} --cwd ${record.repo} --json`,
        reason: "No runnable tasks remain; inspect status.",
      });
    }
    return {
      schemaVersion: 1,
      runId,
      repo: record.repo,
      runDir: record.runDir,
      statePath: record.statePath,
      resolvedFrom: located.from,
      lifecycle: record.lifecycle,
      derivedLifecycle: record.derivedLifecycle,
      loopStage: record.loopStage,
      freshness: "valid",
      resumable,
      reason: record.archived ? "Run is archived; resuming reads durable state without un-archiving." : undefined,
      record,
      nextTasks,
      nextActions
    };
  }

  // ---- archive (overlay mark; never deletes source) -----------------------
  archive(
    runId: string,
    options: { reason?: string; scope?: "repo" | "home"; unarchive?: boolean } = {}
  ): { runId: string; repo: string; archived: boolean; archivedAt?: string; reason?: string; record: RunRecord; overlayPath: string } {
    const scope = options.scope || "home";
    const located = this.locate(runId, scope);
    if (!located) throw new Error(`Cannot archive: run ${runId} not found in source state (fail closed).`);
    const repo = located.record.repo;
    const file = path.join(this.repoRegistryDir(repo), "archive.json");
    // Lock the archive-overlay read-modify-write (v0.1.40, P1-D) + durable write.
    withFileLock(file, () => {
      const overlay = this.loadArchiveOverlay(repo);
      if (options.unarchive) {
        delete overlay.archived[runId];
      } else {
        overlay.archived[runId] = { archivedAt: new Date().toISOString(), reason: options.reason };
      }
      writeJson(file, overlay, { durable: true });
    });
    const record = this.deriveRecord(repo, located.record.runDir)!;
    return {
      runId,
      repo,
      archived: record.archived,
      archivedAt: record.archivedAt,
      reason: record.archiveReason,
      record,
      overlayPath: file
    };
  }

  /** Apply a retention POLICY: archive eligible runs older than the window. The
   *  window/states are policy inputs, never baked into the index. Returns the set
   *  archived; archives are overlay marks, so nothing is destroyed. */
  archiveByPolicy(
    policy: RunRegistryPolicy = DEFAULT_RUN_REGISTRY_POLICY,
    options: { scope?: "repo" | "home"; now?: string } = {}
  ): { policy: RunRegistryPolicy; archived: string[]; eligible: number } {
    const scope = options.scope || "home";
    if (!policy.archiveOlderThanDays || policy.archiveOlderThanDays <= 0) {
      return { policy, archived: [], eligible: 0 };
    }
    const nowMs = options.now ? Date.parse(options.now) : Date.now();
    const cutoff = nowMs - policy.archiveOlderThanDays * 24 * 60 * 60 * 1000;
    const index = this.buildIndex(scope);
    const eligible = index.records.filter(
      (r) => !r.archived && policy.archiveStates.includes(r.derivedLifecycle) && Date.parse(r.updatedAt) < cutoff
    );
    const archived: string[] = [];
    for (const record of eligible) {
      this.archive(record.runId, { reason: `retention:${policy.archiveOlderThanDays}d`, scope });
      archived.push(record.runId);
    }
    return { policy, archived: archived.sort(), eligible: eligible.length };
  }

  // ---- Run Retention & Provable Reclamation (v0.1.39) ----------------------
  // A small, verifiable GC built on the archive overlay. `gc plan` is a pure
  // dry-run (frees nothing); `gc run` executes the write-ahead reclamation
  // transaction (skeleton → tombstone → fsync → free); `gc verify` re-proves a
  // reclaimed run independently. Eligibility is explicit and fail-closed.
  // Implementations live in ./run-registry/gc (FreeBSD-audit R2 deep); these are
  // thin delegators preserving the public surface. `this` satisfies GcHost
  // (buildIndex, locate, loadRun).

  /** Resolve the effective reclamation policy (defaults reclaim NOTHING). */
  reclamationPolicy(overrides: Partial<RunRegistryPolicy> = {}): RunRegistryPolicy {
    return reclamationPolicyOp(overrides);
  }

  /** Dry-run: compute eligible runs, per-kind bytes that WOULD be freed, and the
   *  capability downgrade. Frees NOTHING. */
  gcPlan(options: { scope?: "repo" | "home"; runId?: string; policy?: Partial<RunRegistryPolicy>; now?: string } = {}): GcPlanResult {
    return gcPlanOp(this, options);
  }

  /** Execute the write-ahead reclamation transaction for eligible runs. Bounded
   *  (`maxReclaimRuns` / `maxReclaimBytes`), fail-closed on any incomplete
   *  skeleton. Produces a tombstone and frees the bulk. */
  gcRun(options: { scope?: "repo" | "home"; runId?: string; policy?: Partial<RunRegistryPolicy>; now?: string; actor?: string; limit?: number } = {}): GcRunResult {
    return gcRunOp(this, options);
  }

  /** Re-prove a reclaimed run: skeleton schema-complete, tombstone chain
   *  recomputed-and-untampered, each reconstructable artifact re-derived from its
   *  RETAINED inputs to its expectDigest, and eligible-when-reclaimed. */
  gcVerify(runId: string, options: { scope?: "repo" | "home" } = {}): GcVerifyResult {
    return gcVerifyOp(this, runId, options);
  }

  // ---- rerun (NEW run linked to the original; original preserved) ---------
  rerun(runId: string, options: { reason?: string; scope?: "repo" | "home" } = {}): RunRerunResult {
    if (!this.planner) throw new Error("rerun requires a run planner (CoolWorkflowRunner)");
    const scope = options.scope || "home";
    const located = this.locate(runId, scope);
    if (!located) throw new Error(`Cannot rerun: run ${runId} not found in source state (fail closed).`);
    const original = located.record;
    const originalRun = this.loadRun(original.repo, runId);
    const appId = originalRun.workflow.app?.id || originalRun.workflow.id;
    // Reuse the original inputs verbatim, pinned to the original repo so the new
    // run lands beside it. We never fork run creation — this is runner.plan.
    const inputs = { ...(originalRun.inputs || {}), cwd: original.repo, repo: original.repo };
    const newRun = this.planner.plan(appId, inputs);
    const priorProv = original.provenance;
    const provenance: RunProvenance = {
      rerunOf: runId,
      rerunOfRepo: original.repo,
      originRunId: priorProv?.originRunId || runId,
      generation: (priorProv?.generation || 0) + 1,
      reason: options.reason || "rerun of failed run",
      createdAt: new Date().toISOString()
    };
    // Record provenance in the per-repo overlay (derived metadata), NOT in the
    // original run's source state — the past is never mutated.
    const provFile = path.join(this.repoRegistryDir(original.repo), "provenance.json");
    const provOverlay = this.loadProvenanceOverlay(original.repo);
    provOverlay.links[newRun.id] = provenance;
    writeJson(provFile, provOverlay, { durable: true });
    return {
      schemaVersion: 1,
      originalRunId: runId,
      originalRepo: original.repo,
      originalLifecycle: original.lifecycle,
      newRunId: newRun.id,
      repo: original.repo,
      appId: newRun.workflow.app?.id || appId,
      workflowId: newRun.workflow.id,
      statePath: newRun.paths.state,
      reportPath: newRun.paths.report,
      pendingTasks: newRun.tasks.filter((t) => t.status === "pending").length,
      provenance,
      nextActions: [
        { command: `node scripts/cw.js run resume ${newRun.id}`, reason: "Continue the new linked run." },
        { command: `node scripts/cw.js run show ${runId}`, reason: "The original failed run is preserved for audit." }
      ]
    };
  }

  // ---- queue (durable, ordered; drained by the host) ----------------------
  // Implementations live in ./run-registry/queue (FreeBSD-audit R2 deep); these
  // are thin delegators preserving the public surface. `this` satisfies QueueHost.
  queueAdd(options: {
    runId?: string;
    appId?: string;
    workflowId?: string;
    repo?: string;
    priority?: number;
    inputs?: Record<string, unknown>;
    note?: string;
    id?: string;
  } = {}): RunQueueEntry {
    return queueAddOp(this, options);
  }

  queueList(options: { status?: RunQueueEntry["status"]; repo?: string } = {}): { schemaVersion: 1; total: number; entries: RunQueueEntry[] } {
    return queueListOp(this, options);
  }

  queueShow(id: string): RunQueueEntry {
    return queueShowOp(this, id);
  }

  queueDrain(options: { limit?: number; repo?: string } = {}): {
    schemaVersion: 1;
    drained: RunQueueEntry[];
    remaining: number;
  } {
    return queueDrainOp(this, options);
  }

  // ---- cross-repo history (unified timeline) ------------------------------
  history(options: { scope?: "repo" | "home"; app?: string; status?: RunLifecycleState; limit?: number; offset?: number } = {}): RunHistoryResult {
    const scope = options.scope || "home";
    const index = this.buildIndex(scope);
    const report = this.report(scope, index);
    const app = optionalLower(options.app);
    const limit = clampInt(options.limit, 50, 1);
    const offset = clampInt(options.offset, 0, 0);
    let records = index.records;
    if (app) records = records.filter((r) => (r.appId || r.workflowId || "").toLowerCase().includes(app));
    if (options.status) records = records.filter((r) => r.lifecycle === options.status || r.derivedLifecycle === options.status);
    const ordered = [...records].sort(compareHistory);
    const total = ordered.length;
    const page = ordered.slice(offset, offset + limit);
    const entries: RunHistoryEntry[] = page.map((r) => ({
      runId: r.runId,
      repo: r.repo,
      appId: r.appId,
      workflowId: r.workflowId,
      lifecycle: r.lifecycle,
      loopStage: r.loopStage,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
      freshness: r.freshness,
      provenance: r.provenance
    }));
    return {
      schemaVersion: 1,
      scope,
      freshness: report.freshness.status,
      total,
      offset,
      limit,
      repos: index.repos,
      entries,
      nextAction: report.freshness.status === "valid" ? "node scripts/cw.js run show <run-id>" : "node scripts/cw.js registry refresh --scope home"
    };
  }
}

// Human formatting (CLI-only) now lives in ./run-registry/format.ts (FreeBSD-
// audit R2: rendering carved out of the registry class). Re-exported so that
// importers of "./run-registry" see an unchanged surface.
export {
  formatRegistryReport,
  formatRunSearch,
  formatRunShow,
  formatGcPlan,
  formatGcRun,
  formatGcVerify,
  formatResume,
  formatHistory,
  formatQueueList
} from "./run-registry/format";
