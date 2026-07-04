"use strict";
// core/state/state-node.ts — StateNode lifecycle and pipeline-contract gates.
//
// MILESTONE 3. Byte-exact port of the old build's src/state-node.ts, split
// into a PURE half (this file: create/transition/validate/link/record —
// everything that does not touch disk) and a shell half
// (shell/node-store.ts: writeRunNode, the only disk write). `appendRunNode`
// mutates `run.nodes` in place (pure data mutation, no fs) and then calls
// out to a caller-supplied persist function so this file itself never
// imports fs.
//
// Evidence: SPEC/state-core.md "src/state-node.ts — StateNode lifecycle and
// contract gates", "StateNode transition matrix", "Deterministic id
// fallback", "Contract gates" (v2/PLAN.md byte-compat item 7 — the double
// commit gate).
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
exports.artifactExists = artifactExists;
const hash_1 = require("../hash");
exports.STATE_NODE_SCHEMA_VERSION = 1;
exports.PIPELINE_CONTRACT_SCHEMA_VERSION = 1;
class PipelineContractError extends Error {
    structured;
    /** `error.at` wins when the caller already has one (e.g. re-wrapping a
     *  structured error); `now` is the explicit clock value for a fresh one;
     *  the real clock is read ONLY when neither is given, matching
     *  node-snapshot.ts's `options.now` fallback pattern. */
    constructor(error, now) {
        super(error.message);
        this.name = "PipelineContractError";
        this.structured = { ...error, at: error.at || now || new Date().toISOString() };
    }
}
exports.PipelineContractError = PipelineContractError;
/** `now` is the explicit clock value; the real clock is read ONLY when it
 *  is omitted, matching node-snapshot.ts's `options.now` fallback so a
 *  caller that always passes `now` gets byte-stable createdAt/updatedAt. */
function createStateNode(input, now) {
    const at = now || new Date().toISOString();
    return {
        schemaVersion: exports.STATE_NODE_SCHEMA_VERSION,
        id: input.id || createNodeId(input),
        kind: input.kind,
        status: input.status || "pending",
        loopStage: input.loopStage,
        createdAt: at,
        updatedAt: at,
        inputs: input.inputs || {},
        outputs: input.outputs || {},
        artifacts: input.artifacts || [],
        evidence: input.evidence || [],
        errors: input.errors || [],
        parents: input.parents || [],
        children: input.children || [],
        contractId: input.contractId,
        metadata: input.metadata,
    };
}
/** The full transition matrix PLUS the second gate: `committed` is refused
 *  unless the node is already `verified` (checked AFTER the matrix, its own
 *  error code `commit-without-verifier`). An illegal transition throws
 *  BEFORE the node changes. */
function transitionStateNode(node, input, now) {
    if (!isLegalTransition(node.status, input.status)) {
        throw contractError("illegal-transition", `State node ${node.id} cannot transition from ${node.status} to ${input.status}`, { nodeId: node.id, details: { from: node.status, to: input.status } });
    }
    if (input.status === "committed" && node.status !== "verified") {
        throw contractError("commit-without-verifier", `State node ${node.id} cannot be committed before it is verified`, { nodeId: node.id, details: { from: node.status, to: input.status } });
    }
    return {
        ...node,
        status: input.status,
        loopStage: input.loopStage || node.loopStage,
        updatedAt: now || new Date().toISOString(),
        outputs: input.outputs ? { ...node.outputs, ...input.outputs } : node.outputs,
        artifacts: input.artifacts ? mergeById(node.artifacts, input.artifacts) : node.artifacts,
        evidence: input.evidence ? mergeById(node.evidence, input.evidence) : node.evidence,
        metadata: input.metadata ? { ...(node.metadata || {}), ...input.metadata } : node.metadata,
    };
}
function validatePipelineContract(contract) {
    if (contract.schemaVersion !== exports.PIPELINE_CONTRACT_SCHEMA_VERSION) {
        throw contractError("invalid-contract-schema", `Pipeline contract ${contract.id || "(missing id)"} has unsupported schemaVersion`, { details: { schemaVersion: contract.schemaVersion } });
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
            details: contract.compatibility,
        });
    }
}
/** `pathExists` defaults to a function that always returns `true` (no path
 *  ever "missing") ONLY when the caller genuinely has no filesystem to
 *  check against; every real caller (shell/) passes `fs.existsSync` so the
 *  `missing-artifact-path` gate behaves exactly like the old build. Kept as
 *  an explicit parameter (never a top-level `require("node:fs")`) so this
 *  stays a pure core/ module per v2/PLAN.md's core/shell split. */
