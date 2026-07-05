// shell/feedback-operations.ts — operator-facing feedback lifecycle:
// collect / list / show / create-task / resolve. Byte-behavior port of the old
// src/orchestrator/feedback-operations.ts (thin wrappers over the
// error-feedback-io primitives that also refresh the report + persist).

import { WorkflowRun } from "../core/state/types";
import { ErrorFeedbackRecord } from "../core/pipeline/error-feedback";
import { writeReport } from "./report";
import {
  collectRunErrors,
  createCorrectionTask,
  getFeedback,
  listFeedback as listFeedbackRecords,
  resolveFeedback as resolveFeedbackRecord,
  CreateCorrectionTaskOptions,
  ListFeedbackOptions,
} from "./error-feedback-io";

export function collectFeedback(run: WorkflowRun): ErrorFeedbackRecord[] {
  const collected = collectRunErrors(run);
  writeReport(run);
  return collected;
}

export function listFeedback(run: WorkflowRun, options: Record<string, unknown> = {}): ErrorFeedbackRecord[] {
  return listFeedbackRecords(run, {
    status: options.status ? (String(options.status) as ListFeedbackOptions["status"]) : undefined,
    severity: options.severity ? (String(options.severity) as ListFeedbackOptions["severity"]) : undefined,
    classification: options.classification ? (String(options.classification) as ListFeedbackOptions["classification"]) : undefined,
  });
}

export function showFeedback(run: WorkflowRun, feedbackId: string): ErrorFeedbackRecord {
  const feedback = getFeedback(run, feedbackId);
  if (!feedback) throw new Error(`Unknown feedback id for run ${run.id}: ${feedbackId}`);
  return feedback;
}

export function createFeedbackTask(run: WorkflowRun, feedbackId: string, options: Record<string, unknown> = {}): ErrorFeedbackRecord {
  const feedback = createCorrectionTask(run, feedbackId, {
    verifierCommand: options.verify ? String(options.verify) : undefined,
    guidance: options.guidance ? String(options.guidance) : undefined,
  } as CreateCorrectionTaskOptions);
  writeReport(run);
  return feedback;
}

export function resolveFeedback(run: WorkflowRun, feedbackId: string, options: Record<string, unknown> = {}): ErrorFeedbackRecord {
  const feedback = resolveFeedbackRecord(run, feedbackId, {
    status: options.status === "rejected" ? "rejected" : "resolved",
    nodeId: options.node ? String(options.node) : undefined,
    message: options.message ? String(options.message) : undefined,
  });
  writeReport(run);
  return feedback;
}
