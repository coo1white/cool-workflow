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
import { loadWorkflowApp, showWorkflowApp } from "./workflow-app-loader";
import { drive, DriveOptions, drivePreview } from "./drive";
import { createDispatchManifest } from "./dispatch";
import { commitState } from "./commit";
import { recordWorkerOutput } from "./worker-isolation";
import { loadRunFromCwd, saveCheckpoint } from "./run-store";
import { writeReport } from "./report";
import { WorkflowRun } from "../core/state/types";
import { agentConfigured } from "./agent-config";

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

interface QuickstartCheck {
  name: string;
  status: "ok" | "blocked" | "warn";
  detail: string;
  fix?: string;
}

interface QuickstartCheckResult {
  schemaVersion: 1;
  mode: "check";
  ok: boolean;
  appId: string;
  repo: string;
  checks: QuickstartCheck[];
}

/** `cw quickstart [app] --check` — read-only preflight: does the app
 *  resolve, is the repo readable/writable, is a question set, is an
 *  agent backend configured. Never plans or writes a run. Byte-exact
 *  port of the old build's `quickstartCheck` (src/capability-core.ts),
 *  local-repo path only (the --link/remote preflight variant is not
 *  ported — no conformance case exercises it). */
function quickstartCheck(appId: string, args: Record<string, unknown>): QuickstartCheckResult {
  const base = invocationCwd(args);
  const repoArg = typeof args.repo === "string" && args.repo.trim() ? args.repo : base;
  const repo = path.resolve(base, repoArg);
  const checks: QuickstartCheck[] = [];

  try {
    showWorkflowApp(appId);
    checks.push({ name: "app", status: "ok", detail: `Workflow app ${appId} is available.` });
  } catch {
    checks.push({
      name: "app",
      status: "blocked",
      detail: `Workflow app ${appId} is not available.`,
      fix: "Run `cw app list` and choose one of the listed app ids.",
    });
  }

  let repoReadable = false;
  let repoStateWritable = false;
  try {
    const stat = fs.statSync(repo);
    repoReadable = stat.isDirectory();
    if (!repoReadable) throw new Error("not a directory");
    fs.accessSync(repo, fs.constants.R_OK);
    checks.push({ name: "repo", status: "ok", detail: `Repository path is readable (${repo}).` });
  } catch {
    checks.push({
      name: "repo",
      status: "blocked",
      detail: `Repository path is not readable (${repo}).`,
      fix: "Pass --repo PATH for a readable repository directory.",
    });
  }
  try {
    const cwDir = path.join(repo, ".cw");
    fs.accessSync(fs.existsSync(cwDir) ? cwDir : repo, fs.constants.W_OK);
    repoStateWritable = repoReadable;
    checks.push({ name: "repo-state", status: "ok", detail: "Run state location is writable." });
  } catch {
    checks.push({
      name: "repo-state",
      status: "blocked",
      detail: "Run state location is not writable.",
      fix: "Use a writable repo, fix directory permissions, or pass --repo to a writable checkout.",
    });
  }

  if (typeof args.question === "string" && args.question.trim()) {
    checks.push({ name: "question", status: "ok", detail: "Question is set." });
  } else {
    checks.push({ name: "question", status: "blocked", detail: "Question is missing.", fix: "Pass --question TEXT." });
  }

  if (agentConfigured(args)) {
    checks.push({ name: "agent", status: "ok", detail: "Agent backend is configured." });
  } else {
    checks.push({
      name: "agent",
      status: "blocked",
      detail: "No agent backend is configured.",
      fix: 'Pass --agent-command "claude -p", set $CW_AGENT_COMMAND, or use --agent-command builtin:claude.',
    });
  }

  const ok = checks.every((check) => check.status !== "blocked") && repoStateWritable;
  return { schemaVersion: 1, mode: "check", ok, appId, repo, checks };
}

/** `cw quickstart [app] --question ...` — composes plan -> runDrive ->
 *  report in one call. Default app is architecture-review. `--check` is a
 *  read-only preflight that never plans/drives/writes (see
 *  `quickstartCheck` above). */
export function quickstartRun(
  args: Record<string, unknown>
): (ReturnType<typeof drive> & { appId: string }) | QuickstartCheckResult {
  const appId = String(args.appId || args.app || args.workflowId || QUICKSTART_DEFAULT_APP);
  if (!args.repo && !args.cwd) args.repo = invocationCwd(args);
  if (Boolean(args.check)) return quickstartCheck(appId, args);
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
  // Byte-exact to the old build's quickstart() return shape
  // (src/capability-core.ts): `appId` is the resolved app id (the
  // argument, or its architecture-review default), distinct from
  // `workflowId` which is the driven run's own workflow id (equal for a
  // top-level run, different for a sub-workflow hop).
  return { appId, ...result };
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
  const workerId = String(task.workerId);
  const output = recordWorkerOutput(run, workerId, absolute);
  // Byte-exact to the old build's orchestrator recordWorkerOutput()
  // wrapper: an accepted result is its own checkpoint commit, not just a
  // bare saveCheckpoint (SPEC/pipeline-run.md's persist-ordering rule).
  commitState(run, `worker:${workerId}:result`);
  saveCheckpoint(run);
  writeReport(run);
  return output;
}

/** `cw commit <run-id>` — byte-exact port of the old build's
 *  `orchestrator/lifecycle-operations.ts`'s `commit()`: the CLI/MCP
 *  payload wraps the commit record as `{runId, commit}` (NOT the commit
 *  record at top level). Both the success AND the throw path write the
 *  report + checkpoint before returning/re-throwing — a gate failure
 *  still leaves the run's report/state current on disk. */
export function commitRun(args: Record<string, unknown>): Record<string, unknown> {
  const runId = String(args.runId);
  const run = loadRunFromCwd(runId, invocationCwd(args));
  const allowCheckpoint = Boolean(args.allowUnverifiedCheckpoint || args["allow-unverified-checkpoint"]);
  const hasGateOption = Boolean(
    args.verifier || args.verifierNode || args["verifier-node"] || args.candidate || args.selection
  );
  try {
    const commit = commitState(run, {
      reason: typeof args.reason === "string" && args.reason ? args.reason : "manual",
      verifierNodeId:
        (typeof args.verifier === "string" && args.verifier) ||
        (typeof args.verifierNode === "string" && args.verifierNode) ||
        (typeof args["verifier-node"] === "string" && args["verifier-node"]) ||
        undefined,
      candidateId: typeof args.candidate === "string" ? args.candidate : undefined,
      selectionId: typeof args.selection === "string" ? args.selection : undefined,
      verifierGated: hasGateOption || !allowCheckpoint,
      allowUnverifiedCheckpoint: allowCheckpoint,
      source: "cli",
    });
    writeReport(run);
    saveCheckpoint(run);
    return { runId: run.id, commit };
  } catch (error) {
    writeReport(run);
    saveCheckpoint(run);
    throw error;
  }
}
