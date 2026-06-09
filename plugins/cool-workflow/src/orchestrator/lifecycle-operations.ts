// Core run-lifecycle operations (v0.1.40 self-audit P3 router pattern).
//
// The engine core — plan / dispatch / recordResult / worker-output / commit /
// checkState — carved out of CoolWorkflowRunner so the runner is a pure router.
// plan() receives an already-resolved workflow app record (the runner still owns
// app loading, which is instance-stateful). Behavior is identical to the inline
// implementations; only the location changed.
import fs from "node:fs";
import path from "node:path";
import {
  AgentDelegationInput,
  DispatchManifest,
  LoadedWorkflowApp,
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
import { workflowAppRunMetadata } from "../workflow-app-sdk";
import { slugify } from "../workflow-api";
import { parseUsageFromArgs } from "../observability";
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

  const cwd = path.resolve(String(inputs.cwd || inputs.repo || process.cwd()));
  const runId = createRunId(workflow.id);
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
      taskIds: phase.tasks.map((task) => task.id)
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
  try {
    recordWorkerOutputImpl(run, workerId, resultPath, { persist: false, agentDelegation });
    if (usage) {
      const worker = getWorkerScope(run, workerId);
      // Host-attested token usage rides on the worker record as provenance.
      if (worker) worker.usage = usage;
    }
    run.loopStage = "observe";
    updatePhaseStatuses(run);
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
    { persist: false }
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
        resultPath: ""
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

function createRunId(workflowId: string): string {
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\..+/, "Z");
  const suffix = Math.random().toString(36).slice(2, 8);
  return `${workflowId}-${stamp}-${suffix}`;
}
