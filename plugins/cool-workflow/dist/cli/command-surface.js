"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.runCli = runCli;
const node_fs_1 = __importDefault(require("node:fs"));
const node_path_1 = __importDefault(require("node:path"));
const orchestrator_1 = require("../orchestrator");
const capability_core_1 = require("../capability-core");
const observability_1 = require("../observability");
const telemetry_demo_1 = require("../telemetry-demo");
const run_registry_1 = require("../run-registry");
const daemon_1 = require("../daemon");
const scheduler_1 = require("../scheduler");
const triggers_1 = require("../triggers");
const workbench_1 = require("../workbench");
const workbench_host_1 = require("../workbench-host");
const operator_ux_1 = require("../operator-ux");
const multi_agent_operator_ux_1 = require("../multi-agent-operator-ux");
const multi_agent_eval_1 = require("../multi-agent-eval");
const state_explosion_1 = require("../state-explosion");
const evidence_reasoning_1 = require("../evidence-reasoning");
const doctor_1 = require("../doctor");
async function runCli(argv = process.argv.slice(2)) {
    const args = (0, orchestrator_1.parseArgv)(argv);
    const runner = new orchestrator_1.CoolWorkflowRunner({
        pluginRoot: node_path_1.default.resolve(__dirname, "../..")
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
        case "doctor": {
            const report = (0, doctor_1.runDoctor)(args.options, process.env, String(args.options.cwd || process.cwd()));
            if (wantsJson(args.options))
                printJson(report);
            else
                process.stdout.write(`${(0, doctor_1.formatDoctorReport)(report)}\n`);
            if (!report.ok)
                process.exitCode = 1;
            return;
        }
        case "init": {
            const [workflowId] = args.positionals;
            if (!workflowId)
                throw new Error("Missing workflow id. Example: cw.js init my-workflow");
            printJson(runner.init(workflowId, args.options));
            return;
        }
        case "app": {
            const [subcommand, appIdOrPath] = args.positionals;
            switch (subcommand) {
                case "list":
                    printJson(runner.listApps());
                    return;
                case "show":
                    printJson(runner.showApp(required(appIdOrPath, "app id")));
                    return;
                case "validate": {
                    const result = runner.validateApp(required(appIdOrPath, "app path or id"));
                    printJson(result);
                    if (!result.valid)
                        process.exitCode = 1;
                    return;
                }
                case "init":
                    printJson(runner.initApp(required(appIdOrPath, "app id"), args.options));
                    return;
                case "package":
                    printJson(runner.packageApp(required(appIdOrPath, "app id"), args.options));
                    return;
                case "run":
                    printJson((0, capability_core_1.appRun)(runner, { ...args.options, appId: required(appIdOrPath, "app id") }));
                    return;
                default:
                    throw new Error("Usage: cw.js app list|show|validate|init|package|run [app-id|path]");
            }
        }
        case "quickstart":
        case "audit-run": {
            // ONE-COMMAND first value (v0.1.38+): plan(app) -> run --drive -> report in a
            // single invocation. A thin UX wrapper over the EXISTING drive() pipeline — it
            // DELEGATES worker execution to the operator's configured agent backend and
            // fails closed (status=blocked) when none is set. No new executor/scheduler.
            const [appId] = args.positionals;
            const runId = optionalArg(args.options.run) || optionalArg(args.options.runId);
            const qs = (0, capability_core_1.quickstart)(runner, { ...args.options, ...(appId ? { appId } : {}), ...(runId ? { runId } : {}) });
            printJson(qs);
            if (qs.mode === "check" && qs.ok === false) {
                process.exitCode = 1;
            }
            // Fail closed: if --bundle produced an artifact that does not self-verify, exit
            // non-zero so `cw quickstart ... --bundle && send-to-client` cannot ship a report
            // whose bundle a client could not verify. Mirrors `report bundle`.
            if (qs.bundle && qs.bundle.ok === false) {
                process.exitCode = 1;
            }
            return;
        }
        case "plan": {
            const [workflowId] = args.positionals;
            if (!workflowId)
                throw new Error("Missing workflow id. Example: cw.js plan architecture-review");
            printJson((0, capability_core_1.planSummary)(runner, workflowId, args.options));
            return;
        }
        case "status":
            if (!args.positionals[0]) {
                const nextActions = (0, operator_ux_1.adviseNoRun)();
                if (wantsJson(args.options))
                    printJson({ runId: null, nextActions });
                else
                    process.stdout.write(`No run selected\n\nNext Action\n${nextActions.map((action) => `  ${action.command}\n    reason: ${action.reason}`).join("\n")}\n`);
            }
            else if (wantsJson(args.options))
                printJson(runner.status(args.positionals[0]));
            else
                process.stdout.write(`${(0, operator_ux_1.formatOperatorStatus)(runner.operatorStatus(args.positionals[0]))}\n`);
            return;
        case "next":
            printJson(runner.next(required(args.positionals[0], "run id"), args.options));
            return;
        case "dispatch":
            printJson(runner.dispatch(required(args.positionals[0], "run id"), args.options));
            return;
        case "result": {
            const [runId, taskId, resultPath] = args.positionals;
            printJson(runner.recordResult(required(runId, "run id"), required(taskId, "task id"), required(resultPath, "result file"), args.options));
            return;
        }
        case "state": {
            const [subcommand, runId] = args.positionals;
            switch (subcommand) {
                case "check": {
                    const report = runner.checkState(required(runId, "run id"), args.options);
                    printJson(report);
                    if (report.status === "unsupported")
                        process.exitCode = 1;
                    return;
                }
                default:
                    throw new Error("Usage: cw.js state check <run-id> [--state PATH] [--write]");
            }
        }
        case "commit":
            if (args.positionals[0] === "summary") {
                const summary = runner.summarizeCommitRecords(required(args.positionals[1], "run id"));
                if (wantsJson(args.options))
                    printJson(summary);
                else
                    process.stdout.write(`${(0, operator_ux_1.formatCommitSummary)(summary)}\n`);
                return;
            }
            printJson(runner.commit(required(args.positionals[0], "run id"), args.options));
            return;
        case "report": {
            // `report verify-bundle <path>` is the offline self-contained bundle verifier;
            // `report bundle <run-id>` exports a sealed bundle and self-verifies it;
            // every other `report <run-id>` form prints/inspects a local run's report.
            if (args.positionals[0] === "verify-bundle") {
                const result = (0, capability_core_1.runVerifyReportBundle)(runner, { ...args.options, archive: args.positionals[1] || args.options.archive || args.options.path || args.options.file || args.options.bundle });
                printJson(result);
                // Fail closed: a forged/edited/corrupt bundle verifies false — surface it
                // through the exit code so `cw report verify-bundle <file> && ship` cannot
                // pass on a lie. Mirrors run inspect-archive / telemetry verify.
                if (!result.ok)
                    process.exitCode = 1;
                return;
            }
            if (args.positionals[0] === "bundle") {
                const result = (0, capability_core_1.reportBundle)(runner, required(args.positionals[1] || optionalArg(args.options.runId || args.options.run), "run id"), args.options);
                printJson(result);
                // Fail closed: never report a "bundle made" success if the artifact does not
                // self-verify — so `cw report bundle <run> && send-to-client` cannot ship an
                // unverifiable report (e.g. no trust key under --strict-signatures).
                if (!result.ok)
                    process.exitCode = 1;
                return;
            }
            const runId = required(args.positionals[0], "run id");
            const report = runner.report(runId);
            if (wantsJson(args.options)) {
                printJson(report);
            }
            else if (args.options.show || args.options.summary) {
                process.stdout.write(`${(0, operator_ux_1.formatOperatorReport)(runner.operatorReport(runId))}\n`);
                process.stdout.write(`\n${(0, state_explosion_1.formatStateExplosionReport)(runner.stateExplosionReport(runId))}\n`);
            }
            else {
                process.stdout.write(`${report.path}\n`);
            }
            return;
        }
        case "operator": {
            const [subcommand, runId] = args.positionals;
            switch (subcommand) {
                case "status":
                    if (wantsJson(args.options))
                        printJson(runner.operatorStatus(required(runId, "run id")));
                    else
                        process.stdout.write(`${(0, operator_ux_1.formatOperatorStatus)(runner.operatorStatus(required(runId, "run id")))}\n`);
                    return;
                case "report":
                    if (wantsJson(args.options))
                        printJson(runner.operatorReport(required(runId, "run id")));
                    else
                        process.stdout.write(`${(0, operator_ux_1.formatOperatorReport)(runner.operatorReport(required(runId, "run id")))}\n`);
                    return;
                default:
                    throw new Error("Usage: cw.js operator status|report <run-id> [--json]");
            }
        }
        case "graph": {
            const graph = runner.operatorGraph(required(args.positionals[0], "run id"));
            if (wantsJson(args.options))
                printJson(graph);
            else
                process.stdout.write(`${(0, operator_ux_1.formatOperatorGraph)(graph)}\n`);
            return;
        }
        case "topology": {
            const [subcommand, first, second] = args.positionals;
            switch (subcommand) {
                case "list":
                    printJson(runner.listTopologies());
                    return;
                case "show":
                    if (second)
                        printJson(runner.showTopologyRun(required(first, "run id"), second));
                    else
                        printJson(runner.showTopology(required(first, "topology id")));
                    return;
                case "validate": {
                    const result = runner.validateTopology(required(first, "topology id"));
                    printJson(result);
                    if (!result.valid)
                        process.exitCode = 1;
                    return;
                }
                case "apply":
                    printJson(runner.applyTopology(required(first, "run id"), required(second, "topology id"), args.options));
                    return;
                case "summary": {
                    const summary = runner.topologySummary(required(first, "run id"));
                    if (wantsJson(args.options))
                        printJson(summary);
                    else
                        process.stdout.write(`${(0, operator_ux_1.formatTopologySummary)(summary)}\n`);
                    return;
                }
                case "graph": {
                    const graph = runner.topologyGraph(required(first, "run id"));
                    if (wantsJson(args.options))
                        printJson(graph);
                    else
                        process.stdout.write(`${(0, operator_ux_1.formatOperatorGraph)({ runId: required(first, "run id"), nodes: graph.nodes, edges: graph.edges })}\n`);
                    return;
                }
                default:
                    throw new Error("Usage: cw.js topology list|show <topology-id>|show <run-id> <topology-run-id>|validate <topology-id>|apply <run-id> <topology-id>|summary <run-id>|graph <run-id>");
            }
        }
        case "summary": {
            const [subcommand, runId] = args.positionals;
            switch (subcommand) {
                case "refresh": {
                    const index = runner.summaryRefresh(required(runId, "run id"), args.options);
                    if (wantsJson(args.options))
                        printJson(index);
                    else
                        process.stdout.write(`${(0, state_explosion_1.formatStateExplosionReport)(runner.summaryShow(required(runId, "run id")))}\n`);
                    return;
                }
                case "show": {
                    const report = runner.summaryShow(required(runId, "run id"));
                    if (wantsJson(args.options))
                        printJson(report);
                    else
                        process.stdout.write(`${(0, state_explosion_1.formatStateExplosionReport)(report)}\n`);
                    return;
                }
                default:
                    throw new Error("Usage: cw.js summary refresh|show <run-id> [--json]");
            }
        }
        case "multi-agent": {
            const [subcommand, runId, id] = args.positionals;
            switch (subcommand) {
                case "status":
                    if (wantsJson(args.options))
                        printJson(runner.hostMultiAgentStatus(required(runId, "run id")));
                    else
                        process.stdout.write(`${(0, multi_agent_operator_ux_1.formatMultiAgentOperatorStatus)(runner.multiAgentOperatorStatus(required(runId, "run id")))}\n`);
                    return;
                case "step":
                    printJson(runner.hostMultiAgentStep(required(runId, "run id"), args.options));
                    return;
                case "blackboard":
                    printJson(runner.hostMultiAgentBlackboard(required(runId, "run id"), id, args.options));
                    return;
                case "score":
                    printJson(runner.hostMultiAgentScore(required(runId, "run id"), { ...args.options, candidate: args.options.candidate || args.options.candidateId || id }));
                    return;
                case "select":
                    printJson(runner.hostMultiAgentSelect(required(runId, "run id"), { ...args.options, candidate: args.options.candidate || args.options.candidateId || id }));
                    return;
                case "summary": {
                    const summary = runner.multiAgentSummary(required(runId, "run id"));
                    if (wantsJson(args.options))
                        printJson(summary);
                    else
                        process.stdout.write(`${(0, operator_ux_1.formatMultiAgentSummary)(summary)}\n`);
                    return;
                }
                case "summarize": {
                    const report = runner.multiAgentSummarize(required(runId, "run id"));
                    if (wantsJson(args.options))
                        printJson(report);
                    else
                        process.stdout.write(`${(0, state_explosion_1.formatStateExplosionReport)(report)}\n`);
                    return;
                }
                case "graph": {
                    const wantsView = args.options.view || args.options.focus || args.options.depth;
                    if (wantsView) {
                        const graph = runner.multiAgentGraphView(required(runId, "run id"), args.options);
                        if (wantsJson(args.options))
                            printJson(graph);
                        else
                            process.stdout.write(`${(0, state_explosion_1.formatCompactGraph)(graph)}\n`);
                        return;
                    }
                    const graph = runner.multiAgentOperatorGraph(required(runId, "run id"));
                    if (wantsJson(args.options))
                        printJson(graph);
                    else
                        process.stdout.write(`${(0, operator_ux_1.formatOperatorGraph)({ runId: required(runId, "run id"), nodes: graph.nodes, edges: graph.edges })}\n`);
                    return;
                }
                case "dependencies": {
                    const rows = runner.multiAgentDependencies(required(runId, "run id"));
                    if (wantsJson(args.options))
                        printJson(rows);
                    else
                        process.stdout.write(`${(0, multi_agent_operator_ux_1.formatMultiAgentDependencies)(rows)}\n`);
                    return;
                }
                case "failures": {
                    const rows = runner.multiAgentFailures(required(runId, "run id"));
                    if (wantsJson(args.options))
                        printJson(rows);
                    else
                        process.stdout.write(`${(0, multi_agent_operator_ux_1.formatMultiAgentFailures)(rows)}\n`);
                    return;
                }
                case "evidence": {
                    const rows = runner.multiAgentEvidence(required(runId, "run id"));
                    if (wantsJson(args.options))
                        printJson(rows);
                    else
                        process.stdout.write(`${(0, multi_agent_operator_ux_1.formatMultiAgentEvidence)(rows)}\n`);
                    return;
                }
                case "reasoning": {
                    if (args.options.refresh && !args.options.evidence && !args.options.evidenceId) {
                        const index = runner.multiAgentReasoningRefresh(required(runId, "run id"));
                        printJson(index);
                        return;
                    }
                    const report = runner.multiAgentReasoning(required(runId, "run id"), { ...args.options, evidence: args.options.evidence || args.options.evidenceId || id });
                    if (wantsJson(args.options))
                        printJson(report);
                    else
                        process.stdout.write(`${(0, evidence_reasoning_1.formatEvidenceReasoningReport)(report)}\n`);
                    return;
                }
                case "run":
                    if (!runId ||
                        args.options.topology ||
                        args.options.topologyId ||
                        args.options.app ||
                        args.options.appId ||
                        args.options.workflow ||
                        args.options.workflowId) {
                        printJson(runner.hostMultiAgentRun(runId, args.options));
                        return;
                    }
                    if (id && !args.options.id && !args.options.status)
                        printJson(runner.showMultiAgentRun(required(runId, "run id"), id));
                    else if (id && args.options.status)
                        printJson(runner.transitionMultiAgentRun(required(runId, "run id"), id, args.options));
                    else
                        printJson(runner.createMultiAgentRun(required(runId, "run id"), args.options));
                    return;
                case "show":
                    printJson(runner.showMultiAgentRun(required(runId, "run id"), required(id, "multi-agent run id")));
                    return;
                case "role":
                    if (id && !args.options.id && !args.options["multi-agent-run"] && !args.options.multiAgentRun && !args.options.multiAgentRunId) {
                        printJson(runner.showAgentRole(required(runId, "run id"), id));
                    }
                    else {
                        printJson(runner.createAgentRole(required(runId, "run id"), { ...args.options, id: args.options.id || id }));
                    }
                    return;
                case "group":
                    if (id && !args.options.id && !args.options["multi-agent-run"] && !args.options.multiAgentRun && !args.options.multiAgentRunId) {
                        printJson(runner.showAgentGroup(required(runId, "run id"), id));
                    }
                    else {
                        printJson(runner.createAgentGroup(required(runId, "run id"), { ...args.options, id: args.options.id || id }));
                    }
                    return;
                case "membership":
                    if (id && !args.options.id && !args.options.group && !args.options.groupId && !args.options["multi-agent-group"]) {
                        printJson(runner.showAgentMembership(required(runId, "run id"), id));
                    }
                    else {
                        printJson(runner.assignAgentMembership(required(runId, "run id"), { ...args.options, id: args.options.id || id }));
                    }
                    return;
                case "fanout":
                    if (id && !args.options.id && !args.options.group && !args.options.groupId && !args.options["multi-agent-group"]) {
                        printJson(runner.showAgentFanout(required(runId, "run id"), id));
                    }
                    else {
                        printJson(runner.createAgentFanout(required(runId, "run id"), { ...args.options, id: args.options.id || id }));
                    }
                    return;
                case "fanin":
                    if (id && !args.options.id && !args.options.group && !args.options.groupId && !args.options["multi-agent-group"] && !args.options.fanout) {
                        printJson(runner.showAgentFanin(required(runId, "run id"), id));
                    }
                    else {
                        printJson(runner.collectAgentFanin(required(runId, "run id"), { ...args.options, id: args.options.id || id }));
                    }
                    return;
                default:
                    throw new Error("Usage: cw.js multi-agent run|status|step|blackboard|score|select|summary|summarize|graph|dependencies|failures|evidence|reasoning|show|role|group|membership|fanout|fanin <run-id> [id]");
            }
        }
        case "eval": {
            const [subcommand, first, second] = args.positionals;
            let result;
            switch (subcommand) {
                case "snapshot":
                    result = runner.evalSnapshot(required(first, "run id"), args.options);
                    break;
                case "replay":
                    result = runner.evalReplay(required(first, "snapshot id or path"), args.options);
                    break;
                case "compare":
                    result = runner.evalCompare(required(first, "baseline id or path"), required(second, "replay id or path"));
                    break;
                case "score":
                    result = runner.evalScore(required(first, "replay id or path"));
                    break;
                case "gate":
                    result = runner.evalGate(required(first, "suite id or path"));
                    if (!wantsJson(args.options) && result.status === "fail")
                        process.exitCode = 1;
                    break;
                case "report":
                    result = runner.evalReport(required(first, "replay id or path"));
                    break;
                default:
                    throw new Error("Usage: cw.js eval snapshot <run-id> --id <snapshot-id> | replay <snapshot-id-or-path> | compare <baseline-id-or-path> <replay-id-or-path> | score <replay-id-or-path> | gate <suite-id-or-path> | report <replay-id-or-path>");
            }
            if (wantsJson(args.options))
                printJson(result);
            else
                process.stdout.write(`${(0, multi_agent_eval_1.formatMultiAgentEval)(result)}\n`);
            if (subcommand === "gate" && result.status === "fail")
                process.exitCode = 1;
            return;
        }
        case "blackboard": {
            const [subcommand, action, runId] = args.positionals;
            switch (subcommand) {
                case "summary":
                    printJson(runner.blackboardSummary(required(action, "run id"), args.options));
                    return;
                case "summarize": {
                    const digest = runner.blackboardSummarize(required(action, "run id"), args.options);
                    if (wantsJson(args.options))
                        printJson(digest);
                    else
                        process.stdout.write(`${(0, state_explosion_1.formatBlackboardDigest)(digest)}\n`);
                    return;
                }
                case "graph":
                    printJson(runner.blackboardGraph(required(action, "run id")));
                    return;
                case "resolve":
                    printJson(runner.resolveRunBlackboard(required(action, "run id"), args.options));
                    return;
                case "topic":
                    if (action === "create") {
                        printJson(runner.createBlackboardTopic(required(runId, "run id"), args.options));
                        return;
                    }
                    break;
                case "message":
                    if (action === "post") {
                        printJson(runner.postBlackboardMessage(required(runId, "run id"), args.options));
                        return;
                    }
                    if (action === "list") {
                        printJson(runner.listBlackboardMessages(required(runId, "run id"), args.options));
                        return;
                    }
                    break;
                case "context":
                    if (action === "put") {
                        printJson(runner.putBlackboardContext(required(runId, "run id"), args.options));
                        return;
                    }
                    break;
                case "artifact":
                    if (action === "add") {
                        printJson(runner.addBlackboardArtifact(required(runId, "run id"), args.options));
                        return;
                    }
                    if (action === "list") {
                        printJson(runner.listBlackboardArtifacts(required(runId, "run id"), args.options));
                        return;
                    }
                    break;
                case "snapshot":
                    printJson(runner.snapshotBlackboard(required(action, "run id"), args.options));
                    return;
                default:
                    break;
            }
            throw new Error("Usage: cw.js blackboard summary|summarize|graph|resolve <run-id> | topic create <run-id> | message post|list <run-id> | context put <run-id> | artifact add|list <run-id> | snapshot <run-id>");
        }
        case "coordinator": {
            const [subcommand, runId] = args.positionals;
            switch (subcommand) {
                case "summary":
                    printJson(runner.coordinatorSummary(required(runId, "run id"), args.options));
                    return;
                case "decision":
                    printJson(runner.recordCoordinatorDecision(required(runId, "run id"), args.options));
                    return;
                default:
                    throw new Error("Usage: cw.js coordinator summary <run-id> | coordinator decision <run-id> --kind <kind> --outcome <outcome> --reason TEXT");
            }
        }
        case "sandbox": {
            const [subcommand, profileIdOrFile] = args.positionals;
            switch (subcommand) {
                case "list":
                    printJson(runner.listSandboxProfiles(args.options));
                    return;
                case "show":
                    printJson(runner.showSandboxProfile(required(profileIdOrFile, "profile id"), args.options));
                    return;
                case "validate": {
                    const result = runner.validateSandboxProfile(required(profileIdOrFile, "profile file"), args.options);
                    printJson(result);
                    if (!result.valid)
                        process.exitCode = 1;
                    return;
                }
                case "choose":
                case "resolve":
                    printJson((0, capability_core_1.sandboxChoose)(runner, { ...args.options, profileId: profileIdOrFile || args.options.profileId }));
                    return;
                default:
                    throw new Error("Usage: cw.js sandbox list|show|validate|choose|resolve [profile-id|profile-file]");
            }
        }
        case "backend": {
            const [subcommand, backendId] = args.positionals;
            switch (subcommand) {
                case "list":
                    printJson(runner.listBackends(args.options));
                    return;
                case "show":
                    printJson(runner.showBackend(required(backendId, "backend id"), args.options));
                    return;
                case "probe":
                    printJson(runner.probeBackend(backendId, args.options));
                    return;
                case "agent": {
                    // `backend agent config [show]` = read-only; `backend agent config set ...` = mutating.
                    const [, , action] = args.positionals;
                    if (action === "set") {
                        printJson((0, capability_core_1.backendAgentConfigSet)(args.options));
                        return;
                    }
                    printJson((0, capability_core_1.backendAgentConfigShow)(args.options));
                    return;
                }
                default:
                    throw new Error("Usage: cw.js backend list|show|probe [backend-id]  |  cw.js backend agent config [show|set] [--agent-command ... --agent-endpoint ... --agent-model ...]");
            }
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
                    if (wantsJson(args.options))
                        printJson(runner.graphNodes(required(runId, "run id")));
                    else
                        process.stdout.write(`${(0, operator_ux_1.formatOperatorGraph)(runner.operatorGraph(required(runId, "run id")))}\n`);
                    return;
                case "snapshot":
                    printJson(runner.nodeSnapshot(required(runId, "run id"), required(nodeId, "node id")));
                    return;
                case "diff":
                    printJson(runner.nodeDiff(required(runId, "run id"), required(nodeId, "baseline snapshot id"), required(args.positionals[3], "candidate snapshot id")));
                    return;
                case "replay":
                    printJson(runner.nodeReplay(required(runId, "run id"), required(nodeId, "snapshot id")));
                    return;
                case "verify": {
                    const verdict = runner.nodeReplayVerify(required(runId, "run id"), required(nodeId, "replay id"));
                    printJson(verdict);
                    if (!verdict.pass)
                        process.exitCode = 1;
                    return;
                }
                default:
                    throw new Error("Usage: cw.js node list|show|graph|snapshot|diff|replay|verify <run-id> [node-id|snapshot-id|replay-id]");
            }
        }
        case "migration": {
            const [subcommand, target] = args.positionals;
            switch (subcommand) {
                case "list":
                    printJson(runner.migrationList());
                    return;
                case "check": {
                    const report = runner.migrationCheck(required(target, "target (run-id or state/app file)"), args.options);
                    printJson(report);
                    if (report.status === "unsupported")
                        process.exitCode = 1;
                    return;
                }
                case "prove": {
                    const proof = runner.migrationProve(required(target, "target (run-id or state/app file)"), args.options);
                    printJson(proof);
                    if (!proof.pass)
                        process.exitCode = 1;
                    return;
                }
                default:
                    throw new Error("Usage: cw.js migration list|check|prove [target] [--contract run-state|workflow-app]");
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
                case "summary": {
                    const summary = runner.summarizeFeedbackRecords(required(runId, "run id"));
                    if (wantsJson(args.options))
                        printJson(summary);
                    else
                        process.stdout.write(`${(0, operator_ux_1.formatFeedbackSummary)(summary)}\n`);
                    return;
                }
                case "task":
                    printJson(runner.createFeedbackTask(required(runId, "run id"), required(feedbackId, "feedback id"), args.options));
                    return;
                case "resolve":
                    printJson(runner.resolveFeedback(required(runId, "run id"), required(feedbackId, "feedback id"), args.options));
                    return;
                default:
                    throw new Error("Usage: cw.js feedback list|show|summary|collect|task|resolve <run-id> [feedback-id]");
            }
        }
        case "worker": {
            const [subcommand, runId, workerId, resultPath] = args.positionals;
            switch (subcommand) {
                case "list":
                    printJson(runner.listWorkers(required(runId, "run id"), args.options));
                    return;
                case "summary": {
                    const summary = runner.summarizeWorkerRecords(required(runId, "run id"));
                    if (wantsJson(args.options))
                        printJson(summary);
                    else
                        process.stdout.write(`${(0, operator_ux_1.formatWorkerSummary)(summary)}\n`);
                    return;
                }
                case "show":
                    printJson(runner.showWorker(required(runId, "run id"), required(workerId, "worker id")));
                    return;
                case "manifest":
                    printJson(runner.showWorkerManifest(required(runId, "run id"), required(workerId, "worker id")));
                    return;
                case "output":
                    printJson(runner.recordWorkerOutput(required(runId, "run id"), required(workerId, "worker id"), required(resultPath, "result file"), args.options));
                    return;
                case "fail":
                    printJson(runner.recordWorkerFailure(required(runId, "run id"), required(workerId, "worker id"), String(args.options.message || required(resultPath, "failure message")), args.options));
                    return;
                case "validate": {
                    // Non-null = a boundary violation: a validate verb must report an invalid
                    // verdict through its exit code, not just print it and exit 0.
                    const violation = runner.validateWorker(required(runId, "run id"), required(workerId, "worker id"), resultPath);
                    printJson(violation);
                    if (violation)
                        process.exitCode = 1;
                    return;
                }
                default:
                    throw new Error("Usage: cw.js worker list|summary|show|manifest|output|fail|validate <run-id> [worker-id] [result-file]");
            }
        }
        case "audit": {
            const [subcommand, runId, id] = args.positionals;
            switch (subcommand) {
                case "summary":
                    printJson(runner.auditSummary(required(runId, "run id")));
                    return;
                case "verify": {
                    const result = (0, capability_core_1.auditVerify)(runner, { ...args.options, runId: required(runId, "run id") });
                    printJson(result);
                    // Fail-closed: any unverified chain exits non-zero so `cw audit verify
                    // <run> && deploy` stops — mirrors the telemetry-verify guard. verifyTrustAudit
                    // returns verified:true for a truly absent/empty chain (nothing to prove),
                    // so this stays exit 0 there; a FULLY-corrupt log reports present:false but
                    // verified:false (corruptLines>0) and must NOT be conflated with absent — the
                    // earlier `present && ...` guard let that severe tamper escape (exit 0).
                    if (!result.verified)
                        process.exitCode = 1;
                    return;
                }
                case "worker":
                    printJson(runner.workerAudit(required(runId, "run id"), required(id, "worker id")));
                    return;
                case "provenance":
                    printJson(runner.evidenceProvenance(required(runId, "run id"), args.options));
                    return;
                case "multi-agent": {
                    const view = runner.auditMultiAgent(required(runId, "run id"));
                    if (wantsJson(args.options))
                        printJson(view);
                    else
                        process.stdout.write(`${(0, operator_ux_1.formatMultiAgentTrustAudit)(view)}\n`);
                    return;
                }
                case "policy": {
                    const view = runner.auditPolicy(required(runId, "run id"));
                    if (wantsJson(args.options))
                        printJson(view);
                    else
                        process.stdout.write(`${(0, operator_ux_1.formatMultiAgentTrustAudit)(view)}\n`);
                    return;
                }
                case "role": {
                    const view = runner.auditRole(required(runId, "run id"), required(id, "role id"));
                    if (wantsJson(args.options))
                        printJson(view);
                    else
                        process.stdout.write(`${(0, operator_ux_1.formatMultiAgentTrustAudit)(view)}\n`);
                    return;
                }
                case "blackboard": {
                    const view = runner.auditBlackboard(required(runId, "run id"));
                    if (wantsJson(args.options))
                        printJson(view);
                    else
                        process.stdout.write(`${(0, operator_ux_1.formatMultiAgentTrustAudit)(view)}\n`);
                    return;
                }
                case "judge": {
                    const view = runner.auditJudge(required(runId, "run id"));
                    if (wantsJson(args.options))
                        printJson(view);
                    else
                        process.stdout.write(`${(0, operator_ux_1.formatMultiAgentTrustAudit)(view)}\n`);
                    return;
                }
                case "attest":
                    printJson(runner.recordAuditAttestation(required(runId, "run id"), args.options));
                    return;
                case "decision":
                    printJson(runner.recordAuditDecision(required(runId, "run id"), required(id, "worker id"), args.options));
                    return;
                default:
                    throw new Error("Usage: cw.js audit summary|worker|provenance|multi-agent|policy|role|blackboard|judge|attest|decision <run-id> [worker-id|role-id]");
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
                    if (wantsJson(args.options))
                        printJson(runner.summarizeCandidateOperatorRecords(required(runId, "run id")));
                    else
                        process.stdout.write(`${(0, operator_ux_1.formatCandidateSummary)(runner.summarizeCandidateOperatorRecords(required(runId, "run id")))}\n`);
                    return;
                default:
                    throw new Error("Usage: cw.js candidate list|show|register|score|rank|select|reject|summary <run-id> [candidate-id]");
            }
        }
        // ---- Team Collaboration (v0.1.32) ------------------------------------
        case "approve": {
            const [targetKind, runId, targetId] = args.positionals;
            printJson(runner.collaborationApprove(required(runId, "run id"), required(targetKind, "target kind (candidate|commit|selection|run|task|node)"), required(targetId, "target id"), args.options));
            return;
        }
        case "reject": {
            const [targetKind, runId, targetId] = args.positionals;
            printJson(runner.collaborationReject(required(runId, "run id"), required(targetKind, "target kind (candidate|commit|selection|run|task|node)"), required(targetId, "target id"), args.options));
            return;
        }
        case "comment": {
            const [subcommand, ...rest] = args.positionals;
            if (subcommand === "add") {
                const [targetKind, runId, targetId] = rest;
                printJson(runner.collaborationComment(required(runId, "run id"), required(targetKind, "target kind"), required(targetId, "target id"), args.options));
                return;
            }
            if (subcommand === "list") {
                const result = runner.collaborationCommentList(required(rest[0], "run id"), args.options);
                if (wantsJson(args.options))
                    printJson(result);
                else
                    process.stdout.write(`${runner.formatCommentList(result.comments)}\n`);
                return;
            }
            throw new Error("Usage: cw.js comment add <kind> <run-id> <target-id> --body <text> | comment list <run-id> [--json]");
        }
        case "handoff": {
            const [targetKind, runId, targetIdRaw] = args.positionals;
            const kind = required(targetKind, "target kind (run|task|candidate|commit|node)");
            const rid = required(runId, "run id");
            const targetId = targetIdRaw || (kind === "run" ? rid : undefined);
            printJson(runner.collaborationHandoff(rid, kind, required(targetId, "target id"), args.options));
            return;
        }
        case "review": {
            const [subcommand, runId] = args.positionals;
            if (subcommand === "status") {
                const report = runner.reviewStatus(required(runId, "run id"), args.options);
                if (wantsJson(args.options))
                    printJson(report);
                else
                    process.stdout.write(`${runner.formatReviewStatus(report)}\n`);
                return;
            }
            if (subcommand === "policy") {
                printJson(runner.reviewPolicy(required(runId, "run id"), args.options));
                return;
            }
            throw new Error("Usage: cw.js review status <run-id> [--json] | review policy <run-id> --required-approvals N --authorized-roles a,b --applies-to commit,selection");
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
        case "registry": {
            const registry = (0, capability_core_1.runRegistryFor)(args.options, runner);
            const [subcommand] = args.positionals;
            switch (subcommand) {
                case "refresh": {
                    const report = (0, capability_core_1.runRegistryRefresh)(registry, args.options);
                    if (wantsJson(args.options))
                        printJson(report);
                    else
                        process.stdout.write(`${(0, run_registry_1.formatRegistryReport)(report)}\n`);
                    return;
                }
                case "show": {
                    const report = (0, capability_core_1.runRegistryShow)(registry, args.options);
                    if (wantsJson(args.options))
                        printJson(report);
                    else
                        process.stdout.write(`${(0, run_registry_1.formatRegistryReport)(report)}\n`);
                    return;
                }
                default:
                    throw new Error("Usage: cw.js registry refresh|show [--scope repo|home] [--json]");
            }
        }
        case "metrics": {
            const [subcommand, runId] = args.positionals;
            switch (subcommand) {
                case "show": {
                    const report = runner.metricsShow(required(runId, "run id"), args.options);
                    if (wantsJson(args.options))
                        printJson(report);
                    else
                        process.stdout.write(`${(0, observability_1.formatMetricsReport)(report)}\n`);
                    return;
                }
                case "summary": {
                    const report = (0, capability_core_1.metricsSummary)((0, capability_core_1.runRegistryFor)(args.options, runner), runner, args.options);
                    if (wantsJson(args.options))
                        printJson(report);
                    else
                        process.stdout.write(`${(0, observability_1.formatMetricsSummary)(report)}\n`);
                    return;
                }
                default:
                    throw new Error("Usage: cw.js metrics show <run-id> | metrics summary [--scope repo|home] [--pricing <path>|default] [--json]");
            }
        }
        case "run": {
            // Agent Delegation Drive (v0.1.38): `cw run <app> --drive [--once]` drives a
            // run end-to-end by delegating each worker to the agent backend. Distinct from
            // the run-REGISTRY verbs below. `--preview` (or the `run drive <run-id>` form)
            // is the read-only, deterministic next-step preview.
            //
            // A run-REGISTRY subcommand keyword (resume/show/...) must NOT be intercepted
            // here just because it carries a --drive flag of its own — e.g.
            // `run resume <id> --drive` is the resume verb's opt-in continuation, not
            // `run <app=resume> --drive`. Fall through to the switch for those keywords.
            const runRegistrySubcommand = new Set([
                "drive", "search", "list", "show", "resume", "archive", "rerun", "export", "import", "verify-import", "inspect-archive"
            ]);
            if (args.options.drive && !runRegistrySubcommand.has(String(args.positionals[0] || ""))) {
                const target = args.positionals[0];
                const runId = optionalArg(args.options.run) || optionalArg(args.options.runId);
                if (args.options.preview) {
                    printJson((0, capability_core_1.runDrivePreview)(runner, { ...args.options, runId: runId || target }));
                    return;
                }
                const driveArgs = { ...args.options };
                if (runId)
                    driveArgs.runId = runId;
                else
                    driveArgs.appId = target;
                printJson((0, capability_core_1.runDrive)(runner, driveArgs));
                return;
            }
            const registry = (0, capability_core_1.runRegistryFor)(args.options, runner);
            const [subcommand, id] = args.positionals;
            switch (subcommand) {
                case "drive": {
                    // `run drive <run-id>` = read-only preview; `--step [--once]` = mutating drive.
                    if (args.options.step) {
                        const driveArgs = { ...args.options };
                        if (id)
                            driveArgs.runId = id;
                        printJson((0, capability_core_1.runDrive)(runner, driveArgs));
                        return;
                    }
                    printJson((0, capability_core_1.runDrivePreview)(runner, { ...args.options, runId: required(id, "run id") }));
                    return;
                }
                case "search": {
                    const result = (0, capability_core_1.runSearch)(registry, args.options);
                    if (wantsJson(args.options))
                        printJson(result);
                    else
                        process.stdout.write(`${(0, run_registry_1.formatRunSearch)(result)}\n`);
                    return;
                }
                case "list": {
                    const result = (0, capability_core_1.runList)(registry, args.options);
                    if (wantsJson(args.options))
                        printJson(result);
                    else
                        process.stdout.write(`${(0, run_registry_1.formatRunSearch)(result)}\n`);
                    return;
                }
                case "show": {
                    const result = (0, capability_core_1.runShow)(registry, required(id, "run id"), args.options);
                    if (wantsJson(args.options))
                        printJson(result);
                    else
                        process.stdout.write(`${(0, run_registry_1.formatRunShow)(result)}\n`);
                    return;
                }
                case "resume": {
                    const result = (0, capability_core_1.runResume)(registry, runner, required(id, "run id"), args.options);
                    if (wantsJson(args.options))
                        printJson(result);
                    else
                        process.stdout.write(`${(0, run_registry_1.formatResume)(result)}\n`);
                    return;
                }
                case "archive":
                    printJson((0, capability_core_1.runArchive)(registry, id, args.options));
                    return;
                case "rerun":
                    printJson((0, capability_core_1.runRerun)(registry, required(id, "run id"), args.options));
                    return;
                case "export":
                    printJson((0, capability_core_1.runExportArchive)(runner, required(id || optionalArg(args.options.runId || args.options.run), "run id"), args.options));
                    return;
                case "import":
                    printJson((0, capability_core_1.runImportArchive)(runner, { ...args.options, archive: id || args.options.archive || args.options.path }));
                    return;
                case "verify-import": {
                    const result = (0, capability_core_1.runVerifyImport)(runner, required(id || optionalArg(args.options.runId || args.options.run), "run id"), args.options);
                    printJson(result);
                    // Fail-closed ONLY behind --strict, so the default exit stays 0
                    // (byte-identical). With --strict, any failed restore check — including
                    // the new trust-audit row — exits 1 for `verify-import && restore`.
                    if (Boolean(args.options.strict) && !result.ok)
                        process.exitCode = 1;
                    return;
                }
                case "inspect-archive": {
                    const result = (0, capability_core_1.runInspectArchive)(runner, { ...args.options, archive: id || args.options.archive || args.options.path });
                    printJson(result);
                    // Read-only diagnostic: exit 1 when the archive fails any integrity check,
                    // so `cw run inspect-archive <path> && restore` stops on a bad archive.
                    if (!result.ok)
                        process.exitCode = 1;
                    return;
                }
                default:
                    throw new Error("Usage: cw.js run search|list|show|resume|archive|rerun|drive|export|import|verify-import|inspect-archive [run-id|archive] [--scope repo|home] [--json]  |  cw.js run <app> --drive [--once] [--repo R --question Q]");
            }
        }
        case "queue": {
            const registry = (0, capability_core_1.runRegistryFor)(args.options, runner);
            const [subcommand, id] = args.positionals;
            switch (subcommand) {
                case "add":
                    printJson((0, capability_core_1.queueAdd)(registry, args.options));
                    return;
                case "list": {
                    const result = (0, capability_core_1.queueList)(registry, args.options);
                    if (wantsJson(args.options))
                        printJson(result);
                    else
                        process.stdout.write(`${(0, run_registry_1.formatQueueList)(result)}\n`);
                    return;
                }
                case "drain":
                    printJson((0, capability_core_1.queueDrain)(registry, args.options));
                    return;
                case "show":
                    printJson((0, capability_core_1.queueShow)(registry, required(id, "queue id")));
                    return;
                default:
                    throw new Error("Usage: cw.js queue add|list|drain|show [queue-id] [--repo PATH] [--priority N]");
            }
        }
        case "sched": {
            const registry = (0, capability_core_1.runRegistryFor)(args.options, runner);
            const [subcommand, idArg] = args.positionals;
            switch (subcommand) {
                case "plan":
                    printJson((0, capability_core_1.schedPlan)(registry, args.options));
                    return;
                case "lease":
                    printJson((0, capability_core_1.schedLease)(registry, args.options));
                    return;
                case "release":
                    printJson((0, capability_core_1.schedRelease)(registry, { ...args.options, leaseId: args.options.leaseId || idArg }));
                    return;
                case "complete":
                    printJson((0, capability_core_1.schedComplete)(registry, { ...args.options, leaseId: args.options.leaseId || idArg }));
                    return;
                case "reclaim":
                    printJson((0, capability_core_1.schedReclaim)(registry, args.options));
                    return;
                case "reset":
                    printJson((0, capability_core_1.schedReset)(registry, { ...args.options, id: args.options.id || idArg }));
                    return;
                case "policy": {
                    const [, action] = args.positionals;
                    if (action === "set") {
                        printJson((0, capability_core_1.schedPolicySet)(registry, args.options));
                        return;
                    }
                    printJson((0, capability_core_1.schedPolicyShow)(registry));
                    return;
                }
                default:
                    throw new Error("Usage: cw.js sched plan|lease|release|complete|reclaim|reset|policy [show|set] [id] [--maxConcurrent N --maxAttempts N ...]");
            }
        }
        case "gc": {
            // Run Retention & Provable Reclamation (v0.1.39). `plan` is a pure dry-run
            // (frees nothing); `run` executes the write-ahead reclamation transaction;
            // `verify` re-proves a reclaimed run. CW never reclaims by default.
            const registry = (0, capability_core_1.runRegistryFor)(args.options, runner);
            const [subcommand, id] = args.positionals;
            switch (subcommand) {
                case "plan": {
                    const result = (0, capability_core_1.gcPlan)(registry, id, args.options);
                    if (wantsJson(args.options))
                        printJson(result);
                    else
                        process.stdout.write(`${(0, run_registry_1.formatGcPlan)(result)}\n`);
                    return;
                }
                case "run": {
                    const result = (0, capability_core_1.gcRun)(registry, id, args.options);
                    if (wantsJson(args.options))
                        printJson(result);
                    else
                        process.stdout.write(`${(0, run_registry_1.formatGcRun)(result)}\n`);
                    return;
                }
                case "verify": {
                    const result = (0, capability_core_1.gcVerify)(registry, required(id, "run id"), args.options);
                    if (wantsJson(args.options))
                        printJson(result);
                    else
                        process.stdout.write(`${(0, run_registry_1.formatGcVerify)(result)}\n`);
                    // Fail closed ONLY on a real integrity failure: a run that WAS reclaimed
                    // but no longer re-proves. A not-reclaimed run has nothing to verify
                    // (reclaimed:false/verified:false) and must not be treated as a failure.
                    // LIMIT (honest): a DELETED reclaimed.json reads as reclaimed:false, so
                    // proof-deletion is indistinguishable from never-reclaimed here without
                    // an independent witness (e.g. a trust-audit reclamation event) — a
                    // follow-up. This guard is still strictly better than the prior exit-0.
                    if (result.reclaimed && !result.verified)
                        process.exitCode = 1;
                    return;
                }
                default:
                    throw new Error("Usage: cw.js gc plan|run|verify [run-id] [--reclaimAfterArchiveDays N] [--keep-scratch] [--keep-snapshots] [--limit N] [--json]");
            }
        }
        case "history": {
            const registry = (0, capability_core_1.runRegistryFor)(args.options, runner);
            const result = (0, capability_core_1.runHistory)(registry, args.options);
            if (wantsJson(args.options))
                printJson(result);
            else
                process.stdout.write(`${(0, run_registry_1.formatHistory)(result)}\n`);
            return;
        }
        case "telemetry": {
            const [subcommand, id] = args.positionals;
            switch (subcommand) {
                case "verify": {
                    const result = (0, capability_core_1.telemetryVerify)(runner, { ...args.options, runId: id || args.options.runId || args.options.run });
                    if (wantsJson(args.options))
                        printJson(result);
                    else
                        process.stdout.write(`${(0, telemetry_demo_1.formatTelemetryVerify)(result)}\n`);
                    // Fail closed: a forged/edited/corrupt ledger verifies false — report it
                    // through the exit code so `cw telemetry verify <run> && deploy` cannot
                    // pass on a lie. (Absent ledger = present:false/verified:true -> exit 0.)
                    if (!result.verified)
                        process.exitCode = 1;
                    return;
                }
                default:
                    throw new Error("Usage: cw.js telemetry verify <run-id> [--pubkey <pem-or-path>] [--json]");
            }
        }
        case "demo": {
            const [subcommand] = args.positionals;
            switch (subcommand) {
                case "tamper": {
                    const result = (0, capability_core_1.demoTamper)(runner, args.options);
                    if (wantsJson(args.options))
                        printJson(result);
                    else
                        process.stdout.write(`${(0, telemetry_demo_1.formatTamperDemo)(result)}\n`);
                    // Fail closed: if the proof did not hold (a tamper went undetected),
                    // exit nonzero so the demo can never green a broken guarantee.
                    if (!result.proven)
                        process.exitCode = 1;
                    return;
                }
                case "bundle": {
                    const result = (0, capability_core_1.demoBundle)(runner, args.options);
                    if (wantsJson(args.options))
                        printJson(result);
                    else
                        process.stdout.write(`${(0, telemetry_demo_1.formatBundleDemo)(result)}\n`);
                    // Fail closed: a forged bundle that verified would be a regression in the
                    // bundle guarantee — exit nonzero so the demo can never green it.
                    if (!result.proven)
                        process.exitCode = 1;
                    return;
                }
                default:
                    throw new Error("Usage: cw.js demo tamper|bundle [--json]");
            }
        }
        case "workbench": {
            const [subcommand, runId] = args.positionals;
            switch (subcommand) {
                case "view": {
                    // Read-only five-panel view of one run. Same core entry as cw_workbench_view.
                    const view = (0, workbench_1.buildWorkbenchRunView)(runner, required(runId, "run id"));
                    if (wantsJson(args.options))
                        printJson(view);
                    else
                        process.stdout.write(`${formatWorkbenchView(view)}\n`);
                    return;
                }
                case "serve": {
                    // The OPTIONAL localhost host. `--once`/`--json` emit the descriptor only
                    // (no server); the default starts the read-only, localhost-only host.
                    if (args.options.once || wantsJson(args.options)) {
                        printJson((0, workbench_1.buildWorkbenchServeDescriptor)(runner, { ...args.options, once: true }));
                        return;
                    }
                    const host = new workbench_host_1.WorkbenchHost({
                        runner,
                        cwd: String(args.options.cwd || process.cwd()),
                        port: Number(args.options.port) || undefined,
                        scope: args.options.scope === "repo" ? "repo" : "home"
                    });
                    await host.run();
                    return;
                }
                default:
                    throw new Error("Usage: cw.js workbench serve [--port N] [--once] | view <run-id> [--json]");
            }
        }
        default:
            throw new Error(`Unknown command: ${args.command}`);
    }
}
function required(value, label) {
    if (!value)
        throw new Error(`Missing ${label}. Run "cw.js help" for usage.`);
    return value;
}
function optionalArg(value) {
    return typeof value === "string" && value.trim() ? value.trim() : undefined;
}
function printJson(value) {
    process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}
function wantsJson(options) {
    return Boolean(options.json || options.format === "json");
}
function formatWorkbenchView(view) {
    const lines = [
        `Workbench view ${view.runId} (${view.resolved ? "resolved" : "UNRESOLVED"})`,
        view.error ? `  error: ${view.error}` : ""
    ].filter(Boolean);
    for (const [group, panels] of Object.entries(view.panels)) {
        lines.push(`  ${group}:`);
        for (const [name, panel] of Object.entries(panels)) {
            const note = panel.status === "present" ? panel.capability : `absent (${panel.error || "unreadable"})`;
            lines.push(`    ${name}: ${panel.status} — ${note}`);
        }
    }
    return lines.join("\n");
}
