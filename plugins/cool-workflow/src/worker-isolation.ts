import fs from "node:fs";
import path from "node:path";
import {
  RunTask,
  StateArtifact,
  StateEvidence,
  StateNodeError,
  WorkerBoundaryViolation,
  WorkerIsolationOptions,
  WorkerManifest,
  WorkerOutputRecord,
  WorkerScope,
  WorkflowRun
} from "./types";
import { safeFileName, saveCheckpoint, writeJson } from "./state";
import { DEFAULT_PIPELINE_CONTRACT_ID } from "./pipeline-contract";
import { recordFeedback } from "./error-feedback";
import { appendRunNode, createStateNode, linkStateNodes, recordNodeError } from "./state-node";
import { createPipelineRunner } from "./pipeline-runner";
import { parseResultEnvelope, validateResultEnvelope } from "./verifier";

export const WORKER_ISOLATION_SCHEMA_VERSION = 1;

export interface RecordWorkerFailureOptions extends WorkerIsolationOptions {
  code?: string;
  path?: string;
  retryable?: boolean;
}

export function createWorkerIsolation(options: WorkerIsolationOptions = {}) {
  return {
    allocateWorkerScope: (run: WorkflowRun, task: RunTask, allocateOptions?: WorkerIsolationOptions) =>
      allocateWorkerScope(run, task, { ...options, ...allocateOptions }),
    writeWorkerManifest,
    listWorkerScopes: (run: WorkflowRun, listOptions?: { status?: WorkerScope["status"] }) =>
      listWorkerScopes(run, listOptions),
    getWorkerScope,
    recordWorkerOutput,
    recordWorkerFailure,
    validateWorkerBoundary,
    summarizeWorkers
  };
}

export function allocateWorkerScope(
  run: WorkflowRun,
  task: RunTask,
  options: WorkerIsolationOptions = {}
): WorkerScope {
  ensureWorkerState(run);
  const existing = task.workerId ? getWorkerScope(run, task.workerId) : undefined;
  if (existing) return existing;

  const now = new Date().toISOString();
  const workerId = options.workerId || createWorkerId(task.id);
  const workerDir = path.join(workerRoot(run), safeFileName(workerId));
  const inputPath = path.join(workerDir, "input.md");
  const resultPath = path.join(workerDir, "result.md");
  const artifactsDir = path.join(workerDir, "artifacts");
  const logsDir = path.join(workerDir, "logs");
  const allowedPaths = uniqueResolved([
    resultPath,
    artifactsDir,
    logsDir,
    ...(options.policy?.allowedPaths || [])
  ]);

  fs.mkdirSync(artifactsDir, { recursive: true });
  fs.mkdirSync(logsDir, { recursive: true });

  const scope: WorkerScope = {
    schemaVersion: WORKER_ISOLATION_SCHEMA_VERSION,
    id: workerId,
    runId: run.id,
    taskId: task.id,
    dispatchId: options.dispatchId || task.dispatchId,
    createdAt: now,
    updatedAt: now,
    status: options.status || "allocated",
    workerDir,
    inputPath,
    resultPath,
    artifactsDir,
    logsDir,
    allowedPaths,
    stateNodeId: task.stateNodeId,
    feedbackIds: [],
    errors: [],
    metadata: compactMetadata({
      ...options.metadata,
      phase: task.phase,
      kind: task.kind,
      taskPath: task.taskPath
    })
  };

  writeWorkerInput(run, task, scope);
  writeWorkerManifest(run, scope);
  upsertWorkerScope(run, scope);
  task.workerId = scope.id;
  task.workerManifestPath = manifestPath(scope);
  writeWorkerIndex(run);
  if (options.persist !== false) saveCheckpoint(run);
  return scope;
}

