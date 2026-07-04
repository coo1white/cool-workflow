"use strict";
// shell/commit.ts — commitState: the imperative wrapper around
// core/pipeline/commit-gate.ts's pure gate resolution.
//
// MILESTONE 6+7 (combined). Byte-exact port of the old build's
// src/commit.ts's IO half (snapshot write, git-head read, the commit
// node's disk write via the pipeline runner).
//
// Evidence: SPEC/pipeline-run.md "Commit gate — src/commit.ts".
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.CommitGateError = void 0;
exports.commitState = commitState;
const fs = __importStar(require("node:fs"));
const path = __importStar(require("node:path"));
const node_child_process_1 = require("node:child_process");
const fs_atomic_1 = require("./fs-atomic");
const commit_gate_1 = require("../core/pipeline/commit-gate");
const contract_1 = require("../core/pipeline/contract");
const runner_1 = require("../core/pipeline/runner");
const node_store_1 = require("./node-store");
const state_node_1 = require("../core/state/state-node");
const trust_audit_1 = require("./trust-audit");
const evidence_grounding_1 = require("../core/trust/evidence-grounding");
class CommitGateError extends Error {
    structured;
    feedbackId;
    stateNodeId;
    constructor(error, options = {}) {
        super(error.message);
        this.name = "CommitGateError";
        this.structured = error;
        this.feedbackId = options.feedbackId;
        this.stateNodeId = options.stateNodeId;
    }
}
exports.CommitGateError = CommitGateError;
function normalizeCommitOptions(input) {
    if (typeof input === "string")
        return { reason: input || "manual", source: "runtime" };
    return { ...input, reason: input.reason || "manual", source: input.source || "runtime" };
}
function readGitHead(cwd) {
    try {
        return (0, node_child_process_1.execFileSync)("git", ["rev-parse", "HEAD"], { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 5000 }).trim();
    }
    catch {
        return undefined;
    }
}
function findNode(run, nodeId) {
    return (run.nodes || []).find((n) => n.id === nodeId);
}
function backingResultFor(run, verifierNodeId) {
    if (!verifierNodeId)
        return { result: undefined, requiresEvidence: undefined };
    const marker = ":verifier:";
    const idx = verifierNodeId.indexOf(marker);
    const taskId = idx >= 0 ? verifierNodeId.slice(idx + marker.length) : undefined;
    const task = taskId ? run.tasks.find((t) => t.id === taskId) : undefined;
    if (!task)
        return { result: undefined, requiresEvidence: undefined };
    return { result: task.result, requiresEvidence: Boolean(task.requiresEvidence) };
}
/** commitState(run, input) — resolves the gate, writes the failure node +
 *  throws on any error; on success writes the snapshot + commit node and
 *  pushes the commit. */
