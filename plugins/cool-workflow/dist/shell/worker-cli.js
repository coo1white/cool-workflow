"use strict";
// shell/worker-cli.ts — `cw worker list|show|manifest|output|fail|validate`
// (and the mirrored cw_worker_* MCP tools) handler bodies. Byte-exact behavior
// port of the old build's src/cli/handlers/worker.ts routing into the
// worker-isolation shell. Impure: loads run state, mutates, persists.
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
exports.workerListCli = workerListCli;
exports.workerShowCli = workerShowCli;
exports.workerManifestCli = workerManifestCli;
exports.workerOutputCli = workerOutputCli;
exports.workerFailCli = workerFailCli;
exports.workerValidateCli = workerValidateCli;
const path = __importStar(require("node:path"));
const run_store_1 = require("./run-store");
const worker_isolation_1 = require("./worker-isolation");
function cwdFor(args) {
    return typeof args.cwd === "string" && args.cwd.trim() ? path.resolve(args.cwd) : process.cwd();
}
function req(value, label) {
    const s = value === undefined || value === null ? "" : String(value);
    if (!s)
        throw new Error(`Missing ${label}`);
    return s;
}
function workerListCli(args) {
    const run = (0, run_store_1.loadRunFromCwd)(req(args.runId, "run id"), cwdFor(args));
    return (0, worker_isolation_1.listWorkerScopes)(run, { status: typeof args.status === "string" ? args.status : undefined });
}
function workerShowCli(args) {
    const run = (0, run_store_1.loadRunFromCwd)(req(args.runId, "run id"), cwdFor(args));
    const scope = (0, worker_isolation_1.getWorkerScope)(run, req(args.workerId, "worker id"));
    if (!scope)
        throw new Error(`Unknown worker for run ${run.id}: ${args.workerId}`);
    return scope;
}
function workerManifestCli(args) {
    const run = (0, run_store_1.loadRunFromCwd)(req(args.runId, "run id"), cwdFor(args));
    const scope = (0, worker_isolation_1.getWorkerScope)(run, req(args.workerId, "worker id"));
    if (!scope)
        throw new Error(`Unknown worker for run ${run.id}: ${args.workerId}`);
    const manifest = (0, worker_isolation_1.writeWorkerManifest)(run, scope);
    (0, run_store_1.saveCheckpoint)(run);
    return manifest;
}
/** Task-status rollup carried on the `cw worker output` payload — byte-behavior
 *  port of the old orchestrator recordWorkerOutput's summarizeRun.tasks. Callers
 *  (pdca/run-export) read output.tasks.completed. */
function taskCounts(run) {
    const tasks = run.tasks;
    return {
        total: tasks.length,
        pending: tasks.filter((t) => t.status === "pending").length,
        running: tasks.filter((t) => t.status === "running").length,
        failed: tasks.filter((t) => t.status === "failed").length,
        completed: tasks.filter((t) => t.status === "completed").length,
    };
}
function workerOutputCli(args) {
    const run = (0, run_store_1.loadRunFromCwd)(req(args.runId, "run id"), cwdFor(args));
    const result = (0, worker_isolation_1.recordWorkerOutput)(run, req(args.workerId, "worker id"), req(args.resultPath, "result file"), {});
    (0, run_store_1.saveCheckpoint)(run);
    return { ...result, tasks: taskCounts(run) };
}
function workerFailCli(args) {
    const run = (0, run_store_1.loadRunFromCwd)(req(args.runId, "run id"), cwdFor(args));
    const message = String(args.message || req(args.resultPath, "failure message"));
    const scope = (0, worker_isolation_1.recordWorkerFailure)(run, req(args.workerId, "worker id"), message, {
        code: typeof args.code === "string" ? args.code : undefined,
        path: typeof args.path === "string" ? args.path : undefined,
        retryable: args.retryable !== undefined ? Boolean(args.retryable) : undefined,
    });
    (0, run_store_1.saveCheckpoint)(run);
    return scope;
}
/** validate returns the boundary violation (null when the write path is
 *  allowed) and signals a violation through a non-zero exit code, not just
 *  stdout — a validate verb must report an invalid verdict via its exit code. */
function workerValidateCli(args) {
    const run = (0, run_store_1.loadRunFromCwd)(req(args.runId, "run id"), cwdFor(args));
    const target = args.path || args.resultPath;
    const violation = (0, worker_isolation_1.validateWorkerBoundary)(run, req(args.workerId, "worker id"), target ? { path: String(target) } : {});
    (0, run_store_1.saveCheckpoint)(run);
    return { violation, exitCode: violation ? 1 : undefined };
}
