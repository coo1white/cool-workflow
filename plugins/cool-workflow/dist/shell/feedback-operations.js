// shell/feedback-operations.ts — operator-facing feedback lifecycle:
// collect / list / show / create-task / resolve: thin wrappers over the
// error-feedback-io primitives that also refresh the report + persist.
import { writeReport } from "./report.js";
import { collectRunErrors, createCorrectionTask, getFeedback, listFeedback as listFeedbackRecords, resolveFeedback as resolveFeedbackRecord, } from "./error-feedback-io.js";
export function collectFeedback(run) {
    const collected = collectRunErrors(run);
    writeReport(run);
    return collected;
}
export function listFeedback(run, options = {}) {
    return listFeedbackRecords(run, {
        status: options.status ? String(options.status) : undefined,
        severity: options.severity ? String(options.severity) : undefined,
        classification: options.classification ? String(options.classification) : undefined,
    });
}
export function showFeedback(run, feedbackId) {
    const feedback = getFeedback(run, feedbackId);
    if (!feedback)
        throw new Error(`Unknown feedback id for run ${run.id}: ${feedbackId}`);
    return feedback;
}
export function createFeedbackTask(run, feedbackId, options = {}) {
    const feedback = createCorrectionTask(run, feedbackId, {
        verifierCommand: options.verify ? String(options.verify) : undefined,
        guidance: options.guidance ? String(options.guidance) : undefined,
    });
    writeReport(run);
    return feedback;
}
export function resolveFeedback(run, feedbackId, options = {}) {
    const feedback = resolveFeedbackRecord(run, feedbackId, {
        status: options.status === "rejected" ? "rejected" : "resolved",
        nodeId: options.node ? String(options.node) : undefined,
        message: options.message ? String(options.message) : undefined,
    });
    writeReport(run);
    return feedback;
}
