"use strict";
// shell/run-registry-io.ts — the on-disk run registry: index/queue/history
// persistence, lifecycle derivation, search/resume/archive/rerun.
//
// MILESTONE 10 (docs/rebuild/PLAN.md build order, step 10). Byte-exact port of the
// old build's src/run-registry.ts + src/run-registry/{derive,policy,
// queue}.ts. The registry is a DERIVED, rebuildable index over each repo's
// `.cw/runs/<id>/state.json` (the single source of truth, never mutated
// here except via `archive`/`rerun`'s overlay files). Every read
// re-derives from source; the persisted index.json is only ever compared,
// never trusted (fail-OPEN on a corrupt index.json — see the file header
// note in SPEC/scheduling-registry.md's "Rebuild risks" #1).
//
// Evidence: SPEC/scheduling-registry.md sections C, D (partial: policy
// constant), H; plugins/cool-workflow/src/run-registry.ts,
// src/run-registry/{derive,policy,queue}.ts (byte-exact source).
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.RunRegistry = exports.DEFAULT_RUN_REGISTRY_POLICY = exports.RUN_REGISTRY_SCHEMA_VERSION = void 0;
exports.compareBytes = compareBytes;
exports.compareRecords = compareRecords;
exports.compareHistory = compareHistory;
exports.compareQueue = compareQueue;
exports.matchesQuery = matchesQuery;
exports.distinctBackends = distinctBackends;
exports.digestInputs = digestInputs;
exports.countRecords = countRecords;
exports.optionalLower = optionalLower;
exports.clampInt = clampInt;
exports.queueId = queueId;
exports.isRunLifecycleState = isRunLifecycleState;
exports.loadReclaimedFromDir = loadReclaimedFromDir;
exports.deriveLifecycle = deriveLifecycle;
exports.resolveCwHome = resolveCwHome;
exports.humanBytes = humanBytes;
exports.formatRegistryReport = formatRegistryReport;
exports.formatRunSearch = formatRunSearch;
exports.formatRunShow = formatRunShow;
exports.formatResume = formatResume;
exports.formatHistory = formatHistory;
exports.formatQueueList = formatQueueList;
const fs = __importStar(require("node:fs"));
const os = __importStar(require("node:os"));
const path = __importStar(require("node:path"));
const fs_atomic_1 = require("./fs-atomic");
const run_store_1 = require("./run-store");
const hash_1 = require("../core/hash");
exports.RUN_REGISTRY_SCHEMA_VERSION = 1;
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
    maxReclaimBytes: 0,
};
// ---------------------------------------------------------------------------
// Pure helpers (byte-exact port of src/run-registry/derive.ts)
// ---------------------------------------------------------------------------
/** Simple byte (UTF-16 code-unit) comparator — matches src/compare.ts's
 *  `compareBytes` used throughout the old build's registry/reclamation
 *  code. Kept as a small local copy (same pattern as core/multi-agent's
 *  own local copies) rather than a new shared module. */
