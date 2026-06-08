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
import { RunRegistry, isRunLifecycleState } from "./run-registry";
import { deriveMetricsSummary, loadCostPolicy, loadPersistedMetricsFingerprint, SummaryRunInput } from "./observability";
import { loadRunStateFile, readJson, writeJson } from "./state";
import fs from "node:fs";
import {
  DEFAULT_SCHEDULING_POLICY,
  normalizeSchedulingPolicy,
  planSchedule,
  applyLease,
  leaseRelease,
  leaseComplete,
  reclaimExpired,
  resetEntry
} from "./scheduling";
import { SchedulingPolicy, SchedulingPolicyReport } from "./types";
import {
  MetricsSummaryReport,
  RunHistoryResult,
  RunLifecycleState,
  RunQueueEntry,
  RunRegistryReport,
  RunRerunResult,
  RunResumeResult,
  RunSearchResult,
  RunShowResult
} from "./types";

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

// ---- run registry / control plane (v0.1.28) -------------------------------
// MECHANISM, ONE SOURCE: the CLI and MCP surfaces both route through these
// functions so `cw <cmd> --json` is byte-identical to `cw_<tool>`. Each accepts
// the raw CLI options OR the raw MCP arguments and normalizes them identically,
// then calls the single RunRegistry method. The registry is constructed from the
// same resolved cwd on both surfaces (CLI: --cwd|process.cwd(); MCP chdir'd to
// args.cwd), so repo/home roots line up.

export function runRegistryFor(args: Record<string, unknown>, planner: CoolWorkflowRunner): RunRegistry {
  return new RunRegistry(String(args.cwd || process.cwd()), planner);
}

function scopeOf(args: Record<string, unknown>, fallback: "repo" | "home"): "repo" | "home" {
  if (args.scope === "repo") return "repo";
  if (args.scope === "home") return "home";
  return fallback;
}

function lifecycleOf(value: unknown): RunLifecycleState | undefined {
  return isRunLifecycleState(value) ? value : undefined;
}

function flag(value: unknown): boolean | undefined {
  if (value === undefined) return undefined;
  if (value === false || value === "false" || value === "no" || value === "0") return false;
  return Boolean(value);
}

export function runRegistryRefresh(reg: RunRegistry, args: Record<string, unknown>): RunRegistryReport {
  return reg.refresh({ scope: scopeOf(args, "repo") });
}

export function runRegistryShow(reg: RunRegistry, args: Record<string, unknown>): RunRegistryReport {
  return reg.show({ scope: scopeOf(args, "repo") });
}

export function runSearch(reg: RunRegistry, args: Record<string, unknown>): RunSearchResult {
  return reg.search({
    scope: scopeOf(args, "home"),
    text: optionalString(args.text || args.q || args.query),
    app: optionalString(args.app || args.appId),
    status: lifecycleOf(args.status),
    repo: optionalString(args.repo),
    since: optionalString(args.since),
    until: optionalString(args.until),
    includeArchived: flag(args.includeArchived ?? args["include-archived"]),
    limit: args.limit === undefined ? undefined : Number(args.limit),
    offset: args.offset === undefined ? undefined : Number(args.offset)
  });
}

export function runList(reg: RunRegistry, args: Record<string, unknown>): RunSearchResult {
  return reg.list({
    scope: scopeOf(args, "home"),
    includeArchived: flag(args.includeArchived ?? args["include-archived"]),
    limit: args.limit === undefined ? undefined : Number(args.limit),
    offset: args.offset === undefined ? undefined : Number(args.offset)
  });
}

export function runShow(reg: RunRegistry, runId: string, args: Record<string, unknown>): RunShowResult {
  return reg.showRun(runId, { scope: scopeOf(args, "home") });
}

export function runResume(reg: RunRegistry, runId: string, args: Record<string, unknown>): RunResumeResult {
  return reg.resume(runId, {
    scope: scopeOf(args, "home"),
    limit: args.limit === undefined ? undefined : Number(args.limit)
  });
}