export function writeWorkerManifest(run: WorkflowRun, scope: WorkerScope): WorkerManifest {
  const task = run.tasks.find((candidate) => candidate.id === scope.taskId);
  const manifest: WorkerManifest = {
    schemaVersion: WORKER_ISOLATION_SCHEMA_VERSION,
    id: scope.id,
    runId: scope.runId,
    taskId: scope.taskId,
    dispatchId: scope.dispatchId,
    createdAt: scope.createdAt,
    updatedAt: scope.updatedAt,
    status: scope.status,
    workerDir: scope.workerDir,
    inputPath: scope.inputPath,
    resultPath: scope.resultPath,
    artifactsDir: scope.artifactsDir,
    logsDir: scope.logsDir,
    allowedPaths: scope.allowedPaths,
    instructions: [
      "Read input.md before doing work.",
      "Write the final Markdown result to result.md.",
      "Write worker-local artifacts under artifacts/ and logs under logs/.",
      "Do not edit shared run state files directly; CW records accepted results."
    ],
    taskPath: task?.taskPath,
    prompt: task?.prompt,
    stateNodeId: scope.stateNodeId,
    resultNodeId: scope.resultNodeId,
    feedbackIds: scope.feedbackIds,
    errors: scope.errors,
    output: scope.output,
    metadata: scope.metadata
  };
  writeJson(manifestPath(scope), manifest);
  return manifest;
}

export function listWorkerScopes(run: WorkflowRun, options: { status?: WorkerScope["status"] } = {}): WorkerScope[] {
  ensureWorkerState(run);
  const scopes = loadWorkerScopesFromDisk(run);
  run.workers = mergeScopes(run.workers || [], scopes);
  const listed = run.workers || [];
  return options.status ? listed.filter((scope) => scope.status === options.status) : listed;
}

export function getWorkerScope(run: WorkflowRun, workerId: string): WorkerScope | undefined {
  ensureWorkerState(run);
  const existing = (run.workers || []).find((scope) => scope.id === workerId);
  if (existing) return existing;
  const file = path.join(workerRoot(run), safeFileName(workerId), "worker.json");
  if (!fs.existsSync(file)) return undefined;
  const scope = JSON.parse(fs.readFileSync(file, "utf8")) as WorkerScope;
  upsertWorkerScope(run, scope);
  return scope;
}

export function recordWorkerOutput(
  run: WorkflowRun,
  workerId: string,
  resultPath: string,
  options: WorkerIsolationOptions = {}
): WorkerOutputRecord {
  const scope = requireWorkerScope(run, workerId);
  const task = requireWorkerTask(run, scope);
  const absoluteResultPath = path.resolve(resultPath);
  const violation = validateWorkerBoundary(run, workerId, { ...options, policy: options.policy, path: absoluteResultPath });
  if (violation) {
    recordWorkerFailure(run, workerId, violation, { ...options, path: absoluteResultPath, code: violation.code, retryable: false });
    throw new Error(violation.message);
  }
  if (!fs.existsSync(absoluteResultPath)) {
    const error = structuredError("worker-result-missing", `Worker result file does not exist: ${absoluteResultPath}`, {
      path: absoluteResultPath,
      retryable: true
    });
    recordWorkerFailure(run, workerId, error, { ...options, persist: options.persist });
    throw new Error(error.message);
  }

  const rawResult = fs.readFileSync(absoluteResultPath, "utf8");
  const parsedResult = parseResultEnvelope(rawResult);
  validateResultEnvelope(task, parsedResult);
  const destination = path.join(run.paths.resultsDir, `${safeFileName(task.id)}.md`);
  fs.mkdirSync(run.paths.resultsDir, { recursive: true });
  fs.copyFileSync(absoluteResultPath, destination);

  task.status = "completed";
  task.completedAt = new Date().toISOString();
  task.resultPath = destination;
  task.loopStage = "observe";
  task.result = parsedResult;
  const evidence = parsedResult.evidence.map((entry, index) => ({
    id: `result:${index + 1}`,
    source: "cw:result",
    locator: entry,
    summary: entry
  }));
  const resultNode = appendRunNode(
    run,
    createStateNode({
      id: `${run.id}:result:${task.id}`,
      kind: "result",
      status: "completed",
      loopStage: "observe",
      inputs: { taskId: task.id, dispatchId: task.dispatchId, workerId },
      outputs: parsedResult as unknown as Record<string, unknown>,
      artifacts: [
        { id: "result", kind: "markdown", path: destination },
        { id: "worker-result", kind: "markdown", path: absoluteResultPath }
      ],
      evidence,
      parents: task.dispatchId ? [`${run.id}:dispatch:${task.dispatchId}`] : [task.stateNodeId || `${run.id}:task:${task.id}`],
      contractId: DEFAULT_PIPELINE_CONTRACT_ID,
      metadata: { taskId: task.id, workerId, workerDir: scope.workerDir }
    })
  );
  task.resultNodeId = resultNode.id;

  const verifierResult = createPipelineRunner({ persist: false }).runPipelineStage(run, "verify", resultNode.id, {
    outputNodeId: `${run.id}:verifier:${task.id}`,
    outputStatus: "verified",
    loopStage: "adjust",
    outputs: { accepted: true, workerId },
    artifacts: [{ id: "result", kind: "markdown", path: destination }],
    evidence: resultNode.evidence.length
      ? resultNode.evidence
      : [{ id: "result:summary", source: "summary", summary: parsedResult.summary }],
    metadata: { taskId: task.id, workerId, resultNodeId: resultNode.id }
  });
  task.verifierNodeId = verifierResult.outputNodeId;

  const output: WorkerOutputRecord = {
    workerId,
    taskId: task.id,
    resultPath: absoluteResultPath,
    recordedAt: new Date().toISOString(),
    stateNodeId: resultNode.id,
    verifierNodeId: verifierResult.outputNodeId
  };
  updateWorkerScope(run, {
    ...scope,
    updatedAt: new Date().toISOString(),
    status: verifierResult.status === "advanced" ? "verified" : "completed",
    resultNodeId: resultNode.id,
    output
  });
  if (options.persist !== false) saveCheckpoint(run);
  return output;
}

