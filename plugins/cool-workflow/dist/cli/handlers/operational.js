"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.handleSandbox = handleSandbox;
exports.handleBackend = handleBackend;
exports.handleContract = handleContract;
exports.handleMigration = handleMigration;
exports.handleFeedback = handleFeedback;
exports.handleMetrics = handleMetrics;
const capability_core_1 = require("../../capability-core");
const observability_1 = require("../../observability");
const operator_ux_1 = require("../../operator-ux");
const io_1 = require("../io");
/** `cw sandbox list|show|validate|choose|resolve [profile-id|profile-file]`. */
function handleSandbox(args, runner) {
    const [subcommand, profileIdOrFile] = args.positionals;
    switch (subcommand) {
        case "list":
            (0, io_1.printJson)(runner.listSandboxProfiles(args.options));
            return;
        case "show":
            (0, io_1.printJson)(runner.showSandboxProfile((0, io_1.required)(profileIdOrFile, "profile id"), args.options));
            return;
        case "validate": {
            const result = runner.validateSandboxProfile((0, io_1.required)(profileIdOrFile, "profile file"), args.options);
            (0, io_1.printJson)(result);
            if (!result.valid)
                process.exitCode = 1;
            return;
        }
        case "choose":
        case "resolve":
            (0, io_1.printJson)((0, capability_core_1.sandboxChoose)(runner, { ...args.options, profileId: profileIdOrFile || args.options.profileId }));
            return;
        default:
            throw new Error("Usage: cw.js sandbox list|show|validate|choose|resolve [profile-id|profile-file]");
    }
}
/** `cw backend list|show|probe [backend-id]  |  cw backend agent config [show|set] …`. */
function handleBackend(args, runner) {
    const [subcommand, backendId] = args.positionals;
    switch (subcommand) {
        case "list":
            (0, io_1.printJson)(runner.listBackends(args.options));
            return;
        case "show":
            (0, io_1.printJson)(runner.showBackend((0, io_1.required)(backendId, "backend id"), args.options));
            return;
        case "probe":
            (0, io_1.printJson)(runner.probeBackend(backendId, args.options));
            return;
        case "agent": {
            // `backend agent config [show]` = read-only; `backend agent config set ...` = mutating.
            const [, , action] = args.positionals;
            if (action === "set") {
                (0, io_1.printJson)((0, capability_core_1.backendAgentConfigSet)(args.options));
                return;
            }
            (0, io_1.printJson)((0, capability_core_1.backendAgentConfigShow)(args.options));
            return;
        }
        default:
            throw new Error("Usage: cw.js backend list|show|probe [backend-id]  |  cw.js backend agent config [show|set] [--agent-command ... --agent-endpoint ... --agent-model ...]");
    }
}
/** `cw contract show <run-id> [contract-id]`. */
function handleContract(args, runner) {
    const [subcommand, runId, contractId] = args.positionals;
    switch (subcommand) {
        case "show":
            (0, io_1.printJson)(runner.showContract((0, io_1.required)(runId, "run id"), contractId));
            return;
        default:
            throw new Error("Usage: cw.js contract show <run-id> [contract-id]");
    }
}
/** `cw migration list|check|prove [target] …`. */
function handleMigration(args, runner) {
    const [subcommand, target] = args.positionals;
    switch (subcommand) {
        case "list":
            (0, io_1.printJson)(runner.migrationList());
            return;
        case "check": {
            const report = runner.migrationCheck((0, io_1.required)(target, "target (run-id or state/app file)"), args.options);
            (0, io_1.printJson)(report);
            if (report.status === "unsupported")
                process.exitCode = 1;
            return;
        }
        case "prove": {
            const proof = runner.migrationProve((0, io_1.required)(target, "target (run-id or state/app file)"), args.options);
            (0, io_1.printJson)(proof);
            if (!proof.pass)
                process.exitCode = 1;
            return;
        }
        default:
            throw new Error("Usage: cw.js migration list|check|prove [target] [--contract run-state|workflow-app]");
    }
}
/** `cw feedback list|show|summary|collect|task|resolve <run-id> [feedback-id]`. */
function handleFeedback(args, runner) {
    const [subcommand, runId, feedbackId] = args.positionals;
    switch (subcommand) {
        case "list":
            (0, io_1.printJson)(runner.listFeedback((0, io_1.required)(runId, "run id"), args.options));
            return;
        case "show":
            (0, io_1.printJson)(runner.showFeedback((0, io_1.required)(runId, "run id"), (0, io_1.required)(feedbackId, "feedback id")));
            return;
        case "collect":
            (0, io_1.printJson)(runner.collectFeedback((0, io_1.required)(runId, "run id")));
            return;
        case "summary": {
            const summary = runner.summarizeFeedbackRecords((0, io_1.required)(runId, "run id"));
            if ((0, io_1.wantsJson)(args.options))
                (0, io_1.printJson)(summary);
            else
                process.stdout.write(`${(0, operator_ux_1.formatFeedbackSummary)(summary)}\n`);
            return;
        }
        case "task":
            (0, io_1.printJson)(runner.createFeedbackTask((0, io_1.required)(runId, "run id"), (0, io_1.required)(feedbackId, "feedback id"), args.options));
            return;
        case "resolve":
            (0, io_1.printJson)(runner.resolveFeedback((0, io_1.required)(runId, "run id"), (0, io_1.required)(feedbackId, "feedback id"), args.options));
            return;
        default:
            throw new Error("Usage: cw.js feedback list|show|summary|collect|task|resolve <run-id> [feedback-id]");
    }
}
/** `cw metrics show <run-id> | metrics summary …`. */
function handleMetrics(args, runner) {
    const [subcommand, runId] = args.positionals;
    switch (subcommand) {
        case "show": {
            const report = runner.metricsShow((0, io_1.required)(runId, "run id"), args.options);
            if ((0, io_1.wantsJson)(args.options))
                (0, io_1.printJson)(report);
            else
                process.stdout.write(`${(0, observability_1.formatMetricsReport)(report)}\n`);
            return;
        }
        case "summary": {
            const report = (0, capability_core_1.metricsSummary)((0, capability_core_1.runRegistryFor)(args.options, runner), runner, args.options);
            if ((0, io_1.wantsJson)(args.options))
                (0, io_1.printJson)(report);
            else
                process.stdout.write(`${(0, observability_1.formatMetricsSummary)(report)}\n`);
            return;
        }
        default:
            throw new Error("Usage: cw.js metrics show <run-id> | metrics summary [--scope repo|home] [--pricing <path>|default] [--json]");
    }
}
