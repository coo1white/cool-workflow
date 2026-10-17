// shell/feedback-cli.ts — `cw feedback list|show|summary|collect|task|resolve`
// (and the mirrored cw_feedback_* MCP tools) handler bodies. Loads run state
// and routes to the feedback-operations lifecycle.

import { cwdArg } from "../core/util/cli-args";
import { loadRunFromCwd, withRunStateLock } from "./run-store";
import { summarizeFeedback } from "../core/pipeline/error-feedback";
import { collectFeedback, createFeedbackTask, listFeedback, resolveFeedback, showFeedback } from "./feedback-operations";

function req(value: unknown, label: string): string {
  const s = value === undefined || value === null ? "" : String(value);
  if (!s) throw new Error(`Missing ${label}`);
  return s;
}

export function feedbackListCli(args: Record<string, unknown>): unknown {
  const run = loadRunFromCwd(req(args.runId, "run id"), cwdArg(args));
  return listFeedback(run, args);
}

export function feedbackShowCli(args: Record<string, unknown>): unknown {
  const run = loadRunFromCwd(req(args.runId, "run id"), cwdArg(args));
  return showFeedback(run, req(args.feedbackId, "feedback id"));
}

export function feedbackSummaryCli(args: Record<string, unknown>): unknown {
  const run = loadRunFromCwd(req(args.runId, "run id"), cwdArg(args));
  return summarizeFeedback(listFeedback(run));
}

// collect/task/resolve mutate the run and saveCheckpoint (transitively,
// in feedback-operations -> error-feedback-io), so they hold the state.json
// lock across the whole load -> change -> save cycle (lost-update class).
export function feedbackCollectCli(args: Record<string, unknown>): unknown {
  return withRunStateLock(req(args.runId, "run id"), cwdArg(args), (run) => collectFeedback(run));
}

export function feedbackTaskCli(args: Record<string, unknown>): unknown {
  return withRunStateLock(req(args.runId, "run id"), cwdArg(args), (run) =>
    createFeedbackTask(run, req(args.feedbackId, "feedback id"), args)
  );
}

export function feedbackResolveCli(args: Record<string, unknown>): unknown {
  return withRunStateLock(req(args.runId, "run id"), cwdArg(args), (run) =>
    resolveFeedback(run, req(args.feedbackId, "feedback id"), args)
  );
}
