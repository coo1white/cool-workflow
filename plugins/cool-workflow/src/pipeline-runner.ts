import {
  PipelineAdvanceResult,
  PipelineContract,
  PipelineRunnerOptions,
  PipelineStageContract,
  PipelineStageFailure,
  PipelineStageRunOptions,
  PipelineStageRunResult,
  RunnablePipelineStage,
  StateNode,
  StateNodeError,
  WorkflowRun
} from "./types";
import { createDefaultPipelineContract, DEFAULT_PIPELINE_CONTRACT_ID } from "./pipeline-contract";
import { saveCheckpoint } from "./state";
import {
  PipelineContractError,
  appendRunNode,
  assertNodeSatisfiesContract,
  createStateNode,
  linkStateNodes,
  recordNodeError,
  transitionStateNode,
  upsertRunContract,
  validatePipelineContract
} from "./state-node";

export function createPipelineRunner(defaultOptions: PipelineRunnerOptions = {}) {
  return {
    getRunContract: (run: WorkflowRun, contractId?: string) => getRunContract(run, contractId || defaultOptions.contractId),
    getRunNode,
    findRunnablePipelineStages: (run: WorkflowRun, contract?: PipelineContract) => findRunnablePipelineStages(run, contract),
    runPipelineStage: (
      run: WorkflowRun,
      stageId: string,
      inputNodeId: string,
      options: PipelineStageRunOptions = {}
    ) => runPipelineStage(run, stageId, inputNodeId, { ...defaultOptions, ...options }),
    advancePipeline: (run: WorkflowRun, options: PipelineStageRunOptions = {}) =>
      advancePipeline(run, { ...defaultOptions, ...options }),
    failPipelineStage
  };
}

export function getRunContract(run: WorkflowRun, contractId?: string): PipelineContract {
  const id = contractId || DEFAULT_PIPELINE_CONTRACT_ID;
  const existing = (run.contracts || []).find((candidate) => candidate.id === id);
  if (existing) {
    validatePipelineContract(existing);
    return existing;
  }
  if (id !== DEFAULT_PIPELINE_CONTRACT_ID) {
    throw new Error(`Unknown pipeline contract for run ${run.id}: ${id}`);
  }
  return upsertRunContract(run, createDefaultPipelineContract());
}

export function getRunNode(run: WorkflowRun, nodeId: string): StateNode {
  const node = (run.nodes || []).find((candidate) => candidate.id === nodeId);
  if (!node) throw new Error(`Unknown state node for run ${run.id}: ${nodeId}`);
  return node;
}

export function findRunnablePipelineStages(run: WorkflowRun, contract = getRunContract(run)): RunnablePipelineStage[] {
  validatePipelineContract(contract);
  const runnable: RunnablePipelineStage[] = [];
  for (const node of run.nodes || []) {
    for (const stage of contract.stages) {
      if (!stage.acceptedInputKinds.includes(node.kind)) continue;
      if (!stage.acceptedInputStatuses.includes(node.status)) continue;
      if (!hasRequiredArtifacts(node, stage)) continue;
      if (!hasRequiredEvidence(node, stage, contract)) continue;
      if (!hasVerifierGate(node, stage, contract)) continue;
      runnable.push({
        runId: run.id,
        contractId: contract.id,
        stageId: stage.id,
        inputNodeId: node.id,
        outputKind: stage.producedOutputKind
      });
    }
  }
  return runnable;
}

export function advancePipeline(run: WorkflowRun, options: PipelineStageRunOptions = {}): PipelineAdvanceResult {
  const contract = getRunContract(run, options.contractId);
  const runnable = findRunnablePipelineStages(run, contract);
  if (!runnable.length) {
    return {
      runId: run.id,
      contractId: contract.id,
      status: "idle",
      stages: [],
      runnable
    };
  }
  const next = runnable[0];
  const result = runPipelineStage(run, next.stageId, next.inputNodeId, { ...options, contractId: contract.id });
  return {
    runId: run.id,
    contractId: contract.id,
    status: result.status,
    stages: [result],
    runnable
  };
}

export function runPipelineStage(
  run: WorkflowRun,
  stageId: string,
  inputNodeId: string,
  options: PipelineStageRunOptions = {}
): PipelineStageRunResult {
  const contract = getRunContract(run, options.contractId);
  const inputNode = getRunNode(run, inputNodeId);
  const stage = getContractStage(contract, stageId);

  try {
    assertNodeSatisfiesContract(inputNode, contract, stageId);
    const targetStatus = options.outputStatus || defaultOutputStatus(stage);
    const outputNode = createStateNode({
      id: options.outputNodeId,
      kind: stage.producedOutputKind,
      status: targetStatus === "committed" ? "verified" : "pending",
      loopStage: options.loopStage || inputNode.loopStage,
      inputs: {
        inputNodeId: inputNode.id,
        stageId: stage.id
      },
      outputs: options.outputs,
      artifacts: options.artifacts,
      evidence: options.evidence,
      parents: [inputNode.id],
      contractId: contract.id,
      metadata: {
        ...(options.metadata || {}),
        pipelineStage: stage.id
      }
    });
    const transitioned = transitionStateNode(outputNode, {
      status: targetStatus,
      loopStage: options.loopStage || outputNode.loopStage,
      outputs: options.outputs,
      artifacts: options.artifacts,
      evidence: options.evidence,
      metadata: options.metadata
    });
    const [linkedInput, linkedOutput] = linkStateNodes(inputNode, transitioned);
    appendRunNode(run, linkedInput);
    appendRunNode(run, linkedOutput);
    if (shouldPersist(options)) saveCheckpoint(run);
    return {
      runId: run.id,
      contractId: contract.id,
      stageId,
      inputNodeId,
      outputNodeId: linkedOutput.id,
      status: "advanced",
      artifacts: linkedOutput.artifacts,
      evidence: linkedOutput.evidence
    };
  } catch (error) {
    if (!isStructuredPipelineError(error)) throw error;
    return failPipelineStage(run, stageId, inputNode, error, { ...options, contractId: contract.id });
  }
}

