// Core run-lifecycle operations (v0.1.40 self-audit P3 router pattern).
//
// The engine core — plan / dispatch / recordResult / worker-output / commit /
// checkState — carved out of CoolWorkflowRunner so the runner is a pure router.
// plan() receives an already-resolved workflow app record (the runner still owns
// app loading, which is instance-stateful). Behavior is identical to the inline
// implementations; only the location changed.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {
  AgentDelegationInput,
  DispatchManifest,
  LoadedWorkflowApp,
  RunPhase,
  RunSummary,
  RunTask,
  StateCommit,
  WorkflowDefinition,
  WorkflowRun
} from "../types";
import {
  createRunPaths,
  ensureRunDirs,
  migrateRunStateFile,
  safeFileName,
  saveCheckpoint
} from "../state";
import { summarizeRun, writeReport } from "./report";
import { isMissing, isSandboxProfileError, numberOption, stringOption } from "./cli-options";
import { writeTaskFiles } from "../harness";
import { workflowAppRunMetadata } from "../workflow-app-framework";
import { slugify } from "../workflow-api";
import { parseUsageFromArgs, deriveUsageTotals } from "../observability";
import { compareBytes } from "../compare";
import { getLoopPredicate } from "../loop-expansion";
import { createDispatchManifest, updatePhaseStatuses } from "../dispatch";
import { assertTaskCanComplete, parseResultEnvelope, validateResultEnvelope, validateRunGates } from "../verifier";
import { ensureTrustAudit } from "../trust-audit";
import { ensureMultiAgentState } from "../multi-agent";
import { ensureTopologyState } from "../topology";
import { appendRunNode, createStateNode, upsertRunContract } from "../state-node";
import { createDefaultPipelineContract, DEFAULT_PIPELINE_CONTRACT_ID } from "../pipeline-contract";
import { createPipelineRunner } from "../pipeline-runner";
import { commitState } from "../commit";
import { recordFeedback } from "../error-feedback";
import { recordTrustAuditEvent } from "../trust-audit";
import { isEmptyCapture } from "../result-normalize";
import { maybeCompactRun } from "../state-explosion";
import {
  getWorkerScope,
  recordWorkerFailure as recordWorkerFailureImpl,
  recordWorkerOutput as recordWorkerOutputImpl
} from "../worker-isolation";

export interface StateCommitResult {
  runId: string;
  commit: StateCommit;
}

