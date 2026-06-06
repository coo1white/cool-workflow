import fs from "node:fs";
import path from "node:path";
import { RunPaths, WorkflowRun } from "./types";

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
    workersDir: path.join(runDir, "workers")
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
    paths.workersDir || path.join(paths.runDir, "workers")
  ]) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

export function loadRunFromCwd(runId: string, cwd = process.cwd()): WorkflowRun {
  if (!runId) throw new Error("Missing run id");
  const run = readJson(path.join(cwd, ".cw", "runs", runId, "state.json")) as WorkflowRun;
  run.paths.stateNodesDir = run.paths.stateNodesDir || path.join(run.paths.runDir, "nodes");
  run.paths.feedbackDir = run.paths.feedbackDir || path.join(run.paths.runDir, "feedback");
  run.paths.workersDir = run.paths.workersDir || path.join(run.paths.runDir, "workers");
  run.nodes = run.nodes || [];
  run.contracts = run.contracts || [];
  run.feedback = run.feedback || [];
  run.workers = run.workers || [];
  return run;
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
