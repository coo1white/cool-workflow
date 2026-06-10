import fs from "node:fs";
import path from "node:path";
import {
  CorrectionTaskResult,
  ErrorFeedbackClassification,
  ErrorFeedbackLoopOptions,
  ErrorFeedbackRecord,
  ErrorFeedbackSeverity,
  ErrorFeedbackSource,
  StateArtifact,
  StateEvidence,
  StateNodeError,
  WorkflowRun
} from "./types";
import { safeFileName, saveCheckpoint, writeJson } from "./state";
import { appendRunNode, createStateNode } from "./state-node";

export const ERROR_FEEDBACK_SCHEMA_VERSION = 1;

export interface RecordFeedbackInput {
  source?: ErrorFeedbackSource;
  error: StateNodeError | Error | string;
  nodeId?: string;
  stageId?: string;
  contractId?: string;
  taskId?: string;
  path?: string;
  retryable?: boolean;
  evidence?: StateEvidence[];
  artifacts?: StateArtifact[];
  metadata?: Record<string, unknown>;
}

export interface CreateCorrectionTaskOptions {
  verifierCommand?: string;
  guidance?: string;
}

export interface ListFeedbackOptions {
  status?: ErrorFeedbackRecord["status"];
  severity?: ErrorFeedbackSeverity;
  classification?: ErrorFeedbackClassification;
}

export function createErrorFeedbackLoop(options: ErrorFeedbackLoopOptions = {}) {
  return {
    collectRunErrors: (run: WorkflowRun, collectOptions?: ErrorFeedbackLoopOptions) =>
      collectRunErrors(run, mergeOptions(options, collectOptions)),
    recordFeedback: (run: WorkflowRun, input: RecordFeedbackInput) => recordFeedback(run, input, options),
    classifyFeedback,
    createCorrectionTask: (run: WorkflowRun, feedbackId: string, taskOptions?: CreateCorrectionTaskOptions) =>
      createCorrectionTask(run, feedbackId, taskOptions),
    resolveFeedback: (run: WorkflowRun, feedbackId: string, result: CorrectionTaskResult) =>
      resolveFeedback(run, feedbackId, result),
    listFeedback: (run: WorkflowRun, listOptions?: ListFeedbackOptions) => listFeedback(run, listOptions),
    getFeedback,
    summarizeFeedback
  };
}

export function collectRunErrors(
  run: WorkflowRun,
  options: ErrorFeedbackLoopOptions = {}
): ErrorFeedbackRecord[] {
  const records: ErrorFeedbackRecord[] = [];
  const existing = new Set((run.feedback || []).map(feedbackKey));
  for (const node of run.nodes || []) {
    if (node.status !== "failed" && !node.errors.length) continue;
    for (const error of node.errors) {
      const key = feedbackKey({
        runId: run.id,
        code: error.code,
        message: error.message,
        nodeId: node.id,
        stageId: stringMetadata(node.metadata, "pipelineStage"),
        contractId: node.contractId,
        path: error.path
      });
      if (existing.has(key)) continue;
      const record = recordFeedback(
        run,
        {
          source: "state-node",
          error,
          nodeId: node.id,
          stageId: stringMetadata(node.metadata, "pipelineStage"),
          contractId: node.contractId,
          taskId: stringMetadata(node.metadata, "taskId"),
          path: error.path,
          retryable: error.retryable,
          evidence: node.evidence,
          artifacts: node.artifacts,
          metadata: {
            collectedFromNodeId: node.id,
            errorAt: error.at,
            details: error.details
          }
        },
        options
      );
      records.push(record);
      existing.add(feedbackKey(record));
    }
  }
  if (options.persist !== false && records.length) saveCheckpoint(run);
  return records;
}

