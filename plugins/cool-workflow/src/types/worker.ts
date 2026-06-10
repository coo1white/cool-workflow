import type { BackendExecutionHandle, BackendKind, BackendLocality, BackendSelection, SandboxAttestation, SandboxDimension } from "./execution-backend";
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
  | "verified"
  | "orphaned";

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
  /** TTL in ms from `createdAt` before the worker is considered orphaned (v0.1.57).
   *  Defaults to 0 (no timeout). When > 0 and elapsed, `reclaimOrphans()` marks
   *  the worker as `orphaned`. FreeBSD jails philosophy: stuck processes get killed. */
  timeoutMs?: number;
  /** File size of the worker's result.md in bytes (v0.1.61).
   *  Recorded on output intake for cost estimation and compaction decisions. */
  outputSizeBytes?: number;
  /** SHA256 digest of the worker's result.md content (v0.1.63).
   *  Proves output integrity — the digest is stored, the content can be
   *  independently verified. Computed at output intake. */
  outputDigest?: string;
  /** Number of times this worker has been retried (v0.1.67). */
  retryCount?: number;
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
  /** Agent Delegation Drive (v0.1.38): when a worker's result.md was produced by
   *  an EXTERNAL agent via the `agent` backend, the drive loop passes the agent
   *  hop's attestation here. recordWorkerOutput folds it into the result node's
   *  metadata (covered by the snapshot body, NEVER in evidence), records a
   *  `worker.agent-delegation` trust-audit event, and stamps the worker's usage
   *  model. The result digest is computed from the accepted result.md. */
  agentDelegation?: AgentDelegationInput;
}

/** The agent-hop attestation the drive loop hands to recordWorkerOutput. The
 *  `model` is the agent-REPORTED model (`unreported` if the agent reported none —
 *  NEVER the operator-chosen CW_AGENT_MODEL). command/args are secret-stripped. */
export interface AgentDelegationInput {
  handle: BackendExecutionHandle;
  model: string;
  promptDigest: string;
  command?: string;
  args: string[];
  exitCode: number | null;
}