export function plan(appRecord: LoadedWorkflowApp, options: Record<string, unknown>): WorkflowRun {
  const workflow = appRecord.app.workflow;
  const inputs = normalizeInputs(options);
  validateInputs(workflow, inputs);
  // Fold declared defaults: a missing OPTIONAL input renders as its declared
  // default (or empty), so a task prompt referencing it never leaks a literal
  // "{{name}}" placeholder into the agent's worker input.
  for (const declared of workflow.inputs || []) {
    if (isMissing(inputs[declared.name])) inputs[declared.name] = declared.default ?? "";
  }

  const cwd = path.resolve(String(inputs.cwd || inputs.repo || process.cwd()));
  // A caller (e.g. an inline sub-workflow task) may inject a DETERMINISTIC run id so
  // the child run id is reproducible across re-runs; otherwise mint one. `runId` is
  // never a declared workflow input, so strip it from inputs to keep run.inputs (and
  // the digests derived from it) clean — POLA for every normal plan.
  const injectedRunId = typeof options.runId === "string" && options.runId.trim() ? options.runId.trim() : undefined;
  delete inputs.runId;
  const runId = injectedRunId || createRunId(workflow.id);
  const runDir = path.join(cwd, ".cw", "runs", runId);
  const paths = createRunPaths(runDir);
  ensureRunDirs(paths);

  const tasks = flattenTasks(workflow, inputs);
  const run: WorkflowRun = {
    schemaVersion: 1,
    id: runId,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    cwd,
    workflow: {
      id: workflow.id,
      title: workflow.title,
      summary: workflow.summary || "",
      limits: workflow.limits,
      app: workflowAppRunMetadata(appRecord)
    },
    inputs,
    loopStage: "interpret",
    phases: workflow.phases.map((phase) => ({
      id: phase.id || slugify(phase.name),
      name: phase.name,
      status: "pending",
      taskIds: phase.tasks.map((task) => task.id),
      // parallel() DSL: the drive loop reads this to size its concurrent round.
      ...(phase.mode ? { mode: phase.mode } : {}),
      // loop() DSL: the ORIGIN phase carries the loop spec + round 1; the expander
      // appends round-2+ phases after each round (loop-expansion / maybeExpandLoop).
      ...(phase.loop ? { loop: phase.loop, loopRound: 1 } : {})
    })),
    tasks,
    dispatches: [],
    commits: [],
    paths,
    nodes: [],
    contracts: [],
    feedback: [],
    audit: {
      schemaVersion: 1,
      eventLogPath: paths.auditDir ? path.join(paths.auditDir, "events.jsonl") : undefined,
      summaryPath: paths.auditDir ? path.join(paths.auditDir, "summary.json") : undefined,
      indexPath: paths.auditDir ? path.join(paths.auditDir, "index.json") : undefined
    },
    workers: [],
    sandboxProfiles: [],
    candidates: [],
    candidateSelections: [],
    multiAgent: {
      schemaVersion: 1,
      runs: [],
      roles: [],
      groups: [],
      memberships: [],
      fanouts: [],
      fanins: []
    },
    blackboard: {
      schemaVersion: 1,
      boards: [],
      topics: [],
      messages: [],
      contexts: [],
      artifacts: [],
      snapshots: [],
      decisions: []
    },
    topologies: {
      schemaVersion: 1,
      runs: []
    }
  };
  ensureTrustAudit(run);
  ensureMultiAgentState(run);
  ensureTopologyState(run);

  writeTaskFiles(run);
  // Use app's custom pipeline if defined; fall back to default (v0.1.56).
  const defaultContract = createDefaultPipelineContract();
  const appPipeline = appRecord.app.pipeline;
  const contract = appPipeline
    ? upsertRunContract(run, { ...defaultContract, ...appPipeline, id: defaultContract.id })
    : upsertRunContract(run, defaultContract);
  const inputNode = appendRunNode(
    run,
    createStateNode({
      id: `${run.id}:input`,
      kind: "input",
      status: "completed",
      loopStage: "interpret",
      outputs: run.inputs,
      artifacts: [{ id: "state", kind: "json", path: run.paths.state }],
      contractId: contract.id,
      metadata: { workflowId: workflow.id, app: workflowAppRunMetadata(appRecord) }
    })
  );
  saveCheckpoint(run);
  const pipeline = createPipelineRunner({ contractId: contract.id, persist: false });
  for (const task of run.tasks) {
    const taskResult = pipeline.runPipelineStage(run, "plan", inputNode.id, {
      outputNodeId: `${run.id}:task:${task.id}`,
      outputStatus: "pending",
      loopStage: "interpret",
      artifacts: [{ id: "task", kind: "markdown", path: task.taskPath }],
      metadata: {
        workflowId: workflow.id,
        appId: appRecord.app.id,
        appVersion: appRecord.app.version,
        taskId: task.id,
        phase: task.phase,
        taskKind: task.kind,
        requiresEvidence: task.requiresEvidence,
        sandboxProfileId: task.sandboxProfileId
      }
    });
    task.stateNodeId = taskResult.outputNodeId;
  }
  writeReport(run);
  commitState(run, "initial-plan");
  saveCheckpoint(run);
  return run;
}

export function dispatch(run: WorkflowRun, options: Record<string, unknown>): DispatchManifest {
  try {
    const manifest = createDispatchManifest(run, numberOption(options.limit), {
      sandboxProfileId: stringOption(options.sandbox) || stringOption(options.sandboxProfile) || stringOption(options.sandboxProfileId),
      backendId: stringOption(options.backend) || stringOption(options.backendId) || stringOption(options.executionBackend),
      multiAgentRunId: stringOption(options.multiAgentRun || options.multiAgentRunId || options["multi-agent-run"]),
      multiAgentGroupId: stringOption(options.multiAgentGroup || options.multiAgentGroupId || options.group || options["multi-agent-group"]),
      multiAgentRoleId: stringOption(options.multiAgentRole || options.multiAgentRoleId || options.role || options["multi-agent-role"]),
      multiAgentFanoutId: stringOption(options.multiAgentFanout || options.multiAgentFanoutId || options.fanout || options["multi-agent-fanout"])
    });
    run.loopStage = "act";
    if (manifest.dispatchId) commitState(run, `dispatch:${manifest.dispatchId}`);
    saveCheckpoint(run);
    writeReport(run);
    return manifest;
  } catch (error) {
    if (isSandboxProfileError(error)) {
      run.loopStage = "adjust";
      recordFeedback(run, {
        source: "cli",
        error: {
          code: error.code,
          message: error.message,
          at: new Date().toISOString(),
          path: error.path,
          retryable: false,
          details: error.details
        },
        retryable: false,
        metadata: { sandboxProfileId: stringOption(options.sandbox) || stringOption(options.sandboxProfile) || stringOption(options.sandboxProfileId) }
      }, { persist: false });
      writeReport(run);
      saveCheckpoint(run);
    }
    throw error;
  }
}

