"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.runCli = runCli;
const node_fs_1 = __importDefault(require("node:fs"));
const node_path_1 = __importDefault(require("node:path"));
const node_child_process_1 = require("node:child_process");
const readline = __importStar(require("node:readline"));
const orchestrator_1 = require("../orchestrator");
const capability_core_1 = require("../capability-core");
const observability_1 = require("../observability");
const telemetry_demo_1 = require("../telemetry-demo");
const run_registry_1 = require("../run-registry");
const daemon_1 = require("../daemon");
const scheduler_1 = require("../scheduler");
const triggers_1 = require("../triggers");
const io_1 = require("./io");
const clones_1 = require("./handlers/clones");
const workbench_1 = require("./handlers/workbench");
const operator_ux_1 = require("../operator-ux");
const multi_agent_operator_ux_1 = require("../multi-agent-operator-ux");
const multi_agent_eval_1 = require("../multi-agent-eval");
const state_explosion_1 = require("../state-explosion");
const evidence_reasoning_1 = require("../evidence-reasoning");
const doctor_1 = require("../doctor");
const orchestrator_2 = require("../orchestrator");
const reporter_1 = require("../reporter");
const version_1 = require("../version");
async function runCli(argv = process.argv.slice(2)) {
    const args = (0, orchestrator_1.parseArgv)(argv);
    // Top-level flags: accept --version / -v / --help / -h before command lookup.
    if (args.command?.startsWith("-") || !args.command) {
        if (args.command === "--version" || args.command === "-v" || args.options.v || args.options.version) {
            process.stdout.write(`${version_1.CURRENT_COOL_WORKFLOW_VERSION}\n`);
            return;
        }
        if (!args.command || args.command === "--help" || args.command === "-h" || args.options.h || args.options.help) {
            process.stdout.write((0, orchestrator_1.formatHelp)() + "\n");
            return;
        }
    }
    // Map vendor shorthand flags (-claude, -codex, -deepseek) to --agent-command.
    if (args.options.claude)
        args.options["agent-command"] = "builtin:claude";
    if (args.options.codex)
        args.options["agent-command"] = "builtin:codex";
    if (args.options.deepseek)
        args.options["agent-command"] = "builtin:deepseek";
    // -dir / --dir / -d : an intuitive alias for --repo — the project folder to review,
    // so `cw -q "…" -dir /path` works from any directory (no cd). Explicit --repo wins.
    if (!args.options.repo && args.options.dir)
        args.options.repo = args.options.dir;
    // Presentation flags — set BEFORE any drive spawn so the out-of-process agent wrapper
    // inherits them via process.env (presentation-only; stdout/the cw:result fence are untouched):
    //   --verbose   full agent narration inline (default is compact: current action + summary)
    //   --no-color  disable ANSI everywhere (CW_NO_COLOR is honored by term.colorEnabled AND the
    //               wrapper); complements NO_COLOR/FORCE_COLOR
    //   --full      also stream full narration AND print the report inline at run end
    if (args.options.verbose)
        process.env.CW_VERBOSE = "1";
    if (args.options["no-color"])
        process.env.CW_NO_COLOR = "1";
    if (args.options.full)
        process.env.CW_OUTPUT = "full";
    // `cw <verb> --help` / `-h` -> per-command help (the verb's subcommands +
    // one-line summaries), derived from the capability registry. Additive: the
    // bare `cw` / `cw --help` top-level help is handled above.
    if ((args.options.help || args.options.h) && args.command && !args.command.startsWith("-")) {
        process.stdout.write((0, orchestrator_1.formatCommandHelp)(args.command) + "\n");
        return;
    }
    // Bare -q / --question -> redirect to quickstart (auto-detect repo/agent/app).
    // CONSUME the positional (shift) so the question never survives as positionals[0]
    // — otherwise the quickstart handler reads it as the app id ("Workflow app not found").
    if (args.command === "-q" || args.command === "--question") {
        if (!args.options.question && args.positionals[0])
            args.options.question = args.positionals.shift();
        args.command = "quickstart";
    }
    else if (!args.command && typeof args.options.question === "string") {
        args.command = "quickstart";
    }
    const runner = new orchestrator_1.CoolWorkflowRunner({
        pluginRoot: node_path_1.default.resolve(__dirname, "../..")
    });
    const scheduler = new scheduler_1.Scheduler(String(args.options.cwd || process.cwd()));
    const triggers = new triggers_1.RoutineTriggerBridge(String(args.options.cwd || process.cwd()));
    switch (args.command) {
        case "help": {
            const [topic] = args.positionals;
            process.stdout.write((topic ? (0, orchestrator_1.formatCommandHelp)(topic) : (0, orchestrator_1.formatHelp)()) + "\n");
            return;
        }
        case undefined:
            process.stdout.write((0, orchestrator_1.formatHelp)() + "\n");
            return;
        case "version":
            process.stdout.write(`${version_1.CURRENT_COOL_WORKFLOW_VERSION}\n`);
            return;
        case "update": {
            process.stderr.write("Updating cool-workflow...\n");
            const npm = (0, node_child_process_1.spawnSync)("npm", ["update", "-g", "cool-workflow"], { encoding: "utf8", stdio: "inherit" });
            if (npm.status !== 0) {
                process.stderr.write("Update failed, trying install...\n");
                const install = (0, node_child_process_1.spawnSync)("npm", ["install", "-g", "cool-workflow@latest"], { encoding: "utf8", stdio: "inherit" });
                if (install.status !== 0) {
                    process.stderr.write("Install failed. Check npm and try again.\n");
                    process.exitCode = 1;
                }
            }
            return;
        }
        case "fix": {
            const report = (0, doctor_1.runDoctor)(args.options, process.env, String(args.options.cwd || process.cwd()));
            process.stdout.write(`${(0, doctor_1.formatDoctorFixes)(report)}\n`);
            if (!report.ok)
                process.exitCode = 1;
            return;
        }
        case "list":
            (0, io_1.printJson)(runner.listWorkflows());
            return;
        case "search": {
            const keyword = args.positionals.join(" ");
            if (!keyword.trim())
                throw new Error("Missing search keyword.\n  Tip: cw search architecture to find workflows about architecture.");
            const apps = runner.listApps();
            const lower = keyword.toLowerCase();
            const results = apps.filter((a) => a.title.toLowerCase().includes(lower) || a.summary.toLowerCase().includes(lower) || a.id.toLowerCase().includes(lower)).map((a) => ({ id: a.id, title: a.title, summary: a.summary }));
            if ((0, io_1.wantsJson)(args.options))
                (0, io_1.printJson)(results);
            else
                process.stdout.write(`${(0, orchestrator_2.formatSearchResults)(keyword, results)}\n`);
            return;
        }
        case "man": {
            const [topic] = args.positionals;
            if (!topic)
                throw new Error("Missing topic.\n  Tip: cw man release-tooling for the release tooling manual.");
            const docsDir = node_path_1.default.resolve(runner.pluginRoot, "docs");
            const candidates = [
                node_path_1.default.join(docsDir, `${topic}.7.md`),
                node_path_1.default.join(docsDir, `${topic}.md`),
                node_path_1.default.join(docsDir, `${topic}`)
            ];
            let found;
            for (const c of candidates) {
                try {
                    if (node_fs_1.default.statSync(c).isFile()) {
                        found = c;
                        break;
                    }
                }
                catch { /* keep looking */ }
            }
            if (!found)
                throw new Error(`Man page not found: ${topic}.\n  Tip: cw list for workflow topics, or browse docs/ for manuals.`);
            process.stdout.write(node_fs_1.default.readFileSync(found, "utf8"));
            return;
        }
        case "info": {
            const [appId] = args.positionals;
            if (!appId)
                throw new Error("Missing workflow app id.\n  Tip: list apps with \"cw list\", then \"cw info <id>\" for details");
            const data = runner.showApp(appId);
            if ((0, io_1.wantsJson)(args.options))
                (0, io_1.printJson)(data);
            else
                process.stdout.write(`${(0, orchestrator_2.formatInfo)(appId, data)}\n`);
            return;
        }
        case "doctor": {
            const report = (0, doctor_1.runDoctor)(args.options, process.env, String(args.options.cwd || process.cwd()));
            if ((0, io_1.wantsJson)(args.options))
                (0, io_1.printJson)(report);
            else if (args.options.fix)
                process.stdout.write(`${(0, doctor_1.formatDoctorFixes)(report)}\n`);
            else
                process.stdout.write(`${(0, doctor_1.formatDoctorReport)(report)}\n`);
            if (!report.ok)
                process.exitCode = 1;
            return;
        }
        case "init": {
            const [workflowId] = args.positionals;
            if (!workflowId)
                throw new Error("Missing workflow id.\n  Tip: create one with \"cw init my-workflow\" or list with \"cw list\"");
            (0, io_1.printJson)(runner.init(workflowId, args.options));
            return;
        }
        case "app": {
            const [subcommand, appIdOrPath] = args.positionals;
            switch (subcommand) {
                case "list":
                    (0, io_1.printJson)(runner.listApps());
                    return;
                case "show":
                    (0, io_1.printJson)(runner.showApp((0, io_1.required)(appIdOrPath, "app id")));
                    return;
                case "validate": {
                    const result = runner.validateApp((0, io_1.required)(appIdOrPath, "app path or id"));
                    (0, io_1.printJson)(result);
                    if (!result.valid)
                        process.exitCode = 1;
                    return;
                }
                case "init":
                    (0, io_1.printJson)(runner.initApp((0, io_1.required)(appIdOrPath, "app id"), args.options));
                    return;
                case "package":
                    (0, io_1.printJson)(runner.packageApp((0, io_1.required)(appIdOrPath, "app id"), args.options));
                    return;
                case "run":
                    (0, io_1.printJson)((0, capability_core_1.appRun)(runner, { ...args.options, appId: (0, io_1.required)(appIdOrPath, "app id") }));
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
            const runId = (0, io_1.optionalArg)(args.options.run) || (0, io_1.optionalArg)(args.options.runId);
            await promptQuestion(args.options);
            const qs = (0, capability_core_1.quickstart)(runner, { ...args.options, ...(appId ? { appId } : {}), ...(runId ? { runId } : {}) });
            (0, io_1.printJson)(qs);
            const qr = qs;
            // Clean human summary on stderr (TTY-gated, inside the reporter). Suppressed under --json so
            // machine mode emits ONLY the stdout payload — no stderr chrome to parse around. The type
            // guard also skips --check/--preview results (no reportPath of their own). The summary is the
            // COMPACT findings table (re-parsed from each completed worker's cw:result), the report path,
            // and where the per-worker transcripts live — NOT the full prose (that's report.md/--full).
            if (!(0, io_1.wantsJson)(args.options) && typeof qr.runId === "string" && typeof qr.reportPath === "string") {
                emitRunSummary(runner, args.options, {
                    runId: qr.runId,
                    reportPath: qr.reportPath,
                    status: String(qr.status || ""),
                    statePath: typeof qr.statePath === "string" ? qr.statePath : undefined,
                    completedWorkers: typeof qr.completedWorkers === "number" ? qr.completedWorkers : undefined,
                    plannedWorkers: typeof qr.plannedWorkers === "number" ? qr.plannedWorkers : undefined,
                    agentConfigured: typeof qr.agentConfigured === "boolean" ? qr.agentConfigured : undefined
                });
            }
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
                throw new Error("Missing workflow id.\n  Tip: plan an architecture review with \"cw plan architecture-review\"");
            (0, io_1.printJson)((0, capability_core_1.planSummary)(runner, workflowId, args.options));
            return;
        }
        case "status":
            if (!args.positionals[0]) {
                const nextActions = (0, operator_ux_1.adviseNoRun)();
                if ((0, io_1.wantsJson)(args.options))
                    (0, io_1.printJson)({ runId: null, nextActions });
                else
                    process.stdout.write(`No run selected\n\nNext Action\n${nextActions.map((action) => `  ${action.command}\n    reason: ${action.reason}`).join("\n")}\n`);
            }
            else if ((0, io_1.wantsJson)(args.options))
                (0, io_1.printJson)(runner.status(args.positionals[0]));
            else {
                const summary = runner.operatorStatus(args.positionals[0]);
                process.stdout.write(`${(args.options.summary || args.options.brief ? (0, operator_ux_1.formatOperatorSummary)(summary) : (0, operator_ux_1.formatOperatorStatus)(summary))}\n`);
            }
            return;
        case "next":
            (0, io_1.printJson)(runner.next((0, io_1.required)(args.positionals[0], "run id"), args.options));
            return;
        case "dispatch":
            (0, io_1.printJson)(runner.dispatch((0, io_1.required)(args.positionals[0], "run id"), args.options));
            return;
        case "result": {
            const [runId, taskId, resultPath] = args.positionals;
            (0, io_1.printJson)(runner.recordResult((0, io_1.required)(runId, "run id"), (0, io_1.required)(taskId, "task id"), (0, io_1.required)(resultPath, "result file"), args.options));
            return;
        }
        case "state": {
            const [subcommand, runId] = args.positionals;
            switch (subcommand) {
                case "check": {
                    const report = runner.checkState((0, io_1.required)(runId, "run id"), args.options);
                    (0, io_1.printJson)(report);
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
                const summary = runner.summarizeCommitRecords((0, io_1.required)(args.positionals[1], "run id"));
                if ((0, io_1.wantsJson)(args.options))
                    (0, io_1.printJson)(summary);
                else
                    process.stdout.write(`${(0, operator_ux_1.formatCommitSummary)(summary)}\n`);
                return;
            }
            (0, io_1.printJson)(runner.commit((0, io_1.required)(args.positionals[0], "run id"), args.options));
            return;
        case "report": {
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
            return;
        }
        case "operator": {
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
        case "graph": {
            const graph = runner.operatorGraph((0, io_1.required)(args.positionals[0], "run id"));
            if ((0, io_1.wantsJson)(args.options))
                (0, io_1.printJson)(graph);
            else
                process.stdout.write(`${(0, operator_ux_1.formatOperatorGraph)(graph)}\n`);
            return;
        }
        case "topology": {
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
        case "summary": {
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
        case "multi-agent": {
            const [subcommand, runId, id] = args.positionals;
            switch (subcommand) {
                case "status":
                    if ((0, io_1.wantsJson)(args.options))
                        (0, io_1.printJson)(runner.hostMultiAgentStatus((0, io_1.required)(runId, "run id")));
                    else
                        process.stdout.write(`${(0, multi_agent_operator_ux_1.formatMultiAgentOperatorStatus)(runner.multiAgentOperatorStatus((0, io_1.required)(runId, "run id")))}\n`);
                    return;
                case "step":
                    (0, io_1.printJson)(runner.hostMultiAgentStep((0, io_1.required)(runId, "run id"), args.options));
                    return;
                case "blackboard":
                    (0, io_1.printJson)(runner.hostMultiAgentBlackboard((0, io_1.required)(runId, "run id"), id, args.options));
                    return;
                case "score":
                    (0, io_1.printJson)(runner.hostMultiAgentScore((0, io_1.required)(runId, "run id"), { ...args.options, candidate: args.options.candidate || args.options.candidateId || id }));
                    return;
                case "select":
                    (0, io_1.printJson)(runner.hostMultiAgentSelect((0, io_1.required)(runId, "run id"), { ...args.options, candidate: args.options.candidate || args.options.candidateId || id }));
                    return;
                case "summary": {
                    const summary = runner.multiAgentSummary((0, io_1.required)(runId, "run id"));
                    if ((0, io_1.wantsJson)(args.options))
                        (0, io_1.printJson)(summary);
                    else
                        process.stdout.write(`${(0, operator_ux_1.formatMultiAgentSummary)(summary)}\n`);
                    return;
                }
                case "summarize": {
                    const report = runner.multiAgentSummarize((0, io_1.required)(runId, "run id"));
                    if ((0, io_1.wantsJson)(args.options))
                        (0, io_1.printJson)(report);
                    else
                        process.stdout.write(`${(0, state_explosion_1.formatStateExplosionReport)(report)}\n`);
                    return;
                }
                case "graph": {
                    const wantsView = args.options.view || args.options.focus || args.options.depth;
                    if (wantsView) {
                        const graph = runner.multiAgentGraphView((0, io_1.required)(runId, "run id"), args.options);
                        if ((0, io_1.wantsJson)(args.options))
                            (0, io_1.printJson)(graph);
                        else
                            process.stdout.write(`${(0, state_explosion_1.formatCompactGraph)(graph)}\n`);
                        return;
                    }
                    const graph = runner.multiAgentOperatorGraph((0, io_1.required)(runId, "run id"));
                    if ((0, io_1.wantsJson)(args.options))
                        (0, io_1.printJson)(graph);
                    else
                        process.stdout.write(`${(0, operator_ux_1.formatOperatorGraph)({ runId: (0, io_1.required)(runId, "run id"), nodes: graph.nodes, edges: graph.edges })}\n`);
                    return;
                }
                case "dependencies": {
                    const rows = runner.multiAgentDependencies((0, io_1.required)(runId, "run id"));
                    if ((0, io_1.wantsJson)(args.options))
                        (0, io_1.printJson)(rows);
                    else
                        process.stdout.write(`${(0, multi_agent_operator_ux_1.formatMultiAgentDependencies)(rows)}\n`);
                    return;
                }
                case "failures": {
                    const rows = runner.multiAgentFailures((0, io_1.required)(runId, "run id"));
                    if ((0, io_1.wantsJson)(args.options))
                        (0, io_1.printJson)(rows);
                    else
                        process.stdout.write(`${(0, multi_agent_operator_ux_1.formatMultiAgentFailures)(rows)}\n`);
                    return;
                }
                case "evidence": {
                    const rows = runner.multiAgentEvidence((0, io_1.required)(runId, "run id"));
                    if ((0, io_1.wantsJson)(args.options))
                        (0, io_1.printJson)(rows);
                    else
                        process.stdout.write(`${(0, multi_agent_operator_ux_1.formatMultiAgentEvidence)(rows)}\n`);
                    return;
                }
                case "reasoning": {
                    if (args.options.refresh && !args.options.evidence && !args.options.evidenceId) {
                        const index = runner.multiAgentReasoningRefresh((0, io_1.required)(runId, "run id"));
                        (0, io_1.printJson)(index);
                        return;
                    }
                    const report = runner.multiAgentReasoning((0, io_1.required)(runId, "run id"), { ...args.options, evidence: args.options.evidence || args.options.evidenceId || id });
                    if ((0, io_1.wantsJson)(args.options))
                        (0, io_1.printJson)(report);
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
                        (0, io_1.printJson)(runner.hostMultiAgentRun(runId, args.options));
                        return;
                    }
                    if (id && !args.options.id && !args.options.status)
                        (0, io_1.printJson)(runner.showMultiAgentRun((0, io_1.required)(runId, "run id"), id));
                    else if (id && args.options.status)
                        (0, io_1.printJson)(runner.transitionMultiAgentRun((0, io_1.required)(runId, "run id"), id, args.options));
                    else
                        (0, io_1.printJson)(runner.createMultiAgentRun((0, io_1.required)(runId, "run id"), args.options));
                    return;
                case "show":
                    (0, io_1.printJson)(runner.showMultiAgentRun((0, io_1.required)(runId, "run id"), (0, io_1.required)(id, "multi-agent run id")));
                    return;
                case "role":
                    if (id && !args.options.id && !args.options["multi-agent-run"] && !args.options.multiAgentRun && !args.options.multiAgentRunId) {
                        (0, io_1.printJson)(runner.showAgentRole((0, io_1.required)(runId, "run id"), id));
                    }
                    else {
                        (0, io_1.printJson)(runner.createAgentRole((0, io_1.required)(runId, "run id"), { ...args.options, id: args.options.id || id }));
                    }
                    return;
                case "group":
                    if (id && !args.options.id && !args.options["multi-agent-run"] && !args.options.multiAgentRun && !args.options.multiAgentRunId) {
                        (0, io_1.printJson)(runner.showAgentGroup((0, io_1.required)(runId, "run id"), id));
                    }
                    else {
                        (0, io_1.printJson)(runner.createAgentGroup((0, io_1.required)(runId, "run id"), { ...args.options, id: args.options.id || id }));
                    }
                    return;
                case "membership":
                    if (id && !args.options.id && !args.options.group && !args.options.groupId && !args.options["multi-agent-group"]) {
                        (0, io_1.printJson)(runner.showAgentMembership((0, io_1.required)(runId, "run id"), id));
                    }
                    else {
                        (0, io_1.printJson)(runner.assignAgentMembership((0, io_1.required)(runId, "run id"), { ...args.options, id: args.options.id || id }));
                    }
                    return;
                case "fanout":
                    if (id && !args.options.id && !args.options.group && !args.options.groupId && !args.options["multi-agent-group"]) {
                        (0, io_1.printJson)(runner.showAgentFanout((0, io_1.required)(runId, "run id"), id));
                    }
                    else {
                        (0, io_1.printJson)(runner.createAgentFanout((0, io_1.required)(runId, "run id"), { ...args.options, id: args.options.id || id }));
                    }
                    return;
                case "fanin":
                    if (id && !args.options.id && !args.options.group && !args.options.groupId && !args.options["multi-agent-group"] && !args.options.fanout) {
                        (0, io_1.printJson)(runner.showAgentFanin((0, io_1.required)(runId, "run id"), id));
                    }
                    else {
                        (0, io_1.printJson)(runner.collectAgentFanin((0, io_1.required)(runId, "run id"), { ...args.options, id: args.options.id || id }));
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
            return;
        }
        case "blackboard": {
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
        case "coordinator": {
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
        case "sandbox": {
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
        case "backend": {
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
        case "contract": {
            const [subcommand, runId, contractId] = args.positionals;
            switch (subcommand) {
                case "show":
                    (0, io_1.printJson)(runner.showContract((0, io_1.required)(runId, "run id"), contractId));
                    return;
                default:
                    throw new Error("Usage: cw.js contract show <run-id> [contract-id]");
            }
        }
        case "node": {
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
        case "migration": {
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
        case "feedback": {
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
        case "worker": {
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
        case "audit": {
            const [subcommand, runId, id] = args.positionals;
            switch (subcommand) {
                case "summary":
                    (0, io_1.printJson)(runner.auditSummary((0, io_1.required)(runId, "run id")));
                    return;
                case "verify": {
                    const result = (0, capability_core_1.auditVerify)(runner, { ...args.options, runId: (0, io_1.required)(runId, "run id") });
                    (0, io_1.printJson)(result);
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
                    (0, io_1.printJson)(runner.workerAudit((0, io_1.required)(runId, "run id"), (0, io_1.required)(id, "worker id")));
                    return;
                case "provenance":
                    (0, io_1.printJson)(runner.evidenceProvenance((0, io_1.required)(runId, "run id"), args.options));
                    return;
                case "multi-agent": {
                    const view = runner.auditMultiAgent((0, io_1.required)(runId, "run id"));
                    if ((0, io_1.wantsJson)(args.options))
                        (0, io_1.printJson)(view);
                    else
                        process.stdout.write(`${(0, operator_ux_1.formatMultiAgentTrustAudit)(view)}\n`);
                    return;
                }
                case "policy": {
                    const view = runner.auditPolicy((0, io_1.required)(runId, "run id"));
                    if ((0, io_1.wantsJson)(args.options))
                        (0, io_1.printJson)(view);
                    else
                        process.stdout.write(`${(0, operator_ux_1.formatMultiAgentTrustAudit)(view)}\n`);
                    return;
                }
                case "role": {
                    const view = runner.auditRole((0, io_1.required)(runId, "run id"), (0, io_1.required)(id, "role id"));
                    if ((0, io_1.wantsJson)(args.options))
                        (0, io_1.printJson)(view);
                    else
                        process.stdout.write(`${(0, operator_ux_1.formatMultiAgentTrustAudit)(view)}\n`);
                    return;
                }
                case "blackboard": {
                    const view = runner.auditBlackboard((0, io_1.required)(runId, "run id"));
                    if ((0, io_1.wantsJson)(args.options))
                        (0, io_1.printJson)(view);
                    else
                        process.stdout.write(`${(0, operator_ux_1.formatMultiAgentTrustAudit)(view)}\n`);
                    return;
                }
                case "judge": {
                    const view = runner.auditJudge((0, io_1.required)(runId, "run id"));
                    if ((0, io_1.wantsJson)(args.options))
                        (0, io_1.printJson)(view);
                    else
                        process.stdout.write(`${(0, operator_ux_1.formatMultiAgentTrustAudit)(view)}\n`);
                    return;
                }
                case "attest":
                    (0, io_1.printJson)(runner.recordAuditAttestation((0, io_1.required)(runId, "run id"), args.options));
                    return;
                case "decision":
                    (0, io_1.printJson)(runner.recordAuditDecision((0, io_1.required)(runId, "run id"), (0, io_1.required)(id, "worker id"), args.options));
                    return;
                default:
                    throw new Error("Usage: cw.js audit summary|worker|provenance|multi-agent|policy|role|blackboard|judge|attest|decision <run-id> [worker-id|role-id]");
            }
        }
        case "candidate": {
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
        // ---- Team Collaboration (v0.1.32) ------------------------------------
        case "approve": {
            const [targetKind, runId, targetId] = args.positionals;
            (0, io_1.printJson)(runner.collaborationApprove((0, io_1.required)(runId, "run id"), (0, io_1.required)(targetKind, "target kind (candidate|commit|selection|run|task|node)"), (0, io_1.required)(targetId, "target id"), args.options));
            return;
        }
        case "reject": {
            const [targetKind, runId, targetId] = args.positionals;
            (0, io_1.printJson)(runner.collaborationReject((0, io_1.required)(runId, "run id"), (0, io_1.required)(targetKind, "target kind (candidate|commit|selection|run|task|node)"), (0, io_1.required)(targetId, "target id"), args.options));
            return;
        }
        case "comment": {
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
        case "handoff": {
            const [targetKind, runId, targetIdRaw] = args.positionals;
            const kind = (0, io_1.required)(targetKind, "target kind (run|task|candidate|commit|node)");
            const rid = (0, io_1.required)(runId, "run id");
            const targetId = targetIdRaw || (kind === "run" ? rid : undefined);
            (0, io_1.printJson)(runner.collaborationHandoff(rid, kind, (0, io_1.required)(targetId, "target id"), args.options));
            return;
        }
        case "review": {
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
        case "loop": {
            (0, io_1.printJson)(scheduler.create({ ...args.options, kind: "loop" }));
            return;
        }
        case "schedule": {
            const [subcommand, id] = args.positionals;
            switch (subcommand) {
                case "create":
                    (0, io_1.printJson)(scheduler.create(args.options));
                    return;
                case "list":
                    (0, io_1.printJson)(scheduler.list(args.options.status ? String(args.options.status) : undefined));
                    return;
                case "delete":
                    (0, io_1.printJson)(scheduler.delete((0, io_1.required)(id, "schedule id")));
                    return;
                case "due":
                    (0, io_1.printJson)(scheduler.due());
                    return;
                case "complete":
                    (0, io_1.printJson)(scheduler.complete((0, io_1.required)(id, "schedule id"), args.options));
                    return;
                case "pause":
                    (0, io_1.printJson)(scheduler.pause((0, io_1.required)(id, "schedule id")));
                    return;
                case "resume":
                    (0, io_1.printJson)(scheduler.resume((0, io_1.required)(id, "schedule id")));
                    return;
                case "run-now":
                    (0, io_1.printJson)(scheduler.runNow((0, io_1.required)(id, "schedule id")));
                    return;
                case "history":
                    (0, io_1.printJson)(scheduler.history(id));
                    return;
                case "daemon": {
                    const daemon = new daemon_1.DesktopSchedulerDaemon({
                        cwd: String(args.options.cwd || process.cwd()),
                        intervalSeconds: Number(args.options.intervalSeconds || args.options.interval || 60)
                    });
                    if (args.options.once) {
                        (0, io_1.printJson)(daemon.tick());
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
                    (0, io_1.printJson)(triggers.create(args.options));
                    return;
                case "list":
                    (0, io_1.printJson)(triggers.list(args.options.kind ? String(args.options.kind) : undefined));
                    return;
                case "delete":
                    (0, io_1.printJson)(triggers.delete((0, io_1.required)(idOrKind, "trigger id")));
                    return;
                case "fire": {
                    const kind = (0, io_1.required)(idOrKind, "trigger kind");
                    const payload = payloadPath ? JSON.parse(node_fs_1.default.readFileSync(payloadPath, "utf8")) : args.options;
                    (0, io_1.printJson)(triggers.fire(kind, payload));
                    return;
                }
                case "events":
                    (0, io_1.printJson)(triggers.events(idOrKind));
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
                    if ((0, io_1.wantsJson)(args.options))
                        (0, io_1.printJson)(report);
                    else
                        process.stdout.write(`${(0, run_registry_1.formatRegistryReport)(report)}\n`);
                    return;
                }
                case "show": {
                    const report = (0, capability_core_1.runRegistryShow)(registry, args.options);
                    if ((0, io_1.wantsJson)(args.options))
                        (0, io_1.printJson)(report);
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
                const runId = (0, io_1.optionalArg)(args.options.run) || (0, io_1.optionalArg)(args.options.runId);
                if (args.options.preview) {
                    (0, io_1.printJson)((0, capability_core_1.runDrivePreview)(runner, { ...args.options, runId: runId || target }));
                    return;
                }
                const driveArgs = { ...args.options };
                if (runId)
                    driveArgs.runId = runId;
                else
                    driveArgs.appId = target;
                const dr = (0, capability_core_1.runDrive)(runner, driveArgs);
                (0, io_1.printJson)(dr);
                if (!(0, io_1.wantsJson)(args.options)) {
                    emitRunSummary(runner, args.options, {
                        runId: dr.runId,
                        reportPath: dr.reportPath,
                        status: dr.status,
                        statePath: dr.statePath,
                        completedWorkers: dr.completedWorkers,
                        plannedWorkers: dr.plannedWorkers,
                        agentConfigured: dr.agentConfigured
                    });
                }
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
                        const dr = (0, capability_core_1.runDrive)(runner, driveArgs);
                        (0, io_1.printJson)(dr);
                        if (!(0, io_1.wantsJson)(args.options)) {
                            emitRunSummary(runner, args.options, {
                                runId: dr.runId,
                                reportPath: dr.reportPath,
                                status: dr.status,
                                statePath: dr.statePath,
                                completedWorkers: dr.completedWorkers,
                                plannedWorkers: dr.plannedWorkers,
                                agentConfigured: dr.agentConfigured
                            });
                        }
                        return;
                    }
                    (0, io_1.printJson)((0, capability_core_1.runDrivePreview)(runner, { ...args.options, runId: (0, io_1.required)(id, "run id") }));
                    return;
                }
                case "search": {
                    const result = (0, capability_core_1.runSearch)(registry, args.options);
                    if ((0, io_1.wantsJson)(args.options))
                        (0, io_1.printJson)(result);
                    else
                        process.stdout.write(`${(0, run_registry_1.formatRunSearch)(result)}\n`);
                    return;
                }
                case "list": {
                    const result = (0, capability_core_1.runList)(registry, args.options);
                    if ((0, io_1.wantsJson)(args.options))
                        (0, io_1.printJson)(result);
                    else
                        process.stdout.write(`${(0, run_registry_1.formatRunSearch)(result)}\n`);
                    return;
                }
                case "show": {
                    const result = (0, capability_core_1.runShow)(registry, (0, io_1.required)(id, "run id"), args.options);
                    if ((0, io_1.wantsJson)(args.options))
                        (0, io_1.printJson)(result);
                    else
                        process.stdout.write(`${(0, run_registry_1.formatRunShow)(result)}\n`);
                    return;
                }
                case "resume": {
                    const result = (0, capability_core_1.runResume)(registry, runner, (0, io_1.required)(id, "run id"), args.options);
                    if ((0, io_1.wantsJson)(args.options))
                        (0, io_1.printJson)(result);
                    else
                        process.stdout.write(`${(0, run_registry_1.formatResume)(result)}\n`);
                    return;
                }
                case "archive":
                    (0, io_1.printJson)((0, capability_core_1.runArchive)(registry, id, args.options));
                    return;
                case "rerun":
                    (0, io_1.printJson)((0, capability_core_1.runRerun)(registry, (0, io_1.required)(id, "run id"), args.options));
                    return;
                case "export":
                    (0, io_1.printJson)((0, capability_core_1.runExportArchive)(runner, (0, io_1.required)(id || (0, io_1.optionalArg)(args.options.runId || args.options.run), "run id"), args.options));
                    return;
                case "import":
                    (0, io_1.printJson)((0, capability_core_1.runImportArchive)(runner, { ...args.options, archive: id || args.options.archive || args.options.path }));
                    return;
                case "verify-import": {
                    const result = (0, capability_core_1.runVerifyImport)(runner, (0, io_1.required)(id || (0, io_1.optionalArg)(args.options.runId || args.options.run), "run id"), args.options);
                    (0, io_1.printJson)(result);
                    // Fail-closed ONLY behind --strict, so the default exit stays 0
                    // (byte-identical). With --strict, any failed restore check — including
                    // the new trust-audit row — exits 1 for `verify-import && restore`.
                    if (Boolean(args.options.strict) && !result.ok)
                        process.exitCode = 1;
                    return;
                }
                case "inspect-archive": {
                    const result = (0, capability_core_1.runInspectArchive)(runner, { ...args.options, archive: id || args.options.archive || args.options.path });
                    (0, io_1.printJson)(result);
                    // Read-only diagnostic: exit 1 when the archive fails any integrity check,
                    // so `cw run inspect-archive <path> && restore` stops on a bad archive.
                    if (!result.ok)
                        process.exitCode = 1;
                    return;
                }
                default:
                    throw new Error("Usage: cw.js run search|list|show|resume|archive|rerun|drive|export|import|verify-import|inspect-archive [run-id|archive] [--scope repo|home] [--json]  |  cw.js run <app> --drive [--once] [--incremental] [--repo R --question Q]");
            }
        }
        case "queue": {
            const registry = (0, capability_core_1.runRegistryFor)(args.options, runner);
            const [subcommand, id] = args.positionals;
            switch (subcommand) {
                case "add":
                    (0, io_1.printJson)((0, capability_core_1.queueAdd)(registry, args.options));
                    return;
                case "list": {
                    const result = (0, capability_core_1.queueList)(registry, args.options);
                    if ((0, io_1.wantsJson)(args.options))
                        (0, io_1.printJson)(result);
                    else
                        process.stdout.write(`${(0, run_registry_1.formatQueueList)(result)}\n`);
                    return;
                }
                case "drain":
                    (0, io_1.printJson)((0, capability_core_1.queueDrain)(registry, args.options));
                    return;
                case "show":
                    (0, io_1.printJson)((0, capability_core_1.queueShow)(registry, (0, io_1.required)(id, "queue id")));
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
                    (0, io_1.printJson)((0, capability_core_1.schedPlan)(registry, args.options));
                    return;
                case "lease":
                    (0, io_1.printJson)((0, capability_core_1.schedLease)(registry, args.options));
                    return;
                case "release":
                    (0, io_1.printJson)((0, capability_core_1.schedRelease)(registry, { ...args.options, leaseId: args.options.leaseId || idArg }));
                    return;
                case "complete":
                    (0, io_1.printJson)((0, capability_core_1.schedComplete)(registry, { ...args.options, leaseId: args.options.leaseId || idArg }));
                    return;
                case "reclaim":
                    (0, io_1.printJson)((0, capability_core_1.schedReclaim)(registry, args.options));
                    return;
                case "reset":
                    (0, io_1.printJson)((0, capability_core_1.schedReset)(registry, { ...args.options, id: args.options.id || idArg }));
                    return;
                case "policy": {
                    const [, action] = args.positionals;
                    if (action === "set") {
                        (0, io_1.printJson)((0, capability_core_1.schedPolicySet)(registry, args.options));
                        return;
                    }
                    (0, io_1.printJson)((0, capability_core_1.schedPolicyShow)(registry));
                    return;
                }
                default:
                    throw new Error("Usage: cw.js sched plan|lease|release|complete|reclaim|reset|policy [show|set] [id] [--maxConcurrent N --maxAttempts N ...]");
            }
        }
        case "clones":
            (0, clones_1.handleClones)(args);
            return;
        case "gc": {
            // Run Retention & Provable Reclamation (v0.1.39). `plan` is a pure dry-run
            // (frees nothing); `run` executes the write-ahead reclamation transaction;
            // `verify` re-proves a reclaimed run. CW never reclaims by default.
            const registry = (0, capability_core_1.runRegistryFor)(args.options, runner);
            const [subcommand, id] = args.positionals;
            switch (subcommand) {
                case "plan": {
                    const result = (0, capability_core_1.gcPlan)(registry, id, args.options);
                    if ((0, io_1.wantsJson)(args.options))
                        (0, io_1.printJson)(result);
                    else
                        process.stdout.write(`${(0, run_registry_1.formatGcPlan)(result)}\n`);
                    return;
                }
                case "run": {
                    const result = (0, capability_core_1.gcRun)(registry, id, args.options);
                    if ((0, io_1.wantsJson)(args.options))
                        (0, io_1.printJson)(result);
                    else
                        process.stdout.write(`${(0, run_registry_1.formatGcRun)(result)}\n`);
                    return;
                }
                case "verify": {
                    const result = (0, capability_core_1.gcVerify)(registry, (0, io_1.required)(id, "run id"), args.options);
                    if ((0, io_1.wantsJson)(args.options))
                        (0, io_1.printJson)(result);
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
            if ((0, io_1.wantsJson)(args.options))
                (0, io_1.printJson)(result);
            else
                process.stdout.write(`${(0, run_registry_1.formatHistory)(result)}\n`);
            return;
        }
        case "telemetry": {
            const [subcommand, id] = args.positionals;
            switch (subcommand) {
                case "verify": {
                    const result = (0, capability_core_1.telemetryVerify)(runner, { ...args.options, runId: id || args.options.runId || args.options.run });
                    if ((0, io_1.wantsJson)(args.options))
                        (0, io_1.printJson)(result);
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
                    if ((0, io_1.wantsJson)(args.options))
                        (0, io_1.printJson)(result);
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
                    if ((0, io_1.wantsJson)(args.options))
                        (0, io_1.printJson)(result);
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
        case "workbench":
            await (0, workbench_1.handleWorkbench)(args, runner);
            return;
        default:
            throw new Error(`Unknown command: ${args.command}${((0, orchestrator_1.suggestCommand)(String(args.command || "")) ? `. Did you mean: ${(0, orchestrator_1.suggestCommand)(String(args.command))}?` : "")}`);
    }
}
/** Emit the calm end-of-run summary (stderr, TTY-gated inside the reporter): the COMPACT findings
 *  table re-parsed from each completed worker's `cw:result`, the report path, where the per-worker
 *  transcripts live, and — under `--full` — the report inline. Stderr/human-side ONLY: stdout (the
 *  `--json` payload printed just before this) stays byte-exact. Shared by the quickstart and the
 *  two `run --drive` paths so all three render an identical summary. */
function emitRunSummary(runner, options, fields) {
    // Anchor run reads to the run's OWN repo (a drive/quickstart may run cross-directory): the run
    // dir is <repo>/.cw/runs/<id>/, holding each worker's transcript.md next to its result.md.
    const runDir = typeof fields.statePath === "string" ? node_path_1.default.dirname(fields.statePath) : undefined;
    const baseDir = runDir ? node_path_1.default.resolve(runDir, "..", "..", "..") : undefined;
    const findings = (0, capability_core_1.collectRunFindings)(runner, fields.runId, baseDir);
    // --full ALSO prints the report inline at run end (the compact table stays the default summary).
    let fullReport;
    if (options.full && fields.reportPath && node_fs_1.default.existsSync(fields.reportPath)) {
        try {
            fullReport = node_fs_1.default.readFileSync(fields.reportPath, "utf8");
        }
        catch { /* best-effort inline */ }
    }
    reporter_1.reporter.runSummary({
        runId: fields.runId,
        reportPath: fields.reportPath,
        status: fields.status,
        completedWorkers: fields.completedWorkers,
        plannedWorkers: fields.plannedWorkers,
        agentConfigured: fields.agentConfigured,
        findings,
        runDir,
        fullReport
    });
}
/** Prompt the user for a question interactively when --question is missing on a TTY. */
async function promptQuestion(options) {
    if (options.question || !process.stdin.isTTY)
        return;
    const rl = readline.createInterface({ input: process.stdin, output: process.stderr });
    return new Promise((resolve) => {
        rl.question("Question: ", (answer) => {
            rl.close();
            if (answer.trim())
                options.question = answer.trim();
            resolve();
        });
    });
}
