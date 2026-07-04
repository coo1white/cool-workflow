"use strict";
// core/multi-agent/candidate-scoring.ts — registerCandidate/scoreCandidate/
// rankCandidates/selectCandidate's PURE decision half.
//
// MILESTONE 9. Byte-exact port of the decision math in the old build's
// src/candidate-scoring.ts: id minting, score/verdict math, ranking sort
// + tie detection, and the selection gate's failure list. Disk reads/
// writes, trust-audit calls, feedback recording, and saveCheckpoint are
// the caller's job — see shell/candidate-scoring-io.ts.
//
// BYTE-COMPAT ITEM 3 [load-bearing, HIGH priority]: `unique` in this file
// does NOT sort (dedup only, insertion order preserved) — same family as
// topology.ts's `unique`, the opposite of runtime.ts/coordinator.ts's
// sorting `unique`. See uniquedual-role-vs-candidate-order.case.js.
//
// Evidence: SPEC/multi-agent.md section E ("Candidate scoring"),
// "Candidate scoring exact outputs"; plugins/cool-workflow/src/
// candidate-scoring.ts (byte-exact source).
Object.defineProperty(exports, "__esModule", { value: true });
exports.VERDICT_WARN_THRESHOLD = exports.VERDICT_PASS_THRESHOLD = exports.CANDIDATE_SCHEMA_VERSION = void 0;
exports.unique = unique;
exports.compareBytes = compareBytes;
exports.mergePolicy = mergePolicy;
exports.verdictFor = verdictFor;
exports.sumCriteria = sumCriteria;
exports.inferCandidateKind = inferCandidateKind;
exports.createCandidateId = createCandidateId;
exports.createScoreId = createScoreId;
exports.createSelectionId = createSelectionId;
exports.computeScoreMath = computeScoreMath;
exports.bestScore = bestScore;
exports.compareRankRows = compareRankRows;
exports.detectTies = detectTies;
exports.rankCandidateRows = rankCandidateRows;
exports.stateNodeError = stateNodeError;
exports.selectionGateFailures = selectionGateFailures;
exports.mergeById = mergeById;
exports.mergeEvidence = mergeEvidence;
exports.countBy = countBy;
exports.CANDIDATE_SCHEMA_VERSION = 1;
/** Verdict thresholds on a score's normalized value [0,1]. */
exports.VERDICT_PASS_THRESHOLD = 0.7;
exports.VERDICT_WARN_THRESHOLD = 0.4;
/** Dedup, insertion-order preserved (does NOT sort). See file header
 *  byte-compat note. */
function unique(values) {
    return Array.from(new Set(values.filter(Boolean)));
}
function compareBytes(a, b) {
    return a < b ? -1 : a > b ? 1 : 0;
}
function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
}
function mergePolicy(policy = {}) {
    return {
        id: policy.id || "cw.candidate.default",
        title: policy.title || "Default Candidate Scoring",
        requireEvidence: policy.requireEvidence ?? true,
        requireVerifierGate: policy.requireVerifierGate ?? true,
        minNormalized: policy.minNormalized,
        tieBreaker: policy.tieBreaker || "createdAt",
    };
}
function verdictFor(normalized, policy) {
    if (policy.minNormalized !== undefined && normalized < policy.minNormalized)
        return "fail";
    if (normalized >= exports.VERDICT_PASS_THRESHOLD)
        return "pass";
    if (normalized >= exports.VERDICT_WARN_THRESHOLD)
        return "warn";
    return "fail";
}
function sumCriteria(criteria) {
    return Object.values(criteria).reduce((total, value) => total + Number(value || 0), 0);
}
function inferCandidateKind(input) {
    if (input.workerId)
        return "worker-output";
    if (input.resultNodeId || input.resultPath)
        return "result";
    return "manual";
}
function safeFileName(value) {
    return value.replace(/[^a-zA-Z0-9_.:-]+/g, "_");
}
/** Deterministic candidate id: position in the run's candidate set,
 *  qualified by kind + seed (stable worker/task/result id). */
function createCandidateId(candidateCount, kind, seed) {
    const seq = candidateCount + 1;
    return `candidate-${safeFileName(kind)}-${seed ? `${safeFileName(seed)}-` : ""}${String(seq).padStart(4, "0")}`;
}
/** Deterministic score id: position within the candidate's score list. */
function createScoreId(candidate) {
    const seq = (candidate.scores || []).length + 1;
    return `score-${safeFileName(candidate.id)}-${String(seq).padStart(4, "0")}`;
}
/** Deterministic selection id: position in the run's append-only
 *  selection log. */
