// Feedback domain operations (v0.1.40 self-audit P3 router pattern).
// Carved out of CoolWorkflowRunner; behavior identical to the inline versions.
import { WorkflowRun } from "../types";
import { saveCheckpoint } from "../state";
import { writeReport } from "./report";
import * as fb from "../error-feedback";

export function collectFeedback(run: WorkflowRun): ReturnType<typeof fb.collectRunErrors> {
  const collected = fb.collectRunErrors(run);
  writeReport(run);
  saveCheckpoint(run);
  return collected;
}

export function listFeedback(run: WorkflowRun, options: Record<string, unknown> = {}): ReturnType<typeof fb.listFeedback> {
  return fb.listFeedback(run, {
    status: options.status ? (String(options.status) as never) : undefined,
    severity: options.severity ? (String(options.severity) as never) : undefined,
    classification: options.classification ? (String(options.classification) as never) : undefined
  });
}

export function showFeedback(run: WorkflowRun, feedbackId: string): NonNullable<ReturnType<typeof fb.getFeedback>> {
  const feedback = fb.getFeedback(run, feedbackId);
  if (!feedback) throw new Error(`Unknown feedback id for run ${run.id}: ${feedbackId}`);
  return feedback;
}

export function createFeedbackTask(run: WorkflowRun, feedbackId: string, options: Record<string, unknown> = {}): ReturnType<typeof fb.createCorrectionTask> {
  const feedback = fb.createCorrectionTask(run, feedbackId, {
    verifierCommand: options.verify ? String(options.verify) : undefined,
    guidance: options.guidance ? String(options.guidance) : undefined
  });
  writeReport(run);
  saveCheckpoint(run);
  return feedback;
}

export function resolveFeedback(run: WorkflowRun, feedbackId: string, options: Record<string, unknown> = {}): ReturnType<typeof fb.resolveFeedback> {
  const feedback = fb.resolveFeedback(run, feedbackId, {
    status: options.status === "rejected" ? "rejected" : "resolved",
    nodeId: options.node ? String(options.node) : undefined,
    message: options.message ? String(options.message) : undefined
  });
  writeReport(run);
  saveCheckpoint(run);
  return feedback;
}
