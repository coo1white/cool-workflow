import type { StateArtifact, StateEvidence } from "./result";

export type ErrorFeedbackStatus = "open" | "tasked" | "resolved" | "rejected";
export type ErrorFeedbackSeverity = "critical" | "high" | "medium" | "low" | "info";
export type ErrorFeedbackClassification =
  | "contract-violation"
  | "verifier-failure"
  | "state-transition"
  | "missing-artifact"
  | "missing-evidence"
  | "parse-error"
  | "pipeline-failure"
  | "sandbox-policy"
  | "runtime-error"
  | "unknown";
export type ErrorFeedbackSource =
  | "state-node"
  | "pipeline-runner"
  | "verifier"
  | "contract"
  | "cli"
  | "manual";

export interface ErrorFeedbackPolicy {
  retryableByDefault?: boolean;
  createCorrectionTasks?: boolean;
  verifierCommand?: string;
}

export interface ErrorFeedbackLoopOptions {
  policy?: ErrorFeedbackPolicy;
  source?: ErrorFeedbackSource;
  persist?: boolean;
}

export interface ErrorFeedbackRecord {
  schemaVersion: 1;
  id: string;
  runId: string;
  createdAt: string;
  updatedAt: string;
  status: ErrorFeedbackStatus;
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
  correctionTaskId?: string;
  resolvedByNodeId?: string;
  /** When the feedback was resolved (v0.1.64). */
  resolvedAt?: string;
  /** Operator note on resolution (v0.1.64). */
  resolutionNote?: string;
  metadata?: Record<string, unknown>;
}

export interface CorrectionTaskResult {
  status: "resolved" | "rejected";
  nodeId?: string;
  message?: string;
  evidence?: StateEvidence[];
  artifacts?: StateArtifact[];
  metadata?: Record<string, unknown>;
}
