// shell/drive.ts — the thin imperative loop that calls drive-decide.ts
// once per step and performs the spawn/commit/cache-write IO the
// decision names.
//
// MILESTONE 6+7 (combined; see docs/rebuild/PLAN.md Open risk 9/10 — the LARGEST
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
  SchedulingPolicy,
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
import {
  maxLoopExpansion,
  evaluateLoopStop,
  cloneLoopRoundTasks,
  loopControlNodeId,
  LoopPredicateContext,
  ResultEnvelopeLike,
} from "../core/pipeline/loop-expansion";
import { firstRunnablePhase, updatePhaseStatuses } from "../core/pipeline/dispatch";
import { loadRunFromCwd, saveCheckpoint } from "./run-store";
import { createDispatchManifest } from "./dispatch";
import { showWorkerManifest, recordWorkerOutput, recordWorkerFailure, recordWorkerRetryAttempt, getWorkerScope } from "./worker-isolation";
import { createStateNode } from "../core/state/state-node";
import { appendRunNode } from "./node-store";
import { runPipelineStage } from "../core/pipeline/runner";
import { writeTaskFiles } from "./harness";
import { phaseProgressLine } from "./term";
import { RunPhase, RunTask } from "../core/state/types";
import { commitState } from "./commit";
import { writeReport } from "./report";
import { recordTrustAuditEvent, verifyTrustAudit } from "./trust-audit";
import { resolveAgentConfig } from "./agent-config";
import { AgentDelegationConfig, AgentChildOutcome } from "./execution-backend/types";
import { runBackend } from "./execution-backend/registry";
import { stripSecretArgs, prepareAgentSpawn, runAgentBatchOutcomes, buildAgentChildEnv } from "./execution-backend/agent";
import { sha256, stableStringify } from "../core/hash";
import { plan } from "./pipeline";
import { reporter } from "./reporter";
import { safeFileName } from "./fs-atomic";
import { deriveUsageTotals } from "./observability";
import { normalizeReportedUsage } from "../core/trust/telemetry-attestation";

/** Total RECORDED tokens across the run's attested units, reading the
 *  agent-reported usage through normalizeReportedUsage so a hop that
 *  reported snake_case buckets (`input_tokens`/`output_tokens`, the shape
 *  parseAgentReport hands back verbatim) is counted — not silently zeroed.
 *  Reuses deriveUsageTotals' own unit selection (its `rows` are the
 *  deduped attested units) so worker-vs-task double-counting stays fixed;
 *  only the key-reading is corrected here. The old build normalized at
 *  store time in worker-accept/verifier-completion.ts; v2 stores the raw
 *  reportedUsage, so the drive's budget accounting normalizes at read
 *  time — same net RECORDED total, same fail-closed backstop. */
function recordedTokenTotal(run: WorkflowRun): number {
  let total = 0;
  for (const row of deriveUsageTotals(run).rows) {
    const usage = row.usage as Record<string, unknown> | undefined;
    if (!usage) continue;
    const declared = usage.totalTokens;
    if (typeof declared === "number") {
      total += declared;
      continue;
    }
    const n = normalizeReportedUsage(usage);
    if (typeof n.totalTokens === "number") total += n.totalTokens;
    else total += (n.inputTokens || 0) + (n.outputTokens || 0);
  }
  return total;
}

/** Token-budget gate input: enforce limits.tokenBudget against RECORDED usage,
 *  not a hardcoded zero. Returns undefined when no positive budget is set so the
 *  gate is a no-op. Spent = the run's total recorded tokens. */
function tokenBudgetUsage(run: WorkflowRun): { spent: number; budget: number } | undefined {
  const budget = run.workflow.limits?.tokenBudget;
  if (!budget || budget <= 0) return undefined;
  return { spent: recordedTokenTotal(run), budget };
}

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
  /** Override the retry/park scheduling policy (e.g. {maxAttempts:1} so a
   *  failing hop parks on its first attempt). Merged over
   *  DEFAULT_SCHEDULING_POLICY; unset fields keep the default. Byte-exact
   *  port of the old build's src/drive.ts DriveOptions.policy. */
  policy?: Partial<SchedulingPolicy>;
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

/** Progress to STDERR (stdout stays clean JSON). On by default when
 *  stderr is a TTY; silent in CI/pipes. CW_DRIVE_PROGRESS=0 forces off,
 *  =1 forces on. This is gate point #2 of the Rule of Silence's three
 *  gate points (SPEC/reporting-ux.md rebuild risk #1) — byte-exact port
 *  of the old build's src/drive.ts's emitProgress. */
