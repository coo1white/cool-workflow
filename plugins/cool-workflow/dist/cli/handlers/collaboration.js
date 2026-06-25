"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.handleApprove = handleApprove;
exports.handleReject = handleReject;
exports.handleComment = handleComment;
exports.handleHandoff = handleHandoff;
exports.handleReview = handleReview;
const io_1 = require("../io");
/** `cw approve <kind> <run-id> <target-id>` — record an approval on a target. */
function handleApprove(args, runner) {
    const [targetKind, runId, targetId] = args.positionals;
    (0, io_1.printJson)(runner.collaborationApprove((0, io_1.required)(runId, "run id"), (0, io_1.required)(targetKind, "target kind (candidate|commit|selection|run|task|node)"), (0, io_1.required)(targetId, "target id"), args.options));
}
/** `cw reject <kind> <run-id> <target-id>` — record a rejection on a target. */
function handleReject(args, runner) {
    const [targetKind, runId, targetId] = args.positionals;
    (0, io_1.printJson)(runner.collaborationReject((0, io_1.required)(runId, "run id"), (0, io_1.required)(targetKind, "target kind (candidate|commit|selection|run|task|node)"), (0, io_1.required)(targetId, "target id"), args.options));
}
/** `cw comment add <kind> <run-id> <target-id> | comment list <run-id>` — leave or list comments. */
function handleComment(args, runner) {
    const [subcommand, ...rest] = args.positionals;
    if (subcommand === "add") {
        const [targetKind, runId, targetId] = rest;
        (0, io_1.printJson)(runner.collaborationComment((0, io_1.required)(runId, "run id"), (0, io_1.required)(targetKind, "target kind"), (0, io_1.required)(targetId, "target id"), args.options));
        return;
    }
    if (subcommand === "list") {
        const result = runner.collaborationCommentList((0, io_1.required)(rest[0], "run id"), args.options);
        if ((0, io_1.wantsJson)(args.options))
            (0, io_1.printJson)(result);
        else
            process.stdout.write(`${runner.formatCommentList(result.comments)}\n`);
        return;
    }
    throw new Error("Usage: cw.js comment add <kind> <run-id> <target-id> --body <text> | comment list <run-id> [--json]");
}
/** `cw handoff <kind> <run-id> [target-id]` — hand a target off to the next owner. */
function handleHandoff(args, runner) {
    const [targetKind, runId, targetIdRaw] = args.positionals;
    const kind = (0, io_1.required)(targetKind, "target kind (run|task|candidate|commit|node)");
    const rid = (0, io_1.required)(runId, "run id");
    const targetId = targetIdRaw || (kind === "run" ? rid : undefined);
    (0, io_1.printJson)(runner.collaborationHandoff(rid, kind, (0, io_1.required)(targetId, "target id"), args.options));
}
/** `cw review status <run-id> | review policy <run-id> …` — read or set review state/policy. */
function handleReview(args, runner) {
    const [subcommand, runId] = args.positionals;
    if (subcommand === "status") {
        const report = runner.reviewStatus((0, io_1.required)(runId, "run id"), args.options);
        if ((0, io_1.wantsJson)(args.options))
            (0, io_1.printJson)(report);
        else
            process.stdout.write(`${runner.formatReviewStatus(report)}\n`);
        return;
    }
    if (subcommand === "policy") {
        (0, io_1.printJson)(runner.reviewPolicy((0, io_1.required)(runId, "run id"), args.options));
        return;
    }
    throw new Error("Usage: cw.js review status <run-id> [--json] | review policy <run-id> --required-approvals N --authorized-roles a,b --applies-to commit,selection");
}
