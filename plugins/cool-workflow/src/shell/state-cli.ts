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

import * as fs from "node:fs";
import * as path from "node:path";
import { readJson, writeJson } from "./fs-atomic";
import { loadRunFromCwd, migrateRunStateFile } from "./run-store";
import { readNodeSnapshot, readNodeReplay, snapshotNode, replayNodeSnapshot } from "./node-store";
import {
  MigrationContractId,
  checkMigration,
  listMigrationContracts,
  proveMigration,
} from "../core/state/contract-migration";
import { diffNodeSnapshots, verifyNodeReplay } from "../core/state/node-snapshot";
import { StateMigrationReport } from "../core/state/migrations";
import { WorkflowRun } from "../core/state/types";

function optionalStringArg(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function resolveCwd(options: Record<string, unknown>): string {
  return path.resolve(String(options.cwd || process.cwd()));
}

// ---------------------------------------------------------------------
// state.check
// ---------------------------------------------------------------------

/** `cw state check <run-id> [--state PATH] [--write] [--cwd PATH]`. */
export function checkState(runId: string, options: Record<string, unknown> = {}): StateMigrationReport {
  const cwd = resolveCwd(options);
  const statePath = options.state ? path.resolve(String(options.state)) : path.join(cwd, ".cw", "runs", runId, "state.json");
  const result = migrateRunStateFile(statePath, { write: Boolean(options.write) });
  return result.report;
}

// ---------------------------------------------------------------------
// migration.list | migration.check | migration.prove
// ---------------------------------------------------------------------

export function migrationList(): { contracts: ReturnType<typeof listMigrationContracts> } {
  return { contracts: listMigrationContracts() };
}

/** Resolves `target` to an existing file (absolute/relative to
 *  `process.cwd()`, NOT the `--cwd` option — matches the old build's
 *  `loadMigrationSnapshot` literally) else `<cwd>/.cw/runs/<target>/
 *  state.json`. Throws `Migration target not found: <target>` when
 *  neither exists. */
function loadMigrationSnapshot(
  target: string,
  options: Record<string, unknown>
): { snapshot: unknown; contract: MigrationContractId; dir: string } {
  const contract: MigrationContractId = options.contract === "workflow-app" ? "workflow-app" : "run-state";
  const file =
    fs.existsSync(target) && fs.statSync(target).isFile()
      ? path.resolve(target)
      : path.join(process.cwd(), ".cw", "runs", target, "state.json");
  if (!fs.existsSync(file)) throw new Error(`Migration target not found: ${target}`);
  return { snapshot: readJson(file), contract, dir: path.dirname(file) };
}

export function migrationCheck(target: string, options: Record<string, unknown> = {}): ReturnType<typeof checkMigration> {
  const { snapshot, contract } = loadMigrationSnapshot(target, options);
  return checkMigration(contract, snapshot);
}

/** Appends the proof beside the target (NEVER overwriting source) under
 *  `<targetDir>/migration/<first 16 hex of fingerprint>.json`; a
 *  read-only target still returns the proof (write failure is
 *  best-effort/swallowed). */
export function migrationProve(target: string, options: Record<string, unknown> = {}): ReturnType<typeof proveMigration> {
  const { snapshot, contract, dir } = loadMigrationSnapshot(target, options);
  const proof = proveMigration(contract, snapshot);
  try {
    writeJson(path.join(dir, "migration", `${proof.fingerprint.replace("sha256:", "").slice(0, 16)}.json`), proof);
  } catch {
    /* read-only target — the proof is still returned */
  }
  return proof;
}

// ---------------------------------------------------------------------
// node.list | node.show | node.graph | node.snapshot | node.diff |
// node.replay | node.replay.verify
// ---------------------------------------------------------------------

function loadRun(runId: string, options: Record<string, unknown> = {}): WorkflowRun {
  const cwd = options.cwd ? path.resolve(String(options.cwd)) : process.cwd();
  return loadRunFromCwd(runId, cwd);
}

export function listNodes(runId: string, options: Record<string, unknown> = {}): NonNullable<WorkflowRun["nodes"]> {
  return loadRun(runId, options).nodes || [];
}

export function getRunNode(run: WorkflowRun, nodeId: string): NonNullable<WorkflowRun["nodes"]>[number] {
  const node = (run.nodes || []).find((candidate) => candidate.id === nodeId);
  if (!node) throw new Error(`Unknown state node for run ${run.id}: ${nodeId}`);
  return node;
}

export function showNode(runId: string, nodeId: string, options: Record<string, unknown> = {}): NonNullable<WorkflowRun["nodes"]>[number] {
  return getRunNode(loadRun(runId, options), nodeId);
}

export function graphNodes(
  runId: string,
  options: Record<string, unknown> = {}
): Array<{ id: string; kind: string; status: string; parents: string[]; children: string[] }> {
  return (loadRun(runId, options).nodes || []).map((node) => ({
    id: node.id,
    kind: node.kind,
    status: node.status,
    parents: node.parents,
    children: node.children,
  }));
}

export function nodeSnapshotCli(runId: string, nodeId: string, options: Record<string, unknown> = {}) {
  return snapshotNode(loadRun(runId, options), nodeId, options as { now?: string; persist?: boolean });
}

export function nodeDiffCli(runId: string, baselineSnapshotId: string, candidateSnapshotId: string, options: Record<string, unknown> = {}) {
  const run = loadRun(runId, options);
  return diffNodeSnapshots(readNodeSnapshot(run, baselineSnapshotId), readNodeSnapshot(run, candidateSnapshotId));
}

export function nodeReplayCli(runId: string, snapshotId: string, options: Record<string, unknown> = {}) {
  const run = loadRun(runId, options);
  return replayNodeSnapshot(run, readNodeSnapshot(run, snapshotId), options as { now?: string; persist?: boolean });
}

export function nodeReplayVerifyCli(runId: string, replayId: string, options: Record<string, unknown> = {}) {
  const run = loadRun(runId, options);
  return verifyNodeReplay(run, readNodeReplay(run, replayId), options as { now?: string });
}

export { optionalStringArg };
