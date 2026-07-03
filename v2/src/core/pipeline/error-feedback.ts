// core/pipeline/error-feedback.ts — classifyFeedback, recordFeedback's
// decision half, dedup key.
//
// MILESTONE 6+7 (combined). Byte-exact port of the DECISION half of the
// old build's src/error-feedback.ts (record shape, classification,
// severity, dedup key, id formatting). The disk write (feedback/*.json +
// index.json + saveCheckpoint) is the caller's job (shell/), since this
// file stays pure per the core/shell split.
//
// Evidence: SPEC/pipeline-run.md "Error feedback — src/error-feedback.ts".

import { StateArtifact, StateEvidence, StateNodeError } from "../state/types";

export const ERROR_FEEDBACK_SCHEMA_VERSION = 1;

export type ErrorFeedbackSource = "state-node" | "pipeline-runner" | "verifier" | "contract" | "cli" | "manual";
export type ErrorFeedbackSeverity = "low" | "medium" | "high";
export type ErrorFeedbackClassification =
  | "missing-artifact"
  | "missing-evidence"
  | "verifier-failure"
  | "state-transition"
  | "contract-violation"
  | "sandbox-policy"
  | "parse-error"
  | "pipeline-failure"
  | "runtime-error"
  | "unknown";

export interface ErrorFeedbackRecord {
  schemaVersion: 1;
  id: string;
  runId: string;
  createdAt: string;
  updatedAt: string;
  status: "open" | "tasked" | "resolved" | "rejected";
  severity: ErrorFeedbackSeverity;
  classification: ErrorFeedbackClassification;
  source: ErrorFeedbackSource;
  code: string;
  message: string;
  nodeId?: string;
  stageId?: string;
  contractId?: string;
  taskId?: string;
  path?: string;
  retryable: boolean;
  evidence: StateEvidence[];
  artifacts: StateArtifact[];
  metadata?: Record<string, unknown>;
  correctionTaskId?: string;
  resolvedByNodeId?: string;
  resolvedAt?: string;
  resolutionNote?: string;
}

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

function normalizeError(error: StateNodeError | Error | string, now: string): StateNodeError {
  if (typeof error === "string") {
    return { code: "runtime-error", message: error, at: now };
  }
  if (error instanceof Error) {
    return { code: codeFromError(error), message: error.message, at: now };
  }
  return { ...error, code: error.code || "runtime-error", message: error.message || "Unknown error", at: error.at || now };
}

function codeFromError(error: Error): string {
  if (/Invalid cw:result JSON/i.test(error.message)) return "result-parse-error";
  if (/requires cw:result evidence/i.test(error.message)) return "missing-required-evidence";
  if (/requires evidence/i.test(error.message)) return "missing-required-evidence";
  if (/Phase gate blocked/i.test(error.message)) return "phase-gate-blocked";
  return "runtime-error";
}

/** classifyFeedback — fixed order, byte-exact to the old build. */
export function classifyFeedback(
  error: StateNodeError | Error | string,
  context: { source?: ErrorFeedbackSource; stageId?: string; contractId?: string; metadata?: Record<string, unknown> } = {},
  now: string = new Date(0).toISOString()
): ErrorFeedbackClassification {
  const normalized = normalizeError(error, now);
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

/** Feedback dedup key: joined with `` (runId, code, message, nodeId,
 *  stageId, contractId, path). */
export function feedbackKey(value: {
  runId?: string;
  code?: string;
  message?: string;
  nodeId?: string;
  stageId?: string;
  contractId?: string;
  path?: string;
}): string {
  return [value.runId || "", value.code || "", value.message || "", value.nodeId || "", value.stageId || "", value.contractId || "", value.path || ""].join(
    ""
  );
}

function compactMetadata(metadata: Record<string, unknown>): Record<string, unknown> | undefined {
  const compacted: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(metadata)) if (value !== undefined) compacted[key] = value;
  return Object.keys(compacted).length ? compacted : undefined;
}

/** Deterministic feedback id: position in the run's append-only feedback
 *  log (1-based), qualified by classification. */
export function formatFeedbackId(classification: ErrorFeedbackClassification, seq: number): string {
  return `feedback-${classification}-${String(seq).padStart(4, "0")}`;
}

/** Find an existing UNRESOLVED record matching the same
 *  {code,message,nodeId,stageId,contractId,path} — recordFeedback's dedup
 *  rule. */
export function findExistingFeedback(
  existing: ErrorFeedbackRecord[],
  error: StateNodeError,
  nodeId: string | undefined,
  stageId: string | undefined,
  contractId: string | undefined,
  path: string | undefined
): ErrorFeedbackRecord | undefined {
  return existing.find(
    (record) =>
      record.status !== "resolved" &&
      record.code === error.code &&
      record.message === error.message &&
      record.nodeId === nodeId &&
      record.stageId === stageId &&
      record.contractId === contractId &&
      record.path === path
  );
}

/** Build a new (not-yet-persisted) feedback record. `existingCount` is
 *  `(run.feedback || []).length` BEFORE this record is appended. */
export function buildFeedbackRecord(
  runId: string,
  input: RecordFeedbackInput,
  existingCount: number,
  now: string
): ErrorFeedbackRecord {
  const error = normalizeError(input.error, now);
  const nodeId = input.nodeId || error.nodeId;
  const classification = classifyFeedback(error, { source: input.source, stageId: input.stageId, contractId: input.contractId, metadata: input.metadata }, now);
  return {
    schemaVersion: ERROR_FEEDBACK_SCHEMA_VERSION,
    id: formatFeedbackId(classification, existingCount + 1),
    runId,
    createdAt: now,
    updatedAt: now,
    status: "open",
    severity: severityFor(classification, error),
    classification,
    source: input.source || sourceFor(classification),
    code: error.code,
    message: error.message,
    nodeId,
    stageId: input.stageId,
    contractId: input.contractId,
    taskId: input.taskId,
    path: input.path || error.path,
    retryable: input.retryable ?? error.retryable ?? false,
    evidence: input.evidence || [],
    artifacts: input.artifacts || [],
    metadata: compactMetadata({ ...input.metadata, details: input.metadata?.details || error.details }),
  };
}

export function summarizeFeedback(records: ErrorFeedbackRecord[]): {
  total: number;
  byStatus: Record<string, number>;
  bySeverity: Record<string, number>;
  byClassification: Record<string, number>;
} {
  return {
    total: records.length,
    byStatus: countBy(records, (r) => r.status),
    bySeverity: countBy(records, (r) => r.severity),
    byClassification: countBy(records, (r) => r.classification),
  };
}

function countBy<T>(values: T[], key: (value: T) => string): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const value of values) {
    const bucket = key(value);
    counts[bucket] = (counts[bucket] || 0) + 1;
  }
  return counts;
}
