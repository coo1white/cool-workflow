// shell/worker-cli.ts — `cw worker list|show|manifest|output|fail|validate`
// (and the mirrored cw_worker_* MCP tools) handler bodies, routing into
// the worker-isolation shell. Impure: loads run state, mutates, persists.

import { cwdArg, requireArg } from "../core/util/cli-args";
import { loadRunFromCwd, saveCheckpoint, withRunStateLock } from "./run-store";
import {
  getWorkerScope,
  listWorkerScopes,
  writeWorkerManifest,
  recordWorkerOutput,
  recordWorkerFailure,
  validateWorkerBoundary,
} from "./worker-isolation";
import { updatePhaseStatuses } from "../core/pipeline/dispatch";
import { maybeExpandLoop } from "./drive";
import { commitState } from "./commit";
import { writeReport } from "./report";
import { summarizeRun } from "./operator-ux";
import { resolveAgentConfig } from "./agent-config";

/** `--allow-unattested` (CLI: dashed key; MCP: allowUnattested). */
function allowUnattestedOption(args: Record<string, unknown>): boolean {
  return Boolean(args.allowUnattested ?? args["allow-unattested"]);
}

export function workerListCli(args: Record<string, unknown>): unknown {
  const run = loadRunFromCwd(requireArg(args.runId, "run id"), cwdArg(args));
  return listWorkerScopes(run, { status: typeof args.status === "string" ? args.status : undefined });
}

export function workerShowCli(args: Record<string, unknown>): unknown {
  const run = loadRunFromCwd(requireArg(args.runId, "run id"), cwdArg(args));
  const scope = getWorkerScope(run, requireArg(args.workerId, "worker id"));
  if (!scope) throw new Error(`Unknown worker for run ${run.id}: ${args.workerId}`);
  return scope;
}

export function workerManifestCli(args: Record<string, unknown>): unknown {
  return withRunStateLock(requireArg(args.runId, "run id"), cwdArg(args), (run) => {
    const scope = getWorkerScope(run, requireArg(args.workerId, "worker id"));
    if (!scope) throw new Error(`Unknown worker for run ${run.id}: ${args.workerId}`);
    const manifest = writeWorkerManifest(run, scope);
    saveCheckpoint(run);
    return manifest;
  });
}

/** `cw worker output <run> <worker> <result>` — records the worker's result
 *  and returns the full RunSummary. The bare
 *  accept (worker-isolation.recordWorkerOutput) only mutates the worker/task;
 *  the operator-facing verb ALSO advances the run: loopStage -> observe, refresh
 *  phase statuses, expand a bounded loop round if one is ready, commit the
 *  accept as its own `worker:<id>:result` checkpoint, and write the report.
 *  Callers (run-export / the golden-path smoke) read the RunSummary's
 *  tasks.completed, workers.byStatus, and loopStage. The drive loop does these
 *  same steps itself around the bare accept, so it never routes through here. */
export function workerOutputCli(args: Record<string, unknown>): unknown {
  return withRunStateLock(requireArg(args.runId, "run id"), cwdArg(args), (run) => {
    recordWorkerOutput(run, requireArg(args.workerId, "worker id"), requireArg(args.resultPath, "result file"), {
      requireAttestedTelemetry: resolveAgentConfig(args).requireAttestedTelemetry,
      allowUnattested: allowUnattestedOption(args),
    });
    run.loopStage = "observe";
    updatePhaseStatuses(run);
    maybeExpandLoop(run);
    commitState(run, `worker:${requireArg(args.workerId, "worker id")}:result`);
    writeReport(run);
    saveCheckpoint(run);
    return summarizeRun(run);
  });
}

export function workerFailCli(args: Record<string, unknown>): unknown {
  return withRunStateLock(requireArg(args.runId, "run id"), cwdArg(args), (run) => {
    const message = String(args.message || requireArg(args.resultPath, "failure message"));
    const scope = recordWorkerFailure(run, requireArg(args.workerId, "worker id"), message, {
      code: typeof args.code === "string" ? args.code : undefined,
      path: typeof args.path === "string" ? args.path : undefined,
      retryable: args.retryable !== undefined ? Boolean(args.retryable) : undefined,
    });
    saveCheckpoint(run);
    return scope;
  });
}

/** validate returns the boundary violation (null when the write path is
 *  allowed) and signals a violation through a non-zero exit code, not just
 *  stdout — a validate verb must report an invalid verdict via its exit code. */
export function workerValidateCli(args: Record<string, unknown>): { violation: unknown; exitCode?: number } {
  return withRunStateLock(requireArg(args.runId, "run id"), cwdArg(args), (run) => {
    const target = args.path || args.resultPath;
    const violation = validateWorkerBoundary(run, requireArg(args.workerId, "worker id"), target ? { path: String(target) } : {});
    saveCheckpoint(run);
    return { violation, exitCode: violation ? 1 : undefined };
  });
}
