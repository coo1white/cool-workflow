// shell/pipeline-cli.ts — CLI-facing entry points for the pipeline/drive
// spine: planRun, runDrivePreview, runDriveStep, quickstartRun,
// dispatchRun, recordResultRun, commitRun.
//
// MILESTONE 6+7 (combined). Wires the pieces built in shell/pipeline.ts,
// shell/drive.ts, shell/dispatch.ts, shell/commit.ts, shell/worker-
// isolation.ts, shell/workflow-app-loader.ts into the shapes
// core/capability-table.ts's CLI bindings call.
//
// Evidence: SPEC/pipeline-run.md "CLI / MCP surface (capability layer)".

import * as fs from "node:fs";
import * as path from "node:path";
import { plan } from "./pipeline";
import { loadWorkflowApp } from "./workflow-app-loader";
import { drive, DriveOptions, drivePreview } from "./drive";
import { createDispatchManifest } from "./dispatch";
import { commitState } from "./commit";
import { recordWorkerOutput } from "./worker-isolation";
import { loadRunFromCwd, saveCheckpoint } from "./run-store";
import { writeReport } from "./report";
import { WorkflowRun } from "../core/state/types";

const QUICKSTART_DEFAULT_APP = "architecture-review";

/** Runtime keys that must NEVER leak into run.inputs (they are drive/CLI
 *  plumbing, not workflow-declared inputs). Byte-exact to the old
 *  build's DRIVE_RUNTIME_KEYS list. */
const RUNTIME_KEYS = new Set([
  "once", "now", "preview", "step", "drive", "json", "format", "run", "runId", "cwd",
  "agentCommand", "agent-command", "agentArgs", "agent-args", "agentEndpoint", "agent-endpoint",
  "agentModel", "agent-model", "agentTimeoutMs", "agent-timeout-ms", "resume", "incremental",
  "concurrency", "link", "ref", "branch", "refresh", "check", "app", "appId", "workflowId", "question", "repo",
]);

/** Byte-exact port of the old build's `normalizeInputs`
 *  (src/orchestrator/lifecycle-operations.ts:465-480): repeated `--arg
 *  key=value` pairs unpack into inputs (key = text before the first "=",
 *  value = the rest re-joined with "="); `repo` copies to `cwd` when `cwd`
 *  is not already set. Per SPEC/orchestrator.md's "Plan input rules" and
 *  SPEC/workflow-apps.md. */
function planInputsFor(args: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(args)) {
    if (key === "arg") {
      const pairs = Array.isArray(value) ? value : [value];
      for (const pair of pairs) {
        const [argKey, ...rest] = String(pair).split("=");
        out[argKey] = rest.join("=");
      }
      continue;
    }
    if (RUNTIME_KEYS.has(key)) continue;
    out[key] = value;
  }
  if (typeof args.repo === "string") out.repo = args.repo;
  if (typeof args.question === "string") out.question = args.question;
  if (out.repo && !out.cwd) out.cwd = out.repo;
  return out;
}

function invocationCwd(args: Record<string, unknown>): string {
  return typeof args.cwd === "string" && args.cwd.trim() ? path.resolve(args.cwd) : process.cwd();
}

/** `cw plan <workflowId>` — real: loads the app, plans a fresh run,
 *  returns the canonical plan summary. */
export function planRun(args: Record<string, unknown>): Record<string, unknown> {
  const appId = String(args.workflowId || args.app || QUICKSTART_DEFAULT_APP);
  if (!args.repo && !args.cwd) args.repo = invocationCwd(args);
  const app = loadWorkflowApp(appId);
  const run = plan(app, planInputsFor(args));
  return { schemaVersion: 1, runId: run.id, workflowId: run.workflow.id, statePath: run.paths.state, reportPath: run.paths.report, taskCount: run.tasks.length };
}

export function runDrivePreview(args: Record<string, unknown>): ReturnType<typeof drivePreview> {
  const runId = String(args.runId || args.run || "");
  const cwd = invocationCwd(args);
  return drivePreview(runId, cwd, args);
}

/** `cw run <app|--run id> --drive [--once]` — plans a fresh run (unless
 *  `--run` continues an existing one) and drives it. */
