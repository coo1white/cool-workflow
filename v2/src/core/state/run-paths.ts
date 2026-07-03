// core/state/run-paths.ts — createRunPaths, ensureRunDirs.
//
// MILESTONE 3. Byte-exact port of the old build's src/state.ts:10-50.
// `createRunPaths` is pure path math (core/); `ensureRunDirs` touches disk
// (mkdirSync) so it lives here but is called from shell/run-store.ts, the
// only place that actually creates a run directory tree.
//
// Evidence: SPEC/state-core.md "src/state.ts — persistence kernel" and "The
// full .cw/runs/<run-id>/ layout".

import * as fs from "node:fs";
import * as path from "node:path";
import { RunPaths } from "./types";

/** The 16-key RunPaths object, all joined under `runDir`. */
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
    blackboardDir: path.join(runDir, "blackboard"),
    topologiesDir: path.join(runDir, "topologies"),
  };
}

/** `mkdirSync` (recursive) every dir this run needs. Missing optional dir
 *  fields fall back to `path.join(runDir, "<name>")`, matching the old
 *  build's defensive default (a RunPaths loaded from an old/partial
 *  state.json may be missing an optional key). */
export function ensureRunDirs(paths: RunPaths): void {
  const dirs = [
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
    paths.blackboardDir || path.join(paths.runDir, "blackboard"),
    paths.topologiesDir || path.join(paths.runDir, "topologies"),
  ];
  for (const dir of dirs) fs.mkdirSync(dir, { recursive: true });
}
