// core/pipeline/runner.ts — findRunnablePipelineStages, runPipelineStage
// (pure transform), advancePipeline, failPipelineStage.
//
// MILESTONE 6+7 (combined). Byte-exact port of the old build's
// src/pipeline-runner.ts, split so this file stays PURE (no fs — actual
// disk writes are the caller's `persist` callback, threaded through from
// shell/). The real per-stage disk write (node file + checkpoint) is
// shell/run-store.ts + shell/node-store.ts; this file only mutates the
// in-memory `run` object and returns what happened.
//
// Evidence: SPEC/pipeline-run.md "Pipeline kernel — src/pipeline-
// runner.ts".

import {
  PipelineContract,
  PipelineStageContract,
  StateArtifact,
  StateEvidence,
  StateNode,
  StateNodeError,
  StateNodeKind,
  StateNodeStatus,
  WorkflowRun,
} from "../state/types";
import {
  appendRunNode,
  assertNodeSatisfiesContract,
  createStateNode,
  linkStateNodes,
  PipelineContractError,
  recordNodeError,
  transitionStateNode,
  upsertRunContract,
  validatePipelineContract,
} from "../state/state-node";
import { createDefaultPipelineContract, DEFAULT_PIPELINE_CONTRACT_ID } from "./contract";

export interface RunnablePipelineStage {
  runId: string;
  contractId: string;
  stageId: string;
  inputNodeId: string;
  outputKind: StateNodeKind;
}

export interface PipelineRunnerOptions {
  contractId?: string;
  persist?: boolean;
  pathExists?: (p: string) => boolean;
  /** Caller-supplied node persist side effect (shell/node-store.ts's
   *  writeRunNode). Threaded so this file never imports fs. */
  persistNode?: (run: WorkflowRun, node: StateNode) => void;
  /** Caller-supplied checkpoint side effect (shell/run-store.ts's
   *  saveCheckpoint). */
  saveCheckpoint?: (run: WorkflowRun) => void;
  /** Explicit clock value for any timestamp this call produces (e.g.
   *  failPipelineStage's generic-Error `error.at`). The real clock is read
   *  ONLY when this is omitted, matching resolveCommitGate's `deps.now`. */
  now?: string;
  /** Caller-supplied feedback side effect (shell/error-feedback-io.ts's
   *  recordFeedback). Threaded to failPipelineStage so a preserved failure
   *  node ALSO writes a durable ErrorFeedback record — the shell binds this;
   *  the pure core stays feedback-free when it is omitted. */
  recordFeedback?: (run: WorkflowRun, error: StateNodeError, nodeId: string) => void;
  /** Explicit id for a preserved failure node. When omitted, the node id is
   *  auto-minted (`error-<hash>`). The shell runPipelineStage sets this to the
   *  caller's outputNodeId so a caller-named failure node (e.g.
   *  `<run>:error:commit`) keeps its id, matching the old build. */
  failureNodeId?: string;
}

export interface RunPipelineStageOptions {
  outputNodeId?: string;
  outputStatus?: StateNodeStatus;
  loopStage?: StateNode["loopStage"];
  inputs?: Record<string, unknown>;
  outputs?: Record<string, unknown>;
  artifacts?: StateArtifact[];
  evidence?: StateEvidence[];
  metadata?: Record<string, unknown>;
  persist?: boolean;
}

export interface PipelineStageRunResult {
  status: "advanced";
  runId: string;
  stageId: string;
  inputNodeId: string;
  outputNodeId: string;
  outputKind: StateNodeKind;
}

export interface PipelineStageFailure {
  status: "failed";
  runId: string;
  stageId: string;
  inputNodeId: string;
  outputNodeId?: string;
  error: StateNodeError;
}

export type PipelineAdvanceResult =
  | { status: "idle"; stages: RunnablePipelineStage[] }
  | (PipelineStageRunResult & { stages: RunnablePipelineStage[] })
  | (PipelineStageFailure & { stages: RunnablePipelineStage[] });

/** `getRunContract(run, contractId?)` — with no id, uses the default
 *  contract id; upserts the default contract onto the run if absent. An
 *  unknown non-default id throws. A found contract is re-validated. */
export function getRunContract(run: WorkflowRun, contractId?: string): PipelineContract {
  const id = contractId || DEFAULT_PIPELINE_CONTRACT_ID;
  const contracts = run.contracts || [];
  const found = contracts.find((c) => c.id === id);
  if (found) {
    validatePipelineContract(found);
    return found;
  }
  if (id === DEFAULT_PIPELINE_CONTRACT_ID) {
    return upsertRunContract(run, createDefaultPipelineContract());
  }
  throw new Error(`Unknown pipeline contract for run ${run.id}: ${id}`);
}

