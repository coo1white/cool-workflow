"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.CANDIDATE_SCHEMA_VERSION = void 0;
exports.createCandidateScoring = createCandidateScoring;
exports.registerCandidate = registerCandidate;
exports.listCandidates = listCandidates;
exports.getCandidate = getCandidate;
exports.scoreCandidate = scoreCandidate;
exports.rankCandidates = rankCandidates;
exports.selectCandidate = selectCandidate;
exports.rejectCandidate = rejectCandidate;
exports.summarizeCandidates = summarizeCandidates;
const node_fs_1 = __importDefault(require("node:fs"));
const node_path_1 = __importDefault(require("node:path"));
const error_feedback_1 = require("./error-feedback");
const state_1 = require("./state");
const state_node_1 = require("./state-node");
const trust_audit_1 = require("./trust-audit");
const collaboration_1 = require("./collaboration");
const compare_1 = require("./compare");
const gates_1 = require("./gates");
const validation_1 = require("./validation");
exports.CANDIDATE_SCHEMA_VERSION = 1;
/** Verdict thresholds on a score's normalized value [0,1], declared once so the
 *  numbers carry intent instead of being buried as literals in verdictFor(). A
 *  normalized score at-or-above PASS is "pass"; at-or-above WARN (but below
 *  PASS) is "warn"; anything lower is "fail". Same numbers as before. */
