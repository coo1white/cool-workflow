#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { CoolWorkflowRunner, formatHelp, parseArgv } from "./orchestrator";
import { DesktopSchedulerDaemon } from "./daemon";
import { Scheduler } from "./scheduler";
import { RoutineTriggerBridge } from "./triggers";
import {
  adviseNoRun,
  formatCandidateSummary,
  formatCommitSummary,
  formatFeedbackSummary,
  formatMultiAgentSummary,
  formatOperatorGraph,
  formatOperatorReport,
  formatOperatorStatus,
  formatWorkerSummary
} from "./operator-ux";

async function main(): Promise<void> {
  const args = parseArgv(process.argv.slice(2));
  const runner = new CoolWorkflowRunner({
    pluginRoot: path.resolve(__dirname, "..")
  });
  const scheduler = new Scheduler(String(args.options.cwd || process.cwd()));
  const triggers = new RoutineTriggerBridge(String(args.options.cwd || process.cwd()));

  switch (args.command) {
    case "help":
    case undefined:
      process.stdout.write(formatHelp());
      return;
    case "list":
      printJson(runner.listWorkflows());
      return;
    case "init": {
      const [workflowId] = args.positionals;
      if (!workflowId) throw new Error("Missing workflow id. Example: cw.js init my-workflow");
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
        default:
          throw new Error("Usage: cw.js app list|show|validate|init|package [app-id|path]");
      }
    }
    case "plan": {
      const [workflowId] = args.positionals;
      if (!workflowId) throw new Error("Missing workflow id. Example: cw.js plan architecture-review");
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
      if (!args.positionals[0]) {
        const nextActions = adviseNoRun();
        if (wantsJson(args.options)) printJson({ runId: null, nextActions });
        else process.stdout.write(`No run selected\n\nNext Action\n${nextActions.map((action) => `  ${action.command}\n    reason: ${action.reason}`).join("\n")}\n`);
      } else if (wantsJson(args.options)) printJson(runner.status(args.positionals[0]));
      else process.stdout.write(`${formatOperatorStatus(runner.operatorStatus(args.positionals[0]))}\n`);
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
    case "report": {
      const report = runner.report(required(args.positionals[0], "run id"));
      if (args.options.show || args.options.summary) {
        process.stdout.write(`${formatOperatorReport(runner.operatorReport(required(args.positionals[0], "run id")))}\n`);
      } else {
        process.stdout.write(`${report.path}\n`);
      }
      return;
    }
    case "graph": {
      const graph = runner.operatorGraph(required(args.positionals[0], "run id"));
      if (wantsJson(args.options)) printJson(graph);
      else process.stdout.write(`${formatOperatorGraph(graph)}\n`);
      return;
    }
    case "multi-agent": {
      const [subcommand, runId, id] = args.positionals;
      switch (subcommand) {
        case "summary": {
          const summary = runner.multiAgentSummary(required(runId, "run id"));
          if (wantsJson(args.options)) printJson(summary);
          else process.stdout.write(`${formatMultiAgentSummary(summary)}\n`);
          return;
        }
        case "graph": {
          const graph = runner.multiAgentGraph(required(runId, "run id"));
          if (wantsJson(args.options)) printJson(graph);
          else process.stdout.write(`${formatOperatorGraph({ runId: required(runId, "run id"), nodes: graph.nodes, edges: graph.edges })}\n`);
          return;
        }
        case "run":
          if (id && !args.options.id && !args.options.status) printJson(runner.showMultiAgentRun(required(runId, "run id"), id));
          else if (id && args.options.status) printJson(runner.transitionMultiAgentRun(required(runId, "run id"), id, args.options));
          else printJson(runner.createMultiAgentRun(required(runId, "run id"), args.options));
          return;
        case "show":
          printJson(runner.showMultiAgentRun(required(runId, "run id"), required(id, "multi-agent run id")));
          return;
        case "role":
          if (id && !args.options.id && !args.options["multi-agent-run"] && !args.options.multiAgentRun && !args.options.multiAgentRunId) {
            printJson(runner.showAgentRole(required(runId, "run id"), id));
          } else {
            printJson(runner.createAgentRole(required(runId, "run id"), { ...args.options, id: args.options.id || id }));
          }
          return;
        case "group":
          if (id && !args.options.id && !args.options["multi-agent-run"] && !args.options.multiAgentRun && !args.options.multiAgentRunId) {
            printJson(runner.showAgentGroup(required(runId, "run id"), id));
          } else {
            printJson(runner.createAgentGroup(required(runId, "run id"), { ...args.options, id: args.options.id || id }));
          }
          return;
        case "membership":
          if (id && !args.options.id && !args.options.group && !args.options.groupId && !args.options["multi-agent-group"]) {
            printJson(runner.showAgentMembership(required(runId, "run id"), id));
          } else {
            printJson(runner.assignAgentMembership(required(runId, "run id"), { ...args.options, id: args.options.id || id }));
          }
          return;
        case "fanout":
          if (id && !args.options.id && !args.options.group && !args.options.groupId && !args.options["multi-agent-group"]) {
            printJson(runner.showAgentFanout(required(runId, "run id"), id));
          } else {
            printJson(runner.createAgentFanout(required(runId, "run id"), { ...args.options, id: args.options.id || id }));
          }
          return;
        case "fanin":
          if (id && !args.options.id && !args.options.group && !args.options.groupId && !args.options["multi-agent-group"] && !args.options.fanout) {
            printJson(runner.showAgentFanin(required(runId, "run id"), id));
          } else {
            printJson(runner.collectAgentFanin(required(runId, "run id"), { ...args.options, id: args.options.id || id }));
          }
          return;
        default:
          throw new Error("Usage: cw.js multi-agent summary|graph|run|show|role|group|membership|fanout|fanin <run-id> [id]");
      }
    }
    case "blackboard": {
      const [subcommand, action, runId] = args.positionals;
      switch (subcommand) {
        case "summary":
          printJson(runner.blackboardSummary(required(action, "run id"), args.options));
          return;
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
      throw new Error("Usage: cw.js blackboard summary|graph|resolve <run-id> | topic create <run-id> | message post|list <run-id> | context put <run-id> | artifact add|list <run-id> | snapshot <run-id>");
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
        case "validate":
          printJson(runner.validateSandboxProfile(required(profileIdOrFile, "profile file"), args.options));
          return;
        default:
          throw new Error("Usage: cw.js sandbox list|show|validate [profile-id|profile-file]");
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
    case "worker": {
      const [subcommand, runId, workerId, resultPath] = args.positionals;
      switch (subcommand) {
        case "list":
          printJson(runner.listWorkers(required(runId, "run id"), args.options));
          return;
        case "summary": {
          const summary = runner.summarizeWorkerRecords(required(runId, "run id"));
          if (wantsJson(args.options)) printJson(summary);
          else process.stdout.write(`${formatWorkerSummary(summary)}\n`);
          return;
        }
        case "show":
          printJson(runner.showWorker(required(runId, "run id"), required(workerId, "worker id")));
          return;
        case "manifest":
          printJson(runner.showWorkerManifest(required(runId, "run id"), required(workerId, "worker id")));
          return;
        case "output":
          printJson(
            runner.recordWorkerOutput(
              required(runId, "run id"),
              required(workerId, "worker id"),
              required(resultPath, "result file")
            )
          );
          return;
        case "fail":
          printJson(
            runner.recordWorkerFailure(
              required(runId, "run id"),
              required(workerId, "worker id"),
              String(args.options.message || args.options.m || required(resultPath, "failure message")),
              args.options
            )
          );
          return;
        case "validate":
          printJson(runner.validateWorker(required(runId, "run id"), required(workerId, "worker id"), resultPath));
          return;
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
        case "worker":
          printJson(runner.workerAudit(required(runId, "run id"), required(id, "worker id")));
          return;
        case "provenance":
          printJson(runner.evidenceProvenance(required(runId, "run id"), args.options));
          return;
        case "attest":
          printJson(runner.recordAuditAttestation(required(runId, "run id"), args.options));
          return;
        case "decision":
          printJson(runner.recordAuditDecision(required(runId, "run id"), required(id, "worker id"), args.options));
          return;
        default:
          throw new Error("Usage: cw.js audit summary|worker|provenance|attest|decision <run-id> [worker-id]");
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
          const daemon = new DesktopSchedulerDaemon({
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
          const payload = payloadPath ? JSON.parse(fs.readFileSync(payloadPath, "utf8")) : args.options;
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

function required(value: string | undefined, label: string): string {
  if (!value) throw new Error(`Missing ${label}`);
  return value;
}

function printJson(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

function wantsJson(options: Record<string, unknown>): boolean {
  return Boolean(options.json || options.format === "json");
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`cw: ${message}\n`);
  process.exitCode = 1;
});
