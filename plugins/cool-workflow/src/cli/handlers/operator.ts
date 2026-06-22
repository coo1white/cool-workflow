// `cw report` / `operator` / `graph` / `topology` / `summary` handlers — the
// operator-surface read family, carved out of the command-surface god-dispatch.
// Render a run's report / operator status / graph / topology / state-explosion
// summary as human text or `--json`; report also exports + verifies sealed bundles.
import { CoolWorkflowRunner, parseArgv } from "../../orchestrator";
import { reportBundle, runVerifyReportBundle } from "../../capability-core";
import {
  formatOperatorGraph,
  formatOperatorReport,
  formatOperatorStatus,
  formatOperatorSummary,
  formatTopologySummary
} from "../../operator-ux";
import { formatStateExplosionReport } from "../../state-explosion";
import { optionalArg, printJson, required, wantsJson } from "../io";

type ParsedArgs = ReturnType<typeof parseArgv>;

/** `cw report <run-id> [--show] | report bundle <run-id> | report verify-bundle <path>`. */
export function handleReport(args: ParsedArgs, runner: CoolWorkflowRunner): void {
  // `report verify-bundle <path>` is the offline self-contained bundle verifier;
  // `report bundle <run-id>` exports a sealed bundle and self-verifies it;
  // every other `report <run-id>` form prints/inspects a local run's report.
  if (args.positionals[0] === "verify-bundle") {
    const result = runVerifyReportBundle(runner, { ...args.options, archive: args.positionals[1] || args.options.archive || args.options.path || args.options.file || args.options.bundle });
    printJson(result);
    // Fail closed: a forged/edited/corrupt bundle verifies false — surface it
    // through the exit code so `cw report verify-bundle <file> && ship` cannot
    // pass on a lie. Mirrors run inspect-archive / telemetry verify.
    if (!result.ok) process.exitCode = 1;
    return;
  }
  if (args.positionals[0] === "bundle") {
    const result = reportBundle(runner, required(args.positionals[1] || optionalArg(args.options.runId || args.options.run), "run id"), args.options);
    printJson(result);
    // Fail closed: never report a "bundle made" success if the artifact does not
    // self-verify — so `cw report bundle <run> && send-to-client` cannot ship an
    // unverifiable report (e.g. no trust key under --strict-signatures).
    if (!result.ok) process.exitCode = 1;
    return;
  }
  const runId = required(args.positionals[0], "run id");
  const report = runner.report(runId);
  if (wantsJson(args.options)) {
    printJson(report);
  } else if (args.options.show || args.options.summary) {
    process.stdout.write(`${formatOperatorReport(runner.operatorReport(runId))}\n`);
    process.stdout.write(`\n${formatStateExplosionReport(runner.stateExplosionReport(runId))}\n`);
  } else {
    process.stdout.write(`${report.path}\n`);
  }
}

/** `cw operator status|report <run-id> [--json]`. */
export function handleOperator(args: ParsedArgs, runner: CoolWorkflowRunner): void {
  const [subcommand, runId] = args.positionals;
  switch (subcommand) {
    case "status":
      if (wantsJson(args.options)) printJson(runner.operatorStatus(required(runId, "run id")));
      else {
        const summary = runner.operatorStatus(required(runId, "run id"));
        process.stdout.write(`${(args.options.summary || args.options.brief ? formatOperatorSummary(summary) : formatOperatorStatus(summary))}\n`);
      }
      return;
    case "report":
      if (wantsJson(args.options)) printJson(runner.operatorReport(required(runId, "run id")));
      else process.stdout.write(`${formatOperatorReport(runner.operatorReport(required(runId, "run id")))}\n`);
      return;
    default:
      throw new Error("Usage: cw.js operator status|report <run-id> [--json]");
  }
}

/** `cw graph <run-id> [--json]` — the operator run graph. */
export function handleGraph(args: ParsedArgs, runner: CoolWorkflowRunner): void {
  const graph = runner.operatorGraph(required(args.positionals[0], "run id"));
  if (wantsJson(args.options)) printJson(graph);
  else process.stdout.write(`${formatOperatorGraph(graph)}\n`);
}

/** `cw topology list|show|validate|apply|summary|graph …`. */
export function handleTopology(args: ParsedArgs, runner: CoolWorkflowRunner): void {
  const [subcommand, first, second] = args.positionals;
  switch (subcommand) {
    case "list":
      printJson(runner.listTopologies());
      return;
    case "show":
      if (second) printJson(runner.showTopologyRun(required(first, "run id"), second));
      else printJson(runner.showTopology(required(first, "topology id")));
      return;
    case "validate": {
      const result = runner.validateTopology(required(first, "topology id"));
      printJson(result);
      if (!result.valid) process.exitCode = 1;
      return;
    }
    case "apply":
      printJson(runner.applyTopology(required(first, "run id"), required(second, "topology id"), args.options));
      return;
    case "summary": {
      const summary = runner.topologySummary(required(first, "run id"));
      if (wantsJson(args.options)) printJson(summary);
      else process.stdout.write(`${formatTopologySummary(summary)}\n`);
      return;
    }
    case "graph": {
      const graph = runner.topologyGraph(required(first, "run id"));
      if (wantsJson(args.options)) printJson(graph);
      else process.stdout.write(`${formatOperatorGraph({ runId: required(first, "run id"), nodes: graph.nodes, edges: graph.edges })}\n`);
      return;
    }
    default:
      throw new Error("Usage: cw.js topology list|show <topology-id>|show <run-id> <topology-run-id>|validate <topology-id>|apply <run-id> <topology-id>|summary <run-id>|graph <run-id>");
  }
}

/** `cw summary refresh|show <run-id> [--json]` — durable state-explosion summary. */
export function handleSummary(args: ParsedArgs, runner: CoolWorkflowRunner): void {
  const [subcommand, runId] = args.positionals;
  switch (subcommand) {
    case "refresh": {
      const index = runner.summaryRefresh(required(runId, "run id"), args.options);
      if (wantsJson(args.options)) printJson(index);
      else process.stdout.write(`${formatStateExplosionReport(runner.summaryShow(required(runId, "run id")))}\n`);
      return;
    }
    case "show": {
      const report = runner.summaryShow(required(runId, "run id"));
      if (wantsJson(args.options)) printJson(report);
      else process.stdout.write(`${formatStateExplosionReport(report)}\n`);
      return;
    }
    default:
      throw new Error("Usage: cw.js summary refresh|show <run-id> [--json]");
  }
}
