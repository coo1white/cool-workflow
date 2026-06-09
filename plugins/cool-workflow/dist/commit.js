"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.CommitGateError = void 0;
exports.commitState = commitState;
const node_fs_1 = __importDefault(require("node:fs"));
const node_path_1 = __importDefault(require("node:path"));
const node_child_process_1 = require("node:child_process");
const state_1 = require("./state");
const pipeline_contract_1 = require("./pipeline-contract");
const state_node_1 = require("./state-node");
const pipeline_runner_1 = require("./pipeline-runner");
const error_feedback_1 = require("./error-feedback");
const trust_audit_1 = require("./trust-audit");
const collaboration_1 = require("./collaboration");
const evidence_grounding_1 = require("./evidence-grounding");
const verifier_1 = require("./verifier");
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
function commitState(run, input) {
    const options = normalizeCommitOptions(input);
    const gate = resolveCommitGate(run, options);
    if (gate.errors.length) {
        throw recordCommitGateFailure(run, options, gate);
    }
    node_fs_1.default.mkdirSync(run.paths.commitsDir, { recursive: true });
    const id = createCommitId();
    const snapshotPath = node_path_1.default.join(run.paths.commitsDir, `${id}.json`);
    const audit = gate.verifierGated
        ? (0, trust_audit_1.recordTrustAuditEvent)(run, {
            kind: "commit.gate",
            decision: "accepted",
            source: "cw-validated",
            workerId: gate.rationale?.workerId,
            nodeId: gate.verifierNodeId,
            candidateId: gate.candidateId,
            selectionId: gate.selectionId,
            commitId: id,
            sandboxProfileId: gate.rationale?.sandboxProfileId,
            evidence: gate.evidence,
            metadata: gate.rationale
        })
        : undefined;
    const evidence = (0, trust_audit_1.normalizeEvidence)(run, gate.evidence, {
        source: gate.verifierGated ? "cw-validated" : "runtime-derived",
        workerId: gate.rationale?.workerId,
        verifierNodeId: gate.verifierNodeId,
        candidateId: gate.candidateId,
        selectionId: gate.selectionId,
        commitId: id,
        auditEventIds: audit ? [audit.id] : []
    });
    const commit = {
        id,
        createdAt: new Date().toISOString(),
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
        acceptanceRationale: gate.rationale
            ? {
                ...gate.rationale,
                commitGateResult: gate.verifierGated ? "passed" : "checkpoint",
                auditEventIds: audit ? [...(gate.rationale.auditEventIds || []), audit.id] : gate.rationale.auditEventIds
            }
            : undefined,
        review: gate.review,
        metadata: {
            ...(options.metadata || {}),
            ...gate.metadata
        }
    };
    const commitNodeId = recordCommitNode(run, commit, options, gate);
    if (commitNodeId)
        commit.stateNodeId = commitNodeId;
    (0, state_1.writeJson)(snapshotPath, {
        commit,
        run
    });
    run.commits.push(commit);
    return commit;
}
/** A verifier node is held to the grounded-evidence bar when its backing task
 *  requires evidence, or when it backs an explicit candidate/selection commit
 *  (no 1:1 task — these are the higher-stakes commits the gate exists for). */
function verifierNodeRequiresEvidence(run, verifierNode) {
    const marker = ":verifier:";
    const idx = verifierNode.id.indexOf(marker);
    const taskId = idx >= 0 ? verifierNode.id.slice(idx + marker.length) : undefined;
    const task = taskId ? run.tasks.find((candidate) => candidate.id === taskId) : undefined;
    if (task)
        return (0, verifier_1.taskRequiresEvidence)(task);
    return true; // candidate/selection verifier with no 1:1 task — enforce grounding.
}
/** The HARD no-false-green gate (DIRECTION.md "ambiguity is a visible state").
 *  A verifier node is built FROM a result node; when that result captured no
 *  structured signal at all the result node carries an `metadata.captureWarning`
 *  marker (set in worker-isolation / lifecycle ingest via isEmptyCapture). The
 *  worker output is still ACCEPTED (a recorded warning, never a silent pass), but
 *  a verifier-GATED commit must NOT be able to present that zero-evidence result
 *  as clean/green. We detect it here, reading ONLY persisted state (the source
 *  result node's metadata) — purely functional, no clock/ordering — so snapshot
 *  replay reaches the same gate decision. Returns the marker string, or undefined.
 *
 *  Resolution trail: verifier node -> its input/parent result node. We look at
 *  `inputs.inputNodeId` (set by runPipelineStage) first, then fall back to the
 *  first parent, so it works regardless of which ingest path produced the node. */