function compareBytes(a, b) {
    return a < b ? -1 : a > b ? 1 : 0;
}
function compareRecords(a, b) {
    if (a.createdAt !== b.createdAt)
        return a.createdAt < b.createdAt ? -1 : 1;
    return compareBytes(a.runId, b.runId);
}
function compareHistory(a, b) {
    if (a.createdAt !== b.createdAt)
        return a.createdAt < b.createdAt ? 1 : -1;
    return compareBytes(a.runId, b.runId);
}
function compareQueue(a, b) {
    if (a.priority !== b.priority)
        return a.priority - b.priority;
    if (a.enqueuedAt !== b.enqueuedAt)
        return a.enqueuedAt < b.enqueuedAt ? -1 : 1;
    return compareBytes(a.id, b.id);
}
function matchesQuery(record, query) {
    if (query.app && !(record.appId || record.workflowId || "").toLowerCase().includes(query.app))
        return false;
    if (query.status && record.lifecycle !== query.status && record.derivedLifecycle !== query.status)
        return false;
    if (query.repo && path.resolve(record.repo) !== query.repo)
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
            record.inputsDigest,
        ]
            .filter(Boolean)
            .join(" ")
            .toLowerCase();
        if (!haystack.includes(query.text))
            return false;
    }
    return true;
}
const DIGEST_PRIORITY_KEYS = ["question", "prompt", "task", "summary", "title", "objective", "focus", "topic"];
function distinctBackends(run) {
    const backends = new Set();
    for (const dispatch of run.dispatches || []) {
        if (dispatch.backendId)
            backends.add(dispatch.backendId);
    }
    for (const task of run.tasks || []) {
        if (task.backendId)
            backends.add(task.backendId);
    }
    return [...backends].sort();
}
function digestInputs(inputs) {
    if (!inputs || typeof inputs !== "object")
        return undefined;
    const keys = Object.keys(inputs);
    const ordered = [
        ...DIGEST_PRIORITY_KEYS.filter((k) => keys.includes(k)),
        ...keys.filter((k) => !DIGEST_PRIORITY_KEYS.includes(k)).sort(),
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
        archived: 0,
        reclaimed: 0,
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
    return (typeof value === "string" &&
        ["queued", "running", "blocked", "completed", "failed", "archived", "reclaimed"].includes(value));
}
/** Read a run dir's `reclaimed.json` overlay. Fail-OPEN to an empty chain
 *  on absence/corruption — a malformed overlay must never brick the run
 *  (SPEC/scheduling-registry.md "Rebuild risks" #1). */
function loadReclaimedFromDir(runDir) {
    const file = path.join(runDir, "reclaimed.json");
    if (!fs.existsSync(file))
        return { schemaVersion: 1, runId: "", tombstones: [] };
    try {
        const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
        if (!parsed || typeof parsed !== "object" || parsed.schemaVersion !== 1 || !Array.isArray(parsed.tombstones)) {
            return { schemaVersion: 1, runId: "", tombstones: [] };
        }
        return { schemaVersion: 1, runId: String(parsed.runId || ""), tombstones: parsed.tombstones };
    }
    catch {
        return { schemaVersion: 1, runId: "", tombstones: [] };
    }
}
function fingerprintRun(run) {
    const parts = [
        `id:${run.id}`,
        `updatedAt:${run.updatedAt}`,
        `loopStage:${run.loopStage}`,
        `schema:${run.schemaVersion}`,
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
    return (0, hash_1.fingerprintStrings)(parts);
}
/** Classify a run's lifecycle purely from its source state. First match
 *  wins, per SPEC/scheduling-registry.md section C. */
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
        loopStage: run.loopStage,
    };
}
// ---------------------------------------------------------------------------
// Home registry location
// ---------------------------------------------------------------------------
/** Resolve the home registry root: CW_HOME, then XDG_STATE_HOME/
 *  cool-workflow, then ~/.local/state/cool-workflow. */