export function runArchive(reg: RunRegistry, runId: string | undefined, args: Record<string, unknown>): unknown {
  if (runId) {
    return reg.archive(runId, {
      scope: scopeOf(args, "home"),
      reason: optionalString(args.reason),
      unarchive: flag(args.unarchive)
    });
  }
  const days = Number(args.olderThanDays ?? args["older-than-days"]);
  const states = parseLifecycleList(args.state ?? args.status);
  return reg.archiveByPolicy(
    {
      schemaVersion: 1,
      archiveOlderThanDays: Number.isFinite(days) ? days : 0,
      archiveStates: states.length ? states : ["completed", "failed"],
      defaultQueuePriority: 100
    },
    { scope: scopeOf(args, "home") }
  );
}

export function runRerun(reg: RunRegistry, runId: string, args: Record<string, unknown>): RunRerunResult {
  return reg.rerun(runId, { scope: scopeOf(args, "home"), reason: optionalString(args.reason) });
}

export function queueAdd(reg: RunRegistry, args: Record<string, unknown>): unknown {
  return reg.queueAdd({
    runId: optionalString(args.runId),
    appId: optionalString(args.appId || args.app),
    workflowId: optionalString(args.workflowId || args.workflow),
    repo: optionalString(args.repo),
    priority: args.priority === undefined ? undefined : Number(args.priority),
    note: optionalString(args.note),
    id: optionalString(args.id)
  });
}

export function queueList(reg: RunRegistry, args: Record<string, unknown>): { schemaVersion: 1; total: number; entries: RunQueueEntry[] } {
  const status = optionalString(args.status);
  return reg.queueList({
    status: status as RunQueueEntry["status"] | undefined,
    repo: optionalString(args.repo)
  });
}

export function queueDrain(reg: RunRegistry, args: Record<string, unknown>): unknown {
  return reg.queueDrain({
    limit: args.limit === undefined ? undefined : Number(args.limit),
    repo: optionalString(args.repo)
  });
}

export function queueShow(reg: RunRegistry, id: string): unknown {
  return reg.queueShow(id);
}

// ---- control-plane scheduling (v0.1.37) -----------------------------------
function loadSchedulingPolicy(reg: RunRegistry): { policy: SchedulingPolicy; source: "default" | "file" } {
  const file = reg.schedulingPolicyPath();
  if (fs.existsSync(file)) {
    try {
      return { policy: normalizeSchedulingPolicy(readJson(file) as Partial<SchedulingPolicy>), source: "file" };
    } catch {
      /* fall through to default */
    }
  }
  return { policy: DEFAULT_SCHEDULING_POLICY, source: "default" };
}
function schedNow(args: Record<string, unknown>): string {
  return optionalString(args.now) || new Date().toISOString();
}
function isTrue(value: unknown): boolean {
  return value === true || value === "true" || value === "1";
}

