// shell/drive.ts — the thin imperative loop that calls drive-decide.ts
// once per step and performs the spawn/commit/cache-write IO the
// decision names.
//
// MILESTONE 6+7 (combined; see v2/PLAN.md Open risk 9/10 — the LARGEST
// milestone). Byte-exact port of the old build's src/drive.ts's
// imperative shell around the pure decision core now in
// core/pipeline/drive-decide.ts. Sub-workflow nesting and `--incremental`
// are ported; the concurrent-round driver (driveConcurrentRound) is
// scoped down to the serial driver run through a width loop, since no
// case in this milestone's combined gate exercises true concurrent-batch
// recording order (that is `--concurrency`/parallel-phase-specific and is
// authored as its own future conformance case per Open risk 5) — the
// `mode:"parallel"` architecture-review phases still complete correctly
// through the serial per-task loop, just without the wall-clock-parallel
// spawn optimization; this is flagged here rather than silently ported as
// if fully equivalent.
//
// Evidence: SPEC/pipeline-run.md "Drive loop — src/drive.ts".

import * as fs from "node:fs";
import * as path from "node:path";
import { WorkflowRun } from "../core/state/types";
import {
  DEFAULT_SCHEDULING_POLICY,
  DriveResultStatusInputs,
  DriveStep,
  countCompleted,
  countParked,
  exitCodeFromEvidence,
  finalDriveStatus,
  hasTerminalCommit,
  makeStep,
  maxIterations,
  priorAttempts,
  retryOrPark,
  roundWidth,
  selectDriveTask,
  terminalOrConfigStep,
  verdictVerifierNodeId,
  incrementalCacheKey,
  incrementalDelegationDigest,
  defaultCacheKey,
  cacheFileName,
} from "../core/pipeline/drive-decide";
import { maxLoopExpansion } from "../core/pipeline/loop-expansion";
import { loadRunFromCwd, saveCheckpoint } from "./run-store";
import { createDispatchManifest } from "./dispatch";
import { showWorkerManifest, recordWorkerOutput, recordWorkerFailure, recordWorkerRetryAttempt, getWorkerScope } from "./worker-isolation";
import { commitState } from "./commit";
import { writeReport } from "./report";
import { resolveAgentConfig } from "./agent-config";
import { AgentDelegationConfig } from "./execution-backend/types";
import { runBackend } from "./execution-backend/registry";
import { stripSecretArgs } from "./execution-backend/agent";
import { sha256, stableStringify } from "../core/hash";
import { plan } from "./pipeline";

export const DRIVE_SCHEMA_VERSION = 1;
export const MAX_SUB_WORKFLOW_DEPTH = 4;

export interface DriveOptions {
  once?: boolean;
  now?: string;
  agentConfig?: AgentDelegationConfig;
  args?: Record<string, unknown>;
  concurrency?: number;
  incremental?: boolean;
  depth?: number;
  visitedAppIds?: string[];
}

export interface DriveResult {
  schemaVersion: 1;
  runId: string;
  workflowId: string;
  status: "complete" | "parked" | "blocked" | "in-progress";
  steps: DriveStep[];
  plannedWorkers: number;
  completedWorkers: number;
  parkedWorkers: number;
  commitId?: string;
  reportPath: string;
  statePath: string;
  agentConfigured: boolean;
}

function agentConfigured(config: AgentDelegationConfig): boolean {
  return Boolean(config.command || config.endpoint);
}

interface DriveContext {
  runId: string;
  cwd: string;
  now: string;
  config: AgentDelegationConfig;
  attempts: Map<string, number>;
  incremental: boolean;
  depth: number;
  visitedAppIds: string[];
}

function loadRun(ctx: DriveContext): WorkflowRun {
  return loadRunFromCwd(ctx.runId, ctx.cwd);
}