export function recordResult(run: WorkflowRun, taskId: string, resultPath: string, options: Record<string, unknown> = {}): RunSummary {
  const task = run.tasks.find((candidate) => candidate.id === taskId);
  if (!task) throw new Error(`Unknown task id for run ${run.id}: ${taskId}`);
  // Host-attested token usage (v0.1.31), if the caller supplied it. CW records
  // it verbatim as provenance and NEVER synthesizes it; absent ⇒ `unreported`.
  const usage = parseUsageFromArgs(options, new Date().toISOString());
  try {
    assertTaskCanComplete(run, task);

    const absoluteResultPath = path.resolve(resultPath);
    if (!fs.existsSync(absoluteResultPath)) {
      throw new Error(`Result file does not exist: ${absoluteResultPath}`);
    }
    const rawResult = fs.readFileSync(absoluteResultPath, "utf8");
    run.loopStage = "observe";
    const parsedResult = parseResultEnvelope(rawResult);
    run.loopStage = "adjust";
    validateResultEnvelope(task, parsedResult);

    const destination = path.join(run.paths.resultsDir, `${safeFileName(taskId)}.md`);
    fs.copyFileSync(absoluteResultPath, destination);
    task.status = "completed";
    task.completedAt = new Date().toISOString();
    task.resultPath = destination;
    task.loopStage = "observe";
    task.result = parsedResult;
    if (usage) task.usage = usage;
    const resultNode = appendRunNode(
      run,
      createStateNode({
        id: `${run.id}:result:${task.id}`,
        kind: "result",
        status: "completed",
        loopStage: "observe",
        inputs: { taskId: task.id, dispatchId: task.dispatchId },
        outputs: parsedResult as unknown as Record<string, unknown>,
        artifacts: [{ id: "result", kind: "markdown", path: destination }],
        evidence: parsedResult.evidence.map((entry, index) => ({
          id: `result:${index + 1}`,
          source: "cw:result",
          locator: entry,
          summary: entry
        })),
        parents: task.dispatchId ? [`${run.id}:dispatch:${task.dispatchId}`] : [task.stateNodeId || `${run.id}:task:${task.id}`],
        contractId: DEFAULT_PIPELINE_CONTRACT_ID,
        metadata: {
          taskId: task.id,
          // Empty-capture warning (v0.1.42): surfaced, never silently passed.
          ...(isEmptyCapture(parsedResult) ? { captureWarning: "no findings or evidence captured from result.md" } : {})
        }
      })
    );
    task.resultNodeId = resultNode.id;
    if (isEmptyCapture(parsedResult)) {
      recordTrustAuditEvent(run, {
        kind: "worker.capture-warning",
        decision: "recorded",
        source: "cw-validated",
        taskId: task.id,
        nodeId: resultNode.id,
        metadata: { reason: "no findings or evidence captured from result.md", resultPath: destination }
      });
    }
    updatePhaseStatuses(run);
    validateRunGates(run);
    const verifierResult = createPipelineRunner({ persist: false }).runPipelineStage(run, "verify", resultNode.id, {
      outputNodeId: `${run.id}:verifier:${task.id}`,
      outputStatus: "verified",
      loopStage: "adjust",
      outputs: { accepted: true },
      artifacts: [{ id: "result", kind: "markdown", path: destination }],
      evidence: resultNode.evidence.length
        ? resultNode.evidence
        : [{ id: "result:summary", source: "summary", summary: parsedResult.summary }],
      metadata: { taskId: task.id, resultNodeId: resultNode.id }
    });
    task.verifierNodeId = verifierResult.outputNodeId;
    commitState(run, `result:${taskId}`);
    writeReport(run);
    saveCheckpoint(run);
    return summarizeRun(run);
  } catch (error) {
    recordFeedback(run, {
      source: "verifier",
      error: error instanceof Error ? error : String(error),
      taskId: task.id,
      path: resultPath ? path.resolve(resultPath) : undefined,
      retryable: false,
      metadata: {
        taskStatus: task.status,
        dispatchId: task.dispatchId,
        stateNodeId: task.stateNodeId,
        resultNodeId: task.resultNodeId
      }
    });
    writeReport(run);
    throw error;
  }
}

