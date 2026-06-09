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
  GcPlanEntry,
  GcPlanResult,
  GcRunResult,
  GcVerifyResult,
  LoopStage,
  ReclaimedOverlay,
  ReclaimRefusalCode,
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
import { createRunPaths, loadRunStateFile, readJson, writeJson } from "./state";
import { planReclamation, runReclamation, verifyReclamation, ReclamationError } from "./reclamation";

export const RUN_REGISTRY_SCHEMA_VERSION = 1 as const;

const LIFECYCLE_STATES: RunLifecycleState[] = [
  "queued",
  "running",
  "blocked",
  "completed",
  "failed",
  "archived",
  "reclaimed"
];

// POLICY defaults. Configurable; never baked into the index. archiveOlderThanDays
// = 0 disables retention archiving (explicit selection still works). The v0.1.39
// reclamation knobs all default to RECLAIM NOTHING (back-compatible, opt-in).
export const DEFAULT_RUN_REGISTRY_POLICY: RunRegistryPolicy = {
  schemaVersion: 1,
  archiveOlderThanDays: 0,
  archiveStates: ["completed", "failed"],
  defaultQueuePriority: 100,
  reclaimAfterArchiveDays: 0,
  reclaimStates: ["completed", "failed"],
  keepSnapshots: false,
  keepScratch: false,
  maxReclaimRuns: 0,
  maxReclaimBytes: 0
};

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

