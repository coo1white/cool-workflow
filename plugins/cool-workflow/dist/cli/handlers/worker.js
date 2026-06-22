"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.handleWorker = handleWorker;
const operator_ux_1 = require("../../operator-ux");
const io_1 = require("../io");
/** `cw worker list|summary|show|manifest|output|fail|validate <run-id> [worker-id] [result-file]`. */
function handleWorker(args, runner) {
    const [subcommand, runId, workerId, resultPath] = args.positionals;
    switch (subcommand) {
        case "list":
            (0, io_1.printJson)(runner.listWorkers((0, io_1.required)(runId, "run id"), args.options));
            return;
        case "summary": {
            const summary = runner.summarizeWorkerRecords((0, io_1.required)(runId, "run id"));
            if ((0, io_1.wantsJson)(args.options))
                (0, io_1.printJson)(summary);
            else
                process.stdout.write(`${(0, operator_ux_1.formatWorkerSummary)(summary)}\n`);
            return;
        }
        case "show":
            (0, io_1.printJson)(runner.showWorker((0, io_1.required)(runId, "run id"), (0, io_1.required)(workerId, "worker id")));
            return;
        case "manifest":
            (0, io_1.printJson)(runner.showWorkerManifest((0, io_1.required)(runId, "run id"), (0, io_1.required)(workerId, "worker id")));
            return;
        case "output":
            (0, io_1.printJson)(runner.recordWorkerOutput((0, io_1.required)(runId, "run id"), (0, io_1.required)(workerId, "worker id"), (0, io_1.required)(resultPath, "result file"), args.options));
            return;
        case "fail":
            (0, io_1.printJson)(runner.recordWorkerFailure((0, io_1.required)(runId, "run id"), (0, io_1.required)(workerId, "worker id"), String(args.options.message || (0, io_1.required)(resultPath, "failure message")), args.options));
            return;
        case "validate": {
            // Non-null = a boundary violation: a validate verb must report an invalid
            // verdict through its exit code, not just print it and exit 0.
            const violation = runner.validateWorker((0, io_1.required)(runId, "run id"), (0, io_1.required)(workerId, "worker id"), resultPath);
            (0, io_1.printJson)(violation);
            if (violation)
                process.exitCode = 1;
            return;
        }
        default:
            throw new Error("Usage: cw.js worker list|summary|show|manifest|output|fail|validate <run-id> [worker-id] [result-file]");
    }
}
