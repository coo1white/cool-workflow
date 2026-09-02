// core/state/types.ts — the state-kernel's own type set.
//
// MILESTONE 3 (project/docs/rebuild/PLAN.md build order, step 3). Scoped to exactly what
// state-core.md's public surface needs: WorkflowRun and everything it
// carries, StateNode + its snapshot/replay/diff family, the pipeline
// contract shape, and the small persisted-record shapes validation.ts
// guards. Later milestones (multi-agent, blackboard, topology, worker,
// candidate, trust) add their OWN richer types under their own module —
// this file only carries the FIELD SET this milestone's schema/migration/
// node-lifecycle/snapshot code actually reads or writes, ported from the
// old build's src/types/*.ts. Optional subsystem state (multiAgent,
// blackboard, topologies, collaboration, workers, etc.) is typed loosely
// here (its own schemaVersion + array keys only) since normalizeRunState
// only ever fills defaults/shape-checks those fields at this milestone;
// the richer per-record shapes land with their owning milestone.
//
// Pure types — no runtime cost, no imports beyond each other.

export type LoopStage = "interpret" | "act" | "observe" | "adjust" | "checkpoint";
export type PhaseStatus = "pending" | "running" | "completed";
export type TaskKind = "agent" | "artifact";
export type TaskStatus = "pending" | "running" | "completed" | "failed";

export type StateNodeKind =
  | "input"
  | "task"
  | "dispatch"
  | "result"
  | "candidate"
  | "verifier"
  | "commit"
  | "blackboard"
  | "blackboard-topic"
  | "blackboard-message"
  | "blackboard-context"
  | "blackboard-artifact"
  | "blackboard-snapshot"
  | "coordinator-decision"
  | "topology-run"
  | "topology-phase"
  | "multi-agent-run"
  | "agent-role"
  | "agent-group"
  | "agent-membership"
  | "agent-fanout"
  | "agent-fanin"
  | "report"
  | "schedule"
  | "trigger"
  | "loop-control"
  | "error";

export type StateNodeStatus =
  | "pending"
  | "running"
  | "completed"
  | "failed"
  | "blocked"
  | "verified"
  | "rejected"
  | "committed";

export interface StateArtifact {
  id: string;
  kind: string;
  path: string;
  description?: string;
  sha256?: string;
  sizeBytes?: number;
}

export interface StateEvidence {
  id: string;
  source?: string;
  path?: string;
  locator?: string;
  summary?: string;
  confidence?: "ungrounded" | "grounded" | "resolvable" | "verified";
  recordRef?: { kind: string; id: string };
  contentPreview?: string;
  provenance?: Record<string, unknown>;
}

export interface StateNodeError {
  code: string;
  message: string;
  at: string;
  nodeId?: string;
  path?: string;
  retryable?: boolean;
  details?: Record<string, unknown>;
}

export interface StateNode {
  schemaVersion: 1;
  id: string;
  kind: StateNodeKind;
  status: StateNodeStatus;
  loopStage: LoopStage;
  createdAt: string;
  updatedAt: string;
  inputs: Record<string, unknown>;
  outputs: Record<string, unknown>;
  artifacts: StateArtifact[];
  evidence: StateEvidence[];
  errors: StateNodeError[];
  parents: string[];
  children: string[];
  contractId?: string;
  metadata?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Node snapshot / diff / replay
// ---------------------------------------------------------------------------

export type NodeSnapshotFreshness = "valid" | "stale" | "absent";

export interface NodeSnapshotBody {
  id: string;
  kind: StateNodeKind;
  status: StateNodeStatus;
  loopStage: LoopStage;
  inputs: Record<string, unknown>;
  outputs: Record<string, unknown>;
  artifacts: StateArtifact[];
  evidence: StateEvidence[];
  errors: StateNodeError[];
  parents: string[];
  children: string[];
  contractId?: string;
  metadata?: Record<string, unknown>;
}

export interface NodeSnapshot {
  schemaVersion: 1;
  snapshotId: string;
  runId: string;
  nodeId: string;
  capturedAt: string;
  sourceFingerprint: string;
  body: NodeSnapshotBody;
}

export interface NodeSnapshotSection {
  section: "status" | "inputs" | "outputs" | "artifacts" | "evidence" | "errors" | "links" | "metadata";
  change: "added" | "removed" | "changed" | "same";
  baseline?: unknown;
  candidate?: unknown;
}

export interface NodeSnapshotDiff {
  schemaVersion: 1;
  runId: string;
  baselineSnapshotId: string;
  candidateSnapshotId: string;
  baselineNodeId: string;
  candidateNodeId: string;
  changed: boolean;
  sections: NodeSnapshotSection[];
}

export interface NodeReplayRun {
  schemaVersion: 1;
  replayId: string;
  runId: string;
  nodeId: string;
  snapshotId: string;
  replayedAt: string;
  freshness: NodeSnapshotFreshness;
  contractValidated: boolean;
  outputFingerprint: string;
  body: NodeSnapshotBody;
}

export interface NodeReplayFinding {
  id: string;
  severity: "info" | "warn" | "error";
  category: string;
  reason: string;
  baselineRef?: string;
  replayRef?: string;
}

export interface NodeReplayVerdict {
  schemaVersion: 1;
  runId: string;
  nodeId: string;
  replayId: string;
  pass: boolean;
  freshness: NodeSnapshotFreshness;
  findings: NodeReplayFinding[];
}

// ---------------------------------------------------------------------------
// Pipeline contract
// ---------------------------------------------------------------------------

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
  timeoutMs?: number;
}

