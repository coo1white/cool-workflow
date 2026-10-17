// shell/app-run-cli.ts — `cw_app_run` and `cw_sandbox_choose`.
//
// Thin shell bodies over the same `plan` + `showSandboxProfileCli` the CLI
// front door uses.

import { plan } from "./pipeline";
import { loadWorkflowApp } from "./workflow-app-loader";
import { showSandboxProfileCli } from "./exec-backend-cli";
import { summarizeOperatorRun } from "./operator-ux";
import { loadRunFromCwd } from "./run-store";

/** Keys that steer the run/tool call itself, never workflow inputs. */
const RUNTIME_KEYS = new Set(["cwd", "sandbox", "sandboxProfile", "sandboxProfileId", "appId", "workflowId", "inputs"]);

function withoutRuntimeKeys(args: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(args)) {
    if (RUNTIME_KEYS.has(key)) continue;
    out[key] = value;
  }
  return out;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function sandboxProfileIdFrom(args: Record<string, unknown>): string | undefined {
  return optionalString(args.sandbox || args.sandboxProfile || args.sandboxProfileId || args.profileId);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** `cw_sandbox_choose` — resolve + validate a profile choice: defaults
 *  to "readonly", returns the resolved profile object under `profile`. */
export function sandboxChooseCli(args: Record<string, unknown>): Record<string, unknown> {
  const profileId = sandboxProfileIdFrom(args) || "readonly";
  const profile = showSandboxProfileCli(profileId, args);
  return {
    profileId,
    sandboxProfileId: (profile as { id?: string }).id,
    valid: true,
    profile,
  };
}

/** `cw_app_run` — create a run from an app id + structured inputs:
 *  merges `inputs` with the non-runtime args, plans a fresh run, and
 *  returns the run descriptor + a compact operator status. */
export function appRunCli(args: Record<string, unknown>): Record<string, unknown> {
  const appId = String(args.appId || args.workflowId || "");
  if (!appId) throw new Error("cw_app_run requires an app id (appId)");
  const inputs = isRecord(args.inputs) ? args.inputs : {};
  const planOptions: Record<string, unknown> = { ...inputs, ...withoutRuntimeKeys(args) };
  if (typeof args.cwd === "string" && args.cwd.trim()) planOptions.cwd = args.cwd;
  if (planOptions.repo && !planOptions.cwd) planOptions.cwd = planOptions.repo;
  const sandboxProfileId = sandboxProfileIdFrom(args);
  const resolvedSandbox = sandboxProfileId ? showSandboxProfileCli(sandboxProfileId, args) : undefined;
  const app = loadWorkflowApp(appId);
  const run = plan(app, planOptions);
  const status = summarizeOperatorRun(loadRunFromCwd(run.id, run.cwd)) as unknown as Record<string, unknown>;
  const appMeta = (run.workflow.app || {}) as Record<string, unknown>;
  return {
    runId: run.id,
    workflowId: run.workflow.id,
    appId: (appMeta.id as string) || appId,
    appVersion: appMeta.version,
    statePath: run.paths.state,
    reportPath: run.paths.report,
    pendingTasks: run.tasks.filter((task) => task.status === "pending").length,
    operatorStatus: status,
    nextActions: status.nextActions,
    sandboxProfileId,
    sandboxProfile: resolvedSandbox,
  };
}
