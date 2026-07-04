"use strict";
// shell/error-feedback-io.ts — recordFeedback: the impure wrapper around
// core/pipeline/error-feedback.ts's pure record builder.
//
// MILESTONE 9 (needed by candidate-scoring/collaboration selection/score
// failures; not built by milestone 6+7 since nothing there needed the
// operator-facing `feedback/<id>.json` + index.json + saveCheckpoint
// write path yet). Byte-exact port of the old build's src/error-
// feedback.ts's `recordFeedback` (dedup-on-open-record, disk write,
// saveCheckpoint).
//
// Evidence: SPEC/pipeline-run.md "Error feedback — src/error-feedback.ts";
// plugins/cool-workflow/src/error-feedback.ts:109-158,290-360.
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
exports.recordFeedback = recordFeedback;
exports.getFeedback = getFeedback;
exports.listFeedback = listFeedback;
exports.collectRunErrors = collectRunErrors;
exports.createCorrectionTask = createCorrectionTask;
exports.resolveFeedback = resolveFeedback;
exports.runPipelineStage = runPipelineStage;
const fs = __importStar(require("node:fs"));
const path = __importStar(require("node:path"));
const fs_atomic_1 = require("./fs-atomic");
const error_feedback_1 = require("../core/pipeline/error-feedback");
const state_node_1 = require("../core/state/state-node");
const node_store_1 = require("./node-store");
const run_store_1 = require("./run-store");
const runner_1 = require("../core/pipeline/runner");
function ensureFeedbackState(run) {
    run.paths.feedbackDir = run.paths.feedbackDir || path.join(run.paths.runDir, "feedback");
    fs.mkdirSync(run.paths.feedbackDir, { recursive: true });
    run.feedback = run.feedback || [];
    return run.feedback;
}
function feedbackPath(run, feedbackId) {
    ensureFeedbackState(run);
    return path.join(run.paths.feedbackDir, `${(0, fs_atomic_1.safeFileName)(feedbackId)}.json`);
}
function writeFeedbackIndex(run) {
    const records = ensureFeedbackState(run);
    (0, fs_atomic_1.writeJson)(path.join(run.paths.feedbackDir, "index.json"), records);
}
/** Dedup-on-open-record; else builds + persists a new record. */
function recordFeedback(run, input, options = {}) {
    const records = ensureFeedbackState(run);
    const now = new Date().toISOString();
    const normalizedError = typeof input.error === "string"
        ? { code: "runtime-error", message: input.error, at: now }
        : input.error instanceof Error
            ? { code: "runtime-error", message: input.error.message, at: now }
            : input.error;
    const existing = (0, error_feedback_1.findExistingFeedback)(records, normalizedError, input.nodeId || normalizedError.nodeId, input.stageId, input.contractId, input.path || normalizedError.path);
    if (existing)
        return existing;
    const record = (0, error_feedback_1.buildFeedbackRecord)(run.id, input, records.length, now);
    run.feedback = [...records, record];
    (0, fs_atomic_1.writeJson)(feedbackPath(run, record.id), record);
    writeFeedbackIndex(run);
    if (options.persist !== false)
        (0, run_store_1.saveCheckpoint)(run);
    return record;
}
// ---------------------------------------------------------------------------
// Operator feedback lifecycle primitives — collect / list / get / correction
// task / resolve. Byte-behavior port of the old src/error-feedback.ts halves
// that v2 had not yet ported (v2 shipped only the record-builder half).
// ---------------------------------------------------------------------------
function stringMetadata(metadata, key) {
    const value = metadata?.[key];
    return typeof value === "string" ? value : undefined;
}
function compactMetadata(metadata) {
    const compacted = {};
    for (const [key, value] of Object.entries(metadata)) {
        if (value !== undefined)
            compacted[key] = value;
    }
    return Object.keys(compacted).length ? compacted : undefined;
}
function mergeById(existing, next) {
    const values = [...existing];
    for (const item of next) {
        const index = values.findIndex((candidate) => candidate.id === item.id);
        if (index >= 0)
            values[index] = item;
        else
            values.push(item);
    }
    return values;
}
function formatEvidence(evidence) {
    if (!evidence.length)
        return ["No evidence recorded."];
    return evidence.map((entry) => `- ${entry.id}: ${entry.locator || entry.path || entry.summary || entry.source || ""}`);
}
function getFeedback(run, feedbackId) {
    ensureFeedbackState(run);
    return (run.feedback || []).find((record) => record.id === feedbackId);
}
function requireFeedback(run, feedbackId) {
    const record = getFeedback(run, feedbackId);
    if (!record)
        throw new Error(`Unknown feedback id for run ${run.id}: ${feedbackId}`);
    return record;
}
function updateFeedback(run, record) {
    const records = ensureFeedbackState(run);
    run.feedback = records.map((candidate) => (candidate.id === record.id ? record : candidate));
    (0, fs_atomic_1.writeJson)(feedbackPath(run, record.id), record);
    writeFeedbackIndex(run);
}
function listFeedback(run, options = {}) {
    ensureFeedbackState(run);
    return (run.feedback || []).filter((record) => {
        if (options.status && record.status !== options.status)
            return false;
        if (options.severity && record.severity !== options.severity)
            return false;
        if (options.classification && record.classification !== options.classification)
            return false;
        return true;
    });
}
/** Scan every failed/errored state node and record an open feedback record for
 *  each not-yet-seen error (dedup by feedbackKey). */
