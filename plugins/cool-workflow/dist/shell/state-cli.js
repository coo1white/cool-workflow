// shell/state-cli.ts — CLI/MCP-reachable bodies for the state-kernel
// capability rows (state.check, migration.list|check|prove, node.list|
// show|graph|snapshot|diff|replay|replay.verify, contract.show).
//
// Impure (fs) — this is the shell layer the capability-table's CLI/MCP
// handlers delegate to; the decision logic itself lives in core/state/*.
import * as fs from "node:fs";
import * as path from "node:path";
import { cwdArg, optionalArg } from "../core/util/cli-args.js";
import { readJson, writeJson } from "./fs-atomic.js";
import { loadRunFromCwd, migrateRunStateFile } from "./run-store.js";
import { readNodeSnapshot, readNodeReplay, snapshotNode, replayNodeSnapshot } from "./node-store.js";
import { checkMigration, listMigrationContracts, proveMigration, } from "../core/state/contract-migration.js";
import { diffNodeSnapshots, verifyNodeReplay } from "../core/state/node-snapshot.js";
import { nextDispatchTasks } from "../core/pipeline/dispatch.js";
import { getRunContract } from "../core/pipeline/runner.js";
import { requiredNumberFlag } from "../core/util/numeric-flag.js";
// ---------------------------------------------------------------------
// state.check
// ---------------------------------------------------------------------
/** `cw state check <run-id> [--state PATH] [--write] [--cwd PATH]`. */
export function checkState(runId, options = {}) {
    const cwd = cwdArg(options, ["cwd"], true);
    const statePath = options.state ? path.resolve(String(options.state)) : path.join(cwd, ".cw", "runs", runId, "state.json");
    const result = migrateRunStateFile(statePath, { write: Boolean(options.write) });
    return result.report;
}
// ---------------------------------------------------------------------
// migration.list | migration.check | migration.prove
// ---------------------------------------------------------------------
export function migrationList() {
    return { contracts: listMigrationContracts() };
}
/** Resolves `target` to an existing file (absolute/relative to
 *  `process.cwd()`, NOT the `--cwd` option) else `<cwd>/.cw/runs/<target>/
 *  state.json`. Throws `Migration target not found: <target>` when
 *  neither exists. */
function loadMigrationSnapshot(target, options) {
    const contract = options.contract === "workflow-app" ? "workflow-app" : "run-state";
    const file = fs.existsSync(target) && fs.statSync(target).isFile()
        ? path.resolve(target)
        : path.join(process.cwd(), ".cw", "runs", target, "state.json");
    if (!fs.existsSync(file))
        throw new Error(`Migration target not found: ${target}`);
    return { snapshot: readJson(file), contract, dir: path.dirname(file) };
}
export function migrationCheck(target, options = {}) {
    const { snapshot, contract } = loadMigrationSnapshot(target, options);
    return checkMigration(contract, snapshot);
}
/** Appends the proof beside the target (NEVER overwriting source) under
 *  `<targetDir>/migration/<first 16 hex of fingerprint>.json`; a
 *  read-only target still returns the proof (write failure is
 *  best-effort/swallowed). */
export function migrationProve(target, options = {}) {
    const { snapshot, contract, dir } = loadMigrationSnapshot(target, options);
    const proof = proveMigration(contract, snapshot);
    try {
        writeJson(path.join(dir, "migration", `${proof.fingerprint.replace("sha256:", "").slice(0, 16)}.json`), proof);
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
    const cwd = cwdArg(options, ["cwd"], true);
    return loadRunFromCwd(runId, cwd);
}
/** `cw next <run-id> [--limit N]` — the read-only "what would dispatch next"
 *  preview: the runnable tasks the next `cw dispatch` would pick, in order,
 *  without mutating state (nextDispatchTasks over the loaded run). Both
 *  the CLI and the cw_next MCP tool render this same DispatchTask[] value,
 *  so their payloads stay identical. */
export function nextCli(runId, options = {}) {
    return nextDispatchTasks(loadRun(runId, options), requiredNumberFlag(options.limit, "--limit"));
}
export function listNodes(runId, options = {}) {
    return loadRun(runId, options).nodes || [];
}
export function getRunNode(run, nodeId) {
    const node = (run.nodes || []).find((candidate) => candidate.id === nodeId);
    if (!node)
        throw new Error(`Unknown state node for run ${run.id}: ${nodeId}`);
    return node;
}
export function showNode(runId, nodeId, options = {}) {
    return getRunNode(loadRun(runId, options), nodeId);
}
export function graphNodes(runId, options = {}) {
    return (loadRun(runId, options).nodes || []).map((node) => ({
        id: node.id,
        kind: node.kind,
        status: node.status,
        parents: node.parents,
        children: node.children,
    }));
}
export function nodeSnapshotCli(runId, nodeId, options = {}) {
    return snapshotNode(loadRun(runId, options), nodeId, options);
}
export function nodeDiffCli(runId, baselineSnapshotId, candidateSnapshotId, options = {}) {
    const run = loadRun(runId, options);
    return diffNodeSnapshots(readNodeSnapshot(run, baselineSnapshotId), readNodeSnapshot(run, candidateSnapshotId));
}
export function nodeReplayCli(runId, snapshotId, options = {}) {
    const run = loadRun(runId, options);
    return replayNodeSnapshot(run, readNodeSnapshot(run, snapshotId), options);
}
export function nodeReplayVerifyCli(runId, replayId, options = {}) {
    const run = loadRun(runId, options);
    return verifyNodeReplay(run, readNodeReplay(run, replayId), options);
}
// ---------------------------------------------------------------------
// contract.show
// ---------------------------------------------------------------------
/** First string of a CLI/MCP value: a trimmed string, or the first entry
 *  of a repeated flag's array. */
function firstStringArg(value) {
    return typeof value === "string" && value.trim() ? value.trim() : Array.isArray(value) && typeof value[0] === "string" ? value[0] : undefined;
}
/** `cw contract show <run> [contract-id]` / `cw_contract_show` — the run's
 *  resolved pipeline contract. */
export function contractShowCli(args, contractId) {
    const runId = firstStringArg(args.runId);
    if (!runId)
        throw new Error("Missing run id");
    return getRunContract(loadRun(runId, args), contractId ?? firstStringArg(args.contractId));
}
export { optionalArg as optionalStringArg };
