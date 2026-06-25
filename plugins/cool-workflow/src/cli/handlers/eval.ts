// `cw eval <verb> …` handler — the multi-agent eval family
// (snapshot/replay/compare/score/gate/report), carved out of the
// command-surface god-dispatch. Each inner case sets `result` and `break;`s —
// those breaks are LOAD-BEARING: they fall through to a shared tail that prints
// (JSON or formatMultiAgentEval). FAIL-CLOSED: eval gate sets process.exitCode
// = 1 at TWO distinct sites (inside `case "gate"` and again in the shared tail);
// both are intentional — do not merge or drop either.
import { CoolWorkflowRunner, parseArgv } from "../../orchestrator";
import { formatMultiAgentEval } from "../../multi-agent-eval";
import { printJson, required, wantsJson } from "../io";

type ParsedArgs = ReturnType<typeof parseArgv>;

/** `cw eval snapshot|replay|compare|score|gate|report …` — multi-agent eval. */
export function handleEval(args: ParsedArgs, runner: CoolWorkflowRunner): void {
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
}