function collectRunErrors(run, options = {}) {
    const records = [];
    const existing = new Set((run.feedback || []).map(error_feedback_1.feedbackKey));
    for (const node of run.nodes || []) {
        if (node.status !== "failed" && !node.errors.length)
            continue;
        for (const error of node.errors) {
            const key = (0, error_feedback_1.feedbackKey)({ runId: run.id, code: error.code, message: error.message, nodeId: node.id, stageId: stringMetadata(node.metadata, "pipelineStage"), contractId: node.contractId, path: error.path });
            if (existing.has(key))
                continue;
            const record = recordFeedback(run, {
                source: "state-node",
                error,
                nodeId: node.id,
                stageId: stringMetadata(node.metadata, "pipelineStage"),
                contractId: node.contractId,
                taskId: stringMetadata(node.metadata, "taskId"),
                path: error.path,
                retryable: error.retryable,
                evidence: node.evidence,
                artifacts: node.artifacts,
                metadata: { collectedFromNodeId: node.id, errorAt: error.at, details: error.details },
            }, { persist: false });
            records.push(record);
            existing.add((0, error_feedback_1.feedbackKey)(record));
        }
    }
    if (options.persist !== false && records.length)
        (0, run_store_1.saveCheckpoint)(run);
    return records;
}
function renderCorrectionTask(record, options) {
    const verifier = options.verifierCommand || "Run the relevant verifier or smoke test and record the verified StateNode id.";
    const guidance = options.guidance || (record.retryable ? "Retry only after explicit correction input." : "Do not retry blindly.");
    return [
        `# Correction Task: ${record.id}`,
        "",
        `- Status: ${record.status}`,
        `- Severity: ${record.severity}`,
        `- Classification: ${record.classification}`,
        `- Source: ${record.source}`,
        `- Code: ${record.code}`,
        `- Message: ${record.message}`,
        `- Node: ${record.nodeId || ""}`,
        `- Stage: ${record.stageId || ""}`,
        `- Contract: ${record.contractId || ""}`,
        `- Path: ${record.path || ""}`,
        `- Retryable: ${record.retryable ? "yes" : "no"}`,
        "",
        "## Evidence",
        "",
        ...formatEvidence(record.evidence),
        "",
        "## Expected Verification",
        "",
        verifier,
        "",
        "## Guidance",
        "",
        guidance,
        "",
    ].join("\n");
}
/** Materialize a correction task (markdown + pending task state node) for a
 *  feedback record and mark it `tasked`. Idempotent: a record that already has
 *  a correction task is returned unchanged. */
