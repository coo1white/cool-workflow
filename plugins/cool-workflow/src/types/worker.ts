import type { BackendKind, BackendLocality, BackendSelection, SandboxAttestation, SandboxDimension } from "./execution-backend";
import type { UsageRecord } from "./observability";
import type { ResolvedSandboxPolicy } from "./sandbox";
import type { StateNodeError } from "./state-node";
import type { WorkerMultiAgentMetadata } from "./topology";

export type WorkerIsolationStatus =
  | "allocated"
  | "running"
  | "completed"
  | "failed"
  | "rejected"
  | "verified";

export interface WorkerIsolationPolicy {
  allowArtifacts?: boolean;
  allowLogs?: boolean;
  allowedPaths?: string[];
  readPaths?: string[];
  writePaths?: string[];
  sandboxProfileId?: string;
}

export interface WorkerBoundaryViolation {
  code: string;
  message: string;
  path?: string;
  allowedPaths: string[];
}

export interface WorkerOutputRecord {
  workerId: string;
  taskId: string;
  resultPath: string;
  recordedAt: string;
  stateNodeId?: string;
  verifierNodeId?: string;
  auditEventIds?: string[];
}

export interface WorkerScope {
  schemaVersion: 1;
  id: string;
  runId: string;
  taskId: string;
  dispatchId?: string;
  createdAt: string;
  updatedAt: string;
  status: WorkerIsolationStatus;
  workerDir: string;
  inputPath: string;
  resultPath: string;
  artifactsDir: string;
  logsDir: string;
  allowedPaths: string[];
  sandboxProfileId?: string;
  sandboxPolicy?: ResolvedSandboxPolicy;
  /** Execution backend selected for this worker (defaults to "node"). */
  backendId?: string;
  backendSelection?: BackendSelection;
  backendAttestation?: SandboxAttestation;
  stateNodeId?: string;
  resultNodeId?: string;
  feedbackIds: string[];
  errors: StateNodeError[];
  output?: WorkerOutputRecord;
  multiAgent?: WorkerMultiAgentMetadata;
  blackboard?: {
    id: string;
    topicIds: string[];
    indexPath: string;
    messagesPath: string;
    topicsDir: string;
    contextsDir: string;
    artifactsDir: string;
    instructions: string[];
  };
  /** Host-attested token usage for this worker's output (v0.1.31). Additive +
   *  optional: absent means `unreported`, NEVER zero. Recorded verbatim as
   *  provenance on worker-output intake; CW never synthesizes it. */
  usage?: UsageRecord;
  metadata?: Record<string, unknown>;
}

export interface WorkerManifest {
  schemaVersion: 1;
  id: string;
  runId: string;
  taskId: string;
  dispatchId?: string;
  createdAt: string;
  updatedAt: string;
  status: WorkerIsolationStatus;
  workerDir: string;
  inputPath: string;
  resultPath: string;
  artifactsDir: string;
  logsDir: string;
  allowedPaths: string[];
  sandboxProfileId?: string;
  sandboxPolicy?: ResolvedSandboxPolicy;
  sandbox?: {
    profileId: string;
    policy: ResolvedSandboxPolicy;
    enforcedByCW: string[];
    hostRequired: string[];
  };
  /** Execution backend selected for this worker (defaults to "node"). */
  backendId?: string;
  backendSelection?: BackendSelection;
  /** Sandbox attestation recorded by the selected backend. */
  backendAttestation?: SandboxAttestation;
  /** Backend descriptor snapshot, mirroring the `sandbox` enforcement split. */
  backend?: {
    id: string;
    locality: BackendLocality;
    kind: BackendKind;
    enforces: SandboxDimension[];
    attests: SandboxDimension[];
    attestation: SandboxAttestation;
  };
  instructions: string[];
  taskPath?: string;
  prompt?: string;
  stateNodeId?: string;
  resultNodeId?: string;
  feedbackIds?: string[];
  errors?: StateNodeError[];
  output?: WorkerOutputRecord;
  multiAgent?: WorkerMultiAgentMetadata;
  blackboard?: {
    id: string;
    topicIds: string[];
    indexPath: string;
    messagesPath: string;
    topicsDir: string;
    contextsDir: string;
    artifactsDir: string;
    instructions: string[];
  };
  metadata?: Record<string, unknown>;
}

export interface WorkerIsolationOptions {
  workerId?: string;
  dispatchId?: string;
  sandboxProfileId?: string;
  backendId?: string;
  backendSelection?: BackendSelection;
  backendAttestation?: SandboxAttestation;
  status?: WorkerIsolationStatus;
  policy?: WorkerIsolationPolicy;
  multiAgent?: WorkerMultiAgentMetadata;
  metadata?: Record<string, unknown>;
  persist?: boolean;
}
