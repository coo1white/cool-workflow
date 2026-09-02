// shell/error-feedback-io.ts — recordFeedback: the impure wrapper around
// core/pipeline/error-feedback.ts's pure record builder.
//
// MILESTONE 9 (needed by candidate-scoring/collaboration selection/score
// failures; not built by milestone 6+7 since nothing there needed the
// operator-facing `feedback/<id>.json` + index.json + saveCheckpoint
// write path yet). Byte-exact port of the old build's src/error-
// feedback.ts's `recordFeedback` (dedup-on-open-record, disk write,
// saveCheckpoint).
//
// Evidence: SPEC/pipeline-run.md "Error feedback — error-feedback module".

import * as fs from "node:fs";
import * as path from "node:path";
import { safeFileName, writeJson } from "./fs-atomic";
import { StateArtifact, StateEvidence, WorkflowRun } from "../core/state/types";
import {
  buildFeedbackRecord,
  ErrorFeedbackClassification,
  ErrorFeedbackRecord,
  ErrorFeedbackSeverity,
  ErrorFeedbackSource,
  feedbackKey,
  findExistingFeedback,
  RecordFeedbackInput,
} from "../core/pipeline/error-feedback";
import { createStateNode } from "../core/state/state-node";
import { appendRunNode } from "./node-store";
import { saveCheckpoint } from "./run-store";
import {
  runPipelineStage as coreRunPipelineStage,
  RunPipelineStageOptions,
  PipelineRunnerOptions,
  PipelineStageRunResult,
  PipelineStageFailure,
} from "../core/pipeline/runner";
import { StateNodeError } from "../core/state/types";

export interface ListFeedbackOptions {
  status?: ErrorFeedbackRecord["status"];
  severity?: ErrorFeedbackSeverity;
  classification?: ErrorFeedbackClassification;
}
export interface CreateCorrectionTaskOptions {
  verifierCommand?: string;
  guidance?: string;
}
export interface CorrectionTaskResult {
  status: "resolved" | "rejected";
  nodeId?: string;
  message?: string;
  evidence?: StateEvidence[];
  artifacts?: StateArtifact[];
  metadata?: Record<string, unknown>;
}
export interface ErrorFeedbackLoopOptions {
  source?: ErrorFeedbackSource;
  persist?: boolean;
}

function ensureFeedbackState(run: WorkflowRun): ErrorFeedbackRecord[] {
  run.paths.feedbackDir = run.paths.feedbackDir || path.join(run.paths.runDir, "feedback");
  fs.mkdirSync(run.paths.feedbackDir, { recursive: true });
  run.feedback = (run.feedback as ErrorFeedbackRecord[] | undefined) || [];
  return run.feedback as ErrorFeedbackRecord[];
}

function feedbackPath(run: WorkflowRun, feedbackId: string): string {
  ensureFeedbackState(run);
  return path.join(run.paths.feedbackDir as string, `${safeFileName(feedbackId)}.json`);
}

function writeFeedbackIndex(run: WorkflowRun): void {
  const records = ensureFeedbackState(run);
  writeJson(path.join(run.paths.feedbackDir as string, "index.json"), records);
}

/** Dedup-on-open-record; else builds + persists a new record. */
export function recordFeedback(run: WorkflowRun, input: RecordFeedbackInput, options: { persist?: boolean } = {}): ErrorFeedbackRecord {
  const records = ensureFeedbackState(run);
  const now = new Date().toISOString();
  const normalizedError =
    typeof input.error === "string"
      ? { code: "runtime-error", message: input.error, at: now }
      : input.error instanceof Error
        ? { code: "runtime-error", message: input.error.message, at: now }
        : input.error;
  const existing = findExistingFeedback(records, normalizedError, input.nodeId || normalizedError.nodeId, input.stageId, input.contractId, input.path || normalizedError.path);
  if (existing) return existing;

  const record = buildFeedbackRecord(run.id, input, records.length, now);
  run.feedback = [...records, record];
  writeJson(feedbackPath(run, record.id), record);
  writeFeedbackIndex(run);
  if (options.persist !== false) saveCheckpoint(run);
  return record;
}

// ---------------------------------------------------------------------------
// Operator feedback lifecycle primitives — collect / list / get / correction
// task / resolve. Byte-behavior port of the old error-feedback module halves
// that v2 had not yet ported (v2 shipped only the record-builder half).
// ---------------------------------------------------------------------------

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

function formatEvidence(evidence: StateEvidence[]): string[] {
  if (!evidence.length) return ["No evidence recorded."];
  return evidence.map((entry) => `- ${entry.id}: ${entry.locator || entry.path || entry.summary || entry.source || ""}`);
}

export function getFeedback(run: WorkflowRun, feedbackId: string): ErrorFeedbackRecord | undefined {
  ensureFeedbackState(run);
  return (run.feedback as ErrorFeedbackRecord[] | undefined || []).find((record) => record.id === feedbackId);
}

function requireFeedback(run: WorkflowRun, feedbackId: string): ErrorFeedbackRecord {
  const record = getFeedback(run, feedbackId);
  if (!record) throw new Error(`Unknown feedback id for run ${run.id}: ${feedbackId}`);
  return record;
}

function updateFeedback(run: WorkflowRun, record: ErrorFeedbackRecord): void {
  const records = ensureFeedbackState(run);
  run.feedback = records.map((candidate) => (candidate.id === record.id ? record : candidate));
  writeJson(feedbackPath(run, record.id), record);
  writeFeedbackIndex(run);
}

