import type { BlackboardState } from "./blackboard";
import type { AcceptanceRationale, CandidateRecord, CandidateSelection } from "./candidate";
import type { CollaborationState, CommitReviewProvenance } from "./collaboration";
import type { LoopStage, TaskKind, TaskStatus } from "./core";
import type { ErrorFeedbackRecord } from "./error-feedback";
import type { BackendSelection, SandboxAttestation } from "./execution-backend";
import type { MultiAgentState } from "./multi-agent";
import type { UsageRecord } from "./observability";
import type { PipelineContract } from "./pipeline";
import type { ResultEnvelope, RunPaths, RunPhase, StateEvidence } from "./result";
import type { ResolvedSandboxPolicy } from "./sandbox";
import type { StateNode } from "./state-node";
import type { TopologyState, WorkerMultiAgentMetadata } from "./topology";
import type { WorkerScope } from "./worker";
import type { WorkflowAppRunMetadata, WorkflowLimits } from "./workflow-app";

export interface RunTask {
  id: string;
  kind: TaskKind;
  phase: string;
  status: TaskStatus;
  requiresEvidence: boolean;
  prompt: string;
  taskPath: string;
  resultPath: string;
  loopStage: LoopStage;
  dispatchId?: string;
  dispatchedAt?: string;
  completedAt?: string;
  result?: ResultEnvelope;
  stateNodeId?: string;
  resultNodeId?: string;
  verifierNodeId?: string;
  workerId?: string;
  workerManifestPath?: string;
  sandboxProfileId?: string;
  sandboxPolicy?: ResolvedSandboxPolicy;
  /** Execution backend selected for this task (defaults to "node"). */
  backendId?: string;
  backendSelection?: BackendSelection;
  /** Sandbox attestation recorded by the selected backend. */
  backendAttestation?: SandboxAttestation;
  multiAgent?: WorkerMultiAgentMetadata;
  /** Host-attested token usage for this task's result (v0.1.31). Additive +
   *  optional: absent means `unreported`, NEVER zero. CW records it verbatim as
   *  provenance on result intake and never synthesizes it. */
  usage?: UsageRecord;
}

export interface DispatchTask {
  id: string;
  kind: TaskKind;
  phase: string;
  status: TaskStatus;
  taskPath: string;
  prompt: string;
  workerId?: string;
  workerManifestPath?: string;
  workerDir?: string;
  workerResultPath?: string;
  sandboxProfileId?: string;
  sandboxPolicy?: ResolvedSandboxPolicy;
  backendId?: string;
  backendAttestation?: SandboxAttestation;
  multiAgent?: WorkerMultiAgentMetadata;
}

export interface DispatchManifest {
  schemaVersion: 1;
  runId: string;
  dispatchId: string | null;
  createdAt?: string;
  phase?: string;
  instructions?: string;
  tasks: DispatchTask[];
  manifestPath?: string | null;
  stateNodeId?: string;
  workerIndexPath?: string;
  sandboxProfileId?: string;
  sandboxPolicy?: ResolvedSandboxPolicy;
  /** Execution backend selected for this dispatch (defaults to "node"). */
  backendId?: string;
  backendSelection?: BackendSelection;
  /** Per-backend sandbox attestation when a single backend is selected. */
  backendAttestation?: SandboxAttestation;
  multiAgent?: {
    runId?: string;
    groupId?: string;
    roleId?: string;
    fanoutId?: string;
    membershipIds?: string[];
  };
  blackboard?: {
    id: string;
    topicIds: string[];
    indexPath: string;
    messagesPath: string;
  };
}

export interface RunDispatch {
  id: string;
  phase: string;
  taskIds: string[];
  manifestPath: string;
  createdAt: string;
  stateNodeId?: string;
  workerIds?: string[];
  sandboxProfileId?: string;
  backendId?: string;
  multiAgent?: {
    runId?: string;
    groupId?: string;
    roleId?: string;
    fanoutId?: string;
    membershipIds?: string[];
  };
}

export interface StateCommit {
  id: string;
  createdAt: string;
  reason: string;
  loopStage: LoopStage;
  statePath: string;
  reportPath: string;
  snapshotPath: string;
  gitHead?: string;
  stateNodeId?: string;
  verifierGated?: boolean;
  checkpoint?: boolean;
  verifierNodeId?: string;
  candidateId?: string;
  selectionId?: string;
  evidence?: StateEvidence[];
  acceptanceRationale?: AcceptanceRationale;
  /** Who approved the artifact this commit shipped, when a review gate applied
   *  (provenance link, recorded only on a gate-satisfied commit). */
  review?: CommitReviewProvenance;
  /** True when only a subset of tasks were committed (partial commit, v0.1.59). */
  partial?: boolean;
  /** The task ids that were committed in this partial commit. */
  partialTaskIds?: string[];
  /** Parent commit id forming an append-only provenance chain (v0.1.60). */
  parentCommitId?: string;
  metadata?: Record<string, unknown>;
}

export interface WorkflowRun {
  schemaVersion: 1;
  id: string;
  createdAt: string;
  updatedAt: string;
  cwd: string;
  workflow: {
    id: string;
    title: string;
    summary: string;
    limits: WorkflowLimits;
    app?: WorkflowAppRunMetadata;
  };
  inputs: Record<string, unknown>;
  loopStage: LoopStage;
  phases: RunPhase[];
  tasks: RunTask[];
  dispatches: RunDispatch[];
  commits: StateCommit[];
  paths: RunPaths;
  nodes?: StateNode[];
  contracts?: PipelineContract[];
  feedback?: ErrorFeedbackRecord[];
  audit?: {
    schemaVersion: 1;
    eventLogPath?: string;
    summaryPath?: string;
    indexPath?: string;
  };
  workers?: WorkerScope[];
  sandboxProfiles?: ResolvedSandboxPolicy[];
  candidates?: CandidateRecord[];
  candidateSelections?: CandidateSelection[];
  multiAgent?: MultiAgentState;
  blackboard?: BlackboardState;
  topologies?: TopologyState;
  collaboration?: CollaborationState;
}

export interface RunSummary {
  runId: string;
  workflowId: string;
  app?: WorkflowAppRunMetadata;
  loopStage: LoopStage;
  phases: RunPhase[];
  tasks: {
    total: number;
    pending: number;
    running: number;
    failed: number;
    completed: number;
  };
  next: string | null;
  reportPath: string;
  commits: StateCommit[];
  workers?: {
    total: number;
    byStatus: Record<string, number>;
  };
}