export function recordWorkerOutput(run: WorkflowRun, workerId: string, resultPath: string, options: Record<string, unknown> = {}): RunSummary {
  const usage = parseUsageFromArgs(options, new Date().toISOString());
  // Agent Delegation Drive (v0.1.38): the drive loop passes the agent-hop
  // attestation through verbatim so recordWorkerOutput can fold the digests +
  // model into provenance/trust-audit. Absent for a hand-fulfilled worker.
  const agentDelegation = (options.agentDelegation as AgentDelegationInput | undefined) || undefined;
  // Track 1 fail-closed (opt-in): forward the policy so recordWorkerOutput can
  // park a hop whose telemetry isn't attested. Default (absent) ⇒ flag-and-surface.
  const requireAttestedTelemetry = options.requireAttestedTelemetry === true;
  try {
    recordWorkerOutputImpl(run, workerId, resultPath, { persist: false, agentDelegation, requireAttestedTelemetry });
    if (usage) {
      const worker = getWorkerScope(run, workerId);
      // Host-attested token usage rides on the worker record as provenance.
      if (worker) worker.usage = usage;
    }
    run.loopStage = "observe";
    updatePhaseStatuses(run);
    // Bounded dynamic loops: after a round's tasks complete, evaluate the predicate
    // and either append the next round or mark the loop done (no-op for non-loop runs).
    maybeExpandLoop(run);
    validateRunGates(run);
    commitState(run, `worker:${workerId}:result`);
    writeReport(run);
    saveCheckpoint(run);
    return summarizeRun(run);
  } catch (error) {
    run.loopStage = "adjust";
    updatePhaseStatuses(run);
    writeReport(run);
    saveCheckpoint(run);
    throw error;
  }
}

export function recordWorkerFailure(
  run: WorkflowRun,
  workerId: string,
  message: string,
  options: Record<string, unknown> = {}
): NonNullable<ReturnType<typeof getWorkerScope>> {
  const failure = recordWorkerFailureImpl(
    run,
    workerId,
    {
      code: String(options.code || "worker-runtime-error"),
      message,
      at: new Date().toISOString(),
      path: options.path ? path.resolve(String(options.path)) : undefined,
      retryable: Boolean(options.retryable)
    },
    { persist: false, retryCount: typeof options.retryCount === "number" ? Number(options.retryCount) : undefined }
  );
  run.loopStage = "adjust";
  updatePhaseStatuses(run);
  writeReport(run);
  saveCheckpoint(run);
  return failure;
}

export function checkState(runId: string, options: Record<string, unknown> = {}): ReturnType<typeof migrateRunStateFile>["report"] {
  const cwd = path.resolve(String(options.cwd || process.cwd()));
  const statePath = options.state
    ? path.resolve(String(options.state))
    : path.join(cwd, ".cw", "runs", runId, "state.json");
  const result = migrateRunStateFile(statePath, { write: Boolean(options.write) });
  return result.report;
}

export function commit(run: WorkflowRun, input: string | Record<string, unknown> = {}): StateCommitResult {
  run.loopStage = "checkpoint";
  const options = typeof input === "string" ? { reason: input } : input;
  const allowCheckpoint = Boolean(options.allowUnverifiedCheckpoint || options["allow-unverified-checkpoint"]);
  const hasGateOption = Boolean(options.verifier || options.verifierNode || options["verifier-node"] || options.candidate || options.selection);
  try {
    const commitRecord = commitState(run, {
      reason: stringOption(options.reason) || "manual",
      verifierNodeId: stringOption(options.verifier) || stringOption(options.verifierNode) || stringOption(options["verifier-node"]),
      candidateId: stringOption(options.candidate),
      selectionId: stringOption(options.selection),
      verifierGated: hasGateOption || !allowCheckpoint,
      allowUnverifiedCheckpoint: allowCheckpoint,
      source: "cli"
    });
    writeReport(run);
    saveCheckpoint(run);
    maybeCompactRun(run);
    return { runId: run.id, commit: commitRecord };
  } catch (error) {
    writeReport(run);
    saveCheckpoint(run);
    throw error;
  }
}

// ---- plan() private helpers (moved verbatim from the runner) ----------------

