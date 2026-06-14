"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.PipelineContractError = exports.PIPELINE_CONTRACT_SCHEMA_VERSION = exports.STATE_NODE_SCHEMA_VERSION = void 0;
exports.createStateNode = createStateNode;
exports.transitionStateNode = transitionStateNode;
exports.validatePipelineContract = validatePipelineContract;
exports.assertNodeSatisfiesContract = assertNodeSatisfiesContract;
exports.recordNodeError = recordNodeError;
exports.linkStateNodes = linkStateNodes;
exports.appendRunNode = appendRunNode;
exports.upsertRunContract = upsertRunContract;
exports.writeRunNode = writeRunNode;
exports.artifactExists = artifactExists;
const node_fs_1 = __importDefault(require("node:fs"));
const node_path_1 = __importDefault(require("node:path"));
const state_1 = require("./state");
exports.STATE_NODE_SCHEMA_VERSION = 1;
exports.PIPELINE_CONTRACT_SCHEMA_VERSION = 1;
class PipelineContractError extends Error {
    structured;
    constructor(error) {
        super(error.message);
        this.name = "PipelineContractError";
        this.structured = {
            ...error,
            at: error.at || new Date().toISOString()
        };
    }
}
exports.PipelineContractError = PipelineContractError;
function createStateNode(input) {
    const now = new Date().toISOString();
    return {
        schemaVersion: exports.STATE_NODE_SCHEMA_VERSION,
        id: input.id || createNodeId(input.kind, input.existingNodes),
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
function transitionStateNode(node, input) {
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
function validatePipelineContract(contract) {
    if (contract.schemaVersion !== exports.PIPELINE_CONTRACT_SCHEMA_VERSION) {
        throw contractError("invalid-contract-schema", `Pipeline contract ${contract.id || "(missing id)"} has unsupported schemaVersion`, {
            details: { schemaVersion: contract.schemaVersion }
        });
    }
    if (!contract.id)
        throw contractError("invalid-contract-id", "Pipeline contract id is required");
    if (!contract.title)
        throw contractError("invalid-contract-title", `Pipeline contract ${contract.id} title is required`);
    if (!Array.isArray(contract.stages) || !contract.stages.length) {
        throw contractError("invalid-contract-stages", `Pipeline contract ${contract.id} must include at least one stage`);
    }
    const seen = new Set();
    for (const stage of contract.stages) {
        validateStage(contract, stage, seen);
    }
    if (!contract.compatibility) {
        throw contractError("invalid-contract-compatibility", `Pipeline contract ${contract.id} compatibility is required`);
    }
    if (contract.compatibility.minSchemaVersion > exports.STATE_NODE_SCHEMA_VERSION) {
        throw contractError("incompatible-contract", `Pipeline contract ${contract.id} requires newer StateNode schema`, {
            details: contract.compatibility
        });
    }
}
function assertNodeSatisfiesContract(node, contract, stageId) {
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
function recordNodeError(node, error) {
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
function linkStateNodes(parent, child) {
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
function appendRunNode(run, node) {
    const nodes = run.nodes || [];
    const index = nodes.findIndex((candidate) => candidate.id === node.id);
    const nextNodes = index >= 0 ? nodes.map((candidate) => (candidate.id === node.id ? node : candidate)) : [...nodes, node];
    run.nodes = nextNodes;
    writeRunNode(run, node);
    return node;
}
function upsertRunContract(run, contract) {
    validatePipelineContract(contract);
    const contracts = run.contracts || [];
    const index = contracts.findIndex((candidate) => candidate.id === contract.id);
    run.contracts =
        index >= 0 ? contracts.map((candidate) => (candidate.id === contract.id ? contract : candidate)) : [...contracts, contract];
    return contract;
}
function writeRunNode(run, node) {
    const dir = run.paths.stateNodesDir || node_path_1.default.join(run.paths.runDir, "nodes");
    const file = node_path_1.default.join(dir, `${(0, state_1.safeFileName)(node.id)}.json`);
    (0, state_1.writeJson)(file, node);
    return file;
}
function artifactExists(artifact) {
    return Boolean(artifact.path && node_fs_1.default.existsSync(artifact.path));
}
function validateStage(contract, stage, seen) {
    if (!stage.id)
        throw contractError("invalid-contract-stage-id", `Pipeline contract ${contract.id} has a stage without id`);
    if (seen.has(stage.id))
        throw contractError("duplicate-contract-stage", `Pipeline contract ${contract.id} repeats stage ${stage.id}`);
    seen.add(stage.id);
    if (!stage.name)
        throw contractError("invalid-contract-stage-name", `Stage ${stage.id} name is required`);
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
function assertRequiredArtifacts(node, stage) {
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
function assertRequiredEvidence(node, stage, contract) {
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
function assertVerifierGate(node, stage, contract) {
    const gate = stage.verifierGate;
    const commitRequiresGate = contract.commitPolicy?.requiresVerifierGate && stage.producedOutputKind === "commit";
    if (!gate?.required && !commitRequiresGate)
        return;
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
function isLegalTransition(from, to) {
    if (from === to)
        return true;
    const allowed = {
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
function contractError(code, message, options = {}) {
    return new PipelineContractError({
        code,
        message,
        ...options
    });
}
// Deterministic node id (mirrors worker-isolation.ts createWorkerId): a wall-clock
// stamp + Math.random() made every mint a different id, so audit references were not
// reproducible across re-runs of the same inputs. The id is now derived from the
// kind plus a per-run sequence (count of same-kind nodes already minted + 1,
// zero-padded), so re-running the same workflow yields byte-identical node ids. The
// minted id is excluded from the snapshot source fingerprint, so this does not change
// replay digests. Explicit `id` callers still short-circuit and pass through unchanged.
function createNodeId(kind, existingNodes = []) {
    const prefix = `${kind}-`;
    const seq = existingNodes.filter((node) => node.id.startsWith(prefix)).length + 1;
    return `${prefix}${String(seq).padStart(4, "0")}`;
}
function mergeById(existing, next) {
    const values = [...existing];
    for (const item of next) {
        const index = values.findIndex((candidate) => candidate.id === item.id);
        if (index >= 0)
            values[index] = item;
        else
            values.push(item);
    }
    return values;
}
function unique(values) {
    return [...new Set(values)];
}
