// Filesystem path resolution for multi-agent records (god-module carve, FreeBSD
// router pattern). BEHAVIOR-PRESERVING — pure code movement, zero logic change.
// These two free functions derive paths from run.paths only; they are shared by
// the persistence, node-append, and graph clusters, so they live in their own
// leaf module to keep those clusters free of a circular import back to
// multi-agent.ts. Re-exported there is unnecessary (both are private), but the
// derivation is byte-identical to the originals.
import path from "node:path";
import { WorkflowRun } from "../types";
import { safeFileName } from "../state";

export function multiAgentRoot(run: WorkflowRun): string {
  return run.paths.multiAgentDir || path.join(run.paths.runDir, "multi-agent");
}

export function recordPath(run: WorkflowRun, kind: string, id: string): string {
  return path.join(multiAgentRoot(run), kind, `${safeFileName(id)}.json`);
}
