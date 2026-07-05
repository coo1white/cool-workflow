"use strict";
// core/state/validation.ts — RecordValidationError + per-record shape
// guards.
//
// MILESTONE 3 (+ WorkerScope port). Byte-exact port of the old build's
// src/validation.ts. NodeSnapshot / NodeReplayRun are read at the
// `readNodeSnapshot`/`readNodeReplay` edge in shell/node-store.ts.
// WorkerScope is read at the `getWorkerScope`/`loadWorkerScopesFromDisk`
// edge in shell/worker-isolation.ts. CandidateScore/CandidateRecord
// guards still land with their owning milestone (9) rather than being
// spec'd ahead of need here.
//
// WorkerScope itself is a shell-layer concept (its full type carries
// ResolvedSandboxPolicy/SandboxAttestation from shell/execution-backend),
// so this pure core module does not import that type. Instead it
// declares WorkerScopeShape: the subset of required fields the old guard
// actually checks. Any real WorkerScope satisfies this shape structurally
// (TypeScript structural typing), so shell/worker-isolation.ts can call
// this guard and get its own WorkerScope back without a core -> shell
// import.
//
// Two callers, two error semantics, both fail closed:
//   - validate*()     throws a descriptive Error on mismatch.
//   - tryValidate*()  returns null on mismatch (never throws).
//
// Dependency-light by construction: imports only from ./types. No fs, no
// clock, no randomness — pure structural checks, safe in replay/core paths.
//
// Evidence: SPEC/state-core.md "src/validation.ts — persisted-record shape
// guards", "Fail-closed record reads".
Object.defineProperty(exports, "__esModule", { value: true });
exports.RecordValidationError = void 0;
exports.validateWorkerScope = validateWorkerScope;
exports.validateNodeSnapshot = validateNodeSnapshot;
exports.validateNodeReplayRun = validateNodeReplayRun;
exports.tryValidateCandidateScore = tryValidateCandidateScore;
function isRecord(value) {
    return value !== null && typeof value === "object" && !Array.isArray(value);
}
function isString(value) {
    return typeof value === "string";
}
function isObjectArray(value) {
    return Array.isArray(value) && value.every((entry) => isRecord(entry));
}
function isStringArray(value) {
    return Array.isArray(value) && value.every((entry) => typeof entry === "string");
}
function isFiniteNumber(value) {
    return typeof value === "number" && Number.isFinite(value);
}
function isNumberRecord(value) {
    return isRecord(value) && Object.values(value).every((entry) => isFiniteNumber(entry));
}
const SNAPSHOT_FRESHNESS = new Set(["valid", "stale", "absent"]);
const WORKER_STATUSES = new Set([
    "allocated",
    "running",
    "completed",
    "failed",
    "rejected",
    "verified",
    "orphaned",
]);
/** Descriptive integrity error — the message names the type and the field
 *  that broke, so a corrupt record is diagnosable from logs alone. */
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
// WorkerScope — worker-isolation.ts getWorkerScope / loadWorkerScopesFromDisk
// Required: schemaVersion===1, id, runId, taskId, createdAt, updatedAt,
// workerDir, inputPath, resultPath, artifactsDir, logsDir are strings;
// status a valid WorkerIsolationStatus; allowedPaths string[]; feedbackIds
// string[]; errors object[]. Optional fields are not enforced (additive,
// may be absent).
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
        "logsDir",
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
/** Throw-on-mismatch guard for WorkerScope (callers that require the
 *  record). Returns WorkerScopeShape — the caller (shell/worker-isolation.ts)
 *  casts to its own richer WorkerScope, which is a structural superset. */
function validateWorkerScope(value) {
    const problem = workerScopeReason(value);
    if (problem)
        throw new RecordValidationError("WorkerScope", problem.reason, problem.field);
    return value;
}
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
/** Throw-on-mismatch guard for NodeSnapshot (read edge requires the
 *  record). */
function validateNodeSnapshot(value) {
    const problem = nodeSnapshotReason(value);
    if (problem)
        throw new RecordValidationError("NodeSnapshot", problem.reason, problem.field);
    return value;
}
function nodeReplayRunReason(value) {
    if (!isRecord(value))
        return { reason: "not an object" };
    if (value.schemaVersion !== 1)
        return { field: "schemaVersion", reason: "must equal 1" };
    const requiredStrings = ["replayId", "runId", "nodeId", "snapshotId", "replayedAt", "outputFingerprint"];
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
/** Throw-on-mismatch guard for NodeReplayRun (read edge requires the
 *  record). */
function validateNodeReplayRun(value) {
    const problem = nodeReplayRunReason(value);
    if (problem)
        throw new RecordValidationError("NodeReplayRun", problem.reason, problem.field);
    return value;
}
// ---------------------------------------------------------------------------
// CandidateScore — the score records evidence-reasoning.ts reads off disk to
// build the score gate. A corrupt/forged score must NOT flow into the run as a
// trusted record: the gate that backs commit selection reads these fields, so
// we fail closed at the read edge. schemaVersion===1; id/candidateId/runId/
// createdAt/scorer strings; criteria a Record<string, number>; total/maxTotal/
// normalized finite numbers; verdict a pass|warn|fail enum; evidence/artifacts
// object arrays. Byte-behavior port of the old build's src/validation.ts guard.
// ---------------------------------------------------------------------------
const SCORE_VERDICTS = new Set(["pass", "warn", "fail"]);
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
        return { field: "verdict", reason: "must be a valid CandidateScore verdict (pass|warn|fail)" };
    }
    if (!isObjectArray(value.evidence))
        return { field: "evidence", reason: "must be a StateEvidence[]" };
    if (!isObjectArray(value.artifacts))
        return { field: "artifacts", reason: "must be a StateArtifact[]" };
    return undefined;
}
/** Best-effort guard: returns null on a shape mismatch so the caller skips the
 *  record and the downstream score gate fails closed on its absence, rather
 *  than trusting a forged/corrupt score. */
function tryValidateCandidateScore(value) {
    return candidateScoreReason(value) ? null : value;
}
