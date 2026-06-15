"use strict";
// Fail-closed shape guards for persisted per-record types (F5, integrity boundary).
//
// `JSON.parse(...) as T` is a LIE: the cast asserts a shape TypeScript never
// checked at runtime, so a corrupt/forged/old-schema record flows in as if it
// were a valid T and is used/upserted unvalidated. These guards re-establish the
// integrity boundary at the read edge: after parse, the raw value is structurally
// validated against the type def in src/types/* BEFORE it is trusted.
//
// Two callers, two error semantics — both fail closed, neither fabricates:
//   - validate*()      throw a descriptive Error on mismatch (for readers that
//                      already let parse errors propagate / require the record).
//   - tryValidate*()   return null on mismatch (for best-effort readers that
//                      swallow parse errors and SKIP the record — the downstream
//                      gate then fails closed on the absence). Never throws.
//
// Dependency-light by construction: imports ONLY from ./types. No fs, no clock,
// no randomness — pure structural checks, safe in replay/core paths.
Object.defineProperty(exports, "__esModule", { value: true });
exports.RecordValidationError = void 0;
exports.validateWorkerScope = validateWorkerScope;
exports.tryValidateWorkerScope = tryValidateWorkerScope;
exports.validateNodeSnapshot = validateNodeSnapshot;
exports.tryValidateNodeSnapshot = tryValidateNodeSnapshot;
exports.validateNodeReplayRun = validateNodeReplayRun;
exports.tryValidateNodeReplayRun = tryValidateNodeReplayRun;
exports.validateCandidateScore = validateCandidateScore;
exports.tryValidateCandidateScore = tryValidateCandidateScore;
// ---------------------------------------------------------------------------
// Primitive predicates — small, total, never throw.
// ---------------------------------------------------------------------------
function isRecord(value) {
    return value !== null && typeof value === "object" && !Array.isArray(value);
}
function isString(value) {
    return typeof value === "string";
}
function isFiniteNumber(value) {
    return typeof value === "number" && Number.isFinite(value);
}
function isStringArray(value) {
    return Array.isArray(value) && value.every((entry) => typeof entry === "string");
}
function isObjectArray(value) {
    return Array.isArray(value) && value.every((entry) => isRecord(entry));
}
const WORKER_STATUSES = new Set([
    "allocated",
    "running",
    "completed",
    "failed",
    "rejected",
    "verified",
    "orphaned"
]);
const SCORE_VERDICTS = new Set(["pass", "warn", "fail"]);
const SNAPSHOT_FRESHNESS = new Set(["valid", "stale", "absent"]);
/** Descriptive integrity error — the message names the type and the field that
 *  broke, so a corrupt record is diagnosable from logs alone. */