interface QueueFile {
  schemaVersion: 1;
  entries: RunQueueEntry[];
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
  for (const task of [...run.tasks].sort((a, b) => a.id.localeCompare(b.id))) {
    parts.push(`task:${task.id}:${task.status}`);
  }
  for (const commit of [...run.commits].sort((a, b) => a.id.localeCompare(b.id))) {
    parts.push(`commit:${commit.id}:${commit.verifierGated ? "gated" : "checkpoint"}`);
  }
  for (const phase of [...run.phases].sort((a, b) => a.id.localeCompare(b.id))) {
    parts.push(`phase:${phase.id}:${phase.status}`);
  }
  for (const fb of [...(run.feedback || [])].sort((a, b) => a.id.localeCompare(b.id))) {
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

export class RunRegistry {
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
  private homeRegistryDir(): string {
    return path.join(this.homeRoot, "registry");
  }

  // ---- per-repo overlays (plain files) ------------------------------------
  private loadArchiveOverlay(repo: string): ArchiveOverlay {
    const file = path.join(this.repoRegistryDir(repo), "archive.json");
    if (!fs.existsSync(file)) return { schemaVersion: 1, archived: {} };
    try {
      const parsed = readJson(file) as ArchiveOverlay;
      return { schemaVersion: 1, archived: parsed.archived || {} };
    } catch {
      return { schemaVersion: 1, archived: {} };
    }
  }
  private loadProvenanceOverlay(repo: string): ProvenanceOverlay {
    const file = path.join(this.repoRegistryDir(repo), "provenance.json");
    if (!fs.existsSync(file)) return { schemaVersion: 1, links: {} };
    try {
      const parsed = readJson(file) as ProvenanceOverlay;
      return { schemaVersion: 1, links: parsed.links || {} };
    } catch {
      return { schemaVersion: 1, links: {} };
    }
  }

  // ---- home registry files ------------------------------------------------
  private reposFilePath(): string {
    return path.join(this.homeRegistryDir(), "repos.json");
  }
  private loadRepos(): ReposFile {
    const file = this.reposFilePath();
    if (!fs.existsSync(file)) return { schemaVersion: 1, repos: [] };
    try {
      const parsed = readJson(file) as ReposFile;
      return { schemaVersion: 1, repos: Array.isArray(parsed.repos) ? parsed.repos : [] };
    } catch {
      return { schemaVersion: 1, repos: [] };
    }
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
    const current = this.loadRepos();
    const already = current.repos.some((entry) => path.resolve(entry.root) === resolved);
    if (!already) current.repos.push({ root: resolved, addedAt: new Date().toISOString() });
    current.repos.sort((a, b) => a.root.localeCompare(b.root));
    writeJson(file, current);
    return { registered: !already, repos: current.repos.map((entry) => entry.root) };
  }

  private queueFilePath(): string {
    return path.join(this.homeRegistryDir(), "queue.json");
  }
  private loadQueue(): RunQueueEntry[] {
    const file = this.queueFilePath();
    if (!fs.existsSync(file)) return [];
    try {
      const parsed = readJson(file) as QueueFile;
      return Array.isArray(parsed.entries) ? parsed.entries : [];
    } catch {
      return [];
    }
  }
  private saveQueue(entries: RunQueueEntry[]): void {
    writeJson(this.queueFilePath(), { schemaVersion: 1, entries });
  }

  // Public queue accessors for the v0.1.37 control-plane scheduler (it operates ON
  // this queue store via pure functions in scheduling.ts; the queue file is never
  // duplicated). The scheduling-policy file lives beside the queue in the home
  // registry, plain and diffable.
  loadQueueEntries(): RunQueueEntry[] {
    return this.loadQueue();
  }
  saveQueueEntries(entries: RunQueueEntry[]): void {
    this.saveQueue(entries);
  }
  schedulingPolicyPath(): string {
    return path.join(this.homeRegistryDir(), "scheduling-policy.json");
  }

  // ---- record derivation (always from source) -----------------------------
  /** Derive a RunRecord from a run directory's source state.json. Returns the
   *  record, or null when source is unreadable/unsupported (caller decides how to
   *  surface `missing` — we never fabricate a status). */
  private deriveRecord(repo: string, runDir: string): RunRecord | null {
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
    const archive = this.loadArchiveOverlay(repo).archived[run.id];
    const provenance = this.loadProvenanceOverlay(repo).links[run.id];
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
    const records: RunRecord[] = [];
    for (const entry of fs.readdirSync(runsDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const record = this.deriveRecord(repo, path.join(runsDir, entry.name));
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

  private locate(runId: string, scope: "repo" | "home"): { record: RunRecord; from: "repo" | "home" } | undefined {
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

  private loadRun(repo: string, runId: string): WorkflowRun {
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
    const overlay = this.loadArchiveOverlay(repo);
    if (options.unarchive) {
      delete overlay.archived[runId];
    } else {
      overlay.archived[runId] = { archivedAt: new Date().toISOString(), reason: options.reason };
    }
    writeJson(file, overlay);
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

  /** Resolve the effective reclamation policy (defaults reclaim NOTHING). */
  reclamationPolicy(overrides: Partial<RunRegistryPolicy> = {}): RunRegistryPolicy {
    return { ...DEFAULT_RUN_REGISTRY_POLICY, ...overrides };
  }

  /** Fail-closed eligibility: terminal AND archived AND no open feedback AND past
   *  retention. Returns the matching refusal code, or null when eligible. Reads
   *  the live-source-derived record; order yields distinct, stable codes. */
  private reclaimEligibility(record: RunRecord, policy: RunRegistryPolicy, nowMs: number): ReclaimRefusalCode | null {
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

  /** Resolve a single run to a one-element record list via locate() (repo-first),
   *  avoiding a full-registry scan for single-run gc plan/run. */
  private recordsForRunId(runId: string, scope: "repo" | "home"): RunRecord[] {
    const located = this.locate(runId, scope);
    return located ? [located.record] : [];
  }

  /** Dry-run: compute eligible runs, per-kind bytes that WOULD be freed, and the
   *  capability downgrade. Frees NOTHING. */
  gcPlan(options: { scope?: "repo" | "home"; runId?: string; policy?: Partial<RunRegistryPolicy>; now?: string } = {}): GcPlanResult {
    const scope = options.scope || "home";
    const policy = this.reclamationPolicy(options.policy);
    const nowIso = options.now || new Date().toISOString();
    const nowMs = Date.parse(nowIso);
    // Fast, deterministic single-run path: resolve just that run via locate()
    // (repo-first) so a home-scope plan never re-scans the whole registry.
    const records = options.runId ? this.recordsForRunId(options.runId, scope) : this.buildIndex(scope).records;
    const entries: GcPlanEntry[] = [];
    let bytesToFree = 0;
    let eligibleCount = 0;
    for (const record of records) {
      const refusal = this.reclaimEligibility(record, policy, nowMs);
      let plan;
      try {
        const run = this.loadRun(record.repo, record.runId);
        plan = planReclamation(run, { keepScratch: policy.keepScratch, keepSnapshots: policy.keepSnapshots });
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
          freeable: []
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
        freeable: eligible ? plan.freeable.map((f) => ({ path: f.path, kind: f.kind, bytes: f.bytes })) : []
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
        reclaimStates: policy.reclaimStates && policy.reclaimStates.length ? policy.reclaimStates : ["completed", "failed"]
      },
      total: entries.length,
      eligibleCount,
      bytesToFree,
      entries,
      nextAction: eligibleCount ? "node scripts/cw.js gc run" : "node scripts/cw.js run search"
    };
  }

  /** Execute the write-ahead reclamation transaction for eligible runs. Bounded
   *  (`maxReclaimRuns` / `maxReclaimBytes`), fail-closed on any incomplete
   *  skeleton. Produces a tombstone and frees the bulk. */
  gcRun(options: { scope?: "repo" | "home"; runId?: string; policy?: Partial<RunRegistryPolicy>; now?: string; actor?: string; limit?: number } = {}): GcRunResult {
    const scope = options.scope || "home";
    const policy = this.reclamationPolicy(options.policy);
    const nowIso = options.now || new Date().toISOString();
    const nowMs = Date.parse(nowIso);
    const records = options.runId ? this.recordsForRunId(options.runId, scope) : this.buildIndex(scope).records;
    const maxRuns = options.limit ?? (policy.maxReclaimRuns || 0);
    const maxBytes = policy.maxReclaimBytes || 0;
    const reclaimed: GcRunResult["reclaimed"] = [];
    const refused: GcRunResult["refused"] = [];
    let totalBytesFreed = 0;
    for (const record of records) {
      const refusal = this.reclaimEligibility(record, policy, nowMs);
      if (refusal) {
        refused.push({ runId: record.runId, code: refusal });
        continue;
      }
      if (maxRuns > 0 && reclaimed.length >= maxRuns) break;
      let run: WorkflowRun;
      try {
        run = this.loadRun(record.repo, record.runId);
      } catch {
        refused.push({ runId: record.runId, code: "unreadable" });
        continue;
      }
      try {
        const result = runReclamation(run, {
          now: nowIso,
          actor: options.actor,
          policy: { reclaimAfterArchiveDays: policy.reclaimAfterArchiveDays, keepScratch: policy.keepScratch, keepSnapshots: policy.keepSnapshots },
          reclaimPolicy: { keepScratch: policy.keepScratch, keepSnapshots: policy.keepSnapshots }
        });
        // No post-free saveCheckpoint: runReclamation now DURABLY persists the
        // result-node re-point inside the transaction (before any byte is freed),
        // so state.json can never reference a freed path even on a crash here.
        reclaimed.push({
          runId: record.runId,
          bytesFreed: result.bytesFreed,
          tombstoneHash: result.tombstone.tombstoneHash,
          capability: result.tombstone.capability,
          capabilityReason: result.tombstone.capabilityReason
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
      nextAction: reclaimed.length ? "node scripts/cw.js gc verify <run-id>" : "node scripts/cw.js gc plan"
    };
  }

  /** Re-prove a reclaimed run: skeleton schema-complete, tombstone chain
   *  recomputed-and-untampered, each reconstructable artifact re-derived from its
   *  RETAINED inputs to its expectDigest, and eligible-when-reclaimed. */
  gcVerify(runId: string, options: { scope?: "repo" | "home" } = {}): GcVerifyResult {
    const scope = options.scope || "home";
    const located = this.locate(runId, scope);
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
        nextAction: "node scripts/cw.js registry refresh" + (scope === "home" ? " --scope home" : "")
      };
    }
    const run = this.loadRun(located.record.repo, runId);
    const result = verifyReclamation(run);
    const checks = result.checks.map((c) => ({ name: c.name, pass: c.pass, code: c.code as GcVerifyResult["checks"][number]["code"], detail: c.detail }));
    // Eligible-when-reclaimed: each tombstone must have sealed a terminal verdict.
    let eligibleWhenReclaimed = result.reclaimed;
    for (const tombstone of result.tombstones) {
      const terminal = tombstone.skeleton.finalVerdict?.terminal === true;
      if (!terminal) {
        eligibleWhenReclaimed = false;
        checks.push({ name: `eligible-when-reclaimed:${tombstone.tombstoneId}`, pass: false, code: "ineligible-when-reclaimed", detail: "non-terminal verdict sealed" });
      }
    }
    const last = result.tombstones[result.tombstones.length - 1];
    const verified = result.verified && eligibleWhenReclaimed;
    return {
      schemaVersion: 1,
      runId,
      reclaimed: result.reclaimed,
      verified,
      tier: located.record.tier || (result.reclaimed ? "reclaimed" : "live"),
      capability: located.record.capability || "re-runnable",
      capabilityReason: located.record.capabilityReason,
      tombstoneHash: last?.tombstoneHash,
      chainLength: result.tombstones.length,
      checks,
      nextAction: verified ? "node scripts/cw.js run show " + runId : "node scripts/cw.js gc plan"
    };
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
    writeJson(provFile, provOverlay);
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
    const entries = this.loadQueue();
    const repo = options.repo ? path.resolve(options.repo) : this.repoRoot;
    const entry: RunQueueEntry = {
      schemaVersion: 1,
      id: options.id || queueId(),
      runId: options.runId,
      appId: options.appId,
      workflowId: options.workflowId,
      repo,
      priority: Number.isFinite(options.priority) ? Number(options.priority) : DEFAULT_RUN_REGISTRY_POLICY.defaultQueuePriority,
      enqueuedAt: new Date().toISOString(),
      status: "pending",
      inputs: options.inputs,
      note: options.note
    };
    entries.push(entry);
    this.registerRepo(repo);
    this.saveQueue(entries);
    return entry;
  }

  queueList(options: { status?: RunQueueEntry["status"]; repo?: string } = {}): { schemaVersion: 1; total: number; entries: RunQueueEntry[] } {
    let entries = this.loadQueue();
    if (options.status) entries = entries.filter((e) => e.status === options.status);
    if (options.repo) {
      const repo = path.resolve(options.repo);
      entries = entries.filter((e) => path.resolve(e.repo) === repo);
    }
    entries = [...entries].sort(compareQueue);
    return { schemaVersion: 1, total: entries.length, entries };
  }

  queueShow(id: string): RunQueueEntry {
    const entry = this.loadQueue().find((e) => e.id === id);
    if (!entry) throw new Error(`Queue entry not found: ${id}`);
    return entry;
  }

  /** Drain the next N ready/pending entries in policy order, marking them drained.
   *  CW records readiness/order; the HOST still executes the workers. */
  queueDrain(options: { limit?: number; repo?: string } = {}): {
    schemaVersion: 1;
    drained: RunQueueEntry[];
    remaining: number;
  } {
    const limit = clampInt(options.limit, 1, 1);
    const entries = this.loadQueue();
    const repoFilter = options.repo ? path.resolve(options.repo) : undefined;
    const drainable = entries
      .filter((e) => e.status === "pending" || e.status === "ready")
      .filter((e) => !repoFilter || path.resolve(e.repo) === repoFilter)
      .sort(compareQueue);
    const drained: RunQueueEntry[] = [];
    const drainedAt = new Date().toISOString();
    for (const entry of drainable.slice(0, limit)) {
      entry.status = "drained";
      entry.drainedAt = drainedAt;
      drained.push(entry);
    }
    this.saveQueue(entries);
    const remaining = entries.filter((e) => e.status === "pending" || e.status === "ready").length;
    return { schemaVersion: 1, drained, remaining };
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

// ---------------------------------------------------------------------------
// pure helpers
// ---------------------------------------------------------------------------

function compareRecords(a: RunRecord, b: RunRecord): number {
  if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? -1 : 1;
  return a.runId.localeCompare(b.runId);
}

function compareHistory(a: RunRecord, b: RunRecord): number {
  // Newest first.
  if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? 1 : -1;
  return a.runId.localeCompare(b.runId);
}

export function compareQueue(a: RunQueueEntry, b: RunQueueEntry): number {
  if (a.priority !== b.priority) return a.priority - b.priority;
  if (a.enqueuedAt !== b.enqueuedAt) return a.enqueuedAt < b.enqueuedAt ? -1 : 1;
  return a.id.localeCompare(b.id);
}

function matchesQuery(record: RunRecord, query: RunSearchQuery): boolean {
  if (query.app && !(record.appId || record.workflowId || "").toLowerCase().includes(query.app)) return false;
  if (query.status && record.lifecycle !== query.status && record.derivedLifecycle !== query.status) return false;
  if (query.repo && path.resolve(record.repo) !== query.repo) return false;
  if (query.since && record.createdAt < query.since) return false;
  if (query.until && record.createdAt > query.until) return false;
  if (query.text) {
    const haystack = [
      record.runId,
      record.appId,
      record.workflowId,
      record.title,
      record.repo,
      record.lifecycle,
      record.loopStage,
      record.inputsDigest
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    if (!haystack.includes(query.text)) return false;
  }
  return true;
}

/** Bounded, deterministic stringification of run inputs for free-text search.
 *  Descriptive intent keys (question, prompt, ...) come first so they survive
 *  truncation; the rest follow alphabetically. Deterministic and compact. */
const DIGEST_PRIORITY_KEYS = ["question", "prompt", "task", "summary", "title", "objective", "focus", "topic"];
/** Distinct execution backends used by a run's dispatches/tasks, recomputed from
 *  source state. Sorted; empty for pre-v0.1.29 / default-only runs that never
 *  recorded a backend. The registry stays backend-agnostic — this is metadata. */
function distinctBackends(run: WorkflowRun): string[] {
  const backends = new Set<string>();
  for (const dispatch of run.dispatches || []) {
    if (dispatch.backendId) backends.add(dispatch.backendId);
  }
  for (const task of run.tasks || []) {
    if (task.backendId) backends.add(task.backendId);
  }
  return [...backends].sort();
}

function digestInputs(inputs: Record<string, unknown> | undefined): string | undefined {
  if (!inputs || typeof inputs !== "object") return undefined;
  const keys = Object.keys(inputs);
  const ordered = [
    ...DIGEST_PRIORITY_KEYS.filter((k) => keys.includes(k)),
    ...keys.filter((k) => !DIGEST_PRIORITY_KEYS.includes(k)).sort()
  ];
  const parts: string[] = [];
  for (const key of ordered) {
    const value = inputs[key];
    if (value === undefined || value === null) continue;
    const rendered = Array.isArray(value) ? value.join(",") : typeof value === "object" ? JSON.stringify(value) : String(value);
    parts.push(`${key}=${rendered}`);
  }
  const joined = parts.join(" ").replace(/\s+/g, " ").trim();
  return joined.length > 360 ? `${joined.slice(0, 357)}...` : joined;
}

function countRecords(records: RunRecord[]): RunRegistryCounts {
  const counts: RunRegistryCounts = {
    total: records.length,
    queued: 0,
    running: 0,
    blocked: 0,
    completed: 0,
    failed: 0,
    archived: 0,
    reclaimed: 0
  };
  for (const record of records) {
    counts[record.lifecycle] = (counts[record.lifecycle] || 0) + 1;
  }
  return counts;
}

function optionalLower(value: unknown): string | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  return String(value).toLowerCase();
}

function clampInt(value: unknown, fallback: number, min: number): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.floor(n));
}

let queueCounter = 0;
function queueId(): string {
  queueCounter += 1;
  const stamp = new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14);
  return `q-${stamp}-${String(queueCounter).padStart(3, "0")}`;
}

export function isRunLifecycleState(value: unknown): value is RunLifecycleState {
  return typeof value === "string" && (LIFECYCLE_STATES as string[]).includes(value);
}

/** Read a run dir's `reclaimed.json` overlay (v0.1.39). Fail-closed to an empty
 *  chain on absence/corruption — a malformed overlay must never brick the run. */
function loadReclaimedFromDir(runDir: string): ReclaimedOverlay {
  const file = path.join(runDir, "reclaimed.json");
  if (!fs.existsSync(file)) return { schemaVersion: 1, runId: "", tombstones: [] };
  try {
    const parsed = JSON.parse(fs.readFileSync(file, "utf8")) as ReclaimedOverlay;
    return { schemaVersion: 1, runId: parsed.runId || "", tombstones: Array.isArray(parsed.tombstones) ? parsed.tombstones : [] };
  } catch {
    return { schemaVersion: 1, runId: "", tombstones: [] };
  }
}

// ---------------------------------------------------------------------------
// Human formatting (CLI-only; never affects --json / MCP payloads)
// ---------------------------------------------------------------------------

function countsLine(counts: RunRegistryCounts): string {
  return `total=${counts.total} queued=${counts.queued} running=${counts.running} blocked=${counts.blocked} completed=${counts.completed} failed=${counts.failed} archived=${counts.archived} reclaimed=${counts.reclaimed}`;
}

function recordLine(record: RunRecord): string {
  const flags = [record.archived ? "archived" : "", record.provenance?.rerunOf ? `rerunOf=${record.provenance.rerunOf}` : ""].filter(Boolean).join(" ");
  return `  [${record.lifecycle}] ${record.runId} (${record.appId || record.workflowId}) ${record.loopStage}${flags ? ` {${flags}}` : ""}`;
}

export function formatRegistryReport(report: RunRegistryReport): string {
  const lines: string[] = [];
  lines.push(`Run Registry (${report.scope}): ${report.root}`);
  lines.push(`Freshness: ${report.freshness.status}${report.freshness.staleRuns.length ? ` (stale: ${report.freshness.staleRuns.join(", ")})` : ""}${report.freshness.missingRuns.length ? ` (missing: ${report.freshness.missingRuns.join(", ")})` : ""}`);
  lines.push(`Repos: ${report.index.repos.length}`);
  lines.push(countsLine(report.counts));
  if (report.freshness.status !== "valid") lines.push(`Next Action: ${report.nextAction}`);
  return lines.join("\n");
}

export function formatRunSearch(result: RunSearchResult): string {
  const lines: string[] = [];
  lines.push(`Run Search (${result.scope}): ${result.total} match(es), showing ${result.records.length} [offset ${result.offset}] freshness=${result.freshness}`);
  for (const record of result.records) lines.push(recordLine(record));
  if (!result.records.length) lines.push("  (no matching runs)");
  return lines.join("\n");
}

export function formatRunShow(result: RunShowResult): string {
  if (!result.found) {
    return `Run ${result.runId}: MISSING (source state.json absent — fail closed). Next: ${result.nextAction}`;
  }
  const r = result.record!;
  const lines = [
    `Run ${r.runId} [${r.lifecycle}] (derived: ${r.derivedLifecycle})`,
    `  app=${r.appId || r.workflowId} loopStage=${r.loopStage} repo=${r.repo}`,
    `  tasks: total=${r.tasks.total} pending=${r.tasks.pending} running=${r.tasks.running} failed=${r.tasks.failed} completed=${r.tasks.completed}`,
    `  commits=${r.commitCount} (verifier-gated=${r.verifierGatedCommitCount}) openFeedback=${r.openFeedbackCount}`
  ];
  if (r.provenance?.rerunOf) lines.push(`  provenance: rerunOf=${r.provenance.rerunOf} gen=${r.provenance.generation} origin=${r.provenance.originRunId}`);
  if (r.tier && r.tier !== "live") {
    lines.push(`  tier=${r.tier} capability=${r.capability} reason=${r.capabilityReason}${r.reclaimedBytes ? ` bytesFreed=${r.reclaimedBytes}` : ""}${r.tombstoneHash ? ` tombstone=${r.tombstoneHash.slice(0, 19)}` : ""}`);
  }
  return lines.join("\n");
}

export function formatGcPlan(result: GcPlanResult): string {
  const lines = [
    `GC Plan (${result.scope}): ${result.eligibleCount}/${result.total} eligible, ${result.bytesToFree} byte(s) would be freed [DRY-RUN, frees nothing]`,
    `  policy: reclaimAfterArchiveDays=${result.policy.reclaimAfterArchiveDays} keepScratch=${result.policy.keepScratch} keepSnapshots=${result.policy.keepSnapshots}`
  ];
  for (const entry of result.entries) {
    if (entry.eligible) {
      const kinds = Object.entries(entry.byKind).map(([k, v]) => `${k}=${v}`).join(" ");
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
    `GC Verify ${result.runId}: reclaimed=${result.reclaimed} verified=${result.verified} tier=${result.tier} capability=${result.capability}${result.tombstoneHash ? ` tombstone=${result.tombstoneHash.slice(0, 19)}` : ""}`
  ];
  for (const check of result.checks) lines.push(`  ${check.pass ? "PASS" : "FAIL"} ${check.name}${check.code ? ` [${check.code}]` : ""}${check.detail ? ` (${check.detail})` : ""}`);
  return lines.join("\n");
}

export function formatResume(result: RunResumeResult): string {
  const lines = [
    `Resume ${result.runId} [${result.lifecycle}] loopStage=${result.loopStage} (resolved from ${result.resolvedFrom}, ${result.freshness})`,
    `  resumable=${result.resumable} nextTasks=${result.nextTasks.length}`
  ];
  for (const action of result.nextActions) lines.push(`  -> ${action.command}\n     ${action.reason}`);
  return lines.join("\n");
}

export function formatHistory(result: RunHistoryResult): string {
  const lines: string[] = [];
  lines.push(`Run History (${result.scope}): ${result.total} run(s) across ${result.repos.length} repo(s), freshness=${result.freshness}`);
  for (const entry of result.entries) {
    lines.push(`  ${entry.createdAt} [${entry.lifecycle}] ${entry.runId} (${entry.appId || entry.workflowId})${entry.provenance?.rerunOf ? ` rerunOf=${entry.provenance.rerunOf}` : ""}`);
  }
  if (!result.entries.length) lines.push("  (no runs)");
  return lines.join("\n");
}

export function formatQueueList(result: { total: number; entries: RunQueueEntry[] }): string {
  const lines = [`Run Queue: ${result.total} entry(ies) [priority asc]`];
  for (const entry of result.entries) {
    lines.push(`  #${entry.priority} ${entry.id} [${entry.status}] ${entry.appId || entry.workflowId || entry.runId || "?"} repo=${entry.repo}${entry.note ? ` note=${entry.note}` : ""}`);
  }
  if (!result.entries.length) lines.push("  (queue empty)");
  return lines.join("\n");
}