export function recordFeedback(
  run: WorkflowRun,
  input: RecordFeedbackInput,
  options: ErrorFeedbackLoopOptions = {}
): ErrorFeedbackRecord {
  ensureFeedbackState(run);
  const error = normalizeError(input.error);
  const nodeId = input.nodeId || error.nodeId;
  const stageId = input.stageId;
  const contractId = input.contractId;
  const existing = (run.feedback || []).find(
    (record) =>
      record.status !== "resolved" &&
      record.code === error.code &&
      record.message === error.message &&
      record.nodeId === nodeId &&
      record.stageId === stageId &&
      record.contractId === contractId &&
      record.path === (input.path || error.path)
  );
  if (existing) return existing;

  const classification = classifyFeedback(error, {
    source: input.source || options.source,
    stageId,
    contractId,
    metadata: input.metadata
  });
  const now = new Date().toISOString();
  const record: ErrorFeedbackRecord = {
    schemaVersion: ERROR_FEEDBACK_SCHEMA_VERSION,
    id: createFeedbackId(classification),
    runId: run.id,
    createdAt: now,
    updatedAt: now,
    status: "open",
    severity: severityFor(classification, error),
    classification,
    source: input.source || options.source || sourceFor(classification),
    code: error.code,
    message: error.message,
    nodeId,
    stageId,
    contractId,
    taskId: input.taskId,
    path: input.path || error.path,
    retryable: input.retryable ?? error.retryable ?? options.policy?.retryableByDefault ?? false,
    evidence: input.evidence || [],
    artifacts: input.artifacts || [],
    metadata: compactMetadata({
      ...input.metadata,
      details: input.metadata?.details || error.details
    })
  };
  run.feedback = [...(run.feedback || []), record];
  writeFeedback(run, record);
  writeFeedbackIndex(run);
  if (options.persist !== false) saveCheckpoint(run);
  return record;
}

export function classifyFeedback(
  error: StateNodeError | Error | string,
  context: { source?: ErrorFeedbackSource; stageId?: string; contractId?: string; metadata?: Record<string, unknown> } = {}
): ErrorFeedbackClassification {
  const normalized = normalizeError(error);
  const code = normalized.code.toLowerCase();
  if (code.includes("missing-artifact") || code.includes("artifact-path")) return "missing-artifact";
  if (code.includes("missing-required-evidence") || code.includes("missing-evidence")) return "missing-evidence";
  if (code.includes("verifier") || context.stageId === "verify" || context.source === "verifier") return "verifier-failure";
  if (code.includes("illegal-transition") || code.includes("state-transition")) return "state-transition";
  if (code.includes("contract") || code.includes("unexpected-node") || context.contractId) return "contract-violation";
  if (code.startsWith("sandbox-")) return "sandbox-policy";
  if (code.includes("parse") || code.includes("json")) return "parse-error";
  if (code.includes("pipeline")) return "pipeline-failure";
  if (normalized.code === "runtime-error") return "runtime-error";
  return "unknown";
}

export function createCorrectionTask(
  run: WorkflowRun,
  feedbackId: string,
  options: CreateCorrectionTaskOptions = {}
): ErrorFeedbackRecord {
  const record = requireFeedback(run, feedbackId);
  if (record.correctionTaskId) return record;
  const taskId = `feedback:${safeFileName(record.id)}`;
  const taskPath = path.join(run.paths.tasksDir, `${safeFileName(taskId)}.md`);
  const body = renderCorrectionTask(record, options);
  fs.mkdirSync(path.dirname(taskPath), { recursive: true });
  fs.writeFileSync(taskPath, body, "utf8");

  const node = appendRunNode(
    run,
    createStateNode({
      id: `${run.id}:task:${taskId}`,
      kind: "task",
      status: "pending",
      loopStage: "adjust",
      inputs: { feedbackId: record.id, nodeId: record.nodeId, stageId: record.stageId, contractId: record.contractId },
      artifacts: [{ id: "task", kind: "markdown", path: taskPath }],
      parents: record.nodeId ? [record.nodeId] : [],
      contractId: record.contractId,
      metadata: { feedbackId: record.id, correctionTask: true, retryable: record.retryable }
    })
  );

  updateFeedback(run, {
    ...record,
    updatedAt: new Date().toISOString(),
    status: "tasked",
    correctionTaskId: taskId,
    metadata: {
      ...(record.metadata || {}),
      correctionTaskPath: taskPath,
      correctionTaskNodeId: node.id,
      verifierCommand: options.verifierCommand
    }
  });
  saveCheckpoint(run);
  return requireFeedback(run, feedbackId);
}