function normalizeInputs(options: Record<string, unknown>): Record<string, unknown> {
  const inputs: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(options)) {
    if (key === "arg") {
      const pairs = Array.isArray(value) ? value : [value];
      for (const pair of pairs) {
        const [argKey, ...rest] = String(pair).split("=");
        inputs[argKey] = rest.join("=");
      }
      continue;
    }
    inputs[key] = value;
  }
  if (inputs.repo && !inputs.cwd) inputs.cwd = inputs.repo;
  return inputs;
}

function validateInputs(workflow: WorkflowDefinition, inputs: Record<string, unknown>): void {
  for (const input of workflow.inputs || []) {
    if (input.required && isMissing(inputs[input.name])) {
      throw new Error(`Missing required input --${input.name}`);
    }
  }
}

/** Bounded dynamic loop expansion. After a worker result is recorded: if the just-
 *  completed phase is the LATEST round of a loop whose origin is not yet done, evaluate
 *  the registered predicate over the round's recorded results and either append the
 *  next round (clone the round-1 template tasks into a fresh phase, materialized like
 *  plan() does) or mark the loop done. One deterministic `loop-control` node is recorded
 *  per round boundary — the replay source of truth. No-op when the run has no loop
 *  phases (POLA). Expands at most ONE loop boundary per call; the next accept handles
 *  the next. Bounded: a loop never exceeds `maxRounds` (fail-closed); an unregistered
 *  predicate stops the loop rather than spinning. */
function maybeExpandLoop(run: WorkflowRun): void {
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
    const ordered = (tasks: RunTask[]) => tasks.slice().sort((a, b) => compareBytes(a.id, b.id)).map((t) => t.result);
    const roundResults = ordered(roundTasks);
    const allLoopTasks = run.tasks.filter((t) => t.status === "completed" && loopPhases.some((p) => p.taskIds.includes(t.id)));
    const allResults = ordered(allLoopTasks);

    const predicate = getLoopPredicate(origin.loop.until.ref);
    const decision = predicate
      ? predicate({ round, roundResults, allResults, usageTotals: deriveUsageTotals(run).totals, inputs: run.inputs })
      : { done: true, reason: `loop predicate "${origin.loop.until.ref}" not registered — stopping fail-closed` };
    const atCap = round >= origin.loop.maxRounds;
    const done = decision.done || atCap;

    // Record the decision under a deterministic id (the replay source of truth).
    appendRunNode(run, createStateNode({
      id: `${run.id}:loop-control:${originId}:r${round}`,
      kind: "loop-control",
      status: "completed",
      loopStage: "adjust",
      outputs: { round, done, atCap, reason: decision.reason },
      metadata: { originPhaseId: originId, predicate: origin.loop.until.ref, round, done, atCap, reason: decision.reason }
    }));

    if (done) {
      origin.loopDone = true;
      return;
    }

    // Expand: clone the ROUND-1 template tasks into a fresh phase appended right after.
    const nextRound = round + 1;
    const nextPhaseName = `${origin.name} (round ${nextRound})`;
    const templateTasks = run.tasks.filter((t) => origin.taskIds.includes(t.id));
    const newTasks: RunTask[] = templateTasks.map((t) => ({
      id: `${t.id.replace(/@r\d+$/, "")}@r${nextRound}`,
      kind: t.kind,
      phase: nextPhaseName,
      status: "pending",
      requiresEvidence: t.requiresEvidence,
      prompt: t.prompt,
      taskPath: "",
      resultPath: "",
      loopStage: "interpret",
      loopRound: nextRound,
      ...(t.sandboxProfileId ? { sandboxProfileId: t.sandboxProfileId } : {}),
      ...(t.label ? { label: t.label } : {}),
      ...(t.model ? { model: t.model } : {}),
      ...(t.agentType ? { agentType: t.agentType } : {}),
      ...(t.schema ? { schema: t.schema } : {})
    }));
    const nextPhase: RunPhase = {
      id: `${originId}@r${nextRound}`,
      name: nextPhaseName,
      status: "pending",
      taskIds: newTasks.map((t) => t.id),
      loopOrigin: originId,
      loopRound: nextRound,
      ...(origin.mode ? { mode: origin.mode } : {})
    };
    const insertAt = run.phases.findIndex((p) => p.id === latest.id);
    run.phases.splice(insertAt + 1, 0, nextPhase);
    run.tasks.push(...newTasks);

    // Materialize: task files + a plan-stage contract node per new task (mirrors plan()).
    writeTaskFiles(run);
    const contractId = run.contracts && run.contracts[0] ? run.contracts[0].id : undefined;
    const inputNodeId = `${run.id}:input`;
    const pipeline = createPipelineRunner({ contractId, persist: false });
    for (const t of newTasks) {
      const result = pipeline.runPipelineStage(run, "plan", inputNodeId, {
        outputNodeId: `${run.id}:task:${t.id}`,
        outputStatus: "pending",
        loopStage: "interpret",
        artifacts: [{ id: "task", kind: "markdown", path: t.taskPath }],
        metadata: { workflowId: run.workflow.id, taskId: t.id, phase: t.phase, taskKind: t.kind, requiresEvidence: t.requiresEvidence, sandboxProfileId: t.sandboxProfileId }
      });
      t.stateNodeId = result.outputNodeId;
    }
    updatePhaseStatuses(run);
    return;
  }
}

