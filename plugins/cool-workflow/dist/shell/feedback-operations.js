"use strict";
// shell/feedback-operations.ts — operator-facing feedback lifecycle:
// collect / list / show / create-task / resolve. Byte-behavior port of the old
// src/orchestrator/feedback-operations.ts (thin wrappers over the
// error-feedback-io primitives that also refresh the report + persist).
Object.defineProperty(exports, "__esModule", { value: true });
exports.collectFeedback = collectFeedback;
exports.listFeedback = listFeedback;
exports.showFeedback = showFeedback;
exports.createFeedbackTask = createFeedbackTask;
exports.resolveFeedback = resolveFeedback;
const report_1 = require("./report");
const error_feedback_io_1 = require("./error-feedback-io");
function collectFeedback(run) {
    const collected = (0, error_feedback_io_1.collectRunErrors)(run);
    (0, report_1.writeReport)(run);
    return collected;
}
function listFeedback(run, options = {}) {
    return (0, error_feedback_io_1.listFeedback)(run, {
        status: options.status ? String(options.status) : undefined,
        severity: options.severity ? String(options.severity) : undefined,
        classification: options.classification ? String(options.classification) : undefined,
    });
}
function showFeedback(run, feedbackId) {
    const feedback = (0, error_feedback_io_1.getFeedback)(run, feedbackId);
    if (!feedback)
        throw new Error(`Unknown feedback id for run ${run.id}: ${feedbackId}`);
    return feedback;
}
function createFeedbackTask(run, feedbackId, options = {}) {
    const feedback = (0, error_feedback_io_1.createCorrectionTask)(run, feedbackId, {
        verifierCommand: options.verify ? String(options.verify) : undefined,
        guidance: options.guidance ? String(options.guidance) : undefined,
    });
    (0, report_1.writeReport)(run);
    return feedback;
}
function resolveFeedback(run, feedbackId, options = {}) {
    const feedback = (0, error_feedback_io_1.resolveFeedback)(run, feedbackId, {
        status: options.status === "rejected" ? "rejected" : "resolved",
        nodeId: options.node ? String(options.node) : undefined,
        message: options.message ? String(options.message) : undefined,
    });
    (0, report_1.writeReport)(run);
    return feedback;
}
