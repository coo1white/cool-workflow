"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.LIFECYCLE_STATES = void 0;
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
// Pure, stateless helpers for the run registry — comparison, query matching,
// input digesting, counting, and small utilities. Carved out of run-registry.ts
// (FreeBSD-audit R2) so the stateful RunRegistry class no longer bundles the pure
// derivation layer. Nothing here touches `this`; everything is a pure function of
// its arguments (queueId is the lone exception — a process-local counter, kept as
// it was; making ID minting deterministic is a separate tracked item).
const node_fs_1 = __importDefault(require("node:fs"));
const node_path_1 = __importDefault(require("node:path"));
exports.LIFECYCLE_STATES = [
    "queued",
    "running",
    "blocked",
    "completed",
    "failed",
    "archived",
    "reclaimed"
];
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
/** Distinct execution backends used by a run's dispatches/tasks, recomputed from
 *  source state. Sorted; empty for pre-v0.1.29 / default-only runs that never
 *  recorded a backend. The registry stays backend-agnostic — this is metadata. */
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
        archived: 0,
        reclaimed: 0
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
    return typeof value === "string" && exports.LIFECYCLE_STATES.includes(value);
}
/** Read a run dir's `reclaimed.json` overlay (v0.1.39). Fail-closed to an empty
 *  chain on absence/corruption — a malformed overlay must never brick the run. */
function loadReclaimedFromDir(runDir) {
    const file = node_path_1.default.join(runDir, "reclaimed.json");
    if (!node_fs_1.default.existsSync(file))
        return { schemaVersion: 1, runId: "", tombstones: [] };
    try {
        const parsed = JSON.parse(node_fs_1.default.readFileSync(file, "utf8"));
        return { schemaVersion: 1, runId: parsed.runId || "", tombstones: Array.isArray(parsed.tombstones) ? parsed.tombstones : [] };
    }
    catch {
        return { schemaVersion: 1, runId: "", tombstones: [] };
    }
}