export function recordWorkerFailure(
  run: WorkflowRun,
  workerId: string,
  error: unknown,
  options: RecordWorkerFailureOptions = {}
): WorkerScope {
  const scope = requireWorkerScope(run, workerId);
  const task = requireWorkerTask(run, scope);
  const structured = normalizeWorkerError(error, scope, options);
  const failureNodeId = `${run.id}:worker:${safeFileName(workerId)}:failure:${scope.errors.length + 1}`;
  let failureNode = recordNodeError(
    createStateNode({
      id: failureNodeId,
      kind: "error",
      status: "pending",
      loopStage: "adjust",
      inputs: { workerId, taskId: task.id, dispatchId: scope.dispatchId },
      artifacts: workerArtifacts(scope),
      parents: task.stateNodeId ? [task.stateNodeId] : [],
      contractId: DEFAULT_PIPELINE_CONTRACT_ID,
      metadata: { workerId, taskId: task.id, dispatchId: scope.dispatchId, workerDir: scope.workerDir }
    }),
    structured
  );
  if (task.stateNodeId) {
    const parent = run.nodes?.find((candidate) => candidate.id === task.stateNodeId);
    if (parent) {
      const linked = linkStateNodes(parent, failureNode);
      appendRunNode(run, linked[0]);
      failureNode = linked[1];
    }
  }
  appendRunNode(run, failureNode);
  task.status = "failed";
  task.loopStage = "adjust";
  const feedback = recordFeedback(
    run,
    {
      source: "pipeline-runner",
      error: structured,
      nodeId: failureNode.id,
      taskId: task.id,
      path: structured.path,
      retryable: structured.retryable,
      artifacts: failureNode.artifacts,
      metadata: {
        workerId,
        dispatchId: scope.dispatchId,
        workerDir: scope.workerDir,
        allowedPaths: scope.allowedPaths,
        details: structured.details
      }
    },
    { persist: false }
  );
  updateWorkerScope(run, {
    ...scope,
    updatedAt: new Date().toISOString(),
    status: structured.code === "worker-boundary-violation" ? "rejected" : "failed",
    feedbackIds: unique([...(scope.feedbackIds || []), feedback.id]),
    errors: [...(scope.errors || []), structured]
  });
  if (options.persist !== false) saveCheckpoint(run);
  return requireWorkerScope(run, workerId);
}

