"use strict";
// wiring/capability-table/multi-agent.ts — MILESTONE 9 (multi-agent,
// topology, coordinator/blackboard, candidate scoring, collaboration,
// eval-replay) CLI bindings. Split out of core/capability-table.ts,
// byte-for-byte (extracted with sed, not retyped).
Object.defineProperty(exports, "__esModule", { value: true });
const registry_core_1 = require("./registry-core");
const io_1 = require("../../cli/io");
const operator_ux_text_1 = require("../../shell/operator-ux-text");
const state_explosion_text_1 = require("../../core/format/state-explosion-text");
const eval_text_1 = require("../../shell/eval-text");
// MILESTONE 9 (multi-agent, topology, coordinator/blackboard, candidate
// scoring, collaboration, eval replay) CLI bindings. Handler BODIES live
// in shell/multi-agent-cli.ts (impure — they read/write multi-agent/
// blackboard/candidate/collaboration/eval state on disk); this table
// only wires argv shape -> handler call, per cli/dispatch.ts's generic
// executor contract.
// ---------------------------------------------------------------------
const multi_agent_cli_1 = require("../../shell/multi-agent-cli");
const collaboration_io_1 = require("../../shell/collaboration-io");
const topology_io_1 = require("../../shell/topology-io");
(0, registry_core_1.attachCliBinding)("topology.list", { path: ["topology", "list"], jsonMode: "default", handler: () => ({ json: (0, multi_agent_cli_1.topologyList)() }) });
registry_core_1.REGISTRY_BY_CAPABILITY.get("topology.list").mcp.handler = () => (0, multi_agent_cli_1.topologyList)();
(0, registry_core_1.attachCliBinding)("topology.show", {
    path: ["topology", "show"],
    jsonMode: "default",
    handler: (args) => ({ json: (0, multi_agent_cli_1.topologyShowCli)((0, io_1.required)(args.positionals[0], "topology id")) }),
});
registry_core_1.REGISTRY_BY_CAPABILITY.get("topology.show").mcp.handler = (args) => (0, multi_agent_cli_1.topologyShowCli)((0, io_1.required)((0, io_1.optionalArg)(args.topologyId ?? args.id), "topology id"));
(0, registry_core_1.attachCliBinding)("topology.validate", {
    path: ["topology", "validate"],
    jsonMode: "default",
    handler: (args) => {
        const result = (0, multi_agent_cli_1.topologyValidateCli)((0, io_1.required)(args.positionals[0], "topology id"));
        return { json: result, exitCode: result.valid ? undefined : 1 };
    },
});
registry_core_1.REGISTRY_BY_CAPABILITY.get("topology.validate").mcp.handler = (args) => (0, multi_agent_cli_1.topologyValidateCli)((0, io_1.required)((0, io_1.optionalArg)(args.topologyId ?? args.id), "topology id"));
(0, registry_core_1.attachCliBinding)("topology.apply", {
    path: ["topology", "apply"],
    jsonMode: "default",
    handler: (args) => ({
        json: (0, multi_agent_cli_1.topologyApplyCli)({ ...args.options, runId: (0, io_1.required)(args.positionals[0], "run id"), topologyId: (0, io_1.required)(args.positionals[1], "topology id") }),
    }),
});
registry_core_1.REGISTRY_BY_CAPABILITY.get("topology.apply").mcp.handler = (args) => (0, multi_agent_cli_1.topologyApplyCli)({ ...args, topologyId: args.topologyId ?? args.id });
// jsonMode "flag": human `Topologies` panel by default, canonical JSON
// under --json (old build's topology.summary was flag).
(0, registry_core_1.attachCliBinding)("topology.summary", {
    path: ["topology", "summary"],
    jsonMode: "flag",
    handler: (args) => {
        const summary = (0, multi_agent_cli_1.topologySummaryCli)({ runId: (0, io_1.required)(args.positionals[0], "run id"), ...args.options });
        return { json: summary, text: `${(0, topology_io_1.formatTopologySummaryText)(summary)}\n` };
    },
});
registry_core_1.REGISTRY_BY_CAPABILITY.get("topology.summary").mcp.handler = (args) => (0, multi_agent_cli_1.topologySummaryCli)(args);
// jsonMode "flag": human `Run Graph:` render by default, canonical JSON
// under --json (old build's topology.graph was flag).
(0, registry_core_1.attachCliBinding)("topology.graph", {
    path: ["topology", "graph"],
    jsonMode: "flag",
    handler: (args) => {
        const runId = (0, io_1.required)(args.positionals[0], "run id");
        const graph = (0, multi_agent_cli_1.topologyGraphCli)({ runId, ...args.options });
        return { json: graph, text: `${(0, topology_io_1.formatTopologyGraphText)(runId, graph)}\n` };
    },
});
registry_core_1.REGISTRY_BY_CAPABILITY.get("topology.graph").mcp.handler = (args) => (0, multi_agent_cli_1.topologyGraphCli)(args);
// ---- multi-agent kernel + host -----------------------------------------
(0, registry_core_1.attachCliBinding)("multi-agent.run", {
    path: ["multi-agent", "run"],
    jsonMode: "default",
    // positionals[1] is the MultiAgentRun entity id for the transition/show
    // arms (`cw multi-agent run <run> <id> --status …`); it must NOT collide
    // with the create arm's `--id`, so it is forwarded as `multiAgentRunId`
    // only when no `--id` create flag was passed (old handler took `id` from
    // the 3rd positional token).
    handler: (args) => ({
        json: (0, multi_agent_cli_1.multiAgentRunCli)({
            ...args.options,
            runId: (0, io_1.required)(args.positionals[0], "run id"),
            multiAgentRunId: args.options.id === undefined ? (args.positionals[1] ?? args.options.multiAgentRunId) : args.options.multiAgentRunId,
        }),
    }),
});
registry_core_1.REGISTRY_BY_CAPABILITY.get("multi-agent.run").mcp.handler = (args) => (0, multi_agent_cli_1.multiAgentRunCli)(args);
(0, registry_core_1.attachCliBinding)("multi-agent.status", {
    path: ["multi-agent", "status"],
    jsonMode: "flag",
    handler: (args) => ({
        json: (0, multi_agent_cli_1.multiAgentStatusCli)({ runId: (0, io_1.required)(args.positionals[0], "run id"), ...args.options }),
        text: (0, multi_agent_cli_1.multiAgentStatusText)({ runId: (0, io_1.required)(args.positionals[0], "run id"), ...args.options }),
    }),
});
registry_core_1.REGISTRY_BY_CAPABILITY.get("multi-agent.status").mcp.handler = (args) => (0, multi_agent_cli_1.multiAgentStatusCli)(args);
(0, registry_core_1.attachCliBinding)("multi-agent.step", {
    path: ["multi-agent", "step"],
    jsonMode: "default",
    handler: (args) => ({ json: (0, multi_agent_cli_1.multiAgentStepCli)({ ...args.options, runId: (0, io_1.required)(args.positionals[0], "run id") }) }),
});
registry_core_1.REGISTRY_BY_CAPABILITY.get("multi-agent.step").mcp.handler = (args) => (0, multi_agent_cli_1.multiAgentStepCli)(args);
(0, registry_core_1.attachCliBinding)("multi-agent.blackboard", {
    path: ["multi-agent", "blackboard"],
    jsonMode: "default",
    handler: (args) => ({ json: (0, multi_agent_cli_1.multiAgentBlackboardCli)({ ...args.options, runId: (0, io_1.required)(args.positionals[0], "run id") }, args.positionals[1]) }),
});
registry_core_1.REGISTRY_BY_CAPABILITY.get("multi-agent.blackboard").mcp.handler = (args) => (0, multi_agent_cli_1.multiAgentBlackboardCli)(args, args.action);
(0, registry_core_1.attachCliBinding)("multi-agent.score", {
    path: ["multi-agent", "score"],
    jsonMode: "default",
    handler: (args) => ({ json: (0, multi_agent_cli_1.multiAgentScoreCli)({ ...args.options, runId: (0, io_1.required)(args.positionals[0], "run id"), candidate: args.options.candidate ?? args.positionals[1] }) }),
});
registry_core_1.REGISTRY_BY_CAPABILITY.get("multi-agent.score").mcp.handler = (args) => (0, multi_agent_cli_1.multiAgentScoreCli)(args);
(0, registry_core_1.attachCliBinding)("multi-agent.select", {
    path: ["multi-agent", "select"],
    jsonMode: "default",
    handler: (args) => ({ json: (0, multi_agent_cli_1.multiAgentSelectCli)({ ...args.options, runId: (0, io_1.required)(args.positionals[0], "run id"), candidate: args.options.candidate ?? args.positionals[1] }) }),
});
registry_core_1.REGISTRY_BY_CAPABILITY.get("multi-agent.select").mcp.handler = (args) => (0, multi_agent_cli_1.multiAgentSelectCli)(args);
// jsonMode "flag": human `Multi-Agent` panel by default, canonical JSON
// under --json (old build's multi-agent.summary was flag).
(0, registry_core_1.attachCliBinding)("multi-agent.summary", {
    path: ["multi-agent", "summary"],
    jsonMode: "flag",
    handler: (args) => {
        const summary = (0, multi_agent_cli_1.multiAgentSummaryCli)({ runId: (0, io_1.required)(args.positionals[0], "run id"), ...args.options });
        return { json: summary, text: `${(0, operator_ux_text_1.formatMultiAgentSummaryText)(summary)}\n` };
    },
});
registry_core_1.REGISTRY_BY_CAPABILITY.get("multi-agent.summary").mcp.handler = (args) => (0, multi_agent_cli_1.multiAgentSummaryCli)(args);
// `cw multi-agent graph <run>` is one dispatch path served by two capability
// rows (multi-agent.graph — the operator graph — and multi-agent.graph.compact
// — the state-explosion view under --view/--focus/--depth), exactly like
// blackboard.message.post/list. One shared handler answers both; the
// second row exists so both capabilities carry a cli binding (the
// both-surface pairing) and `cw help multi-agent` can list both forms.
function multiAgentGraphHandler(args) {
    const call = { runId: (0, io_1.required)(args.positionals[0], "run id"), ...args.options };
    if (args.options.view !== undefined || args.options.focus !== undefined || args.options.depth !== undefined) {
        const compact = (0, multi_agent_cli_1.multiAgentGraphCompactCli)(call);
        return { json: compact, text: (0, state_explosion_text_1.formatCompactGraph)(compact) };
    }
    return { json: (0, multi_agent_cli_1.multiAgentGraphCli)(call), text: (0, multi_agent_cli_1.multiAgentGraphText)(call) };
}
(0, registry_core_1.attachCliBinding)("multi-agent.graph", { path: ["multi-agent", "graph"], helpPath: ["multi-agent", "graph"], jsonMode: "flag", handler: multiAgentGraphHandler });
(0, registry_core_1.attachCliBinding)("multi-agent.graph.compact", { path: ["multi-agent", "graph"], helpPath: ["multi-agent", "graph"], jsonMode: "flag", handler: multiAgentGraphHandler });
registry_core_1.REGISTRY_BY_CAPABILITY.get("multi-agent.graph").mcp.handler = (args) => (0, multi_agent_cli_1.multiAgentGraphCli)(args);
// GAP: `cw multi-agent dependencies|failures|evidence` — the MCP tool rows
// (cw_multi_agent_dependencies/failures/evidence) were declared but had no
// CLI path binding and their mcp.handler was still notYetImplemented. Wire
// both surfaces to the same operator-ux derivation the CLI text render uses
// (port of the old handler's dependencies/failures/evidence arms).
(0, registry_core_1.attachCliBinding)("multi-agent.dependencies", {
    path: ["multi-agent", "dependencies"],
    jsonMode: "flag",
    handler: (args) => ({
        json: (0, multi_agent_cli_1.multiAgentDependenciesCli)({ runId: (0, io_1.required)(args.positionals[0], "run id"), ...args.options }),
        text: (0, multi_agent_cli_1.multiAgentDependenciesText)({ runId: (0, io_1.required)(args.positionals[0], "run id"), ...args.options }),
    }),
});
registry_core_1.REGISTRY_BY_CAPABILITY.get("multi-agent.dependencies").mcp.handler = (args) => (0, multi_agent_cli_1.multiAgentDependenciesCli)(args);
(0, registry_core_1.attachCliBinding)("multi-agent.failures", {
    path: ["multi-agent", "failures"],
    jsonMode: "flag",
    handler: (args) => ({
        json: (0, multi_agent_cli_1.multiAgentFailuresCli)({ runId: (0, io_1.required)(args.positionals[0], "run id"), ...args.options }),
        text: (0, multi_agent_cli_1.multiAgentFailuresText)({ runId: (0, io_1.required)(args.positionals[0], "run id"), ...args.options }),
    }),
});
registry_core_1.REGISTRY_BY_CAPABILITY.get("multi-agent.failures").mcp.handler = (args) => (0, multi_agent_cli_1.multiAgentFailuresCli)(args);
(0, registry_core_1.attachCliBinding)("multi-agent.evidence", {
    path: ["multi-agent", "evidence"],
    jsonMode: "flag",
    handler: (args) => ({
        json: (0, multi_agent_cli_1.multiAgentEvidenceCli)({ runId: (0, io_1.required)(args.positionals[0], "run id"), ...args.options }),
        text: (0, multi_agent_cli_1.multiAgentEvidenceText)({ runId: (0, io_1.required)(args.positionals[0], "run id"), ...args.options }),
    }),
});
registry_core_1.REGISTRY_BY_CAPABILITY.get("multi-agent.evidence").mcp.handler = (args) => (0, multi_agent_cli_1.multiAgentEvidenceCli)(args);
// GAP: `cw multi-agent reasoning <run> [--refresh|--evidence <id>]` — the
// evidence-adoption reasoning chain (cw_evidence_reasoning /
// cw_evidence_reasoning_refresh MCP tools were declared but notYetImplemented,
// and no CLI verb was bound). `--refresh` prints the durable index (JSON only,
// matching the old handler's printJson refresh arm); otherwise it prints the
// report (text, or JSON under --json).
function multiAgentReasoningHandler(args) {
    const call = { runId: (0, io_1.required)(args.positionals[0], "run id"), ...args.options };
    if (args.options.refresh && args.options.evidence === undefined && args.options.evidenceId === undefined) {
        return { json: (0, multi_agent_cli_1.multiAgentReasoningRefreshCli)(call) };
    }
    return { json: (0, multi_agent_cli_1.multiAgentReasoningCli)(call), text: (0, multi_agent_cli_1.multiAgentReasoningText)(call) };
}
(0, registry_core_1.attachCliBinding)("multi-agent.reasoning", { path: ["multi-agent", "reasoning"], helpPath: ["multi-agent", "reasoning"], jsonMode: "flag", handler: multiAgentReasoningHandler });
// `multi-agent.reasoning.refresh` (the durable evidence-adoption index) shares
// the ["multi-agent","reasoning"] dispatch path — `cw multi-agent reasoning
// <run> --refresh` is served by the reasoning binding above (first row wins).
// This row exists so the refresh capability also carries a cli binding (the
// both-surface pairing) and `cw help multi-agent` lists it. Same handler.
(0, registry_core_1.attachCliBinding)("multi-agent.reasoning.refresh", { path: ["multi-agent", "reasoning"], helpPath: ["multi-agent", "reasoning"], jsonMode: "default", handler: multiAgentReasoningHandler });
registry_core_1.REGISTRY_BY_CAPABILITY.get("multi-agent.reasoning").mcp.handler = (args) => (0, multi_agent_cli_1.multiAgentReasoningCli)(args);
registry_core_1.REGISTRY_BY_CAPABILITY.get("multi-agent.reasoning.refresh").mcp.handler = (args) => (0, multi_agent_cli_1.multiAgentReasoningRefreshCli)(args);
// GAP: the state-explosion / contract read views (cw_multi_agent_summarize /
// cw_blackboard_summarize / cw_multi_agent_graph_compact / cw_contract_show)
// were declared MCP tools left on notYetImplemented, and their CLI verbs were
// unbound. Wire both surfaces to the ported read fns.
(0, registry_core_1.attachCliBinding)("multi-agent.summarize", {
    path: ["multi-agent", "summarize"],
    jsonMode: "flag",
    handler: (args) => {
        const result = (0, multi_agent_cli_1.multiAgentSummarizeCli)({ runId: (0, io_1.required)(args.positionals[0], "run id"), ...args.options });
        return { json: result, text: (0, state_explosion_text_1.formatStateExplosionReport)(result) };
    },
});
registry_core_1.REGISTRY_BY_CAPABILITY.get("multi-agent.summarize").mcp.handler = (args) => (0, multi_agent_cli_1.multiAgentSummarizeCli)(args);
registry_core_1.REGISTRY_BY_CAPABILITY.get("multi-agent.graph.compact").mcp.handler = (args) => (0, multi_agent_cli_1.multiAgentGraphCompactCli)(args);
(0, registry_core_1.attachCliBinding)("blackboard.summarize", {
    path: ["blackboard", "summarize"],
    jsonMode: "flag",
    handler: (args) => ({ json: (0, multi_agent_cli_1.blackboardSummarizeCli)({ runId: (0, io_1.required)(args.positionals[0], "run id"), ...args.options }) }),
});
registry_core_1.REGISTRY_BY_CAPABILITY.get("blackboard.summarize").mcp.handler = (args) => (0, multi_agent_cli_1.blackboardSummarizeCli)(args);
(0, registry_core_1.attachCliBinding)("contract.show", {
    path: ["contract", "show"],
    jsonMode: "default",
    handler: (args) => ({ json: (0, multi_agent_cli_1.contractShowCli)({ runId: (0, io_1.required)(args.positionals[0], "run id"), ...args.options }, args.positionals[1]) }),
});
registry_core_1.REGISTRY_BY_CAPABILITY.get("contract.show").mcp.handler = (args) => (0, multi_agent_cli_1.contractShowCli)(args);
(0, registry_core_1.attachCliBinding)("multi-agent.run.create", {
    path: ["multi-agent", "role"],
    helpPath: ["multi-agent", "role"],
    jsonMode: "default",
    handler: (args) => ({
        json: (0, multi_agent_cli_1.multiAgentRoleCli)({
            ...args.options,
            runId: (0, io_1.required)(args.positionals[0], "run id"),
            roleId: args.options.id === undefined && args.positionals.length >= 2 ? args.positionals[1] : args.options.roleId,
        }),
    }),
});
(0, registry_core_1.attachCliBinding)("multi-agent.group.create", {
    path: ["multi-agent", "group"],
    helpPath: ["multi-agent", "group"],
    jsonMode: "default",
    handler: (args) => ({
        json: (0, multi_agent_cli_1.multiAgentGroupCli)({
            ...args.options,
            runId: (0, io_1.required)(args.positionals[0], "run id"),
            groupId: args.options.id === undefined && args.positionals.length >= 2 ? args.positionals[1] : args.options.groupId,
        }),
    }),
});
(0, registry_core_1.attachCliBinding)("multi-agent.membership.create", {
    path: ["multi-agent", "membership"],
    helpPath: ["multi-agent", "membership"],
    jsonMode: "default",
    handler: (args) => ({
        json: (0, multi_agent_cli_1.multiAgentMembershipCli)({
            ...args.options,
            runId: (0, io_1.required)(args.positionals[0], "run id"),
            membershipId: args.options.id === undefined && args.positionals.length >= 2 ? args.positionals[1] : args.options.membershipId,
        }),
    }),
});
(0, registry_core_1.attachCliBinding)("multi-agent.fanout.create", {
    path: ["multi-agent", "fanout"],
    helpPath: ["multi-agent", "fanout"],
    jsonMode: "default",
    handler: (args) => ({
        json: (0, multi_agent_cli_1.multiAgentFanoutCli)({
            ...args.options,
            runId: (0, io_1.required)(args.positionals[0], "run id"),
            fanoutId: args.options.id === undefined && args.positionals.length >= 2 ? args.positionals[1] : args.options.fanoutId,
        }),
    }),
});
(0, registry_core_1.attachCliBinding)("multi-agent.fanin.collect", {
    path: ["multi-agent", "fanin"],
    helpPath: ["multi-agent", "fanin"],
    jsonMode: "default",
    handler: (args) => ({
        json: (0, multi_agent_cli_1.multiAgentFaninCli)({
            ...args.options,
            runId: (0, io_1.required)(args.positionals[0], "run id"),
            faninId: args.options.id === undefined && args.positionals.length >= 2 ? args.positionals[1] : args.options.faninId,
        }),
    }),
});
registry_core_1.REGISTRY_BY_CAPABILITY.get("multi-agent.run.create").mcp.handler = (args) => (0, multi_agent_cli_1.multiAgentRoleCli)(args);
registry_core_1.REGISTRY_BY_CAPABILITY.get("multi-agent.role.create").mcp.handler = (args) => (0, multi_agent_cli_1.multiAgentRoleCli)(args);
registry_core_1.REGISTRY_BY_CAPABILITY.get("multi-agent.group.create").mcp.handler = (args) => (0, multi_agent_cli_1.multiAgentGroupCli)(args);
registry_core_1.REGISTRY_BY_CAPABILITY.get("multi-agent.membership.create").mcp.handler = (args) => (0, multi_agent_cli_1.multiAgentMembershipCli)(args);
registry_core_1.REGISTRY_BY_CAPABILITY.get("multi-agent.fanout.create").mcp.handler = (args) => (0, multi_agent_cli_1.multiAgentFanoutCli)(args);
registry_core_1.REGISTRY_BY_CAPABILITY.get("multi-agent.fanin.collect").mcp.handler = (args) => (0, multi_agent_cli_1.multiAgentFaninCli)(args);
// GAP: the *.show MCP tools were declared but left notYetImplemented. Route
// each to its create CLI fn's read arm (id-only args return the record).
registry_core_1.REGISTRY_BY_CAPABILITY.get("multi-agent.role.show").mcp.handler = (args) => (0, multi_agent_cli_1.multiAgentRoleCli)({ ...args, roleId: args.roleId ?? args.id });
registry_core_1.REGISTRY_BY_CAPABILITY.get("multi-agent.group.show").mcp.handler = (args) => (0, multi_agent_cli_1.multiAgentGroupCli)({ ...args, groupId: args.groupId ?? args.id });
registry_core_1.REGISTRY_BY_CAPABILITY.get("multi-agent.membership.show").mcp.handler = (args) => (0, multi_agent_cli_1.multiAgentMembershipCli)({ ...args, membershipId: args.membershipId ?? args.id });
registry_core_1.REGISTRY_BY_CAPABILITY.get("multi-agent.fanout.show").mcp.handler = (args) => (0, multi_agent_cli_1.multiAgentFanoutCli)({ ...args, fanoutId: args.fanoutId ?? args.id });
registry_core_1.REGISTRY_BY_CAPABILITY.get("multi-agent.fanin.show").mcp.handler = (args) => (0, multi_agent_cli_1.multiAgentFaninCli)({ ...args, faninId: args.faninId ?? args.id });
// The create/show pairs for role/group/membership/fanout/fanin each SHARE
// one dispatch path (["multi-agent","role"] etc.); `cw multi-agent role
// <run> [id]` is served by the create binding declared above (first row
// wins findCapabilityByCliPath), and an id-only invocation returns the
// existing record (the read arm). These extra rows exist so each show
// capability — and multi-agent.role.create, distinct from the
// multi-agent.run.create binding that already owns the ["multi-agent",
// "role"] path — also carries a cli binding (the both-surface pairing),
// exactly like blackboard.message.post/list. Same handler, same shell fn.
function multiAgentRoleHandler(args) {
    return {
        json: (0, multi_agent_cli_1.multiAgentRoleCli)({
            ...args.options,
            runId: (0, io_1.required)(args.positionals[0], "run id"),
            roleId: args.options.id === undefined && args.positionals.length >= 2 ? args.positionals[1] : args.options.roleId,
        }),
    };
}
(0, registry_core_1.attachCliBinding)("multi-agent.role.create", { path: ["multi-agent", "role"], helpPath: ["multi-agent", "role"], jsonMode: "default", handler: multiAgentRoleHandler });
(0, registry_core_1.attachCliBinding)("multi-agent.role.show", { path: ["multi-agent", "role"], helpPath: ["multi-agent", "role"], jsonMode: "default", handler: multiAgentRoleHandler });
(0, registry_core_1.attachCliBinding)("multi-agent.group.show", {
    path: ["multi-agent", "group"],
    helpPath: ["multi-agent", "group"],
    jsonMode: "default",
    handler: (args) => ({ json: (0, multi_agent_cli_1.multiAgentGroupCli)({ ...args.options, runId: (0, io_1.required)(args.positionals[0], "run id"), groupId: args.options.id === undefined && args.positionals.length >= 2 ? args.positionals[1] : args.options.groupId }) }),
});
(0, registry_core_1.attachCliBinding)("multi-agent.membership.show", {
    path: ["multi-agent", "membership"],
    helpPath: ["multi-agent", "membership"],
    jsonMode: "default",
    handler: (args) => ({ json: (0, multi_agent_cli_1.multiAgentMembershipCli)({ ...args.options, runId: (0, io_1.required)(args.positionals[0], "run id"), membershipId: args.options.id === undefined && args.positionals.length >= 2 ? args.positionals[1] : args.options.membershipId }) }),
});
(0, registry_core_1.attachCliBinding)("multi-agent.fanout.show", {
    path: ["multi-agent", "fanout"],
    helpPath: ["multi-agent", "fanout"],
    jsonMode: "default",
    handler: (args) => ({ json: (0, multi_agent_cli_1.multiAgentFanoutCli)({ ...args.options, runId: (0, io_1.required)(args.positionals[0], "run id"), fanoutId: args.options.id === undefined && args.positionals.length >= 2 ? args.positionals[1] : args.options.fanoutId }) }),
});
(0, registry_core_1.attachCliBinding)("multi-agent.fanin.show", {
    path: ["multi-agent", "fanin"],
    helpPath: ["multi-agent", "fanin"],
    jsonMode: "default",
    handler: (args) => ({ json: (0, multi_agent_cli_1.multiAgentFaninCli)({ ...args.options, runId: (0, io_1.required)(args.positionals[0], "run id"), faninId: args.options.id === undefined && args.positionals.length >= 2 ? args.positionals[1] : args.options.faninId }) }),
});
(0, registry_core_1.attachCliBinding)("multi-agent.run.transition", {
    path: ["multi-agent", "transition"],
    jsonMode: "default",
    handler: (args) => ({ json: (0, multi_agent_cli_1.multiAgentRunCli)({ ...args.options, runId: (0, io_1.required)(args.positionals[0], "run id") }) }),
});
registry_core_1.REGISTRY_BY_CAPABILITY.get("multi-agent.run.transition").mcp.handler = (args) => (0, multi_agent_cli_1.multiAgentRunCli)(args);
(0, registry_core_1.attachCliBinding)("multi-agent.run.show", {
    path: ["multi-agent", "show"],
    jsonMode: "default",
    handler: (args) => ({ json: (0, multi_agent_cli_1.multiAgentShowCli)({ runId: (0, io_1.required)(args.positionals[0], "run id"), ...args.options }, (0, io_1.required)(args.positionals[1], "id")) }),
});
registry_core_1.REGISTRY_BY_CAPABILITY.get("multi-agent.run.show").mcp.handler = (args) => (0, multi_agent_cli_1.multiAgentShowCli)(args, (0, io_1.required)((0, io_1.optionalArg)(args.multiAgentRunId ?? args.id), "id"));
// ---- blackboard / coordinator -------------------------------------------
(0, registry_core_1.attachCliBinding)("blackboard.summary", {
    path: ["blackboard", "summary"],
    jsonMode: "default",
    handler: (args) => ({ json: (0, multi_agent_cli_1.blackboardSummaryCli)({ runId: (0, io_1.required)(args.positionals[0], "run id"), ...args.options }) }),
});
registry_core_1.REGISTRY_BY_CAPABILITY.get("blackboard.summary").mcp.handler = (args) => (0, multi_agent_cli_1.blackboardSummaryCli)(args);
(0, registry_core_1.attachCliBinding)("blackboard.graph", {
    path: ["blackboard", "graph"],
    jsonMode: "default",
    handler: (args) => ({ json: (0, multi_agent_cli_1.blackboardGraphCli)({ runId: (0, io_1.required)(args.positionals[0], "run id"), ...args.options }) }),
});
registry_core_1.REGISTRY_BY_CAPABILITY.get("blackboard.graph").mcp.handler = (args) => (0, multi_agent_cli_1.blackboardGraphCli)(args);
(0, registry_core_1.attachCliBinding)("blackboard.resolve", {
    path: ["blackboard", "resolve"],
    jsonMode: "default",
    handler: (args) => ({ json: (0, multi_agent_cli_1.blackboardResolveCli)({ ...args.options, runId: (0, io_1.required)(args.positionals[0], "run id") }) }),
});
registry_core_1.REGISTRY_BY_CAPABILITY.get("blackboard.resolve").mcp.handler = (args) => (0, multi_agent_cli_1.blackboardResolveCli)(args);
// GAP: the blackboard write/read verbs accept the sub-verb's ACTION word
// ("create"/"post"/"put"/"add"/"list") in EITHER of two slots around the run
// id, per the smokes' varied spellings:
//   blackboard topic <run>                  (create, run first)
//   blackboard topic create <run>           (create action FIRST)
//   blackboard message <run>                (post, run first)
//   blackboard message <run> list           (list action AFTER run)
//   blackboard message list <run>           (list action FIRST)
//   blackboard message post <run>           (post action FIRST)
// dispatchTable already consumed the sub-verb ("topic"/"message"/…), so the
// handler's positionals begin at the token AFTER it. `blackboardRunAndAction`
// strips a leading action word (if present) so the run id is found wherever it
// sits, and reports the effective action word for the post/list split.
const BLACKBOARD_ACTION_WORDS = new Set(["create", "post", "put", "add", "list", "show"]);
function blackboardRunAndAction(args) {
    const [first, second] = args.positionals;
    if (first !== undefined && BLACKBOARD_ACTION_WORDS.has(first)) {
        return { runId: (0, io_1.required)(second, "run id"), action: first };
    }
    return { runId: (0, io_1.required)(first, "run id"), action: second };
}
(0, registry_core_1.attachCliBinding)("blackboard.topic.create", {
    path: ["blackboard", "topic"],
    helpPath: ["blackboard", "topic", "create"],
    jsonMode: "default",
    handler: (args) => ({ json: (0, multi_agent_cli_1.blackboardTopicCreateCli)({ ...args.options, runId: blackboardRunAndAction(args).runId }) }),
});
registry_core_1.REGISTRY_BY_CAPABILITY.get("blackboard.topic.create").mcp.handler = (args) => (0, multi_agent_cli_1.blackboardTopicCreateCli)(args);
function blackboardMessageHandler(args) {
    const { runId, action } = blackboardRunAndAction(args);
    if (action === "list")
        return { json: (0, multi_agent_cli_1.blackboardMessageListCli)({ ...args.options, runId }) };
    return { json: (0, multi_agent_cli_1.blackboardMessagePostCli)({ ...args.options, runId }) };
}
(0, registry_core_1.attachCliBinding)("blackboard.message.post", { path: ["blackboard", "message"], helpPath: ["blackboard", "message", "post"], jsonMode: "default", handler: blackboardMessageHandler });
(0, registry_core_1.attachCliBinding)("blackboard.message.list", { path: ["blackboard", "message"], helpPath: ["blackboard", "message", "list"], jsonMode: "default", handler: blackboardMessageHandler });
registry_core_1.REGISTRY_BY_CAPABILITY.get("blackboard.message.post").mcp.handler = (args) => (0, multi_agent_cli_1.blackboardMessagePostCli)(args);
registry_core_1.REGISTRY_BY_CAPABILITY.get("blackboard.message.list").mcp.handler = (args) => (0, multi_agent_cli_1.blackboardMessageListCli)(args);
(0, registry_core_1.attachCliBinding)("blackboard.context.put", {
    path: ["blackboard", "context"],
    helpPath: ["blackboard", "context", "put"],
    jsonMode: "default",
    handler: (args) => ({ json: (0, multi_agent_cli_1.blackboardContextPutCli)({ ...args.options, runId: blackboardRunAndAction(args).runId }) }),
});
registry_core_1.REGISTRY_BY_CAPABILITY.get("blackboard.context.put").mcp.handler = (args) => (0, multi_agent_cli_1.blackboardContextPutCli)(args);
function blackboardArtifactHandler(args) {
    const { runId, action } = blackboardRunAndAction(args);
    if (action === "list")
        return { json: (0, multi_agent_cli_1.blackboardArtifactListCli)({ ...args.options, runId }) };
    return { json: (0, multi_agent_cli_1.blackboardArtifactAddCli)({ ...args.options, runId }) };
}
(0, registry_core_1.attachCliBinding)("blackboard.artifact.add", { path: ["blackboard", "artifact"], helpPath: ["blackboard", "artifact", "add"], jsonMode: "default", handler: blackboardArtifactHandler });
(0, registry_core_1.attachCliBinding)("blackboard.artifact.list", { path: ["blackboard", "artifact"], helpPath: ["blackboard", "artifact", "list"], jsonMode: "default", handler: blackboardArtifactHandler });
registry_core_1.REGISTRY_BY_CAPABILITY.get("blackboard.artifact.add").mcp.handler = (args) => (0, multi_agent_cli_1.blackboardArtifactAddCli)(args);
registry_core_1.REGISTRY_BY_CAPABILITY.get("blackboard.artifact.list").mcp.handler = (args) => (0, multi_agent_cli_1.blackboardArtifactListCli)(args);
(0, registry_core_1.attachCliBinding)("blackboard.snapshot", {
    path: ["blackboard", "snapshot"],
    jsonMode: "default",
    handler: (args) => ({ json: (0, multi_agent_cli_1.blackboardSnapshotCli)({ ...args.options, runId: (0, io_1.required)(args.positionals[0], "run id") }) }),
});
registry_core_1.REGISTRY_BY_CAPABILITY.get("blackboard.snapshot").mcp.handler = (args) => (0, multi_agent_cli_1.blackboardSnapshotCli)(args);
(0, registry_core_1.attachCliBinding)("coordinator.summary", {
    path: ["coordinator", "summary"],
    jsonMode: "default",
    handler: (args) => ({ json: (0, multi_agent_cli_1.coordinatorSummaryCli)({ runId: (0, io_1.required)(args.positionals[0], "run id"), ...args.options }) }),
});
registry_core_1.REGISTRY_BY_CAPABILITY.get("coordinator.summary").mcp.handler = (args) => (0, multi_agent_cli_1.coordinatorSummaryCli)(args);
(0, registry_core_1.attachCliBinding)("coordinator.decision", {
    path: ["coordinator", "decision"],
    jsonMode: "default",
    handler: (args) => ({ json: (0, multi_agent_cli_1.coordinatorDecisionCli)({ ...args.options, runId: (0, io_1.required)(args.positionals[0], "run id") }) }),
});
registry_core_1.REGISTRY_BY_CAPABILITY.get("coordinator.decision").mcp.handler = (args) => (0, multi_agent_cli_1.coordinatorDecisionCli)(args);
// ---- candidate scoring ----------------------------------------------------
(0, registry_core_1.attachCliBinding)("candidate.list", {
    path: ["candidate", "list"],
    jsonMode: "default",
    handler: (args) => ({ json: (0, multi_agent_cli_1.candidateListCli)({ runId: (0, io_1.required)(args.positionals[0], "run id"), ...args.options }) }),
});
registry_core_1.REGISTRY_BY_CAPABILITY.get("candidate.list").mcp.handler = (args) => (0, multi_agent_cli_1.candidateListCli)(args);
(0, registry_core_1.attachCliBinding)("candidate.show", {
    path: ["candidate", "show"],
    jsonMode: "default",
    handler: (args) => ({ json: (0, multi_agent_cli_1.candidateShowCli)({ runId: (0, io_1.required)(args.positionals[0], "run id"), ...args.options }, (0, io_1.required)(args.positionals[1], "candidate id")) }),
});
registry_core_1.REGISTRY_BY_CAPABILITY.get("candidate.show").mcp.handler = (args) => (0, multi_agent_cli_1.candidateShowCli)(args, (0, io_1.required)((0, io_1.optionalArg)(args.candidateId), "candidate id"));
(0, registry_core_1.attachCliBinding)("candidate.register", {
    path: ["candidate", "register"],
    jsonMode: "default",
    handler: (args) => ({ json: (0, multi_agent_cli_1.candidateRegisterCli)({ ...args.options, runId: (0, io_1.required)(args.positionals[0], "run id") }) }),
});
registry_core_1.REGISTRY_BY_CAPABILITY.get("candidate.register").mcp.handler = (args) => (0, multi_agent_cli_1.candidateRegisterCli)(args);
(0, registry_core_1.attachCliBinding)("candidate.score", {
    path: ["candidate", "score"],
    jsonMode: "default",
    handler: (args) => ({ json: (0, multi_agent_cli_1.candidateScoreCli)({ ...args.options, runId: (0, io_1.required)(args.positionals[0], "run id") }, (0, io_1.required)(args.positionals[1], "candidate id")) }),
});
registry_core_1.REGISTRY_BY_CAPABILITY.get("candidate.score").mcp.handler = (args) => (0, multi_agent_cli_1.candidateScoreCli)(args, (0, io_1.required)((0, io_1.optionalArg)(args.candidateId), "candidate id"));
(0, registry_core_1.attachCliBinding)("candidate.rank", {
    path: ["candidate", "rank"],
    jsonMode: "default",
    handler: (args) => ({ json: (0, multi_agent_cli_1.candidateRankCli)({ runId: (0, io_1.required)(args.positionals[0], "run id"), ...args.options }) }),
});
registry_core_1.REGISTRY_BY_CAPABILITY.get("candidate.rank").mcp.handler = (args) => (0, multi_agent_cli_1.candidateRankCli)(args);
(0, registry_core_1.attachCliBinding)("candidate.select", {
    path: ["candidate", "select"],
    jsonMode: "default",
    handler: (args) => ({ json: (0, multi_agent_cli_1.candidateSelectCli)({ ...args.options, runId: (0, io_1.required)(args.positionals[0], "run id") }, (0, io_1.required)(args.positionals[1], "candidate id")) }),
});
registry_core_1.REGISTRY_BY_CAPABILITY.get("candidate.select").mcp.handler = (args) => (0, multi_agent_cli_1.candidateSelectCli)(args, (0, io_1.required)((0, io_1.optionalArg)(args.candidateId), "candidate id"));
(0, registry_core_1.attachCliBinding)("candidate.reject", {
    path: ["candidate", "reject"],
    jsonMode: "default",
    handler: (args) => ({ json: (0, multi_agent_cli_1.candidateRejectCli)({ ...args.options, runId: (0, io_1.required)(args.positionals[0], "run id") }, (0, io_1.required)(args.positionals[1], "candidate id")) }),
});
registry_core_1.REGISTRY_BY_CAPABILITY.get("candidate.reject").mcp.handler = (args) => (0, multi_agent_cli_1.candidateRejectCli)(args, (0, io_1.required)((0, io_1.optionalArg)(args.candidateId), "candidate id"));
// jsonMode "flag": human `Candidates` panel by default, canonical JSON under
// --json (old build's candidate.summary was flag).
(0, registry_core_1.attachCliBinding)("candidate.summary", {
    path: ["candidate", "summary"],
    jsonMode: "flag",
    handler: (args) => {
        const summary = (0, multi_agent_cli_1.candidateSummaryCli)({ runId: (0, io_1.required)(args.positionals[0], "run id"), ...args.options });
        return { json: summary, text: `${(0, operator_ux_text_1.formatCandidateSummaryText)(summary)}\n` };
    },
});
registry_core_1.REGISTRY_BY_CAPABILITY.get("candidate.summary").mcp.handler = (args) => (0, multi_agent_cli_1.candidateSummaryCli)(args);
// ---- collaboration ---------------------------------------------------------
(0, registry_core_1.attachCliBinding)("approve", {
    path: ["approve"],
    jsonMode: "default",
    handler: (args) => ({ json: (0, multi_agent_cli_1.approveCli)({ ...args.options, runId: (0, io_1.required)(args.positionals[1], "run id"), body: args.positionals[3] }, args.positionals[0], args.positionals[2]) }),
});
registry_core_1.REGISTRY_BY_CAPABILITY.get("approve").mcp.handler = (args) => (0, multi_agent_cli_1.approveCli)(args);
(0, registry_core_1.attachCliBinding)("reject", {
    path: ["reject"],
    jsonMode: "default",
    handler: (args) => ({ json: (0, multi_agent_cli_1.rejectCollabCli)({ ...args.options, runId: (0, io_1.required)(args.positionals[1], "run id") }, args.positionals[0], args.positionals[2]) }),
});
registry_core_1.REGISTRY_BY_CAPABILITY.get("reject").mcp.handler = (args) => (0, multi_agent_cli_1.rejectCollabCli)(args);
(0, registry_core_1.attachCliBinding)("comment.add", {
    path: ["comment", "add"],
    jsonMode: "default",
    handler: (args) => ({ json: (0, multi_agent_cli_1.commentAddCli)({ ...args.options, runId: (0, io_1.required)(args.positionals[1], "run id"), body: args.options.body ?? args.positionals[3] }, args.positionals[0], args.positionals[2]) }),
});
registry_core_1.REGISTRY_BY_CAPABILITY.get("comment.add").mcp.handler = (args) => (0, multi_agent_cli_1.commentAddCli)(args);
// jsonMode "flag": human comment list by default, canonical JSON under
// --json (old build's comment.list was flag).
(0, registry_core_1.attachCliBinding)("comment.list", {
    path: ["comment", "list"],
    jsonMode: "flag",
    handler: (args) => {
        const report = (0, multi_agent_cli_1.commentListCli)({ runId: (0, io_1.required)(args.positionals[0], "run id"), ...args.options });
        return { json: report, text: `${(0, collaboration_io_1.formatCommentList)(report)}\n` };
    },
});
registry_core_1.REGISTRY_BY_CAPABILITY.get("comment.list").mcp.handler = (args) => (0, multi_agent_cli_1.commentListCli)(args);
(0, registry_core_1.attachCliBinding)("handoff", {
    path: ["handoff"],
    jsonMode: "default",
    // `cw handoff <kind> <run-id> [target-id]` (byte-behavior port of the old
    // build's handleHandoff): the FIRST required() is on the target-kind
    // positional, so a bare `cw handoff` fails with "Missing target kind" — not
    // "Missing run id". The kind check must fire before the run-id read.
    handler: (args) => {
        const kind = (0, io_1.required)(args.positionals[0], "target kind");
        const runId = (0, io_1.required)(args.positionals[1], "run id");
        return { json: (0, multi_agent_cli_1.handoffCli)({ ...args.options, runId }, kind, args.positionals[2]) };
    },
});
registry_core_1.REGISTRY_BY_CAPABILITY.get("handoff").mcp.handler = (args) => (0, multi_agent_cli_1.handoffCli)(args);
// jsonMode "flag": human review-status report by default, canonical JSON
// under --json (old build's review.status was flag).
(0, registry_core_1.attachCliBinding)("review.status", {
    path: ["review", "status"],
    jsonMode: "flag",
    handler: (args) => {
        const report = (0, multi_agent_cli_1.reviewStatusCli)({ runId: (0, io_1.required)(args.positionals[0], "run id"), ...args.options });
        return { json: report, text: `${(0, collaboration_io_1.formatReviewStatus)(report)}\n` };
    },
});
registry_core_1.REGISTRY_BY_CAPABILITY.get("review.status").mcp.handler = (args) => (0, multi_agent_cli_1.reviewStatusCli)(args);
(0, registry_core_1.attachCliBinding)("review.policy", {
    path: ["review", "policy"],
    jsonMode: "default",
    handler: (args) => ({ json: (0, multi_agent_cli_1.reviewPolicyCli)({ ...args.options, runId: (0, io_1.required)(args.positionals[0], "run id") }) }),
});
registry_core_1.REGISTRY_BY_CAPABILITY.get("review.policy").mcp.handler = (args) => (0, multi_agent_cli_1.reviewPolicyCli)(args);
// ---- eval replay harness ---------------------------------------------------
// eval snapshot|replay|compare|score|gate|report — `jsonMode: flag` so a bare
// call renders the human eval report (formatMultiAgentEval) and `--json`
// prints the result object, matching the old build's eval handler.
(0, registry_core_1.attachCliBinding)("eval.snapshot", {
    path: ["eval", "snapshot"],
    jsonMode: "flag",
    handler: (args) => {
        const result = (0, multi_agent_cli_1.evalSnapshotCli)({ runId: (0, io_1.required)(args.positionals[0], "run id"), ...args.options });
        return { json: result, text: (0, eval_text_1.formatMultiAgentEval)(result) };
    },
});
registry_core_1.REGISTRY_BY_CAPABILITY.get("eval.snapshot").mcp.handler = (args) => (0, multi_agent_cli_1.evalSnapshotCli)(args);
(0, registry_core_1.attachCliBinding)("eval.replay", {
    path: ["eval", "replay"],
    jsonMode: "flag",
    handler: (args) => {
        const result = (0, multi_agent_cli_1.evalReplayCli)({ snapshot: args.positionals[0], ...args.options });
        return { json: result, text: (0, eval_text_1.formatMultiAgentEval)(result) };
    },
});
registry_core_1.REGISTRY_BY_CAPABILITY.get("eval.replay").mcp.handler = (args) => (0, multi_agent_cli_1.evalReplayCli)(args);
(0, registry_core_1.attachCliBinding)("eval.compare", {
    path: ["eval", "compare"],
    jsonMode: "flag",
    handler: (args) => {
        const result = (0, multi_agent_cli_1.evalCompareCli)({ baseline: args.positionals[0], replay: args.positionals[1], ...args.options });
        return { json: result, text: (0, eval_text_1.formatMultiAgentEval)(result) };
    },
});
registry_core_1.REGISTRY_BY_CAPABILITY.get("eval.compare").mcp.handler = (args) => (0, multi_agent_cli_1.evalCompareCli)(args);
(0, registry_core_1.attachCliBinding)("eval.score", {
    path: ["eval", "score"],
    jsonMode: "flag",
    handler: (args) => {
        const result = (0, multi_agent_cli_1.evalScoreCli)({ replay: args.positionals[0], ...args.options });
        return { json: result, text: (0, eval_text_1.formatMultiAgentEval)(result) };
    },
});
registry_core_1.REGISTRY_BY_CAPABILITY.get("eval.score").mcp.handler = (args) => (0, multi_agent_cli_1.evalScoreCli)(args);
(0, registry_core_1.attachCliBinding)("eval.gate", {
    path: ["eval", "gate"],
    jsonMode: "flag",
    handler: (args) => {
        const gate = (0, multi_agent_cli_1.evalGateCli)({ suite: args.positionals[0], ...args.options });
        return { json: gate, text: (0, eval_text_1.formatMultiAgentEval)(gate), exitCode: gate.verdict === "ship" ? undefined : 1 };
    },
});
registry_core_1.REGISTRY_BY_CAPABILITY.get("eval.gate").mcp.handler = (args) => (0, multi_agent_cli_1.evalGateCli)(args);
(0, registry_core_1.attachCliBinding)("eval.report", {
    path: ["eval", "report"],
    jsonMode: "flag",
    handler: (args) => {
        const result = (0, multi_agent_cli_1.evalReportCli)({ replay: args.positionals[0], ...args.options });
        return { json: result, text: (0, eval_text_1.formatMultiAgentEval)(result) };
    },
});
registry_core_1.REGISTRY_BY_CAPABILITY.get("eval.report").mcp.handler = (args) => (0, multi_agent_cli_1.evalReportCli)(args);
// ---------------------------------------------------------------------
