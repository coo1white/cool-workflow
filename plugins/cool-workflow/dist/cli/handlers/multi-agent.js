"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.handleMultiAgent = handleMultiAgent;
const operator_ux_1 = require("../../operator-ux");
const multi_agent_operator_ux_1 = require("../../multi-agent-operator-ux");
const state_explosion_1 = require("../../state-explosion");
const evidence_reasoning_1 = require("../../evidence-reasoning");
const io_1 = require("../io");
/** `cw multi-agent <verb> <run-id> [id]` — the multi-agent operator surface. */
function handleMultiAgent(args, runner) {
    const [subcommand, runId, id] = args.positionals;
    switch (subcommand) {
        case "status":
            if ((0, io_1.wantsJson)(args.options))
                (0, io_1.printJson)(runner.hostMultiAgentStatus((0, io_1.required)(runId, "run id")));
            else
                process.stdout.write(`${(0, multi_agent_operator_ux_1.formatMultiAgentOperatorStatus)(runner.multiAgentOperatorStatus((0, io_1.required)(runId, "run id")))}\n`);
            return;
        case "step":
            (0, io_1.printJson)(runner.hostMultiAgentStep((0, io_1.required)(runId, "run id"), args.options));
            return;
        case "blackboard":
            (0, io_1.printJson)(runner.hostMultiAgentBlackboard((0, io_1.required)(runId, "run id"), id, args.options));
            return;
        case "score":
            (0, io_1.printJson)(runner.hostMultiAgentScore((0, io_1.required)(runId, "run id"), { ...args.options, candidate: args.options.candidate || args.options.candidateId || id }));
            return;
        case "select":
            (0, io_1.printJson)(runner.hostMultiAgentSelect((0, io_1.required)(runId, "run id"), { ...args.options, candidate: args.options.candidate || args.options.candidateId || id }));
            return;
        case "summary": {
            const summary = runner.multiAgentSummary((0, io_1.required)(runId, "run id"));
            if ((0, io_1.wantsJson)(args.options))
                (0, io_1.printJson)(summary);
            else
                process.stdout.write(`${(0, operator_ux_1.formatMultiAgentSummary)(summary)}\n`);
            return;
        }
        case "summarize": {
            const report = runner.multiAgentSummarize((0, io_1.required)(runId, "run id"));
            if ((0, io_1.wantsJson)(args.options))
                (0, io_1.printJson)(report);
            else
                process.stdout.write(`${(0, state_explosion_1.formatStateExplosionReport)(report)}\n`);
            return;
        }
        case "graph": {
            const wantsView = args.options.view || args.options.focus || args.options.depth;
            if (wantsView) {
                const graph = runner.multiAgentGraphView((0, io_1.required)(runId, "run id"), args.options);
                if ((0, io_1.wantsJson)(args.options))
                    (0, io_1.printJson)(graph);
                else
                    process.stdout.write(`${(0, state_explosion_1.formatCompactGraph)(graph)}\n`);
                return;
            }
            const graph = runner.multiAgentOperatorGraph((0, io_1.required)(runId, "run id"));
            if ((0, io_1.wantsJson)(args.options))
                (0, io_1.printJson)(graph);
            else
                process.stdout.write(`${(0, operator_ux_1.formatOperatorGraph)({ runId: (0, io_1.required)(runId, "run id"), nodes: graph.nodes, edges: graph.edges })}\n`);
            return;
        }
        case "dependencies": {
            const rows = runner.multiAgentDependencies((0, io_1.required)(runId, "run id"));
            if ((0, io_1.wantsJson)(args.options))
                (0, io_1.printJson)(rows);
            else
                process.stdout.write(`${(0, multi_agent_operator_ux_1.formatMultiAgentDependencies)(rows)}\n`);
            return;
        }
        case "failures": {
            const rows = runner.multiAgentFailures((0, io_1.required)(runId, "run id"));
            if ((0, io_1.wantsJson)(args.options))
                (0, io_1.printJson)(rows);
            else
                process.stdout.write(`${(0, multi_agent_operator_ux_1.formatMultiAgentFailures)(rows)}\n`);
            return;
        }
        case "evidence": {
            const rows = runner.multiAgentEvidence((0, io_1.required)(runId, "run id"));
            if ((0, io_1.wantsJson)(args.options))
                (0, io_1.printJson)(rows);
            else
                process.stdout.write(`${(0, multi_agent_operator_ux_1.formatMultiAgentEvidence)(rows)}\n`);
            return;
        }
        case "reasoning": {
            if (args.options.refresh && !args.options.evidence && !args.options.evidenceId) {
                const index = runner.multiAgentReasoningRefresh((0, io_1.required)(runId, "run id"));
                (0, io_1.printJson)(index);
                return;
            }
            const report = runner.multiAgentReasoning((0, io_1.required)(runId, "run id"), { ...args.options, evidence: args.options.evidence || args.options.evidenceId || id });
            if ((0, io_1.wantsJson)(args.options))
                (0, io_1.printJson)(report);
            else
                process.stdout.write(`${(0, evidence_reasoning_1.formatEvidenceReasoningReport)(report)}\n`);
            return;
        }
        case "run":
            if (!runId ||
                args.options.topology ||
                args.options.topologyId ||
                args.options.app ||
                args.options.appId ||
                args.options.workflow ||
                args.options.workflowId) {
                (0, io_1.printJson)(runner.hostMultiAgentRun(runId, args.options));
                return;
            }
            if (id && !args.options.id && !args.options.status)
                (0, io_1.printJson)(runner.showMultiAgentRun((0, io_1.required)(runId, "run id"), id));
            else if (id && args.options.status)
                (0, io_1.printJson)(runner.transitionMultiAgentRun((0, io_1.required)(runId, "run id"), id, args.options));
            else
                (0, io_1.printJson)(runner.createMultiAgentRun((0, io_1.required)(runId, "run id"), args.options));
            return;
        case "show":
            (0, io_1.printJson)(runner.showMultiAgentRun((0, io_1.required)(runId, "run id"), (0, io_1.required)(id, "multi-agent run id")));
            return;
        case "role":
            if (id && !args.options.id && !args.options["multi-agent-run"] && !args.options.multiAgentRun && !args.options.multiAgentRunId) {
                (0, io_1.printJson)(runner.showAgentRole((0, io_1.required)(runId, "run id"), id));
            }
            else {
                (0, io_1.printJson)(runner.createAgentRole((0, io_1.required)(runId, "run id"), { ...args.options, id: args.options.id || id }));
            }
            return;
        case "group":
            if (id && !args.options.id && !args.options["multi-agent-run"] && !args.options.multiAgentRun && !args.options.multiAgentRunId) {
                (0, io_1.printJson)(runner.showAgentGroup((0, io_1.required)(runId, "run id"), id));
            }
            else {
                (0, io_1.printJson)(runner.createAgentGroup((0, io_1.required)(runId, "run id"), { ...args.options, id: args.options.id || id }));
            }
            return;
        case "membership":
            if (id && !args.options.id && !args.options.group && !args.options.groupId && !args.options["multi-agent-group"]) {
                (0, io_1.printJson)(runner.showAgentMembership((0, io_1.required)(runId, "run id"), id));
            }
            else {
                (0, io_1.printJson)(runner.assignAgentMembership((0, io_1.required)(runId, "run id"), { ...args.options, id: args.options.id || id }));
            }
            return;
        case "fanout":
            if (id && !args.options.id && !args.options.group && !args.options.groupId && !args.options["multi-agent-group"]) {
                (0, io_1.printJson)(runner.showAgentFanout((0, io_1.required)(runId, "run id"), id));
            }
            else {
                (0, io_1.printJson)(runner.createAgentFanout((0, io_1.required)(runId, "run id"), { ...args.options, id: args.options.id || id }));
            }
            return;
        case "fanin":
            if (id && !args.options.id && !args.options.group && !args.options.groupId && !args.options["multi-agent-group"] && !args.options.fanout) {
                (0, io_1.printJson)(runner.showAgentFanin((0, io_1.required)(runId, "run id"), id));
            }
            else {
                (0, io_1.printJson)(runner.collectAgentFanin((0, io_1.required)(runId, "run id"), { ...args.options, id: args.options.id || id }));
            }
            return;
        default:
            throw new Error("Usage: cw.js multi-agent run|status|step|blackboard|score|select|summary|summarize|graph|dependencies|failures|evidence|reasoning|show|role|group|membership|fanout|fanin <run-id> [id]");
    }
}
