"use strict";
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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.formatQueueList = exports.formatHistory = exports.formatResume = exports.formatGcVerify = exports.formatGcRun = exports.formatGcPlan = exports.formatRunShow = exports.formatRunSearch = exports.formatRegistryReport = exports.RunRegistry = exports.DEFAULT_RUN_REGISTRY_POLICY = exports.RUN_REGISTRY_SCHEMA_VERSION = exports.isRunLifecycleState = exports.compareQueue = void 0;
exports.resolveCwHome = resolveCwHome;
exports.deriveLifecycle = deriveLifecycle;
const node_crypto_1 = __importDefault(require("node:crypto"));
const node_fs_1 = __importDefault(require("node:fs"));
const node_os_1 = __importDefault(require("node:os"));
const node_path_1 = __importDefault(require("node:path"));
const state_1 = require("./state");
const reclamation_1 = require("./reclamation");
const compare_1 = require("./compare");
const derive_1 = require("./run-registry/derive");
Object.defineProperty(exports, "compareQueue", { enumerable: true, get: function () { return derive_1.compareQueue; } });
Object.defineProperty(exports, "isRunLifecycleState", { enumerable: true, get: function () { return derive_1.isRunLifecycleState; } });
exports.RUN_REGISTRY_SCHEMA_VERSION = 1;
// POLICY defaults. Configurable; never baked into the index. archiveOlderThanDays
// = 0 disables retention archiving (explicit selection still works). The v0.1.39
// reclamation knobs all default to RECLAIM NOTHING (back-compatible, opt-in).
exports.DEFAULT_RUN_REGISTRY_POLICY = {
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
function resolveCwHome(env = process.env) {
    if (env.CW_HOME && String(env.CW_HOME).trim())
        return node_path_1.default.resolve(String(env.CW_HOME));
    if (env.XDG_STATE_HOME && String(env.XDG_STATE_HOME).trim()) {
        return node_path_1.default.join(node_path_1.default.resolve(String(env.XDG_STATE_HOME)), "cool-workflow");
    }
    return node_path_1.default.join(node_os_1.default.homedir(), ".local", "state", "cool-workflow");
}
// ---------------------------------------------------------------------------
// Fingerprints (same shape/strength as state-explosion's)
// ---------------------------------------------------------------------------
function fingerprintStrings(values) {
    const hash = node_crypto_1.default.createHash("sha256");
    hash.update(JSON.stringify([...values].sort()));
    return `sha256:${hash.digest("hex").slice(0, 32)}`;
}
/** Content fingerprint of a run's source state.json. Structural, not just mtime,
 *  so a tampered task status trips `stale` even if updatedAt is unchanged. */
function fingerprintRun(run) {
    const parts = [
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
function deriveLifecycle(input) {
    if (input.running > 0)
        return "running";
    if (input.openFeedback > 0)
        return "blocked";
    if (input.failed > 0)
        return "failed";
    if (input.total > 0 && input.completed === input.total)
        return "completed";
    if (input.verifierGatedCommits > 0 && input.pending === 0)
        return "completed";
    if (input.completed > 0)
        return "running";
    return "queued";
}
function lifecycleInputs(run) {
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
class RunRegistry {
    repoRoot;
    homeRoot;
    planner;
    constructor(cwd = process.cwd(), planner, env = process.env) {
        this.repoRoot = node_path_1.default.resolve(cwd);
        this.homeRoot = resolveCwHome(env);
        this.planner = planner;
    }
    // ---- path helpers -------------------------------------------------------
    repoRunsDir(repo) {
        return node_path_1.default.join(repo, ".cw", "runs");
    }
    repoRegistryDir(repo) {
        return node_path_1.default.join(repo, ".cw", "registry");
    }
    homeRegistryDir() {
        return node_path_1.default.join(this.homeRoot, "registry");
    }
    // ---- per-repo overlays (plain files) ------------------------------------
    loadArchiveOverlay(repo) {
        const file = node_path_1.default.join(this.repoRegistryDir(repo), "archive.json");
        if (!node_fs_1.default.existsSync(file))
            return { schemaVersion: 1, archived: {} };
        try {
            const parsed = (0, state_1.readJson)(file);
            return { schemaVersion: 1, archived: parsed.archived || {} };
        }
        catch {
            return { schemaVersion: 1, archived: {} };
        }
    }
    loadProvenanceOverlay(repo) {
        const file = node_path_1.default.join(this.repoRegistryDir(repo), "provenance.json");
        if (!node_fs_1.default.existsSync(file))
            return { schemaVersion: 1, links: {} };
        try {
            const parsed = (0, state_1.readJson)(file);
            return { schemaVersion: 1, links: parsed.links || {} };
        }
        catch {
            return { schemaVersion: 1, links: {} };
        }
    }
    loadRepoOverlays(repo) {
        return {
            archive: this.loadArchiveOverlay(repo),
            provenance: this.loadProvenanceOverlay(repo)
        };
    }
    // ---- home registry files ------------------------------------------------
    reposFilePath() {
        return node_path_1.default.join(this.homeRegistryDir(), "repos.json");
    }
    loadRepos() {
        const file = this.reposFilePath();
        if (!node_fs_1.default.existsSync(file))
            return { schemaVersion: 1, repos: [] };
        try {
            const parsed = (0, state_1.readJson)(file);
            return { schemaVersion: 1, repos: Array.isArray(parsed.repos) ? parsed.repos : [] };
        }
        catch {
            return { schemaVersion: 1, repos: [] };
        }
    }
    /** Persisted union of registered repo roots and the current repo, deduped and
     *  sorted. Read-only: does NOT write repos.json (reads stay pure). */
    knownRepos() {
        const roots = new Set([this.repoRoot]);
        for (const entry of this.loadRepos().repos)
            roots.add(node_path_1.default.resolve(entry.root));
        return [...roots].sort();
    }
    /** Register a repo root into the home repos.json (idempotent). Only mutating
     *  operations call this; reads never do. */
    registerRepo(repo = this.repoRoot) {
        const resolved = node_path_1.default.resolve(repo);
        const file = this.reposFilePath();
        // Cross-process read-modify-write: lock so a concurrent register can't drop a
        // repo (v0.1.40, P1-D), and persist durably.
        return (0, state_1.withFileLock)(file, () => {
            const current = this.loadRepos();
            const already = current.repos.some((entry) => node_path_1.default.resolve(entry.root) === resolved);
            if (!already)
                current.repos.push({ root: resolved, addedAt: new Date().toISOString() });
            current.repos.sort((a, b) => (0, compare_1.compareBytes)(a.root, b.root));
            (0, state_1.writeJson)(file, current, { durable: true });
            return { registered: !already, repos: current.repos.map((entry) => entry.root) };
        });
    }
    queueFilePath() {
        return node_path_1.default.join(this.homeRegistryDir(), "queue.json");
    }
    loadQueue() {
        const file = this.queueFilePath();
        if (!node_fs_1.default.existsSync(file))
            return [];
        try {
            const parsed = (0, state_1.readJson)(file);
            return Array.isArray(parsed.entries) ? parsed.entries : [];
        }
        catch {
            return [];
        }
    }
    saveQueue(entries) {
        (0, state_1.writeJson)(this.queueFilePath(), { schemaVersion: 1, entries }, { durable: true });
    }
    // Public queue accessors for the v0.1.37 control-plane scheduler (it operates ON
    // this queue store via pure functions in scheduling.ts; the queue file is never
    // duplicated). The scheduling-policy file lives beside the queue in the home
    // registry, plain and diffable.
    loadQueueEntries() {
        return this.loadQueue();
    }
    saveQueueEntries(entries) {
        this.saveQueue(entries);
    }
    schedulingPolicyPath() {
        return node_path_1.default.join(this.homeRegistryDir(), "scheduling-policy.json");
    }
    // ---- record derivation (always from source) -----------------------------
    /** Derive a RunRecord from a run directory's source state.json. Returns the
     *  record, or null when source is unreadable/unsupported (caller decides how to
     *  surface `missing` — we never fabricate a status). */
    deriveRecord(repo, runDir, overlays = this.loadRepoOverlays(repo)) {
        const statePath = node_path_1.default.join(runDir, "state.json");
        if (!node_fs_1.default.existsSync(statePath))
            return null;
        let run;
        try {
            const result = (0, state_1.loadRunStateFile)(statePath, { dryRun: true });
            if (result.report.status === "unsupported")
                return null;
            run = result.run;
        }
        catch {
            return null;
        }
        const li = lifecycleInputs(run);
        const derived = deriveLifecycle(li);
        const archive = overlays.archive.archived[run.id];
        const provenance = overlays.provenance.links[run.id];
        // Run Retention & Provable Reclamation (v0.1.39): the per-run reclaimed.json
        // overlay (if any) raises the disk-tier above `archived` and downgrades the
        // capability. Derived from source, never invented.
        const reclaim = (0, derive_1.loadReclaimedFromDir)(runDir);
        const lastTombstone = reclaim.tombstones[reclaim.tombstones.length - 1];
        const tier = lastTombstone ? "reclaimed" : archive ? "archived" : "live";
        const capability = lastTombstone ? lastTombstone.capability : "re-runnable";
        const capabilityReason = lastTombstone
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
            backends: (0, derive_1.distinctBackends)(run),
            inputsDigest: (0, derive_1.digestInputs)(run.inputs),
            sourceFingerprint: fingerprintRun(run),
            freshness: "valid",
            provenance
        };
    }
    /** Scan one repo's `.cw/runs/` and derive a record per run, deterministically
     *  ordered (createdAt asc, then runId). Unreadable runs are skipped here; the
     *  freshness layer is responsible for reporting persisted-but-missing runs. */
    scanRepo(repo) {
        const runsDir = this.repoRunsDir(repo);
        if (!node_fs_1.default.existsSync(runsDir))
            return [];
        const overlays = this.loadRepoOverlays(repo);
        const records = [];
        for (const entry of node_fs_1.default.readdirSync(runsDir, { withFileTypes: true })) {
            if (!entry.isDirectory())
                continue;
            const record = this.deriveRecord(repo, node_path_1.default.join(runsDir, entry.name), overlays);
            if (record)
                records.push(record);
        }
        return records.sort(derive_1.compareRecords);
    }
    // ---- index construction (current truth) ---------------------------------
    /** Build the CURRENT index fresh from source for the requested scope. This is
     *  the authoritative-from-source view; persistence/freshness is layered on top. */
    buildIndex(scope) {
        const repos = scope === "home" ? this.knownRepos() : [this.repoRoot];
        const records = [];
        for (const repo of repos)
            records.push(...this.scanRepo(repo));
        records.sort(derive_1.compareRecords);
        const queue = scope === "home" ? this.loadQueue() : this.loadQueue().filter((q) => node_path_1.default.resolve(q.repo) === this.repoRoot);
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
            counts: (0, derive_1.countRecords)(records)
        };
    }
    persistedIndexPath(scope) {
        return scope === "home"
            ? node_path_1.default.join(this.homeRegistryDir(), "index.json")
            : node_path_1.default.join(this.repoRegistryDir(this.repoRoot), "index.json");
    }
    loadPersistedIndex(scope) {
        const file = this.persistedIndexPath(scope);
        if (!node_fs_1.default.existsSync(file))
            return undefined;
        try {
            const parsed = (0, state_1.readJson)(file);
            if (!parsed || parsed.schemaVersion !== 1)
                return undefined;
            return parsed;
        }
        catch {
            return undefined;
        }
    }
    /** Refresh (recompute and persist) the index. registers the current repo into
     *  the home registry so cross-repo discovery finds it later. MECHANISM only:
     *  never touches source state.json. */
    refresh(options = {}) {
        const scope = options.scope || "repo";
        // Registering the current repo is what makes a single-repo run discoverable
        // cross-repo. Always safe (idempotent) and never mutates run source.
        this.registerRepo(this.repoRoot);
        const index = this.buildIndex(scope);
        (0, state_1.writeJson)(this.persistedIndexPath(scope), index);
        if (scope === "repo") {
            // A repo refresh also keeps the home aggregate fresh enough to discover this
            // repo's runs, without forcing a full cross-repo rebuild.
            const homeIndex = this.buildIndex("home");
            (0, state_1.writeJson)(this.persistedIndexPath("home"), homeIndex);
        }
        return this.report(scope, index);
    }
    /** Read the index with explicit freshness against current source. Re-derives
     *  every record from source (never fabricates); compares to the persisted cache
     *  to report valid|stale|absent + staleRuns/missingRuns. */
    show(options = {}) {
        const scope = options.scope || "repo";
        return this.report(scope, this.buildIndex(scope));
    }
    report(scope, current) {
        const persisted = this.loadPersistedIndex(scope);
        const currentById = new Map(current.records.map((r) => [r.runId, r]));
        let status = persisted ? "valid" : "absent";
        const staleRuns = [];
        const missingRuns = [];
        if (persisted) {
            if (persisted.sourceFingerprint !== current.sourceFingerprint)
                status = "stale";
            for (const prior of persisted.records) {
                const now = currentById.get(prior.runId);
                if (!now) {
                    missingRuns.push(prior.runId);
                }
                else if (now.sourceFingerprint !== prior.sourceFingerprint) {
                    staleRuns.push(prior.runId);
                }
            }
            if (staleRuns.length || missingRuns.length)
                status = "stale";
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
    search(raw = {}) {
        const scope = raw.scope || "home";
        const index = this.buildIndex(scope);
        const report = this.report(scope, index);
        const query = {
            text: (0, derive_1.optionalLower)(raw.text),
            app: (0, derive_1.optionalLower)(raw.app),
            status: raw.status,
            repo: raw.repo ? node_path_1.default.resolve(raw.repo) : undefined,
            since: raw.since,
            until: raw.until,
            includeArchived: raw.includeArchived ?? true,
            offset: (0, derive_1.clampInt)(raw.offset, 0, 0),
            limit: (0, derive_1.clampInt)(raw.limit, 50, 1)
        };
        let records = index.records.filter((record) => (0, derive_1.matchesQuery)(record, query));
        if (!query.includeArchived)
            records = records.filter((record) => !record.archived);
        records.sort(derive_1.compareRecords);
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
            nextAction: report.freshness.status === "valid"
                ? "node scripts/cw.js run show <run-id>"
                : "node scripts/cw.js registry refresh"
        };
    }
    list(options = {}) {
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
    showRun(runId, options = {}) {
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
    locate(runId, scope) {
        // Current repo first (least astonishment: cwd wins).
        const here = this.deriveRecordForRun(this.repoRoot, runId);
        if (here)
            return { record: here, from: "repo" };
        if (scope === "repo")
            return undefined;
        for (const repo of this.knownRepos()) {
            if (node_path_1.default.resolve(repo) === this.repoRoot)
                continue;
            const record = this.deriveRecordForRun(repo, runId);
            if (record)
                return { record, from: "home" };
        }
        return undefined;
    }
    deriveRecordForRun(repo, runId) {
        const runDir = node_path_1.default.join(this.repoRunsDir(repo), runId);
        if (!node_fs_1.default.existsSync(node_path_1.default.join(runDir, "state.json")))
            return null;
        return this.deriveRecord(repo, runDir);
    }
    findPersisted(runId, scope) {
        for (const s of scope === "home" ? ["home", "repo"] : ["repo"]) {
            const persisted = this.loadPersistedIndex(s);
            const hit = persisted?.records.find((r) => r.runId === runId);
            if (hit)
                return hit;
        }
        return undefined;
    }
    loadRun(repo, runId) {
        const statePath = node_path_1.default.join(this.repoRunsDir(repo), runId, "state.json");
        if (!node_fs_1.default.existsSync(statePath))
            throw new Error(`Run not found: ${runId}`);
        const result = (0, state_1.loadRunStateFile)(statePath, { dryRun: true });
        if (result.report.status === "unsupported") {
            throw new Error(`Unsupported run state for ${runId}: ${result.report.errors.join("; ")}`);
        }
        return result.run;
    }
    // ---- resume (continue from durable state; read-only over source) --------
    resume(runId, options = {}) {
        const scope = options.scope || "home";
        const located = this.locate(runId, scope);
        if (!located) {
            throw new Error(`Cannot resume: run ${runId} not found in source state (fail closed; try registry refresh).`);
        }
        const record = located.record;
        const run = this.loadRun(record.repo, runId);
        const limit = (0, derive_1.clampInt)(options.limit, 5, 1);
        const nextTasks = (run.tasks || [])
            .filter((t) => t.status === "pending" || t.status === "running")
            .slice(0, limit)
            .map((t) => ({ id: t.id, phase: t.phase, status: t.status, taskPath: t.taskPath }));
        const terminal = record.derivedLifecycle === "completed" || record.derivedLifecycle === "failed";
        const resumable = nextTasks.length > 0 || (!terminal && record.derivedLifecycle !== "completed");
        const nextActions = [];
        if (nextTasks.length) {
            nextActions.push({
                command: `node scripts/cw.js dispatch ${runId} --cwd ${record.repo}`,
                reason: `Continue ${nextTasks.length} pending/running task(s) from durable state.`
            });
            nextActions.push({
                command: `node scripts/cw.js multi-agent step ${runId} --cwd ${record.repo}`,
                reason: "Take one deterministic host step without spawning agents."
            });
        }
        else if (record.derivedLifecycle === "failed") {
            nextActions.push({
                command: `node scripts/cw.js run rerun ${runId}`,
                reason: "Run terminated as failed with no runnable tasks; rerun as a new linked run."
            });
        }
        else {
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
    archive(runId, options = {}) {
        const scope = options.scope || "home";
        const located = this.locate(runId, scope);
        if (!located)
            throw new Error(`Cannot archive: run ${runId} not found in source state (fail closed).`);
        const repo = located.record.repo;
        const file = node_path_1.default.join(this.repoRegistryDir(repo), "archive.json");
        // Lock the archive-overlay read-modify-write (v0.1.40, P1-D) + durable write.
        (0, state_1.withFileLock)(file, () => {
            const overlay = this.loadArchiveOverlay(repo);
            if (options.unarchive) {
                delete overlay.archived[runId];
            }
            else {
                overlay.archived[runId] = { archivedAt: new Date().toISOString(), reason: options.reason };
            }
            (0, state_1.writeJson)(file, overlay, { durable: true });
        });
        const record = this.deriveRecord(repo, located.record.runDir);
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
    archiveByPolicy(policy = exports.DEFAULT_RUN_REGISTRY_POLICY, options = {}) {
        const scope = options.scope || "home";
        if (!policy.archiveOlderThanDays || policy.archiveOlderThanDays <= 0) {
            return { policy, archived: [], eligible: 0 };
        }
        const nowMs = options.now ? Date.parse(options.now) : Date.now();
        const cutoff = nowMs - policy.archiveOlderThanDays * 24 * 60 * 60 * 1000;
        const index = this.buildIndex(scope);
        const eligible = index.records.filter((r) => !r.archived && policy.archiveStates.includes(r.derivedLifecycle) && Date.parse(r.updatedAt) < cutoff);
        const archived = [];
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
    reclamationPolicy(overrides = {}) {
        return { ...exports.DEFAULT_RUN_REGISTRY_POLICY, ...overrides };
    }
    /** Fail-closed eligibility: terminal AND archived AND no open feedback AND past
     *  retention. Returns the matching refusal code, or null when eligible. Reads
     *  the live-source-derived record; order yields distinct, stable codes. */
    reclaimEligibility(record, policy, nowMs) {
        if (record.tier === "reclaimed")
            return "already-reclaimed";
        const terminalStates = policy.reclaimStates && policy.reclaimStates.length ? policy.reclaimStates : ["completed", "failed"];
        if (record.derivedLifecycle !== "completed" && record.derivedLifecycle !== "failed")
            return "non-terminal";
        if (!terminalStates.includes(record.derivedLifecycle))
            return "non-terminal";
        if (record.openFeedbackCount > 0)
            return "open-feedback";
        if (!record.archived)
            return "not-archived";
        const days = policy.reclaimAfterArchiveDays ?? 0;
        if (days > 0) {
            const archivedAtMs = record.archivedAt ? Date.parse(record.archivedAt) : NaN;
            if (!Number.isFinite(archivedAtMs))
                return "within-retention";
            if (archivedAtMs > nowMs - days * 24 * 60 * 60 * 1000)
                return "within-retention";
        }
        return null;
    }
    /** Resolve a single run to a one-element record list via locate() (repo-first),
     *  avoiding a full-registry scan for single-run gc plan/run. */
    recordsForRunId(runId, scope) {
        const located = this.locate(runId, scope);
        return located ? [located.record] : [];
    }
    /** Dry-run: compute eligible runs, per-kind bytes that WOULD be freed, and the
     *  capability downgrade. Frees NOTHING. */
    gcPlan(options = {}) {
        const scope = options.scope || "home";
        const policy = this.reclamationPolicy(options.policy);
        const nowIso = options.now || new Date().toISOString();
        const nowMs = Date.parse(nowIso);
        // Fast, deterministic single-run path: resolve just that run via locate()
        // (repo-first) so a home-scope plan never re-scans the whole registry.
        const records = options.runId ? this.recordsForRunId(options.runId, scope) : this.buildIndex(scope).records;
        const entries = [];
        let bytesToFree = 0;
        let eligibleCount = 0;
        for (const record of records) {
            const refusal = this.reclaimEligibility(record, policy, nowMs);
            let plan;
            try {
                const run = this.loadRun(record.repo, record.runId);
                plan = (0, reclamation_1.planReclamation)(run, { keepScratch: policy.keepScratch, keepSnapshots: policy.keepSnapshots });
            }
            catch {
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
            const entry = {
                runId: record.runId,
                repo: record.repo,
                eligible,
                reason: eligible ? "eligible" : refusal,
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
    gcRun(options = {}) {
        const scope = options.scope || "home";
        const policy = this.reclamationPolicy(options.policy);
        const nowIso = options.now || new Date().toISOString();
        const nowMs = Date.parse(nowIso);
        const records = options.runId ? this.recordsForRunId(options.runId, scope) : this.buildIndex(scope).records;
        const maxRuns = options.limit ?? (policy.maxReclaimRuns || 0);
        const maxBytes = policy.maxReclaimBytes || 0;
        const reclaimed = [];
        const refused = [];
        let totalBytesFreed = 0;
        for (const record of records) {
            const refusal = this.reclaimEligibility(record, policy, nowMs);
            if (refusal) {
                refused.push({ runId: record.runId, code: refusal });
                continue;
            }
            if (maxRuns > 0 && reclaimed.length >= maxRuns)
                break;
            let run;
            try {
                run = this.loadRun(record.repo, record.runId);
            }
            catch {
                refused.push({ runId: record.runId, code: "unreadable" });
                continue;
            }
            try {
                const result = (0, reclamation_1.runReclamation)(run, {
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
                if (maxBytes > 0 && totalBytesFreed >= maxBytes)
                    break;
            }
            catch (error) {
                if (error instanceof reclamation_1.ReclamationError)
                    refused.push({ runId: record.runId, code: error.code });
                else
                    throw error;
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
    gcVerify(runId, options = {}) {
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
        const result = (0, reclamation_1.verifyReclamation)(run);
        const checks = result.checks.map((c) => ({ name: c.name, pass: c.pass, code: c.code, detail: c.detail }));
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
    rerun(runId, options = {}) {
        if (!this.planner)
            throw new Error("rerun requires a run planner (CoolWorkflowRunner)");
        const scope = options.scope || "home";
        const located = this.locate(runId, scope);
        if (!located)
            throw new Error(`Cannot rerun: run ${runId} not found in source state (fail closed).`);
        const original = located.record;
        const originalRun = this.loadRun(original.repo, runId);
        const appId = originalRun.workflow.app?.id || originalRun.workflow.id;
        // Reuse the original inputs verbatim, pinned to the original repo so the new
        // run lands beside it. We never fork run creation — this is runner.plan.
        const inputs = { ...(originalRun.inputs || {}), cwd: original.repo, repo: original.repo };
        const newRun = this.planner.plan(appId, inputs);
        const priorProv = original.provenance;
        const provenance = {
            rerunOf: runId,
            rerunOfRepo: original.repo,
            originRunId: priorProv?.originRunId || runId,
            generation: (priorProv?.generation || 0) + 1,
            reason: options.reason || "rerun of failed run",
            createdAt: new Date().toISOString()
        };
        // Record provenance in the per-repo overlay (derived metadata), NOT in the
        // original run's source state — the past is never mutated.
        const provFile = node_path_1.default.join(this.repoRegistryDir(original.repo), "provenance.json");
        const provOverlay = this.loadProvenanceOverlay(original.repo);
        provOverlay.links[newRun.id] = provenance;
        (0, state_1.writeJson)(provFile, provOverlay, { durable: true });
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
    queueAdd(options = {}) {
        const repo = options.repo ? node_path_1.default.resolve(options.repo) : this.repoRoot;
        // Cross-process read-modify-write on the home queue: lock so a concurrently
        // added task can never vanish (v0.1.40, P1-D).
        return (0, state_1.withFileLock)(this.queueFilePath(), () => {
            const entries = this.loadQueue();
            const entry = {
                schemaVersion: 1,
                id: options.id || (0, derive_1.queueId)(),
                runId: options.runId,
                appId: options.appId,
                workflowId: options.workflowId,
                repo,
                priority: Number.isFinite(options.priority) ? Number(options.priority) : exports.DEFAULT_RUN_REGISTRY_POLICY.defaultQueuePriority,
                enqueuedAt: new Date().toISOString(),
                status: "pending",
                inputs: options.inputs,
                note: options.note
            };
            entries.push(entry);
            this.registerRepo(repo);
            this.saveQueue(entries);
            return entry;
        });
    }
    queueList(options = {}) {
        let entries = this.loadQueue();
        if (options.status)
            entries = entries.filter((e) => e.status === options.status);
        if (options.repo) {
            const repo = node_path_1.default.resolve(options.repo);
            entries = entries.filter((e) => node_path_1.default.resolve(e.repo) === repo);
        }
        entries = [...entries].sort(derive_1.compareQueue);
        return { schemaVersion: 1, total: entries.length, entries };
    }
    queueShow(id) {
        const entry = this.loadQueue().find((e) => e.id === id);
        if (!entry)
            throw new Error(`Queue entry not found: ${id}`);
        return entry;
    }
    /** Drain the next N ready/pending entries in policy order, marking them drained.
     *  CW records readiness/order; the HOST still executes the workers. */
    queueDrain(options = {}) {
        const limit = (0, derive_1.clampInt)(options.limit, 1, 1);
        const repoFilter = options.repo ? node_path_1.default.resolve(options.repo) : undefined;
        // Lock the drain RMW so two hosts can never double-drain the same entry
        // (v0.1.40, P1-D — the scheduling kernel's concurrency ceiling now holds
        // across processes, not just within one).
        return (0, state_1.withFileLock)(this.queueFilePath(), () => {
            const entries = this.loadQueue();
            const drainable = entries
                .filter((e) => e.status === "pending" || e.status === "ready")
                .filter((e) => !repoFilter || node_path_1.default.resolve(e.repo) === repoFilter)
                .sort(derive_1.compareQueue);
            const drained = [];
            const drainedAt = new Date().toISOString();
            for (const entry of drainable.slice(0, limit)) {
                entry.status = "drained";
                entry.drainedAt = drainedAt;
                drained.push(entry);
            }
            this.saveQueue(entries);
            const remaining = entries.filter((e) => e.status === "pending" || e.status === "ready").length;
            return { schemaVersion: 1, drained, remaining };
        });
    }
    // ---- cross-repo history (unified timeline) ------------------------------
    history(options = {}) {
        const scope = options.scope || "home";
        const index = this.buildIndex(scope);
        const report = this.report(scope, index);
        const app = (0, derive_1.optionalLower)(options.app);
        const limit = (0, derive_1.clampInt)(options.limit, 50, 1);
        const offset = (0, derive_1.clampInt)(options.offset, 0, 0);
        let records = index.records;
        if (app)
            records = records.filter((r) => (r.appId || r.workflowId || "").toLowerCase().includes(app));
        if (options.status)
            records = records.filter((r) => r.lifecycle === options.status || r.derivedLifecycle === options.status);
        const ordered = [...records].sort(derive_1.compareHistory);
        const total = ordered.length;
        const page = ordered.slice(offset, offset + limit);
        const entries = page.map((r) => ({
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
exports.RunRegistry = RunRegistry;
// Human formatting (CLI-only) now lives in ./run-registry/format.ts (FreeBSD-
// audit R2: rendering carved out of the registry class). Re-exported so that
// importers of "./run-registry" see an unchanged surface.
var format_1 = require("./run-registry/format");
Object.defineProperty(exports, "formatRegistryReport", { enumerable: true, get: function () { return format_1.formatRegistryReport; } });
Object.defineProperty(exports, "formatRunSearch", { enumerable: true, get: function () { return format_1.formatRunSearch; } });
Object.defineProperty(exports, "formatRunShow", { enumerable: true, get: function () { return format_1.formatRunShow; } });
Object.defineProperty(exports, "formatGcPlan", { enumerable: true, get: function () { return format_1.formatGcPlan; } });
Object.defineProperty(exports, "formatGcRun", { enumerable: true, get: function () { return format_1.formatGcRun; } });
Object.defineProperty(exports, "formatGcVerify", { enumerable: true, get: function () { return format_1.formatGcVerify; } });
Object.defineProperty(exports, "formatResume", { enumerable: true, get: function () { return format_1.formatResume; } });
Object.defineProperty(exports, "formatHistory", { enumerable: true, get: function () { return format_1.formatHistory; } });
Object.defineProperty(exports, "formatQueueList", { enumerable: true, get: function () { return format_1.formatQueueList; } });