function createSelectionId(selectionCount, candidateId) {
    const seq = selectionCount + 1;
    return `selection-${safeFileName(candidateId)}-${String(seq).padStart(4, "0")}`;
}
function computeScoreMath(criteria, maxTotalInput, policy, verdictOverride) {
    const total = sumCriteria(criteria);
    const maxTotal = maxTotalInput ?? Math.max(total, 1);
    const normalized = maxTotal > 0 ? clamp(total / maxTotal, 0, 1) : 0;
    return { total, maxTotal, normalized, verdict: verdictOverride || verdictFor(normalized, policy) };
}
function bestScore(scores) {
    return [...scores].sort((left, right) => right.normalized - left.normalized || compareBytes(left.createdAt, right.createdAt))[0];
}
function compareRankRows(left, right, policy) {
    const byScore = right.normalized - left.normalized;
    if (byScore !== 0)
        return byScore;
    if (policy.tieBreaker === "candidateId")
        return compareBytes(left.candidate.id, right.candidate.id);
    const byCreated = compareBytes(left.candidate.createdAt, right.candidate.createdAt);
    return byCreated || compareBytes(left.candidate.id, right.candidate.id);
}
function detectTies(candidates) {
    const groups = new Map();
    for (const candidate of candidates) {
        const key = String(candidate.normalized);
        groups.set(key, [...(groups.get(key) || []), candidate.candidateId]);
    }
    return Array.from(groups.values()).filter((group) => group.length > 1);
}
/** Ranks already-loaded candidates + their scores (loading/merging with
 *  disk is the shell's job). Sort: normalized desc, tie -> tieBreaker. */
function rankCandidateRows(runId, now, candidates, scoresByCandidate, policy, includeRejected) {
    const rankable = candidates.filter((candidate) => includeRejected || candidate.status !== "rejected");
    const rows = rankable.map((candidate) => {
        const scores = scoresByCandidate(candidate.id);
        const best = bestScore(scores);
        return { candidate, best, normalized: best?.normalized ?? 0 };
    });
    rows.sort((left, right) => compareRankRows(left, right, policy));
    const rankedCandidates = rows.map((row, index) => ({
        candidateId: row.candidate.id,
        status: row.candidate.status,
        scoreCount: row.candidate.scores.length,
        bestScoreId: row.best?.id,
        normalized: row.normalized,
        verdict: row.best?.verdict,
        rank: index + 1,
    }));
    return { schemaVersion: exports.CANDIDATE_SCHEMA_VERSION, runId, createdAt: now, policy, candidates: rankedCandidates, ties: detectTies(rankedCandidates) };
}
// ---------------------------------------------------------------------------
// Selection gate — pure failure-list builder (byte-exact to selectCandidate's
// gate logic; review-gate errors are appended by the caller, since
// core/multi-agent/collaboration.ts's reviewGateErrors needs its own
// WorkflowRun-shaped state).
// ---------------------------------------------------------------------------
/** `now` is the explicit clock value for `at`; the real clock is read ONLY
 *  when it is omitted, matching rankCandidateRows's own `now` parameter in
 *  this same file so StateNodeError.at stays byte-stable across identical
 *  logical calls when a caller pins the clock. */
function stateNodeError(code, message, options = {}, now) {
    return { code, message, at: now || new Date().toISOString(), retryable: false, details: options.details };
}
/** Byte-exact port of selectCandidate's own gate ordering: not-selectable
 *  -> verifier-missing/no-evidence/empty-capture -> score-below-threshold.
 *  Review-gate errors are NOT included here; the caller appends them
 *  (v2/PLAN.md byte-compat / rebuild risk 8: append-only stacking, never
 *  replacing a verifier error). */
function selectionGateFailures(input, now) {
    const failures = [];
    if (input.candidateStatus === "rejected" || input.candidateStatus === "failed") {
        failures.push(stateNodeError("candidate-not-selectable", `Candidate ${input.candidateId} is ${input.candidateStatus}`, {}, now));
    }
    if (input.policy.requireVerifierGate && !input.allowUnverified) {
        if (!input.verifierNode || input.verifierNode.status !== "verified") {
            failures.push(stateNodeError("candidate-selection-missing-verifier", `Candidate ${input.candidateId} requires a verified verifier node`, {}, now));
        }
        else if (!input.verifierNode.evidence.length) {
            failures.push(stateNodeError("candidate-selection-missing-evidence", `Candidate ${input.candidateId} verifier node has no evidence`, {}, now));
        }
        else if (input.verifierNodeIsEmptyCapture) {
            failures.push(stateNodeError("candidate-selection-empty-capture", `Candidate ${input.candidateId} verifier node has no real evidence (empty-capture result)`, {}, now));
        }
    }
    if (input.policy.minNormalized !== undefined && (input.bestScoreNormalized ?? 0) < input.policy.minNormalized) {
        failures.push(stateNodeError("candidate-selection-score-below-threshold", `Candidate ${input.candidateId} score is below threshold`, { details: { normalized: input.bestScoreNormalized ?? 0, minNormalized: input.policy.minNormalized } }, now));
    }
    return failures;
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
        const index = merged.findIndex((entry) => entry.id === item.id && entry.source === item.source && entry.path === item.path && entry.locator === item.locator);
        if (index >= 0)
            merged[index] = item;
        else
            merged.push(item);
    }
    return merged;
}
function countBy(items, key) {
    const counts = {};
    for (const item of items) {
        const value = key(item);
        counts[value] = (counts[value] || 0) + 1;
    }
    return counts;
}