function emitProgress(message: string): void {
  const forcedOff = process.env.CW_DRIVE_PROGRESS === "0";
  const forcedOn = process.env.CW_DRIVE_PROGRESS === "1";
  if ((Boolean(process.stderr.isTTY) && !forcedOff) || forcedOn) reporter.progress(`[drive] ${message}`);
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
  /** Resolved scheduling policy (DEFAULT_SCHEDULING_POLICY merged with any
   *  DriveOptions.policy override) — read by handleHop's retryOrPark call
   *  and by drive()'s maxIterations call. */
  policy: SchedulingPolicy;
}

// A concurrent round runs many dispatch/accept steps against ONE shared
// in-memory run object, deferring every disk write to a single flush at
// round end (see driveConcurrentRound below). loadRun(ctx) is the single
// choke point every step reads through, so the cache lives here: while a
// round is active for a given run id, loadRun returns the SAME mutated
// object instead of re-reading (necessarily stale) disk state. Keyed by
// run id (not a stack) so a sub-workflow task's nested drive() call on a
// DIFFERENT run id is unaffected — re-entrant, matches the old build's
// runner.loadWithCache. Byte-exact in spirit to src/drive.ts's own
// per-runner cache; ported here as a module-level map since this build
// has no persistent "runner" object to hang it on.
const roundCache = new Map<string, WorkflowRun>();

function loadRun(ctx: DriveContext): WorkflowRun {
  const cached = roundCache.get(ctx.runId);
  if (cached) return cached;
  return loadRunFromCwd(ctx.runId, ctx.cwd);
}

/** Runs `fn` with `runId`'s loadRun calls served from one shared cached
 *  object (seeded fresh from disk), and always clears the cache entry
 *  afterward — even on throw — so a round never leaks its cache into a
 *  later, unrelated drive call. */
