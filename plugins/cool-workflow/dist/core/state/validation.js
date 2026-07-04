"use strict";
// core/state/validation.ts — RecordValidationError + per-record shape
// guards.
//
// MILESTONE 3. Byte-exact port of the parts of the old build's
// src/validation.ts this milestone's conformance filter actually reaches
// (NodeSnapshot / NodeReplayRun, both read at the `readNodeSnapshot`/
// `readNodeReplay` edge in shell/node-store.ts). WorkerScope/
// CandidateScore/CandidateRecord guards land with their owning milestone
// (5/9) rather than being spec'd ahead of need here.
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
exports.validateNodeSnapshot = validateNodeSnapshot;
exports.validateNodeReplayRun = validateNodeReplayRun;
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
const SNAPSHOT_FRESHNESS = new Set(["valid", "stale", "absent"]);
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
