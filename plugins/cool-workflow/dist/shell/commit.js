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
const collaboration_io_1 = require("./collaboration-io");
const error_feedback_io_1 = require("./error-feedback-io");
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
    // Fold facade-style bare nouns (verifier/candidate/selection) into the *Id
    // fields so a host/MCP-shaped payload gates the same as a CLI-shaped one. When
    // any gate option is supplied, the commit is verifier-gated by construction —
    // mirrors commitRun()'s hasGateOption, so calling commitState directly with
    // { selection } gates exactly as `cw commit --selection` does.
    const verifierNodeId = input.verifierNodeId || input.verifier || input.verifierNode;
    const candidateId = input.candidateId || input.candidate;
    const selectionId = input.selectionId || input.selection;
    const hasGateOption = Boolean(verifierNodeId || candidateId || selectionId);
    return {
        ...input,
        reason: input.reason || "manual",
        source: input.source || "runtime",
        verifierNodeId,
        candidateId,
        selectionId,
        verifierGated: input.verifierGated || (hasGateOption && !input.allowUnverifiedCheckpoint),
    };
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
    // Stack the review gate ON TOP of the verifier gate. An applicable review
    // policy can only ADD required-approval constraints from authorized roles; it
    // never relaxes verifier acceptance. Fail closed: a verifier-passing but
    // un-approved commit is BLOCKED here. Provenance (who approved the shipped
    // commit) is stamped only when NO errors remain. The old build wired this
    // inside resolveVerifierGate; v2's resolver is pure, so it layers in the
    // shell where the run's approval state lives.
    let reviewProvenance;
    if (gate.verifierGated) {
        const reviewInput = {
            targetKind: "commit",
            candidateId: gate.candidateId,
            selectionId: gate.selectionId,
            selfActorIds: (0, collaboration_io_1.selfActorIdsForCandidate)(run, gate.candidateId, gate.selectionId),
        };
        const reviewErrors = (0, collaboration_io_1.reviewGateErrors)(run, reviewInput);
        if (reviewErrors.length)
            gate.errors.push(...reviewErrors);
        else
            reviewProvenance = (0, collaboration_io_1.commitReviewProvenance)(run, reviewInput);
    }
    if (gate.errors.length) {
        throw recordCommitGateFailure(run, options, gate);
    }
    fs.mkdirSync(run.paths.commitsDir, { recursive: true });
    const id = (0, commit_gate_1.formatCommitId)((run.commits || []).length + 1);
    const snapshotPath = path.join(run.paths.commitsDir, `${id}.json`);
    const rationale = gate.acceptanceRationale;
    const audit = gate.verifierGated
        ? (0, trust_audit_1.recordTrustAuditEvent)(run, { kind: "commit.gate", decision: "accepted", source: "cw-validated", workerId: rationale?.workerId, nodeId: gate.verifierNodeId, candidateId: gate.candidateId, selectionId: gate.selectionId, commitId: id, sandboxProfileId: rationale?.sandboxProfileId, evidence: gate.evidence, metadata: rationale })
        : undefined;
    const evidence = (0, trust_audit_1.normalizeEvidence)(run, gate.evidence, { source: gate.verifierGated ? "cw-validated" : "runtime-derived", workerId: rationale?.workerId, verifierNodeId: gate.verifierNodeId, candidateId: gate.candidateId, selectionId: gate.selectionId, commitId: id, auditEventIds: audit ? [audit.id] : [] });
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
        // Acceptance rationale rides on the commit so `report`/`metrics`/audit can
        // explain WHY it was accepted. commitGateResult reflects whether the gate
        // ran (passed) or this was an unverified checkpoint; audit event id is
        // threaded so the rationale points back at its own audit record.
        ...(rationale
            ? {
                acceptanceRationale: {
                    ...rationale,
                    commitGateResult: gate.verifierGated ? "passed" : "checkpoint",
                    auditEventIds: audit ? [...(rationale.auditEventIds || []), audit.id] : rationale.auditEventIds,
                },
            }
            : {}),
        metadata: { ...(options.metadata || {}), ...gate.metadata },
        ...(reviewProvenance ? { review: reviewProvenance } : {}),
    };
    const commitNodeId = recordCommitNode(run, commit, options, gate);
    if (commitNodeId)
        commit.stateNodeId = commitNodeId;
    // A verifier-gated commit is the run's checkpoint — advance the run-level loop
    // stage. Guard on verifierGated so the initial plan/unverified checkpoint does
    // NOT prematurely move the run off "interpret".
    if (gate.verifierGated)
        run.loopStage = "checkpoint";
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
    // Record the block as append-only operator feedback so the codes
    // (commit-verifier-not-found / missing-evidence / review-gate-missing-
    // approvals / …) are not lost — the old build did this and the commit gate's
    // failure must surface visibly, not silently.
    const feedback = (0, error_feedback_io_1.recordFeedback)(run, {
        source: options.source === "cli" ? "cli" : "verifier",
        error: first,
        nodeId: persisted.id,
        stageId: "commit",
        contractId: contract_1.DEFAULT_PIPELINE_CONTRACT_ID,
        retryable: false,
        evidence: gate.evidence,
        artifacts: [],
        metadata: {
            reason: options.reason,
            verifierNodeId: gate.verifierNodeId,
            candidateId: gate.candidateId,
            selectionId: gate.selectionId,
            failures: gate.errors.map((entry) => ({ code: entry.code, message: entry.message, nodeId: entry.nodeId })),
        },
    });
    return new CommitGateError(first, { feedbackId: feedback.id, stateNodeId: persisted.id });
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
