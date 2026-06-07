#!/usr/bin/env node
"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_fs_1 = __importDefault(require("node:fs"));
const node_path_1 = __importDefault(require("node:path"));
const orchestrator_1 = require("./orchestrator");
const daemon_1 = require("./daemon");
const scheduler_1 = require("./scheduler");
const triggers_1 = require("./triggers");
async function main() {
    const args = (0, orchestrator_1.parseArgv)(process.argv.slice(2));
    const runner = new orchestrator_1.CoolWorkflowRunner({
        pluginRoot: node_path_1.default.resolve(__dirname, "..")
    });
    const scheduler = new scheduler_1.Scheduler(String(args.options.cwd || process.cwd()));
    const triggers = new triggers_1.RoutineTriggerBridge(String(args.options.cwd || process.cwd()));
    switch (args.command) {
        case "help":
        case undefined:
            process.stdout.write((0, orchestrator_1.formatHelp)());
            return;
        case "list":
            printJson(runner.listWorkflows());
            return;
        case "init": {
            const [workflowId] = args.positionals;
            if (!workflowId)
                throw new Error("Missing workflow id. Example: cw.js init my-workflow");
            printJson(runner.init(workflowId, args.options));
            return;
        }
        case "plan": {
            const [workflowId] = args.positionals;
            if (!workflowId)
                throw new Error("Missing workflow id. Example: cw.js plan architecture-review");
            const run = runner.plan(workflowId, args.options);
            printJson({
                runId: run.id,
                workflowId: run.workflow.id,
                statePath: run.paths.state,
                reportPath: run.paths.report,
                pendingTasks: run.tasks.filter((task) => task.status === "pending").length
            });
            return;
        }
        case "status":
            printJson(runner.status(required(args.positionals[0], "run id")));
            return;
        case "next":
            printJson(runner.next(required(args.positionals[0], "run id"), args.options));
            return;
        case "dispatch":
            printJson(runner.dispatch(required(args.positionals[0], "run id"), args.options));
            return;
        case "result": {
            const [runId, taskId, resultPath] = args.positionals;
            printJson(runner.recordResult(required(runId, "run id"), required(taskId, "task id"), required(resultPath, "result file")));
            return;
        }
        case "commit":
            printJson(runner.commit(required(args.positionals[0], "run id"), String(args.options.reason || "manual")));
            return;
        case "report": {
            const report = runner.report(required(args.positionals[0], "run id"));
            process.stdout.write(`${report.path}\n`);
            return;
        }
        case "contract": {
            const [subcommand, runId, contractId] = args.positionals;
            switch (subcommand) {
                case "show":
                    printJson(runner.showContract(required(runId, "run id"), contractId));
                    return;
                default:
                    throw new Error("Usage: cw.js contract show <run-id> [contract-id]");
            }
        }
        case "node": {
            const [subcommand, runId, nodeId] = args.positionals;
            switch (subcommand) {
                case "list":
                    printJson(runner.listNodes(required(runId, "run id")));
                    return;
                case "show":
                    printJson(runner.showNode(required(runId, "run id"), required(nodeId, "node id")));
                    return;
                case "graph":
                    printJson(runner.graphNodes(required(runId, "run id")));
                    return;
                default:
                    throw new Error("Usage: cw.js node list|show|graph <run-id> [node-id]");
            }
        }
        case "feedback": {
            const [subcommand, runId, feedbackId] = args.positionals;
            switch (subcommand) {
                case "list":
                    printJson(runner.listFeedback(required(runId, "run id"), args.options));
                    return;
                case "show":
                    printJson(runner.showFeedback(required(runId, "run id"), required(feedbackId, "feedback id")));
                    return;
                case "collect":
                    printJson(runner.collectFeedback(required(runId, "run id")));
                    return;
                case "task":
                    printJson(runner.createFeedbackTask(required(runId, "run id"), required(feedbackId, "feedback id"), args.options));
                    return;
                case "resolve":
                    printJson(runner.resolveFeedback(required(runId, "run id"), required(feedbackId, "feedback id"), args.options));
                    return;
                default:
                    throw new Error("Usage: cw.js feedback list|show|collect|task|resolve <run-id> [feedback-id]");
            }
        }
        case "worker": {
            const [subcommand, runId, workerId, resultPath] = args.positionals;
            switch (subcommand) {
                case "list":
                    printJson(runner.listWorkers(required(runId, "run id"), args.options));
                    return;
                case "show":
                    printJson(runner.showWorker(required(runId, "run id"), required(workerId, "worker id")));
                    return;
                case "manifest":
                    printJson(runner.showWorkerManifest(required(runId, "run id"), required(workerId, "worker id")));
                    return;
                case "output":
                    printJson(runner.recordWorkerOutput(required(runId, "run id"), required(workerId, "worker id"), required(resultPath, "result file")));
                    return;
                case "fail":
                    printJson(runner.recordWorkerFailure(required(runId, "run id"), required(workerId, "worker id"), String(args.options.message || args.options.m || required(resultPath, "failure message")), args.options));
                    return;
                case "validate":
                    printJson(runner.validateWorker(required(runId, "run id"), required(workerId, "worker id"), resultPath));
                    return;
                default:
                    throw new Error("Usage: cw.js worker list|show|manifest|output|fail|validate <run-id> [worker-id] [result-file]");
            }
        }
        case "candidate": {
            const [subcommand, runId, candidateId, reason] = args.positionals;
            switch (subcommand) {
                case "list":
                    printJson(runner.listCandidates(required(runId, "run id"), args.options));
                    return;
                case "show":
                    printJson(runner.showCandidate(required(runId, "run id"), required(candidateId, "candidate id")));
                    return;
                case "register":
                    printJson(runner.registerCandidate(required(runId, "run id"), args.options));
                    return;
                case "score":
                    printJson(runner.scoreCandidate(required(runId, "run id"), required(candidateId, "candidate id"), args.options));
                    return;
                case "rank":
                    printJson(runner.rankCandidates(required(runId, "run id"), args.options));
                    return;
                case "select":
                    printJson(runner.selectCandidate(required(runId, "run id"), required(candidateId, "candidate id"), args.options));
                    return;
                case "reject":
                    printJson(runner.rejectCandidate(required(runId, "run id"), required(candidateId, "candidate id"), String(args.options.reason || args.options.message || reason || "rejected")));
                    return;
                case "summary":
                    printJson(runner.summarizeCandidateRecords(required(runId, "run id")));
                    return;
                default:
                    throw new Error("Usage: cw.js candidate list|show|register|score|rank|select|reject|summary <run-id> [candidate-id]");
            }
        }
        case "loop": {
            printJson(scheduler.create({ ...args.options, kind: "loop" }));
            return;
        }
        case "schedule": {
            const [subcommand, id] = args.positionals;
            switch (subcommand) {
                case "create":
                    printJson(scheduler.create(args.options));
                    return;
                case "list":
                    printJson(scheduler.list(args.options.status ? String(args.options.status) : undefined));
                    return;
                case "delete":
                    printJson(scheduler.delete(required(id, "schedule id")));
                    return;
                case "due":
                    printJson(scheduler.due());
                    return;
                case "complete":
                    printJson(scheduler.complete(required(id, "schedule id"), args.options));
                    return;
                case "pause":
                    printJson(scheduler.pause(required(id, "schedule id")));
                    return;
                case "resume":
                    printJson(scheduler.resume(required(id, "schedule id")));
                    return;
                case "run-now":
                    printJson(scheduler.runNow(required(id, "schedule id")));
                    return;
                case "history":
                    printJson(scheduler.history(id));
                    return;
                case "daemon": {
                    const daemon = new daemon_1.DesktopSchedulerDaemon({
                        cwd: String(args.options.cwd || process.cwd()),
                        intervalSeconds: Number(args.options.intervalSeconds || args.options.interval || 60)
                    });
                    if (args.options.once) {
                        printJson(daemon.tick());
                        return;
                    }
                    await daemon.run();
                    return;
                }
                default:
                    throw new Error("Usage: cw.js schedule create|list|delete|due|complete|pause|resume|run-now|history|daemon");
            }
        }
        case "routine": {
            const [subcommand, idOrKind, payloadPath] = args.positionals;
            switch (subcommand) {
                case "create":
                    printJson(triggers.create(args.options));
                    return;
                case "list":
                    printJson(triggers.list(args.options.kind ? String(args.options.kind) : undefined));
                    return;
                case "delete":
                    printJson(triggers.delete(required(idOrKind, "trigger id")));
                    return;
                case "fire": {
                    const kind = required(idOrKind, "trigger kind");
                    const payload = payloadPath ? JSON.parse(node_fs_1.default.readFileSync(payloadPath, "utf8")) : args.options;
                    printJson(triggers.fire(kind, payload));
                    return;
                }
                case "events":
                    printJson(triggers.events(idOrKind));
                    return;
                default:
                    throw new Error("Usage: cw.js routine create|list|delete|fire|events");
            }
        }
        default:
            throw new Error(`Unknown command: ${args.command}`);
    }
}
function required(value, label) {
    if (!value)
        throw new Error(`Missing ${label}`);
    return value;
}
function printJson(value) {
    process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}
main().catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`cw: ${message}\n`);
    process.exitCode = 1;
});
