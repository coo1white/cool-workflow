"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.handleReport = handleReport;
exports.handleOperator = handleOperator;
exports.handleGraph = handleGraph;
exports.handleTopology = handleTopology;
exports.handleSummary = handleSummary;
const capability_core_1 = require("../../capability-core");
const operator_ux_1 = require("../../operator-ux");
const state_explosion_1 = require("../../state-explosion");
const io_1 = require("../io");
/** `cw report <run-id> [--show] | report bundle <run-id> | report verify-bundle <path>`. */
function handleReport(args, runner) {
    // `report verify-bundle <path>` is the offline self-contained bundle verifier;
    // `report bundle <run-id>` exports a sealed bundle and self-verifies it;
    // every other `report <run-id>` form prints/inspects a local run's report.
    if (args.positionals[0] === "verify-bundle") {
        const result = (0, capability_core_1.runVerifyReportBundle)(runner, { ...args.options, archive: args.positionals[1] || args.options.archive || args.options.path || args.options.file || args.options.bundle });
        (0, io_1.printJson)(result);
        // Fail closed: a forged/edited/corrupt bundle verifies false — surface it
        // through the exit code so `cw report verify-bundle <file> && ship` cannot
        // pass on a lie. Mirrors run inspect-archive / telemetry verify.
        if (!result.ok)
            process.exitCode = 1;
        return;
    }
    if (args.positionals[0] === "bundle") {
        const result = (0, capability_core_1.reportBundle)(runner, (0, io_1.required)(args.positionals[1] || (0, io_1.optionalArg)(args.options.runId || args.options.run), "run id"), args.options);
        (0, io_1.printJson)(result);
        // Fail closed: never report a "bundle made" success if the artifact does not
        // self-verify — so `cw report bundle <run> && send-to-client` cannot ship an
        // unverifiable report (e.g. no trust key under --strict-signatures).
        if (!result.ok)
            process.exitCode = 1;
        return;
    }
    const runId = (0, io_1.required)(args.positionals[0], "run id");
    const report = runner.report(runId);
    if ((0, io_1.wantsJson)(args.options)) {
        (0, io_1.printJson)(report);
    }
    else if (args.options.show || args.options.summary) {
        process.stdout.write(`${(0, operator_ux_1.formatOperatorReport)(runner.operatorReport(runId))}\n`);
        process.stdout.write(`\n${(0, state_explosion_1.formatStateExplosionReport)(runner.stateExplosionReport(runId))}\n`);
    }
    else {
        process.stdout.write(`${report.path}\n`);
    }
}
/** `cw operator status|report <run-id> [--json]`. */
function handleOperator(args, runner) {
    const [subcommand, runId] = args.positionals;
    switch (subcommand) {
        case "status":
            if ((0, io_1.wantsJson)(args.options))
                (0, io_1.printJson)(runner.operatorStatus((0, io_1.required)(runId, "run id")));
            else {
                const summary = runner.operatorStatus((0, io_1.required)(runId, "run id"));
                process.stdout.write(`${(args.options.summary || args.options.brief ? (0, operator_ux_1.formatOperatorSummary)(summary) : (0, operator_ux_1.formatOperatorStatus)(summary))}\n`);
            }
            return;
        case "report":
            if ((0, io_1.wantsJson)(args.options))
                (0, io_1.printJson)(runner.operatorReport((0, io_1.required)(runId, "run id")));
            else
                process.stdout.write(`${(0, operator_ux_1.formatOperatorReport)(runner.operatorReport((0, io_1.required)(runId, "run id")))}\n`);
            return;
        default:
            throw new Error("Usage: cw.js operator status|report <run-id> [--json]");
    }
}
/** `cw graph <run-id> [--json]` — the operator run graph. */
function handleGraph(args, runner) {
    const graph = runner.operatorGraph((0, io_1.required)(args.positionals[0], "run id"));
    if ((0, io_1.wantsJson)(args.options))
        (0, io_1.printJson)(graph);
    else
        process.stdout.write(`${(0, operator_ux_1.formatOperatorGraph)(graph)}\n`);
}
/** `cw topology list|show|validate|apply|summary|graph …`. */
function handleTopology(args, runner) {
    const [subcommand, first, second] = args.positionals;
    switch (subcommand) {
        case "list":
            (0, io_1.printJson)(runner.listTopologies());
            return;
        case "show":
            if (second)
                (0, io_1.printJson)(runner.showTopologyRun((0, io_1.required)(first, "run id"), second));
            else
                (0, io_1.printJson)(runner.showTopology((0, io_1.required)(first, "topology id")));
            return;
        case "validate": {
            const result = runner.validateTopology((0, io_1.required)(first, "topology id"));
            (0, io_1.printJson)(result);
            if (!result.valid)
                process.exitCode = 1;
            return;
        }
        case "apply":
            (0, io_1.printJson)(runner.applyTopology((0, io_1.required)(first, "run id"), (0, io_1.required)(second, "topology id"), args.options));
            return;
        case "summary": {
            const summary = runner.topologySummary((0, io_1.required)(first, "run id"));
            if ((0, io_1.wantsJson)(args.options))
                (0, io_1.printJson)(summary);
            else
                process.stdout.write(`${(0, operator_ux_1.formatTopologySummary)(summary)}\n`);
            return;
        }
        case "graph": {
            const graph = runner.topologyGraph((0, io_1.required)(first, "run id"));
            if ((0, io_1.wantsJson)(args.options))
                (0, io_1.printJson)(graph);
            else
                process.stdout.write(`${(0, operator_ux_1.formatOperatorGraph)({ runId: (0, io_1.required)(first, "run id"), nodes: graph.nodes, edges: graph.edges })}\n`);
            return;
        }
        default:
            throw new Error("Usage: cw.js topology list|show <topology-id>|show <run-id> <topology-run-id>|validate <topology-id>|apply <run-id> <topology-id>|summary <run-id>|graph <run-id>");
    }
}
/** `cw summary refresh|show <run-id> [--json]` — durable state-explosion summary. */
function handleSummary(args, runner) {
    const [subcommand, runId] = args.positionals;
    switch (subcommand) {
        case "refresh": {
            const index = runner.summaryRefresh((0, io_1.required)(runId, "run id"), args.options);
            if ((0, io_1.wantsJson)(args.options))
                (0, io_1.printJson)(index);
            else
                process.stdout.write(`${(0, state_explosion_1.formatStateExplosionReport)(runner.summaryShow((0, io_1.required)(runId, "run id")))}\n`);
            return;
        }
        case "show": {
            const report = runner.summaryShow((0, io_1.required)(runId, "run id"));
            if ((0, io_1.wantsJson)(args.options))
                (0, io_1.printJson)(report);
            else
                process.stdout.write(`${(0, state_explosion_1.formatStateExplosionReport)(report)}\n`);
            return;
        }
        default:
            throw new Error("Usage: cw.js summary refresh|show <run-id> [--json]");
    }
}