export function validateWorkerBoundary(
  run: WorkflowRun,
  workerId: string,
  options: WorkerIsolationOptions & { path?: string } = {}
): WorkerBoundaryViolation | null {
  const scope = requireWorkerScope(run, workerId);
  const rawPath = String(options.path || scope.resultPath);
  if (hasTraversal(rawPath)) {
    const allowedPaths = uniqueResolved([scope.resultPath, scope.artifactsDir, scope.logsDir, ...(options.policy?.allowedPaths || scope.allowedPaths || [])]);
    return {
      code: "worker-boundary-violation",
      message: `Worker ${workerId} output path contains traversal: ${rawPath}`,
      path: rawPath,
      allowedPaths
    };
  }
  const candidate = path.resolve(rawPath);
  const allowedPaths = uniqueResolved([scope.resultPath, scope.artifactsDir, scope.logsDir, ...(options.policy?.allowedPaths || scope.allowedPaths || [])]);
  const insideAllowedPath = allowedPaths.some((allowed) => candidate === allowed || candidate.startsWith(`${allowed}${path.sep}`));
  if (!insideAllowedPath) {
    return {
      code: "worker-boundary-violation",
      message: `Worker ${workerId} output path is outside its allowed paths: ${candidate}`,
      path: candidate,
      allowedPaths
    };
  }
  return null;
}

export function summarizeWorkers(run: WorkflowRun): {
  total: number;
  byStatus: Record<string, number>;
  manifestPaths: string[];
  failed: Array<{ id: string; status: string; feedbackIds: string[] }>;
} {
  const workers = listWorkerScopes(run);
  return {
    total: workers.length,
    byStatus: countBy(workers, (scope) => scope.status),
    manifestPaths: workers.map(manifestPath),
    failed: workers
      .filter((scope) => scope.status === "failed" || scope.status === "rejected")
      .map((scope) => ({ id: scope.id, status: scope.status, feedbackIds: scope.feedbackIds || [] }))
  };
}

function ensureWorkerState(run: WorkflowRun): void {
  run.paths.workersDir = run.paths.workersDir || path.join(run.paths.runDir, "workers");
  fs.mkdirSync(run.paths.workersDir, { recursive: true });
  run.workers = run.workers || [];
}

function writeWorkerInput(run: WorkflowRun, task: RunTask, scope: WorkerScope): void {
  const lines = [
    `# Worker ${scope.id}`,
    "",
    `- Run: ${run.id}`,
    `- Task: ${task.id}`,
    `- Dispatch: ${scope.dispatchId || ""}`,
    `- Result: ${scope.resultPath}`,
    `- Artifacts: ${scope.artifactsDir}`,
    `- Logs: ${scope.logsDir}`,
    "",
    "## Task",
    "",
    task.prompt,
    "",
    "## Boundary",
    "",
    "- Write the final Markdown result to result.md.",
    "- Keep extra files under artifacts/ or logs/.",
    "- Do not mutate state.json, nodes/, feedback/, dispatches/, or commits/ directly.",
    ""
  ];
  fs.writeFileSync(scope.inputPath, lines.join("\n"), "utf8");
}

function upsertWorkerScope(run: WorkflowRun, scope: WorkerScope): WorkerScope {
  ensureWorkerState(run);
  const scopes = run.workers || [];
  const index = scopes.findIndex((candidate) => candidate.id === scope.id);
  run.workers = index >= 0 ? scopes.map((candidate) => (candidate.id === scope.id ? scope : candidate)) : [...scopes, scope];
  writeWorkerScope(scope);
  return scope;
}

function updateWorkerScope(run: WorkflowRun, scope: WorkerScope): WorkerScope {
  const updated = upsertWorkerScope(run, scope);
  writeWorkerManifest(run, updated);
  writeWorkerIndex(run);
  return updated;
}

function writeWorkerScope(scope: WorkerScope): void {
  writeJson(path.join(scope.workerDir, "worker.json"), scope);
}

function writeWorkerIndex(run: WorkflowRun): void {
  ensureWorkerState(run);
  writeJson(path.join(workerRoot(run), "index.json"), {
    schemaVersion: WORKER_ISOLATION_SCHEMA_VERSION,
    runId: run.id,
    workers: (run.workers || []).map((scope) => ({
      id: scope.id,
      taskId: scope.taskId,
      dispatchId: scope.dispatchId,
      status: scope.status,
      workerDir: scope.workerDir,
      manifestPath: manifestPath(scope),
      resultPath: scope.resultPath,
      feedbackIds: scope.feedbackIds
    }))
  });
}

