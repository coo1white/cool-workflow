import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import * as readline from "node:readline";
import { CoolWorkflowRunner, formatCommandHelp, formatHelp, parseArgv, suggestCommand } from "../orchestrator";
import {
  appRun,
  metricsSummary,
  planSummary,
  runRegistryFor,
  sandboxChoose,
  gcPlan,
  gcRun,
  gcVerify,
  quickstart,
  backendAgentConfigShow,
  backendAgentConfigSet,
  telemetryVerify,
  demoTamper,
  demoBundle
} from "../capability-core";
import { formatMetricsReport, formatMetricsSummary } from "../observability";
import { formatTelemetryVerify, formatTamperDemo, formatBundleDemo } from "../telemetry-demo";
import {
  formatGcPlan,
  formatGcRun,
  formatGcVerify
} from "../run-registry";
import { Scheduler } from "../scheduler";
import { RoutineTriggerBridge } from "../triggers";
import { optionalArg, printJson, required, wantsJson } from "./io";
import { emitRunSummary } from "./run-summary";
import { handleAudit } from "./handlers/audit";
import { handleGraph, handleOperator, handleReport, handleSummary, handleTopology } from "./handlers/operator";
import { handleHistory, handleQueue, handleRegistry } from "./handlers/registry";
import { handleMultiAgent } from "./handlers/multi-agent";
import { handleRun } from "./handlers/run";
import { handleApprove, handleComment, handleHandoff, handleReject, handleReview } from "./handlers/collaboration";
import { handleRoutine, handleSched, handleSchedule } from "./handlers/scheduling";
import { handleWorker } from "./handlers/worker";
import { handleClones } from "./handlers/clones";
import { handleWorkbench } from "./handlers/workbench";
import {
  adviseNoRun,
  formatCandidateSummary,
  formatCommitSummary,
  formatFeedbackSummary,
  formatOperatorGraph,
  formatOperatorStatus,
  formatOperatorSummary
} from "../operator-ux";
import { formatMultiAgentEval } from "../multi-agent-eval";
import { formatBlackboardDigest } from "../state-explosion";
import { runDoctor, formatDoctorReport, formatDoctorFixes } from "../doctor";
import { formatInfo, formatSearchResults } from "../orchestrator";
import { CURRENT_COOL_WORKFLOW_VERSION } from "../version";