function withRoundCache<T>(ctx: DriveContext, fn: () => T): T {
  const seed = loadRunFromCwd(ctx.runId, ctx.cwd);
  roundCache.set(ctx.runId, seed);
  try {
    return fn();
  } finally {
    roundCache.delete(ctx.runId);
  }
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
  return path.join(run.cwd, ".cw", "cache", "worker-results", safeFileName(run.workflow.id), cacheFileName(task.id, digest));
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

/** `deferPersist` (concurrent-round callers ONLY — never a plain serial
 *  step) skips saveCheckpoint so a caller driving many tasks through one
 *  in-memory `run` can defer the disk flush to a single call at round
 *  end; `sharedRun`, when given, is mutated in place instead of a fresh
 *  loadRun (the round's one shared cached object). */
function handleHop(ctx: DriveContext, task: { id: string; phase: string }, workerId: string, reason: string, deferPersist = false, sharedRun?: WorkflowRun): DriveStep {
  // ONE load, mutated in place and saved — a fresh reload right before
  // saveCheckpoint would discard recordWorkerFailure/RetryAttempt's own
  // in-memory mutation (they return an updated scope but mutate the run
  // object passed in), silently dropping the park/retry bookkeeping.
  const run = sharedRun || loadRun(ctx);
  const scope = getWorkerScope(run, workerId);
  const persisted = scope?.retryCount || 0;
  const prior = priorAttempts(ctx.attempts.get(task.id) || 0, persisted);
  const decided = retryOrPark(prior, ctx.policy, reason);
  ctx.attempts.set(task.id, decided.attempts);

  if (decided.status === "parked") {
    recordWorkerFailure(run, workerId, decided.parkedReason || reason, { code: "agent-delegation-parked", retryable: false, retryCount: decided.attempts });
    if (!deferPersist) saveCheckpoint(run);
    return makeStep("park", "parked", { runId: ctx.runId, taskId: task.id, phase: task.phase, backendId: "agent", attempts: decided.attempts, reason: decided.parkedReason || reason });
  }
  recordWorkerRetryAttempt(run, workerId, decided.attempts, reason);
  if (!deferPersist) saveCheckpoint(run);
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

/** `deferPersist` (concurrent-round callers ONLY) skips the per-task
 *  commitState/saveCheckpoint calls — the round flushes once at the end
 *  instead. `preparedOutcome`, when given (concurrent round only), is
 *  fed to runBackend so the agent spawn that already ran concurrently in
 *  prepareConcurrentOutcomes is SETTLED here, not re-spawned. */
function processSelectedTask(ctx: DriveContext, selectedId: string, preparedOutcome?: AgentChildOutcome, deferPersist = false): DriveStep {
  let run = loadRun(ctx);
  let selected = run.tasks.find((t) => t.id === selectedId)!;

  let workerId = selected.workerId as string | undefined;
  let dispatched = false;
  if (selected.status === "pending") {
    const manifest = createDispatchManifest(run, 1, { backendId: (selected.agentType as string) || "agent" });
    // Advance the RUN-level lifecycle stage on dispatch, exactly as the old
    // build's orchestrator dispatch() wrapper did (run.loopStage = "act").
    // The operator status "Stage:" line reads run.loopStage; v2's shell/
    // dispatch.ts advances the task/node loopStage but never the run, so a
    // driven run's operator status stayed frozen at "interpret".
    run.loopStage = "act";
    // Byte-exact to the old build's orchestrator dispatch() wrapper: a
    // successful dispatch is its own checkpoint commit (reason
    // `dispatch:<dispatch-id>`), not just a bare saveCheckpoint — SPEC/
    // pipeline-run.md's persist-ordering section pins this exact reason.
    if (!deferPersist) {
      if (manifest.dispatchId) commitState(run, `dispatch:${manifest.dispatchId}`);
      saveCheckpoint(run);
    }
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
  // `promptDigest` here is the PER-DISPATCH worker instructions file
  // (input.md) — it embeds this run's own id/dispatch id, so it is
  // NEVER stable across separate runs. It feeds ONLY recordWorkerOutput's
  // agentDelegation telemetry below, never the cache key. The cache key
  // instead digests the task's own static, workflow-authored prompt text
  // (selected.prompt), which IS stable across runs — byte-exact to the
  // old build's src/drive.ts:280-282 (two differently-sourced digests,
  // easy to collapse into one by mistake).
  const promptDigest = fs.existsSync(manifest.inputPath) ? sha256(fs.readFileSync(manifest.inputPath, "utf8")) : sha256(manifest.prompt || "");
  const cacheKeyPromptDigest = sha256((selected.prompt as string) || "");

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
  const cachePath = resultCachePath(run, selected as unknown as { id: string; phase: string; prompt: string; resultCache?: { mode?: string; keyInput?: string } }, cacheKeyPromptDigest, ctx.incremental, delegationDigest);
  if (cachePath && fs.existsSync(cachePath)) {
    emitProgress(`↺ ${selected.label || selected.id} (${selected.phase}) — accepting cached result`);
    try {
      fs.writeFileSync(manifest.resultPath, fs.readFileSync(cachePath, "utf8"), "utf8");
      recordWorkerOutput(run, workerId, manifest.resultPath);
      // Advance the run lifecycle stage on accept, as the old build's
      // recordWorkerOutput wrapper did (run.loopStage = "observe").
      run.loopStage = "observe";
      // Bounded dynamic loops: after a round's tasks complete, evaluate the
      // predicate and either append the next round or mark the loop done —
      // folded into this same worker:<id>:result checkpoint, exactly as the
      // old build's recordWorkerOutput wrapper did (no-op for non-loop runs).
      maybeExpandLoop(run);
      // Byte-exact to the old build's orchestrator recordWorkerOutput()
      // wrapper: an accepted result is its own checkpoint commit (reason
      // `worker:<worker-id>:result`), not just a bare saveCheckpoint.
      if (!deferPersist) {
        commitState(run, `worker:${workerId}:result`);
        saveCheckpoint(run);
      }
    } catch (error) {
      return handleHop(ctx, selected, workerId, `result cache rejected: ${errMessage(error)}`, deferPersist, deferPersist ? run : undefined);
    }
    return makeStep("accept", "ok", { runId: ctx.runId, taskId: selected.id, phase: selected.phase, handleKind: "result-cache", reason: "result cache hit" });
  }

  const subWorkflow = selected.subWorkflow as { appId: string; inputs?: Record<string, string>; bindResult?: string } | undefined;
  if (subWorkflow) {
    emitProgress(`⧉ ${selected.label || selected.id} (${selected.phase}) — sub-workflow ${subWorkflow.appId}…`);
    return runSubWorkflow(ctx, run, selected, workerId, manifest, subWorkflow, deferPersist);
  }

  emitProgress(`→ ${selected.label || selected.id} (${selected.phase}) — ${dispatched ? "dispatched, " : ""}spawning agent, may take minutes…`);
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
    ...(preparedOutcome ? { preparedAgentOutcome: preparedOutcome } : {}),
  });
  void dispatched;

  const handle = envelope.provenance.handle;
  const reportedModel = (handle?.metadata?.reportedModel as string) || "unreported";
  const reportedUsage = handle?.metadata?.reportedUsage as Record<string, unknown> | undefined;
  const usageSignature = handle?.metadata?.usageSignature as string | undefined;

  if (envelope.status !== "completed") {
    return handleHop(ctx, selected, workerId, `agent hop ${envelope.status}: ${envelope.result.summary}`, deferPersist, deferPersist ? run : undefined);
  }
  if (!manifest.resultPath || !fs.existsSync(manifest.resultPath)) {
    return handleHop(ctx, selected, workerId, "agent produced no result.md", deferPersist, deferPersist ? run : undefined);
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
    // Advance the run lifecycle stage on accept (old build: "observe").
    run.loopStage = "observe";
    // Bounded dynamic loops: same round-boundary evaluation the old build's
    // recordWorkerOutput wrapper performed, folded into this checkpoint.
    maybeExpandLoop(run);
    if (!deferPersist) {
      commitState(run, `worker:${workerId}:result`);
      saveCheckpoint(run);
    }
  } catch (error) {
    return handleHop(ctx, selected, workerId, `result.md rejected: ${errMessage(error)}`, deferPersist, deferPersist ? run : undefined);
  }

  // Trust visibility (purely additive, no execution-behavior change): when
  // the agent backend forwarded provider-namespace env vars (CW_/ANTHROPIC_/
  // etc.) to the delegated child, record the NAMES (never values) as their
  // own tamper-evident audit event, mirroring the worker.sub-workflow event
  // pattern above. Only ever populated by execution-backend/agent.ts's
  // recordedAgentHandle() — a no-op for every other backend.
  const forwardedEnvVars = (handle?.metadata?.forwardedEnvVars as string[] | undefined) || [];
  if (forwardedEnvVars.length) {
    recordTrustAuditEvent(run, {
      kind: "worker.agent-env",
      decision: "delegated",
      source: "runtime-derived",
      workerId,
      taskId: selected.id,
      nodeId: selected.resultNodeId as string | undefined,
      envVars: forwardedEnvVars,
      metadata: { reason: "provider-namespace env vars forwarded from host process env to the delegated agent child" },
    });
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
  spec: { appId: string; inputs?: Record<string, string>; bindResult?: string },
  deferPersist = false
): DriveStep {
  const parentApp = run.workflow.id;
  if (ctx.depth + 1 > MAX_SUB_WORKFLOW_DEPTH) {
    return handleHop(ctx, selected, workerId, `sub-workflow depth limit exceeded (> ${MAX_SUB_WORKFLOW_DEPTH})`, deferPersist, deferPersist ? run : undefined);
  }
  if ([...ctx.visitedAppIds, parentApp].includes(spec.appId)) {
    return handleHop(ctx, selected, workerId, `sub-workflow cycle detected: ${[...ctx.visitedAppIds, parentApp, spec.appId].join(" -> ")}`, deferPersist, deferPersist ? run : undefined);
  }
  const childRunId = `sub-${run.id}-${safeFileName(selected.id)}`;
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
    return handleHop(ctx, selected, workerId, `sub-workflow plan failed (${spec.appId}): ${errMessage(error)}`, deferPersist, deferPersist ? run : undefined);
  }
  const childResult = drive(childRun.id, childRun.cwd, {
    now: ctx.now,
    agentConfig: ctx.config,
    incremental: ctx.incremental,
    depth: ctx.depth + 1,
    visitedAppIds: [...ctx.visitedAppIds, parentApp],
    policy: ctx.policy,
  });
  if (childResult.status !== "complete") {
    return handleHop(ctx, selected, workerId, `sub-workflow ${spec.appId} did not complete (status: ${childResult.status})`, deferPersist, deferPersist ? run : undefined);
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
    return handleHop(ctx, selected, workerId, `sub-workflow ${spec.appId} produced no ${spec.bindResult || "report"}`, deferPersist, deferPersist ? run : undefined);
  }
  try {
    fs.writeFileSync(manifest.resultPath, childBytes, "utf8");
    recordWorkerOutput(run, workerId, manifest.resultPath);
    // Cross-link the child run onto the parent's delegate task + a tamper-
    // evident `worker.sub-workflow` trust-audit event (byte-behavior port of
    // the old build's drive sub-workflow cross-link). subRunId/subRunDir let a
    // reader walk from the parent task to the child run; the audit event binds
    // the child report digest + verification into the parent's hash chain.
    selected.subRunId = childRun.id;
    selected.subRunDir = finalChild.paths.runDir;
    try {
      const childAudit = verifyTrustAudit(finalChild);
      recordTrustAuditEvent(run, {
        kind: "worker.sub-workflow",
        decision: "accepted",
        source: "cw-validated",
        workerId,
        taskId: selected.id,
        nodeId: selected.resultNodeId as string | undefined,
        metadata: {
          subWorkflowAppId: spec.appId,
          subRunId: childRun.id,
          childReportDigest: sha256(childBytes),
          childAuditVerified: childAudit.verified,
          bindResult: spec.bindResult || "report",
        },
      });
    } catch {
      /* the cross-link is provenance; a failure here must not undo an accepted hop */
    }
    // Advance the run lifecycle stage on accept (old build: "observe").
    run.loopStage = "observe";
    // Bounded dynamic loops: evaluate the round boundary in the same
    // checkpoint (no-op unless this task's phase is a loop round).
    maybeExpandLoop(run);
    if (!deferPersist) {
      commitState(run, `worker:${workerId}:result`);
      saveCheckpoint(run);
    }
  } catch (error) {
    return handleHop(ctx, selected, workerId, `sub-workflow result rejected by parent gate: ${errMessage(error)}`, deferPersist, deferPersist ? run : undefined);
  }
  return makeStep("accept", "ok", { runId: run.id, taskId: selected.id, phase: selected.phase, handleKind: "sub-workflow", reason: `sub-workflow ${spec.appId} → ${childRun.id}` });
}

/** Byte-stable string order for anything that flows into a recorded
 *  loop-control decision (POLA: deterministic across runs/locales). */
function compareBytes(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Bounded dynamic loop expansion — the shell half of the loop runtime.
 *  After a worker result is recorded (mutating `run` in memory), if the
 *  just-completed phase is the LATEST round of a loop whose origin is not
 *  yet done and all that round's tasks completed, evaluate the pure stop
 *  decision (evaluateLoopStop) and either append the next round (clone the
 *  round-1 template tasks into a fresh phase, materialized like plan()
 *  does — task files + a plan-stage node per new task) or mark the loop
 *  done. One deterministic `loop-control` node is recorded per round
 *  boundary — the replay source of truth. No-op when the run has no loop
 *  phases (POLA). Expands at most ONE loop boundary per call; the next
 *  accept handles the next. Byte-exact port of the old build's
 *  orchestrator/lifecycle-operations.ts maybeExpandLoop, called there from
 *  recordWorkerOutput; v2's recordWorkerOutput (shell/worker-isolation.ts)
 *  does not expand, so the drive shell wires it in right after an accept.
 *  Exported so the standalone `cw worker output` CLI verb (worker-cli.ts) can
 *  run the same round-expansion after a hand-recorded accept, matching the old
 *  build's recordWorkerOutput wrapper. */
export function maybeExpandLoop(run: WorkflowRun): void {
  for (const phase of [...run.phases]) {
    const originId = phase.loop ? phase.id : phase.loopOrigin;
    if (!originId) continue;
    const origin = run.phases.find((p) => p.id === originId);
    if (!origin || !origin.loop || origin.loopDone) continue;
    // Act only from the LATEST round phase of this loop.
    const loopPhases = run.phases.filter((p) => p.id === originId || p.loopOrigin === originId);
    const latest = loopPhases.reduce((a, b) => ((b.loopRound || 1) >= (a.loopRound || 1) ? b : a));
    if (phase.id !== latest.id) continue;
    const roundTasks = run.tasks.filter((t) => latest.taskIds.includes(t.id));
    if (roundTasks.length === 0 || !roundTasks.every((t) => t.status === "completed")) continue;

    const round = latest.loopRound || 1;
    const ordered = (tasks: RunTask[]): Array<ResultEnvelopeLike | undefined> =>
      tasks
        .slice()
        .sort((a, b) => compareBytes(a.id, b.id))
        .map((t) => t.result as ResultEnvelopeLike | undefined);
    const roundResults = ordered(roundTasks);
    const allLoopTasks = run.tasks.filter((t) => t.status === "completed" && loopPhases.some((p) => p.taskIds.includes(t.id)));
    const allResults = ordered(allLoopTasks);

    const ctx: LoopPredicateContext = {
      round,
      roundResults,
      allResults,
      // budget-target scaling counts RECORDED tokens; read them through the
      // same normalizer the CAP gate uses so a snake_case reportedUsage hop
      // is counted (evaluateLoopStop reads usageTotals.totalTokens).
      usageTotals: { totalTokens: recordedTokenTotal(run) },
      inputs: run.inputs,
    };
    const decision = evaluateLoopStop(origin, round, ctx);
    const until = origin.loop.until as { kind: string; ref?: string; target?: number };

    // Record the decision under a deterministic id (the replay source of truth).
    appendRunNode(
      run,
      createStateNode({
        id: loopControlNodeId(run.id, originId, round),
        kind: "loop-control",
        status: "completed",
        loopStage: "adjust",
        outputs: { round, done: decision.done, atCap: decision.atCap, reason: decision.reason },
        metadata: {
          originPhaseId: originId,
          until: until.kind === "predicate" ? until.ref : `budget-target:${until.target}`,
          round,
          done: decision.done,
          atCap: decision.atCap,
          reason: decision.reason,
        },
      })
    );

    if (decision.done) {
      origin.loopDone = true;
      return;
    }

    // Expand: clone the ROUND-1 template tasks into a fresh phase appended
    // right after the latest round.
    const nextRound = round + 1;
    const templateTasks = run.tasks.filter((t) => origin.taskIds.includes(t.id));
    const { phase: nextPhase, tasks: newTasks } = cloneLoopRoundTasks(origin, templateTasks, nextRound);
    const insertAt = run.phases.findIndex((p) => p.id === latest.id);
    run.phases.splice(insertAt + 1, 0, nextPhase as RunPhase);
    run.tasks.push(...(newTasks as RunTask[]));

    // Materialize: task files + a plan-stage node per new task (mirrors plan()).
    writeTaskFiles(run);
    const inputNodeId = `${run.id}:input`;
    for (const t of newTasks as RunTask[]) {
      const result = runPipelineStage(
        run,
        "plan",
        inputNodeId,
        {
          outputNodeId: `${run.id}:task:${t.id}`,
          outputStatus: "pending",
          loopStage: "interpret",
          artifacts: [{ id: "task", kind: "markdown", path: t.taskPath }],
          metadata: {
            workflowId: run.workflow.id,
            taskId: t.id,
            phase: t.phase,
            taskKind: t.kind,
            requiresEvidence: t.requiresEvidence,
            sandboxProfileId: t.sandboxProfileId,
          },
        },
        { persist: false, persistNode: (r, node) => void appendRunNode(r, node) }
      );
      t.stateNodeId = result.outputNodeId;
    }
    updatePhaseStatuses(run);
    return;
  }
}

/** One deterministic drive step. */
export function driveStep(ctx: DriveContext): DriveStep {
  const run = loadRun(ctx);
  const selected = selectDriveTask(run);
  const gate = terminalOrConfigStep(run, selected, agentConfigured(ctx.config), tokenBudgetUsage(run));
  if (gate.kind === "commit") {
    // Terminal commit: advance the run lifecycle stage as the old build's
    // commit() wrapper did (run.loopStage = "checkpoint").
    run.loopStage = "checkpoint";
    const commit = commitState(run, { reason: "agent-delegation-drive: audited verdict committed", ...(gate.verifierNodeId ? { verifierNodeId: gate.verifierNodeId } : { allowUnverifiedCheckpoint: true, verifierGated: false }) });
    writeReport(run);
    saveCheckpoint(run);
    return makeStep("commit", "complete", { runId: run.id, reason: `committed ${commit.id}` });
  }
  if (gate.step) return gate.step;
  return processSelectedTask(ctx, (selected as WorkflowRun["tasks"][number]).id);
}

/** Dispatch every batch task (sequential — dispatch mutates state), then
 *  collect ALL spawn-style agent child outcomes in one concurrent window
 *  (one batch delegate child process, per-job timeout kill). Returns
 *  outcomes keyed by task id; a cache-hit or endpoint-configured agent
 *  gets no prepared outcome and settles through the serial accept path
 *  inside processSelectedTask. Dispatch failures become recorded fail
 *  steps up front, exactly what the serial path would emit. Byte-exact
 *  to the old build's src/drive.ts's prepareConcurrentOutcomes. */
function prepareConcurrentOutcomes(
  ctx: DriveContext,
  batch: string[]
): { outcomes: Map<string, AgentChildOutcome>; failSteps: Map<string, DriveStep> } {
  const failSteps = new Map<string, DriveStep>();
  const jobs: Array<ReturnType<typeof prepareAgentSpawn> & { env?: NodeJS.ProcessEnv }> = [];
  const jobTaskIds: string[] = [];

  for (const taskId of batch) {
    const run = loadRun(ctx);
    const task = run.tasks.find((candidate) => candidate.id === taskId);
    if (!task || (task.status !== "pending" && task.status !== "running")) continue;
    let workerId = task.workerId as string | undefined;
    if (task.status === "pending") {
      const manifest = createDispatchManifest(run, 1, { backendId: (task.agentType as string) || "agent" });
      const dispatchedTask = manifest.tasks.find((entry) => entry.id === task.id) || manifest.tasks[0];
      if (!dispatchedTask || !dispatchedTask.workerId) {
        failSteps.set(taskId, makeStep("dispatch", "failed", { runId: ctx.runId, taskId, phase: task.phase, reason: "dispatch produced no worker scope" }));
        continue;
      }
      workerId = dispatchedTask.workerId;
    }
    if (!workerId) {
      failSteps.set(taskId, makeStep("dispatch", "failed", { runId: ctx.runId, taskId, phase: task.phase, reason: "no worker scope for task" }));
      continue;
    }
    const freshRun = loadRun(ctx);
    const manifest = showWorkerManifest(freshRun, workerId);
    const delegationDigest = ctx.incremental
      ? incrementalDelegationDigest(
          (task.model as string) || ctx.config.model || "",
          (task.agentType as string) || "agent",
          manifest.sandboxPolicy?.id || (task.sandboxProfileId as string) || "",
          ctx.config.command || "",
          ctx.config.args ? stripSecretArgs(ctx.config.args) : [],
          ctx.config.endpoint || ""
        )
      : "";
    const cachePath = resultCachePath(
      freshRun,
      task as unknown as { id: string; phase: string; prompt: string; resultCache?: { mode?: string; keyInput?: string } },
      sha256((task.prompt as string) || ""),
      ctx.incremental,
      delegationDigest
    );
    if (cachePath && fs.existsSync(cachePath)) continue;
    const job = prepareAgentSpawn({
      schemaVersion: 1,
      runId: ctx.runId,
      taskId: task.id,
      backendId: (task.agentType as string) || "agent",
      cwd: freshRun.cwd,
      sandboxPolicy: manifest.sandboxPolicy!,
      manifest: { workerDir: manifest.workerDir, manifestPath: manifest.manifestPath, inputPath: manifest.inputPath, resultPath: manifest.resultPath, prompt: manifest.prompt },
      label: task.id,
      timeoutMs: ctx.config.timeoutMs,
      delegation: { command: ctx.config.command, args: ctx.config.args, endpoint: ctx.config.endpoint, model: (task.model as string) || ctx.config.model },
    });
    if (job) {
      const sandboxPolicy = manifest.sandboxPolicy;
      if (sandboxPolicy) {
        job.env = buildAgentChildEnv(sandboxPolicy).env;
      }
      jobs.push(job);
      jobTaskIds.push(taskId);
    }
  }

  if (jobs.length) {
    emitProgress(`⇉ concurrent round: ${jobs.length} agent${jobs.length > 1 ? "s" : ""} spawning in parallel, may take minutes…`);
  }
  const settled = runAgentBatchOutcomes(jobs as Parameters<typeof runAgentBatchOutcomes>[0]);
  const outcomes = new Map<string, AgentChildOutcome>();
  jobTaskIds.forEach((taskId, index) => outcomes.set(taskId, settled[index]));
  return { outcomes, failSteps };
}

/** One concurrent round inside one cached in-memory run: dispatches every
 *  batch task, spawns all spawn-style agent children in one concurrent
 *  window, then settles + accepts in DETERMINISTIC batch (task-id) order
 *  regardless of wall-clock finish order. At round end it flushes once:
 *  commitState(run, "concurrent-round:<n>-tasks") + writeReport +
 *  saveCheckpoint. Cache-hit tasks and endpoint-only agents get no
 *  prepared outcome and settle through the serial path (still inside
 *  this one deferred-persist round). If no step was produced (nothing
 *  runnable at round entry — terminal/blocked/token-budget gate) the
 *  round degrades to one plain driveStep. Byte-exact to the old build's
 *  src/drive.ts's driveConcurrentRound. */
function driveConcurrentRound(ctx: DriveContext, limit: number): DriveStep[] {
  return withRoundCache(ctx, () => {
    const run = loadRun(ctx);
    const selected = selectDriveTask(run);
    const gate = terminalOrConfigStep(run, selected, agentConfigured(ctx.config), tokenBudgetUsage(run));
    if (gate.kind === "commit" || gate.step) return [driveStep(ctx)];

    const phase = firstRunnablePhase(run);
    const width = Math.max(1, Math.floor(limit) || 1);
    const batch = run.tasks
      .filter((task) => phase!.taskIds.includes(task.id) && (task.status === "pending" || task.status === "running"))
      .slice(0, width)
      .map((task) => task.id);

    const prepared = prepareConcurrentOutcomes(ctx, batch);

    const steps: DriveStep[] = [];
    for (const taskId of batch) {
      const failStep = prepared.failSteps.get(taskId);
      if (failStep) {
        steps.push(failStep);
        continue;
      }
      // Re-read per task: a prior accept in this round mutated state (the
      // SAME cached object via loadRun's round cache — no disk round-trip
      // until the round-end flush below).
      const freshRun = loadRun(ctx);
      const fresh = freshRun.tasks.find((task) => task.id === taskId);
      if (!fresh || (fresh.status !== "pending" && fresh.status !== "running")) continue;
      steps.push(processSelectedTask(ctx, taskId, prepared.outcomes.get(taskId), true));
    }
    if (steps.length > 0) {
      const settledRun = loadRun(ctx);
      commitState(settledRun, `concurrent-round:${batch.length}-tasks`);
      writeReport(settledRun);
      saveCheckpoint(settledRun);
    }
    return steps.length > 0 ? steps : [driveStep(ctx)];
  });
}

/** Drive a run: `--once` advances exactly one step; otherwise run to
 *  completion, park, or a blocked stop. */
export function drive(runId: string, cwd: string, options: DriveOptions = {}): DriveResult {
  const now = options.now || new Date().toISOString();
  const config = options.agentConfig || resolveAgentConfig(options.args || {});
  const policy: SchedulingPolicy = { ...DEFAULT_SCHEDULING_POLICY, ...(options.policy || {}) };
  const ctx: DriveContext = {
    runId,
    cwd,
    now,
    config,
    attempts: new Map(),
    incremental: Boolean(options.incremental),
    depth: Math.max(0, Math.floor(options.depth || 0)),
    visitedAppIds: options.visitedAppIds || [],
    policy,
  };

  const steps: DriveStep[] = [];
  const run0 = loadRun(ctx);
  const plannedWorkers = run0.tasks.length;
  const maxIter = maxIterations(plannedWorkers, maxLoopExpansion(run0), policy);

  // Phase-boundary progress (brew-style): announce each phase when it
  // becomes active and when it finishes — `==> Map ✓ (6/6)` / `==> Assess
  // ⇉ (3/6)`. Describes CW's OWN phases (vendor-neutral); goes to stderr
  // via emitProgress so stdout stays clean data. Byte-exact port of the
  // old build's src/drive.ts emitPhaseProgress. term.phaseProgressLine
  // renders the line; this closure decides WHEN to emit each boundary.
  const announcedPhaseComplete = new Set<string>();
  let activePhaseId: string | undefined;
  const titleCase = (s: string): string => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);
  const emitPhaseProgress = (run: WorkflowRun): void => {
    for (const ph of run.phases || []) {
      const phaseTasks = run.tasks.filter((task) => ph.taskIds.includes(task.id));
      const total = phaseTasks.length;
      if (total === 0) continue;
      const done = phaseTasks.filter((task) => task.status === "completed").length;
      const label = titleCase(ph.name || ph.id);
      if (done >= total) {
        if (!announcedPhaseComplete.has(ph.id)) {
          announcedPhaseComplete.add(ph.id);
          emitProgress(phaseProgressLine(label, done, total, ph.mode, process.stderr));
        }
        continue;
      }
      if (ph.id !== activePhaseId) {
        activePhaseId = ph.id;
        emitProgress(phaseProgressLine(label, done, total, ph.mode, process.stderr));
      }
      return; // only the first not-yet-complete phase is "active"
    }
  };

  let exhaustedMaxIterations = !options.once;
  for (let i = 0; i < maxIter; i++) {
    const width = roundWidth(loadRun(ctx), options.concurrency);
    // width>1 (an explicit --concurrency>1, or an auto-width parallel
    // phase) runs the whole round through driveConcurrentRound — one or
    // more steps recorded in deterministic batch order, one flush at
    // round end. `--once` still stops after this ONE outer-loop
    // iteration even though a round can yield multiple steps.
    const roundSteps = width > 1 ? driveConcurrentRound(ctx, width) : [driveStep(ctx)];
    for (const stepResult of roundSteps) steps.push(stepResult);
    // Brew-style phase boundaries: after each round, announce a
    // newly-active phase and any phase that just finished. Cheap — reuses
    // the run we just advanced; goes to stderr so stdout stays clean.
    emitPhaseProgress(loadRun(ctx));
    const last = roundSteps[roundSteps.length - 1];
    if (options.once) {
      exhaustedMaxIterations = false;
      break;
    }
    if (last && (last.status === "complete" || last.status === "parked" || last.status === "blocked")) {
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
