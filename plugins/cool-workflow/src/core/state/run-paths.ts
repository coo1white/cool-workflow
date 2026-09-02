// core/state/run-paths.ts — pure RunPaths construction.
//
// MILESTONE 3. Byte-exact port of the old build's state module.
// `createRunPaths` is pure path math. The directory write mechanism lives in
// shell/run-store.ts.
//
// Evidence: SPEC/state-core.md "state module — persistence kernel" and "The
// full .cw/runs/<run-id>/ layout".

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