/** `getRunNode(run, nodeId)` — finds a node or throws. */
export function getRunNode(run: WorkflowRun, nodeId: string): StateNode {
  const node = (run.nodes || []).find((n) => n.id === nodeId);
  if (!node) throw new Error(`Unknown state node for run ${run.id}: ${nodeId}`);
  return node;
}

/** Byte-exact port of the old build's `hasRequiredEvidence`: a stage's own
 *  `requiredEvidence` list AND the contract-wide
 *  `evidencePolicy.requireEvidence` flag both gate this pre-filter, exactly
 *  like assertRequiredEvidence's stricter check in state-node.ts — so a
 *  node findRunnablePipelineStages reports "runnable" never fails this
 *  same check again inside runPipelineStage. */
function evidenceSatisfied(node: StateNode, stage: PipelineStageContract, contract: PipelineContract): boolean {
  const requiredEvidence = stage.requiredEvidence || [];
  const contractRequiresEvidence = Boolean(contract.evidencePolicy?.requireEvidence);
  if ((requiredEvidence.length || contractRequiresEvidence) && !node.evidence.length) return false;
  for (const required of requiredEvidence) {
    const matches = node.evidence.filter((e) => e.id === required || e.source === required);
    if (!matches.length) return false;
  }
  return true;
}

function artifactsSatisfied(node: StateNode, stage: PipelineStageContract, pathExists: (p: string) => boolean): boolean {
  for (const required of stage.requiredArtifacts || []) {
    const artifact = node.artifacts.find((a) => a.id === required || a.kind === required);
    if (!artifact) return false;
    if (artifact.path && !pathExists(artifact.path)) return false;
  }
  return true;
}

function verifierGatePasses(node: StateNode, stage: PipelineStageContract, contract: PipelineContract): boolean {
  const gate = stage.verifierGate;
  const commitRequiresGate = Boolean(contract.commitPolicy?.requiresVerifierGate) && stage.producedOutputKind === "commit";
  if (!gate?.required && !commitRequiresGate) return true;
  const acceptedStatuses = gate?.acceptedStatuses || contract.commitPolicy?.acceptedVerifierStatuses || ["verified"];
  if (!acceptedStatuses.includes(node.status)) return false;
  if ((gate?.requiredEvidence || contract.evidencePolicy?.requireEvidence) && !node.evidence.length) return false;
  return true;
}

/** `findRunnablePipelineStages(run, contract?)` — every node x every
 *  stage, kept only when kind/status/artifacts/evidence/verifier-gate all
 *  pass. */
export function findRunnablePipelineStages(
  run: WorkflowRun,
  contract?: PipelineContract,
  pathExists: (p: string) => boolean = () => true
): RunnablePipelineStage[] {
  const resolvedContract = contract || getRunContract(run);
  const out: RunnablePipelineStage[] = [];
  for (const node of run.nodes || []) {
    for (const stage of resolvedContract.stages) {
      if (!stage.acceptedInputKinds.includes(node.kind)) continue;
      if (!stage.acceptedInputStatuses.includes(node.status)) continue;
      if (!artifactsSatisfied(node, stage, pathExists)) continue;
      if (!evidenceSatisfied(node, stage, resolvedContract)) continue;
      if (!verifierGatePasses(node, stage, resolvedContract)) continue;
      out.push({
        runId: run.id,
        contractId: resolvedContract.id,
        stageId: stage.id,
        inputNodeId: node.id,
        outputKind: stage.producedOutputKind,
      });
    }
  }
  return out;
}

/** `runPipelineStage(run, stageId, inputNodeId, options?)` — the one-step
 *  engine. Mutates `run.nodes` in place (via appendRunNode/persist) and
 *  returns the result envelope. A thrown PipelineContractError becomes
 *  `failPipelineStage`; any other error re-throws untouched. */
export function runPipelineStage(
  run: WorkflowRun,
  stageId: string,
  inputNodeId: string,
  options: RunPipelineStageOptions = {},
  runnerOptions: PipelineRunnerOptions = {}
): PipelineStageRunResult | PipelineStageFailure {
  const contract = getRunContract(run, runnerOptions.contractId);
  const inputNode = getRunNode(run, inputNodeId);
  const pathExists = runnerOptions.pathExists || (() => true);
  try {
    assertNodeSatisfiesContract(inputNode, contract, stageId, pathExists);
  } catch (error) {
    if (error instanceof PipelineContractError) {
      return failPipelineStage(run, stageId, inputNode, error, runnerOptions);
    }
    throw error;
  }
  const stage = contract.stages.find((s) => s.id === stageId)!;
  const targetStatus: StateNodeStatus = options.outputStatus || (stage.producedOutputKind === "commit" ? "committed" : "completed");
  const initialStatus: StateNodeStatus = targetStatus === "committed" ? "verified" : "pending";

  let outputNode = createStateNode({
    id: options.outputNodeId,
    kind: stage.producedOutputKind,
    status: initialStatus,
    loopStage: options.loopStage || inputNode.loopStage,
    inputs: options.inputs,
    outputs: options.outputs,
    artifacts: options.artifacts,
    evidence: options.evidence,
    contractId: contract.id,
    metadata: options.metadata,
  });
  if (targetStatus !== initialStatus) {
    outputNode = transitionStateNode(outputNode, {
      status: targetStatus,
      loopStage: options.loopStage,
      outputs: options.outputs,
      artifacts: options.artifacts,
      evidence: options.evidence,
      metadata: options.metadata,
    });
  }

  const persistNode = options.persist === false || runnerOptions.persist === false ? undefined : runnerOptions.persistNode;
  const [linkedInput, linkedOutput] = linkStateNodes(inputNode, outputNode);
  appendRunNode(run, linkedInput, persistNode);
  appendRunNode(run, linkedOutput, persistNode);

  if (options.persist !== false && runnerOptions.persist !== false && runnerOptions.saveCheckpoint) {
    runnerOptions.saveCheckpoint(run);
  }

  return {
    status: "advanced",
    runId: run.id,
    stageId,
    inputNodeId: inputNode.id,
    outputNodeId: linkedOutput.id,
    outputKind: stage.producedOutputKind,
  };
}

