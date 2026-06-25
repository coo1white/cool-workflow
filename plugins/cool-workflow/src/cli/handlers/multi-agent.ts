// `cw multi-agent <verb> <run-id> [id]` handlers — the multi-agent operator
// family, carved out of the command-surface god-dispatch. Drives a run's
// agent host: run/status/step, blackboard/score/select, and the operator
// read views (summary/summarize/graph/dependencies/failures/evidence/reasoning)
// plus the role/group/membership/fanout/fanin shape, as text or `--json`.
import { CoolWorkflowRunner, parseArgv } from "../../orchestrator";
import { formatMultiAgentSummary, formatOperatorGraph } from "../../operator-ux";
import { formatMultiAgentDependencies, formatMultiAgentEvidence, formatMultiAgentFailures, formatMultiAgentOperatorStatus } from "../../multi-agent-operator-ux";
import { formatCompactGraph, formatStateExplosionReport } from "../../state-explosion";
import { formatEvidenceReasoningReport } from "../../evidence-reasoning";
import { printJson, required, wantsJson } from "../io";

type ParsedArgs = ReturnType<typeof parseArgv>;

/** `cw multi-agent <verb> <run-id> [id]` — the multi-agent operator surface. */
export function handleMultiAgent(args: ParsedArgs, runner: CoolWorkflowRunner): void {
  const [subcommand, runId, id] = args.positionals;
  switch (subcommand) {
    case "status":
      if (wantsJson(args.options)) printJson(runner.hostMultiAgentStatus(required(runId, "run id")));
      else process.stdout.write(`${formatMultiAgentOperatorStatus(runner.multiAgentOperatorStatus(required(runId, "run id")))}\n`);
      return;
    case "step":
      printJson(runner.hostMultiAgentStep(required(runId, "run id"), args.options));
      return;
    case "blackboard":
      printJson(runner.hostMultiAgentBlackboard(required(runId, "run id"), id, args.options));
      return;
    case "score":
      printJson(runner.hostMultiAgentScore(required(runId, "run id"), { ...args.options, candidate: args.options.candidate || args.options.candidateId || id }));
      return;
    case "select":
      printJson(runner.hostMultiAgentSelect(required(runId, "run id"), { ...args.options, candidate: args.options.candidate || args.options.candidateId || id }));
      return;
    case "summary": {
      const summary = runner.multiAgentSummary(required(runId, "run id"));
      if (wantsJson(args.options)) printJson(summary);
      else process.stdout.write(`${formatMultiAgentSummary(summary)}\n`);
      return;
    }
    case "summarize": {
      const report = runner.multiAgentSummarize(required(runId, "run id"));
      if (wantsJson(args.options)) printJson(report);
      else process.stdout.write(`${formatStateExplosionReport(report)}\n`);
      return;
    }
    case "graph": {
      const wantsView = args.options.view || args.options.focus || args.options.depth;
      if (wantsView) {
        const graph = runner.multiAgentGraphView(required(runId, "run id"), args.options);
        if (wantsJson(args.options)) printJson(graph);
        else process.stdout.write(`${formatCompactGraph(graph)}\n`);
        return;
      }
      const graph = runner.multiAgentOperatorGraph(required(runId, "run id"));
      if (wantsJson(args.options)) printJson(graph);
      else process.stdout.write(`${formatOperatorGraph({ runId: required(runId, "run id"), nodes: graph.nodes, edges: graph.edges })}\n`);
      return;
    }
    case "dependencies": {
      const rows = runner.multiAgentDependencies(required(runId, "run id"));
      if (wantsJson(args.options)) printJson(rows);
      else process.stdout.write(`${formatMultiAgentDependencies(rows)}\n`);
      return;
    }
    case "failures": {
      const rows = runner.multiAgentFailures(required(runId, "run id"));
      if (wantsJson(args.options)) printJson(rows);
      else process.stdout.write(`${formatMultiAgentFailures(rows)}\n`);
      return;
    }
    case "evidence": {
      const rows = runner.multiAgentEvidence(required(runId, "run id"));
      if (wantsJson(args.options)) printJson(rows);
      else process.stdout.write(`${formatMultiAgentEvidence(rows)}\n`);
      return;
    }
    case "reasoning": {
      if (args.options.refresh && !args.options.evidence && !args.options.evidenceId) {
        const index = runner.multiAgentReasoningRefresh(required(runId, "run id"));
        printJson(index);
        return;
      }
      const report = runner.multiAgentReasoning(required(runId, "run id"), { ...args.options, evidence: args.options.evidence || args.options.evidenceId || id });
      if (wantsJson(args.options)) printJson(report);
      else process.stdout.write(`${formatEvidenceReasoningReport(report)}\n`);
      return;
    }
    case "run":
      if (
        !runId ||
        args.options.topology ||
        args.options.topologyId ||
        args.options.app ||
        args.options.appId ||
        args.options.workflow ||
        args.options.workflowId
      ) {
        printJson(runner.hostMultiAgentRun(runId, args.options));
        return;
      }
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
        throw new Error("Usage: cw.js multi-agent run|status|step|blackboard|score|select|summary|summarize|graph|dependencies|failures|evidence|reasoning|show|role|group|membership|fanout|fanin <run-id> [id]");
  }
}
