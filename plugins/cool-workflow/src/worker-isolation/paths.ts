// Path, artifact, and id derivation for worker isolation. Pure functions of a
// WorkerScope (or run + taskId) — no run-state mutation, no disk I/O. Carved out
// of worker-isolation.ts following the established router pattern
// (run-registry/{format,policy}.ts, orchestrator/*-operations.ts).
//
// BEHAVIOR-PRESERVING — pure code movement, zero logic change. Re-exported from
// worker-isolation.ts so the public surface is byte-unchanged.
import path from "node:path";
import { StateArtifact, WorkerScope, WorkflowRun } from "../types";
import { safeFileName } from "../state";

export const WORKER_SCOPE_FILE = "worker.json";
export const WORKER_MANIFEST_FILE = "manifest.json";

export function manifestPath(scope: WorkerScope): string {
  return path.join(scope.workerDir, WORKER_MANIFEST_FILE);
}

export function workerScopePath(scope: WorkerScope): string {
  return path.join(scope.workerDir, WORKER_SCOPE_FILE);
}

export function workerArtifacts(scope: WorkerScope): StateArtifact[] {
  return [
    { id: "worker", kind: "json", path: workerScopePath(scope) },
    { id: "worker-manifest", kind: "json", path: manifestPath(scope) },
    { id: "worker-input", kind: "markdown", path: scope.inputPath }
  ];
}

// Deterministic worker id (v0.1.40 self-audit P2): a wall-clock stamp + Math.random()
// made every dispatch mint a different id, so audit references were not reproducible
// across re-runs of the same inputs. The id is now derived from the task plus a
// per-task sequence (count of worker scopes already allocated for that task + 1),
// so re-running the same workflow yields byte-identical worker ids while retries of
// the SAME task still get a fresh, unique id. (workerId is excluded from the
// snapshot source fingerprint, so this does not change replay digests.)
export function createWorkerId(run: WorkflowRun, taskId: string): string {
  const prefix = `worker-${safeFileName(taskId)}-`;
  const seq = (run.workers || []).filter((scope) => scope.id.startsWith(prefix)).length + 1;
  return `${prefix}${String(seq).padStart(4, "0")}`;
}