function flattenTasks(workflow: WorkflowDefinition, inputs: Record<string, unknown>): RunTask[] {
  const seen = new Set<string>();
  const tasks: RunTask[] = [];
  for (const phase of workflow.phases) {
    for (const task of phase.tasks) {
      if (seen.has(task.id)) throw new Error(`Duplicate task id: ${task.id}`);
      seen.add(task.id);
      tasks.push({
        id: task.id,
        kind: task.kind,
        phase: phase.name,
        status: "pending",
        loopStage: "interpret",
        requiresEvidence: Boolean(task.requiresEvidence),
        sandboxProfileId: task.sandboxProfileId,
        prompt: renderPrompt(task.prompt, inputs),
        taskPath: "",
        resultPath: "",
        // Track 3: carry the declared output schema onto the run task so
        // validateResultEnvelope can enforce it at intake. Absent ⇒ no schema check.
        ...(task.schema ? { schema: task.schema } : {}),
        // Authoring metadata the drive READS: label (progress/operator views),
        // model (per-task delegation override), agentType (dispatch backend).
        ...(task.label ? { label: task.label } : {}),
        ...(task.model ? { model: task.model } : {}),
        ...(task.agentType ? { agentType: task.agentType } : {}),
        ...(task.resultCache ? { resultCache: task.resultCache } : {}),
        ...(task.subWorkflow ? { subWorkflow: task.subWorkflow } : {}),
        // A loop phase's tasks are round 1 of the loop; the expander clones them.
        ...(phase.loop ? { loopRound: 1 } : {})
      });
    }
  }
  return tasks;
}

function renderPrompt(prompt: string, inputs: Record<string, unknown>): string {
  const invariant = Array.isArray(inputs.invariant)
    ? inputs.invariant.join("; ")
    : String(inputs.invariant || "");
  let rendered = String(prompt)
    .replaceAll("{{repo}}", String(inputs.repo || ""))
    .replaceAll("{{question}}", String(inputs.question || ""))
    .replaceAll("{{invariant}}", invariant);
  for (const [key, value] of Object.entries(inputs)) {
    const replacement = Array.isArray(value) ? value.join("; ") : String(value ?? "");
    rendered = rendered.replaceAll(`{{${key}}}`, replacement);
  }
  return rendered;
}

// Deterministic run id (replay-determinism self-audit): the wall-clock stamp is an
// edge timestamp (recorded once and stripped on replay), but the former
// Math.random() suffix made the run id itself non-reproducible — re-deriving the id
// for the SAME recorded run would never match. The suffix is now a content hash of
// the run's deterministic identity (workflowId + the recorded stamp), so the id is a
// pure function of inputs that already live in state. Distinct plan() invocations
// still get distinct ids because the per-millisecond stamp differs; replaying a
// recorded run reproduces the byte-identical id. Mirrors the de-clock done for
// worker ids in src/worker-isolation/paths.ts.
let runIdSequence = 0;
function createRunId(workflowId: string): string {
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\..+/, "Z");
  // The stamp is second-resolution, so several runs of the same workflowId minted
  // within one second would otherwise hash to the SAME id. process.pid + a monotonic
  // counter break the tie across BOTH same-process (counter) and concurrent-process
  // (pid) minting — deterministic-by-environment, not a PRNG, so it keeps the
  // replay-determinism intent; the id is an edge stamp stripped on replay anyway.
  runIdSequence += 1;
  const suffix = crypto
    .createHash("sha256")
    .update(`${workflowId}:${stamp}:${process.pid}:${runIdSequence}`)
    .digest("hex")
    .slice(0, 6);
  return `${workflowId}-${stamp}-${suffix}`;
}