function commitState(run, input) {
    const options = normalizeCommitOptions(input);
    const now = new Date().toISOString();
    const { result: backingResult, requiresEvidence } = backingResultFor(run, options.verifierNodeId || (options.reason.startsWith("result:") ? run.tasks.find((t) => t.id === options.reason.slice(7))?.verifierNodeId : undefined));
    const gate = (0, commit_gate_1.resolveCommitGate)(run, options, {
        now,
        backingResult,
        taskRequiresEvidence: requiresEvidence,
        unresolvedFileEvidence: (0, evidence_grounding_1.requireResolvableEvidence)()
            ? (evidence) => (0, evidence_grounding_1.unresolvedFileEvidence)(evidence, Array.from(new Set([run.cwd, process.cwd(), run.paths.runDir])), { exists: fs.existsSync, isAbsolute: path.isAbsolute, resolve: (base, rel) => path.resolve(base, rel) })
            : undefined,
    });
    if (gate.errors.length) {
        throw recordCommitGateFailure(run, options, gate);
    }
    fs.mkdirSync(run.paths.commitsDir, { recursive: true });
    const id = (0, commit_gate_1.formatCommitId)((run.commits || []).length + 1);
    const snapshotPath = path.join(run.paths.commitsDir, `${id}.json`);
    const audit = gate.verifierGated
        ? (0, trust_audit_1.recordTrustAuditEvent)(run, { kind: "commit.gate", decision: "accepted", source: "cw-validated", nodeId: gate.verifierNodeId, candidateId: gate.candidateId, selectionId: gate.selectionId, commitId: id, evidence: gate.evidence })
        : undefined;
    const evidence = (0, trust_audit_1.normalizeEvidence)(run, gate.evidence, { source: gate.verifierGated ? "cw-validated" : "runtime-derived", verifierNodeId: gate.verifierNodeId, candidateId: gate.candidateId, selectionId: gate.selectionId, commitId: id, auditEventIds: audit ? [audit.id] : [] });
    const commit = {
        id,
        createdAt: now,
        reason: options.reason,
        loopStage: run.loopStage,
        statePath: run.paths.state,
        reportPath: run.paths.report,
        snapshotPath,
        gitHead: readGitHead(run.cwd),
        verifierGated: gate.verifierGated,
        checkpoint: !gate.verifierGated,
        verifierNodeId: gate.verifierNodeId,
        candidateId: gate.candidateId,
        selectionId: gate.selectionId,
        evidence,
        metadata: { ...(options.metadata || {}), ...gate.metadata },
    };
    const commitNodeId = recordCommitNode(run, commit, options, gate);
    if (commitNodeId)
        commit.stateNodeId = commitNodeId;
    (0, fs_atomic_1.writeJson)(snapshotPath, { commit, run });
    run.commits.push(commit);
    return commit;
}
function recordCommitNode(run, commit, options, gate) {
    const verifierNode = gate.verifierNodeId ? findNode(run, gate.verifierNodeId) : undefined;
    if (commit.verifierGated && verifierNode) {
        const commitResult = (0, runner_1.runPipelineStage)(run, "commit", verifierNode.id, {
            outputNodeId: `${run.id}:commit:${commit.id}`,
            outputStatus: "committed",
            loopStage: "checkpoint",
            outputs: { snapshotPath: commit.snapshotPath, gitHead: commit.gitHead, verifierGated: true, verifierNodeId: verifierNode.id, candidateId: gate.candidateId, selectionId: gate.selectionId },
            artifacts: [{ id: "snapshot", kind: "json", path: commit.snapshotPath }],
            evidence: commit.evidence || verifierNode.evidence,
            metadata: { ...(options.metadata || {}), reason: options.reason, commitId: commit.id, verifierGated: true, checkpoint: false, verifierNodeId: verifierNode.id, candidateId: gate.candidateId, selectionId: gate.selectionId, selectionNodeId: gate.selectionNodeId },
        }, { persist: false, persistNode: node_store_1.writeRunNode });
        if (gate.selectionNodeId && commitResult.outputNodeId)
            linkAdditionalParent(run, gate.selectionNodeId, commitResult.outputNodeId);
        return commitResult.outputNodeId;
    }
    const checkpointNode = (0, state_node_1.createStateNode)({
        id: `${run.id}:checkpoint:${commit.id}`,
        kind: "commit",
        status: "completed",
        loopStage: "checkpoint",
        inputs: { reason: options.reason, commitId: commit.id },
        outputs: { snapshotPath: commit.snapshotPath, gitHead: commit.gitHead, verifierGated: false, checkpoint: true },
        artifacts: [{ id: "snapshot", kind: "json", path: commit.snapshotPath }],
        contractId: contract_1.DEFAULT_PIPELINE_CONTRACT_ID,
        metadata: { ...(options.metadata || {}), verifierGated: false, checkpoint: true },
    });
    (0, node_store_1.appendRunNode)(run, checkpointNode);
    return checkpointNode.id;
}
function recordCommitGateFailure(run, options, gate) {
    const first = gate.errors[0] || { code: "commit-gate-blocked", message: "Verifier-gated commit blocked", at: new Date().toISOString(), retryable: false };
    const node = (0, state_node_1.recordNodeError)((0, state_node_1.createStateNode)({
        id: `${run.id}:commit-gate-failed:${(0, commit_gate_1.gateFailureSeq)(run)}`,
        kind: "error",
        status: "pending",
        loopStage: "checkpoint",
        inputs: { reason: options.reason, verifierNodeId: gate.verifierNodeId, candidateId: gate.candidateId, selectionId: gate.selectionId },
        evidence: gate.evidence,
        contractId: contract_1.DEFAULT_PIPELINE_CONTRACT_ID,
        metadata: {
            ...(options.metadata || {}),
            verifierGated: true,
            checkpoint: false,
            failureCount: gate.errors.length,
            failures: gate.errors.map((entry) => ({ code: entry.code, message: entry.message, nodeId: entry.nodeId })),
            gate: gate.metadata,
        },
    }), first);
    const persisted = (0, node_store_1.appendRunNode)(run, node);
    for (const parentId of [gate.selectionNodeId, gate.verifierNodeId].filter(Boolean)) {
        linkAdditionalParent(run, parentId, persisted.id);
    }
    return new CommitGateError(first, { stateNodeId: persisted.id });
}
function linkAdditionalParent(run, parentId, childId) {
    const parent = findNode(run, parentId);
    const child = findNode(run, childId);
    if (!parent || !child)
        return;
    const [linkedParent, linkedChild] = (0, state_node_1.linkStateNodes)(parent, child);
    (0, node_store_1.appendRunNode)(run, linkedParent);
    (0, node_store_1.appendRunNode)(run, linkedChild);
}
