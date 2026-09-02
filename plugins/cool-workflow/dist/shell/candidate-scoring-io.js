"use strict";
// shell/candidate-scoring-io.ts — the impure wrapper around
// core/multi-agent/candidate-scoring.ts's pure decision math:
// registerCandidate/scoreCandidate/rankCandidates/selectCandidate/
// rejectCandidate/summarizeCandidates.
//
// MILESTONE 9. Byte-exact port of the impure half of the old build's
// candidate-scoring module: disk reads/writes, trust-audit calls,
// feedback recording, review-gate stacking, and saveCheckpoint.
//
// BYTE-COMPAT / REBUILD RISK 8 [load-bearing]: the review gate STACKS on
// top of the verifier-gate failures built here — reviewGateErrors is
// appended, never replacing a verifier error. See
// reviewstack-verifier-error-precedence.case.js.
//
// Evidence: SPEC/multi-agent.md section E; the old build's
// candidate-scoring module (byte-exact source for the wiring sequence).
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
exports.getCandidate = getCandidate;
exports.listCandidates = listCandidates;
exports.registerCandidate = registerCandidate;
exports.scoreCandidate = scoreCandidate;
exports.rankCandidates = rankCandidates;
exports.selectCandidate = selectCandidate;
exports.rejectCandidate = rejectCandidate;
exports.summarizeCandidates = summarizeCandidates;
const fs = __importStar(require("node:fs"));
const path = __importStar(require("node:path"));
const fs_atomic_1 = require("./fs-atomic");
const run_store_1 = require("./run-store");
const node_store_1 = require("./node-store");
const state_node_1 = require("../core/state/state-node");
const trust_audit_1 = require("./trust-audit");
const error_feedback_io_1 = require("./error-feedback-io");
const cs = __importStar(require("../core/multi-agent/candidate-scoring"));
const result_normalize_1 = require("../core/pipeline/result-normalize");
const collaboration_1 = require("../core/multi-agent/collaboration");
const collaboration_io_1 = require("./collaboration-io");
function now() {
    return new Date().toISOString();
}
function ensureCandidateState(run) {
    run.paths.candidatesDir = run.paths.candidatesDir || path.join(run.paths.runDir, "candidates");
    fs.mkdirSync(run.paths.candidatesDir, { recursive: true });
    run.candidates = run.candidates || [];
    run.candidateSelections = run.candidateSelections || [];
}
function candidateRoot(run) {
    ensureCandidateState(run);
    return run.paths.candidatesDir;
}
function candidateDir(run, candidateId) {
    return path.join(candidateRoot(run), (0, fs_atomic_1.safeFileName)(candidateId));
}
function candidateFile(run, candidateId) {
    return path.join(candidateDir(run, candidateId), "candidate.json");
}
function indexPath(run) {
    return path.join(candidateRoot(run), "index.json");
}
function rankingPath(run) {
    return path.join(candidateRoot(run), "ranking.json");
}
function writeCandidate(run, candidate) {
    (0, fs_atomic_1.writeJson)(candidateFile(run, candidate.id), candidate);
}
function writeScoreFile(run, candidateId, score) {
    (0, fs_atomic_1.writeJson)(path.join(candidateDir(run, candidateId), "scores", `${(0, fs_atomic_1.safeFileName)(score.id)}.json`), score);
}
function writeSelectionFile(run, selection) {
    (0, fs_atomic_1.writeJson)(path.join(candidateRoot(run), "selections", `${(0, fs_atomic_1.safeFileName)(selection.id)}.json`), selection);
}
function writeCandidateIndex(run) {
    ensureCandidateState(run);
    (0, fs_atomic_1.writeJson)(indexPath(run), {
        schemaVersion: cs.CANDIDATE_SCHEMA_VERSION,
        runId: run.id,
        candidates: (run.candidates || []).map((candidate) => ({ id: candidate.id, kind: candidate.kind, status: candidate.status, workerId: candidate.workerId, taskId: candidate.taskId, resultNodeId: candidate.resultNodeId, verifierNodeId: candidate.verifierNodeId, resultPath: candidate.resultPath, scores: candidate.scores, feedbackIds: candidate.feedbackIds })),
        selections: run.candidateSelections || [],
    });
}
function upsertCandidate(run, candidate) {
    ensureCandidateState(run);
    const candidates = run.candidates || [];
    const index = candidates.findIndex((entry) => entry.id === candidate.id);
    run.candidates = (index >= 0 ? candidates.map((entry) => (entry.id === candidate.id ? candidate : entry)) : [...candidates, candidate]);
    writeCandidate(run, candidate);
    writeCandidateIndex(run);
    return candidate;
}
function loadCandidatesFromDisk(run) {
    ensureCandidateState(run);
    const root = candidateRoot(run);
    if (!fs.existsSync(root))
        return [];
    return fs
        .readdirSync(root, { withFileTypes: true })
        .filter((entry) => entry.isDirectory() && entry.name !== "selections")
        .map((entry) => path.join(root, entry.name, "candidate.json"))
        .filter((file) => fs.existsSync(file))
        .map((file) => (0, fs_atomic_1.readJson)(file));
}
function mergeCandidates(left, right) {
    const merged = [...left];
    for (const candidate of right) {
        const index = merged.findIndex((entry) => entry.id === candidate.id);
        if (index >= 0)
            merged[index] = candidate;
        else
            merged.push(candidate);
    }
    return merged;
}
function getCandidate(run, candidateId) {
    ensureCandidateState(run);
    const existing = (run.candidates || []).find((candidate) => candidate.id === candidateId);
    if (existing)
        return existing;
    const file = candidateFile(run, candidateId);
    if (!fs.existsSync(file))
        return undefined;
    const candidate = (0, fs_atomic_1.readJson)(file);
    upsertCandidate(run, candidate);
    return candidate;
}
function requireCandidate(run, candidateId) {
    const candidate = getCandidate(run, candidateId);
    if (!candidate)
        throw new Error(`Unknown candidate for run ${run.id}: ${candidateId}`);
    return candidate;
}
function listCandidates(run, options = {}) {
    ensureCandidateState(run);
    const loaded = loadCandidatesFromDisk(run);
    run.candidates = mergeCandidates(run.candidates || [], loaded);
    return (run.candidates || []).filter((candidate) => {
        if (options.status && candidate.status !== options.status)
            return false;
        if (options.kind && candidate.kind !== options.kind)
            return false;
        return true;
    });
}
function candidateArtifacts(run, candidate) {
    return [{ id: "candidate", kind: "json", path: candidateFile(run, candidate.id) }, ...candidate.artifacts];
}
function appendCandidateNode(run, candidate, stage, score) {
    const parents = [candidate.resultNodeId, candidate.verifierNodeId].filter(Boolean);
    const outputs = {};
    if (candidate.status !== undefined)
        outputs.status = candidate.status;
    if (score?.id !== undefined)
        outputs.scoreId = score.id;
    if (score?.normalized !== undefined)
        outputs.normalized = score.normalized;
    if (score?.verdict !== undefined)
        outputs.verdict = score.verdict;
    const node = (0, node_store_1.appendRunNode)(run, (0, state_node_1.createStateNode)({
        id: `${run.id}:candidate:${(0, fs_atomic_1.safeFileName)(candidate.id)}:${stage}`,
        kind: "candidate",
        status: candidate.status === "failed" ? "failed" : candidate.status === "verified" ? "verified" : "completed",
        loopStage: stage === "registered" ? "observe" : "adjust",
        inputs: { candidateId: candidate.id, workerId: candidate.workerId, taskId: candidate.taskId },
        outputs,
        artifacts: candidateArtifacts(run, candidate),
        evidence: candidate.evidence,
        parents,
        metadata: { candidateId: candidate.id, stage, kind: candidate.kind },
    }));
    for (const parentId of parents) {
        const parent = (run.nodes || []).find((candidateNode) => candidateNode.id === parentId);
        if (!parent)
            continue;
        const linked = (0, state_node_1.linkStateNodes)(parent, node);
        (0, node_store_1.appendRunNode)(run, linked[0]);
        (0, node_store_1.appendRunNode)(run, linked[1]);
    }
}
function appendSelectionNode(run, candidate, selection) {
    const parentIds = [candidate.verifierNodeId, `${run.id}:candidate:${(0, fs_atomic_1.safeFileName)(candidate.id)}:scored`].filter(Boolean);
    const node = (0, node_store_1.appendRunNode)(run, (0, state_node_1.createStateNode)({
        id: `${run.id}:candidate:${(0, fs_atomic_1.safeFileName)(candidate.id)}:selection:${(0, fs_atomic_1.safeFileName)(selection.id)}`,
        kind: "candidate",
        status: candidate.status === "verified" ? "verified" : "completed",
        loopStage: "adjust",
        inputs: { candidateId: candidate.id, selectionId: selection.id },
        outputs: selection,
        artifacts: selection.artifacts,
        evidence: selection.evidence,
        parents: parentIds,
        metadata: { candidateId: candidate.id, selectionId: selection.id, selected: true },
    }));
    for (const parentId of parentIds) {
        const parent = (run.nodes || []).find((candidateNode) => candidateNode.id === parentId);
        if (!parent)
            continue;
        const linked = (0, state_node_1.linkStateNodes)(parent, node);
        (0, node_store_1.appendRunNode)(run, linked[0]);
        (0, node_store_1.appendRunNode)(run, linked[1]);
    }
}
function recordCandidateFailure(run, candidate, code, options) {
    return (0, error_feedback_io_1.recordFeedback)(run, {
        source: "verifier",
        error: { code, message: options.message, at: now(), retryable: options.retryable, details: { ...(options.details || {}), candidateId: candidate.id, workerId: candidate.workerId, taskId: candidate.taskId } },
        taskId: candidate.taskId,
        retryable: options.retryable,
        evidence: candidate.evidence,
        artifacts: candidateArtifacts(run, candidate),
        metadata: { candidateId: candidate.id, workerId: candidate.workerId, resultNodeId: candidate.resultNodeId },
    }, { persist: false });
}
function artifactsFromInput(input) {
    const artifacts = [];
    if (input.resultPath)
        artifacts.push({ id: "result", kind: "markdown", path: path.resolve(input.resultPath) });
    return artifacts;
}
function evidenceFromInput(run, input) {
    const resultNode = input.resultNodeId ? (run.nodes || []).find((node) => node.id === input.resultNodeId) : undefined;
    const verifierNode = input.verifierNodeId ? (run.nodes || []).find((node) => node.id === input.verifierNodeId) : undefined;
    return cs.mergeById(resultNode?.evidence || [], verifierNode?.evidence || []);
}
function registerCandidate(run, input, options = {}) {
    ensureCandidateState(run);
    const existing = input.id ? getCandidate(run, input.id) : undefined;
    if (existing)
        return existing;
    const stamp = now();
    const id = input.id || cs.createCandidateId((run.candidates || []).length, input.kind || "manual", input.workerId || input.taskId || input.resultNodeId);
    const candidate = {
        schemaVersion: cs.CANDIDATE_SCHEMA_VERSION,
        id,
        runId: run.id,
        kind: input.kind || cs.inferCandidateKind(input),
        status: "registered",
        createdAt: stamp,
        updatedAt: stamp,
        workerId: input.workerId,
        taskId: input.taskId,
        resultNodeId: input.resultNodeId,
        verifierNodeId: input.verifierNodeId,
        resultPath: input.resultPath,
        artifacts: input.artifacts || artifactsFromInput(input),
        evidence: (0, trust_audit_1.normalizeEvidence)(run, input.evidence || evidenceFromInput(run, input), { source: input.workerId ? "cw-validated" : "operator-recorded", workerId: input.workerId, taskId: input.taskId, resultNodeId: input.resultNodeId, verifierNodeId: input.verifierNodeId, candidateId: id }),
        scores: [],
        feedbackIds: [],
        metadata: compactMetadata(input.metadata || {}),
    };
    upsertCandidate(run, candidate);
    (0, trust_audit_1.recordTrustAuditEvent)(run, { kind: "candidate.register", decision: "recorded", source: input.workerId ? "cw-validated" : "operator-recorded", workerId: input.workerId, taskId: input.taskId, nodeId: input.resultNodeId, candidateId: candidate.id, evidence: candidate.evidence, metadata: { kind: candidate.kind, verifierNodeId: candidate.verifierNodeId } });
    appendCandidateNode(run, candidate, "registered");
    if (options.persist !== false)
        (0, run_store_1.saveCheckpoint)(run);
    return candidate;
}
function compactMetadata(value) {
    const entries = Object.entries(value).filter(([, entry]) => entry !== undefined);
    return entries.length ? Object.fromEntries(entries) : undefined;
}
function scoreCandidate(run, candidateId, input, options = {}) {
    const candidate = requireCandidate(run, candidateId);
    const scoreId = input.id || cs.createScoreId(candidate);
    const evidence = (0, trust_audit_1.normalizeEvidence)(run, input.evidence || [], { source: "operator-recorded", candidateId, scoreId });
    const policy = cs.mergePolicy(options.policy);
    if (policy.requireEvidence && !evidence.length) {
        const feedback = recordCandidateFailure(run, candidate, "candidate-score-missing-evidence", { message: `Candidate ${candidateId} score requires evidence`, retryable: true });
        upsertCandidate(run, { ...candidate, updatedAt: now(), status: "failed", feedbackIds: cs.unique([...(candidate.feedbackIds || []), feedback.id]) });
        throw new Error(`Candidate ${candidateId} score requires evidence`);
    }
    const math = cs.computeScoreMath(input.criteria, input.maxTotal, policy, input.verdict);
    const score = {
        schemaVersion: cs.CANDIDATE_SCHEMA_VERSION,
        id: scoreId,
        candidateId,
        runId: run.id,
        createdAt: now(),
        scorer: input.scorer || "operator",
        criteria: input.criteria,
        total: math.total,
        maxTotal: math.maxTotal,
        normalized: math.normalized,
        verdict: math.verdict,
        evidence,
        artifacts: input.artifacts || [],
        notes: input.notes,
        metadata: compactMetadata(input.metadata || {}),
    };
    writeScoreFile(run, candidateId, score);
    const updated = upsertCandidate(run, { ...candidate, updatedAt: now(), status: score.verdict === "fail" ? "failed" : "scored", scores: cs.unique([...(candidate.scores || []), score.id]), evidence: cs.mergeById(candidate.evidence, evidence), artifacts: cs.mergeById(candidate.artifacts, score.artifacts) });
    const scoreAudit = (0, trust_audit_1.recordTrustAuditEvent)(run, { kind: "candidate.score", decision: score.verdict === "fail" ? "rejected" : "accepted", source: "operator-recorded", candidateId, scoreId: score.id, workerId: candidate.workerId, taskId: candidate.taskId, nodeId: candidate.verifierNodeId || candidate.resultNodeId, evidence: score.evidence, metadata: { criteria: score.criteria, normalized: score.normalized, verdict: score.verdict } });
    score.evidence = (0, trust_audit_1.normalizeEvidence)(run, score.evidence, { source: "operator-recorded", candidateId, scoreId: score.id, auditEventIds: [scoreAudit.id] });
    writeScoreFile(run, candidateId, score);
    appendCandidateNode(run, updated, "scored", score);
    writeCandidateIndex(run);
    if (options.persist !== false)
        (0, run_store_1.saveCheckpoint)(run);
    return score;
}
function readScores(run, candidateId) {
    const dir = path.join(candidateDir(run, candidateId), "scores");
    if (!fs.existsSync(dir))
        return [];
    return fs
        .readdirSync(dir)
        .filter((file) => file.endsWith(".json"))
        .sort()
        .map((file) => (0, fs_atomic_1.readJson)(path.join(dir, file)));
}
function rankCandidates(run, options = {}) {
    const policy = cs.mergePolicy(options.policy);
    const rankable = listCandidates(run);
    const ranking = cs.rankCandidateRows(run.id, now(), rankable, (id) => readScores(run, id), policy, Boolean(options.includeRejected));
    (0, fs_atomic_1.writeJson)(rankingPath(run), ranking);
    return ranking;
}
function sandboxProfileForCandidate(run, candidate) {
    const worker = candidate?.workerId ? (run.workers || []).find((entry) => entry.id === candidate.workerId) : undefined;
    if (worker?.sandboxProfileId)
        return worker.sandboxProfileId;
    const task = candidate?.taskId ? run.tasks.find((entry) => entry.id === candidate.taskId) : undefined;
    return task?.sandboxProfileId;
}
function buildAcceptanceRationale(input) {
    return {
        schemaVersion: 1,
        selectedCandidateId: input.selectedCandidateId,
        scoreId: input.scoreId,
        scoreCriteria: input.scoreCriteria,
        verifierNodeId: input.verifierNodeId,
        evidenceCount: input.evidenceCount || 0,
        sandboxProfileId: input.sandboxProfileId,
        workerId: input.workerId,
        commitGateResult: input.commitGateResult,
        auditEventIds: cs.unique(input.auditEventIds || []).sort(),
    };
}
/** Whether the verifier node's backing result was an empty capture: walk
 *  from the verifier node id (`<runId>:verifier:<taskId>`) to the task
 *  and its recorded result envelope. */
