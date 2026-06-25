"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.handleCandidate = handleCandidate;
const operator_ux_1 = require("../../operator-ux");
const io_1 = require("../io");
/** `cw candidate list|show|register|score|rank|select|reject|summary <run-id> [candidate-id]`. */
function handleCandidate(args, runner) {
    const [subcommand, runId, candidateId, reason] = args.positionals;
    switch (subcommand) {
        case "list":
            (0, io_1.printJson)(runner.listCandidates((0, io_1.required)(runId, "run id"), args.options));
            return;
        case "show":
            (0, io_1.printJson)(runner.showCandidate((0, io_1.required)(runId, "run id"), (0, io_1.required)(candidateId, "candidate id")));
            return;
        case "register":
            (0, io_1.printJson)(runner.registerCandidate((0, io_1.required)(runId, "run id"), args.options));
            return;
        case "score":
            (0, io_1.printJson)(runner.scoreCandidate((0, io_1.required)(runId, "run id"), (0, io_1.required)(candidateId, "candidate id"), args.options));
            return;
        case "rank":
            (0, io_1.printJson)(runner.rankCandidates((0, io_1.required)(runId, "run id"), args.options));
            return;
        case "select":
            (0, io_1.printJson)(runner.selectCandidate((0, io_1.required)(runId, "run id"), (0, io_1.required)(candidateId, "candidate id"), args.options));
            return;
        case "reject":
            (0, io_1.printJson)(runner.rejectCandidate((0, io_1.required)(runId, "run id"), (0, io_1.required)(candidateId, "candidate id"), String(args.options.reason || args.options.message || reason || "rejected")));
            return;
        case "summary":
            if ((0, io_1.wantsJson)(args.options))
                (0, io_1.printJson)(runner.summarizeCandidateOperatorRecords((0, io_1.required)(runId, "run id")));
            else
                process.stdout.write(`${(0, operator_ux_1.formatCandidateSummary)(runner.summarizeCandidateOperatorRecords((0, io_1.required)(runId, "run id")))}\n`);
            return;
        default:
            throw new Error("Usage: cw.js candidate list|show|register|score|rank|select|reject|summary <run-id> [candidate-id]");
    }
}