function assertNodeSatisfiesContract(node, contract, stageId, pathExists = () => true) {
    validatePipelineContract(contract);
    const stage = contract.stages.find((candidate) => candidate.id === stageId);
    if (!stage) {
        throw contractError("unknown-contract-stage", `Pipeline contract ${contract.id} has no stage ${stageId}`, { nodeId: node.id });
    }
    if (!stage.acceptedInputKinds.includes(node.kind)) {
        throw contractError("unexpected-node-kind", `Stage ${stage.id} does not accept node kind ${node.kind}`, {
            nodeId: node.id,
            details: { expected: stage.acceptedInputKinds, actual: node.kind },
        });
    }
    if (!stage.acceptedInputStatuses.includes(node.status)) {
        throw contractError("unexpected-node-status", `Stage ${stage.id} does not accept node status ${node.status}`, {
            nodeId: node.id,
            details: { expected: stage.acceptedInputStatuses, actual: node.status },
        });
    }
    assertRequiredArtifacts(node, stage, pathExists);
    assertRequiredEvidence(node, stage, contract);
    assertVerifierGate(node, stage, contract);
}
function recordNodeError(node, error, now) {
    const at = now || new Date().toISOString();
    return {
        ...node,
        status: "failed",
        updatedAt: at,
        errors: [...node.errors, { ...error, at: error.at || at, nodeId: error.nodeId || node.id }],
    };
}
function linkStateNodes(parent, child, now) {
    const at = now || new Date().toISOString();
    return [
        { ...parent, updatedAt: at, children: unique([...parent.children, child.id]) },
        { ...child, updatedAt: at, parents: unique([...child.parents, parent.id]) },
    ];
}
/** Upsert `node` into `run.nodes` IN PLACE (replace at the same index when
 *  the id exists, else push at the end — the array reference is stable).
 *  `persist` is a caller-supplied side effect (shell/node-store.ts's
 *  `writeRunNode`) so this pure module never imports fs itself. */
function appendRunNode(run, node, persist) {
    const nodes = run.nodes || (run.nodes = []);
    const index = nodes.findIndex((candidate) => candidate.id === node.id);
    if (index >= 0)
        nodes[index] = node;
    else
        nodes.push(node);
    if (persist)
        persist(run, node);
    return node;
}
function upsertRunContract(run, contract) {
    validatePipelineContract(contract);
    const contracts = run.contracts || [];
    const index = contracts.findIndex((candidate) => candidate.id === contract.id);
    run.contracts = index >= 0 ? contracts.map((candidate) => (candidate.id === contract.id ? contract : candidate)) : [...contracts, contract];
    return contract;
}
/** `Boolean(artifact.path && <exists>)` — the existence check itself is
 *  supplied by the caller (shell) so this stays pure; callers pass
 *  `fs.existsSync` in practice. */
function artifactExists(artifact, exists) {
    return Boolean(artifact.path && exists(artifact.path));
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
function assertRequiredArtifacts(node, stage, pathExists) {
    for (const required of stage.requiredArtifacts || []) {
        const artifact = node.artifacts.find((candidate) => candidate.id === required || candidate.kind === required);
        if (!artifact) {
            throw contractError("missing-required-artifact", `Node ${node.id} is missing required artifact ${required}`, {
                nodeId: node.id,
                details: { requiredArtifact: required },
            });
        }
        if (!artifactExists(artifact, pathExists)) {
            throw contractError("missing-artifact-path", `Node ${node.id} artifact ${artifact.id} path does not exist`, {
                nodeId: node.id,
                path: artifact.path,
                details: { artifactId: artifact.id },
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
            details: { requiredEvidence },
        });
    }
    for (const required of requiredEvidence) {
        const evidence = node.evidence.find((candidate) => candidate.id === required || candidate.source === required);
        if (!evidence) {
            throw contractError("missing-required-evidence", `Node ${node.id} is missing required evidence ${required}`, {
                nodeId: node.id,
                details: { requiredEvidence: required },
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
            details: { actual: node.status, accepted: acceptedStatuses },
        });
    }
    if ((gate?.requiredEvidence || contract.evidencePolicy?.requireEvidence) && !node.evidence.length) {
        throw contractError("verifier-gate-missing-evidence", `Stage ${stage.id} requires evidence before commit`, { nodeId: node.id });
    }
}
/** The transition matrix: `same -> same` is always legal (checked first via
 *  `from === to`), plus the table below. `committed` is terminal (empty
 *  array). */
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
        committed: [],
    };
    return allowed[from].includes(to);
}
function contractError(code, message, options = {}) {
    return new PipelineContractError({ code, message, ...options });
}
/** Deterministic id fallback: no wall-clock, no random. A node minted
 *  without an explicit id gets `"<kind>-" + <first 16 hex of sha256(...)>`.
 *  Two nodes with the same content collapse to ONE id by design. */
function createNodeId(input) {
    const digest = (0, hash_1.sha256)((0, hash_1.stableStringify)({
        kind: input.kind,
        loopStage: input.loopStage,
        contractId: input.contractId ?? null,
        inputs: input.inputs ?? null,
        outputs: input.outputs ?? null,
    }));
    return `${input.kind}-${digest.replace("sha256:", "").slice(0, 16)}`;
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
