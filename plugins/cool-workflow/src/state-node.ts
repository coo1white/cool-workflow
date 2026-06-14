import fs from "node:fs";
import path from "node:path";
import {
  PipelineContract,
  PipelineStageContract,
  StateArtifact,
  StateEvidence,
  StateNode,
  StateNodeError,
  StateNodeKind,
  StateNodeStatus,
  WorkflowRun
} from "./types";
import { safeFileName, writeJson } from "./state";
import { sha256 } from "./execution-backend";
import { stableStringify } from "./telemetry-attestation";

export const STATE_NODE_SCHEMA_VERSION = 1;
export const PIPELINE_CONTRACT_SCHEMA_VERSION = 1;

export class PipelineContractError extends Error {
  structured: StateNodeError;

  constructor(error: Omit<StateNodeError, "at"> & { at?: string }) {
    super(error.message);
    this.name = "PipelineContractError";
    this.structured = {
      ...error,
      at: error.at || new Date().toISOString()
    };
  }
}

export interface CreateStateNodeInput {
  id?: string;
  kind: StateNodeKind;
  status?: StateNodeStatus;
  loopStage: StateNode["loopStage"];
  inputs?: Record<string, unknown>;
  outputs?: Record<string, unknown>;
  artifacts?: StateArtifact[];
  evidence?: StateEvidence[];
  errors?: StateNodeError[];
  parents?: string[];
  children?: string[];
  contractId?: string;
  metadata?: Record<string, unknown>;
}

export interface TransitionStateNodeInput {
  status: StateNodeStatus;
  loopStage?: StateNode["loopStage"];
  outputs?: Record<string, unknown>;
  artifacts?: StateArtifact[];
  evidence?: StateEvidence[];
  metadata?: Record<string, unknown>;
}

export function createStateNode(input: CreateStateNodeInput): StateNode {
  const now = new Date().toISOString();
  return {
    schemaVersion: STATE_NODE_SCHEMA_VERSION,
    id: input.id || createNodeId(input),
    kind: input.kind,
    status: input.status || "pending",
    loopStage: input.loopStage,
    createdAt: now,
    updatedAt: now,
    inputs: input.inputs || {},
    outputs: input.outputs || {},
    artifacts: input.artifacts || [],
    evidence: input.evidence || [],
    errors: input.errors || [],
    parents: input.parents || [],
    children: input.children || [],
    contractId: input.contractId,
    metadata: input.metadata
  };
}

export function transitionStateNode(node: StateNode, input: TransitionStateNodeInput): StateNode {
  if (!isLegalTransition(node.status, input.status)) {
    throw contractError("illegal-transition", `State node ${node.id} cannot transition from ${node.status} to ${input.status}`, {
      nodeId: node.id,
      details: {
        from: node.status,
        to: input.status
      }
    });
  }
  if (input.status === "committed" && node.status !== "verified") {
    throw contractError("commit-without-verifier", `State node ${node.id} cannot be committed before it is verified`, {
      nodeId: node.id,
      details: {
        from: node.status,
        to: input.status
      }
    });
  }
  return {
    ...node,
    status: input.status,
    loopStage: input.loopStage || node.loopStage,
    updatedAt: new Date().toISOString(),
    outputs: input.outputs ? { ...node.outputs, ...input.outputs } : node.outputs,
    artifacts: input.artifacts ? mergeById(node.artifacts, input.artifacts) : node.artifacts,
    evidence: input.evidence ? mergeById(node.evidence, input.evidence) : node.evidence,
    metadata: input.metadata ? { ...(node.metadata || {}), ...input.metadata } : node.metadata
  };
}

export function validatePipelineContract(contract: PipelineContract): void {
  if (contract.schemaVersion !== PIPELINE_CONTRACT_SCHEMA_VERSION) {
    throw contractError("invalid-contract-schema", `Pipeline contract ${contract.id || "(missing id)"} has unsupported schemaVersion`, {
      details: { schemaVersion: contract.schemaVersion }
    });
  }
  if (!contract.id) throw contractError("invalid-contract-id", "Pipeline contract id is required");
  if (!contract.title) throw contractError("invalid-contract-title", `Pipeline contract ${contract.id} title is required`);
  if (!Array.isArray(contract.stages) || !contract.stages.length) {
    throw contractError("invalid-contract-stages", `Pipeline contract ${contract.id} must include at least one stage`);
  }
  const seen = new Set<string>();
  for (const stage of contract.stages) {
    validateStage(contract, stage, seen);
  }
  if (!contract.compatibility) {
    throw contractError("invalid-contract-compatibility", `Pipeline contract ${contract.id} compatibility is required`);
  }
  if (contract.compatibility.minSchemaVersion > STATE_NODE_SCHEMA_VERSION) {
    throw contractError("incompatible-contract", `Pipeline contract ${contract.id} requires newer StateNode schema`, {
      details: contract.compatibility as unknown as Record<string, unknown>
    });
  }
}

