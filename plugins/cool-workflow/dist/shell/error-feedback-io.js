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
const fs = __importStar(require("node:fs"));
const path = __importStar(require("node:path"));
const fs_atomic_1 = require("./fs-atomic");
const error_feedback_1 = require("../core/pipeline/error-feedback");
const run_store_1 = require("./run-store");
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
