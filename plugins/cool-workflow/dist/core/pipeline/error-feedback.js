"use strict";
// core/pipeline/error-feedback.ts — classifyFeedback, recordFeedback's
// decision half, dedup key.
//
// MILESTONE 6+7 (combined). Byte-exact port of the DECISION half of the
// old build's src/error-feedback.ts (record shape, classification,
// severity, dedup key, id formatting). The disk write (feedback/*.json +
// index.json + saveCheckpoint) is the caller's job (shell/), since this
// file stays pure per the core/shell split.
//
// Evidence: SPEC/pipeline-run.md "Error feedback — src/error-feedback.ts".
Object.defineProperty(exports, "__esModule", { value: true });
exports.ERROR_FEEDBACK_SCHEMA_VERSION = void 0;
exports.classifyFeedback = classifyFeedback;
exports.feedbackKey = feedbackKey;
exports.formatFeedbackId = formatFeedbackId;
exports.findExistingFeedback = findExistingFeedback;
exports.buildFeedbackRecord = buildFeedbackRecord;
exports.summarizeFeedback = summarizeFeedback;
exports.ERROR_FEEDBACK_SCHEMA_VERSION = 1;
function normalizeError(error, now) {
    if (typeof error === "string") {
        return { code: "runtime-error", message: error, at: now };
    }
    if (error instanceof Error) {
        return { code: codeFromError(error), message: error.message, at: now };
    }
    return { ...error, code: error.code || "runtime-error", message: error.message || "Unknown error", at: error.at || now };
}
function codeFromError(error) {
    if (/Invalid cw:result JSON/i.test(error.message))
        return "result-parse-error";
    if (/requires cw:result evidence/i.test(error.message))
        return "missing-required-evidence";
    if (/requires evidence/i.test(error.message))
        return "missing-required-evidence";
    if (/Phase gate blocked/i.test(error.message))
        return "phase-gate-blocked";
    return "runtime-error";
}
/** classifyFeedback — fixed order, byte-exact to the old build. */
function classifyFeedback(error, context = {}, now = new Date(0).toISOString()) {
    const normalized = normalizeError(error, now);
    const code = normalized.code.toLowerCase();
    if (code.includes("missing-artifact") || code.includes("artifact-path"))
        return "missing-artifact";
    if (code.includes("missing-required-evidence") || code.includes("missing-evidence"))
        return "missing-evidence";
    if (code.includes("verifier") || context.stageId === "verify" || context.source === "verifier")
        return "verifier-failure";
    if (code.includes("illegal-transition") || code.includes("state-transition"))
        return "state-transition";
    if (code.includes("contract") || code.includes("unexpected-node") || context.contractId)
        return "contract-violation";
    if (code.startsWith("sandbox-"))
        return "sandbox-policy";
    if (code.includes("parse") || code.includes("json"))
        return "parse-error";
    if (code.includes("pipeline"))
        return "pipeline-failure";
    if (normalized.code === "runtime-error")
        return "runtime-error";
    return "unknown";
}
function severityFor(classification, error) {
    if (classification === "verifier-failure" || classification === "contract-violation")
        return "high";
    if (classification === "sandbox-policy")
        return "medium";
    if (classification === "state-transition" || classification === "missing-evidence")
        return "medium";
    if (classification === "missing-artifact" || classification === "parse-error" || classification === "pipeline-failure") {
        return error.retryable ? "medium" : "low";
    }
    return "low";
}
function sourceFor(classification) {
    if (classification === "contract-violation")
        return "contract";
    if (classification === "verifier-failure" || classification === "missing-evidence")
        return "verifier";
    if (classification === "pipeline-failure")
        return "pipeline-runner";
    if (classification === "sandbox-policy")
        return "contract";
    return "manual";
}
/** Feedback dedup key: joined with `` (runId, code, message, nodeId,
 *  stageId, contractId, path). */
function feedbackKey(value) {
    return [value.runId || "", value.code || "", value.message || "", value.nodeId || "", value.stageId || "", value.contractId || "", value.path || ""].join("");
}
function compactMetadata(metadata) {
    const compacted = {};
    for (const [key, value] of Object.entries(metadata))
        if (value !== undefined)
            compacted[key] = value;
    return Object.keys(compacted).length ? compacted : undefined;
}
/** Deterministic feedback id: position in the run's append-only feedback
 *  log (1-based), qualified by classification. */
function formatFeedbackId(classification, seq) {
    return `feedback-${classification}-${String(seq).padStart(4, "0")}`;
}
/** Find an existing UNRESOLVED record matching the same
 *  {code,message,nodeId,stageId,contractId,path} — recordFeedback's dedup
 *  rule. */
function findExistingFeedback(existing, error, nodeId, stageId, contractId, path) {
    return existing.find((record) => record.status !== "resolved" &&
        record.code === error.code &&
        record.message === error.message &&
        record.nodeId === nodeId &&
        record.stageId === stageId &&
        record.contractId === contractId &&
        record.path === path);
}
/** Build a new (not-yet-persisted) feedback record. `existingCount` is
 *  `(run.feedback || []).length` BEFORE this record is appended. */
function buildFeedbackRecord(runId, input, existingCount, now) {
    const error = normalizeError(input.error, now);
    const nodeId = input.nodeId || error.nodeId;
    const classification = classifyFeedback(error, { source: input.source, stageId: input.stageId, contractId: input.contractId, metadata: input.metadata }, now);
    return {
        schemaVersion: exports.ERROR_FEEDBACK_SCHEMA_VERSION,
        id: formatFeedbackId(classification, existingCount + 1),
        runId,
        createdAt: now,
        updatedAt: now,
        status: "open",
        severity: severityFor(classification, error),
        classification,
        source: input.source || sourceFor(classification),
        code: error.code,
        message: error.message,
        nodeId,
        stageId: input.stageId,
        contractId: input.contractId,
        taskId: input.taskId,
        path: input.path || error.path,
        retryable: input.retryable ?? error.retryable ?? false,
        evidence: input.evidence || [],
        artifacts: input.artifacts || [],
        metadata: compactMetadata({ ...input.metadata, details: input.metadata?.details || error.details }),
    };
}
function summarizeFeedback(records) {
    return {
        total: records.length,
        byStatus: countBy(records, (r) => r.status),
        bySeverity: countBy(records, (r) => r.severity),
        byClassification: countBy(records, (r) => r.classification),
    };
}
function countBy(values, key) {
    const counts = {};
    for (const value of values) {
        const bucket = key(value);
        counts[bucket] = (counts[bucket] || 0) + 1;
    }
    return counts;
}