class RecordValidationError extends Error {
    code = "record-shape-invalid";
    typeName;
    field;
    constructor(typeName, reason, field) {
        super(`Invalid persisted ${typeName}: ${reason}`);
        this.name = "RecordValidationError";
        this.typeName = typeName;
        this.field = field;
    }
}
exports.RecordValidationError = RecordValidationError;
// ---------------------------------------------------------------------------
// WorkerScope — worker-isolation.ts:309 / :905
// Required (per src/types/worker.ts WorkerScope): schemaVersion===1, id, runId,
// taskId, createdAt, updatedAt, status (enum), workerDir, inputPath, resultPath,
// artifactsDir, logsDir are strings; allowedPaths string[]; feedbackIds string[];
// errors object[]. Optional fields are not enforced (additive, may be absent).
// ---------------------------------------------------------------------------
function workerScopeReason(value) {
    if (!isRecord(value))
        return { reason: "not an object" };
    if (value.schemaVersion !== 1)
        return { field: "schemaVersion", reason: "must equal 1" };
    const requiredStrings = [
        "id",
        "runId",
        "taskId",
        "createdAt",
        "updatedAt",
        "workerDir",
        "inputPath",
        "resultPath",
        "artifactsDir",
        "logsDir"
    ];
    for (const field of requiredStrings) {
        if (!isString(value[field]))
            return { field: field, reason: "must be a string" };
    }
    if (!isString(value.status) || !WORKER_STATUSES.has(value.status)) {
        return { field: "status", reason: "must be a valid WorkerIsolationStatus" };
    }
    if (!isStringArray(value.allowedPaths))
        return { field: "allowedPaths", reason: "must be a string[]" };
    if (!isStringArray(value.feedbackIds))
        return { field: "feedbackIds", reason: "must be a string[]" };
    if (!isObjectArray(value.errors))
        return { field: "errors", reason: "must be a StateNodeError[]" };
    return undefined;
}
/** Throw-on-mismatch guard for WorkerScope (callers that require the record). */
function validateWorkerScope(value) {
    const problem = workerScopeReason(value);
    if (problem)
        throw new RecordValidationError("WorkerScope", problem.reason, problem.field);
    return value;
}
/** Best-effort variant: returns null on mismatch (caller skips the record). */
function tryValidateWorkerScope(value) {
    return workerScopeReason(value) ? null : value;
}
// ---------------------------------------------------------------------------
// NodeSnapshotBody — shared by NodeSnapshot.body and NodeReplayRun.body.
// Required (per src/types/state-node.ts): id, kind, status, loopStage strings;
// inputs/outputs records; artifacts/evidence/errors object arrays;
// parents/children string arrays.
// ---------------------------------------------------------------------------
function nodeSnapshotBodyReason(value, prefix) {
    if (!isRecord(value))
        return { field: prefix, reason: "must be a NodeSnapshotBody object" };
    const requiredStrings = ["id", "kind", "status", "loopStage"];
    for (const field of requiredStrings) {
        if (!isString(value[field]))
            return { field: `${prefix}.${String(field)}`, reason: "must be a string" };
    }
    if (!isRecord(value.inputs))
        return { field: `${prefix}.inputs`, reason: "must be an object" };
    if (!isRecord(value.outputs))
        return { field: `${prefix}.outputs`, reason: "must be an object" };
    if (!isObjectArray(value.artifacts))
        return { field: `${prefix}.artifacts`, reason: "must be a StateArtifact[]" };
    if (!isObjectArray(value.evidence))
        return { field: `${prefix}.evidence`, reason: "must be a StateEvidence[]" };
    if (!isObjectArray(value.errors))
        return { field: `${prefix}.errors`, reason: "must be a StateNodeError[]" };
    if (!isStringArray(value.parents))
        return { field: `${prefix}.parents`, reason: "must be a string[]" };
    if (!isStringArray(value.children))
        return { field: `${prefix}.children`, reason: "must be a string[]" };
    return undefined;
}
// ---------------------------------------------------------------------------
// NodeSnapshot — node-snapshot.ts:121
// Required: schemaVersion===1, snapshotId, runId, nodeId, capturedAt,
// sourceFingerprint strings; body a valid NodeSnapshotBody.
// ---------------------------------------------------------------------------
function nodeSnapshotReason(value) {
    if (!isRecord(value))
        return { reason: "not an object" };
    if (value.schemaVersion !== 1)
        return { field: "schemaVersion", reason: "must equal 1" };
    const requiredStrings = ["snapshotId", "runId", "nodeId", "capturedAt", "sourceFingerprint"];
    for (const field of requiredStrings) {
        if (!isString(value[field]))
            return { field: field, reason: "must be a string" };
    }
    return nodeSnapshotBodyReason(value.body, "body");
}
/** Throw-on-mismatch guard for NodeSnapshot (read edge requires the record). */
function validateNodeSnapshot(value) {
    const problem = nodeSnapshotReason(value);
    if (problem)
        throw new RecordValidationError("NodeSnapshot", problem.reason, problem.field);
    return value;
}
/** Best-effort variant: returns null on mismatch. */
function tryValidateNodeSnapshot(value) {
    return nodeSnapshotReason(value) ? null : value;
}
// ---------------------------------------------------------------------------
// NodeReplayRun — node-snapshot.ts:133
// Required: schemaVersion===1, replayId, runId, nodeId, snapshotId, replayedAt,
// outputFingerprint strings; freshness enum; contractValidated boolean; body a
// valid NodeSnapshotBody.
// ---------------------------------------------------------------------------
function nodeReplayRunReason(value) {
    if (!isRecord(value))
        return { reason: "not an object" };
    if (value.schemaVersion !== 1)
        return { field: "schemaVersion", reason: "must equal 1" };
    const requiredStrings = [
        "replayId",
        "runId",
        "nodeId",
        "snapshotId",
        "replayedAt",
        "outputFingerprint"
    ];
    for (const field of requiredStrings) {
        if (!isString(value[field]))
            return { field: field, reason: "must be a string" };
    }
    if (!isString(value.freshness) || !SNAPSHOT_FRESHNESS.has(value.freshness)) {
        return { field: "freshness", reason: "must be a valid NodeSnapshotFreshness" };
    }
    if (typeof value.contractValidated !== "boolean") {
        return { field: "contractValidated", reason: "must be a boolean" };
    }
    return nodeSnapshotBodyReason(value.body, "body");
}
/** Throw-on-mismatch guard for NodeReplayRun (read edge requires the record). */
function validateNodeReplayRun(value) {
    const problem = nodeReplayRunReason(value);
    if (problem)
        throw new RecordValidationError("NodeReplayRun", problem.reason, problem.field);
    return value;
}
/** Best-effort variant: returns null on mismatch. */
function tryValidateNodeReplayRun(value) {
    return nodeReplayRunReason(value) ? null : value;
}
// ---------------------------------------------------------------------------
// CandidateScore — multi-agent-operator-ux.ts:502 / evidence-reasoning.ts:750
// Required (per src/types/candidate.ts): schemaVersion===1, id, candidateId,
// runId, createdAt, scorer strings; criteria record of numbers; total/maxTotal/
// normalized finite numbers; verdict enum; evidence/artifacts object arrays.
// ---------------------------------------------------------------------------
function isNumberRecord(value) {
    return isRecord(value) && Object.values(value).every((entry) => isFiniteNumber(entry));
}
function candidateScoreReason(value) {
    if (!isRecord(value))
        return { reason: "not an object" };
    if (value.schemaVersion !== 1)
        return { field: "schemaVersion", reason: "must equal 1" };
    const requiredStrings = ["id", "candidateId", "runId", "createdAt", "scorer"];
    for (const field of requiredStrings) {
        if (!isString(value[field]))
            return { field: field, reason: "must be a string" };
    }
    if (!isNumberRecord(value.criteria))
        return { field: "criteria", reason: "must be a Record<string, number>" };
    if (!isFiniteNumber(value.total))
        return { field: "total", reason: "must be a finite number" };
    if (!isFiniteNumber(value.maxTotal))
        return { field: "maxTotal", reason: "must be a finite number" };
    if (!isFiniteNumber(value.normalized))
        return { field: "normalized", reason: "must be a finite number" };
    if (!isString(value.verdict) || !SCORE_VERDICTS.has(value.verdict)) {
        return { field: "verdict", reason: "must be a valid CandidateScoreVerdict" };
    }
    if (!isObjectArray(value.evidence))
        return { field: "evidence", reason: "must be a StateEvidence[]" };
    if (!isObjectArray(value.artifacts))
        return { field: "artifacts", reason: "must be a StateArtifact[]" };
    return undefined;
}
/** Throw-on-mismatch guard for CandidateScore (callers that require the record). */
function validateCandidateScore(value) {
    const problem = candidateScoreReason(value);
    if (problem)
        throw new RecordValidationError("CandidateScore", problem.reason, problem.field);
    return value;
}
/** Best-effort variant: returns null on mismatch (caller skips the record so the
 *  downstream score gate fails closed on its absence). */
function tryValidateCandidateScore(value) {
    return candidateScoreReason(value) ? null : value;
}
