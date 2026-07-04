// shell/worker-cli.ts — `cw worker list|show|manifest|output|fail|validate`
// (and the mirrored cw_worker_* MCP tools) handler bodies. Byte-exact behavior
// port of the old build's src/cli/handlers/worker.ts routing into the
// worker-isolation shell. Impure: loads run state, mutates, persists.

import * as path from "node:path";
import { WorkflowRun } from "../core/state/types";
import { loadRunFromCwd, saveCheckpoint } from "./run-store";
import {
  getWorkerScope,
  listWorkerScopes,
  writeWorkerManifest,
  recordWorkerOutput,
  recordWorkerFailure,
  validateWorkerBoundary,
} from "./worker-isolation";

function cwdFor(args: Record<string, unknown>): string {
  return typeof args.cwd === "string" && args.cwd.trim() ? path.resolve(args.cwd) : process.cwd();
}

function req(value: unknown, label: string): string {
  const s = value === undefined || value === null ? "" : String(value);
  if (!s) throw new Error(`Missing ${label}`);
  return s;
}

export function workerListCli(args: Record<string, unknown>): unknown {
  const run = loadRunFromCwd(req(args.runId, "run id"), cwdFor(args));
  return listWorkerScopes(run, { status: typeof args.status === "string" ? args.status : undefined });
}

export function workerShowCli(args: Record<string, unknown>): unknown {
  const run = loadRunFromCwd(req(args.runId, "run id"), cwdFor(args));
  const scope = getWorkerScope(run, req(args.workerId, "worker id"));
  if (!scope) throw new Error(`Unknown worker for run ${run.id}: ${args.workerId}`);
  return scope;
}

export function workerManifestCli(args: Record<string, unknown>): unknown {
  const run = loadRunFromCwd(req(args.runId, "run id"), cwdFor(args));
  const scope = getWorkerScope(run, req(args.workerId, "worker id"));
  if (!scope) throw new Error(`Unknown worker for run ${run.id}: ${args.workerId}`);
  const manifest = writeWorkerManifest(run, scope);
  saveCheckpoint(run);
  return manifest;
}

/** Task-status rollup carried on the `cw worker output` payload — byte-behavior
 *  port of the old orchestrator recordWorkerOutput's summarizeRun.tasks. Callers
 *  (pdca/run-export) read output.tasks.completed. */
function taskCounts(run: WorkflowRun): { total: number; pending: number; running: number; failed: number; completed: number } {
  const tasks = run.tasks as Array<{ status: string }>;
  return {
    total: tasks.length,
    pending: tasks.filter((t) => t.status === "pending").length,
    running: tasks.filter((t) => t.status === "running").length,
    failed: tasks.filter((t) => t.status === "failed").length,
    completed: tasks.filter((t) => t.status === "completed").length,
  };
}

export function workerOutputCli(args: Record<string, unknown>): unknown {
  const run = loadRunFromCwd(req(args.runId, "run id"), cwdFor(args));
  const result = recordWorkerOutput(run, req(args.workerId, "worker id"), req(args.resultPath, "result file"), {});
  saveCheckpoint(run);
  return { ...(result as Record<string, unknown>), tasks: taskCounts(run) };
}

export function workerFailCli(args: Record<string, unknown>): unknown {
  const run = loadRunFromCwd(req(args.runId, "run id"), cwdFor(args));
  const message = String(args.message || req(args.resultPath, "failure message"));
  const scope = recordWorkerFailure(run, req(args.workerId, "worker id"), message, {
    code: typeof args.code === "string" ? args.code : undefined,
    path: typeof args.path === "string" ? args.path : undefined,
    retryable: args.retryable !== undefined ? Boolean(args.retryable) : undefined,
  });
  saveCheckpoint(run);
  return scope;
}

/** validate returns the boundary violation (null when the write path is
 *  allowed) and signals a violation through a non-zero exit code, not just
 *  stdout — a validate verb must report an invalid verdict via its exit code. */
export function workerValidateCli(args: Record<string, unknown>): { violation: unknown; exitCode?: number } {
  const run = loadRunFromCwd(req(args.runId, "run id"), cwdFor(args));
  const target = args.path || args.resultPath;
  const violation = validateWorkerBoundary(run, req(args.workerId, "worker id"), target ? { path: String(target) } : {});
  saveCheckpoint(run);
  return { violation, exitCode: violation ? 1 : undefined };
}