function loadWorkerScopesFromDisk(run: WorkflowRun): WorkerScope[] {
  ensureWorkerState(run);
  if (!fs.existsSync(workerRoot(run))) return [];
  return fs
    .readdirSync(workerRoot(run), { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(workerRoot(run), entry.name, "worker.json"))
    .filter((file) => fs.existsSync(file))
    .map((file) => JSON.parse(fs.readFileSync(file, "utf8")) as WorkerScope);
}

function requireWorkerScope(run: WorkflowRun, workerId: string): WorkerScope {
  const scope = getWorkerScope(run, workerId);
  if (!scope) throw new Error(`Unknown worker for run ${run.id}: ${workerId}`);
  return scope;
}

function requireWorkerTask(run: WorkflowRun, scope: WorkerScope): RunTask {
  const task = run.tasks.find((candidate) => candidate.id === scope.taskId);
  if (!task) throw new Error(`Unknown task for worker ${scope.id}: ${scope.taskId}`);
  return task;
}

function workerRoot(run: WorkflowRun): string {
  return run.paths.workersDir || path.join(run.paths.runDir, "workers");
}

function manifestPath(scope: WorkerScope): string {
  return path.join(scope.workerDir, "worker.json");
}

function createWorkerId(taskId: string): string {
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\..+/, "Z");
  return `worker-${safeFileName(taskId)}-${stamp}-${Math.random().toString(36).slice(2, 8)}`;
}

function workerArtifacts(scope: WorkerScope): StateArtifact[] {
  return [
    { id: "worker", kind: "json", path: manifestPath(scope) },
    { id: "worker-input", kind: "markdown", path: scope.inputPath }
  ];
}

function normalizeWorkerError(error: unknown, scope: WorkerScope, options: RecordWorkerFailureOptions): StateNodeError {
  if (isBoundaryViolation(error)) {
    return structuredError(error.code, error.message, {
      path: error.path,
      retryable: false,
      details: { allowedPaths: error.allowedPaths, workerId: scope.id, taskId: scope.taskId }
    });
  }
  if (isStateNodeError(error)) {
    return {
      ...error,
      at: error.at || new Date().toISOString(),
      path: options.path || error.path,
      retryable: options.retryable ?? error.retryable ?? false,
      details: compactMetadata({ ...(error.details || {}), workerId: scope.id, taskId: scope.taskId })
    };
  }
  const message = error instanceof Error ? error.message : String(error);
  return structuredError(options.code || "worker-runtime-error", message, {
    path: options.path,
    retryable: options.retryable ?? false,
    details: { workerId: scope.id, taskId: scope.taskId }
  });
}

function structuredError(
  code: string,
  message: string,
  options: { path?: string; retryable?: boolean; details?: Record<string, unknown> } = {}
): StateNodeError {
  return {
    code,
    message,
    at: new Date().toISOString(),
    path: options.path,
    retryable: options.retryable,
    details: options.details
  };
}

function isBoundaryViolation(value: unknown): value is WorkerBoundaryViolation {
  return Boolean(value && typeof value === "object" && "allowedPaths" in value && "message" in value);
}

function isStateNodeError(value: unknown): value is StateNodeError {
  return Boolean(value && typeof value === "object" && "code" in value && "message" in value);
}

function mergeScopes(left: WorkerScope[], right: WorkerScope[]): WorkerScope[] {
  const merged = [...left];
  for (const scope of right) {
    const index = merged.findIndex((candidate) => candidate.id === scope.id);
    if (index >= 0) merged[index] = scope;
    else merged.push(scope);
  }
  return merged;
}

function unique(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean)));
}

function uniqueResolved(values: string[]): string[] {
  return unique(values.map((value) => path.resolve(value)));
}

function compactMetadata(value: Record<string, unknown>): Record<string, unknown> | undefined {
  const entries = Object.entries(value).filter(([, entry]) => entry !== undefined);
  return entries.length ? Object.fromEntries(entries) : undefined;
}

function hasTraversal(value: string): boolean {
  return value.split(/[\\/]+/).includes("..");
}

function countBy<T>(items: T[], key: (item: T) => string): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const item of items) {
    const value = key(item);
    counts[value] = (counts[value] || 0) + 1;
  }
  return counts;
}