function verifierIsEmptyCapture(run, verifierNodeId) {
    if (!verifierNodeId)
        return false;
    const marker = ":verifier:";
    const idx = verifierNodeId.indexOf(marker);
    const taskId = idx >= 0 ? verifierNodeId.slice(idx + marker.length) : undefined;
    const task = taskId ? run.tasks.find((t) => t.id === taskId) : undefined;
    const result = task?.result;
    return result ? (0, result_normalize_1.isEmptyCapture)(result) : false;
}
function selectCandidate(run, candidateId, options = {}, scoringOptions = {}) {
    const candidate = requireCandidate(run, candidateId);
    const policy = cs.mergePolicy(scoringOptions.policy);
    const ranking = rankCandidates(run, { policy });
    const ranked = ranking.candidates.find((entry) => entry.candidateId === candidateId);
    const verifierNode = candidate.verifierNodeId ? (run.nodes || []).find((node) => node.id === candidate.verifierNodeId) : undefined;
    const bestScoreRecord = options.scoreId ? readScores(run, candidateId).find((score) => score.id === options.scoreId) : readScores(run, candidateId).find((score) => score.id === ranked?.bestScoreId);
    const failures = cs.selectionGateFailures({
        candidateId,
        candidateStatus: candidate.status,
        policy,
        allowUnverified: options.allowUnverified,
        verifierNode,
        verifierNodeIsEmptyCapture: verifierNode ? verifierIsEmptyCapture(run, candidate.verifierNodeId) : false,
        bestScoreNormalized: bestScoreRecord?.normalized,
    }, now());
    // REVIEW GATE — layered on top, never replacing the verifier failures above.
    const collaborationState = (0, collaboration_io_1.ensureCollaborationState)(run);
    const approvals = (collaborationState.approvals || []);
    const reviewPolicy = collaborationState.policy;
    const selfIds = (0, collaboration_1.selfActorIdsForCandidate)(candidate.workerId, (run.candidateSelections || []).filter((s) => s.candidateId === candidateId).map((s) => s.selectedBy).filter((x) => Boolean(x)));
    for (const reviewError of (0, collaboration_1.reviewGateErrors)(run.id, approvals, { targetKind: "selection", candidateId, selfActorIds: selfIds, policy: reviewPolicy }, now())) {
        failures.push(reviewError);
    }
    if (failures.length) {
        const feedbackIds = failures.map((failure) => recordCandidateFailure(run, candidate, failure.code, { message: failure.message, retryable: false, details: failure.details }).id);
        upsertCandidate(run, { ...candidate, updatedAt: now(), status: "failed", feedbackIds: cs.unique([...(candidate.feedbackIds || []), ...feedbackIds]) });
        if (scoringOptions.persist !== false)
            (0, run_store_1.saveCheckpoint)(run);
        throw new Error(failures.map((failure) => failure.message).join("; "));
    }
    const stamp = now();
    const selectionId = cs.createSelectionId((run.candidateSelections || []).length, candidateId);
    const evidence = (0, trust_audit_1.normalizeEvidence)(run, cs.mergeEvidence(candidate.evidence, verifierNode?.evidence || []), { source: "cw-validated", workerId: candidate.workerId, taskId: candidate.taskId, resultNodeId: candidate.resultNodeId, verifierNodeId: candidate.verifierNodeId, candidateId, scoreId: bestScoreRecord?.id });
    const selection = {
        schemaVersion: cs.CANDIDATE_SCHEMA_VERSION,
        id: selectionId,
        runId: run.id,
        candidateId,
        selectedAt: stamp,
        selectedBy: options.selectedBy || "operator",
        verifierNodeId: candidate.verifierNodeId,
        scoreId: bestScoreRecord?.id,
        rankingPath: options.rankingPath || rankingPath(run),
        reason: options.reason || "selected candidate",
        evidence,
        artifacts: candidate.artifacts,
        feedbackIds: [],
        acceptanceRationale: buildAcceptanceRationale({ selectedCandidateId: candidateId, scoreId: bestScoreRecord?.id, scoreCriteria: bestScoreRecord?.criteria, verifierNodeId: candidate.verifierNodeId, evidenceCount: evidence.length, sandboxProfileId: sandboxProfileForCandidate(run, candidate), workerId: candidate.workerId, commitGateResult: "passed" }),
        metadata: compactMetadata({ ...(options.metadata || {}), rank: ranked?.rank, normalized: bestScoreRecord?.normalized }),
    };
    const selectionAudit = (0, trust_audit_1.recordTrustAuditEvent)(run, { kind: "candidate.selection", decision: "accepted", source: "cw-validated", workerId: candidate.workerId, taskId: candidate.taskId, nodeId: candidate.verifierNodeId, candidateId, scoreId: bestScoreRecord?.id, selectionId: selection.id, sandboxProfileId: selection.acceptanceRationale?.sandboxProfileId, evidence: selection.evidence, metadata: selection.acceptanceRationale });
    selection.evidence = (0, trust_audit_1.normalizeEvidence)(run, selection.evidence, { source: "cw-validated", workerId: candidate.workerId, taskId: candidate.taskId, resultNodeId: candidate.resultNodeId, verifierNodeId: candidate.verifierNodeId, candidateId, scoreId: bestScoreRecord?.id, selectionId: selection.id, auditEventIds: [selectionAudit.id] });
    selection.acceptanceRationale = buildAcceptanceRationale({ ...selection.acceptanceRationale, auditEventIds: [selectionAudit.id] });
    run.candidateSelections = [...(run.candidateSelections || []), selection];
    writeSelectionFile(run, selection);
    const updated = upsertCandidate(run, { ...candidate, updatedAt: stamp, status: verifierNode?.status === "verified" ? "verified" : "selected", selectedAt: stamp, evidence: selection.evidence });
    appendSelectionNode(run, updated, selection);
    writeCandidateIndex(run);
    if (scoringOptions.persist !== false)
        (0, run_store_1.saveCheckpoint)(run);
    return selection;
}
function rejectCandidate(run, candidateId, reason, options = {}) {
    const candidate = requireCandidate(run, candidateId);
    const feedback = recordCandidateFailure(run, candidate, "candidate-rejected", { message: reason || `Candidate ${candidateId} rejected`, retryable: false });
    const updated = upsertCandidate(run, { ...candidate, updatedAt: now(), status: "rejected", rejectedAt: now(), feedbackIds: cs.unique([...(candidate.feedbackIds || []), feedback.id]) });
    appendCandidateNode(run, updated, "rejected");
    if (options.persist !== false)
        (0, run_store_1.saveCheckpoint)(run);
    return updated;
}
function summarizeCandidates(run) {
    const candidates = listCandidates(run);
    return { total: candidates.length, byStatus: cs.countBy(candidates, (candidate) => candidate.status), byKind: cs.countBy(candidates, (candidate) => candidate.kind), indexPath: indexPath(run), rankingPath: rankingPath(run), selections: (run.candidateSelections || []).length };
}
