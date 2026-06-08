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
exports.RunRegistry = exports.DEFAULT_RUN_REGISTRY_POLICY = exports.RUN_REGISTRY_SCHEMA_VERSION = void 0;
exports.resolveCwHome = resolveCwHome;
exports.deriveLifecycle = deriveLifecycle;
exports.isRunLifecycleState = isRunLifecycleState;
exports.formatRegistryReport = formatRegistryReport;
exports.formatRunSearch = formatRunSearch;
exports.formatRunShow = formatRunShow;
exports.formatResume = formatResume;
exports.formatHistory = formatHistory;
exports.formatQueueList = formatQueueList;
const node_crypto_1 = __importDefault(require("node:crypto"));
const node_fs_1 = __importDefault(require("node:fs"));
const node_os_1 = __importDefault(require("node:os"));
const node_path_1 = __importDefault(require("node:path"));
const state_1 = require("./state");
exports.RUN_REGISTRY_SCHEMA_VERSION = 1;
const LIFECYCLE_STATES = [
    "queued",
    "running",
    "blocked",
    "completed",
    "failed",
    "archived"
];
// POLICY defaults. Configurable; never baked into the index. archiveOlderThanDays
// = 0 disables retention archiving (explicit selection still works).
exports.DEFAULT_RUN_REGISTRY_POLICY = {
    schemaVersion: 1,
    archiveOlderThanDays: 0,
    archiveStates: ["completed", "failed"],
    defaultQueuePriority: 100
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
        const current = this.loadRepos();
        const already = current.repos.some((entry) => node_path_1.default.resolve(entry.root) === resolved);
        if (!already)
            current.repos.push({ root: resolved, addedAt: new Date().toISOString() });
        current.repos.sort((a, b) => a.root.localeCompare(b.root));
        (0, state_1.writeJson)(file, current);
        return { registered: !already, repos: current.repos.map((entry) => entry.root) };
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
        (0, state_1.writeJson)(this.queueFilePath(), { schemaVersion: 1, entries });
    }
    // ---- record derivation (always from source) -----------------------------
    /** Derive a RunRecord from a run directory's source state.json. Returns the
     *  record, or null when source is unreadable/unsupported (caller decides how to
     *  surface `missing` — we never fabricate a status). */
    deriveRecord(repo, runDir) {
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
        const archive = this.loadArchiveOverlay(repo).archived[run.id];
        const provenance = this.loadProvenanceOverlay(repo).links[run.id];
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
            lifecycle: archive ? "archived" : derived,
            derivedLifecycle: derived,
            archived: Boolean(archive),
            archivedAt: archive?.archivedAt,
            archiveReason: archive?.reason,
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
            inputsDigest: digestInputs(run.inputs),
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
        const records = [];
        for (const entry of node_fs_1.default.readdirSync(runsDir, { withFileTypes: true })) {
            if (!entry.isDirectory())
                continue;
            const record = this.deriveRecord(repo, node_path_1.default.join(runsDir, entry.name));
            if (record)
                records.push(record);
        }
        return records.sort(compareRecords);
    }
    // ---- index construction (current truth) ---------------------------------
    /** Build the CURRENT index fresh from source for the requested scope. This is
     *  the authoritative-from-source view; persistence/freshness is layered on top. */
    buildIndex(scope) {
        const repos = scope === "home" ? this.knownRepos() : [this.repoRoot];
        const records = [];
        for (const repo of repos)
            records.push(...this.scanRepo(repo));
        records.sort(compareRecords);
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
            counts: countRecords(records)
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
            text: optionalLower(raw.text),
            app: optionalLower(raw.app),
            status: raw.status,
            repo: raw.repo ? node_path_1.default.resolve(raw.repo) : undefined,
            since: raw.since,
            until: raw.until,
            includeArchived: raw.includeArchived ?? true,
            offset: clampInt(raw.offset, 0, 0),
            limit: clampInt(raw.limit, 50, 1)
        };
        let records = index.records.filter((record) => matchesQuery(record, query));
        if (!query.includeArchived)
            records = records.filter((record) => !record.archived);
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
        const limit = clampInt(options.limit, 5, 1);
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
        const overlay = this.loadArchiveOverlay(repo);
        if (options.unarchive) {
            delete overlay.archived[runId];
        }
        else {
            overlay.archived[runId] = { archivedAt: new Date().toISOString(), reason: options.reason };
        }
        (0, state_1.writeJson)(file, overlay);
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
        (0, state_1.writeJson)(provFile, provOverlay);
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
        const entries = this.loadQueue();
        const repo = options.repo ? node_path_1.default.resolve(options.repo) : this.repoRoot;
        const entry = {
            schemaVersion: 1,
            id: options.id || queueId(),
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
    }
    queueList(options = {}) {
        let entries = this.loadQueue();
        if (options.status)
            entries = entries.filter((e) => e.status === options.status);
        if (options.repo) {
            const repo = node_path_1.default.resolve(options.repo);
            entries = entries.filter((e) => node_path_1.default.resolve(e.repo) === repo);
        }
        entries = [...entries].sort(compareQueue);
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
        const limit = clampInt(options.limit, 1, 1);
        const entries = this.loadQueue();
        const repoFilter = options.repo ? node_path_1.default.resolve(options.repo) : undefined;
        const drainable = entries
            .filter((e) => e.status === "pending" || e.status === "ready")
            .filter((e) => !repoFilter || node_path_1.default.resolve(e.repo) === repoFilter)
            .sort(compareQueue);
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
    }
    // ---- cross-repo history (unified timeline) ------------------------------
    history(options = {}) {
        const scope = options.scope || "home";
        const index = this.buildIndex(scope);
        const report = this.report(scope, index);
        const app = optionalLower(options.app);
        const limit = clampInt(options.limit, 50, 1);
        const offset = clampInt(options.offset, 0, 0);
        let records = index.records;
        if (app)
            records = records.filter((r) => (r.appId || r.workflowId || "").toLowerCase().includes(app));
        if (options.status)
            records = records.filter((r) => r.lifecycle === options.status || r.derivedLifecycle === options.status);
        const ordered = [...records].sort(compareHistory);
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
// ---------------------------------------------------------------------------
// pure helpers
// ---------------------------------------------------------------------------
function compareRecords(a, b) {
    if (a.createdAt !== b.createdAt)
        return a.createdAt < b.createdAt ? -1 : 1;
    return a.runId.localeCompare(b.runId);
}
function compareHistory(a, b) {
    // Newest first.
    if (a.createdAt !== b.createdAt)
        return a.createdAt < b.createdAt ? 1 : -1;
    return a.runId.localeCompare(b.runId);
}
function compareQueue(a, b) {
    if (a.priority !== b.priority)
        return a.priority - b.priority;
    if (a.enqueuedAt !== b.enqueuedAt)
        return a.enqueuedAt < b.enqueuedAt ? -1 : 1;
    return a.id.localeCompare(b.id);
}
function matchesQuery(record, query) {
    if (query.app && !(record.appId || record.workflowId || "").toLowerCase().includes(query.app))
        return false;
    if (query.status && record.lifecycle !== query.status && record.derivedLifecycle !== query.status)
        return false;
    if (query.repo && node_path_1.default.resolve(record.repo) !== query.repo)
        return false;
    if (query.since && record.createdAt < query.since)
        return false;
    if (query.until && record.createdAt > query.until)
        return false;
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
        if (!haystack.includes(query.text))
            return false;
    }
    return true;
}
/** Bounded, deterministic stringification of run inputs for free-text search.
 *  Descriptive intent keys (question, prompt, ...) come first so they survive
 *  truncation; the rest follow alphabetically. Deterministic and compact. */
