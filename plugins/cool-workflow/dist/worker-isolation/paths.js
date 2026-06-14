"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.WORKER_MANIFEST_FILE = exports.WORKER_SCOPE_FILE = void 0;
exports.manifestPath = manifestPath;
exports.workerScopePath = workerScopePath;
exports.workerArtifacts = workerArtifacts;
exports.createWorkerId = createWorkerId;
// Path, artifact, and id derivation for worker isolation. Pure functions of a
// WorkerScope (or run + taskId) — no run-state mutation, no disk I/O. Carved out
// of worker-isolation.ts following the established router pattern
// (run-registry/{format,policy}.ts, orchestrator/*-operations.ts).
//
// BEHAVIOR-PRESERVING — pure code movement, zero logic change. Re-exported from
// worker-isolation.ts so the public surface is byte-unchanged.
const node_path_1 = __importDefault(require("node:path"));
const state_1 = require("../state");
exports.WORKER_SCOPE_FILE = "worker.json";
exports.WORKER_MANIFEST_FILE = "manifest.json";
function manifestPath(scope) {
    return node_path_1.default.join(scope.workerDir, exports.WORKER_MANIFEST_FILE);
}
function workerScopePath(scope) {
    return node_path_1.default.join(scope.workerDir, exports.WORKER_SCOPE_FILE);
}
function workerArtifacts(scope) {
    return [
        { id: "worker", kind: "json", path: workerScopePath(scope) },
        { id: "worker-manifest", kind: "json", path: manifestPath(scope) },
        { id: "worker-input", kind: "markdown", path: scope.inputPath }
    ];
}
// Deterministic worker id (v0.1.40 self-audit P2): a wall-clock stamp + Math.random()
// made every dispatch mint a different id, so audit references were not reproducible
// across re-runs of the same inputs. The id is now derived from the task plus a
// per-task sequence (count of worker scopes already allocated for that task + 1),
// so re-running the same workflow yields byte-identical worker ids while retries of
// the SAME task still get a fresh, unique id. (workerId is excluded from the
// snapshot source fingerprint, so this does not change replay digests.)
function createWorkerId(run, taskId) {
    const prefix = `worker-${(0, state_1.safeFileName)(taskId)}-`;
    const seq = (run.workers || []).filter((scope) => scope.id.startsWith(prefix)).length + 1;
    return `${prefix}${String(seq).padStart(4, "0")}`;
}