function createCorrectionTask(run, feedbackId, options = {}) {
    const record = requireFeedback(run, feedbackId);
    if (record.correctionTaskId)
        return record;
    const taskId = `feedback:${(0, fs_atomic_1.safeFileName)(record.id)}`;
    const taskPath = path.join(run.paths.tasksDir, `${(0, fs_atomic_1.safeFileName)(taskId)}.md`);
    fs.mkdirSync(path.dirname(taskPath), { recursive: true });
    fs.writeFileSync(taskPath, renderCorrectionTask(record, options), "utf8");
    const node = (0, node_store_1.appendRunNode)(run, (0, state_node_1.createStateNode)({
        id: `${run.id}:task:${taskId}`,
        kind: "task",
        status: "pending",
        loopStage: "adjust",
        inputs: { feedbackId: record.id, nodeId: record.nodeId, stageId: record.stageId, contractId: record.contractId },
        artifacts: [{ id: "task", kind: "markdown", path: taskPath }],
        parents: record.nodeId ? [record.nodeId] : [],
        contractId: record.contractId,
        metadata: { feedbackId: record.id, correctionTask: true, retryable: record.retryable },
    }));
    updateFeedback(run, {
        ...record,
        updatedAt: new Date().toISOString(),
        status: "tasked",
        correctionTaskId: taskId,
        metadata: { ...(record.metadata || {}), correctionTaskPath: taskPath, correctionTaskNodeId: node.id, verifierCommand: options.verifierCommand },
    });
    (0, run_store_1.saveCheckpoint)(run);
    return requireFeedback(run, feedbackId);
}
/** Resolve or reject a feedback record. A `resolved` verdict fails closed: it
 *  requires a nodeId whose state node exists and is verified/committed. */
function resolveFeedback(run, feedbackId, result) {
    const record = requireFeedback(run, feedbackId);
    if (result.status === "resolved" && !result.nodeId) {
        throw new Error(`Feedback ${feedbackId} cannot resolve without a verified node id`);
    }
    if (result.status === "resolved") {
        const node = (run.nodes || []).find((candidate) => candidate.id === result.nodeId);
        if (!node)
            throw new Error(`Feedback ${feedbackId} resolution node not found: ${result.nodeId}`);
        if (node.status !== "verified" && node.status !== "committed") {
            throw new Error(`Feedback ${feedbackId} resolution node must be verified or committed`);
        }
    }
    const nextStatus = result.status === "resolved" ? "resolved" : "rejected";
    updateFeedback(run, {
        ...record,
        updatedAt: new Date().toISOString(),
        status: nextStatus,
        resolvedByNodeId: result.nodeId,
        resolvedAt: nextStatus === "resolved" ? new Date().toISOString() : record.resolvedAt,
        resolutionNote: result.message || record.resolutionNote,
        evidence: mergeById(record.evidence, result.evidence || []),
        artifacts: mergeById(record.artifacts, result.artifacts || []),
        metadata: compactMetadata({ ...(record.metadata || {}), resolutionMessage: result.message, resolution: result.metadata }),
    });
    (0, run_store_1.saveCheckpoint)(run);
    return requireFeedback(run, feedbackId);
}
/** Shell-bound `runPipelineStage`: the core pure runner with `recordFeedback`
 *  wired in, so a failed pipeline stage that preserves its failure node ALSO
 *  writes a durable ErrorFeedback record (byte-behavior port of the old
 *  build's pipeline-runner, whose runPipelineStage recorded feedback on
 *  failure). The core runner stays feedback-free; this is the impure seam. */
function runPipelineStage(run, stageId, inputNodeId, options = {}, runnerOptions = {}) {
    return (0, runner_1.runPipelineStage)(run, stageId, inputNodeId, options, {
        ...runnerOptions,
        // Keep the caller-named failure node id (the old build honored outputNodeId
        // for the preserved failure node); the raw core auto-mints when unset.
        failureNodeId: runnerOptions.failureNodeId || options.outputNodeId,
        recordFeedback: (r, error, nodeId) => {
            // Read the failure node's own contractId so this feedback's dedup key
            // (code+message+nodeId+stageId+contractId+path) matches the one
            // collectRunErrors derives from the same node — otherwise a later
            // collect re-records a duplicate.
            const failNode = (r.nodes || []).find((n) => n.id === nodeId);
            recordFeedback(r, { source: "pipeline-runner", error, nodeId, stageId, contractId: failNode?.contractId || runnerOptions.contractId, path: error.path, retryable: error.retryable, metadata: { inputNodeId, preservedFailureNode: true } }, { persist: false });
        },
    });
}