export function assertNodeSatisfiesContract(
  node: StateNode,
  contract: PipelineContract,
  stageId: string
): void {
  validatePipelineContract(contract);
  const stage = contract.stages.find((candidate) => candidate.id === stageId);
  if (!stage) {
    throw contractError("unknown-contract-stage", `Pipeline contract ${contract.id} has no stage ${stageId}`, {
      nodeId: node.id
    });
  }
  if (!stage.acceptedInputKinds.includes(node.kind)) {
    throw contractError("unexpected-node-kind", `Stage ${stage.id} does not accept node kind ${node.kind}`, {
      nodeId: node.id,
      details: { expected: stage.acceptedInputKinds, actual: node.kind }
    });
  }
  if (!stage.acceptedInputStatuses.includes(node.status)) {
    throw contractError("unexpected-node-status", `Stage ${stage.id} does not accept node status ${node.status}`, {
      nodeId: node.id,
      details: { expected: stage.acceptedInputStatuses, actual: node.status }
    });
  }
  assertRequiredArtifacts(node, stage);
  assertRequiredEvidence(node, stage, contract);
  assertVerifierGate(node, stage, contract);
}

export function recordNodeError(
  node: StateNode,
  error: Omit<StateNodeError, "at" | "nodeId"> & { at?: string; nodeId?: string }
): StateNode {
  return {
    ...node,
    status: "failed",
    updatedAt: new Date().toISOString(),
    errors: [
      ...node.errors,
      {
        ...error,
        at: error.at || new Date().toISOString(),
        nodeId: error.nodeId || node.id
      }
    ]
  };
}

export function linkStateNodes(parent: StateNode, child: StateNode): [StateNode, StateNode] {
  return [
    {
      ...parent,
      updatedAt: new Date().toISOString(),
      children: unique([...parent.children, child.id])
    },
    {
      ...child,
      updatedAt: new Date().toISOString(),
      parents: unique([...child.parents, parent.id])
    }
  ];
}

export function appendRunNode(run: WorkflowRun, node: StateNode): StateNode {
  const nodes = run.nodes || [];
  const index = nodes.findIndex((candidate) => candidate.id === node.id);
  const nextNodes = index >= 0 ? nodes.map((candidate) => (candidate.id === node.id ? node : candidate)) : [...nodes, node];
  run.nodes = nextNodes;
  writeRunNode(run, node);
  return node;
}

export function upsertRunContract(run: WorkflowRun, contract: PipelineContract): PipelineContract {
  validatePipelineContract(contract);
  const contracts = run.contracts || [];
  const index = contracts.findIndex((candidate) => candidate.id === contract.id);
  run.contracts =
    index >= 0 ? contracts.map((candidate) => (candidate.id === contract.id ? contract : candidate)) : [...contracts, contract];
  return contract;
}

export function writeRunNode(run: WorkflowRun, node: StateNode): string {
  const dir = run.paths.stateNodesDir || path.join(run.paths.runDir, "nodes");
  const file = path.join(dir, `${safeFileName(node.id)}.json`);
  writeJson(file, node);
  return file;
}

export function artifactExists(artifact: StateArtifact): boolean {
  return Boolean(artifact.path && fs.existsSync(artifact.path));
}

function validateStage(contract: PipelineContract, stage: PipelineStageContract, seen: Set<string>): void {
  if (!stage.id) throw contractError("invalid-contract-stage-id", `Pipeline contract ${contract.id} has a stage without id`);
  if (seen.has(stage.id)) throw contractError("duplicate-contract-stage", `Pipeline contract ${contract.id} repeats stage ${stage.id}`);
  seen.add(stage.id);
  if (!stage.name) throw contractError("invalid-contract-stage-name", `Stage ${stage.id} name is required`);
  if (!Array.isArray(stage.acceptedInputKinds) || !stage.acceptedInputKinds.length) {
    throw contractError("invalid-contract-stage-kinds", `Stage ${stage.id} must accept at least one input kind`);
  }
  if (!Array.isArray(stage.acceptedInputStatuses) || !stage.acceptedInputStatuses.length) {
    throw contractError("invalid-contract-stage-statuses", `Stage ${stage.id} must accept at least one input status`);
  }
  if (!stage.producedOutputKind) {
    throw contractError("invalid-contract-stage-output", `Stage ${stage.id} producedOutputKind is required`);
  }
}

