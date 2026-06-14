"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ERROR_FEEDBACK_SCHEMA_VERSION = void 0;
exports.createErrorFeedbackLoop = createErrorFeedbackLoop;
exports.collectRunErrors = collectRunErrors;
exports.recordFeedback = recordFeedback;
exports.classifyFeedback = classifyFeedback;
exports.createCorrectionTask = createCorrectionTask;
exports.resolveFeedback = resolveFeedback;
exports.listFeedback = listFeedback;
exports.getFeedback = getFeedback;
exports.summarizeFeedback = summarizeFeedback;
const node_fs_1 = __importDefault(require("node:fs"));
const node_path_1 = __importDefault(require("node:path"));
const state_1 = require("./state");
const state_node_1 = require("./state-node");
exports.ERROR_FEEDBACK_SCHEMA_VERSION = 1;
function createErrorFeedbackLoop(options = {}) {
    return {
        collectRunErrors: (run, collectOptions) => collectRunErrors(run, mergeOptions(options, collectOptions)),
        recordFeedback: (run, input) => recordFeedback(run, input, options),
        classifyFeedback,
        createCorrectionTask: (run, feedbackId, taskOptions) => createCorrectionTask(run, feedbackId, taskOptions),
        resolveFeedback: (run, feedbackId, result) => resolveFeedback(run, feedbackId, result),
        listFeedback: (run, listOptions) => listFeedback(run, listOptions),
        getFeedback,
        summarizeFeedback
    };
}
function collectRunErrors(run, options = {}) {
    const records = [];
    const existing = new Set((run.feedback || []).map(feedbackKey));
    for (const node of run.nodes || []) {
        if (node.status !== "failed" && !node.errors.length)
            continue;
        for (const error of node.errors) {
            const key = feedbackKey({
                runId: run.id,
                code: error.code,
                message: error.message,
                nodeId: node.id,
                stageId: stringMetadata(node.metadata, "pipelineStage"),
                contractId: node.contractId,
                path: error.path
            });
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
                metadata: {
                    collectedFromNodeId: node.id,
                    errorAt: error.at,
                    details: error.details
                }
            }, options);
            records.push(record);
            existing.add(feedbackKey(record));
        }
    }
    if (options.persist !== false && records.length)
        (0, state_1.saveCheckpoint)(run);
    return records;
}
function recordFeedback(run, input, options = {}) {
    ensureFeedbackState(run);
    const error = normalizeError(input.error);
    const nodeId = input.nodeId || error.nodeId;
    const stageId = input.stageId;
    const contractId = input.contractId;
    const existing = (run.feedback || []).find((record) => record.status !== "resolved" &&
        record.code === error.code &&
        record.message === error.message &&
        record.nodeId === nodeId &&
        record.stageId === stageId &&
        record.contractId === contractId &&
        record.path === (input.path || error.path));
    if (existing)
        return existing;
    const classification = classifyFeedback(error, {
        source: input.source || options.source,
        stageId,
        contractId,
        metadata: input.metadata
    });
    const now = new Date().toISOString();
    const record = {
        schemaVersion: exports.ERROR_FEEDBACK_SCHEMA_VERSION,
        id: createFeedbackId(run, classification),
        runId: run.id,
        createdAt: now,
        updatedAt: now,
        status: "open",
        severity: severityFor(classification, error),
        classification,
        source: input.source || options.source || sourceFor(classification),
        code: error.code,
        message: error.message,
        nodeId,
        stageId,
        contractId,
        taskId: input.taskId,
        path: input.path || error.path,
        retryable: input.retryable ?? error.retryable ?? options.policy?.retryableByDefault ?? false,
        evidence: input.evidence || [],
        artifacts: input.artifacts || [],
        metadata: compactMetadata({
            ...input.metadata,
            details: input.metadata?.details || error.details
        })
    };
    run.feedback = [...(run.feedback || []), record];
    writeFeedback(run, record);
    writeFeedbackIndex(run);
    if (options.persist !== false)
        (0, state_1.saveCheckpoint)(run);
    return record;
}
function classifyFeedback(error, context = {}) {
    const normalized = normalizeError(error);
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
function createCorrectionTask(run, feedbackId, options = {}) {
    const record = requireFeedback(run, feedbackId);
    if (record.correctionTaskId)
        return record;
    const taskId = `feedback:${(0, state_1.safeFileName)(record.id)}`;
    const taskPath = node_path_1.default.join(run.paths.tasksDir, `${(0, state_1.safeFileName)(taskId)}.md`);
    const body = renderCorrectionTask(record, options);
    node_fs_1.default.mkdirSync(node_path_1.default.dirname(taskPath), { recursive: true });
    node_fs_1.default.writeFileSync(taskPath, body, "utf8");
    const node = (0, state_node_1.appendRunNode)(run, (0, state_node_1.createStateNode)({
        id: `${run.id}:task:${taskId}`,
        kind: "task",
        status: "pending",
        loopStage: "adjust",
        inputs: { feedbackId: record.id, nodeId: record.nodeId, stageId: record.stageId, contractId: record.contractId },
        artifacts: [{ id: "task", kind: "markdown", path: taskPath }],
        parents: record.nodeId ? [record.nodeId] : [],
        contractId: record.contractId,
        metadata: { feedbackId: record.id, correctionTask: true, retryable: record.retryable }
    }));
    updateFeedback(run, {
        ...record,
        updatedAt: new Date().toISOString(),
        status: "tasked",
        correctionTaskId: taskId,
        metadata: {
            ...(record.metadata || {}),
            correctionTaskPath: taskPath,
            correctionTaskNodeId: node.id,
            verifierCommand: options.verifierCommand
        }
    });
    (0, state_1.saveCheckpoint)(run);
    return requireFeedback(run, feedbackId);
}
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
        metadata: compactMetadata({
            ...(record.metadata || {}),
            resolutionMessage: result.message,
            resolution: result.metadata
        })
    });
    (0, state_1.saveCheckpoint)(run);
    return requireFeedback(run, feedbackId);
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
function getFeedback(run, feedbackId) {
    ensureFeedbackState(run);
    return (run.feedback || []).find((record) => record.id === feedbackId);
}
function summarizeFeedback(run) {
    ensureFeedbackState(run);
    const records = run.feedback || [];
    return {
        total: records.length,
        byStatus: countBy(records, (record) => record.status),
        bySeverity: countBy(records, (record) => record.severity),
        byClassification: countBy(records, (record) => record.classification),
        artifacts: records.map((record) => feedbackPath(run, record.id))
    };
}
function ensureFeedbackState(run) {
    run.paths.feedbackDir = run.paths.feedbackDir || node_path_1.default.join(run.paths.runDir, "feedback");
    node_fs_1.default.mkdirSync(run.paths.feedbackDir, { recursive: true });
    run.feedback = run.feedback || [];
}
function normalizeError(error) {
    if (typeof error === "string") {
        return { code: "runtime-error", message: error, at: new Date().toISOString() };
    }
    if (error instanceof Error) {
        return { code: codeFromError(error), message: error.message, at: new Date().toISOString() };
    }
    return {
        ...error,
        code: error.code || "runtime-error",
        message: error.message || "Unknown error",
        at: error.at || new Date().toISOString()
    };
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
function writeFeedback(run, record) {
    (0, state_1.writeJson)(feedbackPath(run, record.id), record);
}
function writeFeedbackIndex(run) {
    ensureFeedbackState(run);
    (0, state_1.writeJson)(node_path_1.default.join(run.paths.feedbackDir, "index.json"), run.feedback || []);
}
function feedbackPath(run, feedbackId) {
    ensureFeedbackState(run);
    return node_path_1.default.join(run.paths.feedbackDir, `${(0, state_1.safeFileName)(feedbackId)}.json`);
}
function updateFeedback(run, record) {
    ensureFeedbackState(run);
    run.feedback = (run.feedback || []).map((candidate) => (candidate.id === record.id ? record : candidate));
    writeFeedback(run, record);
    writeFeedbackIndex(run);
}
function requireFeedback(run, feedbackId) {
    const record = getFeedback(run, feedbackId);
    if (!record)
        throw new Error(`Unknown feedback id for run ${run.id}: ${feedbackId}`);
    return record;
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
        ""
    ].join("\n");
}
function formatEvidence(evidence) {
    if (!evidence.length)
        return ["No evidence recorded."];
    return evidence.map((entry) => `- ${entry.id}: ${entry.locator || entry.path || entry.summary || entry.source || ""}`);
}
// Deterministic feedback id (FreeBSD-audit L12/L13): the feedback record's
// POSITION in the run's append-only feedback log, qualified by classification for
// readability. recordFeedback dedups identical errors before minting, so the
// sequence is stable and collision-free across replays — no clock, no PRNG.
function createFeedbackId(run, classification) {
    const seq = (run.feedback || []).length + 1;
    return `feedback-${classification}-${String(seq).padStart(4, "0")}`;
}
function feedbackKey(value) {
    return [
        value.runId || "",
        value.code || "",
        value.message || "",
        value.nodeId || "",
        value.stageId || "",
        value.contractId || "",
        value.path || ""
    ].join("\u001f");
}
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
function countBy(values, key) {
    const counts = {};
    for (const value of values) {
        const bucket = key(value);
        counts[bucket] = (counts[bucket] || 0) + 1;
    }
    return counts;
}
function mergeOptions(base, next = {}) {
    return {
        ...base,
        ...next,
        policy: {
            ...(base.policy || {}),
            ...(next.policy || {})
        }
    };
}
