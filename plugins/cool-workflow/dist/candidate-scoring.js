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
exports.CANDIDATE_SCHEMA_VERSION = 1;
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
    const id = input.id || createCandidateId(input.kind || "manual", input.workerId || input.taskId || input.resultNodeId);
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
        evidence: input.evidence || evidenceFromInput(run, input),
        scores: [],
        feedbackIds: [],
        metadata: compactMetadata(input.metadata || {})
    };
    upsertCandidate(run, candidate);
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
    const candidate = JSON.parse(node_fs_1.default.readFileSync(file, "utf8"));
    upsertCandidate(run, candidate);
    return candidate;
}
function scoreCandidate(run, candidateId, input, options = {}) {
    const candidate = requireCandidate(run, candidateId);
    const scoreId = input.id || createScoreId(candidateId);
    const evidence = input.evidence || [];
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
    }
    if (policy.minNormalized !== undefined && (bestScore?.normalized ?? 0) < policy.minNormalized) {
        failures.push(error("candidate-selection-score-below-threshold", `Candidate ${candidateId} score is below threshold`, {
            details: { normalized: bestScore?.normalized ?? 0, minNormalized: policy.minNormalized }
        }));
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
        id: createSelectionId(candidateId),
        runId: run.id,
        candidateId,
        selectedAt: now,
        selectedBy: options.selectedBy || "operator",
        verifierNodeId: candidate.verifierNodeId,
        scoreId: bestScore?.id,
        rankingPath: options.rankingPath || rankingPath(run),
        reason: options.reason || "selected candidate",
        evidence: mergeEvidence(candidate.evidence, verifierNode?.evidence || []),
        artifacts: candidate.artifacts,
        feedbackIds: [],
        metadata: compactMetadata({
            ...(options.metadata || {}),
            rank: ranked?.rank,
            normalized: bestScore?.normalized
        })
    };
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
        .map((file) => JSON.parse(node_fs_1.default.readFileSync(file, "utf8")));
}
function readScores(run, candidateId) {
    const dir = node_path_1.default.join(candidateDir(run, candidateId), "scores");
    if (!node_fs_1.default.existsSync(dir))
        return [];
    return node_fs_1.default
        .readdirSync(dir)
        .filter((file) => file.endsWith(".json"))
        .sort()
        .map((file) => JSON.parse(node_fs_1.default.readFileSync(node_path_1.default.join(dir, file), "utf8")));
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
    return [...scores].sort((left, right) => right.normalized - left.normalized || left.createdAt.localeCompare(right.createdAt))[0];
}
function compareRows(left, right, policy) {
    const byScore = right.normalized - left.normalized;
    if (byScore !== 0)
        return byScore;
    if (policy.tieBreaker === "candidateId")
        return left.candidate.id.localeCompare(right.candidate.id);
    const byCreated = left.candidate.createdAt.localeCompare(right.candidate.createdAt);
    return byCreated || left.candidate.id.localeCompare(right.candidate.id);
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
    return {
        id: policy.id || "cw.candidate.default",
        title: policy.title || "Default Candidate Scoring",
        criteria: policy.criteria || [],
        requireEvidence: policy.requireEvidence ?? true,
        requireVerifierGate: policy.requireVerifierGate ?? true,
        minNormalized: policy.minNormalized,
        tieBreaker: policy.tieBreaker || "createdAt"
    };
}
function verdictFor(normalized, policy) {
    if (policy.minNormalized !== undefined && normalized < policy.minNormalized)
        return "fail";
    if (normalized >= 0.7)
        return "pass";
    if (normalized >= 0.4)
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
function createCandidateId(kind, seed) {
    const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\..+/, "Z");
    const suffix = Math.random().toString(36).slice(2, 8);
    return `candidate-${(0, state_1.safeFileName)(kind)}-${seed ? `${(0, state_1.safeFileName)(seed)}-` : ""}${stamp}-${suffix}`;
}
function createScoreId(candidateId) {
    const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\..+/, "Z");
    return `score-${(0, state_1.safeFileName)(candidateId)}-${stamp}-${Math.random().toString(36).slice(2, 8)}`;
}
function createSelectionId(candidateId) {
    const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\..+/, "Z");
    return `selection-${(0, state_1.safeFileName)(candidateId)}-${stamp}-${Math.random().toString(36).slice(2, 8)}`;
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