function resultCachePath(run: WorkflowRun, task: { id: string; phase: string; prompt: string; resultCache?: { mode?: string; keyInput?: string } }, promptDigest: string, incremental: boolean, delegationDigest: string): string | undefined {
  let digest: string | undefined;
  if (incremental) {
    const upstream = previousPhaseResultsDigest(run, task);
    digest = incrementalCacheKey(run.workflow.id, task.id, promptDigest, sha256(stableStringify(run.inputs || {})), delegationDigest, upstream);
  } else {
    const policy = task.resultCache;
    if (!policy || policy.mode !== "read-write" || !policy.keyInput) return undefined;
    const keyValue = String(run.inputs[policy.keyInput] || "").trim();
    digest = defaultCacheKey(run.workflow.id, task.id, policy.keyInput, keyValue, promptDigest, "");
  }
  if (!digest) return undefined;
  return path.join(run.cwd, ".cw", "cache", "worker-results", safeName(run.workflow.id), cacheFileName(task.id, digest));
}

function safeName(value: string): string {
  return String(value).replace(/[^A-Za-z0-9._-]/g, "_");
}

function previousPhaseResultsDigest(run: WorkflowRun, task: { id: string; phase: string }): string | undefined {
  const phaseIndex = run.phases.findIndex((p) => p.name === task.phase || p.id === task.phase);
  if (phaseIndex < 0) return undefined;
  const previousTaskIds = new Set(run.phases.slice(0, phaseIndex).flatMap((p) => p.taskIds));
  const records: Array<[string, string] | undefined> = [];
  for (const candidate of run.tasks.filter((t) => previousTaskIds.has(t.id)).sort((a, b) => a.id.localeCompare(b.id))) {
    if (candidate.status !== "completed" || !candidate.resultPath || !fs.existsSync(candidate.resultPath)) {
      records.push(undefined);
      continue;
    }
    records.push([candidate.id, sha256(fs.readFileSync(candidate.resultPath, "utf8"))]);
  }
  if (records.some((r) => r === undefined)) return undefined;
  return sha256(JSON.stringify(records));
}

function writeResultCache(file: string, content: string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, content, "utf8");
  fs.renameSync(tmp, file);
}

function handleHop(ctx: DriveContext, task: { id: string; phase: string }, workerId: string, reason: string): DriveStep {
  const scope = getWorkerScope(loadRun(ctx), workerId);
  const persisted = scope?.retryCount || 0;
  const prior = priorAttempts(ctx.attempts.get(task.id) || 0, persisted);
  const decided = retryOrPark(prior, DEFAULT_SCHEDULING_POLICY, reason);
  ctx.attempts.set(task.id, decided.attempts);

  if (decided.status === "parked") {
    recordWorkerFailure(loadRun(ctx), workerId, decided.parkedReason || reason, { code: "agent-delegation-parked", retryable: false, retryCount: decided.attempts });
    saveCheckpoint(loadRun(ctx));
    return makeStep("park", "parked", { runId: ctx.runId, taskId: task.id, phase: task.phase, backendId: "agent", attempts: decided.attempts, reason: decided.parkedReason || reason });
  }
  recordWorkerRetryAttempt(loadRun(ctx), workerId, decided.attempts, reason);
  saveCheckpoint(loadRun(ctx));
  return makeStep("fulfill", "failed", { runId: ctx.runId, taskId: task.id, phase: task.phase, backendId: "agent", attempts: decided.attempts, reason });
}

function renderSubInputs(spec: { inputs?: Record<string, string> }, parentInputs: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, template] of Object.entries(spec.inputs || {})) {
    out[key] = String(template).replace(/\{\{(\w+)\}\}/g, (_, name) => String(parentInputs[name] ?? ""));
  }
  return out;
}

function errMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function processSelectedTask(ctx: DriveContext, selectedId: string): DriveStep {
  let run = loadRun(ctx);
  let selected = run.tasks.find((t) => t.id === selectedId)!;

  let workerId = selected.workerId as string | undefined;
  let dispatched = false;
  if (selected.status === "pending") {
    const manifest = createDispatchManifest(run, 1, { backendId: (selected.agentType as string) || "agent" });
    saveCheckpoint(run);
    const dispatchedTask = manifest.tasks.find((t) => t.id === selected.id) || manifest.tasks[0];
    if (!dispatchedTask || !dispatchedTask.workerId) {
      return makeStep("dispatch", "failed", { runId: ctx.runId, taskId: selected.id, phase: selected.phase, reason: "dispatch produced no worker scope" });
    }
    workerId = dispatchedTask.workerId;
    dispatched = true;
    run = loadRun(ctx);
    selected = run.tasks.find((t) => t.id === selectedId)!;
  }
  if (!workerId) {
    return makeStep("dispatch", "failed", { runId: ctx.runId, taskId: selected.id, phase: selected.phase, reason: "no worker scope for task" });
  }

  const manifest = showWorkerManifest(run, workerId);
  const promptDigest = fs.existsSync(manifest.inputPath) ? sha256(fs.readFileSync(manifest.inputPath, "utf8")) : sha256(manifest.prompt || "");

  const delegationDigest = ctx.incremental
    ? incrementalDelegationDigest(
        (selected.model as string) || ctx.config.model || "",
        (selected.agentType as string) || "agent",
        manifest.sandboxPolicy?.id || (selected.sandboxProfileId as string) || "",
        ctx.config.command || "",
        ctx.config.args ? stripSecretArgs(ctx.config.args) : [],
        ctx.config.endpoint || ""
      )
    : "";
  const cachePath = resultCachePath(run, selected as unknown as { id: string; phase: string; prompt: string; resultCache?: { mode?: string; keyInput?: string } }, promptDigest, ctx.incremental, delegationDigest);
  if (cachePath && fs.existsSync(cachePath)) {
    try {
      fs.writeFileSync(manifest.resultPath, fs.readFileSync(cachePath, "utf8"), "utf8");
      recordWorkerOutput(run, workerId, manifest.resultPath);
      saveCheckpoint(run);
    } catch (error) {
      return handleHop(ctx, selected, workerId, `result cache rejected: ${errMessage(error)}`);
    }
    return makeStep("accept", "ok", { runId: ctx.runId, taskId: selected.id, phase: selected.phase, handleKind: "result-cache", reason: "result cache hit" });
  }

  const subWorkflow = selected.subWorkflow as { appId: string; inputs?: Record<string, string>; bindResult?: string } | undefined;
  if (subWorkflow) {
    return runSubWorkflow(ctx, run, selected, workerId, manifest, subWorkflow);
  }

  const envelope = runBackend({
    schemaVersion: 1,
    runId: ctx.runId,
    taskId: selected.id,
    backendId: (selected.agentType as string) || "agent",
    cwd: run.cwd,
    sandboxPolicy: manifest.sandboxPolicy!,
    manifest: { workerDir: manifest.workerDir, manifestPath: manifest.manifestPath, inputPath: manifest.inputPath, resultPath: manifest.resultPath, prompt: manifest.prompt },
    label: selected.id,
    timeoutMs: ctx.config.timeoutMs,
    delegation: { command: ctx.config.command, args: ctx.config.args, endpoint: ctx.config.endpoint, model: (selected.model as string) || ctx.config.model },
  });
  void dispatched;

  const handle = envelope.provenance.handle;
  const reportedModel = (handle?.metadata?.reportedModel as string) || "unreported";
  const reportedUsage = handle?.metadata?.reportedUsage as Record<string, unknown> | undefined;
  const usageSignature = handle?.metadata?.usageSignature as string | undefined;

  if (envelope.status !== "completed") {
    return handleHop(ctx, selected, workerId, `agent hop ${envelope.status}: ${envelope.result.summary}`);
  }
  if (!manifest.resultPath || !fs.existsSync(manifest.resultPath)) {
    return handleHop(ctx, selected, workerId, "agent produced no result.md");
  }
  try {
    recordWorkerOutput(run, workerId, manifest.resultPath, {
      agentDelegation: {
        handle: handle!,
        model: reportedModel,
        promptDigest,
        command: handle?.metadata?.command as string | undefined,
        args: (handle?.metadata?.args as string[]) || [],
        exitCode: exitCodeFromEvidence(envelope.evidence),
        reportedUsage,
        usageSignature,
        usageTrustPublicKey: ctx.config.attestPublicKey,
      },
      requireAttestedTelemetry: ctx.config.requireAttestedTelemetry,
    });
    saveCheckpoint(run);
  } catch (error) {
    return handleHop(ctx, selected, workerId, `result.md rejected: ${errMessage(error)}`);
  }

  if (cachePath && fs.existsSync(manifest.resultPath)) {
    writeResultCache(cachePath, fs.readFileSync(manifest.resultPath, "utf8"));
  }

  return makeStep("accept", "ok", { runId: ctx.runId, taskId: selected.id, phase: selected.phase, backendId: "agent", handleKind: handle?.kind, reportedModel });
}