/** `advancePipeline(run, options?)` — first runnable stage list; empty ⇒
 *  idle. First "advanced" result stops. A "failed" result stops unless
 *  `contract.failurePolicy.autoAdvance`. */
export function advancePipeline(run: WorkflowRun, runnerOptions: PipelineRunnerOptions = {}): PipelineAdvanceResult {
  const contract = getRunContract(run, runnerOptions.contractId);
  const stages = findRunnablePipelineStages(run, contract, runnerOptions.pathExists);
  if (!stages.length) return { status: "idle", stages: [] };
  let lastFailure: (PipelineStageFailure & { stages: RunnablePipelineStage[] }) | undefined;
  for (const candidate of stages) {
    const result = runPipelineStage(run, candidate.stageId, candidate.inputNodeId, {}, runnerOptions);
    if (result.status === "advanced") {
      return { ...result, stages };
    }
    lastFailure = { ...result, stages };
    if (!contract.failurePolicy?.autoAdvance) return lastFailure;
  }
  return lastFailure || { status: "idle", stages };
}

/** `failPipelineStage(run, stageId, inputNode, error, options?)` — builds
 *  the structured error, optionally keeps a failure node + feedback
 *  record. */
export interface FailPipelineStageOptions {
  preserveFailureNode?: boolean;
  persist?: boolean;
  recordFeedback?: (run: WorkflowRun, error: StateNodeError, nodeId: string) => void;
}

export function failPipelineStage(
  run: WorkflowRun,
  stageId: string,
  inputNode: StateNode,
  error: unknown,
  options: (PipelineRunnerOptions & FailPipelineStageOptions) = {}
): PipelineStageFailure {
  const contract = getRunContract(run, options.contractId);
  const stage = contract.stages.find((s) => s.id === stageId);
  const structured: StateNodeError =
    error instanceof PipelineContractError
      ? error.structured
      : {
          code: "pipeline-stage-error",
          message: error instanceof Error ? error.message : String(error),
          at: options.now || new Date().toISOString(),
          nodeId: inputNode.id,
          retryable: stage?.failure?.retryable ?? contract.failurePolicy?.retryableByDefault ?? false,
        };

  const preserve = options.preserveFailureNode ?? stage?.failure?.preserveFailureNode ?? contract.failurePolicy?.preserveFailureNodes ?? false;
  if (!preserve) {
    return { status: "failed", runId: run.id, stageId, inputNodeId: inputNode.id, error: structured };
  }

  const persistNode = options.persist === false ? undefined : options.persistNode;
  let errorNode = recordNodeError(
    createStateNode({
      // Honor a caller-supplied failure node id when given (shell binds it to
      // the caller's outputNodeId); else auto-mint (`error-<hash>`).
      ...(options.failureNodeId ? { id: options.failureNodeId } : {}),
      kind: stage?.failure?.failureKind || "error",
      status: "pending",
      loopStage: inputNode.loopStage,
      contractId: contract.id,
      // `pipelineStage` names the stage that failed so collectRunErrors's
      // dedup key matches the feedback recorded here (both key on stageId).
      // Byte-behavior port of the old build's failed-node metadata.
      metadata: { pipelineStage: stageId, preserved: true },
    }),
    structured
  );
  const [linkedInput, linkedError] = linkStateNodes(inputNode, errorNode);
  appendRunNode(run, linkedInput, persistNode);
  appendRunNode(run, linkedError, persistNode);
  errorNode = linkedError;

  if (options.recordFeedback) options.recordFeedback(run, structured, errorNode.id);

  return { status: "failed", runId: run.id, stageId, inputNodeId: inputNode.id, outputNodeId: errorNode.id, error: structured };
}
