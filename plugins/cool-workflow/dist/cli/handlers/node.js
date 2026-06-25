"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.handleNode = handleNode;
const operator_ux_1 = require("../../operator-ux");
const io_1 = require("../io");
/** `cw node list|show|graph|snapshot|diff|replay|verify <run-id> …` — node inspection. */
function handleNode(args, runner) {
    const [subcommand, runId, nodeId] = args.positionals;
    switch (subcommand) {
        case "list":
            (0, io_1.printJson)(runner.listNodes((0, io_1.required)(runId, "run id")));
            return;
        case "show":
            (0, io_1.printJson)(runner.showNode((0, io_1.required)(runId, "run id"), (0, io_1.required)(nodeId, "node id")));
            return;
        case "graph":
            if ((0, io_1.wantsJson)(args.options))
                (0, io_1.printJson)(runner.graphNodes((0, io_1.required)(runId, "run id")));
            else
                process.stdout.write(`${(0, operator_ux_1.formatOperatorGraph)(runner.operatorGraph((0, io_1.required)(runId, "run id")))}\n`);
            return;
        case "snapshot":
            (0, io_1.printJson)(runner.nodeSnapshot((0, io_1.required)(runId, "run id"), (0, io_1.required)(nodeId, "node id")));
            return;
        case "diff":
            (0, io_1.printJson)(runner.nodeDiff((0, io_1.required)(runId, "run id"), (0, io_1.required)(nodeId, "baseline snapshot id"), (0, io_1.required)(args.positionals[3], "candidate snapshot id")));
            return;
        case "replay":
            (0, io_1.printJson)(runner.nodeReplay((0, io_1.required)(runId, "run id"), (0, io_1.required)(nodeId, "snapshot id")));
            return;
        case "verify": {
            const verdict = runner.nodeReplayVerify((0, io_1.required)(runId, "run id"), (0, io_1.required)(nodeId, "replay id"));
            (0, io_1.printJson)(verdict);
            if (!verdict.pass)
                process.exitCode = 1;
            return;
        }
        default:
            throw new Error("Usage: cw.js node list|show|graph|snapshot|diff|replay|verify <run-id> [node-id|snapshot-id|replay-id]");
    }
}
