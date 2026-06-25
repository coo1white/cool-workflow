// `cw feedback|metrics|migration|sandbox|backend|contract …` handlers — the
// operational/diagnostic families, carved out of the command-surface
// god-dispatch in the final cycle. Each inner case prints inline and returns
// (no shared tail; mirrors maintenance.ts). THREE fail-closed exits live here,
// copied verbatim: sandbox validate (!result.valid), migration check
// (status === "unsupported"), migration prove (!proof.pass).
// runRegistryFor moved here too: `metrics summary` was its last
// command-surface user, so its import follows the case it serves.
import { CoolWorkflowRunner, parseArgv } from "../../orchestrator";
import { metricsSummary, runRegistryFor, sandboxChoose, backendAgentConfigShow, backendAgentConfigSet } from "../../capability-core";
import { formatMetricsReport, formatMetricsSummary } from "../../observability";
import { formatFeedbackSummary } from "../../operator-ux";
import { printJson, required, wantsJson } from "../io";

type ParsedArgs = ReturnType<typeof parseArgv>;

/** `cw sandbox list|show|validate|choose|resolve [profile-id|profile-file]`. */
export function handleSandbox(args: ParsedArgs, runner: CoolWorkflowRunner): void {
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

/** `cw backend list|show|probe [backend-id]  |  cw backend agent config [show|set] …`. */
export function handleBackend(args: ParsedArgs, runner: CoolWorkflowRunner): void {
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

/** `cw contract show <run-id> [contract-id]`. */
export function handleContract(args: ParsedArgs, runner: CoolWorkflowRunner): void {
  const [subcommand, runId, contractId] = args.positionals;
  switch (subcommand) {
    case "show":
      printJson(runner.showContract(required(runId, "run id"), contractId));
      return;
      default:
        throw new Error("Usage: cw.js contract show <run-id> [contract-id]");
  }
}

/** `cw migration list|check|prove [target] …`. */
export function handleMigration(args: ParsedArgs, runner: CoolWorkflowRunner): void {
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

/** `cw feedback list|show|summary|collect|task|resolve <run-id> [feedback-id]`. */
export function handleFeedback(args: ParsedArgs, runner: CoolWorkflowRunner): void {
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

/** `cw metrics show <run-id> | metrics summary …`. */
export function handleMetrics(args: ParsedArgs, runner: CoolWorkflowRunner): void {
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
