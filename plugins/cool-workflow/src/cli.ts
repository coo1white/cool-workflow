#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { CoolWorkflowRunner, formatHelp, parseArgv } from "./orchestrator";
import { DesktopSchedulerDaemon } from "./daemon";
import { Scheduler } from "./scheduler";
import { RoutineTriggerBridge } from "./triggers";

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

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`cw: ${message}\n`);
  process.exitCode = 1;
});
