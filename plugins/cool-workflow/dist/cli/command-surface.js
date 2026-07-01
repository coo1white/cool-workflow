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
const scheduler_1 = require("../scheduler");
const triggers_1 = require("../triggers");
const io_1 = require("./io");
const run_summary_1 = require("./run-summary");
const audit_1 = require("./handlers/audit");
const candidate_1 = require("./handlers/candidate");
const operator_1 = require("./handlers/operator");
const registry_1 = require("./handlers/registry");
const multi_agent_1 = require("./handlers/multi-agent");
const run_1 = require("./handlers/run");
const collaboration_1 = require("./handlers/collaboration");
const ledger_1 = require("./handlers/ledger");
const blackboard_1 = require("./handlers/blackboard");
const eval_1 = require("./handlers/eval");
const node_1 = require("./handlers/node");
const maintenance_1 = require("./handlers/maintenance");
const operational_1 = require("./handlers/operational");
const scheduling_1 = require("./handlers/scheduling");
const worker_1 = require("./handlers/worker");
const clones_1 = require("./handlers/clones");
const workbench_1 = require("./handlers/workbench");
const operator_ux_1 = require("../operator-ux");
const doctor_1 = require("../doctor");
const orchestrator_2 = require("../orchestrator");
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
    // Map vendor shorthand flags (-claude, -codex, -gemini, -deepseek) to --agent-command.
    if (args.options.claude)
        args.options["agent-command"] = "builtin:claude";
    if (args.options.codex)
        args.options["agent-command"] = "builtin:codex";
    if (args.options.gemini)
        args.options["agent-command"] = "builtin:gemini";
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
                (0, run_summary_1.emitRunSummary)(runner, args.options, {
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
        case "report":
            (0, operator_1.handleReport)(args, runner);
            return;
        case "operator":
            (0, operator_1.handleOperator)(args, runner);
            return;
        case "graph":
            (0, operator_1.handleGraph)(args, runner);
            return;
        case "topology":
            (0, operator_1.handleTopology)(args, runner);
            return;
        case "summary":
            (0, operator_1.handleSummary)(args, runner);
            return;
        case "multi-agent":
            (0, multi_agent_1.handleMultiAgent)(args, runner);
            return;
        case "eval":
            (0, eval_1.handleEval)(args, runner);
            return;
        case "blackboard":
            (0, blackboard_1.handleBlackboard)(args, runner);
            return;
        case "coordinator":
            (0, blackboard_1.handleCoordinator)(args, runner);
            return;
        case "sandbox":
            (0, operational_1.handleSandbox)(args, runner);
            return;
        case "backend":
            (0, operational_1.handleBackend)(args, runner);
            return;
        case "contract":
            (0, operational_1.handleContract)(args, runner);
            return;
        case "node":
            (0, node_1.handleNode)(args, runner);
            return;
        case "migration":
            (0, operational_1.handleMigration)(args, runner);
            return;
        case "feedback":
            (0, operational_1.handleFeedback)(args, runner);
            return;
        case "worker":
            (0, worker_1.handleWorker)(args, runner);
            return;
        case "audit":
            (0, audit_1.handleAudit)(args, runner);
            return;
        case "candidate":
            (0, candidate_1.handleCandidate)(args, runner);
            return;
        // ---- Team Collaboration (v0.1.32) ------------------------------------
        case "approve":
            (0, collaboration_1.handleApprove)(args, runner);
            return;
        case "reject":
            (0, collaboration_1.handleReject)(args, runner);
            return;
        case "comment":
            (0, collaboration_1.handleComment)(args, runner);
            return;
        case "handoff":
            (0, collaboration_1.handleHandoff)(args, runner);
            return;
        case "review":
            (0, collaboration_1.handleReview)(args, runner);
            return;
        case "ledger":
            (0, ledger_1.handleLedger)(args, runner);
            return;
        case "loop": {
            (0, io_1.printJson)(scheduler.create({ ...args.options, kind: "loop" }));
            return;
        }
        case "schedule":
            await (0, scheduling_1.handleSchedule)(args, scheduler);
            return;
        case "routine":
            (0, scheduling_1.handleRoutine)(args, triggers);
            return;
        case "registry":
            (0, registry_1.handleRegistry)(args, runner);
            return;
        case "metrics":
            (0, operational_1.handleMetrics)(args, runner);
            return;
        case "run":
            (0, run_1.handleRun)(args, runner);
            return;
        case "queue":
            (0, registry_1.handleQueue)(args, runner);
            return;
        case "sched":
            (0, scheduling_1.handleSched)(args, runner);
            return;
        case "clones":
            (0, clones_1.handleClones)(args);
            return;
        case "gc":
            (0, maintenance_1.handleGc)(args, runner);
            return;
        case "history":
            (0, registry_1.handleHistory)(args, runner);
            return;
        case "telemetry":
            (0, maintenance_1.handleTelemetry)(args, runner);
            return;
        case "demo":
            (0, maintenance_1.handleDemo)(args, runner);
            return;
        case "workbench":
            await (0, workbench_1.handleWorkbench)(args, runner);
            return;
        default:
            throw new Error(`Unknown command: ${args.command}${((0, orchestrator_1.suggestCommand)(String(args.command || "")) ? `. Did you mean: ${(0, orchestrator_1.suggestCommand)(String(args.command))}?` : "")}`);
    }
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
