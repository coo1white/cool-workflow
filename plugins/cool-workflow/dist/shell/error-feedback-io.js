// shell/error-feedback-io.ts — recordFeedback: the impure wrapper around
// core/pipeline/error-feedback.ts's pure record builder.
//
// recordFeedback dedups on an open record, writes `feedback/<id>.json`
// + index.json, and saves a checkpoint.
//
// Evidence: SPEC/pipeline-run.md "Error feedback — error-feedback module".
import * as fs from "node:fs";
import * as path from "node:path";
import { safeFileName, writeJson } from "./fs-atomic.js";
import { buildFeedbackRecord, compactMetadata, feedbackKey, findExistingFeedback, } from "../core/pipeline/error-feedback.js";
import { createStateNode } from "../core/state/state-node.js";
import { appendRunNode } from "./node-store.js";
import { saveCheckpoint } from "./run-store.js";
import { runPipelineStage as coreRunPipelineStage, } from "../core/pipeline/runner.js";
function ensureFeedbackState(run) {
    run.paths.feedbackDir = run.paths.feedbackDir || path.join(run.paths.runDir, "feedback");
    run.feedback = run.feedback || [];
    return run.feedback;
}
function feedbackPath(run, feedbackId) {
    ensureFeedbackState(run);
    return path.join(run.paths.feedbackDir, `${safeFileName(feedbackId)}.json`);
}
function writeFeedbackIndex(run) {
    const records = ensureFeedbackState(run);
    writeJson(path.join(run.paths.feedbackDir, "index.json"), records);
}
/** Dedup-on-open-record; else builds + persists a new record. */
export function recordFeedback(run, input, options = {}) {
    const records = ensureFeedbackState(run);
    const now = new Date().toISOString();
    const normalizedError = typeof input.error === "string"
        ? { code: "runtime-error", message: input.error, at: now }
        : input.error instanceof Error
            ? { code: "runtime-error", message: input.error.message, at: now }
            : input.error;
    const existing = findExistingFeedback(records, normalizedError, input.nodeId || normalizedError.nodeId, input.stageId, input.contractId, input.path || normalizedError.path);
    if (existing)
        return existing;
    const record = buildFeedbackRecord(run.id, input, records.length, now);
    run.feedback = [...records, record];
    writeJson(feedbackPath(run, record.id), record);
    writeFeedbackIndex(run);
    if (options.persist !== false)
        saveCheckpoint(run);
    return record;
}
// ---------------------------------------------------------------------------
// Operator feedback lifecycle primitives — collect / list / get / correction
// task / resolve.
// ---------------------------------------------------------------------------
function stringMetadata(metadata, key) {
    const value = metadata?.[key];
    return typeof value === "string" ? value : undefined;
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
export function getFeedback(run, feedbackId) {
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
    writeJson(feedbackPath(run, record.id), record);
    writeFeedbackIndex(run);
}
/** A parked worker that a resume ran again, now with a verified result: each
 *  open park feedback of that worker is resolved by the verifier node, the
 *  same proof `feedback resolve` asks for. No other feedback is touched. */
export function resolveParkFeedback(run, workerId, verifierNodeId) {
    for (const record of ensureFeedbackState(run)) {
        if (record.status !== "open" && record.status !== "tasked")
            continue;
        if (record.code !== "agent-delegation-parked" || stringMetadata(record.metadata, "workerId") !== workerId)
            continue;
        const now = new Date().toISOString();
        updateFeedback(run, {
            ...record,
            updatedAt: now,
            status: "resolved",
            resolvedByNodeId: verifierNodeId,
            resolvedAt: now,
            resolutionNote: "resume ran the worker again and its result was verified",
        });
    }
}
export function listFeedback(run, options = {}) {
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
export function collectRunErrors(run, options = {}) {
    const records = [];
    const existing = new Set((run.feedback || []).map(feedbackKey));
    for (const node of run.nodes || []) {
        if (node.status !== "failed" && !node.errors.length)
            continue;
        for (const error of node.errors) {
            const key = feedbackKey({ runId: run.id, code: error.code, message: error.message, nodeId: node.id, stageId: stringMetadata(node.metadata, "pipelineStage"), contractId: node.contractId, path: error.path });
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
            existing.add(feedbackKey(record));
        }
    }
    if (options.persist !== false && records.length)
        saveCheckpoint(run);
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
export function createCorrectionTask(run, feedbackId, options = {}) {
    const record = requireFeedback(run, feedbackId);
    if (record.correctionTaskId)
        return record;
    const taskId = `feedback:${safeFileName(record.id)}`;
    const taskPath = path.join(run.paths.tasksDir, `${safeFileName(taskId)}.md`);
    fs.mkdirSync(path.dirname(taskPath), { recursive: true });
    fs.writeFileSync(taskPath, renderCorrectionTask(record, options), "utf8");
    const node = appendRunNode(run, createStateNode({
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
    saveCheckpoint(run);
    return requireFeedback(run, feedbackId);
}
/** Resolve or reject a feedback record. A `resolved` verdict fails closed: it
 *  requires a nodeId whose state node exists and is verified/committed. */
export function resolveFeedback(run, feedbackId, result) {
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
    saveCheckpoint(run);
    return requireFeedback(run, feedbackId);
}
/** Shell-bound `runPipelineStage`: the core pure runner with `recordFeedback`
 *  wired in, so a failed pipeline stage that preserves its failure node ALSO
 *  writes a durable ErrorFeedback record. The core runner stays
 *  feedback-free; this is the impure seam. */
export function runPipelineStage(run, stageId, inputNodeId, options = {}, runnerOptions = {}) {
    return coreRunPipelineStage(run, stageId, inputNodeId, options, {
        ...runnerOptions,
        // The core gate's `pathExists` defaults to `() => true` (a pure core/
        // module never reads the filesystem). This is the shell seam, so default
        // it to the real `fs.existsSync` — that is what makes the contract's
        // `requireReadablePaths` / `missing-artifact-path` gate live. A caller may
        // still override it (e.g. a replay against a captured path set).
        pathExists: runnerOptions.pathExists || fs.existsSync,
        // Keep the caller-named failure node id; the raw core auto-mints when unset.
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
