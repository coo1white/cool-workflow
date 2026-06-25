// `cw approve` / `reject` / `comment` / `handoff` / `review` handlers — the
// team-collaboration family (v0.1.32), carved out of the command-surface
// god-dispatch. Operators approve or reject a target, leave or list comments,
// hand a target off, and read or set review status/policy on a run. This block
// uses only io helpers (printJson/required/wantsJson) that stay put, and its two
// formatters (formatCommentList/formatReviewStatus) are runner instance methods
// that travel with the runner — so zero top-level imports move here.
import { CoolWorkflowRunner, parseArgv } from "../../orchestrator";
import { printJson, required, wantsJson } from "../io";

type ParsedArgs = ReturnType<typeof parseArgv>;

/** `cw approve <kind> <run-id> <target-id>` — record an approval on a target. */
export function handleApprove(args: ParsedArgs, runner: CoolWorkflowRunner): void {
  const [targetKind, runId, targetId] = args.positionals;
  printJson(
    runner.collaborationApprove(
      required(runId, "run id"),
      required(targetKind, "target kind (candidate|commit|selection|run|task|node)"),
      required(targetId, "target id"),
      args.options
    )
  );
}

/** `cw reject <kind> <run-id> <target-id>` — record a rejection on a target. */
export function handleReject(args: ParsedArgs, runner: CoolWorkflowRunner): void {
  const [targetKind, runId, targetId] = args.positionals;
  printJson(
    runner.collaborationReject(
      required(runId, "run id"),
      required(targetKind, "target kind (candidate|commit|selection|run|task|node)"),
      required(targetId, "target id"),
      args.options
    )
  );
}

/** `cw comment add <kind> <run-id> <target-id> | comment list <run-id>` — leave or list comments. */
export function handleComment(args: ParsedArgs, runner: CoolWorkflowRunner): void {
  const [subcommand, ...rest] = args.positionals;
  if (subcommand === "add") {
    const [targetKind, runId, targetId] = rest;
    printJson(
      runner.collaborationComment(
        required(runId, "run id"),
        required(targetKind, "target kind"),
        required(targetId, "target id"),
        args.options
      )
    );
    return;
  }
  if (subcommand === "list") {
    const result = runner.collaborationCommentList(required(rest[0], "run id"), args.options);
    if (wantsJson(args.options)) printJson(result);
    else process.stdout.write(`${runner.formatCommentList(result.comments)}\n`);
    return;
  }
  throw new Error("Usage: cw.js comment add <kind> <run-id> <target-id> --body <text> | comment list <run-id> [--json]");
}

/** `cw handoff <kind> <run-id> [target-id]` — hand a target off to the next owner. */
export function handleHandoff(args: ParsedArgs, runner: CoolWorkflowRunner): void {
  const [targetKind, runId, targetIdRaw] = args.positionals;
  const kind = required(targetKind, "target kind (run|task|candidate|commit|node)");
  const rid = required(runId, "run id");
  const targetId = targetIdRaw || (kind === "run" ? rid : undefined);
  printJson(runner.collaborationHandoff(rid, kind, required(targetId, "target id"), args.options));
}

/** `cw review status <run-id> | review policy <run-id> …` — read or set review state/policy. */
export function handleReview(args: ParsedArgs, runner: CoolWorkflowRunner): void {
  const [subcommand, runId] = args.positionals;
  if (subcommand === "status") {
    const report = runner.reviewStatus(required(runId, "run id"), args.options);
    if (wantsJson(args.options)) printJson(report);
    else process.stdout.write(`${runner.formatReviewStatus(report)}\n`);
    return;
  }
  if (subcommand === "policy") {
    printJson(runner.reviewPolicy(required(runId, "run id"), args.options));
    return;
  }
  throw new Error(
    "Usage: cw.js review status <run-id> [--json] | review policy <run-id> --required-approvals N --authorized-roles a,b --applies-to commit,selection"
  );
}
