"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createPipelineRunner = createPipelineRunner;
exports.getRunContract = getRunContract;
exports.getRunNode = getRunNode;
exports.findRunnablePipelineStages = findRunnablePipelineStages;
exports.advancePipeline = advancePipeline;
exports.runPipelineStage = runPipelineStage;
exports.failPipelineStage = failPipelineStage;
const pipeline_contract_1 = require("./pipeline-contract");
const state_1 = require("./state");
const state_node_1 = require("./state-node");
function createPipelineRunner(defaultOptions = {}) {
    return {
        getRunContract: (run, contractId) => getRunContract(run, contractId || defaultOptions.contractId),
        getRunNode,
        findRunnablePipelineStages: (run, contract) => findRunnablePipelineStages(run, contract),
        runPipelineStage: (run, stageId, inputNodeId, options = {}) => runPipelineStage(run, stageId, inputNodeId, { ...defaultOptions, ...options }),
        advancePipeline: (run, options = {}) => advancePipeline(run, { ...defaultOptions, ...options }),
        failPipelineStage
    };
}
function getRunContract(run, contractId) {
    const id = contractId || pipeline_contract_1.DEFAULT_PIPELINE_CONTRACT_ID;
    const existing = (run.contracts || []).find((candidate) => candidate.id === id);
    if (existing) {
        (0, state_node_1.validatePipelineContract)(existing);
        return existing;
    }
    if (id !== pipeline_contract_1.DEFAULT_PIPELINE_CONTRACT_ID) {
        throw new Error(`Unknown pipeline contract for run ${run.id}: ${id}`);
    }
    return (0, state_node_1.upsertRunContract)(run, (0, pipeline_contract_1.createDefaultPipelineContract)());
}
function getRunNode(run, nodeId) {
    const node = (run.nodes || []).find((candidate) => candidate.id === nodeId);
    if (!node)
        throw new Error(`Unknown state node for run ${run.id}: ${nodeId}`);
    return node;
}
function findRunnablePipelineStages(run, contract = getRunContract(run)) {
    (0, state_node_1.validatePipelineContract)(contract);
    const runnable = [];
    for (const node of run.nodes || []) {
        for (const stage of contract.stages) {
            if (!stage.acceptedInputKinds.includes(node.kind))
                continue;
            if (!stage.acceptedInputStatuses.includes(node.status))
                continue;
            if (!hasRequiredArtifacts(node, stage))
                continue;
            if (!hasRequiredEvidence(node, stage, contract))
                continue;
            if (!hasVerifierGate(node, stage, contract))
                continue;
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
function advancePipeline(run, options = {}) {
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
function runPipelineStage(run, stageId, inputNodeId, options = {}) {
    const contract = getRunContract(run, options.contractId);
    const inputNode = getRunNode(run, inputNodeId);
    const stage = getContractStage(contract, stageId);
    try {
        (0, state_node_1.assertNodeSatisfiesContract)(inputNode, contract, stageId);
        const targetStatus = options.outputStatus || defaultOutputStatus(stage);
        const outputNode = (0, state_node_1.createStateNode)({
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
        const transitioned = (0, state_node_1.transitionStateNode)(outputNode, {
            status: targetStatus,
            loopStage: options.loopStage || outputNode.loopStage,
            outputs: options.outputs,
            artifacts: options.artifacts,
            evidence: options.evidence,
            metadata: options.metadata
        });
        const [linkedInput, linkedOutput] = (0, state_node_1.linkStateNodes)(inputNode, transitioned);
        (0, state_node_1.appendRunNode)(run, linkedInput);
        (0, state_node_1.appendRunNode)(run, linkedOutput);
        if (shouldPersist(options))
            (0, state_1.saveCheckpoint)(run);
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
    }
    catch (error) {
        if (!isStructuredPipelineError(error))
            throw error;
        return failPipelineStage(run, stageId, inputNode, error, { ...options, contractId: contract.id });
    }
}
function failPipelineStage(run, stageId, inputNode, error, options = {}) {
    const contract = getRunContract(run, options.contractId);
    const stage = getContractStage(contract, stageId);
    const structured = toStateNodeError(error, inputNode.id, shouldRetry(stage, contract));
    const preserve = options.preserveFailureNode ??
        stage.failure?.preserveFailureNode ??
        contract.failurePolicy?.preserveFailureNodes ??
        false;
    let failedNode = (0, state_node_1.recordNodeError)((0, state_node_1.createStateNode)({
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
    }), structured);
    if (preserve) {
        const [linkedInput, linkedFailure] = (0, state_node_1.linkStateNodes)(inputNode, failedNode);
        (0, state_node_1.appendRunNode)(run, linkedInput);
        failedNode = (0, state_node_1.appendRunNode)(run, linkedFailure);
        if (shouldPersist(options))
            (0, state_1.saveCheckpoint)(run);
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
function getContractStage(contract, stageId) {
    (0, state_node_1.validatePipelineContract)(contract);
    const stage = contract.stages.find((candidate) => candidate.id === stageId);
    if (!stage)
        throw new Error(`Unknown pipeline stage for contract ${contract.id}: ${stageId}`);
    return stage;
}
function defaultOutputStatus(stage) {
    if (stage.producedOutputKind === "commit")
        return "committed";
    return "completed";
}
function hasRequiredArtifacts(node, stage) {
    for (const required of stage.requiredArtifacts || []) {
        const artifact = node.artifacts.find((candidate) => candidate.id === required || candidate.kind === required);
        if (!artifact)
            return false;
    }
    return true;
}
function hasRequiredEvidence(node, stage, contract) {
    if ((stage.requiredEvidence?.length || contract.evidencePolicy?.requireEvidence) && !node.evidence.length)
        return false;
    for (const required of stage.requiredEvidence || []) {
        const evidence = node.evidence.find((candidate) => candidate.id === required || candidate.source === required);
        if (!evidence)
            return false;
    }
    return true;
}
function hasVerifierGate(node, stage, contract) {
    const gate = stage.verifierGate;
    const commitRequiresGate = contract.commitPolicy?.requiresVerifierGate && stage.producedOutputKind === "commit";
    if (!gate?.required && !commitRequiresGate)
        return true;
    const acceptedStatuses = gate?.acceptedStatuses || contract.commitPolicy?.acceptedVerifierStatuses || ["verified"];
    if (!acceptedStatuses.includes(node.status))
        return false;
    if ((gate?.requiredEvidence || contract.evidencePolicy?.requireEvidence) && !node.evidence.length)
        return false;
    return true;
}
function shouldPersist(options) {
    return options.persist !== false;
}
function shouldRetry(stage, contract) {
    return stage.failure?.retryable ?? contract.failurePolicy?.retryableByDefault ?? false;
}
function isStructuredPipelineError(error) {
    return error instanceof state_node_1.PipelineContractError;
}
function toStateNodeError(error, nodeId, retryable) {
    if (error instanceof state_node_1.PipelineContractError) {
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
