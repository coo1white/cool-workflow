// `cw registry` / `cw queue` / `cw history` handlers — the run-registry read
// family, carved out of the command-surface god-dispatch. Each resolves the run
// registry for the requested scope (repo/home) and routes to a capability-core fn,
// rendering human text or `--json`.
import { CoolWorkflowRunner, parseArgv } from "../../orchestrator";
import {
  runRegistryFor,
  runRegistryRefresh,
  runRegistryShow,
  runHistory,
  queueAdd,
  queueList,
  queueDrain,
  queueShow
} from "../../capability-core";
import { formatRegistryReport, formatQueueList, formatHistory } from "../../run-registry";
import { printJson, required, wantsJson } from "../io";

type ParsedArgs = ReturnType<typeof parseArgv>;

/** `cw registry refresh|show [--scope repo|home] [--json]`. */
export function handleRegistry(args: ParsedArgs, runner: CoolWorkflowRunner): void {
  const registry = runRegistryFor(args.options, runner);
  const [subcommand] = args.positionals;
  switch (subcommand) {
    case "refresh": {
      const report = runRegistryRefresh(registry, args.options);
      if (wantsJson(args.options)) printJson(report);
      else process.stdout.write(`${formatRegistryReport(report)}\n`);
      return;
    }
    case "show": {
      const report = runRegistryShow(registry, args.options);
      if (wantsJson(args.options)) printJson(report);
      else process.stdout.write(`${formatRegistryReport(report)}\n`);
      return;
    }
    default:
      throw new Error("Usage: cw.js registry refresh|show [--scope repo|home] [--json]");
  }
}

/** `cw queue add|list|drain|show [queue-id] [--repo PATH] [--priority N]`. */
export function handleQueue(args: ParsedArgs, runner: CoolWorkflowRunner): void {
  const registry = runRegistryFor(args.options, runner);
  const [subcommand, id] = args.positionals;
  switch (subcommand) {
    case "add":
      printJson(queueAdd(registry, args.options));
      return;
    case "list": {
      const result = queueList(registry, args.options);
      if (wantsJson(args.options)) printJson(result);
      else process.stdout.write(`${formatQueueList(result)}\n`);
      return;
    }
    case "drain":
      printJson(queueDrain(registry, args.options));
      return;
    case "show":
      printJson(queueShow(registry, required(id, "queue id")));
      return;
    default:
      throw new Error("Usage: cw.js queue add|list|drain|show [queue-id] [--repo PATH] [--priority N]");
  }
}

/** `cw history [--json]` — recent runs across the resolved registry scope. */
export function handleHistory(args: ParsedArgs, runner: CoolWorkflowRunner): void {
  const registry = runRegistryFor(args.options, runner);
  const result = runHistory(registry, args.options);
  if (wantsJson(args.options)) printJson(result);
  else process.stdout.write(`${formatHistory(result)}\n`);
}