export function listFeedback(run: WorkflowRun, options: ListFeedbackOptions = {}): ErrorFeedbackRecord[] {
  ensureFeedbackState(run);
  return (run.feedback as ErrorFeedbackRecord[] | undefined || []).filter((record) => {
    if (options.status && record.status !== options.status) return false;
    if (options.severity && record.severity !== options.severity) return false;
    if (options.classification && record.classification !== options.classification) return false;
    return true;
  });
}

/** Scan every failed/errored state node and record an open feedback record for
 *  each not-yet-seen error (dedup by feedbackKey). */
export function collectRunErrors(run: WorkflowRun, options: ErrorFeedbackLoopOptions = {}): ErrorFeedbackRecord[] {
  const records: ErrorFeedbackRecord[] = [];
  const existing = new Set((run.feedback as ErrorFeedbackRecord[] | undefined || []).map(feedbackKey));
  for (const node of run.nodes || []) {
    if (node.status !== "failed" && !node.errors.length) continue;
    for (const error of node.errors) {
      const key = feedbackKey({ runId: run.id, code: error.code, message: error.message, nodeId: node.id, stageId: stringMetadata(node.metadata, "pipelineStage"), contractId: node.contractId, path: error.path });
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
          metadata: { collectedFromNodeId: node.id, errorAt: error.at, details: error.details },
        },
        { persist: false }
      );
      records.push(record);
      existing.add(feedbackKey(record));
    }
  }
  if (options.persist !== false && records.length) saveCheckpoint(run);
  return records;
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
    "",
  ].join("\n");
}

/** Materialize a correction task (markdown + pending task state node) for a
 *  feedback record and mark it `tasked`. Idempotent: a record that already has
 *  a correction task is returned unchanged. */
export function createCorrectionTask(run: WorkflowRun, feedbackId: string, options: CreateCorrectionTaskOptions = {}): ErrorFeedbackRecord {
  const record = requireFeedback(run, feedbackId);
  if (record.correctionTaskId) return record;
  const taskId = `feedback:${safeFileName(record.id)}`;
  const taskPath = path.join(run.paths.tasksDir, `${safeFileName(taskId)}.md`);
  fs.mkdirSync(path.dirname(taskPath), { recursive: true });
  fs.writeFileSync(taskPath, renderCorrectionTask(record, options), "utf8");

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
      metadata: { feedbackId: record.id, correctionTask: true, retryable: record.retryable },
    })
  );

  updateFeedback(run, {
    ...record,
    updatedAt: new Date().toISOString(),
    status: "tasked",
    correctionTaskId: taskId,
    metadata: { ...(record.metadata || {}), correctionTaskPath: taskPath, correctionTaskNodeId: node.id, verifierCommand: options.verifierCommand },
  });
  saveCheckpoint(run);
  return requireFeedback(run, feedbackId);
}

/** Resolve or reject a feedback record. A `resolved` verdict fails closed: it
 *  requires a nodeId whose state node exists and is verified/committed. */
export function resolveFeedback(run: WorkflowRun, feedbackId: string, result: CorrectionTaskResult): ErrorFeedbackRecord {
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
    metadata: compactMetadata({ ...(record.metadata || {}), resolutionMessage: result.message, resolution: result.metadata }),
  });
  saveCheckpoint(run);
  return requireFeedback(run, feedbackId);
}

/** Shell-bound `runPipelineStage`: the core pure runner with `recordFeedback`
 *  wired in, so a failed pipeline stage that preserves its failure node ALSO
 *  writes a durable ErrorFeedback record (byte-behavior port of the old
 *  build's pipeline-runner, whose runPipelineStage recorded feedback on
 *  failure). The core runner stays feedback-free; this is the impure seam. */
export function runPipelineStage(
  run: WorkflowRun,
  stageId: string,
  inputNodeId: string,
  options: RunPipelineStageOptions = {},
  runnerOptions: PipelineRunnerOptions = {}
): PipelineStageRunResult | PipelineStageFailure {
  return coreRunPipelineStage(run, stageId, inputNodeId, options, {
    ...runnerOptions,
    // The core gate's `pathExists` defaults to `() => true` (a pure core/
    // module never reads the filesystem). This is the shell seam, so default
    // it to the real `fs.existsSync` — that is what makes the contract's
    // `requireReadablePaths` / `missing-artifact-path` gate live. A caller may
    // still override it (e.g. a replay against a captured path set).
    pathExists: runnerOptions.pathExists || fs.existsSync,
    // Keep the caller-named failure node id (the old build honored outputNodeId
    // for the preserved failure node); the raw core auto-mints when unset.
    failureNodeId: runnerOptions.failureNodeId || options.outputNodeId,
    recordFeedback: (r: WorkflowRun, error: StateNodeError, nodeId: string) => {
      // Read the failure node's own contractId so this feedback's dedup key
      // (code+message+nodeId+stageId+contractId+path) matches the one
      // collectRunErrors derives from the same node — otherwise a later
      // collect re-records a duplicate.
      const failNode = (r.nodes || []).find((n) => n.id === nodeId);
      recordFeedback(
        r,
        { source: "pipeline-runner", error, nodeId, stageId, contractId: failNode?.contractId || runnerOptions.contractId, path: error.path, retryable: error.retryable, metadata: { inputNodeId, preservedFailureNode: true } },
        { persist: false }
      );
    },
  });
}