const DIGEST_PRIORITY_KEYS = ["question", "prompt", "task", "summary", "title", "objective", "focus", "topic"];
function digestInputs(inputs) {
    if (!inputs || typeof inputs !== "object")
        return undefined;
    const keys = Object.keys(inputs);
    const ordered = [
        ...DIGEST_PRIORITY_KEYS.filter((k) => keys.includes(k)),
        ...keys.filter((k) => !DIGEST_PRIORITY_KEYS.includes(k)).sort()
    ];
    const parts = [];
    for (const key of ordered) {
        const value = inputs[key];
        if (value === undefined || value === null)
            continue;
        const rendered = Array.isArray(value) ? value.join(",") : typeof value === "object" ? JSON.stringify(value) : String(value);
        parts.push(`${key}=${rendered}`);
    }
    const joined = parts.join(" ").replace(/\s+/g, " ").trim();
    return joined.length > 360 ? `${joined.slice(0, 357)}...` : joined;
}
function countRecords(records) {
    const counts = {
        total: records.length,
        queued: 0,
        running: 0,
        blocked: 0,
        completed: 0,
        failed: 0,
        archived: 0
    };
    for (const record of records) {
        counts[record.lifecycle] = (counts[record.lifecycle] || 0) + 1;
    }
    return counts;
}
function optionalLower(value) {
    if (value === undefined || value === null || value === "")
        return undefined;
    return String(value).toLowerCase();
}
function clampInt(value, fallback, min) {
    const n = Number(value);
    if (!Number.isFinite(n))
        return fallback;
    return Math.max(min, Math.floor(n));
}
let queueCounter = 0;
function queueId() {
    queueCounter += 1;
    const stamp = new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14);
    return `q-${stamp}-${String(queueCounter).padStart(3, "0")}`;
}
function isRunLifecycleState(value) {
    return typeof value === "string" && LIFECYCLE_STATES.includes(value);
}
// ---------------------------------------------------------------------------
// Human formatting (CLI-only; never affects --json / MCP payloads)
// ---------------------------------------------------------------------------
function countsLine(counts) {
    return `total=${counts.total} queued=${counts.queued} running=${counts.running} blocked=${counts.blocked} completed=${counts.completed} failed=${counts.failed} archived=${counts.archived}`;
}
function recordLine(record) {
    const flags = [record.archived ? "archived" : "", record.provenance?.rerunOf ? `rerunOf=${record.provenance.rerunOf}` : ""].filter(Boolean).join(" ");
    return `  [${record.lifecycle}] ${record.runId} (${record.appId || record.workflowId}) ${record.loopStage}${flags ? ` {${flags}}` : ""}`;
}
function formatRegistryReport(report) {
    const lines = [];
    lines.push(`Run Registry (${report.scope}): ${report.root}`);
    lines.push(`Freshness: ${report.freshness.status}${report.freshness.staleRuns.length ? ` (stale: ${report.freshness.staleRuns.join(", ")})` : ""}${report.freshness.missingRuns.length ? ` (missing: ${report.freshness.missingRuns.join(", ")})` : ""}`);
    lines.push(`Repos: ${report.index.repos.length}`);
    lines.push(countsLine(report.counts));
    if (report.freshness.status !== "valid")
        lines.push(`Next Action: ${report.nextAction}`);
    return lines.join("\n");
}
function formatRunSearch(result) {
    const lines = [];
    lines.push(`Run Search (${result.scope}): ${result.total} match(es), showing ${result.records.length} [offset ${result.offset}] freshness=${result.freshness}`);
    for (const record of result.records)
        lines.push(recordLine(record));
    if (!result.records.length)
        lines.push("  (no matching runs)");
    return lines.join("\n");
}
function formatRunShow(result) {
    if (!result.found) {
        return `Run ${result.runId}: MISSING (source state.json absent — fail closed). Next: ${result.nextAction}`;
    }
    const r = result.record;
    const lines = [
        `Run ${r.runId} [${r.lifecycle}] (derived: ${r.derivedLifecycle})`,
        `  app=${r.appId || r.workflowId} loopStage=${r.loopStage} repo=${r.repo}`,
        `  tasks: total=${r.tasks.total} pending=${r.tasks.pending} running=${r.tasks.running} failed=${r.tasks.failed} completed=${r.tasks.completed}`,
        `  commits=${r.commitCount} (verifier-gated=${r.verifierGatedCommitCount}) openFeedback=${r.openFeedbackCount}`
    ];
    if (r.provenance?.rerunOf)
        lines.push(`  provenance: rerunOf=${r.provenance.rerunOf} gen=${r.provenance.generation} origin=${r.provenance.originRunId}`);
    return lines.join("\n");
}
function formatResume(result) {
    const lines = [
        `Resume ${result.runId} [${result.lifecycle}] loopStage=${result.loopStage} (resolved from ${result.resolvedFrom}, ${result.freshness})`,
        `  resumable=${result.resumable} nextTasks=${result.nextTasks.length}`
    ];
    for (const action of result.nextActions)
        lines.push(`  -> ${action.command}\n     ${action.reason}`);
    return lines.join("\n");
}
function formatHistory(result) {
    const lines = [];
    lines.push(`Run History (${result.scope}): ${result.total} run(s) across ${result.repos.length} repo(s), freshness=${result.freshness}`);
    for (const entry of result.entries) {
        lines.push(`  ${entry.createdAt} [${entry.lifecycle}] ${entry.runId} (${entry.appId || entry.workflowId})${entry.provenance?.rerunOf ? ` rerunOf=${entry.provenance.rerunOf}` : ""}`);
    }
    if (!result.entries.length)
        lines.push("  (no runs)");
    return lines.join("\n");
}
function formatQueueList(result) {
    const lines = [`Run Queue: ${result.total} entry(ies) [priority asc]`];
    for (const entry of result.entries) {
        lines.push(`  #${entry.priority} ${entry.id} [${entry.status}] ${entry.appId || entry.workflowId || entry.runId || "?"} repo=${entry.repo}${entry.note ? ` note=${entry.note}` : ""}`);
    }
    if (!result.entries.length)
        lines.push("  (queue empty)");
    return lines.join("\n");
}
