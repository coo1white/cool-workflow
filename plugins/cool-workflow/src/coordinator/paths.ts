// Filesystem path derivation for the coordinator/blackboard layer
// (FreeBSD-audit R-carve). Carved out of coordinator.ts so the module no longer
// bundles the per-run path computation alongside the stateful blackboard
// operations. Re-exported from coordinator.ts to keep the public surface
// byte-identical.
//
// BEHAVIOR-PRESERVING — pure code movement, zero logic change. Each function is a
// function of a WorkflowRun's paths only: it reads run.paths and joins names; it
// never mutates run, never touches the blackboard state, never writes the disk.
import path from "node:path";
import { safeFileName } from "../state";
import { Blackboard, WorkflowRun } from "../types";

export function boardPaths(run: WorkflowRun): Blackboard["paths"] {
  const root = blackboardRoot(run);
  return {
    root,
    index: path.join(root, "index.json"),
    messages: messagesPath(run),
    topicsDir: path.join(root, "topics"),
    contextsDir: path.join(root, "contexts"),
    artifactsDir: path.join(root, "artifacts"),
    snapshotsDir: path.join(root, "snapshots"),
    decisionsDir: path.join(root, "decisions")
  };
}

export function blackboardRoot(run: WorkflowRun): string {
  return run.paths.blackboardDir || path.join(run.paths.runDir, "blackboard");
}

export function messagesPath(run: WorkflowRun): string {
  return path.join(blackboardRoot(run), "messages.jsonl");
}

export function recordPath(run: WorkflowRun, kind: string, id: string): string {
  return path.join(blackboardRoot(run), kind, `${safeFileName(id)}.json`);
}
