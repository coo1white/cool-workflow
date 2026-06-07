import fs from "node:fs";
import path from "node:path";
import { RunPaths, WorkflowRun } from "./types";
import { migrateRunState, StateMigrationResult } from "./state-migrations";
import { CURRENT_RUN_STATE_SCHEMA_VERSION } from "./version";

export { CURRENT_RUN_STATE_SCHEMA_VERSION };

export function createRunPaths(runDir: string): RunPaths {
  return {
    runDir,
    state: path.join(runDir, "state.json"),
    report: path.join(runDir, "report.md"),
    tasksDir: path.join(runDir, "tasks"),
    resultsDir: path.join(runDir, "results"),
    dispatchesDir: path.join(runDir, "dispatches"),
    artifactsDir: path.join(runDir, "artifacts"),
    commitsDir: path.join(runDir, "commits"),
    stateNodesDir: path.join(runDir, "nodes"),
    feedbackDir: path.join(runDir, "feedback"),
    auditDir: path.join(runDir, "audit"),
    workersDir: path.join(runDir, "workers"),
    candidatesDir: path.join(runDir, "candidates"),
    multiAgentDir: path.join(runDir, "multi-agent"),
    blackboardDir: path.join(runDir, "blackboard")
  };
}

export function ensureRunDirs(paths: RunPaths): void {
  for (const dir of [
    paths.runDir,
    paths.tasksDir,
    paths.resultsDir,
    paths.dispatchesDir,
    paths.artifactsDir,
    paths.commitsDir,
    paths.stateNodesDir,
    paths.feedbackDir,
    paths.auditDir || path.join(paths.runDir, "audit"),
    paths.workersDir || path.join(paths.runDir, "workers"),
    paths.candidatesDir || path.join(paths.runDir, "candidates"),
    paths.multiAgentDir || path.join(paths.runDir, "multi-agent"),
    paths.blackboardDir || path.join(paths.runDir, "blackboard")
  ]) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

export function loadRunFromCwd(runId: string, cwd = process.cwd()): WorkflowRun {
  if (!runId) throw new Error("Missing run id");
  const statePath = path.join(cwd, ".cw", "runs", runId, "state.json");
  const result = loadRunStateFile(statePath, { dryRun: true });
  if (result.report.status === "unsupported") {
    throw new Error(`Unsupported CW run state: ${result.report.errors.join("; ")}`);
  }
  return result.run;
}

export function loadRunStateFile(statePath: string, options: { dryRun?: boolean } = {}): StateMigrationResult {
  const result = migrateRunState(readJson(statePath), {
    statePath,
    dryRun: options.dryRun === undefined ? true : options.dryRun
  });
  if (result.report.status === "unsupported") return result;
  return result;
}

export function checkRunStateFile(statePath: string): StateMigrationResult {
  return loadRunStateFile(statePath, { dryRun: true });
}

export function migrateRunStateFile(statePath: string, options: { write?: boolean } = {}): StateMigrationResult {
  const result = loadRunStateFile(statePath, { dryRun: !options.write });
  if (result.report.status !== "unsupported" && options.write && result.report.writeRequired) {
    writeJson(statePath, result.run);
  }
  return result;
}

export function saveCheckpoint(run: WorkflowRun): void {
  run.updatedAt = new Date().toISOString();
  writeJson(run.paths.state, run);
}

export function readJson(file: string): unknown {
  if (!fs.existsSync(file)) throw new Error(`File not found: ${file}`);
  return JSON.parse(fs.readFileSync(file, "utf8")) as unknown;
}

export function writeJson(file: string, value: unknown): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

export function safeFileName(value: string): string {
  return String(value).replace(/[^a-zA-Z0-9_.:-]+/g, "_");
}
