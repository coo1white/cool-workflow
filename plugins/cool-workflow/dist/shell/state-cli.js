"use strict";
// shell/state-cli.ts — CLI/MCP-reachable bodies for the state-kernel
// capability rows (state.check, migration.list|check|prove, node.list|
// show|graph|snapshot|diff|replay|replay.verify, contract.show).
//
// MILESTONE 3. Byte-exact port of the old build's checkState (src/
// orchestrator/lifecycle-operations.ts:428-435), migrationList/Check/Prove
// (src/orchestrator/migration-operations.ts), and the node.* runner
// methods (src/orchestrator.ts:387-397,570-587). Impure (fs) — this is the
// shell layer the capability-table's CLI/MCP handlers delegate to; the
// decision logic itself lives in core/state/*.
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
exports.checkState = checkState;
exports.migrationList = migrationList;
exports.migrationCheck = migrationCheck;
exports.migrationProve = migrationProve;
exports.nextCli = nextCli;
exports.listNodes = listNodes;
exports.getRunNode = getRunNode;
exports.showNode = showNode;
exports.graphNodes = graphNodes;
exports.nodeSnapshotCli = nodeSnapshotCli;
exports.nodeDiffCli = nodeDiffCli;
exports.nodeReplayCli = nodeReplayCli;
exports.nodeReplayVerifyCli = nodeReplayVerifyCli;
exports.optionalStringArg = optionalStringArg;
const fs = __importStar(require("node:fs"));
const path = __importStar(require("node:path"));
const fs_atomic_1 = require("./fs-atomic");
const run_store_1 = require("./run-store");
const node_store_1 = require("./node-store");
const contract_migration_1 = require("../core/state/contract-migration");
const node_snapshot_1 = require("../core/state/node-snapshot");
const dispatch_1 = require("../core/pipeline/dispatch");
function optionalStringArg(value) {
    return typeof value === "string" && value.trim() ? value.trim() : undefined;
}
function resolveCwd(options) {
    return path.resolve(String(options.cwd || process.cwd()));
}
// ---------------------------------------------------------------------
// state.check
// ---------------------------------------------------------------------
/** `cw state check <run-id> [--state PATH] [--write] [--cwd PATH]`. */
function checkState(runId, options = {}) {
    const cwd = resolveCwd(options);
    const statePath = options.state ? path.resolve(String(options.state)) : path.join(cwd, ".cw", "runs", runId, "state.json");
    const result = (0, run_store_1.migrateRunStateFile)(statePath, { write: Boolean(options.write) });
    return result.report;
}
// ---------------------------------------------------------------------
// migration.list | migration.check | migration.prove
// ---------------------------------------------------------------------
function migrationList() {
    return { contracts: (0, contract_migration_1.listMigrationContracts)() };
}
/** Resolves `target` to an existing file (absolute/relative to
 *  `process.cwd()`, NOT the `--cwd` option — matches the old build's
 *  `loadMigrationSnapshot` literally) else `<cwd>/.cw/runs/<target>/
 *  state.json`. Throws `Migration target not found: <target>` when
 *  neither exists. */
function loadMigrationSnapshot(target, options) {
    const contract = options.contract === "workflow-app" ? "workflow-app" : "run-state";
    const file = fs.existsSync(target) && fs.statSync(target).isFile()
        ? path.resolve(target)
        : path.join(process.cwd(), ".cw", "runs", target, "state.json");
    if (!fs.existsSync(file))
        throw new Error(`Migration target not found: ${target}`);
    return { snapshot: (0, fs_atomic_1.readJson)(file), contract, dir: path.dirname(file) };
}
function migrationCheck(target, options = {}) {
    const { snapshot, contract } = loadMigrationSnapshot(target, options);
    return (0, contract_migration_1.checkMigration)(contract, snapshot);
}
/** Appends the proof beside the target (NEVER overwriting source) under
 *  `<targetDir>/migration/<first 16 hex of fingerprint>.json`; a
 *  read-only target still returns the proof (write failure is
 *  best-effort/swallowed). */
function migrationProve(target, options = {}) {
    const { snapshot, contract, dir } = loadMigrationSnapshot(target, options);
    const proof = (0, contract_migration_1.proveMigration)(contract, snapshot);
    try {
        (0, fs_atomic_1.writeJson)(path.join(dir, "migration", `${proof.fingerprint.replace("sha256:", "").slice(0, 16)}.json`), proof);
    }
    catch {
        /* read-only target — the proof is still returned */
    }
    return proof;
}
// ---------------------------------------------------------------------
// node.list | node.show | node.graph | node.snapshot | node.diff |
// node.replay | node.replay.verify
// ---------------------------------------------------------------------
function loadRun(runId, options = {}) {
    const cwd = options.cwd ? path.resolve(String(options.cwd)) : process.cwd();
    return (0, run_store_1.loadRunFromCwd)(runId, cwd);
}
function numberOption(value) {
    if (value === undefined || value === null || value === true)
        return undefined;
    const n = Number(value);
    return Number.isFinite(n) ? n : undefined;
}
/** `cw next <run-id> [--limit N]` — the read-only "what would dispatch next"
 *  preview: the runnable tasks the next `cw dispatch` would pick, in order,
 *  without mutating state. A byte-behavior port of the old build's
 *  orchestrator.next (nextDispatchTasks over the loaded run). Both the CLI and
 *  the cw_next MCP tool render this same DispatchTask[] value, so their
 *  payloads stay identical. */
function nextCli(runId, options = {}) {
    return (0, dispatch_1.nextDispatchTasks)(loadRun(runId, options), numberOption(options.limit));
}
function listNodes(runId, options = {}) {
    return loadRun(runId, options).nodes || [];
}
function getRunNode(run, nodeId) {
    const node = (run.nodes || []).find((candidate) => candidate.id === nodeId);
    if (!node)
        throw new Error(`Unknown state node for run ${run.id}: ${nodeId}`);
    return node;
}
function showNode(runId, nodeId, options = {}) {
    return getRunNode(loadRun(runId, options), nodeId);
}
function graphNodes(runId, options = {}) {
    return (loadRun(runId, options).nodes || []).map((node) => ({
        id: node.id,
        kind: node.kind,
        status: node.status,
        parents: node.parents,
        children: node.children,
    }));
}
function nodeSnapshotCli(runId, nodeId, options = {}) {
    return (0, node_store_1.snapshotNode)(loadRun(runId, options), nodeId, options);
}
function nodeDiffCli(runId, baselineSnapshotId, candidateSnapshotId, options = {}) {
    const run = loadRun(runId, options);
    return (0, node_snapshot_1.diffNodeSnapshots)((0, node_store_1.readNodeSnapshot)(run, baselineSnapshotId), (0, node_store_1.readNodeSnapshot)(run, candidateSnapshotId));
}
function nodeReplayCli(runId, snapshotId, options = {}) {
    const run = loadRun(runId, options);
    return (0, node_store_1.replayNodeSnapshot)(run, (0, node_store_1.readNodeSnapshot)(run, snapshotId), options);
}
function nodeReplayVerifyCli(runId, replayId, options = {}) {
    const run = loadRun(runId, options);
    return (0, node_snapshot_1.verifyNodeReplay)(run, (0, node_store_1.readNodeReplay)(run, replayId), options);
}
