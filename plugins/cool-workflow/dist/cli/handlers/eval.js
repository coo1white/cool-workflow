"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.handleEval = handleEval;
const multi_agent_eval_1 = require("../../multi-agent-eval");
const io_1 = require("../io");
/** `cw eval snapshot|replay|compare|score|gate|report …` — multi-agent eval. */
function handleEval(args, runner) {
    const [subcommand, first, second] = args.positionals;
    let result;
    switch (subcommand) {
        case "snapshot":
            result = runner.evalSnapshot((0, io_1.required)(first, "run id"), args.options);
            break;
        case "replay":
            result = runner.evalReplay((0, io_1.required)(first, "snapshot id or path"), args.options);
            break;
        case "compare":
            result = runner.evalCompare((0, io_1.required)(first, "baseline id or path"), (0, io_1.required)(second, "replay id or path"));
            break;
        case "score":
            result = runner.evalScore((0, io_1.required)(first, "replay id or path"));
            break;
        case "gate":
            result = runner.evalGate((0, io_1.required)(first, "suite id or path"));
            if (!(0, io_1.wantsJson)(args.options) && result.status === "fail")
                process.exitCode = 1;
            break;
        case "report":
            result = runner.evalReport((0, io_1.required)(first, "replay id or path"));
            break;
        default:
            throw new Error("Usage: cw.js eval snapshot <run-id> --id <snapshot-id> | replay <snapshot-id-or-path> | compare <baseline-id-or-path> <replay-id-or-path> | score <replay-id-or-path> | gate <suite-id-or-path> | report <replay-id-or-path>");
    }
    if ((0, io_1.wantsJson)(args.options))
        (0, io_1.printJson)(result);
    else
        process.stdout.write(`${(0, multi_agent_eval_1.formatMultiAgentEval)(result)}\n`);
    if (subcommand === "gate" && result.status === "fail")
        process.exitCode = 1;
}