export function resolveFeedback(
  run: WorkflowRun,
  feedbackId: string,
  result: CorrectionTaskResult
): ErrorFeedbackRecord {
  const record = requireFeedback(run, feedbackId);
  if (result.status === "resolved" && !result.nodeId) {
    throw new Error(`Feedback ${feedbackId} cannot resolve without a verified node id`);
  }
  if (result.status === "resolved") {
    const node = (run.nodes || []).find((candidate) => candidate.id === result.nodeId);
    if (!node) throw new Error(`Feedback ${feedbackId} resolution node not found: ${result.nodeId}`);
    if (node.status !== "verified" && node.status !== "committed") {
      throw new Error(`Feedback ${feedbackId} resolution node must be verified or committed`);
    }
  }
  const nextStatus = result.status === "resolved" ? "resolved" : "rejected";
  updateFeedback(run, {
    ...record,
    updatedAt: new Date().toISOString(),
    status: nextStatus,
    resolvedByNodeId: result.nodeId,
    resolvedAt: nextStatus === "resolved" ? new Date().toISOString() : record.resolvedAt,
    resolutionNote: result.message || record.resolutionNote,
    evidence: mergeById(record.evidence, result.evidence || []),
    artifacts: mergeById(record.artifacts, result.artifacts || []),
    metadata: compactMetadata({
      ...(record.metadata || {}),
      resolutionMessage: result.message,
      resolution: result.metadata
    })
  });
  saveCheckpoint(run);
  return requireFeedback(run, feedbackId);
}

export function listFeedback(run: WorkflowRun, options: ListFeedbackOptions = {}): ErrorFeedbackRecord[] {
  ensureFeedbackState(run);
  return (run.feedback || []).filter((record) => {
    if (options.status && record.status !== options.status) return false;
    if (options.severity && record.severity !== options.severity) return false;
    if (options.classification && record.classification !== options.classification) return false;
    return true;
  });
}

export function getFeedback(run: WorkflowRun, feedbackId: string): ErrorFeedbackRecord | undefined {
  ensureFeedbackState(run);
  return (run.feedback || []).find((record) => record.id === feedbackId);
}

export function summarizeFeedback(run: WorkflowRun): {
  total: number;
  byStatus: Record<string, number>;
  bySeverity: Record<string, number>;
  byClassification: Record<string, number>;
  artifacts: string[];
} {
  ensureFeedbackState(run);
  const records = run.feedback || [];
  return {
    total: records.length,
    byStatus: countBy(records, (record) => record.status),
    bySeverity: countBy(records, (record) => record.severity),
    byClassification: countBy(records, (record) => record.classification),
    artifacts: records.map((record) => feedbackPath(run, record.id))
  };
}

function ensureFeedbackState(run: WorkflowRun): void {
  run.paths.feedbackDir = run.paths.feedbackDir || path.join(run.paths.runDir, "feedback");
  fs.mkdirSync(run.paths.feedbackDir, { recursive: true });
  run.feedback = run.feedback || [];
}

function normalizeError(error: StateNodeError | Error | string): StateNodeError {
  if (typeof error === "string") {
    return { code: "runtime-error", message: error, at: new Date().toISOString() };
  }
  if (error instanceof Error) {
    return { code: codeFromError(error), message: error.message, at: new Date().toISOString() };
  }
  return {
    ...error,
    code: error.code || "runtime-error",
    message: error.message || "Unknown error",
    at: error.at || new Date().toISOString()
  };
}

function codeFromError(error: Error): string {
  if (/Invalid cw:result JSON/i.test(error.message)) return "result-parse-error";
  if (/requires cw:result evidence/i.test(error.message)) return "missing-required-evidence";
  if (/requires evidence/i.test(error.message)) return "missing-required-evidence";
  if (/Phase gate blocked/i.test(error.message)) return "phase-gate-blocked";
  return "runtime-error";
}

function severityFor(classification: ErrorFeedbackClassification, error: StateNodeError): ErrorFeedbackSeverity {
  if (classification === "verifier-failure" || classification === "contract-violation") return "high";
  if (classification === "sandbox-policy") return "medium";
  if (classification === "state-transition" || classification === "missing-evidence") return "medium";
  if (classification === "missing-artifact" || classification === "parse-error" || classification === "pipeline-failure") {
    return error.retryable ? "medium" : "low";
  }
  return "low";
}

function sourceFor(classification: ErrorFeedbackClassification): ErrorFeedbackSource {
  if (classification === "contract-violation") return "contract";
  if (classification === "verifier-failure" || classification === "missing-evidence") return "verifier";
  if (classification === "pipeline-failure") return "pipeline-runner";
  if (classification === "sandbox-policy") return "contract";
  return "manual";
}