export function runDriveStep(args: Record<string, unknown>): ReturnType<typeof drive> {
  const existingRunId = String(args.runId || args.run || "");
  const options: DriveOptions = {
    once: Boolean(args.once),
    now: typeof args.now === "string" ? args.now : undefined,
    args,
    concurrency: args.concurrency !== undefined ? Number(args.concurrency) : undefined,
    incremental: Boolean(args.incremental),
  };
  if (existingRunId) {
    const cwd = invocationCwd(args);
    const run = loadRunFromCwd(existingRunId, cwd);
    return drive(existingRunId, run.cwd, options);
  }
  const appId = String(args.appId || args.app || args.positionalApp || "");
  if (!appId) throw new Error("run --drive requires an app id (or --run <run-id> to continue)");
  if (!args.repo && !args.cwd) args.repo = invocationCwd(args);
  const app = loadWorkflowApp(appId);
  const run = plan(app, planInputsFor(args));
  return drive(run.id, run.cwd, options);
}

/** `cw quickstart [app] --question ...` — composes plan -> runDrive ->
 *  report in one call. Default app is architecture-review. */
export function quickstartRun(args: Record<string, unknown>): ReturnType<typeof drive> {
  const appId = String(args.appId || args.app || args.workflowId || QUICKSTART_DEFAULT_APP);
  if (!args.repo && !args.cwd) args.repo = invocationCwd(args);
  const options: DriveOptions = {
    once: Boolean(args.once),
    now: typeof args.now === "string" ? args.now : undefined,
    args,
    concurrency: args.concurrency !== undefined ? Number(args.concurrency) : undefined,
    incremental: Boolean(args.incremental),
  };
  const existingRunId = String(args.runId || args.run || "");
  let run: WorkflowRun;
  if (existingRunId) {
    run = loadRunFromCwd(existingRunId, invocationCwd(args));
  } else {
    const app = loadWorkflowApp(appId);
    run = plan(app, planInputsFor(args));
  }
  const result = drive(run.id, run.cwd, options);
  const finalRun = loadRunFromCwd(run.id, run.cwd);
  writeReport(finalRun);
  return result;
}

export function dispatchRun(args: Record<string, unknown>): Record<string, unknown> {
  const runId = String(args.runId);
  const run = loadRunFromCwd(runId, invocationCwd(args));
  const manifest = createDispatchManifest(run, args.limit !== undefined ? Number(args.limit) : undefined, { sandboxProfileId: typeof args.sandbox === "string" ? args.sandbox : undefined, backendId: typeof args.backend === "string" ? args.backend : undefined });
  if (manifest.dispatchId) {
    commitState(run, `dispatch:${manifest.dispatchId}`);
    saveCheckpoint(run);
    writeReport(run);
  }
  return manifest as unknown as Record<string, unknown>;
}

export function recordResultRun(args: Record<string, unknown>): Record<string, unknown> {
  const runId = String(args.runId);
  const taskId = String(args.taskId);
  const resultPath = String(args.resultPath);
  const run = loadRunFromCwd(runId, invocationCwd(args));
  const task = run.tasks.find((t) => t.id === taskId);
  if (!task || !task.workerId) throw new Error(`Unknown task id for run ${runId}: ${taskId}`);
  const absolute = path.resolve(resultPath);
  if (!fs.existsSync(absolute)) throw new Error(`Result file does not exist: ${resultPath}`);
  const output = recordWorkerOutput(run, String(task.workerId), absolute);
  saveCheckpoint(run);
  writeReport(run);
  return output;
}

export function commitRun(args: Record<string, unknown>): Record<string, unknown> {
  const runId = String(args.runId);
  const run = loadRunFromCwd(runId, invocationCwd(args));
  const allowCheckpoint = Boolean(args.allowUnverifiedCheckpoint);
  const hasGateOption = Boolean(args.verifier || args.candidate || args.selection);
  const commit = commitState(run, {
    reason: typeof args.reason === "string" && args.reason ? args.reason : "manual",
    verifierNodeId: typeof args.verifier === "string" ? args.verifier : undefined,
    candidateId: typeof args.candidate === "string" ? args.candidate : undefined,
    selectionId: typeof args.selection === "string" ? args.selection : undefined,
    verifierGated: hasGateOption || !allowCheckpoint,
    allowUnverifiedCheckpoint: allowCheckpoint,
    source: "cli",
  });
  saveCheckpoint(run);
  writeReport(run);
  return commit as unknown as Record<string, unknown>;
}