function assertRequiredArtifacts(node: StateNode, stage: PipelineStageContract): void {
  for (const required of stage.requiredArtifacts || []) {
    const artifact = node.artifacts.find((candidate) => candidate.id === required || candidate.kind === required);
    if (!artifact) {
      throw contractError("missing-required-artifact", `Node ${node.id} is missing required artifact ${required}`, {
        nodeId: node.id,
        details: { requiredArtifact: required }
      });
    }
    if (!artifactExists(artifact)) {
      throw contractError("missing-artifact-path", `Node ${node.id} artifact ${artifact.id} path does not exist`, {
        nodeId: node.id,
        path: artifact.path,
        details: { artifactId: artifact.id }
      });
    }
  }
}

function assertRequiredEvidence(node: StateNode, stage: PipelineStageContract, contract: PipelineContract): void {
  const requiredEvidence = stage.requiredEvidence || [];
  const contractRequiresEvidence = Boolean(contract.evidencePolicy?.requireEvidence);
  if ((requiredEvidence.length || contractRequiresEvidence) && !node.evidence.length) {
    throw contractError("missing-required-evidence", `Node ${node.id} is missing required evidence`, {
      nodeId: node.id,
      details: { requiredEvidence }
    });
  }
  for (const required of requiredEvidence) {
    const evidence = node.evidence.find((candidate) => candidate.id === required || candidate.source === required);
    if (!evidence) {
      throw contractError("missing-required-evidence", `Node ${node.id} is missing required evidence ${required}`, {
        nodeId: node.id,
        details: { requiredEvidence: required }
      });
    }
  }
}

function assertVerifierGate(node: StateNode, stage: PipelineStageContract, contract: PipelineContract): void {
  const gate = stage.verifierGate;
  const commitRequiresGate = contract.commitPolicy?.requiresVerifierGate && stage.producedOutputKind === "commit";
  if (!gate?.required && !commitRequiresGate) return;
  const acceptedStatuses = gate?.acceptedStatuses || contract.commitPolicy?.acceptedVerifierStatuses || ["verified"];
  if (!acceptedStatuses.includes(node.status)) {
    throw contractError("verifier-gate-blocked", `Stage ${stage.id} requires verifier status ${acceptedStatuses.join(", ")}`, {
      nodeId: node.id,
      details: { actual: node.status, accepted: acceptedStatuses }
    });
  }
  if ((gate?.requiredEvidence || contract.evidencePolicy?.requireEvidence) && !node.evidence.length) {
    throw contractError("verifier-gate-missing-evidence", `Stage ${stage.id} requires evidence before commit`, {
      nodeId: node.id
    });
  }
}

function isLegalTransition(from: StateNodeStatus, to: StateNodeStatus): boolean {
  if (from === to) return true;
  const allowed: Record<StateNodeStatus, StateNodeStatus[]> = {
    pending: ["running", "blocked", "failed", "completed", "verified", "rejected"],
    running: ["completed", "failed", "blocked"],
    completed: ["verified", "rejected", "failed"],
    failed: ["pending", "blocked"],
    blocked: ["pending", "failed"],
    verified: ["committed", "rejected"],
    rejected: ["pending", "failed"],
    committed: []
  };
  return allowed[from].includes(to);
}

function contractError(
  code: string,
  message: string,
  options: Partial<Pick<StateNodeError, "nodeId" | "path" | "retryable" | "details">> = {}
): PipelineContractError {
  return new PipelineContractError({
    code,
    message,
    ...options
  });
}

// Deterministic id (FreeBSD-audit L12/L13): no wall-clock stamp, no PRNG suffix.
// Almost every node is created WITH an explicit, already-deterministic id
// (e.g. `${run.id}:result:${task.id}`); this fallback only fires for ad-hoc nodes
// minted without an id. We bind the id to a short sha256 of the node's stable
// content (kind + loopStage + canonical inputs/outputs/contract), so the same
// logical node yields a byte-identical id across runs and replay reaches the same
// fingerprint. Two nodes with identical content collapse to the same id by design.
function createNodeId(input: CreateStateNodeInput): string {
  const digest = sha256(
    stableStringify({
      kind: input.kind,
      loopStage: input.loopStage,
      contractId: input.contractId ?? null,
      inputs: input.inputs ?? null,
      outputs: input.outputs ?? null
    })
  );
  return `${input.kind}-${digest.replace("sha256:", "").slice(0, 16)}`;
}

function mergeById<T extends { id: string }>(existing: T[], next: T[]): T[] {
  const values = [...existing];
  for (const item of next) {
    const index = values.findIndex((candidate) => candidate.id === item.id);
    if (index >= 0) values[index] = item;
    else values.push(item);
  }
  return values;
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}
