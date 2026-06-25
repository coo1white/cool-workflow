// `cw blackboard …` and `cw coordinator …` handlers — the shared-blackboard
// family (summary/summarize/graph/resolve/topic/message/context/artifact/
// snapshot) plus the coordinator decision ledger (summary/decision), carved out
// of the command-surface god-dispatch. The topic/message/context/artifact verbs
// guard on the action word and `break;` on a non-match so the trailing Usage
// throw still fires — those breaks must stay breaks (a return would mute the
// error). formatBlackboardDigest travels here as its only remaining consumer.
import { CoolWorkflowRunner, parseArgv } from "../../orchestrator";
import { formatBlackboardDigest } from "../../state-explosion";
import { printJson, required, wantsJson } from "../io";

type ParsedArgs = ReturnType<typeof parseArgv>;

/** `cw blackboard <verb> <run-id> …` — shared-blackboard read/write family. */
export function handleBlackboard(args: ParsedArgs, runner: CoolWorkflowRunner): void {
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

/** `cw coordinator summary|decision <run-id> …` — coordinator decision ledger. */
export function handleCoordinator(args: ParsedArgs, runner: CoolWorkflowRunner): void {
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