function resolveCwHome(env = process.env) {
    if (env.CW_HOME && String(env.CW_HOME).trim())
        return path.resolve(String(env.CW_HOME));
    if (env.XDG_STATE_HOME && String(env.XDG_STATE_HOME).trim()) {
        return path.join(path.resolve(String(env.XDG_STATE_HOME)), "cool-workflow");
    }
    return path.join(os.homedir(), ".local", "state", "cool-workflow");
}
function requireOverlayObject(parsed, file) {
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        throw new Error(`Corrupt overlay ${file}: expected a JSON object, got ${Array.isArray(parsed) ? "array" : parsed === null ? "null" : typeof parsed}`);
    }
    return parsed;
}
// ---------------------------------------------------------------------------
// The registry
// ---------------------------------------------------------------------------
class RunRegistry {
    repoRoot;
    homeRoot;
    planner;
    constructor(cwd = process.cwd(), planner, env = process.env) {
        this.repoRoot = path.resolve(cwd);
        this.homeRoot = resolveCwHome(env);
        this.planner = planner;
    }
    repoRunsDir(repo) {
        return path.join(repo, ".cw", "runs");
    }
    repoRegistryDir(repo) {
        return path.join(repo, ".cw", "registry");
    }
    homeRegistryDir() {
        return path.join(this.homeRoot, "registry");
    }
    loadArchiveOverlay(repo) {
        const file = path.join(this.repoRegistryDir(repo), "archive.json");
        if (!fs.existsSync(file))
            return { schemaVersion: 1, archived: {} };
        const parsed = requireOverlayObject((0, fs_atomic_1.readJson)(file), file);
        return { schemaVersion: 1, archived: parsed.archived || {} };
    }
    loadProvenanceOverlay(repo) {
        const file = path.join(this.repoRegistryDir(repo), "provenance.json");
        if (!fs.existsSync(file))
            return { schemaVersion: 1, links: {} };
        const parsed = requireOverlayObject((0, fs_atomic_1.readJson)(file), file);
        return { schemaVersion: 1, links: parsed.links || {} };
    }
    loadRepoOverlays(repo) {
        return { archive: this.loadArchiveOverlay(repo), provenance: this.loadProvenanceOverlay(repo) };
    }
    get defaultQueuePriority() {
        return exports.DEFAULT_RUN_REGISTRY_POLICY.defaultQueuePriority;
    }
    reposFilePath() {
        return path.join(this.homeRegistryDir(), "repos.json");
    }
    loadRepos() {
        const file = this.reposFilePath();
        if (!fs.existsSync(file))
            return { schemaVersion: 1, repos: [] };
        const parsed = requireOverlayObject((0, fs_atomic_1.readJson)(file), file);
        return { schemaVersion: 1, repos: Array.isArray(parsed.repos) ? parsed.repos : [] };
    }
    knownRepos() {
        const roots = new Set([this.repoRoot]);
        for (const entry of this.loadRepos().repos)
            roots.add(path.resolve(entry.root));
        return [...roots].sort();
    }
    registerRepo(repo = this.repoRoot) {
        const resolved = path.resolve(repo);
        const file = this.reposFilePath();
        return (0, fs_atomic_1.withFileLock)(file, () => {
            const current = this.loadRepos();
            const already = current.repos.some((entry) => path.resolve(entry.root) === resolved);
            if (!already)
                current.repos.push({ root: resolved, addedAt: new Date().toISOString() });
            current.repos.sort((a, b) => compareBytes(a.root, b.root));
            (0, fs_atomic_1.writeJson)(file, current, { durable: true });
            return { registered: !already, repos: current.repos.map((entry) => entry.root) };
        });
    }
    // ---- queue file (durable, ordered; drained by the host) ----------------
    queueFilePath() {
        return path.join(this.homeRegistryDir(), "queue.json");
    }
    loadQueueEntries() {
        const file = this.queueFilePath();
        if (!fs.existsSync(file))
            return [];
        const parsed = (0, fs_atomic_1.readJson)(file);
        return Array.isArray(parsed.entries) ? parsed.entries : [];
    }
    saveQueueEntries(entries) {
        (0, fs_atomic_1.writeJson)(this.queueFilePath(), { schemaVersion: 1, entries }, { durable: true });
    }
    schedulingPolicyPath() {
        return path.join(this.homeRegistryDir(), "scheduling-policy.json");
    }
    queueAdd(options = {}) {
        const repo = options.repo ? path.resolve(options.repo) : this.repoRoot;
        return (0, fs_atomic_1.withFileLock)(this.queueFilePath(), () => {
            const entries = this.loadQueueEntries();
            const entry = {
                schemaVersion: 1,
                id: options.id || queueId(),
                runId: options.runId,
                appId: options.appId,
                workflowId: options.workflowId,
                repo,
                priority: Number.isFinite(options.priority) ? Number(options.priority) : this.defaultQueuePriority,
                enqueuedAt: new Date().toISOString(),
                status: "pending",
                inputs: options.inputs,
                note: options.note,
            };
            entries.push(entry);
            this.registerRepo(repo);
            this.saveQueueEntries(entries);
            return entry;
        });
    }
    queueList(options = {}) {
        let entries = this.loadQueueEntries();
        if (options.status)
            entries = entries.filter((e) => e.status === options.status);
        if (options.repo) {
            const repo = path.resolve(options.repo);
            entries = entries.filter((e) => path.resolve(e.repo) === repo);
        }
        entries = [...entries].sort(compareQueue);
        return { schemaVersion: 1, total: entries.length, entries };
    }
    queueShow(id) {
        const entry = this.loadQueueEntries().find((e) => e.id === id);
        if (!entry)
            throw new Error(`Queue entry not found: ${id}`);
        return entry;
    }
    queueDrain(options = {}) {
        const limit = clampInt(options.limit, 1, 1);
        const repoFilter = options.repo ? path.resolve(options.repo) : undefined;
        return (0, fs_atomic_1.withFileLock)(this.queueFilePath(), () => {
            const entries = this.loadQueueEntries();
            const drainable = entries
                .filter((e) => e.status === "pending" || e.status === "ready")
                .filter((e) => !repoFilter || path.resolve(e.repo) === repoFilter)
                .sort(compareQueue);
            const drained = [];
            const drainedAt = new Date().toISOString();
            for (const entry of drainable.slice(0, limit)) {
                entry.status = "drained";
                entry.drainedAt = drainedAt;
                drained.push(entry);
            }
            this.saveQueueEntries(entries);
            const remaining = entries.filter((e) => e.status === "pending" || e.status === "ready").length;
            return { schemaVersion: 1, drained, remaining };
        });
    }
    // ---- record derivation (always from source) -----------------------------
    deriveRecord(repo, runDir, overlays = this.loadRepoOverlays(repo)) {
        const statePath = path.join(runDir, "state.json");
        if (!fs.existsSync(statePath))
            return null;
        let run;
        try {
            const result = (0, run_store_1.loadRunStateFile)(statePath, { dryRun: true });
            if (result.report.status === "unsupported")
                return null;
            // Bulk scans (refreshRegistry, below) call deriveRecord directly and
            // tolerate a null the same way as missing/unsupported — one bad run
            // must not stop a listing of everything else. Single-run lookups
            // (deriveRecordForRun, below) re-check this same condition WITHOUT
            // swallowing it, so `cw run show`/`archive`/`rerun` on THIS run
            // specifically get a clear reason instead of a misleading "not found."
            (0, run_store_1.assertNotSuspectedDataLoss)(path.basename(runDir), result);
            run = result.run;
        }
        catch {
            return null;
        }
        const li = lifecycleInputs(run);
        const derived = deriveLifecycle(li);
        const archive = overlays.archive.archived[run.id];
        const provenance = overlays.provenance.links[run.id];
        const reclaim = loadReclaimedFromDir(runDir);
        const lastTombstone = reclaim.tombstones[reclaim.tombstones.length - 1];
        const tier = lastTombstone ? "reclaimed" : archive ? "archived" : "live";
        const capability = lastTombstone ? lastTombstone.capability : "re-runnable";
        const capabilityReason = lastTombstone
            ? lastTombstone.capabilityReason
            : archive
                ? "archived-full"
                : "live-full";
        const appMeta = run.workflow.app;
        return {
            schemaVersion: 1,
            runId: run.id,
            appId: appMeta?.id,
            appVersion: appMeta?.version,
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
            tasks: { total: li.total, pending: li.pending, running: li.running, failed: li.failed, completed: li.completed },
            commitCount: (run.commits || []).length,
            verifierGatedCommitCount: li.verifierGatedCommits,
            openFeedbackCount: li.openFeedback,
            backends: distinctBackends(run),
            inputsDigest: digestInputs(run.inputs),
            sourceFingerprint: fingerprintRun(run),
            freshness: "valid",
            provenance,
        };
    }
    scanRepo(repo) {
        const runsDir = this.repoRunsDir(repo);
        if (!fs.existsSync(runsDir))
            return [];
        const overlays = this.loadRepoOverlays(repo);
        const records = [];
        for (const entry of fs.readdirSync(runsDir, { withFileTypes: true })) {
            if (!entry.isDirectory())
                continue;
            const record = this.deriveRecord(repo, path.join(runsDir, entry.name), overlays);
            if (record)
                records.push(record);
        }
        return records.sort(compareRecords);
    }
    buildIndex(scope) {
        const repos = scope === "home" ? this.knownRepos() : [this.repoRoot];
        const records = [];
        for (const repo of repos)
            records.push(...this.scanRepo(repo));
        records.sort(compareRecords);
        const queue = scope === "home" ? this.loadQueueEntries() : this.loadQueueEntries().filter((q) => path.resolve(q.repo) === this.repoRoot);
        const sourceFingerprint = (0, hash_1.fingerprintStrings)([
            ...repos.map((r) => `repo:${r}`),
            ...records.map((r) => `${r.runId}:${r.sourceFingerprint}:${r.lifecycle}`),
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
            counts: countRecords(records),
        };
    }
    persistedIndexPath(scope) {
        return scope === "home" ? path.join(this.homeRegistryDir(), "index.json") : path.join(this.repoRegistryDir(this.repoRoot), "index.json");
    }
    /** Fail-OPEN on a corrupt persisted index.json (rebuildable cache):
     *  returns undefined rather than throwing, per SPEC's asymmetric rule. */
    loadPersistedIndex(scope) {
        const file = this.persistedIndexPath(scope);
        if (!fs.existsSync(file))
            return undefined;
        try {
            const parsed = (0, fs_atomic_1.readJson)(file);
            if (!parsed || parsed.schemaVersion !== 1)
                return undefined;
            return parsed;
        }
        catch {
            return undefined;
        }
    }
    refresh(options = {}) {
        const scope = options.scope || "repo";
        this.registerRepo(this.repoRoot);
        const index = this.buildIndex(scope);
        (0, fs_atomic_1.writeJson)(this.persistedIndexPath(scope), index);
        if (scope === "repo") {
            const homeIndex = this.buildIndex("home");
            (0, fs_atomic_1.writeJson)(this.persistedIndexPath("home"), homeIndex);
        }
        return this.report(scope, index);
    }
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
        const refreshCmd = scope === "home" ? "cw registry refresh --scope home" : "cw registry refresh";
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
                missingRuns: missingRuns.sort(),
            },
            index: current,
            counts: current.counts,
            nextAction: status === "valid" ? "cw run search" : refreshCmd,
        };
    }
    search(raw = {}) {
        const scope = raw.scope || "home";
        const index = this.buildIndex(scope);
        const report = this.report(scope, index);
        const query = {
            text: optionalLower(raw.text),
            app: optionalLower(raw.app),
            status: raw.status,
            repo: raw.repo ? path.resolve(raw.repo) : undefined,
            since: raw.since,
            until: raw.until,
            includeArchived: raw.includeArchived ?? true,
            offset: clampInt(raw.offset, 0, 0),
            limit: clampInt(raw.limit, 50, 1),
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
            nextAction: report.freshness.status === "valid" ? "cw run show <run-id>" : "cw registry refresh",
        };
    }
    list(options = {}) {
        return this.search({
            scope: options.scope || "home",
            includeArchived: options.includeArchived ?? true,
            limit: options.limit,
            offset: options.offset,
        });
    }
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
                nextAction: located.record.archived ? "cw run resume " + runId : "cw run show " + runId,
            };
        }
        const persisted = this.findPersisted(runId, scope);
        return {
            schemaVersion: 1,
            runId,
            found: false,
            freshness: "missing",
            repo: persisted?.repo,
            persisted,
            nextAction: "cw registry refresh" + (scope === "home" ? " --scope home" : ""),
        };
    }
    locate(runId, scope) {
        (0, fs_atomic_1.assertSafeRunId)(runId);
        const here = this.deriveRecordForRun(this.repoRoot, runId);
        if (here)
            return { record: here, from: "repo" };
        if (scope === "repo")
            return undefined;
        for (const repo of this.knownRepos()) {
            if (path.resolve(repo) === this.repoRoot)
                continue;
            const record = this.deriveRecordForRun(repo, runId);
            if (record)
                return { record, from: "home" };
        }
        return undefined;
    }
    deriveRecordForRun(repo, runId) {
        const runDir = path.join(this.repoRunsDir(repo), runId);
        const statePath = path.join(runDir, "state.json");
        if (!fs.existsSync(statePath))
            return null;
        const record = this.deriveRecord(repo, runDir);
        if (record)
            return record;
        // deriveRecord returned null even though state.json existed a moment
        // ago: it failed to parse, was flagged unsupported, tripped
        // suspected-data-loss corroboration, or (a narrow race) a concurrent
        // process deleted it in between. Re-derive without swallowing so a
        // genuine corruption reaches THIS single-run lookup (backing `cw run
        // show`/`archive`/`rerun`) instead of the misleading "not found" a bulk
        // scan is content with — but if the file is ACTUALLY gone by the time
        // we check again, that is genuinely missing, not corrupt, and must
        // resolve to null like everywhere else, never a raw "File not found"
        // exception surfacing from this fallback re-read.
        try {
            const result = (0, run_store_1.loadRunStateFile)(statePath, { dryRun: true });
            if (result.report.status === "unsupported") {
                throw new Error(`Run state for ${runId} is corrupt (fail closed): ${result.report.errors.join("; ") || "unsupported run state"}. Restore ${statePath} from a backup, or remove the run directory to start over.`);
            }
            (0, run_store_1.assertNotSuspectedDataLoss)(runId, result);
            return record;
        }
        catch (error) {
            if (!fs.existsSync(statePath))
                return null;
            throw error;
        }
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
        (0, fs_atomic_1.assertSafeRunId)(runId);
        const statePath = path.join(this.repoRunsDir(repo), runId, "state.json");
        if (!fs.existsSync(statePath))
            throw new Error(`Run not found: ${runId}`);
        const result = (0, run_store_1.loadRunStateFile)(statePath, { dryRun: true });
        if (result.report.status === "unsupported") {
            throw new Error(`Unsupported run state for ${runId}: ${result.report.errors.join("; ")}`);
        }
        (0, run_store_1.assertNotSuspectedDataLoss)(runId, result);
        return result.run;
    }
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
                command: `cw dispatch ${runId} --cwd ${record.repo}`,
                reason: `Continue ${nextTasks.length} pending/running task(s) from durable state.`,
            });
            nextActions.push({
                command: `cw multi-agent step ${runId} --cwd ${record.repo}`,
                reason: "Take one deterministic host step without spawning agents.",
            });
        }
        else if (record.derivedLifecycle === "failed") {
            nextActions.push({
                command: `cw run rerun ${runId}`,
                reason: "Run terminated as failed with no runnable tasks; rerun as a new linked run.",
            });
        }
        else {
            nextActions.push({
                command: `cw status ${runId} --cwd ${record.repo} --json`,
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
            nextActions,
        };
    }
    archive(runId, options = {}) {
        const scope = options.scope || "home";
        const located = this.locate(runId, scope);
        if (!located)
            throw new Error(`Cannot archive: run ${runId} not found in source state (fail closed).`);
        const repo = located.record.repo;
        const file = path.join(this.repoRegistryDir(repo), "archive.json");
        (0, fs_atomic_1.withFileLock)(file, () => {
            const overlay = this.loadArchiveOverlay(repo);
            if (options.unarchive) {
                delete overlay.archived[runId];
            }
            else {
                overlay.archived[runId] = { archivedAt: new Date().toISOString(), reason: options.reason };
            }
            (0, fs_atomic_1.writeJson)(file, overlay, { durable: true });
        });
        // deriveRecordForRun (not a bare deriveRecord(...)!) so a run that
        // became corrupt/unsupported/suspected-data-loss in the narrow window
        // between locate() above and this re-fetch gets the same clear,
        // specific error every other single-run lookup gets, instead of a raw
        // TypeError from a non-null assertion on a surprise null.
        const record = this.deriveRecordForRun(repo, runId);
        if (!record)
            throw new Error(`Cannot archive: run ${runId} state became unavailable while archiving (fail closed).`);
        return {
            runId,
            repo,
            archived: record.archived,
            archivedAt: record.archivedAt,
            reason: record.archiveReason,
            record,
            overlayPath: file,
        };
    }
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
    rerun(runId, options = {}) {
        if (!this.planner)
            throw new Error("rerun requires a run planner (CoolWorkflowRunner)");
        const scope = options.scope || "home";
        const located = this.locate(runId, scope);
        if (!located)
            throw new Error(`Cannot rerun: run ${runId} not found in source state (fail closed).`);
        const original = located.record;
        const originalRun = this.loadRun(original.repo, runId);
        const appMeta = originalRun.workflow.app;
        const appId = appMeta?.id || originalRun.workflow.id;
        const inputs = { ...(originalRun.inputs || {}), cwd: original.repo, repo: original.repo };
        const newRun = this.planner.plan(appId, inputs);
        const priorProv = original.provenance;
        const provenance = {
            rerunOf: runId,
            rerunOfRepo: original.repo,
            originRunId: priorProv?.originRunId || runId,
            generation: (priorProv?.generation || 0) + 1,
            reason: options.reason || "rerun of failed run",
            createdAt: new Date().toISOString(),
        };
        const provFile = path.join(this.repoRegistryDir(original.repo), "provenance.json");
        (0, fs_atomic_1.withFileLock)(provFile, () => {
            const provOverlay = this.loadProvenanceOverlay(original.repo);
            provOverlay.links[newRun.id] = provenance;
            (0, fs_atomic_1.writeJson)(provFile, provOverlay, { durable: true });
        });
        const newAppMeta = newRun.workflow.app;
        return {
            schemaVersion: 1,
            originalRunId: runId,
            originalRepo: original.repo,
            originalLifecycle: original.lifecycle,
            newRunId: newRun.id,
            repo: original.repo,
            appId: newAppMeta?.id || appId,
            workflowId: newRun.workflow.id,
            statePath: newRun.paths.state,
            reportPath: newRun.paths.report,
            pendingTasks: newRun.tasks.filter((t) => t.status === "pending").length,
            provenance,
            nextActions: [
                { command: `cw run resume ${newRun.id}`, reason: "Continue the new linked run." },
                { command: `cw run show ${runId}`, reason: "The original failed run is preserved for audit." },
            ],
        };
    }
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
            provenance: r.provenance,
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
            nextAction: report.freshness.status === "valid" ? "cw run show <run-id>" : "cw registry refresh --scope home",
        };
    }
}
exports.RunRegistry = RunRegistry;
// ---------------------------------------------------------------------------
// Human formatting (CLI-only; never affects --json/MCP payloads)
// ---------------------------------------------------------------------------
function humanBytes(n) {
    if (n < 1024)
        return `${n}B`;
    const units = ["KiB", "MiB", "GiB"];
    let v = n / 1024;
    let i = 0;
    while (v >= 1024 && i < units.length - 1) {
        v /= 1024;
        i += 1;
    }
    return `${v.toFixed(1)}${units[i]}`;
}
function countsLine(counts) {
    return `total=${counts.total} queued=${counts.queued} running=${counts.running} blocked=${counts.blocked} completed=${counts.completed} failed=${counts.failed} archived=${counts.archived} reclaimed=${counts.reclaimed}`;
}
function recordLine(record) {
    const flags = [record.archived ? "archived" : "", record.provenance?.rerunOf ? `rerunOf=${record.provenance.rerunOf}` : ""]
        .filter(Boolean)
        .join(" ");
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
        `  commits=${r.commitCount} (verifier-gated=${r.verifierGatedCommitCount}) openFeedback=${r.openFeedbackCount}`,
    ];
    if (r.provenance?.rerunOf)
        lines.push(`  provenance: rerunOf=${r.provenance.rerunOf} gen=${r.provenance.generation} origin=${r.provenance.originRunId}`);
    if (r.tier && r.tier !== "live") {
        lines.push(`  tier=${r.tier} capability=${r.capability} reason=${r.capabilityReason}${r.reclaimedBytes ? ` bytesFreed=${r.reclaimedBytes}` : ""}${r.tombstoneHash ? ` tombstone=${r.tombstoneHash.slice(0, 19)}` : ""}`);
    }
    return lines.join("\n");
}
function formatResume(result) {
    const lines = [
        `Resume ${result.runId} [${result.lifecycle}] loopStage=${result.loopStage} (resolved from ${result.resolvedFrom}, ${result.freshness})`,
        `  resumable=${result.resumable} nextTasks=${result.nextTasks.length}`,
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