export async function runCli(argv: string[] = process.argv.slice(2)): Promise<void> {
  const args = parseArgv(argv);

  // Top-level flags: accept --version / -v / --help / -h before command lookup.
  if (args.command?.startsWith("-") || !args.command) {
    if (args.command === "--version" || args.command === "-v" || args.options.v || args.options.version) {
      process.stdout.write(`${CURRENT_COOL_WORKFLOW_VERSION}\n`);
      return;
    }
    if (!args.command || args.command === "--help" || args.command === "-h" || args.options.h || args.options.help) {
      process.stdout.write(formatHelp() + "\n");
      return;
    }
  }

  // Map vendor shorthand flags (-claude, -codex, -deepseek) to --agent-command.
  if (args.options.claude) args.options["agent-command"] = "builtin:claude";
  if (args.options.codex) args.options["agent-command"] = "builtin:codex";
  if (args.options.deepseek) args.options["agent-command"] = "builtin:deepseek";
  // -dir / --dir / -d : an intuitive alias for --repo — the project folder to review,
  // so `cw -q "…" -dir /path` works from any directory (no cd). Explicit --repo wins.
  if (!args.options.repo && args.options.dir) args.options.repo = args.options.dir;

  // Presentation flags — set BEFORE any drive spawn so the out-of-process agent wrapper
  // inherits them via process.env (presentation-only; stdout/the cw:result fence are untouched):
  //   --verbose   full agent narration inline (default is compact: current action + summary)
  //   --no-color  disable ANSI everywhere (CW_NO_COLOR is honored by term.colorEnabled AND the
  //               wrapper); complements NO_COLOR/FORCE_COLOR
  //   --full      also stream full narration AND print the report inline at run end
  if (args.options.verbose) process.env.CW_VERBOSE = "1";
  if (args.options["no-color"]) process.env.CW_NO_COLOR = "1";
  if (args.options.full) process.env.CW_OUTPUT = "full";

  // `cw <verb> --help` / `-h` -> per-command help (the verb's subcommands +
  // one-line summaries), derived from the capability registry. Additive: the
  // bare `cw` / `cw --help` top-level help is handled above.
  if ((args.options.help || args.options.h) && args.command && !args.command.startsWith("-")) {
    process.stdout.write(formatCommandHelp(args.command) + "\n");
    return;
  }

  // Bare -q / --question -> redirect to quickstart (auto-detect repo/agent/app).
  // CONSUME the positional (shift) so the question never survives as positionals[0]
  // — otherwise the quickstart handler reads it as the app id ("Workflow app not found").
  if (args.command === "-q" || args.command === "--question") {
    if (!args.options.question && args.positionals[0]) args.options.question = args.positionals.shift();
    args.command = "quickstart";
  } else if (!args.command && typeof args.options.question === "string") {
    args.command = "quickstart";
  }

  const runner = new CoolWorkflowRunner({
    pluginRoot: path.resolve(__dirname, "../..")
  });
  const scheduler = new Scheduler(String(args.options.cwd || process.cwd()));
  const triggers = new RoutineTriggerBridge(String(args.options.cwd || process.cwd()));

  switch (args.command) {
    case "help": {
      const [topic] = args.positionals;
      process.stdout.write((topic ? formatCommandHelp(topic) : formatHelp()) + "\n");
      return;
    }
    case undefined:
      process.stdout.write(formatHelp() + "\n");
      return;
    case "version":
      process.stdout.write(`${CURRENT_COOL_WORKFLOW_VERSION}\n`);
      return;
    case "update": {
      process.stderr.write("Updating cool-workflow...\n");
      const npm = spawnSync("npm", ["update", "-g", "cool-workflow"], { encoding: "utf8", stdio: "inherit" });
      if (npm.status !== 0) {
        process.stderr.write("Update failed, trying install...\n");
        const install = spawnSync("npm", ["install", "-g", "cool-workflow@latest"], { encoding: "utf8", stdio: "inherit" });
        if (install.status !== 0) {
          process.stderr.write("Install failed. Check npm and try again.\n");
          process.exitCode = 1;
        }
      }
      return;
    }
    case "fix": {
      const report = runDoctor(args.options, process.env, String(args.options.cwd || process.cwd()));
      process.stdout.write(`${formatDoctorFixes(report)}\n`);
      if (!report.ok) process.exitCode = 1;
      return;
    }
    case "list":
      printJson(runner.listWorkflows());
      return;
    case "search": {
      const keyword = args.positionals.join(" ");
      if (!keyword.trim()) throw new Error("Missing search keyword.\n  Tip: cw search architecture to find workflows about architecture.");
      const apps = runner.listApps();
      const lower = keyword.toLowerCase();
      const results = apps.filter((a) =>
        a.title.toLowerCase().includes(lower) || a.summary.toLowerCase().includes(lower) || a.id.toLowerCase().includes(lower)
      ).map((a) => ({ id: a.id, title: a.title, summary: a.summary }));
      if (wantsJson(args.options)) printJson(results);
      else process.stdout.write(`${formatSearchResults(keyword, results)}\n`);
      return;
    }
    case "man": {
      const [topic] = args.positionals;
      if (!topic) throw new Error("Missing topic.\n  Tip: cw man release-tooling for the release tooling manual.");
      const docsDir = path.resolve(runner.pluginRoot, "docs");
      const candidates = [
        path.join(docsDir, `${topic}.7.md`),
        path.join(docsDir, `${topic}.md`),
        path.join(docsDir, `${topic}`)
      ];
      let found: string | undefined;
      for (const c of candidates) { try { if (fs.statSync(c).isFile()) { found = c; break; } } catch { /* keep looking */ } }
      if (!found) throw new Error(`Man page not found: ${topic}.\n  Tip: cw list for workflow topics, or browse docs/ for manuals.`);
      process.stdout.write(fs.readFileSync(found, "utf8"));
      return;
    }
    case "info": {
      const [appId] = args.positionals;
      if (!appId) throw new Error("Missing workflow app id.\n  Tip: list apps with \"cw list\", then \"cw info <id>\" for details");
      const data = runner.showApp(appId);
      if (wantsJson(args.options)) printJson(data);
      else process.stdout.write(`${formatInfo(appId, data)}\n`);
      return;
    }
    case "doctor": {
      const report = runDoctor(args.options, process.env, String(args.options.cwd || process.cwd()));
      if (wantsJson(args.options)) printJson(report);
      else if (args.options.fix) process.stdout.write(`${formatDoctorFixes(report)}\n`);
      else process.stdout.write(`${formatDoctorReport(report)}\n`);
      if (!report.ok) process.exitCode = 1;
      return;
    }
    case "init": {
      const [workflowId] = args.positionals;
      if (!workflowId) throw new Error("Missing workflow id.\n  Tip: create one with \"cw init my-workflow\" or list with \"cw list\"");
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
          if (!result.valid) process.exitCode = 1;
          return;
        }
        case "init":
          printJson(runner.initApp(required(appIdOrPath, "app id"), args.options));
          return;
        case "package":
          printJson(runner.packageApp(required(appIdOrPath, "app id"), args.options));
          return;
        case "run":
          printJson(appRun(runner, { ...args.options, appId: required(appIdOrPath, "app id") }));
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
      await promptQuestion(args.options);
      const qs = quickstart(runner, { ...args.options, ...(appId ? { appId } : {}), ...(runId ? { runId } : {}) });
      printJson(qs);
      const qr = qs as unknown as Record<string, unknown>;
      // Clean human summary on stderr (TTY-gated, inside the reporter). Suppressed under --json so
      // machine mode emits ONLY the stdout payload — no stderr chrome to parse around. The type
      // guard also skips --check/--preview results (no reportPath of their own). The summary is the
      // COMPACT findings table (re-parsed from each completed worker's cw:result), the report path,
      // and where the per-worker transcripts live — NOT the full prose (that's report.md/--full).
      if (!wantsJson(args.options) && typeof qr.runId === "string" && typeof qr.reportPath === "string") {
        emitRunSummary(runner, args.options, {
          runId: qr.runId as string,
          reportPath: qr.reportPath as string,
          status: String(qr.status || ""),
          statePath: typeof qr.statePath === "string" ? (qr.statePath as string) : undefined,
          completedWorkers: typeof qr.completedWorkers === "number" ? (qr.completedWorkers as number) : undefined,
          plannedWorkers: typeof qr.plannedWorkers === "number" ? (qr.plannedWorkers as number) : undefined,
          agentConfigured: typeof qr.agentConfigured === "boolean" ? (qr.agentConfigured as boolean) : undefined
        });
      }
      if ((qs as { mode?: string; ok?: boolean }).mode === "check" && (qs as { ok?: boolean }).ok === false) {
        process.exitCode = 1;
      }
      // Fail closed: if --bundle produced an artifact that does not self-verify, exit
      // non-zero so `cw quickstart ... --bundle && send-to-client` cannot ship a report
      // whose bundle a client could not verify. Mirrors `report bundle`.
      if ((qs as { bundle?: { ok?: boolean } }).bundle && (qs as { bundle?: { ok?: boolean } }).bundle!.ok === false) {
        process.exitCode = 1;
      }
      return;
    }
    case "plan": {
      const [workflowId] = args.positionals;
      if (!workflowId) throw new Error("Missing workflow id.\n  Tip: plan an architecture review with \"cw plan architecture-review\"");
      printJson(planSummary(runner, workflowId, args.options));
      return;
    }
    case "status":
      if (!args.positionals[0]) {
        const nextActions = adviseNoRun();
        if (wantsJson(args.options)) printJson({ runId: null, nextActions });
        else process.stdout.write(`No run selected\n\nNext Action\n${nextActions.map((action) => `  ${action.command}\n    reason: ${action.reason}`).join("\n")}\n`);
      } else if (wantsJson(args.options)) printJson(runner.status(args.positionals[0]));
      else {
        const summary = runner.operatorStatus(args.positionals[0]);
        process.stdout.write(`${(args.options.summary || args.options.brief ? formatOperatorSummary(summary) : formatOperatorStatus(summary))}\n`);
      }
      return;
    case "next":
      printJson(runner.next(required(args.positionals[0], "run id"), args.options));
      return;
    case "dispatch":
      printJson(runner.dispatch(required(args.positionals[0], "run id"), args.options));
      return;
    case "result": {
      const [runId, taskId, resultPath] = args.positionals;
      printJson(
        runner.recordResult(
          required(runId, "run id"),
          required(taskId, "task id"),
          required(resultPath, "result file"),
          args.options
        )
      );
      return;
    }
    case "state": {
      const [subcommand, runId] = args.positionals;
      switch (subcommand) {
        case "check": {
          const report = runner.checkState(required(runId, "run id"), args.options);
          printJson(report);
          if (report.status === "unsupported") process.exitCode = 1;
          return;
        }
        default:
          throw new Error("Usage: cw.js state check <run-id> [--state PATH] [--write]");
      }
    }
    case "commit":
      if (args.positionals[0] === "summary") {
        const summary = runner.summarizeCommitRecords(required(args.positionals[1], "run id"));
        if (wantsJson(args.options)) printJson(summary);
        else process.stdout.write(`${formatCommitSummary(summary)}\n`);
        return;
      }
      printJson(runner.commit(required(args.positionals[0], "run id"), args.options));
      return;
    case "report":
      handleReport(args, runner);
      return;
    case "operator":
      handleOperator(args, runner);
      return;
    case "graph":
      handleGraph(args, runner);
      return;
    case "topology":
      handleTopology(args, runner);
      return;
    case "summary":
      handleSummary(args, runner);
      return;
    case "multi-agent":
      handleMultiAgent(args, runner);
      return;
    case "eval": {
      const [subcommand, first, second] = args.positionals;
      let result: unknown;
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
          if (!wantsJson(args.options) && (result as { status?: string }).status === "fail") process.exitCode = 1;
          break;
        case "report":
          result = runner.evalReport(required(first, "replay id or path"));
          break;
          default:
            throw new Error("Usage: cw.js eval snapshot <run-id> --id <snapshot-id> | replay <snapshot-id-or-path> | compare <baseline-id-or-path> <replay-id-or-path> | score <replay-id-or-path> | gate <suite-id-or-path> | report <replay-id-or-path>");
      }
      if (wantsJson(args.options)) printJson(result);
      else process.stdout.write(`${formatMultiAgentEval(result)}\n`);
      if (subcommand === "gate" && (result as { status?: string }).status === "fail") process.exitCode = 1;
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
          if (wantsJson(args.options)) printJson(digest);
          else process.stdout.write(`${formatBlackboardDigest(digest)}\n`);
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
          if (!result.valid) process.exitCode = 1;
          return;
        }
        case "choose":
        case "resolve":
          printJson(sandboxChoose(runner, { ...args.options, profileId: profileIdOrFile || args.options.profileId }));
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
            printJson(backendAgentConfigSet(args.options));
            return;
          }
          printJson(backendAgentConfigShow(args.options));
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
          if (wantsJson(args.options)) printJson(runner.graphNodes(required(runId, "run id")));
          else process.stdout.write(`${formatOperatorGraph(runner.operatorGraph(required(runId, "run id")))}\n`);
          return;
        case "snapshot":
          printJson(runner.nodeSnapshot(required(runId, "run id"), required(nodeId, "node id")));
          return;
        case "diff":
          printJson(
            runner.nodeDiff(
              required(runId, "run id"),
              required(nodeId, "baseline snapshot id"),
              required(args.positionals[3], "candidate snapshot id")
            )
          );
          return;
        case "replay":
          printJson(runner.nodeReplay(required(runId, "run id"), required(nodeId, "snapshot id")));
          return;
        case "verify": {
          const verdict = runner.nodeReplayVerify(required(runId, "run id"), required(nodeId, "replay id"));
          printJson(verdict);
          if (!verdict.pass) process.exitCode = 1;
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
          if (report.status === "unsupported") process.exitCode = 1;
          return;
        }
        case "prove": {
          const proof = runner.migrationProve(required(target, "target (run-id or state/app file)"), args.options);
          printJson(proof);
          if (!proof.pass) process.exitCode = 1;
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
          if (wantsJson(args.options)) printJson(summary);
          else process.stdout.write(`${formatFeedbackSummary(summary)}\n`);
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
    case "worker":
      handleWorker(args, runner);
      return;
    case "audit":
      handleAudit(args, runner);
      return;
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
          printJson(
            runner.rejectCandidate(
              required(runId, "run id"),
              required(candidateId, "candidate id"),
              String(args.options.reason || args.options.message || reason || "rejected")
            )
          );
          return;
        case "summary":
          if (wantsJson(args.options)) printJson(runner.summarizeCandidateOperatorRecords(required(runId, "run id")));
          else process.stdout.write(`${formatCandidateSummary(runner.summarizeCandidateOperatorRecords(required(runId, "run id")))}\n`);
          return;
        default:
          throw new Error("Usage: cw.js candidate list|show|register|score|rank|select|reject|summary <run-id> [candidate-id]");
      }
    }

    // ---- Team Collaboration (v0.1.32) ------------------------------------
    case "approve":
      handleApprove(args, runner);
      return;
    case "reject":
      handleReject(args, runner);
      return;
    case "comment":
      handleComment(args, runner);
      return;
    case "handoff":
      handleHandoff(args, runner);
      return;
    case "review":
      handleReview(args, runner);
      return;

    case "loop": {
      printJson(scheduler.create({ ...args.options, kind: "loop" }));
      return;
    }
    case "schedule":
      await handleSchedule(args, scheduler);
      return;
    case "routine":
      handleRoutine(args, triggers);
      return;
    case "registry":
      handleRegistry(args, runner);
      return;
    case "metrics": {
      const [subcommand, runId] = args.positionals;
      switch (subcommand) {
        case "show": {
          const report = runner.metricsShow(required(runId, "run id"), args.options);
          if (wantsJson(args.options)) printJson(report);
          else process.stdout.write(`${formatMetricsReport(report)}\n`);
          return;
        }
        case "summary": {
          const report = metricsSummary(runRegistryFor(args.options, runner), runner, args.options);
          if (wantsJson(args.options)) printJson(report);
          else process.stdout.write(`${formatMetricsSummary(report)}\n`);
          return;
        }
        default:
          throw new Error(
            "Usage: cw.js metrics show <run-id> | metrics summary [--scope repo|home] [--pricing <path>|default] [--json]"
          );
      }
    }
    case "run":
      handleRun(args, runner);
      return;
    case "queue":
      handleQueue(args, runner);
      return;
    case "sched":
      handleSched(args, runner);
      return;
    case "clones":
      handleClones(args);
      return;
    case "gc": {
      // Run Retention & Provable Reclamation (v0.1.39). `plan` is a pure dry-run
      // (frees nothing); `run` executes the write-ahead reclamation transaction;
      // `verify` re-proves a reclaimed run. CW never reclaims by default.
      const registry = runRegistryFor(args.options, runner);
      const [subcommand, id] = args.positionals;
      switch (subcommand) {
        case "plan": {
          const result = gcPlan(registry, id, args.options);
          if (wantsJson(args.options)) printJson(result);
          else process.stdout.write(`${formatGcPlan(result)}\n`);
          return;
        }
        case "run": {
          const result = gcRun(registry, id, args.options);
          if (wantsJson(args.options)) printJson(result);
          else process.stdout.write(`${formatGcRun(result)}\n`);
          return;
        }
        case "verify": {
          const result = gcVerify(registry, required(id, "run id"), args.options);
          if (wantsJson(args.options)) printJson(result);
          else process.stdout.write(`${formatGcVerify(result)}\n`);
          // Fail closed ONLY on a real integrity failure: a run that WAS reclaimed
          // but no longer re-proves. A not-reclaimed run has nothing to verify
          // (reclaimed:false/verified:false) and must not be treated as a failure.
          // LIMIT (honest): a DELETED reclaimed.json reads as reclaimed:false, so
          // proof-deletion is indistinguishable from never-reclaimed here without
          // an independent witness (e.g. a trust-audit reclamation event) — a
          // follow-up. This guard is still strictly better than the prior exit-0.
          if (result.reclaimed && !result.verified) process.exitCode = 1;
          return;
        }
        default:
          throw new Error("Usage: cw.js gc plan|run|verify [run-id] [--reclaimAfterArchiveDays N] [--keep-scratch] [--keep-snapshots] [--limit N] [--json]");
      }
    }
    case "history":
      handleHistory(args, runner);
      return;
    case "telemetry": {
      const [subcommand, id] = args.positionals;
      switch (subcommand) {
        case "verify": {
          const result = telemetryVerify(runner, { ...args.options, runId: id || args.options.runId || args.options.run });
          if (wantsJson(args.options)) printJson(result);
          else process.stdout.write(`${formatTelemetryVerify(result)}\n`);
          // Fail closed: a forged/edited/corrupt ledger verifies false — report it
          // through the exit code so `cw telemetry verify <run> && deploy` cannot
          // pass on a lie. (Absent ledger = present:false/verified:true -> exit 0.)
          if (!result.verified) process.exitCode = 1;
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
          const result = demoTamper(runner, args.options);
          if (wantsJson(args.options)) printJson(result);
          else process.stdout.write(`${formatTamperDemo(result)}\n`);
          // Fail closed: if the proof did not hold (a tamper went undetected),
          // exit nonzero so the demo can never green a broken guarantee.
          if (!result.proven) process.exitCode = 1;
          return;
        }
        case "bundle": {
          const result = demoBundle(runner, args.options);
          if (wantsJson(args.options)) printJson(result);
          else process.stdout.write(`${formatBundleDemo(result)}\n`);
          // Fail closed: a forged bundle that verified would be a regression in the
          // bundle guarantee — exit nonzero so the demo can never green it.
          if (!result.proven) process.exitCode = 1;
          return;
        }
        default:
          throw new Error("Usage: cw.js demo tamper|bundle [--json]");
      }
    }
    case "workbench":
      await handleWorkbench(args, runner);
      return;
    default:
      throw new Error(`Unknown command: ${args.command}${(suggestCommand(String(args.command || "")) ? `. Did you mean: ${suggestCommand(String(args.command))}?` : "")}`);
  }
}

/** Prompt the user for a question interactively when --question is missing on a TTY. */
async function promptQuestion(options: Record<string, unknown>): Promise<void> {
  if (options.question || !process.stdin.isTTY) return;
  const rl = readline.createInterface({ input: process.stdin, output: process.stderr });
  return new Promise<void>((resolve) => {
    rl.question("Question: ", (answer) => {
      rl.close();
      if (answer.trim()) options.question = answer.trim();
      resolve();
    });
  });
}