const VERDICT_PASS_THRESHOLD = 0.7;
const VERDICT_WARN_THRESHOLD = 0.4;
function createCandidateScoring(options = {}) {
    return {
        registerCandidate: (run, input) => registerCandidate(run, input, options),
        listCandidates: (run, listOptions) => listCandidates(run, listOptions),
        getCandidate,
        scoreCandidate: (run, candidateId, input) => scoreCandidate(run, candidateId, input, options),
        rankCandidates,
        selectCandidate: (run, candidateId, selectOptions) => selectCandidate(run, candidateId, selectOptions, options),
        rejectCandidate: (run, candidateId, reason) => rejectCandidate(run, candidateId, reason, options),
        summarizeCandidates
    };
}
function registerCandidate(run, input, options = {}) {
    ensureCandidateState(run);
    const existing = input.id ? getCandidate(run, input.id) : undefined;
    if (existing)
        return existing;
    const now = new Date().toISOString();
    const id = input.id || createCandidateId(run, input.kind || "manual", input.workerId || input.taskId || input.resultNodeId);
    const candidate = {
        schemaVersion: exports.CANDIDATE_SCHEMA_VERSION,
        id,
        runId: run.id,
        kind: input.kind || inferCandidateKind(input),
        status: "registered",
        createdAt: now,
        updatedAt: now,
        workerId: input.workerId,
        taskId: input.taskId,
        resultNodeId: input.resultNodeId,
        verifierNodeId: input.verifierNodeId,
        resultPath: input.resultPath,
        artifacts: input.artifacts || artifactsFromInput(input),
        evidence: (0, trust_audit_1.normalizeEvidence)(run, input.evidence || evidenceFromInput(run, input), {
            source: input.workerId ? "cw-validated" : "operator-recorded",
            workerId: input.workerId,
            taskId: input.taskId,
            resultNodeId: input.resultNodeId,
            verifierNodeId: input.verifierNodeId,
            candidateId: id
        }),
        scores: [],
        feedbackIds: [],
        metadata: compactMetadata(input.metadata || {})
    };
    upsertCandidate(run, candidate);
    (0, trust_audit_1.recordTrustAuditEvent)(run, {
        kind: "candidate.register",
        decision: "recorded",
        source: input.workerId ? "cw-validated" : "operator-recorded",
        workerId: input.workerId,
        taskId: input.taskId,
        nodeId: input.resultNodeId,
        candidateId: candidate.id,
        evidence: candidate.evidence,
        metadata: { kind: candidate.kind, verifierNodeId: candidate.verifierNodeId }
    });
    appendCandidateNode(run, candidate, "registered");
    if (shouldPersist(options))
        (0, state_1.saveCheckpoint)(run);
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
function getCandidate(run, candidateId) {
    ensureCandidateState(run);
    const existing = (run.candidates || []).find((candidate) => candidate.id === candidateId);
    if (existing)
        return existing;
    const file = candidateFile(run, candidateId);
    if (!node_fs_1.default.existsSync(file))
        return undefined;
    // Fail-closed integrity boundary (F4/F5): validate the parsed record against
    // its type def BEFORE upserting it as a trusted CandidateRecord. A corrupt or
    // forged candidate.json must throw here rather than flow into the run.
    const candidate = (0, validation_1.validateCandidateRecord)((0, state_1.readJson)(file));
    upsertCandidate(run, candidate);
    return candidate;
}
function scoreCandidate(run, candidateId, input, options = {}) {
    const candidate = requireCandidate(run, candidateId);
    const scoreId = input.id || createScoreId(candidate);
    const evidence = (0, trust_audit_1.normalizeEvidence)(run, input.evidence || [], {
        source: "operator-recorded",
        candidateId,
        scoreId
    });
    const policy = mergePolicy(options.policy);
    if (policy.requireEvidence && !evidence.length) {
        const feedback = recordCandidateFailure(run, candidate, "candidate-score-missing-evidence", {
            message: `Candidate ${candidateId} score requires evidence`,
            retryable: true
        });
        updateCandidate(run, {
            ...candidate,
            updatedAt: new Date().toISOString(),
            status: "failed",
            feedbackIds: unique([...(candidate.feedbackIds || []), feedback.id])
        });
        throw new Error(`Candidate ${candidateId} score requires evidence`);
    }
    const total = sumCriteria(input.criteria);
    const maxTotal = input.maxTotal ?? Math.max(total, 1);
    const normalized = maxTotal > 0 ? clamp(total / maxTotal, 0, 1) : 0;
    const score = {
        schemaVersion: exports.CANDIDATE_SCHEMA_VERSION,
        id: scoreId,
        candidateId,
        runId: run.id,
        createdAt: new Date().toISOString(),
        scorer: input.scorer || "operator",
        criteria: input.criteria,
        total,
        maxTotal,
        normalized,
        verdict: input.verdict || verdictFor(normalized, policy),
        evidence,
        artifacts: input.artifacts || [],
        notes: input.notes,
        metadata: compactMetadata(input.metadata || {})
    };
    writeScore(run, candidateId, score);
    const updated = updateCandidate(run, {
        ...candidate,
        updatedAt: new Date().toISOString(),
        status: score.verdict === "fail" ? "failed" : "scored",
        scores: unique([...(candidate.scores || []), score.id]),
        evidence: mergeById(candidate.evidence, evidence),
        artifacts: mergeById(candidate.artifacts, score.artifacts)
    });
    const scoreAudit = (0, trust_audit_1.recordTrustAuditEvent)(run, {
        kind: "candidate.score",
        decision: score.verdict === "fail" ? "rejected" : "accepted",
        source: "operator-recorded",
        candidateId,
        scoreId: score.id,
        workerId: candidate.workerId,
        taskId: candidate.taskId,
        nodeId: candidate.verifierNodeId || candidate.resultNodeId,
        evidence: score.evidence,
        metadata: { criteria: score.criteria, normalized: score.normalized, verdict: score.verdict }
    });
    score.evidence = (0, trust_audit_1.normalizeEvidence)(run, score.evidence, {
        source: "operator-recorded",
        candidateId,
        scoreId: score.id,
        auditEventIds: [scoreAudit.id]
    });
    writeScore(run, candidateId, score);
    appendCandidateNode(run, updated, "scored", score);
    writeCandidateIndex(run);
    if (shouldPersist(options))
        (0, state_1.saveCheckpoint)(run);
    return score;
}
function rankCandidates(run, options = {}) {
    const policy = mergePolicy(options.policy);
    const rankable = listCandidates(run).filter((candidate) => options.includeRejected || candidate.status !== "rejected");
    const rows = rankable.map((candidate) => {
        const scores = readScores(run, candidate.id);
        const best = bestScore(scores);
        return {
            candidate,
            best,
            normalized: best?.normalized ?? 0
        };
    });
    rows.sort((left, right) => compareRows(left, right, policy));
    const candidates = rows.map((row, index) => ({
        candidateId: row.candidate.id,
        status: row.candidate.status,
        scoreCount: row.candidate.scores.length,
        bestScoreId: row.best?.id,
        normalized: row.normalized,
        verdict: row.best?.verdict,
        rank: index + 1
    }));
    const ranking = {
        schemaVersion: exports.CANDIDATE_SCHEMA_VERSION,
        runId: run.id,
        createdAt: new Date().toISOString(),
        policy,
        candidates,
        ties: detectTies(candidates)
    };
    (0, state_1.writeJson)(rankingPath(run), ranking);
    return ranking;
}
function selectCandidate(run, candidateId, options = {}, scoringOptions = {}) {
    const candidate = requireCandidate(run, candidateId);
    const policy = mergePolicy(scoringOptions.policy);
    const ranking = rankCandidates(run, { policy });
    const ranked = ranking.candidates.find((entry) => entry.candidateId === candidateId);
    const verifierNode = candidate.verifierNodeId
        ? run.nodes?.find((node) => node.id === candidate.verifierNodeId)
        : undefined;
    const bestScore = options.scoreId
        ? readScores(run, candidateId).find((score) => score.id === options.scoreId)
        : readScores(run, candidateId).find((score) => score.id === ranked?.bestScoreId);
    const failures = [];
    if (candidate.status === "rejected" || candidate.status === "failed") {
        failures.push(error("candidate-not-selectable", `Candidate ${candidateId} is ${candidate.status}`));
    }
    if (policy.requireVerifierGate && !options.allowUnverified) {
        if (!verifierNode || verifierNode.status !== "verified") {
            failures.push(error("candidate-selection-missing-verifier", `Candidate ${candidateId} requires a verified verifier node`));
        }
        else if (!verifierNode.evidence.length) {
            failures.push(error("candidate-selection-missing-evidence", `Candidate ${candidateId} verifier node has no evidence`));
        }
        else if ((0, gates_1.emptyCaptureWarning)(run, verifierNode)) {
            // HARD no-false-green gate (v0.1.43) — selection and the commit gate now
            // share ONE emptyCaptureWarning (src/gates.ts), so they CANNOT drift: a
            // verifier node whose backing result was an empty-capture is unselectable
            // here for the same reason it is uncommittable, by construction.
            failures.push(error("candidate-selection-empty-capture", `Candidate ${candidateId} verifier node has no real evidence (empty-capture result)`));
        }
    }
    if (policy.minNormalized !== undefined && (bestScore?.normalized ?? 0) < policy.minNormalized) {
        failures.push(error("candidate-selection-score-below-threshold", `Candidate ${candidateId} score is below threshold`, {
            details: { normalized: bestScore?.normalized ?? 0, minNormalized: policy.minNormalized }
        }));
    }
    // REVIEW GATE on selection — POLICY layered on the verifier gate above, never
    // replacing it. Empty unless a review policy applies to "selection"; fails
    // closed when required approvals from authorized roles are missing.
    for (const reviewError of (0, collaboration_1.reviewGateErrors)(run, {
        targetKind: "selection",
        candidateId,
        selfActorIds: (0, collaboration_1.selfActorIdsForCandidate)(run, candidateId)
    })) {
        failures.push(reviewError);
    }
    if (failures.length) {
        const feedbackIds = failures.map((failure) => recordCandidateFailure(run, candidate, failure.code, {
            message: failure.message,
            retryable: false,
            details: failure.details
        }).id);
        updateCandidate(run, {
            ...candidate,
            updatedAt: new Date().toISOString(),
            status: "failed",
            feedbackIds: unique([...(candidate.feedbackIds || []), ...feedbackIds])
        });
        if (shouldPersist(scoringOptions))
            (0, state_1.saveCheckpoint)(run);
        throw new Error(failures.map((failure) => failure.message).join("; "));
    }
    const now = new Date().toISOString();
    const selection = {
        schemaVersion: exports.CANDIDATE_SCHEMA_VERSION,
        id: createSelectionId(run, candidateId),
        runId: run.id,
        candidateId,
        selectedAt: now,
        selectedBy: options.selectedBy || "operator",
        verifierNodeId: candidate.verifierNodeId,
        scoreId: bestScore?.id,
        rankingPath: options.rankingPath || rankingPath(run),
        reason: options.reason || "selected candidate",
        evidence: (0, trust_audit_1.normalizeEvidence)(run, mergeEvidence(candidate.evidence, verifierNode?.evidence || []), {
            source: "cw-validated",
            workerId: candidate.workerId,
            taskId: candidate.taskId,
            resultNodeId: candidate.resultNodeId,
            verifierNodeId: candidate.verifierNodeId,
            candidateId,
            scoreId: bestScore?.id
        }),
        artifacts: candidate.artifacts,
        feedbackIds: [],
        acceptanceRationale: (0, trust_audit_1.buildAcceptanceRationale)({
            selectedCandidateId: candidateId,
            scoreId: bestScore?.id,
            scoreCriteria: bestScore?.criteria,
            verifierNodeId: candidate.verifierNodeId,
            evidenceCount: mergeEvidence(candidate.evidence, verifierNode?.evidence || []).length,
            sandboxProfileId: (0, gates_1.sandboxProfileForCandidate)(run, candidate),
            workerId: candidate.workerId,
            commitGateResult: "passed"
        }),
        metadata: compactMetadata({
            ...(options.metadata || {}),
            rank: ranked?.rank,
            normalized: bestScore?.normalized
        })
    };
    const selectionAudit = (0, trust_audit_1.recordTrustAuditEvent)(run, {
        kind: "candidate.selection",
        decision: "accepted",
        source: "cw-validated",
        workerId: candidate.workerId,
        taskId: candidate.taskId,
        nodeId: candidate.verifierNodeId,
        candidateId,
        scoreId: bestScore?.id,
        selectionId: selection.id,
        sandboxProfileId: selection.acceptanceRationale?.sandboxProfileId,
        evidence: selection.evidence,
        metadata: selection.acceptanceRationale
    });
    selection.evidence = (0, trust_audit_1.normalizeEvidence)(run, selection.evidence, {
        source: "cw-validated",
        workerId: candidate.workerId,
        taskId: candidate.taskId,
        resultNodeId: candidate.resultNodeId,
        verifierNodeId: candidate.verifierNodeId,
        candidateId,
        scoreId: bestScore?.id,
        selectionId: selection.id,
        auditEventIds: [selectionAudit.id]
    });
    selection.acceptanceRationale = (0, trust_audit_1.buildAcceptanceRationale)({
        ...selection.acceptanceRationale,
        auditEventIds: [selectionAudit.id]
    });
    run.candidateSelections = [...(run.candidateSelections || []), selection];
    writeSelection(run, selection);
    const updated = updateCandidate(run, {
        ...candidate,
        updatedAt: now,
        status: verifierNode?.status === "verified" ? "verified" : "selected",
        selectedAt: now,
        evidence: selection.evidence
    });
    appendSelectionNode(run, updated, selection);
    writeCandidateIndex(run);
    if (shouldPersist(scoringOptions))
        (0, state_1.saveCheckpoint)(run);
    return selection;
}
function rejectCandidate(run, candidateId, reason, options = {}) {
    const candidate = requireCandidate(run, candidateId);
    const feedback = recordCandidateFailure(run, candidate, "candidate-rejected", {
        message: reason || `Candidate ${candidateId} rejected`,
        retryable: false
    });
    const updated = updateCandidate(run, {
        ...candidate,
        updatedAt: new Date().toISOString(),
        status: "rejected",
        rejectedAt: new Date().toISOString(),
        feedbackIds: unique([...(candidate.feedbackIds || []), feedback.id])
    });
    appendCandidateNode(run, updated, "rejected");
    if (shouldPersist(options))
        (0, state_1.saveCheckpoint)(run);
    return updated;
}
function summarizeCandidates(run) {
    const candidates = listCandidates(run);
    return {
        total: candidates.length,
        byStatus: countBy(candidates, (candidate) => candidate.status),
        byKind: countBy(candidates, (candidate) => candidate.kind),
        indexPath: indexPath(run),
        rankingPath: rankingPath(run),
        selections: (run.candidateSelections || []).length
    };
}
function ensureCandidateState(run) {
    run.paths.candidatesDir = run.paths.candidatesDir || node_path_1.default.join(run.paths.runDir, "candidates");
    node_fs_1.default.mkdirSync(run.paths.candidatesDir, { recursive: true });
    run.candidates = run.candidates || [];
    run.candidateSelections = run.candidateSelections || [];
}
function upsertCandidate(run, candidate) {
    ensureCandidateState(run);
    const candidates = run.candidates || [];
    const index = candidates.findIndex((entry) => entry.id === candidate.id);
    run.candidates = index >= 0 ? candidates.map((entry) => (entry.id === candidate.id ? candidate : entry)) : [...candidates, candidate];
    writeCandidate(run, candidate);
    writeCandidateIndex(run);
    return candidate;
}
function updateCandidate(run, candidate) {
    return upsertCandidate(run, candidate);
}
function requireCandidate(run, candidateId) {
    const candidate = getCandidate(run, candidateId);
    if (!candidate)
        throw new Error(`Unknown candidate for run ${run.id}: ${candidateId}`);
    return candidate;
}
function appendCandidateNode(run, candidate, stage, score) {
    const parents = [candidate.resultNodeId, candidate.verifierNodeId].filter(Boolean);
    const node = (0, state_node_1.appendRunNode)(run, (0, state_node_1.createStateNode)({
        id: `${run.id}:candidate:${(0, state_1.safeFileName)(candidate.id)}:${stage}`,
        kind: "candidate",
        status: candidate.status === "failed" ? "failed" : candidate.status === "verified" ? "verified" : "completed",
        loopStage: stage === "registered" ? "observe" : "adjust",
        inputs: { candidateId: candidate.id, workerId: candidate.workerId, taskId: candidate.taskId },
        outputs: compactMetadata({
            status: candidate.status,
            scoreId: score?.id,
            normalized: score?.normalized,
            verdict: score?.verdict
        }) || {},
        artifacts: candidateArtifacts(run, candidate),
        evidence: candidate.evidence,
        parents,
        metadata: { candidateId: candidate.id, stage, kind: candidate.kind }
    }));
    for (const parentId of parents) {
        const parent = run.nodes?.find((candidateNode) => candidateNode.id === parentId);
        if (!parent)
            continue;
        const linked = (0, state_node_1.linkStateNodes)(parent, node);
        (0, state_node_1.appendRunNode)(run, linked[0]);
        (0, state_node_1.appendRunNode)(run, linked[1]);
    }
}
function appendSelectionNode(run, candidate, selection) {
    const parentIds = [candidate.verifierNodeId, `${run.id}:candidate:${(0, state_1.safeFileName)(candidate.id)}:scored`].filter(Boolean);
    const node = (0, state_node_1.appendRunNode)(run, (0, state_node_1.createStateNode)({
        id: `${run.id}:candidate:${(0, state_1.safeFileName)(candidate.id)}:selection:${(0, state_1.safeFileName)(selection.id)}`,
        kind: "candidate",
        status: candidate.status === "verified" ? "verified" : "completed",
        loopStage: "adjust",
        inputs: { candidateId: candidate.id, selectionId: selection.id },
        outputs: selection,
        artifacts: selection.artifacts,
        evidence: selection.evidence,
        parents: parentIds,
        metadata: { candidateId: candidate.id, selectionId: selection.id, selected: true }
    }));
    for (const parentId of parentIds) {
        const parent = run.nodes?.find((candidateNode) => candidateNode.id === parentId);
        if (!parent)
            continue;
        const linked = (0, state_node_1.linkStateNodes)(parent, node);
        (0, state_node_1.appendRunNode)(run, linked[0]);
        (0, state_node_1.appendRunNode)(run, linked[1]);
    }
}
function recordCandidateFailure(run, candidate, code, options) {
    return (0, error_feedback_1.recordFeedback)(run, {
        source: "verifier",
        error: {
            code,
            message: options.message,
            at: new Date().toISOString(),
            retryable: options.retryable,
            details: compactMetadata({
                ...(options.details || {}),
                candidateId: candidate.id,
                workerId: candidate.workerId,
                taskId: candidate.taskId
            })
        },
        taskId: candidate.taskId,
        retryable: options.retryable,
        evidence: candidate.evidence,
        artifacts: candidateArtifacts(run, candidate),
        metadata: { candidateId: candidate.id, workerId: candidate.workerId, resultNodeId: candidate.resultNodeId }
    }, { persist: false });
}
function writeCandidate(run, candidate) {
    (0, state_1.writeJson)(candidateFile(run, candidate.id), candidate);
}
function writeScore(run, candidateId, score) {
    (0, state_1.writeJson)(node_path_1.default.join(candidateDir(run, candidateId), "scores", `${(0, state_1.safeFileName)(score.id)}.json`), score);
}
function writeSelection(run, selection) {
    (0, state_1.writeJson)(node_path_1.default.join(candidateRoot(run), "selections", `${(0, state_1.safeFileName)(selection.id)}.json`), selection);
}
function writeCandidateIndex(run) {
    ensureCandidateState(run);
    (0, state_1.writeJson)(indexPath(run), {
        schemaVersion: exports.CANDIDATE_SCHEMA_VERSION,
        runId: run.id,
        candidates: (run.candidates || []).map((candidate) => ({
            id: candidate.id,
            kind: candidate.kind,
            status: candidate.status,
            workerId: candidate.workerId,
            taskId: candidate.taskId,
            resultNodeId: candidate.resultNodeId,
            verifierNodeId: candidate.verifierNodeId,
            resultPath: candidate.resultPath,
            scores: candidate.scores,
            feedbackIds: candidate.feedbackIds
        })),
        selections: run.candidateSelections || []
    });
}
function loadCandidatesFromDisk(run) {
    ensureCandidateState(run);
    return node_fs_1.default
        .readdirSync(candidateRoot(run), { withFileTypes: true })
        .filter((entry) => entry.isDirectory() && entry.name !== "selections")
        .map((entry) => node_path_1.default.join(candidateRoot(run), entry.name, "candidate.json"))
        .filter((file) => node_fs_1.default.existsSync(file))
        // Fail-closed integrity boundary (F4/F5): each candidate.json is validated
        // against CandidateRecord before it merges into the run; a corrupt record
        // throws rather than entering the candidate set as a trusted cast.
        .map((file) => (0, validation_1.validateCandidateRecord)((0, state_1.readJson)(file)));
}
function readScores(run, candidateId) {
    const dir = node_path_1.default.join(candidateDir(run, candidateId), "scores");
    if (!node_fs_1.default.existsSync(dir))
        return [];
    return node_fs_1.default
        .readdirSync(dir)
        .filter((file) => file.endsWith(".json"))
        .sort()
        // Fail-closed integrity boundary (F4/F5): a score file is validated against
        // CandidateScore before it can feed ranking/selection. A corrupt score must
        // throw, not silently widen the normalized/verdict surface the gate reads.
        .map((file) => (0, validation_1.validateCandidateScore)((0, state_1.readJson)(node_path_1.default.join(dir, file))));
}
function candidateArtifacts(run, candidate) {
    return [
        { id: "candidate", kind: "json", path: candidateFile(run, candidate.id) },
        ...candidate.artifacts
    ];
}
function artifactsFromInput(input) {
    const artifacts = [];
    if (input.resultPath)
        artifacts.push({ id: "result", kind: "markdown", path: node_path_1.default.resolve(input.resultPath) });
    return artifacts;
}
function evidenceFromInput(run, input) {
    const resultNode = input.resultNodeId ? run.nodes?.find((node) => node.id === input.resultNodeId) : undefined;
    const verifierNode = input.verifierNodeId ? run.nodes?.find((node) => node.id === input.verifierNodeId) : undefined;
    return mergeById(resultNode?.evidence || [], verifierNode?.evidence || []);
}
function inferCandidateKind(input) {
    if (input.workerId)
        return "worker-output";
    if (input.resultNodeId || input.resultPath)
        return "result";
    return "manual";
}
function bestScore(scores) {
    return [...scores].sort((left, right) => right.normalized - left.normalized || (0, compare_1.compareBytes)(left.createdAt, right.createdAt))[0];
}
function compareRows(left, right, policy) {
    const byScore = right.normalized - left.normalized;
    if (byScore !== 0)
        return byScore;
    if (policy.tieBreaker === "candidateId")
        return (0, compare_1.compareBytes)(left.candidate.id, right.candidate.id);
    const byCreated = (0, compare_1.compareBytes)(left.candidate.createdAt, right.candidate.createdAt);
    return byCreated || (0, compare_1.compareBytes)(left.candidate.id, right.candidate.id);
}
function detectTies(candidates) {
    const groups = new Map();
    for (const candidate of candidates) {
        const key = String(candidate.normalized);
        groups.set(key, [...(groups.get(key) || []), candidate.candidateId]);
    }
    return Array.from(groups.values()).filter((group) => group.length > 1);
}
function mergePolicy(policy = {}) {
    // NOTE: `policy.criteria` (string[]) is intentionally NOT carried here. A
    // whole-repo grep shows it has no read points — scoring reads each score's
    // own `input.criteria` (Record<string, number>), not this list. Emitting a
    // default `criteria: []` advertised a guarantee the code never honored and
    // could silently drift, so it is dropped. The field stays OPTIONAL on
    // CandidateScoringPolicy / CandidateRanking.policy for forward-compat input.
    return {
        id: policy.id || "cw.candidate.default",
        title: policy.title || "Default Candidate Scoring",
        requireEvidence: policy.requireEvidence ?? true,
        requireVerifierGate: policy.requireVerifierGate ?? true,
        minNormalized: policy.minNormalized,
        tieBreaker: policy.tieBreaker || "createdAt"
    };
}
function verdictFor(normalized, policy) {
    if (policy.minNormalized !== undefined && normalized < policy.minNormalized)
        return "fail";
    if (normalized >= VERDICT_PASS_THRESHOLD)
        return "pass";
    if (normalized >= VERDICT_WARN_THRESHOLD)
        return "warn";
    return "fail";
}
function sumCriteria(criteria) {
    return Object.values(criteria).reduce((total, value) => total + Number(value || 0), 0);
}
function candidateRoot(run) {
    ensureCandidateState(run);
    return run.paths.candidatesDir || node_path_1.default.join(run.paths.runDir, "candidates");
}
function candidateDir(run, candidateId) {
    return node_path_1.default.join(candidateRoot(run), (0, state_1.safeFileName)(candidateId));
}
function candidateFile(run, candidateId) {
    return node_path_1.default.join(candidateDir(run, candidateId), "candidate.json");
}
function indexPath(run) {
    return node_path_1.default.join(candidateRoot(run), "index.json");
}
function rankingPath(run) {
    return node_path_1.default.join(candidateRoot(run), "ranking.json");
}
// Deterministic candidate id (FreeBSD-audit L12/L13): the candidate's POSITION in
// the run's candidate set, qualified by kind + seed (a stable worker/task/result
// id) for readability. No wall-clock stamp, no PRNG suffix — re-running the same
// workflow mints byte-identical candidate ids, keeping fingerprints replay-stable.
function createCandidateId(run, kind, seed) {
    const seq = (run.candidates || []).length + 1;
    return `candidate-${(0, state_1.safeFileName)(kind)}-${seed ? `${(0, state_1.safeFileName)(seed)}-` : ""}${String(seq).padStart(4, "0")}`;
}
// Deterministic score id (FreeBSD-audit L12/L13): the score's POSITION within its
// candidate's score list. Scores only ever append, so the sequence is unique per
// candidate and stable across replays.
function createScoreId(candidate) {
    const seq = (candidate.scores || []).length + 1;
    return `score-${(0, state_1.safeFileName)(candidate.id)}-${String(seq).padStart(4, "0")}`;
}
// Deterministic selection id (FreeBSD-audit L12/L13): the selection's POSITION in
// the run's append-only selection log. No clock, no PRNG.
function createSelectionId(run, candidateId) {
    const seq = (run.candidateSelections || []).length + 1;
    return `selection-${(0, state_1.safeFileName)(candidateId)}-${String(seq).padStart(4, "0")}`;
}
function shouldPersist(options) {
    return options.persist !== false;
}
function error(code, message, options = {}) {
    return {
        code,
        message,
        at: new Date().toISOString(),
        retryable: false,
        details: options.details
    };
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
function mergeById(left, right) {
    const merged = [...left];
    for (const item of right) {
        const index = merged.findIndex((entry) => entry.id === item.id);
        if (index >= 0)
            merged[index] = item;
        else
            merged.push(item);
    }
    return merged;
}
function mergeEvidence(left, right) {
    const merged = [...left];
    for (const item of right) {
        const index = merged.findIndex((entry) => entry.id === item.id &&
            entry.source === item.source &&
            entry.path === item.path &&
            entry.locator === item.locator);
        if (index >= 0)
            merged[index] = item;
        else
            merged.push(item);
    }
    return merged;
}
function unique(values) {
    return Array.from(new Set(values.filter(Boolean)));
}
function countBy(items, key) {
    const counts = {};
    for (const item of items) {
        const value = key(item);
        counts[value] = (counts[value] || 0) + 1;
    }
    return counts;
}
function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
}
function compactMetadata(value) {
    const entries = Object.entries(value).filter(([, entry]) => entry !== undefined);
    return entries.length ? Object.fromEntries(entries) : undefined;
}
