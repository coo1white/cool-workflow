import type { LoopStage, StateNodeKind, StateNodeStatus } from "./core";
import type { StateArtifact, StateEvidence } from "./result";

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