export function schedPlan(reg: RunRegistry, args: Record<string, unknown>): unknown {
  return planSchedule(reg.loadQueueEntries(), loadSchedulingPolicy(reg).policy, schedNow(args));
}
export function schedLease(reg: RunRegistry, args: Record<string, unknown>): unknown {
  const now = schedNow(args);
  const policy = loadSchedulingPolicy(reg).policy;
  const limit = args.limit === undefined ? undefined : Number(args.limit);
  const { entries, leases } = applyLease(reg.loadQueueEntries(), policy, now, limit);
  reg.saveQueueEntries(entries);
  return { schemaVersion: 1, now, granted: leases.length, leases };
}
export function schedRelease(reg: RunRegistry, args: Record<string, unknown>): unknown {
  const now = schedNow(args);
  const failed = isTrue(args.failed);
  const { entries, matched } = leaseRelease(reg.loadQueueEntries(), String(args.leaseId || ""), loadSchedulingPolicy(reg).policy, now, {
    failed,
    reason: optionalString(args.reason)
  });
  if (!matched) throw new Error(`No active lease to release: ${args.leaseId}`);
  reg.saveQueueEntries(entries);
  return { schemaVersion: 1, released: String(args.leaseId || ""), failed };
}
export function schedComplete(reg: RunRegistry, args: Record<string, unknown>): unknown {
  const { entries, matched } = leaseComplete(reg.loadQueueEntries(), String(args.leaseId || ""), schedNow(args));
  if (!matched) throw new Error(`No active lease to complete: ${args.leaseId}`);
  reg.saveQueueEntries(entries);
  return { schemaVersion: 1, completed: String(args.leaseId || "") };
}
export function schedReclaim(reg: RunRegistry, args: Record<string, unknown>): unknown {
  const now = schedNow(args);
  const { entries, reclaimed } = reclaimExpired(reg.loadQueueEntries(), loadSchedulingPolicy(reg).policy, now);
  reg.saveQueueEntries(entries);
  return { schemaVersion: 1, now, reclaimed };
}
export function schedReset(reg: RunRegistry, args: Record<string, unknown>): unknown {
  const { entries, matched } = resetEntry(reg.loadQueueEntries(), String(args.id || ""));
  if (!matched) throw new Error(`No parked entry to reset: ${args.id}`);
  reg.saveQueueEntries(entries);
  return { schemaVersion: 1, reset: String(args.id || "") };
}
export function schedPolicyShow(reg: RunRegistry): SchedulingPolicyReport {
  const { policy, source } = loadSchedulingPolicy(reg);
  return { schemaVersion: 1, policy, source };
}
export function schedPolicySet(reg: RunRegistry, args: Record<string, unknown>): SchedulingPolicyReport {
  const current = loadSchedulingPolicy(reg).policy;
  const patch: Partial<SchedulingPolicy> = {};
  for (const key of ["maxConcurrent", "maxAttempts", "leaseTtlMs", "backoffBaseMs", "backoffFactor", "backoffCapMs"] as const) {
    if (args[key] !== undefined) patch[key] = Number(args[key]);
  }
  const policy = normalizeSchedulingPolicy({ ...current, ...patch });
  writeJson(reg.schedulingPolicyPath(), policy);
  return { schemaVersion: 1, policy, source: "file" };
}

export function runHistory(reg: RunRegistry, args: Record<string, unknown>): RunHistoryResult {
  return reg.history({
    scope: scopeOf(args, "home"),
    app: optionalString(args.app || args.appId),
    status: lifecycleOf(args.status),
    limit: args.limit === undefined ? undefined : Number(args.limit),
    offset: args.offset === undefined ? undefined : Number(args.offset)
  });
}

// ---- observability + cost accounting (v0.1.31) ----------------------------
// MECHANISM, ONE SOURCE: both `cw metrics summary --json` and `cw_metrics_summary`
// route through this function. It enumerates the v0.1.28 registry (derived live
// from source), loads each run's durable state, and DERIVES the cross-repo
// rollup. Runs whose source is unreadable are counted in `unreadableRuns` (fail
// closed), never silently dropped. Pricing is POLICY via `--pricing`; `now` is
// injectable via `args.now` for eval/replay determinism.
export function metricsSummary(
  reg: RunRegistry,
  runner: CoolWorkflowRunner,
  args: Record<string, unknown>
): MetricsSummaryReport {
  const scope = scopeOf(args, "repo");
  const report = reg.show({ scope });
  const policy = loadCostPolicy(args, runner.pluginRoot);
  const now = optionalString(args.now) || new Date().toISOString();
  const inputs: SummaryRunInput[] = [];
  let unreadableRuns = 0;
  for (const record of report.index.records) {
    try {
      const loaded = loadRunStateFile(record.statePath, { dryRun: true });
      if (loaded.report.status === "unsupported") {
        unreadableRuns++;
        continue;
      }
      inputs.push({
        run: loaded.run,
        repo: record.repo,
        persistedFingerprint: loadPersistedMetricsFingerprint(loaded.run)
      });
    } catch {
      unreadableRuns++;
    }
  }
  return deriveMetricsSummary(inputs, { now, scope, policy, unreadableRuns });
}

function parseLifecycleList(value: unknown): RunLifecycleState[] {
  const raw = Array.isArray(value) ? value : value === undefined ? [] : [value];
  const out: RunLifecycleState[] = [];
  for (const item of raw) {
    if (isRunLifecycleState(item)) out.push(item);
  }
  return out;
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
