// Shared capability core: the SINGLE source of truth for composite capabilities
// whose payload is assembled from more than one orchestrator call.
//
// BSD discipline (mechanism vs policy): these functions are MECHANISM. They live
// here — never in cli.ts or mcp-server.ts — so the CLI and the MCP surface are
// two renderings of ONE data source. Any capability that composes multiple
// runner calls (plan summary, app run, sandbox choice, commit envelope) MUST be
// expressed here and called identically by both surfaces. A composite that lives
// in only one surface is exactly the cross-surface drift v0.1.27 forbids.
//
// See docs/cli-mcp-parity.7.md and src/capability-registry.ts.

import { CoolWorkflowRunner } from "./orchestrator";
import { OperatorRecommendation, OperatorRunSummary } from "./operator-ux";

// ---- canonical plan payload -----------------------------------------------
// Both `cw plan` (default + --json) and `cw_plan` resolve to this exact object.
export function planSummary(
  runner: CoolWorkflowRunner,
  workflowId: string,
  options: Record<string, unknown>
): Record<string, unknown> {
  const run = runner.plan(workflowId, options);
  return {
    runId: run.id,
    workflowId: run.workflow.id,
    statePath: run.paths.state,
    reportPath: run.paths.report,
    pendingTasks: run.tasks.filter((task) => task.status === "pending").length
  };
}

// ---- canonical app-run payload --------------------------------------------
// Both `cw app run` and `cw_app_run` resolve to this exact object. Structured
// app inputs + optional sandbox resolution, then a compact operator status.
export function appRun(runner: CoolWorkflowRunner, args: Record<string, unknown>): Record<string, unknown> {
  const appId = String(args.appId || args.workflowId || "");
  const inputs = isRecord(args.inputs) ? args.inputs : {};
  const planOptions = { ...inputs, ...withoutRuntimeKeys(args) };
  const sandboxProfileId = sandboxProfileIdFrom(args);
  const resolvedSandbox = sandboxProfileId ? runner.showSandboxProfile(sandboxProfileId, args) : undefined;
  const run = runner.plan(appId, planOptions);
  const status = runner.operatorStatus(run.id);
  return {
    runId: run.id,
    workflowId: run.workflow.id,
    appId: run.workflow.app?.id || appId,
    appVersion: run.workflow.app?.version,
    statePath: run.paths.state,
    reportPath: run.paths.report,
    pendingTasks: run.tasks.filter((task) => task.status === "pending").length,
    operatorStatus: compactOperatorStatus(status),
    nextActions: status.nextActions,
    sandboxProfileId,
    sandboxProfile: resolvedSandbox
  };
}

// ---- canonical sandbox choice payload -------------------------------------
// Both `cw sandbox choose|resolve` and `cw_sandbox_choose|cw_sandbox_resolve`
// resolve to this exact object.
export function sandboxChoose(runner: CoolWorkflowRunner, args: Record<string, unknown>): Record<string, unknown> {
  const profileId = sandboxProfileIdFrom(args) || "readonly";
  const profile = runner.showSandboxProfile(profileId, args);
  return {
    profileId,
    sandboxProfileId: profile.id,
    valid: true,
    profile
  };
}

// ---- canonical commit envelope --------------------------------------------
// `cw_commit` resolves to this operator-facing envelope. The CLI `commit`
// command intentionally emits the raw StateCommitResult for scripting; both
// derive from the single core entry runner.commit (declared, not drift — see
// the capability registry's `commit` descriptor).
export function commitEnvelope(
  runner: CoolWorkflowRunner,
  runId: string,
  args: Record<string, unknown>
): Record<string, unknown> {
  const result = runner.commit(runId, args);
  const commit = result.commit;
  const status = runner.operatorStatus(runId);
  return {
    runId,
    commitId: commit.id,
    verifierGated: commit.verifierGated,
    checkpoint: commit.checkpoint,
    verifierNodeId: commit.verifierNodeId,
    candidateId: commit.candidateId,
    selectionId: commit.selectionId,
    evidenceCount: (commit.evidence || []).length,
    snapshotPath: commit.snapshotPath,
    nextActions: status.nextActions,
    commit
  };
}

export function compactOperatorStatus(status: OperatorRunSummary): Record<string, unknown> {
  return {
    runId: status.runId,
    workflowId: status.workflowId,
    appId: status.appId,
    appVersion: status.appVersion,
    loopStage: status.loopStage,
    activePhase: status.activePhase,
    blocked: status.blocked,
    blockedReasons: status.blockedReasons,
    pendingTasks: status.tasks.pending.length,
    runningTasks: status.tasks.running.length,
    completedTasks: status.tasks.completed.length,
    nextActions: status.nextActions as OperatorRecommendation[]
  };
}

// ---- shared argument helpers ----------------------------------------------
export function sandboxProfileIdFrom(args: Record<string, unknown>): string | undefined {
  return optionalString(args.sandbox || args.sandboxProfile || args.sandboxProfileId || args.profileId);
}

export function withoutRuntimeKeys(args: Record<string, unknown>): Record<string, unknown> {
  const copy = { ...args };
  for (const key of ["appId", "workflowId", "inputs", "sandbox", "sandboxProfile", "sandboxProfileId", "profileId"]) {
    delete copy[key];
  }
  return copy;
}

export function optionalString(value: unknown): string | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  return String(value);
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