export function failPipelineStage(
  run: WorkflowRun,
  stageId: string,
  inputNode: StateNode,
  error: unknown,
  options: PipelineStageRunOptions = {}
): PipelineStageFailure {
  const contract = getRunContract(run, options.contractId);
  const stage = getContractStage(contract, stageId);
  const structured = toStateNodeError(error, inputNode.id, shouldRetry(stage, contract));
  const preserve =
    options.preserveFailureNode ??
    stage.failure?.preserveFailureNode ??
    contract.failurePolicy?.preserveFailureNodes ??
    false;
  let failedNode = recordNodeError(
    createStateNode({
      id: options.outputNodeId,
      kind: stage.failure?.failureKind || "error",
      status: "pending",
      loopStage: options.loopStage || inputNode.loopStage,
      inputs: {
        inputNodeId: inputNode.id,
        stageId: stage.id
      },
      outputs: options.outputs,
      artifacts: options.artifacts,
      evidence: options.evidence,
      parents: [inputNode.id],
      contractId: contract.id,
      metadata: {
        ...(options.metadata || {}),
        pipelineStage: stage.id,
        preserved: preserve
      }
    }),
    structured
  );
  if (preserve) {
    const [linkedInput, linkedFailure] = linkStateNodes(inputNode, failedNode);
    appendRunNode(run, linkedInput);
    failedNode = appendRunNode(run, linkedFailure);
    if (shouldPersist(options)) saveCheckpoint(run);
  }
  return {
    runId: run.id,
    contractId: contract.id,
    stageId,
    inputNodeId: inputNode.id,
    outputNodeId: preserve ? failedNode.id : undefined,
    status: "failed",
    error: failedNode.errors[failedNode.errors.length - 1],
    artifacts: failedNode.artifacts,
    evidence: failedNode.evidence
  };
}

function getContractStage(contract: PipelineContract, stageId: string): PipelineStageContract {
  validatePipelineContract(contract);
  const stage = contract.stages.find((candidate) => candidate.id === stageId);
  if (!stage) throw new Error(`Unknown pipeline stage for contract ${contract.id}: ${stageId}`);
  return stage;
}

function defaultOutputStatus(stage: PipelineStageContract): StateNode["status"] {
  if (stage.producedOutputKind === "commit") return "committed";
  return "completed";
}

function hasRequiredArtifacts(node: StateNode, stage: PipelineStageContract): boolean {
  for (const required of stage.requiredArtifacts || []) {
    const artifact = node.artifacts.find((candidate) => candidate.id === required || candidate.kind === required);
    if (!artifact) return false;
  }
  return true;
}

function hasRequiredEvidence(node: StateNode, stage: PipelineStageContract, contract: PipelineContract): boolean {
  if ((stage.requiredEvidence?.length || contract.evidencePolicy?.requireEvidence) && !node.evidence.length) return false;
  for (const required of stage.requiredEvidence || []) {
    const evidence = node.evidence.find((candidate) => candidate.id === required || candidate.source === required);
    if (!evidence) return false;
  }
  return true;
}

function hasVerifierGate(node: StateNode, stage: PipelineStageContract, contract: PipelineContract): boolean {
  const gate = stage.verifierGate;
  const commitRequiresGate = contract.commitPolicy?.requiresVerifierGate && stage.producedOutputKind === "commit";
  if (!gate?.required && !commitRequiresGate) return true;
  const acceptedStatuses = gate?.acceptedStatuses || contract.commitPolicy?.acceptedVerifierStatuses || ["verified"];
  if (!acceptedStatuses.includes(node.status)) return false;
  if ((gate?.requiredEvidence || contract.evidencePolicy?.requireEvidence) && !node.evidence.length) return false;
  return true;
}

function shouldPersist(options: PipelineRunnerOptions): boolean {
  return options.persist !== false;
}

function shouldRetry(stage: PipelineStageContract, contract: PipelineContract): boolean {
  return stage.failure?.retryable ?? contract.failurePolicy?.retryableByDefault ?? false;
}

function isStructuredPipelineError(error: unknown): boolean {
  return error instanceof PipelineContractError;
}

function toStateNodeError(error: unknown, nodeId: string, retryable: boolean): StateNodeError {
  if (error instanceof PipelineContractError) {
    return {
      ...error.structured,
      nodeId: error.structured.nodeId || nodeId,
      retryable: error.structured.retryable ?? retryable
    };
  }
  const message = error instanceof Error ? error.message : String(error);
  return {
    code: "pipeline-stage-error",
    message,
    at: new Date().toISOString(),
    nodeId,
    retryable
  };
}
