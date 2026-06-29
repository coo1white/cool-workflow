// `cw schedule` / `cw routine` / `cw sched` handlers — the scheduling command
// family, carved out of the command-surface god-dispatch. Three sibling verbs:
//   schedule — desktop scheduler (create/list/.../daemon) over the Scheduler
//   routine  — routine triggers (create/list/delete/fire/events) over the bridge
//   sched    — durable run-queue scheduling (plan/lease/release/.../policy)
import fs from "node:fs";
import { CoolWorkflowRunner, parseArgv } from "../../orchestrator";
import { DesktopSchedulerDaemon } from "../../daemon";
import type { Scheduler } from "../../scheduler";
import type { RoutineTriggerBridge } from "../../triggers";
import {
  runRegistryFor,
  schedPlan,
  schedLease,
  schedRelease,
  schedComplete,
  schedReclaim,
  schedReset,
  schedPolicyShow,
  schedPolicySet
} from "../../capability-core";
import { printJson, required } from "../io";

type ParsedArgs = ReturnType<typeof parseArgv>;

/** `cw schedule create|list|delete|due|complete|pause|resume|run-now|history|daemon`. */
export async function handleSchedule(args: ParsedArgs, scheduler: Scheduler): Promise<void> {
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

/** `cw routine create|list|delete|fire|events`. */
export function handleRoutine(args: ParsedArgs, triggers: RoutineTriggerBridge): void {
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
      let payload: unknown;
      try {
        payload = payloadPath ? JSON.parse(fs.readFileSync(payloadPath, "utf8")) : args.options;
      } catch (e) {
        throw new Error(`Failed to parse payload${payloadPath ? ` file "${payloadPath}"` : ""}: ${String(e && (e as Error).message || e)}`);
      }
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

/** `cw sched plan|lease|release|complete|reclaim|reset|policy [show|set]` — durable run-queue. */
export function handleSched(args: ParsedArgs, runner: CoolWorkflowRunner): void {
  const registry = runRegistryFor(args.options, runner);
  const [subcommand, idArg] = args.positionals;
  switch (subcommand) {
    case "plan":
      printJson(schedPlan(registry, args.options));
      return;
    case "lease":
      printJson(schedLease(registry, args.options));
      return;
    case "release":
      printJson(schedRelease(registry, { ...args.options, leaseId: args.options.leaseId || idArg }));
      return;
    case "complete":
      printJson(schedComplete(registry, { ...args.options, leaseId: args.options.leaseId || idArg }));
      return;
    case "reclaim":
      printJson(schedReclaim(registry, args.options));
      return;
    case "reset":
      printJson(schedReset(registry, { ...args.options, id: args.options.id || idArg }));
      return;
    case "policy": {
      const [, action] = args.positionals;
      if (action === "set") {
        printJson(schedPolicySet(registry, args.options));
        return;
      }
      printJson(schedPolicyShow(registry));
      return;
    }
    default:
      throw new Error("Usage: cw.js sched plan|lease|release|complete|reclaim|reset|policy [show|set] [id] [--maxConcurrent N --maxAttempts N ...]");
  }
}
