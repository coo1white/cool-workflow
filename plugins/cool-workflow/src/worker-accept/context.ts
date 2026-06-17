import type {
  AgentDelegationProvenance,
  ResultEnvelope,
  RunTask,
  StateNode,
  WorkerIsolationOptions,
  WorkerOutputRecord,
  WorkerScope,
  WorkflowRun
} from "../types";
import type { TelemetryVerification } from "../telemetry-attestation";

/** Mutable accept-path context threaded through the ordered recordWorkerOutput steps. */
export interface WorkerAcceptContext {
  run: WorkflowRun;
  workerId: string;
  options: WorkerIsolationOptions;
  scope: WorkerScope;
  task: RunTask;
  absoluteResultPath: string;
  rawResult: string;
  parsedResult: ResultEnvelope;
  // Populated by acceptWorkerResult and consumed by later steps.
  destination: string;
  pathAuditId: string;
  acceptedAuditId: string;
  resultNode: StateNode;
  verifierNodeId?: string;
  /** Verify-stage verdict, set by runWorkerVerify, drives the scope status transition. */
  verifierStatus: string;
  output: WorkerOutputRecord;
}

/** Resolved agent-delegation provenance + its telemetry verdict for the accept path. */
export interface WorkerDelegation {
  agentDelegation?: AgentDelegationProvenance;
  telemetry?: TelemetryVerification;
}