function writeFeedback(run: WorkflowRun, record: ErrorFeedbackRecord): void {
  writeJson(feedbackPath(run, record.id), record);
}

function writeFeedbackIndex(run: WorkflowRun): void {
  ensureFeedbackState(run);
  writeJson(path.join(run.paths.feedbackDir, "index.json"), run.feedback || []);
}

function feedbackPath(run: WorkflowRun, feedbackId: string): string {
  ensureFeedbackState(run);
  return path.join(run.paths.feedbackDir, `${safeFileName(feedbackId)}.json`);
}

function updateFeedback(run: WorkflowRun, record: ErrorFeedbackRecord): void {
  ensureFeedbackState(run);
  run.feedback = (run.feedback || []).map((candidate) => (candidate.id === record.id ? record : candidate));
  writeFeedback(run, record);
  writeFeedbackIndex(run);
}

function requireFeedback(run: WorkflowRun, feedbackId: string): ErrorFeedbackRecord {
  const record = getFeedback(run, feedbackId);
  if (!record) throw new Error(`Unknown feedback id for run ${run.id}: ${feedbackId}`);
  return record;
}

function renderCorrectionTask(record: ErrorFeedbackRecord, options: CreateCorrectionTaskOptions): string {
  const verifier = options.verifierCommand || "Run the relevant verifier or smoke test and record the verified StateNode id.";
  const guidance = options.guidance || (record.retryable ? "Retry only after explicit correction input." : "Do not retry blindly.");
  return [
    `# Correction Task: ${record.id}`,
    "",
    `- Status: ${record.status}`,
    `- Severity: ${record.severity}`,
    `- Classification: ${record.classification}`,
    `- Source: ${record.source}`,
    `- Code: ${record.code}`,
    `- Message: ${record.message}`,
    `- Node: ${record.nodeId || ""}`,
    `- Stage: ${record.stageId || ""}`,
    `- Contract: ${record.contractId || ""}`,
    `- Path: ${record.path || ""}`,
    `- Retryable: ${record.retryable ? "yes" : "no"}`,
    "",
    "## Evidence",
    "",
    ...formatEvidence(record.evidence),
    "",
    "## Expected Verification",
    "",
    verifier,
    "",
    "## Guidance",
    "",
    guidance,
    ""
  ].join("\n");
}

function formatEvidence(evidence: StateEvidence[]): string[] {
  if (!evidence.length) return ["No evidence recorded."];
  return evidence.map((entry) => `- ${entry.id}: ${entry.locator || entry.path || entry.summary || entry.source || ""}`);
}

function createFeedbackId(classification: ErrorFeedbackClassification): string {
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\..+/, "Z");
  return `feedback-${classification}-${stamp}-${Math.random().toString(36).slice(2, 8)}`;
}

function feedbackKey(value: Partial<ErrorFeedbackRecord> & { runId?: string; code?: string; message?: string }): string {
  return [
    value.runId || "",
    value.code || "",
    value.message || "",
    value.nodeId || "",
    value.stageId || "",
    value.contractId || "",
    value.path || ""
  ].join("\u001f");
}

function stringMetadata(metadata: Record<string, unknown> | undefined, key: string): string | undefined {
  const value = metadata?.[key];
  return typeof value === "string" ? value : undefined;
}

function compactMetadata(metadata: Record<string, unknown>): Record<string, unknown> | undefined {
  const compacted: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(metadata)) {
    if (value !== undefined) compacted[key] = value;
  }
  return Object.keys(compacted).length ? compacted : undefined;
}

function mergeById<T extends { id: string }>(existing: T[], next: T[]): T[] {
  const values = [...existing];
  for (const item of next) {
    const index = values.findIndex((candidate) => candidate.id === item.id);
    if (index >= 0) values[index] = item;
    else values.push(item);
  }
  return values;
}

function countBy<T>(values: T[], key: (value: T) => string): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const value of values) {
    const bucket = key(value);
    counts[bucket] = (counts[bucket] || 0) + 1;
  }
  return counts;
}

function mergeOptions(base: ErrorFeedbackLoopOptions, next: ErrorFeedbackLoopOptions = {}): ErrorFeedbackLoopOptions {
  return {
    ...base,
    ...next,
    policy: {
      ...(base.policy || {}),
      ...(next.policy || {})
    }
  };
}
