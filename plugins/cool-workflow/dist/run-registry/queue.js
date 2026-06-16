"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.queueFilePath = queueFilePath;
exports.loadQueue = loadQueue;
exports.saveQueue = saveQueue;
exports.queueAdd = queueAdd;
exports.queueList = queueList;
exports.queueShow = queueShow;
exports.queueDrain = queueDrain;
// Durable run-queue operations for the run registry (FreeBSD-audit R2 deep).
// Carved out of run-registry.ts so the RunRegistry class no longer bundles the
// stateful queue cluster; the class keeps the public methods as thin delegators.
//
// BEHAVIOR-PRESERVING — pure code movement, zero logic change. Each function
// takes a `QueueHost` (the registry, narrowed to exactly the file-access +
// repo-registration helpers the queue needs) so it stays a function of its
// inputs, matching the existing router pattern (orchestrator/*-operations.ts,
// run-registry/derive.ts + format.ts).
//
// The queue file lives beside the other home-registry plain files (EXPLICIT,
// INSPECTABLE STATE): readable, diffable, no hidden database. Cross-process
// read-modify-write is locked (v0.1.40, P1-D) so a concurrent add/drain can
// never drop or double-drain an entry.
const node_path_1 = __importDefault(require("node:path"));
const node_fs_1 = __importDefault(require("node:fs"));
const state_1 = require("../state");
const derive_1 = require("./derive");
function queueFilePath(host) {
    return node_path_1.default.join(host.homeRegistryDir(), "queue.json");
}
function loadQueue(host) {
    const file = queueFilePath(host);
    // Absent => empty queue. A present-but-corrupt queue must FAIL CLOSED rather
    // than read as empty: silently draining to [] would lose every queued run and
    // let scheduling/lease ops proceed as if the store were clean. readJson throws
    // `Invalid JSON in <file>` on a present, unparseable store; let it propagate.
    if (!node_fs_1.default.existsSync(file))
        return [];
    const parsed = (0, state_1.readJson)(file);
    return Array.isArray(parsed.entries) ? parsed.entries : [];
}
function saveQueue(host, entries) {
    (0, state_1.writeJson)(queueFilePath(host), { schemaVersion: 1, entries }, { durable: true });
}
function queueAdd(host, options = {}) {
    const repo = options.repo ? node_path_1.default.resolve(options.repo) : host.repoRoot;
    // Cross-process read-modify-write on the home queue: lock so a concurrently
    // added task can never vanish (v0.1.40, P1-D).
    return (0, state_1.withFileLock)(queueFilePath(host), () => {
        const entries = loadQueue(host);
        const entry = {
            schemaVersion: 1,
            id: options.id || (0, derive_1.queueId)(),
            runId: options.runId,
            appId: options.appId,
            workflowId: options.workflowId,
            repo,
            priority: Number.isFinite(options.priority) ? Number(options.priority) : host.defaultQueuePriority,
            enqueuedAt: new Date().toISOString(),
            status: "pending",
            inputs: options.inputs,
            note: options.note
        };
        entries.push(entry);
        host.registerRepo(repo);
        saveQueue(host, entries);
        return entry;
    });
}
function queueList(host, options = {}) {
    let entries = loadQueue(host);
    if (options.status)
        entries = entries.filter((e) => e.status === options.status);
    if (options.repo) {
        const repo = node_path_1.default.resolve(options.repo);
        entries = entries.filter((e) => node_path_1.default.resolve(e.repo) === repo);
    }
    entries = [...entries].sort(derive_1.compareQueue);
    return { schemaVersion: 1, total: entries.length, entries };
}
function queueShow(host, id) {
    const entry = loadQueue(host).find((e) => e.id === id);
    if (!entry)
        throw new Error(`Queue entry not found: ${id}`);
    return entry;
}
/** Drain the next N ready/pending entries in policy order, marking them drained.
 *  CW records readiness/order; the HOST still executes the workers. */
function queueDrain(host, options = {}) {
    const limit = (0, derive_1.clampInt)(options.limit, 1, 1);
    const repoFilter = options.repo ? node_path_1.default.resolve(options.repo) : undefined;
    // Lock the drain RMW so two hosts can never double-drain the same entry
    // (v0.1.40, P1-D — the scheduling kernel's concurrency ceiling now holds
    // across processes, not just within one).
    return (0, state_1.withFileLock)(queueFilePath(host), () => {
        const entries = loadQueue(host);
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
        saveQueue(host, entries);
        const remaining = entries.filter((e) => e.status === "pending" || e.status === "ready").length;
        return { schemaVersion: 1, drained, remaining };
    });
}
