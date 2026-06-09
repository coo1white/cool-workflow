"use strict";
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
exports.collectFeedback = collectFeedback;
exports.listFeedback = listFeedback;
exports.showFeedback = showFeedback;
exports.createFeedbackTask = createFeedbackTask;
exports.resolveFeedback = resolveFeedback;
const state_1 = require("../state");
const report_1 = require("./report");
const fb = __importStar(require("../error-feedback"));
function collectFeedback(run) {
    const collected = fb.collectRunErrors(run);
    (0, report_1.writeReport)(run);
    (0, state_1.saveCheckpoint)(run);
    return collected;
}
function listFeedback(run, options = {}) {
    return fb.listFeedback(run, {
        status: options.status ? String(options.status) : undefined,
        severity: options.severity ? String(options.severity) : undefined,
        classification: options.classification ? String(options.classification) : undefined
    });
}
function showFeedback(run, feedbackId) {
    const feedback = fb.getFeedback(run, feedbackId);
    if (!feedback)
        throw new Error(`Unknown feedback id for run ${run.id}: ${feedbackId}`);
    return feedback;
}
function createFeedbackTask(run, feedbackId, options = {}) {
    const feedback = fb.createCorrectionTask(run, feedbackId, {
        verifierCommand: options.verify ? String(options.verify) : undefined,
        guidance: options.guidance ? String(options.guidance) : undefined
    });
    (0, report_1.writeReport)(run);
    (0, state_1.saveCheckpoint)(run);
    return feedback;
}
function resolveFeedback(run, feedbackId, options = {}) {
    const feedback = fb.resolveFeedback(run, feedbackId, {
        status: options.status === "rejected" ? "rejected" : "resolved",
        nodeId: options.node ? String(options.node) : undefined,
        message: options.message ? String(options.message) : undefined
    });
    (0, report_1.writeReport)(run);
    (0, state_1.saveCheckpoint)(run);
    return feedback;
}
