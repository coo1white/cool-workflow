"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.getRunContract = getRunContract;
exports.getRunNode = getRunNode;
exports.findRunnablePipelineStages = findRunnablePipelineStages;
exports.runPipelineStage = runPipelineStage;
exports.advancePipeline = advancePipeline;
exports.failPipelineStage = failPipelineStage;
const state_node_1 = require("../state/state-node");
const contract_1 = require("./contract");
/** `getRunContract(run, contractId?)` — with no id, uses the default
 *  contract id; upserts the default contract onto the run if absent. An
 *  unknown non-default id throws. A found contract is re-validated. */
function getRunContract(run, contractId) {
    const id = contractId || contract_1.DEFAULT_PIPELINE_CONTRACT_ID;
    const contracts = run.contracts || [];
    const found = contracts.find((c) => c.id === id);
    if (found) {
        (0, state_node_1.validatePipelineContract)(found);
        return found;
    }
    if (id === contract_1.DEFAULT_PIPELINE_CONTRACT_ID) {
        return (0, state_node_1.upsertRunContract)(run, (0, contract_1.createDefaultPipelineContract)());
    }
    throw new Error(`Unknown pipeline contract for run ${run.id}: ${id}`);
}
/** `getRunNode(run, nodeId)` — finds a node or throws. */
function getRunNode(run, nodeId) {
    const node = (run.nodes || []).find((n) => n.id === nodeId);
    if (!node)
        throw new Error(`Unknown state node for run ${run.id}: ${nodeId}`);
    return node;
}
/** Byte-exact port of the old build's `hasRequiredEvidence`: a stage's own
 *  `requiredEvidence` list AND the contract-wide
 *  `evidencePolicy.requireEvidence` flag both gate this pre-filter, exactly
 *  like assertRequiredEvidence's stricter check in state-node.ts — so a
 *  node findRunnablePipelineStages reports "runnable" never fails this
 *  same check again inside runPipelineStage. */
function evidenceSatisfied(node, stage, contract) {
    const requiredEvidence = stage.requiredEvidence || [];
    const contractRequiresEvidence = Boolean(contract.evidencePolicy?.requireEvidence);
    if ((requiredEvidence.length || contractRequiresEvidence) && !node.evidence.length)
        return false;
    for (const required of requiredEvidence) {
        const matches = node.evidence.filter((e) => e.id === required || e.source === required);
        if (!matches.length)
            return false;
    }
    return true;
}
function artifactsSatisfied(node, stage, pathExists) {
    for (const required of stage.requiredArtifacts || []) {
        const artifact = node.artifacts.find((a) => a.id === required || a.kind === required);
        if (!artifact)
            return false;
        if (artifact.path && !pathExists(artifact.path))
            return false;
    }
    return true;
}
function verifierGatePasses(node, stage, contract) {
    const gate = stage.verifierGate;
    const commitRequiresGate = Boolean(contract.commitPolicy?.requiresVerifierGate) && stage.producedOutputKind === "commit";
    if (!gate?.required && !commitRequiresGate)
        return true;
    const acceptedStatuses = gate?.acceptedStatuses || contract.commitPolicy?.acceptedVerifierStatuses || ["verified"];
    if (!acceptedStatuses.includes(node.status))
        return false;
    if ((gate?.requiredEvidence || contract.evidencePolicy?.requireEvidence) && !node.evidence.length)
        return false;
    return true;
}
/** `findRunnablePipelineStages(run, contract?)` — every node x every
 *  stage, kept only when kind/status/artifacts/evidence/verifier-gate all
 *  pass. */
function findRunnablePipelineStages(run, contract, pathExists = () => true) {
    const resolvedContract = contract || getRunContract(run);
    const out = [];
    for (const node of run.nodes || []) {
        for (const stage of resolvedContract.stages) {
            if (!stage.acceptedInputKinds.includes(node.kind))
                continue;
            if (!stage.acceptedInputStatuses.includes(node.status))
                continue;
            if (!artifactsSatisfied(node, stage, pathExists))
                continue;
            if (!evidenceSatisfied(node, stage, resolvedContract))
                continue;
            if (!verifierGatePasses(node, stage, resolvedContract))
                continue;
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
function runPipelineStage(run, stageId, inputNodeId, options = {}, runnerOptions = {}) {
    const contract = getRunContract(run, runnerOptions.contractId);
    const inputNode = getRunNode(run, inputNodeId);
    const pathExists = runnerOptions.pathExists || (() => true);
    try {
        (0, state_node_1.assertNodeSatisfiesContract)(inputNode, contract, stageId, pathExists);
    }
    catch (error) {
        if (error instanceof state_node_1.PipelineContractError) {
            return failPipelineStage(run, stageId, inputNode, error, runnerOptions);
        }
        throw error;
    }
    const stage = contract.stages.find((s) => s.id === stageId);
    const targetStatus = options.outputStatus || (stage.producedOutputKind === "commit" ? "committed" : "completed");
    const initialStatus = targetStatus === "committed" ? "verified" : "pending";
    let outputNode = (0, state_node_1.createStateNode)({
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
        outputNode = (0, state_node_1.transitionStateNode)(outputNode, {
            status: targetStatus,
            loopStage: options.loopStage,
            outputs: options.outputs,
            artifacts: options.artifacts,
            evidence: options.evidence,
            metadata: options.metadata,
        });
    }
    const persistNode = options.persist === false || runnerOptions.persist === false ? undefined : runnerOptions.persistNode;
    const [linkedInput, linkedOutput] = (0, state_node_1.linkStateNodes)(inputNode, outputNode);
    (0, state_node_1.appendRunNode)(run, linkedInput, persistNode);
    (0, state_node_1.appendRunNode)(run, linkedOutput, persistNode);
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
function advancePipeline(run, runnerOptions = {}) {
    const contract = getRunContract(run, runnerOptions.contractId);
    const stages = findRunnablePipelineStages(run, contract, runnerOptions.pathExists);
    if (!stages.length)
        return { status: "idle", stages: [] };
    let lastFailure;
    for (const candidate of stages) {
        const result = runPipelineStage(run, candidate.stageId, candidate.inputNodeId, {}, runnerOptions);
        if (result.status === "advanced") {
            return { ...result, stages };
        }
        lastFailure = { ...result, stages };
        if (!contract.failurePolicy?.autoAdvance)
            return lastFailure;
    }
    return lastFailure || { status: "idle", stages };
}
function failPipelineStage(run, stageId, inputNode, error, options = {}) {
    const contract = getRunContract(run, options.contractId);
    const stage = contract.stages.find((s) => s.id === stageId);
    const structured = error instanceof state_node_1.PipelineContractError
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
    let errorNode = (0, state_node_1.recordNodeError)((0, state_node_1.createStateNode)({
        kind: stage?.failure?.failureKind || "error",
        status: "pending",
        loopStage: inputNode.loopStage,
        contractId: contract.id,
        metadata: { preserved: true },
    }), structured);
    const [linkedInput, linkedError] = (0, state_node_1.linkStateNodes)(inputNode, errorNode);
    (0, state_node_1.appendRunNode)(run, linkedInput, persistNode);
    (0, state_node_1.appendRunNode)(run, linkedError, persistNode);
    errorNode = linkedError;
    if (options.recordFeedback)
        options.recordFeedback(run, structured, errorNode.id);
    return { status: "failed", runId: run.id, stageId, inputNodeId: inputNode.id, outputNodeId: errorNode.id, error: structured };
}