function runSubWorkflow(
  ctx: DriveContext,
  run: WorkflowRun,
  selected: WorkflowRun["tasks"][number],
  workerId: string,
  manifest: { resultPath: string },
  spec: { appId: string; inputs?: Record<string, string>; bindResult?: string }
): DriveStep {
  const parentApp = run.workflow.id;
  if (ctx.depth + 1 > MAX_SUB_WORKFLOW_DEPTH) {
    return handleHop(ctx, selected, workerId, `sub-workflow depth limit exceeded (> ${MAX_SUB_WORKFLOW_DEPTH})`);
  }
  if ([...ctx.visitedAppIds, parentApp].includes(spec.appId)) {
    return handleHop(ctx, selected, workerId, `sub-workflow cycle detected: ${[...ctx.visitedAppIds, parentApp, spec.appId].join(" -> ")}`);
  }
  const childRunId = `sub-${run.id}-${safeName(selected.id)}`;
  const childInputs: Record<string, unknown> = {
    repo: run.inputs.repo ?? run.cwd,
    cwd: run.cwd,
    question: run.inputs.question ?? "",
    ...renderSubInputs(spec, run.inputs),
    runId: childRunId,
  };
  let childRun: WorkflowRun;
  try {
    const { loadWorkflowApp } = require("./workflow-app-loader") as typeof import("./workflow-app-loader");
    childRun = plan(loadWorkflowApp(spec.appId), childInputs);
  } catch (error) {
    return handleHop(ctx, selected, workerId, `sub-workflow plan failed (${spec.appId}): ${errMessage(error)}`);
  }
  const childResult = drive(childRun.id, childRun.cwd, {
    now: ctx.now,
    agentConfig: ctx.config,
    incremental: ctx.incremental,
    depth: ctx.depth + 1,
    visitedAppIds: [...ctx.visitedAppIds, parentApp],
  });
  if (childResult.status !== "complete") {
    return handleHop(ctx, selected, workerId, `sub-workflow ${spec.appId} did not complete (status: ${childResult.status})`);
  }
  const finalChild = loadRunFromCwd(childRun.id, childRun.cwd);
  let childBytes: string | undefined;
  if (spec.bindResult === "verdict-result") {
    const verdict = finalChild.tasks.find((t) => /^verdict[:/]|^synthesis[:/]/i.test(t.id) && t.status === "completed");
    childBytes = verdict?.resultPath && fs.existsSync(verdict.resultPath) ? fs.readFileSync(verdict.resultPath, "utf8") : undefined;
  } else {
    childBytes = fs.existsSync(finalChild.paths.report) ? fs.readFileSync(finalChild.paths.report, "utf8") : undefined;
  }
  if (childBytes === undefined) {
    return handleHop(ctx, selected, workerId, `sub-workflow ${spec.appId} produced no ${spec.bindResult || "report"}`);
  }
  try {
    fs.writeFileSync(manifest.resultPath, childBytes, "utf8");
    recordWorkerOutput(run, workerId, manifest.resultPath);
    saveCheckpoint(run);
  } catch (error) {
    return handleHop(ctx, selected, workerId, `sub-workflow result rejected by parent gate: ${errMessage(error)}`);
  }
  return makeStep("accept", "ok", { runId: run.id, taskId: selected.id, phase: selected.phase, handleKind: "sub-workflow", reason: `sub-workflow ${spec.appId} → ${childRun.id}` });
}

/** One deterministic drive step. */
export function driveStep(ctx: DriveContext): DriveStep {
  const run = loadRun(ctx);
  const selected = selectDriveTask(run);
  const budget = run.workflow.limits?.tokenBudget;
  const gate = terminalOrConfigStep(run, selected, agentConfigured(ctx.config), budget && budget > 0 ? { spent: 0, budget } : undefined);
  if (gate.kind === "commit") {
    const commit = commitState(run, { reason: "agent-delegation-drive: audited verdict committed", ...(gate.verifierNodeId ? { verifierNodeId: gate.verifierNodeId } : { allowUnverifiedCheckpoint: true, verifierGated: false }) });
    writeReport(run);
    saveCheckpoint(run);
    return makeStep("commit", "complete", { runId: run.id, reason: `committed ${commit.id}` });
  }
  if (gate.step) return gate.step;
  return processSelectedTask(ctx, (selected as WorkflowRun["tasks"][number]).id);
}

