"use strict";
// shell/feedback-cli.ts — `cw feedback list|show|summary|collect|task|resolve`
// (and the mirrored cw_feedback_* MCP tools) handler bodies. Loads run state
// and routes to the feedback-operations lifecycle.
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
exports.feedbackListCli = feedbackListCli;
exports.feedbackShowCli = feedbackShowCli;
exports.feedbackSummaryCli = feedbackSummaryCli;
exports.feedbackCollectCli = feedbackCollectCli;
exports.feedbackTaskCli = feedbackTaskCli;
exports.feedbackResolveCli = feedbackResolveCli;
const path = __importStar(require("node:path"));
const run_store_1 = require("./run-store");
const error_feedback_1 = require("../core/pipeline/error-feedback");
const feedback_operations_1 = require("./feedback-operations");
function cwdFor(args) {
    return typeof args.cwd === "string" && args.cwd.trim() ? path.resolve(args.cwd) : process.cwd();
}
function req(value, label) {
    const s = value === undefined || value === null ? "" : String(value);
    if (!s)
        throw new Error(`Missing ${label}`);
    return s;
}
function feedbackListCli(args) {
    const run = (0, run_store_1.loadRunFromCwd)(req(args.runId, "run id"), cwdFor(args));
    return (0, feedback_operations_1.listFeedback)(run, args);
}
function feedbackShowCli(args) {
    const run = (0, run_store_1.loadRunFromCwd)(req(args.runId, "run id"), cwdFor(args));
    return (0, feedback_operations_1.showFeedback)(run, req(args.feedbackId, "feedback id"));
}
function feedbackSummaryCli(args) {
    const run = (0, run_store_1.loadRunFromCwd)(req(args.runId, "run id"), cwdFor(args));
    return (0, error_feedback_1.summarizeFeedback)((0, feedback_operations_1.listFeedback)(run));
}
// collect/task/resolve mutate the run and saveCheckpoint (transitively,
// in feedback-operations -> error-feedback-io), so they hold the state.json
// lock across the whole load -> change -> save cycle (lost-update class).
function feedbackCollectCli(args) {
    return (0, run_store_1.withRunStateLock)(req(args.runId, "run id"), cwdFor(args), (run) => (0, feedback_operations_1.collectFeedback)(run));
}
function feedbackTaskCli(args) {
    return (0, run_store_1.withRunStateLock)(req(args.runId, "run id"), cwdFor(args), (run) => (0, feedback_operations_1.createFeedbackTask)(run, req(args.feedbackId, "feedback id"), args));
}
function feedbackResolveCli(args) {
    return (0, run_store_1.withRunStateLock)(req(args.runId, "run id"), cwdFor(args), (run) => (0, feedback_operations_1.resolveFeedback)(run, req(args.feedbackId, "feedback id"), args));
}
