// `cw node <verb> …` handler — the node inspection family
// (list/show/graph/snapshot/diff/replay/verify), carved out of the
// command-surface god-dispatch. Each verb prints inline and returns (no shared
// tail). `diff` reads args.positionals[3] DIRECTLY (the destructure only pulls
// 3). FAIL-CLOSED: node verify sets process.exitCode = 1 when the verdict does
// not pass. operatorGraph is a runner method; formatOperatorGraph is the
// operator-ux formatter (imported here) — do not conflate the two.
import { CoolWorkflowRunner, parseArgv } from "../../orchestrator";
import { formatOperatorGraph } from "../../operator-ux";
import { printJson, required, wantsJson } from "../io";

type ParsedArgs = ReturnType<typeof parseArgv>;

/** `cw node list|show|graph|snapshot|diff|replay|verify <run-id> …` — node inspection. */
export function handleNode(args: ParsedArgs, runner: CoolWorkflowRunner): void {
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
