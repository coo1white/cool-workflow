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
// Capability metadata (which entry is on which surface, tool names, jsonMode) is
// declared in ONE place — the BUILTIN_CAPABILITIES table in capability-registry.ts,
// the single source of truth both surfaces and the parity gate read. New
// capabilities add a row there. (A v0.1.46 "self-register at load time" mechanism
// was removed: the registry snapshot was taken before those registrations ran, so
// they were silently dead duplicates of the table — see capability-registry.ts.)
//
// See docs/cli-mcp-parity.7.md and src/capability-registry.ts.

import { CoolWorkflowRunner } from "./orchestrator";
import { drive, drivePreview } from "./drive";
import { agentConfigShow, setAgentConfigFile, resolveAgentConfig, AgentConfigShowResult } from "./agent-config";
import { DrivePreview, DriveResult, QuickstartResult } from "./types";
import { OperatorRecommendation, OperatorRunSummary } from "./operator-ux";
import { RunRegistry, isRunLifecycleState } from "./run-registry";
import { deriveMetricsSummary, loadCostPolicy, loadPersistedMetricsFingerprint, SummaryRunInput } from "./observability";
import { verifyTelemetryLedger } from "./telemetry-ledger";
import { resolveTrustPublicKey, verifyTelemetrySignatures } from "./telemetry-attestation";
import { verifyTrustAudit } from "./trust-audit";
import { runTamperDemo, TelemetryVerifyResult } from "./telemetry-demo";
import { loadRunStateFile, readJson, writeJson } from "./state";
import { ArchiveInspectResult, ReportBundleVerification, exportRun, importRun, inspectArchive, verifyImportedRun, verifyReportBundle } from "./run-export";
import fs from "node:fs";
import path from "node:path";
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
  GcPlanResult,
  GcRunResult,
  GcVerifyResult,
  MetricsSummaryReport,
  RunHistoryResult,
  RunLifecycleState,
  RunQueueEntry,
  RunRegistryPolicy,
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

