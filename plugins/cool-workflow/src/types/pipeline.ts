import type { LoopStage, StateNodeKind, StateNodeStatus } from "./core";
import type { StateArtifact, StateEvidence } from "./result";
import type { StateNodeError } from "./state-node";

export interface PipelineVerifierGate {
  required?: boolean;
  acceptedStatuses?: StateNodeStatus[];
  requiredEvidence?: boolean;
}

export interface PipelineStageFailurePolicy {
  retryable?: boolean;
  maxAttempts?: number;
  preserveFailureNode?: boolean;
  failureKind?: StateNodeKind;
}

export interface PipelineStageContract {
  id: string;
  name: string;
  acceptedInputKinds: StateNodeKind[];
  acceptedInputStatuses: StateNodeStatus[];
  producedOutputKind: StateNodeKind;
  requiredArtifacts?: string[];
  requiredEvidence?: string[];
  verifierGate?: PipelineVerifierGate;
  failure?: PipelineStageFailurePolicy;
  /** Maximum wall-clock ms for this stage before auto-fail (v0.1.59).
   *  0 or undefined = no timeout. When exceeded, the stage is failed
   *  with code "stage-timeout". */
  timeoutMs?: number;
}

export interface PipelineArtifactPolicy {
  root?: string;
  requireReadablePaths?: boolean;
}

export interface PipelineEvidencePolicy {
  requireEvidence?: boolean;
  highPriorityRequiresEvidence?: boolean;
}

export interface PipelineFailurePolicy {
  preserveFailureNodes?: boolean;
  retryableByDefault?: boolean;
}

export interface PipelineCommitPolicy {
  requiresVerifierGate?: boolean;
  acceptedVerifierStatuses?: StateNodeStatus[];
}

export interface PipelineCompatibility {
  minSchemaVersion: number;
  maxSchemaVersion: number;
  notes?: string;
}

export interface PipelineContract {
  schemaVersion: 1;
  id: string;
  title: string;
  stages: PipelineStageContract[];
  inputSchema?: Record<string, unknown>;
  outputSchema?: Record<string, unknown>;
  artifactPolicy?: PipelineArtifactPolicy;
  evidencePolicy?: PipelineEvidencePolicy;
  failurePolicy?: PipelineFailurePolicy;
  commitPolicy?: PipelineCommitPolicy;
  compatibility: PipelineCompatibility;
}

export type PipelineRunnerStatus = "advanced" | "failed" | "idle";

export interface PipelineRunnerOptions {
  contractId?: string;
  persist?: boolean;
}

export interface PipelineStageRunOptions extends PipelineRunnerOptions {
  outputNodeId?: string;
  outputStatus?: StateNodeStatus;
  loopStage?: LoopStage;
  outputs?: Record<string, unknown>;
  artifacts?: StateArtifact[];
  evidence?: StateEvidence[];
  metadata?: Record<string, unknown>;
  preserveFailureNode?: boolean;
}

export interface RunnablePipelineStage {
  runId: string;
  contractId: string;
  stageId: string;
  inputNodeId: string;
  outputKind: StateNodeKind;
}

export interface PipelineStageFailure {
  runId: string;
  contractId: string;
  stageId: string;
  inputNodeId: string;
  outputNodeId?: string;
  status: "failed";
  error: StateNodeError;
  artifacts?: StateArtifact[];
  evidence?: StateEvidence[];
}

export interface PipelineStageRunResult {
  runId: string;
  contractId: string;
  stageId: string;
  inputNodeId: string;
  outputNodeId?: string;
  status: Exclude<PipelineRunnerStatus, "idle">;
  error?: StateNodeError;
  artifacts?: StateArtifact[];
  evidence?: StateEvidence[];
}

export interface PipelineAdvanceResult {
  runId: string;
  contractId: string;
  status: PipelineRunnerStatus;
  stages: PipelineStageRunResult[];
  runnable: RunnablePipelineStage[];
}
