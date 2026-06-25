"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.handleBlackboard = handleBlackboard;
exports.handleCoordinator = handleCoordinator;
const state_explosion_1 = require("../../state-explosion");
const io_1 = require("../io");
/** `cw blackboard <verb> <run-id> …` — shared-blackboard read/write family. */
function handleBlackboard(args, runner) {
    const [subcommand, action, runId] = args.positionals;
    switch (subcommand) {
        case "summary":
            (0, io_1.printJson)(runner.blackboardSummary((0, io_1.required)(action, "run id"), args.options));
            return;
        case "summarize": {
            const digest = runner.blackboardSummarize((0, io_1.required)(action, "run id"), args.options);
            if ((0, io_1.wantsJson)(args.options))
                (0, io_1.printJson)(digest);
            else
                process.stdout.write(`${(0, state_explosion_1.formatBlackboardDigest)(digest)}\n`);
            return;
        }
        case "graph":
            (0, io_1.printJson)(runner.blackboardGraph((0, io_1.required)(action, "run id")));
            return;
        case "resolve":
            (0, io_1.printJson)(runner.resolveRunBlackboard((0, io_1.required)(action, "run id"), args.options));
            return;
        case "topic":
            if (action === "create") {
                (0, io_1.printJson)(runner.createBlackboardTopic((0, io_1.required)(runId, "run id"), args.options));
                return;
            }
            break;
        case "message":
            if (action === "post") {
                (0, io_1.printJson)(runner.postBlackboardMessage((0, io_1.required)(runId, "run id"), args.options));
                return;
            }
            if (action === "list") {
                (0, io_1.printJson)(runner.listBlackboardMessages((0, io_1.required)(runId, "run id"), args.options));
                return;
            }
            break;
        case "context":
            if (action === "put") {
                (0, io_1.printJson)(runner.putBlackboardContext((0, io_1.required)(runId, "run id"), args.options));
                return;
            }
            break;
        case "artifact":
            if (action === "add") {
                (0, io_1.printJson)(runner.addBlackboardArtifact((0, io_1.required)(runId, "run id"), args.options));
                return;
            }
            if (action === "list") {
                (0, io_1.printJson)(runner.listBlackboardArtifacts((0, io_1.required)(runId, "run id"), args.options));
                return;
            }
            break;
        case "snapshot":
            (0, io_1.printJson)(runner.snapshotBlackboard((0, io_1.required)(action, "run id"), args.options));
            return;
        default:
            break;
    }
    throw new Error("Usage: cw.js blackboard summary|summarize|graph|resolve <run-id> | topic create <run-id> | message post|list <run-id> | context put <run-id> | artifact add|list <run-id> | snapshot <run-id>");
}
/** `cw coordinator summary|decision <run-id> …` — coordinator decision ledger. */
function handleCoordinator(args, runner) {
    const [subcommand, runId] = args.positionals;
    switch (subcommand) {
        case "summary":
            (0, io_1.printJson)(runner.coordinatorSummary((0, io_1.required)(runId, "run id"), args.options));
            return;
        case "decision":
            (0, io_1.printJson)(runner.recordCoordinatorDecision((0, io_1.required)(runId, "run id"), args.options));
            return;
        default:
            throw new Error("Usage: cw.js coordinator summary <run-id> | coordinator decision <run-id> --kind <kind> --outcome <outcome> --reason TEXT");
    }
}
