// shell/feedback-cli.ts — `cw feedback list|show|summary|collect|task|resolve`
// (and the mirrored cw_feedback_* MCP tools) handler bodies. Loads run state
// and routes to the feedback-operations lifecycle.
import { cwdArg, requireArg } from "../core/util/cli-args.js";
import { loadRunFromCwd, withRunStateLock } from "./run-store.js";
import { summarizeFeedback } from "../core/pipeline/error-feedback.js";
import { collectFeedback, createFeedbackTask, listFeedback, resolveFeedback, showFeedback } from "./feedback-operations.js";
export function feedbackListCli(args) {
    const run = loadRunFromCwd(requireArg(args.runId, "run id"), cwdArg(args));
    return listFeedback(run, args);
}
export function feedbackShowCli(args) {
    const run = loadRunFromCwd(requireArg(args.runId, "run id"), cwdArg(args));
    return showFeedback(run, requireArg(args.feedbackId, "feedback id"));
}
export function feedbackSummaryCli(args) {
    const run = loadRunFromCwd(requireArg(args.runId, "run id"), cwdArg(args));
    return summarizeFeedback(listFeedback(run));
}
// collect/task/resolve mutate the run and saveCheckpoint (transitively,
// in feedback-operations -> error-feedback-io), so they hold the state.json
// lock across the whole load -> change -> save cycle (lost-update class).
export function feedbackCollectCli(args) {
    return withRunStateLock(requireArg(args.runId, "run id"), cwdArg(args), (run) => collectFeedback(run));
}
export function feedbackTaskCli(args) {
    return withRunStateLock(requireArg(args.runId, "run id"), cwdArg(args), (run) => createFeedbackTask(run, requireArg(args.feedbackId, "feedback id"), args));
}
export function feedbackResolveCli(args) {
    return withRunStateLock(requireArg(args.runId, "run id"), cwdArg(args), (run) => resolveFeedback(run, requireArg(args.feedbackId, "feedback id"), args));
}
