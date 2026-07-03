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
// Evidence: SPEC/pipeline-run.md "Error feedback — src/error-feedback.ts";
// plugins/cool-workflow/src/error-feedback.ts:109-158,290-360.

import * as fs from "node:fs";
import * as path from "node:path";
import { safeFileName, writeJson } from "./fs-atomic";
import { WorkflowRun } from "../core/state/types";
import { buildFeedbackRecord, ErrorFeedbackRecord, findExistingFeedback, RecordFeedbackInput } from "../core/pipeline/error-feedback";
import { saveCheckpoint } from "./run-store";

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