// F7: explicit invocation cwd — no more process.chdir bracket.
// The runner resolves a run from process.cwd() by default; to operate WITH a run's
// repo as base (run --drive --repo X from anywhere; cross-directory quickstart; run
// import/export against a target dir) we now pass that base EXPLICITLY —
// runner.withBaseDir(dir).loadRun(...) for run resolution (see
// CoolWorkflowRunner.withBaseDir), and invocationCwd(args) to anchor relative path
// args. Nothing mutates the global process.cwd(), so concurrent in-process callers
// can no longer corrupt each other's working directory (the former reentrancy hazard).
function invocationCwd(args: Record<string, unknown>): string {
  return path.resolve(optionalString(args.cwd) || process.cwd());
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

export function runResume(reg: RunRegistry, runner: CoolWorkflowRunner, runId: string, args: Record<string, unknown>): RunResumeResult {
  const base = reg.resume(runId, {
    scope: scopeOf(args, "home"),
    limit: args.limit === undefined ? undefined : Number(args.limit)
  });
  // Default (no --drive/--once): read-only, byte-identical to before.
  if (!isTrue(args.drive) && !isTrue(args.once)) return base;
  // Opt-in continuation: hand the resolved run to the EXISTING agent-delegation
  // drive loop (re-plans nothing; picks up pending/running tasks from durable
  // state). An unconfigured agent surfaces drive.status="blocked" (fail-closed).
  const drive = runDrive(runner, { ...args, runId: base.runId, repo: base.repo, once: isTrue(args.once) });
  return { ...base, drive };
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

export function runExportArchive(runner: CoolWorkflowRunner, runId: string, args: Record<string, unknown>): unknown {
  const base = invocationCwd(args);
  const output = optionalString(args.output || args.path || args.archive) || `${runId}.cwrun.json`;
  // Optionally seal in the operator's PUBLIC trust key so the bundle re-verifies
  // offline. Default falls back to the same env the verify gate reads, so a single
  // configured key both attests at record-time and travels with the export.
  const trustPublicKey = optionalString(args["with-trust-key"] || args.withTrustKey || args.trustKey || args.pubkey) || process.env.CW_AGENT_ATTEST_PUBKEY;
  return exportRun(runner.withBaseDir(optionalString(args.cwd)).loadRun(runId), path.resolve(base, output), { trustPublicKey });
}

export function runImportArchive(runner: CoolWorkflowRunner, args: Record<string, unknown>): unknown {
  const base = invocationCwd(args);
  const archive = optionalString(args.archive || args.path || args.file);
  if (!archive) throw new Error("run import requires an archive path (positional, --archive, --path, or --file)");
  const target = path.resolve(base, optionalString(args.target || args.repo || args.cwd) || base);
  const imported = importRun(path.resolve(base, archive), target);
  const registry = new RunRegistry(target, runner.withBaseDir(target));
  const registryReport = registry.refresh({ scope: "repo" });
  return { ...imported, registry: registryReport };
}

// Read-only: inspect a portable archive's integrity WITHOUT importing it. Routes
// both surfaces through one shared core entry. The runner is unused (no registry
// touch — inspection writes nothing) but kept for dispatch-signature symmetry.
export function runInspectArchive(_runner: CoolWorkflowRunner, args: Record<string, unknown>): ArchiveInspectResult {
  const base = invocationCwd(args);
  const archive = optionalString(args.archive || args.path || args.file);
  if (!archive) throw new Error("run inspect-archive requires an archive path (positional, --archive, --path, or --file)");
  return inspectArchive(path.resolve(base, archive));
}

export function runVerifyImport(runner: CoolWorkflowRunner, runId: string, args: Record<string, unknown>): unknown {
  return verifyImportedRun(runner.withBaseDir(optionalString(args.cwd)).loadRun(runId));
}

export interface ReportBundleResult {
  schemaVersion: number;
  runId: string;
  archivePath: string;
  trustKeyEmbedded: boolean;
  reportExtractedTo?: string;
  verification: ReportBundleVerification;
  // The producer's go/no-go: the bundle was written AND it self-verifies the same
  // way a recipient will. False means do not ship this artifact.
  ok: boolean;
}

// Produce-and-prove: export a run to a portable bundle sealed with the operator's
// trust key (defaulting to CW_AGENT_ATTEST_PUBKEY, same as `run export`), then
// IMMEDIATELY verify the artifact offline the way a recipient will. The producer
// learns now — fail-closed — whether the bundle a client will check is actually
// verifiable (e.g. an unconfigured attest key yields an unverifiable bundle). Pure
// composition of runExportArchive + verifyReportBundle; spawns nothing, writes only
// the archive (and, with --extract-report, the human report) that `run export` would.
export function reportBundle(runner: CoolWorkflowRunner, runId: string, args: Record<string, unknown>): ReportBundleResult {
  const exported = runExportArchive(runner, runId, args) as { path: string; trustKeyEmbedded: boolean };
  const base = invocationCwd(args);
  const extractReportTo = optionalString(args["extract-report"] || args.extractReport || args.extractReportTo);
  const verification = verifyReportBundle(exported.path, {
    pubkey: optionalString(args.pubkey || args.pubKey || args.publicKey),
    extractReportTo: extractReportTo ? path.resolve(base, extractReportTo) : undefined,
    strictSignatures: Boolean(args["strict-signatures"] || args.strictSignatures || args.strictSigs)
  });
  return {
    schemaVersion: 1,
    runId,
    archivePath: exported.path,
    trustKeyEmbedded: exported.trustKeyEmbedded,
    reportExtractedTo: verification.reportExtractedTo,
    verification,
    ok: verification.ok
  };
}

// Read-only: verify a portable run bundle OFFLINE and self-contained (archive bytes
// + telemetry chain + trust-audit chain + embedded-key signatures). The runner is
// unused — verification restores into its own throwaway tmpdir and writes nothing to
// any registry — but kept for dispatch-signature symmetry with the other run verbs.
export function runVerifyReportBundle(_runner: CoolWorkflowRunner, args: Record<string, unknown>): ReportBundleVerification {
  const base = invocationCwd(args);
  const archive = optionalString(args.archive || args.path || args.file || args.bundle);
  if (!archive) throw new Error("report verify-bundle requires a bundle path (positional, --archive, --path, --file, or --bundle)");
  const extractReportTo = optionalString(args["extract-report"] || args.extractReport || args.extractReportTo);
  return verifyReportBundle(path.resolve(base, archive), {
    pubkey: optionalString(args.pubkey || args.pubKey || args.publicKey),
    extractReportTo: extractReportTo ? path.resolve(base, extractReportTo) : undefined,
    strictSignatures: Boolean(args["strict-signatures"] || args.strictSignatures || args.strictSigs)
  });
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
  // Absent policy => conservative DEFAULT (an unconfigured backend, which §4
  // permits). But a PRESENT-but-corrupt policy must fail closed: silently
  // substituting defaults would schedule under settings the operator never
  // chose while their broken file sits on disk. Let readJson's throw surface it.
  if (fs.existsSync(file)) {
    return { policy: normalizeSchedulingPolicy(readJson(file) as Partial<SchedulingPolicy>), source: "file" };
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
    if (args[key] === undefined) continue;
    // Fail closed on a non-numeric flag instead of letting normalizeSchedulingPolicy
    // silently substitute the DEFAULT (which would report source:"file" + exit 0,
    // so the operator believes they set a value they didn't). Matches the
    // Number.isFinite guard the sibling reclaimPolicyFrom already uses.
    const value = Number(args[key]);
    if (!Number.isFinite(value)) {
      throw new Error(`Invalid --${key} "${String(args[key])}": expected a number (e.g. --${key} 4)`);
    }
    patch[key] = value;
  }
  const policy = normalizeSchedulingPolicy({ ...current, ...patch });
  writeJson(reg.schedulingPolicyPath(), policy);
  return { schemaVersion: 1, policy, source: "file" };
}

// ---- agent delegation drive (v0.1.38) -------------------------------------
// MECHANISM, ONE SOURCE: both surfaces route drive/preview/config through these.
// The read-only preview + config-show payloads are deterministic (counts from
// state, host-stable config path) with NO now-derived numeric field, so
// `cw <cmd> --json` is byte-identical to `cw_<tool>`.

/** Read-only, deterministic preview of a run's NEXT drive step. */
export function runDrivePreview(runner: CoolWorkflowRunner, args: Record<string, unknown>): DrivePreview {
  return drivePreview(runner, String(args.runId || ""), args);
}

const DRIVE_RUNTIME_KEYS = [
  "once",
  "now",
  "preview",
  "step",
  "drive",
  "json",
  "format",
  "run",
  "runId",
  "cwd",
  "agentCommand",
  "agent-command",
  "agentArgs",
  "agent-args",
  "agentEndpoint",
  "agent-endpoint",
  "agentModel",
  "agent-model",
  "agentTimeoutMs",
  "agent-timeout-ms",
  "resume"
];

function planInputsFor(args: Record<string, unknown>): Record<string, unknown> {
  const copy = withoutRuntimeKeys(args);
  for (const key of DRIVE_RUNTIME_KEYS) delete copy[key];
  return copy;
}

/** Mutating drive step/run. Plans a fresh run for an app id, or continues a run id.
 *  The agent hop goes ONLY through the agent backend; this composes existing verbs.
 *
 *  The run lives under its repo's `.cw/` and every runner verb resolves a run from
 *  the process cwd, so the drive operates WITH the run's repo as cwd (exactly how
 *  the golden path runs each verb from the repo dir) — then restores cwd. This lets
 *  `cw run <app> --drive --repo X` work when invoked from anywhere. */
export function runDrive(runner: CoolWorkflowRunner, args: Record<string, unknown>): DriveResult {
  let runId = optionalString(args.runId || args.run);
  let repoCwd = optionalString(args.repo);
  if (!runId) {
    const appId = String(args.appId || args.workflowId || args.app || "");
    if (!appId) throw new Error("run --drive requires an app id (or --run <run-id> to continue)");
    const run = runner.plan(appId, planInputsFor(args));
    runId = run.id;
    repoCwd = run.cwd;
  }
  // The runner resolves the run from its baseDir, so the drive must run WITH the
  // run's repo as base. Pass it explicitly via withBaseDir (F7 — no process.chdir).
  const target = repoCwd && fs.existsSync(repoCwd) ? repoCwd : undefined;
  const driveRunId = runId;
  return drive(runner.withBaseDir(target), driveRunId, {
    once: isTrue(args.once),
    now: optionalString(args.now),
    args
  });
}

/** The app the one-command quickstart plans when none is named. */
export const QUICKSTART_DEFAULT_APP = "architecture-review";

/** ONE-COMMAND quickstart (v0.1.38+): plan(app) -> run --drive -> report in a single
 *  invocation, so a newcomer gets a cited risk report from one command on a target
 *  repo. This is a THIN UX wrapper — NOT a new engine: it composes the EXISTING
 *  `runDrive` core (which already plans the run, then delegates every worker to the
 *  configured agent backend and commits) and then writes the report. It introduces
 *  no second executor, queue, or scheduler, and imports no model SDK.
 *
 *  RED LINE (DIRECTION.md): worker execution still DELEGATES to the operator's own
 *  agent backend (claude -p / codex exec / HTTP endpoint). With no agent configured
 *  the drive fails closed (status=blocked) and we never fabricate a completion. */
export function quickstart(runner: CoolWorkflowRunner, args: Record<string, unknown>): QuickstartResult | DrivePreview {
  const appId = String(args.appId || args.app || args.workflowId || QUICKSTART_DEFAULT_APP);
  const agentConfigured = Boolean(resolveAgentConfig(args).command || resolveAgentConfig(args).endpoint);
  // `--resume`: a discoverability flag over the existing continuation. With no
  // `--run`, advance exactly ONE step (reuse the `--once` path) and print a
  // copy-pasteable continue line; with `--run <id>`, continue that run to
  // completion (the default drive). It adds no new execution path.
  const resume = isTrue(args.resume);
  const resumeRunId = resume ? optionalString(args.runId || args.run) : undefined;

  // `--preview`: read-only, deterministic next-step projection (no spawn, no commit).
  // Plan a fresh run (the read-only first verb) then project the next drive step.
  if (isTrue(args.preview)) {
    let runId = optionalString(args.runId || args.run);
    let repoCwd = optionalString(args.repo);
    if (!runId) {
      const run = runner.plan(appId, planInputsFor(args));
      runId = run.id;
      repoCwd = run.cwd;
    }
    const previewRunId = runId;
    const target = repoCwd && fs.existsSync(repoCwd) ? repoCwd : undefined;
    return drivePreview(runner.withBaseDir(target), previewRunId, args);
  }

  // Drive end-to-end (or one `--once` step). runDrive plans the run, delegates each
  // worker to the agent backend, and commits — we add only the report write + a
  // single assembled payload. No orchestration is duplicated here.
  // `--resume` with no run id advances a single step so a newcomer WITNESSES the
  // stop-then-resume; with a run id it continues to completion. Non-resume paths
  // are untouched (byte-identical default).
  const result = runDrive(runner, { ...args, appId, ...(resume && !resumeRunId ? { once: true } : {}) });

  // Always (re)write the report so the one command yields a report.md on disk, even
  // when the drive blocked/parked (a partial report is still useful triage).
  //
  // runDrive restored cwd, so the runs root would resolve against the CALLER's cwd
  // here — orphaning the run when quickstart is invoked cross-directory (cwd =
  // plugin dir, --repo elsewhere: the README's headline command). The run's
  // statePath (<repo>/.cw/runs/<id>/state.json) is authoritative however the run
  // was planned or continued; resolve to ITS repo BEFORE any run read, reentrant-safe.
  const runRepoCwd = path.resolve(path.dirname(result.statePath), "..", "..", "..");
  const reportTarget = fs.existsSync(runRepoCwd) ? runRepoCwd : undefined;
  const reportPath = runner.withBaseDir(reportTarget).report(result.runId).path;

  let hint: string | undefined;
  if (!agentConfigured) {
    hint =
      "agent backend not configured — set CW_AGENT_COMMAND (e.g. \"claude -p\") or pass --agent-command, then re-run. The one command DELEGATES worker execution to YOUR agent; it never executes a model itself.";
  } else if (result.status === "parked") {
    hint = `a worker parked past its retry budget — inspect: cw run show ${result.runId}`;
  } else if (result.status === "blocked") {
    hint = `the drive is blocked — inspect: cw run drive ${result.runId}`;
  } else if (result.status === "in-progress") {
    hint = resume
      ? `one step advanced — continue: cw quickstart ${appId} --run ${result.runId} --resume`
      : `one step advanced (--once) — continue: cw quickstart ${appId} --run ${result.runId} --once`;
  }

  return {
    schemaVersion: 1,
    appId,
    runId: result.runId,
    workflowId: result.workflowId,
    status: result.status,
    plannedWorkers: result.plannedWorkers,
    completedWorkers: result.completedWorkers,
    parkedWorkers: result.parkedWorkers,
    commitId: result.commitId,
    reportPath,
    statePath: result.statePath,
    agentConfigured,
    steps: result.steps,
    hint,
    // Stamp resumedFrom ONLY when we continued an explicit run. Conditional spread
    // keeps the key absent on the default/fresh path (own-property absent + omitted
    // by JSON.stringify), so default output is byte-identical.
    ...(resumeRunId ? { resumedFrom: resumeRunId } : {})
  };
}

/** Read-only, deterministic projection of the effective agent config (secret-stripped). */
export function backendAgentConfigShow(args: Record<string, unknown>): AgentConfigShowResult {
  return agentConfigShow(args);
}

/** Persist the durable agent config (secret-stripped) and return the new state. */
export function backendAgentConfigSet(args: Record<string, unknown>): AgentConfigShowResult {
  setAgentConfigFile(args);
  return agentConfigShow(args);
}

// ---- run retention & provable reclamation (v0.1.39) -----------------------
// MECHANISM, ONE SOURCE: both surfaces route gc plan/run/verify through these.
// `gc plan`/`gc verify` are read-only + deterministic (only `generatedAt` is
// now-derived ISO, allowed by the parity rule); `gc run` is the disk-freeing tier.
function reclaimPolicyFrom(args: Record<string, unknown>): Partial<RunRegistryPolicy> {
  const policy: Partial<RunRegistryPolicy> = {};
  const days = Number(args.reclaimAfterArchiveDays ?? args["reclaim-after-archive-days"] ?? args.olderThanDays ?? args["older-than-days"]);
  if (Number.isFinite(days)) policy.reclaimAfterArchiveDays = days;
  const keepScratch = flag(args.keepScratch ?? args["keep-scratch"]);
  if (keepScratch !== undefined) policy.keepScratch = keepScratch;
  const keepSnapshots = flag(args.keepSnapshots ?? args["keep-snapshots"]);
  if (keepSnapshots !== undefined) policy.keepSnapshots = keepSnapshots;
  const maxRuns = Number(args.maxReclaimRuns ?? args["max-reclaim-runs"]);
  if (Number.isFinite(maxRuns)) policy.maxReclaimRuns = maxRuns;
  const maxBytes = Number(args.maxReclaimBytes ?? args["max-reclaim-bytes"]);
  if (Number.isFinite(maxBytes)) policy.maxReclaimBytes = maxBytes;
  const states = parseLifecycleList(args.state ?? args.status);
  if (states.length) policy.reclaimStates = states;
  return policy;
}

export function gcPlan(reg: RunRegistry, runId: string | undefined, args: Record<string, unknown>): GcPlanResult {
  return reg.gcPlan({ scope: scopeOf(args, "home"), runId: runId || optionalString(args.runId), policy: reclaimPolicyFrom(args), now: optionalString(args.now) });
}

export function gcRun(reg: RunRegistry, runId: string | undefined, args: Record<string, unknown>): GcRunResult {
  return reg.gcRun({
    scope: scopeOf(args, "home"),
    runId: runId || optionalString(args.runId),
    policy: reclaimPolicyFrom(args),
    now: optionalString(args.now),
    actor: optionalString(args.actor),
    limit: args.limit === undefined ? undefined : Number(args.limit)
  });
}

export function gcVerify(reg: RunRegistry, runId: string, args: Record<string, unknown>): GcVerifyResult {
  return reg.gcVerify(runId, { scope: scopeOf(args, "home") });
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

// ---- telemetry attestation: read-only ledger verification (Track 1) --------
// Re-prove a run's telemetry chain offline: prevHash linkage + independent per-
// record hash recompute (never trusts the stored hash). The auditable claim made
// inspectable on demand — anyone can run this; a forged/edited record fails it.
export function telemetryVerify(runner: CoolWorkflowRunner, args: Record<string, unknown>): TelemetryVerifyResult {
  const runId = optionalString(args.runId || args.run);
  if (!runId) throw new Error("telemetry verify requires a run id (cw telemetry verify <run-id>)");
  const run = runner.loadRun(runId);
  const v = verifyTelemetryLedger(run);
  // Opt-in independent signature re-verification. verifyTelemetryLedger re-proves
  // the chain (so the stored attestation verdicts were not edited); supplying the
  // trust public key (--pubkey / CW_AGENT_ATTEST_PUBKEY) additionally RE-RUNS the
  // ed25519 check over each `attested` record's stored raw usage rather than
  // trusting that verdict, so a forged signature can no longer ride a green chain.
  const trustPublicKeyInput = optionalString(args.pubkey || args.pubKey || args.publicKey) || process.env.CW_AGENT_ATTEST_PUBKEY;
  const trustPublicKey = resolveTrustPublicKey(trustPublicKeyInput);
  const keyChecks = trustPublicKeyInput && !trustPublicKey
    ? [{ name: "signature-key", pass: false, code: "telemetry-pubkey-unreadable" }]
    : [];
  const sig = verifyTelemetrySignatures(v.records, trustPublicKey);
  const failedChecks = [...v.checks.filter((c) => !c.pass), ...keyChecks, ...sig.checks.filter((c) => !c.pass)];
  return {
    schemaVersion: 1,
    runId: run.id,
    present: v.present,
    // Chain integrity AND (when a key was supplied) every attested signature must
    // re-verify. With no key, sig.failed is 0 → unchanged chain-only behavior.
    verified: v.verified && keyChecks.length === 0 && sig.failed === 0,
    records: v.records.length,
    attested: v.attested,
    unattested: v.unattested,
    absent: v.absent,
    signatureKeyProvided: sig.keyProvided,
    signaturesChecked: sig.checked,
    signaturesReverified: sig.reverified,
    signaturesFailed: sig.failed,
    failedChecks: failedChecks.map((c) => ({ name: c.name, code: c.code }))
  };
}

// audit.verify — fail-closed re-prove of a run's trust-audit hash chain. The peer
// of telemetry.verify for the sandbox/policy/commit-gate decision log: recomputes
// every event hash from genesis, checks chain linkage, and catches the
// unchained-event forgery. Exposed as a verb (not just embedded in `audit summary`,
// which always exits 0) so `cw audit verify <run> && deploy` can gate on the exit
// code. POLA: a run with no audit log is present:false / verified:true / exit 0.
export function auditVerify(runner: CoolWorkflowRunner, args: Record<string, unknown>): {
  schemaVersion: 1;
  runId: string;
  present: boolean;
  verified: boolean;
  eventCount: number;
  chained: number;
  unchained: number;
  corruptLines: number;
  failedChecks: Array<{ name: string; code?: string }>;
} {
  const runId = optionalString(args.runId || args.run);
  if (!runId) throw new Error("audit verify requires a run id (cw audit verify <run-id>)");
  const run = runner.loadRun(runId);
  const v = verifyTrustAudit(run);
  return {
    schemaVersion: 1,
    runId: run.id,
    present: v.present,
    verified: v.verified,
    eventCount: v.eventCount,
    chained: v.chained,
    unchained: v.unchained,
    corruptLines: v.corruptLines,
    failedChecks: v.checks.filter((c) => !c.pass).map((c) => ({ name: c.name, code: c.code }))
  };
}

// ---- demo: tamper-evidence (the one-command proof) -------------------------
// Hermetic, deterministic-shape: builds a real ed25519-signed telemetry ledger,
// then forges it two ways and shows both tamper-evidence layers catch it. CLI-only
// (a human-facing demonstration; the underlying verify is the telemetry.verify verb).
export function demoTamper(_runner: CoolWorkflowRunner, _args: Record<string, unknown> = {}): ReturnType<typeof runTamperDemo> {
  return runTamperDemo();
}