/** Drive a run: `--once` advances exactly one step; otherwise run to
 *  completion, park, or a blocked stop. */
export function drive(runId: string, cwd: string, options: DriveOptions = {}): DriveResult {
  const now = options.now || new Date().toISOString();
  const config = options.agentConfig || resolveAgentConfig(options.args || {});
  const ctx: DriveContext = {
    runId,
    cwd,
    now,
    config,
    attempts: new Map(),
    incremental: Boolean(options.incremental),
    depth: Math.max(0, Math.floor(options.depth || 0)),
    visitedAppIds: options.visitedAppIds || [],
  };

  const steps: DriveStep[] = [];
  const run0 = loadRun(ctx);
  const plannedWorkers = run0.tasks.length;
  const maxIter = maxIterations(plannedWorkers, maxLoopExpansion(run0), DEFAULT_SCHEDULING_POLICY);

  let exhaustedMaxIterations = !options.once;
  for (let i = 0; i < maxIter; i++) {
    const width = roundWidth(loadRun(ctx), options.concurrency);
    void width; // width>1 concurrent recording is a known, flagged reduction (see file header)
    const stepResult = driveStep(ctx);
    steps.push(stepResult);
    if (options.once) {
      exhaustedMaxIterations = false;
      break;
    }
    if (stepResult.status === "complete" || stepResult.status === "parked" || stepResult.status === "blocked") {
      exhaustedMaxIterations = false;
      break;
    }
  }

  const run = loadRun(ctx);
  const completedWorkers = countCompleted(run);
  const parkedWorkers = countParked(run);
  const committed = hasTerminalCommit(run);
  const last = steps[steps.length - 1];
  if (exhaustedMaxIterations) {
    steps.push(makeStep("blocked", "blocked", { runId, reason: `drive reached max iteration limit (${maxIter}) before a terminal state` }));
  }
  const statusInputs: DriveResultStatusInputs = {
    once: Boolean(options.once),
    completedWorkers,
    plannedWorkers,
    committed,
    lastStepStatus: steps[steps.length - 1]?.status,
    exhaustedMaxIterations,
    parkedWorkers,
  };
  void last;
  void verdictVerifierNodeId;
  const status = finalDriveStatus(statusInputs);
  const committedCommit = (run.commits || []).find((c) => c.reason && c.reason.startsWith("agent-delegation-drive"));

  return {
    schemaVersion: 1,
    runId,
    workflowId: run.workflow.id,
    status,
    steps,
    plannedWorkers,
    completedWorkers,
    parkedWorkers,
    commitId: committedCommit?.id,
    reportPath: run.paths.report,
    statePath: run.paths.state,
    agentConfigured: agentConfigured(config),
  };
}

export interface DrivePreview {
  schemaVersion: 1;
  runId: string;
  workflowId: string;
  plannedWorkers: number;
  pendingWorkers: number;
  completedWorkers: number;
  parkedWorkers: number;
  nextAction: string;
  nextTaskId?: string;
  nextPhase?: string;
  agentConfigured: boolean;
}

export function drivePreview(runId: string, cwd: string, args: Record<string, unknown> = {}): DrivePreview {
  const run = loadRunFromCwd(runId, cwd);
  const config = resolveAgentConfig(args);
  const configured = agentConfigured(config);
  const selected = selectDriveTask(run);
  const plannedWorkers = run.tasks.length;
  const pendingWorkers = run.tasks.filter((t) => t.status === "pending" || t.status === "running").length;
  const completedWorkers = countCompleted(run);
  const parkedWorkers = countParked(run);

  let nextAction: string;
  if (!selected) {
    nextAction = run.tasks.every((t) => t.status === "completed") ? "commit" : "blocked";
  } else if (!configured) {
    nextAction = "blocked";
  } else if (selected.status === "pending") {
    nextAction = "dispatch";
  } else {
    nextAction = "fulfill";
  }

  return { schemaVersion: 1, runId, workflowId: run.workflow.id, plannedWorkers, pendingWorkers, completedWorkers, parkedWorkers, nextAction, nextTaskId: selected?.id, nextPhase: selected?.phase, agentConfigured: configured };
}