export interface PipelineArtifactPolicy {
  root?: string;
  requireReadablePaths?: boolean;
}

export interface PipelineEvidencePolicy {
  requireEvidence?: boolean;
  /** Byte-compat carry-over from the old build's default contract — NOT
   *  enforced by any gate (see createDefaultPipelineContract's note). */
  highPriorityRequiresEvidence?: boolean;
}

export interface PipelineFailurePolicy {
  preserveFailureNodes?: boolean;
  retryableByDefault?: boolean;
  autoAdvance?: boolean;
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
  commitMessageTemplate?: string;
  compatibility: PipelineCompatibility;
}

// ---------------------------------------------------------------------------
// Run-level shapes
// ---------------------------------------------------------------------------

export interface RunPaths {
  runDir: string;
  state: string;
  report: string;
  tasksDir: string;
  resultsDir: string;
  dispatchesDir: string;
  artifactsDir: string;
  commitsDir: string;
  stateNodesDir: string;
  feedbackDir: string;
  auditDir?: string;
  workersDir?: string;
  candidatesDir?: string;
  multiAgentDir?: string;
  blackboardDir?: string;
  topologiesDir?: string;
  graphSnapshotPath?: string;
}

export interface RunPhase {
  id: string;
  name: string;
  status: PhaseStatus;
  taskIds: string[];
  mode?: "sequential" | "parallel";
  loop?: Record<string, unknown>;
  loopOrigin?: string;
  loopRound?: number;
  loopDone?: boolean;
}

export interface ResultEnvelope {
  summary: string;
  findings: Array<{ id: string; classification?: string; severity?: string; evidence?: string[] }>;
  evidence: string[];
}

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
  startedAt?: string;
  completedAt?: string;
  result?: ResultEnvelope;
  stateNodeId?: string;
  resultNodeId?: string;
  verifierNodeId?: string;
  workerId?: string;
  workerManifestPath?: string;
  sandboxProfileId?: string;
  backendId?: string;
  label?: string;
  model?: string;
  agentType?: string;
  loopRound?: number;
  [key: string]: unknown;
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
  [key: string]: unknown;
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
  acceptanceRationale?: Record<string, unknown>;
  review?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
}

/** Loose subsystem-state carriers: this milestone only fills/validates their
 *  `schemaVersion` + declared array keys (see schema.ts); the real per-record
 *  shapes are added by their owning milestone (multi-agent, blackboard,
 *  topology, trust, candidate, collaboration, worker). */
export interface MultiAgentState {
  schemaVersion: 1;
  runs: unknown[];
  roles: unknown[];
  groups: unknown[];
  memberships: unknown[];
  fanouts: unknown[];
  fanins: unknown[];
}

export interface BlackboardState {
  schemaVersion: 1;
  boards: unknown[];
  topics: unknown[];
  messages: unknown[];
  contexts: unknown[];
  artifacts: unknown[];
  snapshots: unknown[];
  decisions: unknown[];
}

export interface TopologyState {
  schemaVersion: 1;
  runs: unknown[];
}

export interface CollaborationState {
  schemaVersion: 1;
  approvals: unknown[];
  comments: unknown[];
  handoffs: unknown[];
}

export interface RunAuditPaths {
  schemaVersion: 1;
  eventLogPath?: string;
  summaryPath?: string;
  indexPath?: string;
}

/** "run <-> PR linkage": the kind of thing a run link points at. Free
 *  text defaults to "pr" when not given. */
export type RunLinkKind = "pr" | "issue" | "ticket";

/** One append-only link annotation on a run record (`cw run link`). Built
 *  by the pure helper in core/run-link.ts; never edited or removed once
 *  written, only added to. */
export interface RunLinkAnnotation {
  url: string;
  kind: RunLinkKind;
  note?: string;
  addedAt: string;
  actor: string;
}

/** Do not soften this string: it is the whole point of the app-code
 *  honesty label (docs/workflow-app-framework.7.md). */
export const APP_CODE_EXECUTION_MODE = "in-process-unsandboxed" as const;

/** Recorded once at plan time when a workflow app's `workflow.js` was
 *  loaded and run: CW does not sandbox app code, only delegated agent
 *  workers, so the record says so plainly. */
export interface AppCodeProvenance {
  path: string;
  trustedRoot: boolean;
  execution: typeof APP_CODE_EXECUTION_MODE;
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
    limits: { maxAgents: number; maxConcurrentAgents: number; tokenBudget?: number };
    app?: Record<string, unknown>;
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
  feedback?: unknown[];
  audit?: RunAuditPaths;
  workers?: unknown[];
  sandboxProfiles?: unknown[];
  customSandboxProfiles?: Record<string, unknown>;
  candidates?: unknown[];
  candidateSelections?: unknown[];
  multiAgent?: MultiAgentState;
  blackboard?: BlackboardState;
  topologies?: TopologyState;
  collaboration?: CollaborationState;
  links?: RunLinkAnnotation[];
  appCode?: AppCodeProvenance;
  [key: string]: unknown;
}
