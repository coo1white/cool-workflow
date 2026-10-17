"use strict";
// shell/feedback-cli.ts — `cw feedback list|show|summary|collect|task|resolve`
// (and the mirrored cw_feedback_* MCP tools) handler bodies. Loads run state
// and routes to the feedback-operations lifecycle.
Object.defineProperty(exports, "__esModule", { value: true });
exports.feedbackListCli = feedbackListCli;
exports.feedbackShowCli = feedbackShowCli;
exports.feedbackSummaryCli = feedbackSummaryCli;
exports.feedbackCollectCli = feedbackCollectCli;
exports.feedbackTaskCli = feedbackTaskCli;
exports.feedbackResolveCli = feedbackResolveCli;
const cli_args_1 = require("../core/util/cli-args");
const run_store_1 = require("./run-store");
const error_feedback_1 = require("../core/pipeline/error-feedback");
const feedback_operations_1 = require("./feedback-operations");
function req(value, label) {
    const s = value === undefined || value === null ? "" : String(value);
    if (!s)
        throw new Error(`Missing ${label}`);
    return s;
}
function feedbackListCli(args) {
    const run = (0, run_store_1.loadRunFromCwd)(req(args.runId, "run id"), (0, cli_args_1.cwdArg)(args));
    return (0, feedback_operations_1.listFeedback)(run, args);
}
function feedbackShowCli(args) {
    const run = (0, run_store_1.loadRunFromCwd)(req(args.runId, "run id"), (0, cli_args_1.cwdArg)(args));
    return (0, feedback_operations_1.showFeedback)(run, req(args.feedbackId, "feedback id"));
}
function feedbackSummaryCli(args) {
    const run = (0, run_store_1.loadRunFromCwd)(req(args.runId, "run id"), (0, cli_args_1.cwdArg)(args));
    return (0, error_feedback_1.summarizeFeedback)((0, feedback_operations_1.listFeedback)(run));
}
// collect/task/resolve mutate the run and saveCheckpoint (transitively,
// in feedback-operations -> error-feedback-io), so they hold the state.json
// lock across the whole load -> change -> save cycle (lost-update class).
function feedbackCollectCli(args) {
    return (0, run_store_1.withRunStateLock)(req(args.runId, "run id"), (0, cli_args_1.cwdArg)(args), (run) => (0, feedback_operations_1.collectFeedback)(run));
}
function feedbackTaskCli(args) {
    return (0, run_store_1.withRunStateLock)(req(args.runId, "run id"), (0, cli_args_1.cwdArg)(args), (run) => (0, feedback_operations_1.createFeedbackTask)(run, req(args.feedbackId, "feedback id"), args));
}
function feedbackResolveCli(args) {
    return (0, run_store_1.withRunStateLock)(req(args.runId, "run id"), (0, cli_args_1.cwdArg)(args), (run) => (0, feedback_operations_1.resolveFeedback)(run, req(args.feedbackId, "feedback id"), args));
}
