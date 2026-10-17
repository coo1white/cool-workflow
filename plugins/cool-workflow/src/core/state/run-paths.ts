// core/state/run-paths.ts — pure RunPaths construction.
//
// `createRunPaths` is pure path math. The directory write mechanism lives in
// shell/run-store.ts.
//
// Evidence: SPEC/state-core.md "state module — persistence kernel" and "The
// full .cw/runs/<run-id>/ layout".

import * as path from "node:path";
import { RunAuditPaths, RunPaths } from "./types";

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

const AUDIT_FILES: Array<["eventLogPath" | "summaryPath" | "indexPath", string]> = [
  ["eventLogPath", "events.jsonl"],
  ["summaryPath", "summary.json"],
  ["indexPath", "index.json"],
];

/** Answers "do these two absolute paths name the same place on disk?".
 *  The shell gives one that follows symlinks; with none, only equal
 *  strings are the same place. */
export type SameLocation = (stored: string, rebuilt: string) => boolean;

/** Make a loaded run's `paths` (and the audit paths under them) again from
 *  `runDir`, the folder the run's state.json was really found in. The
 *  stored values are never trusted as write targets: a state.json from a
 *  cloned repo can point them anywhere, and a repo that was moved keeps
 *  its old absolute paths. A stored value is kept, byte for byte, only when
 *  `sameLocation(stored, rebuilt)` says it names the same place as the
 *  rebuilt one (for one, the same folder seen through a symlink such as
 *  macOS /var -> /private/var); any other value is replaced. Keys keep
 *  their stored order, so a run whose stored paths were already right
 *  saves byte-identical; a stored key that is not one of createRunPaths'
 *  keys is dropped. Audit path keys are set only where the stored audit
 *  block has them. Changes `run` in place. */
export function rebindRunPaths<T extends { paths: RunPaths; audit?: RunAuditPaths }>(
  run: T,
  runDir: string,
  sameLocation: SameLocation = (a, b) => a === b
): T {
  const fresh = createRunPaths(runDir) as unknown as Record<string, string>;
  const stored = (run.paths && typeof run.paths === "object" ? run.paths : {}) as unknown as Record<string, unknown>;
  const pick = (value: unknown, rebuilt: string): string =>
    typeof value === "string" && (value === rebuilt || sameLocation(value, rebuilt)) ? value : rebuilt;
  const paths: Record<string, string> = {};
  for (const key of Object.keys(stored)) {
    if (Object.prototype.hasOwnProperty.call(fresh, key)) paths[key] = pick(stored[key], fresh[key]);
  }
  for (const key of Object.keys(fresh)) {
    if (!Object.prototype.hasOwnProperty.call(paths, key)) paths[key] = fresh[key];
  }
  run.paths = paths as unknown as RunPaths;
  if (run.audit && typeof run.audit === "object") {
    for (const [key, file] of AUDIT_FILES) {
      if (Object.prototype.hasOwnProperty.call(run.audit, key)) run.audit[key] = pick(run.audit[key], path.join(fresh.auditDir, file));
    }
  }
  return run;
}
