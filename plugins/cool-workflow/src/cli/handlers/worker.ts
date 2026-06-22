// `cw worker` handler — carved out of the command-surface god-dispatch. Worker
// isolation/lifecycle verbs over a run (list/summary/show/manifest/output/fail/
// validate); thin routes to runner.worker* methods. `validate` and `fail` report
// boundary violations through the exit code, not just stdout.
import { CoolWorkflowRunner, parseArgv } from "../../orchestrator";
import { formatWorkerSummary } from "../../operator-ux";
import { printJson, required, wantsJson } from "../io";

type ParsedArgs = ReturnType<typeof parseArgv>;

/** `cw worker list|summary|show|manifest|output|fail|validate <run-id> [worker-id] [result-file]`. */
export function handleWorker(args: ParsedArgs, runner: CoolWorkflowRunner): void {
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
          required(resultPath, "result file"),
          args.options
        )
      );
      return;
    case "fail":
      printJson(
        runner.recordWorkerFailure(
          required(runId, "run id"),
          required(workerId, "worker id"),
          String(args.options.message || required(resultPath, "failure message")),
          args.options
        )
      );
      return;
    case "validate": {
      // Non-null = a boundary violation: a validate verb must report an invalid
      // verdict through its exit code, not just print it and exit 0.
      const violation = runner.validateWorker(required(runId, "run id"), required(workerId, "worker id"), resultPath);
      printJson(violation);
      if (violation) process.exitCode = 1;
      return;
    }
    default:
      throw new Error("Usage: cw.js worker list|summary|show|manifest|output|fail|validate <run-id> [worker-id] [result-file]");
  }
}