function emptyCaptureWarning(run, verifierNode) {
    const resultNodeId = (typeof verifierNode.inputs?.inputNodeId === "string" ? verifierNode.inputs.inputNodeId : undefined) ||
        verifierNode.parents[0];
    const resultNode = resultNodeId ? findNode(run, resultNodeId) : undefined;
    const warning = resultNode?.metadata?.captureWarning;
    return typeof warning === "string" && warning ? warning : undefined;
}
function evidenceLocatorString(entry) {
    const ref = entry.locator || entry.path || entry.summary || entry.id;
    return ref ? String(ref) : undefined;
}
/** Base dirs used to resolve file-style evidence locators in strict mode. */
function commitEvidenceBaseDirs(run) {
    return Array.from(new Set([run.cwd, process.cwd(), run.paths.runDir].filter(Boolean)));
}
function normalizeCommitOptions(input) {
    if (typeof input === "string")
        return { reason: input || "manual", source: "runtime" };
    return {
        ...input,
        reason: input.reason || "manual",
        source: input.source || "runtime"
    };
}
function resolveCommitGate(run, options) {
    const metadata = {
        verifierGated: false,
        checkpoint: true
    };
    const errors = [];
    const taskVerifierNodeId = taskVerifierFromReason(run, options.reason);
    const explicitGate = Boolean(options.verifierNodeId || options.candidateId || options.selectionId || options.verifierGated);
    const verifierGated = explicitGate || Boolean(taskVerifierNodeId);
    let verifierNodeId = options.verifierNodeId || taskVerifierNodeId;
    let candidateId = options.candidateId;
    let selectionId = options.selectionId;
    let selectionNodeId;
    if (!verifierGated) {
        return {
            verifierGated: false,
            evidence: [],
            errors,
            metadata
        };
    }
    metadata.verifierGated = true;
    metadata.checkpoint = false;
    if (selectionId) {
        const selection = findSelection(run, selectionId);
        if (!selection) {
            errors.push(error("commit-selection-not-found", `Commit selection not found: ${selectionId}`, { details: { selectionId } }));
        }
        else {
            candidateId = candidateId || selection.candidateId;
            verifierNodeId = resolveLinkedVerifier(verifierNodeId, selection.verifierNodeId, errors, "selection", selection.id);
            const selectionNode = findSelectionNode(run, selection.id);
            selectionNodeId = selectionNode?.id;
            if (!selectionNode) {
                errors.push(error("commit-selection-node-missing", `Selection ${selection.id} has no state node`, {
                    details: { selectionId: selection.id, candidateId: selection.candidateId }
                }));
            }
            else if (selectionNode.kind !== "candidate" || selectionNode.status !== "verified") {
                errors.push(error("commit-selection-not-verified", `Selection ${selection.id} is not a verified candidate selection`, {
                    nodeId: selectionNode.id,
                    details: { selectionId: selection.id, status: selectionNode.status, kind: selectionNode.kind }
                }));
            }
            if (!selection.scoreId) {
                errors.push(error("commit-candidate-unscored", `Selection ${selection.id} has no score evidence`, {
                    details: { selectionId: selection.id, candidateId: selection.candidateId }
                }));
            }
        }
    }
    if (candidateId) {
        const candidate = findCandidate(run, candidateId);
        if (!candidate) {
            errors.push(error("commit-candidate-not-found", `Commit candidate not found: ${candidateId}`, { details: { candidateId } }));
        }
        else {
            if (candidate.status === "rejected" || candidate.status === "failed") {
                errors.push(error("commit-candidate-not-selectable", `Candidate ${candidateId} is ${candidate.status}`, {
                    details: { candidateId, status: candidate.status }
                }));
            }
            if (!candidate.scores.length) {
                errors.push(error("commit-candidate-unscored", `Candidate ${candidateId} has no score evidence`, {
                    details: { candidateId }
                }));
            }
            if (candidate.status !== "verified") {
                errors.push(error("commit-candidate-not-verified", `Candidate ${candidateId} is not verifier-gated`, {
                    details: { candidateId, status: candidate.status }
                }));
            }
            const selection = selectionId ? findSelection(run, selectionId) : latestSelectionForCandidate(run, candidateId);
            if (!selection) {
                errors.push(error("commit-candidate-selection-missing", `Candidate ${candidateId} has no verified selection`, {
                    details: { candidateId }
                }));
            }
            else {
                selectionId = selection.id;
                verifierNodeId = resolveLinkedVerifier(verifierNodeId, selection.verifierNodeId || candidate.verifierNodeId, errors, "candidate", candidateId);
                const selectionNode = findSelectionNode(run, selection.id);
                selectionNodeId = selectionNode?.id;
                if (!selectionNode || selectionNode.status !== "verified") {
                    errors.push(error("commit-selection-not-verified", `Candidate ${candidateId} selection ${selection.id} is not verified`, {
                        nodeId: selectionNode?.id,
                        details: { candidateId, selectionId: selection.id, status: selectionNode?.status || "missing" }
                    }));
                }
                if (!selection.scoreId) {
                    errors.push(error("commit-candidate-unscored", `Candidate ${candidateId} selection ${selection.id} has no score evidence`, {
                        details: { candidateId, selectionId: selection.id }
                    }));
                }
            }
        }
    }
    if (!verifierNodeId) {
        errors.push(error("commit-verifier-required", "Verifier-gated commit requires --verifier, --candidate, or --selection", {
            details: {
                hint: "Use --allow-unverified-checkpoint to write a non-gated checkpoint."
            }
        }));
    }
    const verifierNode = verifierNodeId ? findNode(run, verifierNodeId) : undefined;
    if (verifierNodeId && !verifierNode) {
        errors.push(error("commit-verifier-not-found", `Verifier node not found: ${verifierNodeId}`, { details: { verifierNodeId } }));
    }
    if (verifierNode) {
        if (verifierNode.kind !== "verifier") {
            errors.push(error("commit-verifier-wrong-kind", `Node ${verifierNode.id} is not a verifier node`, {
                nodeId: verifierNode.id,
                details: { verifierNodeId: verifierNode.id, kind: verifierNode.kind }
            }));
        }
        if (verifierNode.status !== "verified") {
            errors.push(error("commit-verifier-not-verified", `Verifier node ${verifierNode.id} is ${verifierNode.status}`, {
                nodeId: verifierNode.id,
                details: { verifierNodeId: verifierNode.id, status: verifierNode.status }
            }));
        }
        // HARD no-false-green gate (v0.1.43): if the backing result was an
        // empty-capture (no findings AND no evidence even after robust
        // normalization), the verifier node only carries a non-grounded summary
        // fallback. That can otherwise pass the length-only path for
        // optional-evidence tasks and present a 0-real-evidence review as
        // clean/green. Block it BEFORE the rationale is built so the commit fails
        // visibly (commit-gate-failed node + feedback) instead of silently passing.
        const captureWarning = emptyCaptureWarning(run, verifierNode);
        if (captureWarning) {
            errors.push(error("commit-rationale-empty-capture", `Verifier node ${verifierNode.id} cannot back a commit: ${captureWarning}`, {
                nodeId: verifierNode.id,
                details: { verifierNodeId: verifierNode.id, reason: captureWarning }
            }));
        }
        if (!verifierNode.evidence.length) {
            errors.push(error("commit-verifier-missing-evidence", `Verifier node ${verifierNode.id} has no evidence`, {
                nodeId: verifierNode.id,
                details: { verifierNodeId: verifierNode.id }
            }));
        }
        else if (verifierNodeRequiresEvidence(run, verifierNode)) {
            // Evidence grounding (v0.1.40 self-audit P1/P2): for verifier nodes whose
            // task REQUIRES evidence (verify/verdict/requiresEvidence, and explicit
            // candidate/selection commits), the gate must not accept unverifiable free
            // text. Require at least one GROUNDED locator (path-like / URL /
            // namespace:value), and — when the operator opts in via
            // CW_REQUIRE_RESOLVABLE_EVIDENCE — that file-style locators actually resolve
            // on disk. Closes the "presence != existence" gap. Optional-evidence tasks
            // (e.g. map/assess) keep the length-only check so the gate is never stricter
            // than result acceptance was.
            const locators = verifierNode.evidence.map(evidenceLocatorString).filter(Boolean);
            if (!(0, evidence_grounding_1.hasGroundedEvidence)(locators)) {
                errors.push(error("commit-verifier-evidence-ungrounded", `Verifier node ${verifierNode.id} evidence is not grounded (needs a path-like locator, URL, or namespace:value token)`, {
                    nodeId: verifierNode.id,
                    details: { verifierNodeId: verifierNode.id, evidence: locators }
                }));
            }
            if ((0, evidence_grounding_1.requireResolvableEvidence)()) {
                const unresolved = (0, evidence_grounding_1.unresolvedFileEvidence)(locators, commitEvidenceBaseDirs(run));
                if (unresolved.length) {
                    errors.push(error("commit-verifier-evidence-unresolvable", `Verifier node ${verifierNode.id} cites file evidence that does not resolve on disk: ${unresolved.join(", ")}`, {
                        nodeId: verifierNode.id,
                        details: { verifierNodeId: verifierNode.id, unresolved }
                    }));
                }
            }
        }
    }
    let rationale;
    if (verifierGated && candidateId && selectionId) {
        const candidate = findCandidate(run, candidateId);
        const selection = findSelection(run, selectionId);
        const score = selection?.scoreId ? findScore(run, candidateId, selection.scoreId) : undefined;
        rationale = selection?.acceptanceRationale || (0, trust_audit_1.buildAcceptanceRationale)({
            selectedCandidateId: candidateId,
            scoreId: selection?.scoreId,
            scoreCriteria: score?.criteria,
            verifierNodeId,
            evidenceCount: verifierNode?.evidence.length || 0,
            sandboxProfileId: sandboxProfileForCandidate(run, candidate),
            workerId: candidate?.workerId,
            commitGateResult: "passed"
        });
        for (const failure of (0, trust_audit_1.validateAcceptanceRationale)(rationale)) {
            errors.push(error("commit-rationale-incomplete", `Verifier-gated commit cannot explain acceptance: ${failure}`, {
                details: { candidateId, selectionId, verifierNodeId }
            }));
        }
    }
    // REVIEW GATE — POLICY layered ON TOP of the verifier MECHANISM. These errors
    // can only ADD constraints (required approvals from authorized roles); they
    // never relax verifier acceptance. Empty unless a policy applies to commits.
    // Fail closed: a commit lacking its required approvals is BLOCKED here.
    const reviewErrors = (0, collaboration_1.reviewGateErrors)(run, {
        targetKind: "commit",
        candidateId,
        selectionId,
        selfActorIds: (0, collaboration_1.selfActorIdsForCandidate)(run, candidateId, selectionId)
    });
    errors.push(...reviewErrors);
    const review = errors.length
        ? undefined
        : (0, collaboration_1.commitReviewProvenance)(run, {
            targetKind: "commit",
            candidateId,
            selectionId,
            selfActorIds: (0, collaboration_1.selfActorIdsForCandidate)(run, candidateId, selectionId)
        });
    return {
        verifierGated: true,
        verifierNodeId,
        candidateId,
        selectionId,
        selectionNodeId,
        evidence: verifierNode?.evidence || [],
        errors,
        rationale,
        review,
        metadata: {
            ...metadata,
            verifierNodeId,
            candidateId,
            selectionId,
            selectionNodeId
        }
    };
}
function recordCommitNode(run, commit, options, gate) {
    const contract = (0, state_node_1.upsertRunContract)(run, (0, pipeline_contract_1.createDefaultPipelineContract)());
    const verifierNode = gate.verifierNodeId ? findNode(run, gate.verifierNodeId) : undefined;
    if (commit.verifierGated && verifierNode) {
        const commitResult = (0, pipeline_runner_1.createPipelineRunner)({ contractId: contract.id, persist: false }).runPipelineStage(run, "commit", verifierNode.id, {
            outputNodeId: `${run.id}:commit:${commit.id}`,
            outputStatus: "committed",
            loopStage: "checkpoint",
            outputs: {
                snapshotPath: commit.snapshotPath,
                gitHead: commit.gitHead,
                verifierGated: true,
                verifierNodeId: verifierNode.id,
                candidateId: gate.candidateId,
                selectionId: gate.selectionId
            },
            artifacts: [{ id: "snapshot", kind: "json", path: commit.snapshotPath }],
            evidence: commit.evidence || verifierNode.evidence,
            metadata: {
                ...(options.metadata || {}),
                reason: options.reason,
                commitId: commit.id,
                verifierGated: true,
                checkpoint: false,
                verifierNodeId: verifierNode.id,
                candidateId: gate.candidateId,
                selectionId: gate.selectionId,
                selectionNodeId: gate.selectionNodeId,
                acceptanceRationale: commit.acceptanceRationale
            }
        });
        if (gate.selectionNodeId && commitResult.outputNodeId) {
            linkAdditionalParent(run, gate.selectionNodeId, commitResult.outputNodeId);
        }
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
        contractId: pipeline_contract_1.DEFAULT_PIPELINE_CONTRACT_ID,
        metadata: {
            ...(options.metadata || {}),
            verifierGated: false,
            checkpoint: true
        }
    });
    (0, state_node_1.appendRunNode)(run, checkpointNode);
    return checkpointNode.id;
}
function recordCommitGateFailure(run, options, gate) {
    const first = gate.errors[0] || error("commit-gate-blocked", "Verifier-gated commit blocked");
    const node = (0, state_node_1.recordNodeError)((0, state_node_1.createStateNode)({
        id: `${run.id}:commit-gate-failed:${createCommitId()}`,
        kind: "error",
        status: "pending",
        loopStage: "checkpoint",
        inputs: {
            reason: options.reason,
            verifierNodeId: gate.verifierNodeId,
            candidateId: gate.candidateId,
            selectionId: gate.selectionId
        },
        evidence: gate.evidence,
        contractId: pipeline_contract_1.DEFAULT_PIPELINE_CONTRACT_ID,
        metadata: {
            ...(options.metadata || {}),
            verifierGated: true,
            checkpoint: false,
            failureCount: gate.errors.length,
            failures: gate.errors.map((entry) => ({ code: entry.code, message: entry.message, nodeId: entry.nodeId })),
            gate: gate.metadata
        }
    }), first);
    const persisted = (0, state_node_1.appendRunNode)(run, node);
    for (const parentId of [gate.selectionNodeId, gate.verifierNodeId].filter(Boolean)) {
        linkAdditionalParent(run, parentId, persisted.id);
    }
    const feedback = (0, error_feedback_1.recordFeedback)(run, {
        source: options.source === "cli" ? "cli" : "verifier",
        error: first,
        nodeId: persisted.id,
        stageId: "commit",
        contractId: pipeline_contract_1.DEFAULT_PIPELINE_CONTRACT_ID,
        retryable: false,
        evidence: gate.evidence,
        artifacts: [],
        metadata: {
            reason: options.reason,
            verifierNodeId: gate.verifierNodeId,
            candidateId: gate.candidateId,
            selectionId: gate.selectionId,
            failures: gate.errors.map((entry) => ({ code: entry.code, message: entry.message, nodeId: entry.nodeId }))
        }
    }, { persist: false });
    return new CommitGateError(first, { feedbackId: feedback.id, stateNodeId: persisted.id });
}
function linkAdditionalParent(run, parentId, childId) {
    const parent = findNode(run, parentId);
    const child = findNode(run, childId);
    if (!parent || !child)
        return;
    const [linkedParent, linkedChild] = (0, state_node_1.linkStateNodes)(parent, child);
    (0, state_node_1.appendRunNode)(run, linkedParent);
    (0, state_node_1.appendRunNode)(run, linkedChild);
}
function taskVerifierFromReason(run, reason) {
    const taskId = reason.startsWith("result:") ? reason.slice("result:".length) : "";
    if (!taskId)
        return undefined;
    return run.tasks.find((task) => task.id === taskId)?.verifierNodeId;
}
function resolveLinkedVerifier(requested, linked, errors, ownerKind, ownerId) {
    if (requested && linked && requested !== linked) {
        errors.push(error("commit-verifier-linkage-mismatch", `Requested verifier ${requested} is not linked to ${ownerKind} ${ownerId}`, {
            details: { requestedVerifierNodeId: requested, linkedVerifierNodeId: linked, ownerKind, ownerId }
        }));
        return requested;
    }
    return requested || linked;
}
function latestSelectionForCandidate(run, candidateId) {
    return [...(run.candidateSelections || [])]
        .filter((selection) => selection.candidateId === candidateId)
        .sort((left, right) => right.selectedAt.localeCompare(left.selectedAt))[0];
}
function findSelection(run, selectionId) {
    return (run.candidateSelections || []).find((selection) => selection.id === selectionId);
}
function findSelectionNode(run, selectionId) {
    return (run.nodes || []).find((node) => node.kind === "candidate" && node.metadata?.selectionId === selectionId);
}
function findCandidate(run, candidateId) {
    return (run.candidates || []).find((candidate) => candidate.id === candidateId);
}
function findScore(run, candidateId, scoreId) {
    const file = node_path_1.default.join(run.paths.candidatesDir || node_path_1.default.join(run.paths.runDir, "candidates"), (0, state_1.safeFileName)(candidateId), "scores", `${(0, state_1.safeFileName)(scoreId)}.json`);
    if (!node_fs_1.default.existsSync(file))
        return undefined;
    try {
        return JSON.parse(node_fs_1.default.readFileSync(file, "utf8"));
    }
    catch {
        return undefined;
    }
}
function sandboxProfileForCandidate(run, candidate) {
    const worker = candidate?.workerId ? (run.workers || []).find((entry) => entry.id === candidate.workerId) : undefined;
    if (worker?.sandboxProfileId)
        return worker.sandboxProfileId;
    const task = candidate?.taskId ? (run.tasks || []).find((entry) => entry.id === candidate.taskId) : undefined;
    return task?.sandboxProfileId;
}
function findNode(run, nodeId) {
    return (run.nodes || []).find((node) => node.id === nodeId);
}
function error(code, message, options = {}) {
    return {
        code,
        message,
        at: new Date().toISOString(),
        retryable: false,
        ...options
    };
}
function createCommitId() {
    const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\..+/, "Z");
    return `state-${stamp}-${(0, state_1.safeFileName)(Math.random().toString(36).slice(2, 8))}`;
}
function readGitHead(cwd) {
    try {
        return (0, node_child_process_1.execFileSync)("git", ["rev-parse", "HEAD"], {
            cwd,
            encoding: "utf8",
            stdio: ["ignore", "pipe", "ignore"]
        }).trim();
    }
    catch {
        return undefined;
    }
}
