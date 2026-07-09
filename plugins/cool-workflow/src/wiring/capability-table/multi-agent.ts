// wiring/capability-table/multi-agent.ts — MILESTONE 9 (multi-agent,
// topology, coordinator/blackboard, candidate scoring, collaboration,
// eval-replay) CLI bindings. Split out of core/capability-table.ts,
// byte-for-byte (extracted with sed, not retyped).

import { attachCliBinding, addCliOnlyCapability, REGISTRY_BY_CAPABILITY } from "./registry-core";
import { required, optionalArg } from "../../cli/io";
import type { CapabilityCliArgs, CliHandlerResult } from "../../core/capability-data";
import type { OperatorCandidateSummary, OperatorRunSummary } from "../../shell/operator-ux";
import { formatCompactGraph, formatStateExplosionReport } from "../../core/format/state-explosion-text";
// Local alias, duplicated from reporting.ts's own copy (both slices cast
// into this same narrow view of OperatorRunSummary's multiAgent field) --
// deliberately not a cross-slice import for one type-alias line.
type MultiAgentSummaryText = OperatorRunSummary["multiAgent"];

// This whole module is required unconditionally at startup for EVERY
// command (see wiring/capability-table/index.ts) — a top-level import of
// each shell module below would cost every invocation its full load, even
// though only that one capability's own handler ever calls into it.
function loadOperatorUxText(): typeof import("../../shell/operator-ux-text") {
  return require("../../shell/operator-ux-text") as typeof import("../../shell/operator-ux-text");
}
function loadEvalText(): typeof import("../../shell/eval-text") {
  return require("../../shell/eval-text") as typeof import("../../shell/eval-text");
}
function loadMultiAgentCli(): typeof import("../../shell/multi-agent-cli") {
  return require("../../shell/multi-agent-cli") as typeof import("../../shell/multi-agent-cli");
}
function loadCollaborationIo(): typeof import("../../shell/collaboration-io") {
  return require("../../shell/collaboration-io") as typeof import("../../shell/collaboration-io");
}
function loadTopologyIo(): typeof import("../../shell/topology-io") {
  return require("../../shell/topology-io") as typeof import("../../shell/topology-io");
}

// MILESTONE 9 (multi-agent, topology, coordinator/blackboard, candidate
// scoring, collaboration, eval replay) CLI bindings. Handler BODIES live
// in shell/multi-agent-cli.ts (impure — they read/write multi-agent/
// blackboard/candidate/collaboration/eval state on disk); this table
// only wires argv shape -> handler call, per cli/dispatch.ts's generic
// executor contract.
// ---------------------------------------------------------------------

import type { CommentListReport } from "../../shell/collaboration-io";
import type { ReviewStatusReport } from "../../core/multi-agent/collaboration";
import type { TopologySummary } from "../../shell/topology-io";
import type { TopologyGraph } from "../../core/multi-agent/topology";
attachCliBinding("topology.list", { path: ["topology", "list"], jsonMode: "default", handler: () => ({ json: loadMultiAgentCli().topologyList() }) });
REGISTRY_BY_CAPABILITY.get("topology.list")!.mcp!.handler = () => loadMultiAgentCli().topologyList();

attachCliBinding("topology.show", {
  path: ["topology", "show"],
  jsonMode: "default",
  handler: (args) => ({ json: loadMultiAgentCli().topologyShowCli(required(args.positionals[0], "topology id")) }),
});
REGISTRY_BY_CAPABILITY.get("topology.show")!.mcp!.handler = (args) => loadMultiAgentCli().topologyShowCli(required(optionalArg(args.topologyId ?? args.id), "topology id"));

attachCliBinding("topology.validate", {
  path: ["topology", "validate"],
  jsonMode: "default",
  handler: (args) => {
    const result = loadMultiAgentCli().topologyValidateCli(required(args.positionals[0], "topology id"));
    return { json: result, exitCode: result.valid ? undefined : 1 };
  },
});
REGISTRY_BY_CAPABILITY.get("topology.validate")!.mcp!.handler = (args) => loadMultiAgentCli().topologyValidateCli(required(optionalArg(args.topologyId ?? args.id), "topology id"));

attachCliBinding("topology.apply", {
  path: ["topology", "apply"],
  jsonMode: "default",
  handler: (args) => ({
    json: loadMultiAgentCli().topologyApplyCli({ ...args.options, runId: required(args.positionals[0], "run id"), topologyId: required(args.positionals[1], "topology id") }),
  }),
});
REGISTRY_BY_CAPABILITY.get("topology.apply")!.mcp!.handler = (args) => loadMultiAgentCli().topologyApplyCli({ ...args, topologyId: args.topologyId ?? args.id });

// jsonMode "flag": human `Topologies` panel by default, canonical JSON
// under --json (old build's topology.summary was flag).
attachCliBinding("topology.summary", {
  path: ["topology", "summary"],
  jsonMode: "flag",
  handler: (args) => {
    const summary = loadMultiAgentCli().topologySummaryCli({ runId: required(args.positionals[0], "run id"), ...args.options });
    return { json: summary, text: `${loadTopologyIo().formatTopologySummaryText(summary as TopologySummary)}\n` };
  },
});
REGISTRY_BY_CAPABILITY.get("topology.summary")!.mcp!.handler = (args) => loadMultiAgentCli().topologySummaryCli(args);

// jsonMode "flag": human `Run Graph:` render by default, canonical JSON
// under --json (old build's topology.graph was flag).
attachCliBinding("topology.graph", {
  path: ["topology", "graph"],
  jsonMode: "flag",
  handler: (args) => {
    const runId = required(args.positionals[0], "run id");
    const graph = loadMultiAgentCli().topologyGraphCli({ runId, ...args.options });
    return { json: graph, text: `${loadTopologyIo().formatTopologyGraphText(runId, graph as TopologyGraph)}\n` };
  },
});
REGISTRY_BY_CAPABILITY.get("topology.graph")!.mcp!.handler = (args) => loadMultiAgentCli().topologyGraphCli(args);

// ---- multi-agent kernel + host -----------------------------------------

attachCliBinding("multi-agent.run", {
  path: ["multi-agent", "run"],
  jsonMode: "default",
  // positionals[1] is the MultiAgentRun entity id for the transition/show
  // arms (`cw multi-agent run <run> <id> --status …`); it must NOT collide
  // with the create arm's `--id`, so it is forwarded as `multiAgentRunId`
  // only when no `--id` create flag was passed (old handler took `id` from
  // the 3rd positional token).
  handler: (args) => ({
    json: loadMultiAgentCli().multiAgentRunCli({
      ...args.options,
      runId: required(args.positionals[0], "run id"),
      multiAgentRunId: args.options.id === undefined ? (args.positionals[1] ?? args.options.multiAgentRunId) : args.options.multiAgentRunId,
    }),
  }),
});
REGISTRY_BY_CAPABILITY.get("multi-agent.run")!.mcp!.handler = (args) => loadMultiAgentCli().multiAgentRunCli(args);

attachCliBinding("multi-agent.status", {
  path: ["multi-agent", "status"],
  jsonMode: "flag",
  handler: (args) => ({
    json: loadMultiAgentCli().multiAgentStatusCli({ runId: required(args.positionals[0], "run id"), ...args.options }),
    text: loadMultiAgentCli().multiAgentStatusText({ runId: required(args.positionals[0], "run id"), ...args.options }),
  }),
});
REGISTRY_BY_CAPABILITY.get("multi-agent.status")!.mcp!.handler = (args) => loadMultiAgentCli().multiAgentStatusCli(args);

attachCliBinding("multi-agent.step", {
  path: ["multi-agent", "step"],
  jsonMode: "default",
  handler: (args) => ({ json: loadMultiAgentCli().multiAgentStepCli({ ...args.options, runId: required(args.positionals[0], "run id") }) }),
});
REGISTRY_BY_CAPABILITY.get("multi-agent.step")!.mcp!.handler = (args) => loadMultiAgentCli().multiAgentStepCli(args);

attachCliBinding("multi-agent.blackboard", {
  path: ["multi-agent", "blackboard"],
  jsonMode: "default",
  handler: (args) => ({ json: loadMultiAgentCli().multiAgentBlackboardCli({ ...args.options, runId: required(args.positionals[0], "run id") }, args.positionals[1]) }),
});
REGISTRY_BY_CAPABILITY.get("multi-agent.blackboard")!.mcp!.handler = (args) => loadMultiAgentCli().multiAgentBlackboardCli(args, args.action as string | undefined);

attachCliBinding("multi-agent.score", {
  path: ["multi-agent", "score"],
  jsonMode: "default",
  handler: (args) => ({ json: loadMultiAgentCli().multiAgentScoreCli({ ...args.options, runId: required(args.positionals[0], "run id"), candidate: args.options.candidate ?? args.positionals[1] }) }),
});
REGISTRY_BY_CAPABILITY.get("multi-agent.score")!.mcp!.handler = (args) => loadMultiAgentCli().multiAgentScoreCli(args);

attachCliBinding("multi-agent.select", {
  path: ["multi-agent", "select"],
  jsonMode: "default",
  handler: (args) => ({ json: loadMultiAgentCli().multiAgentSelectCli({ ...args.options, runId: required(args.positionals[0], "run id"), candidate: args.options.candidate ?? args.positionals[1] }) }),
});
REGISTRY_BY_CAPABILITY.get("multi-agent.select")!.mcp!.handler = (args) => loadMultiAgentCli().multiAgentSelectCli(args);

// jsonMode "flag": human `Multi-Agent` panel by default, canonical JSON
// under --json (old build's multi-agent.summary was flag).
attachCliBinding("multi-agent.summary", {
  path: ["multi-agent", "summary"],
  jsonMode: "flag",
  handler: (args) => {
    const summary = loadMultiAgentCli().multiAgentSummaryCli({ runId: required(args.positionals[0], "run id"), ...args.options });
    return { json: summary, text: `${loadOperatorUxText().formatMultiAgentSummaryText(summary as MultiAgentSummaryText)}\n` };
  },
});
REGISTRY_BY_CAPABILITY.get("multi-agent.summary")!.mcp!.handler = (args) => loadMultiAgentCli().multiAgentSummaryCli(args);

// `cw multi-agent graph <run>` is one dispatch path served by two capability
// rows (multi-agent.graph — the operator graph — and multi-agent.graph.compact
// — the state-explosion view under --view/--focus/--depth), exactly like
// blackboard.message.post/list. One shared handler answers both; the
// second row exists so both capabilities carry a cli binding (the
// both-surface pairing) and `cw help multi-agent` can list both forms.
function multiAgentGraphHandler(args: CapabilityCliArgs): CliHandlerResult {
  const call = { runId: required(args.positionals[0], "run id"), ...args.options };
  if (args.options.view !== undefined || args.options.focus !== undefined || args.options.depth !== undefined) {
    const compact = loadMultiAgentCli().multiAgentGraphCompactCli(call);
    return { json: compact, text: formatCompactGraph(compact as never) };
  }
  return { json: loadMultiAgentCli().multiAgentGraphCli(call), text: loadMultiAgentCli().multiAgentGraphText(call) };
}
attachCliBinding("multi-agent.graph", { path: ["multi-agent", "graph"], helpPath: ["multi-agent", "graph"], jsonMode: "flag", handler: multiAgentGraphHandler });
attachCliBinding("multi-agent.graph.compact", { path: ["multi-agent", "graph"], helpPath: ["multi-agent", "graph"], jsonMode: "flag", handler: multiAgentGraphHandler });
REGISTRY_BY_CAPABILITY.get("multi-agent.graph")!.mcp!.handler = (args) => loadMultiAgentCli().multiAgentGraphCli(args);

// GAP: `cw multi-agent dependencies|failures|evidence` — the MCP tool rows
// (cw_multi_agent_dependencies/failures/evidence) were declared but had no
// CLI path binding and their mcp.handler was still notYetImplemented. Wire
// both surfaces to the same operator-ux derivation the CLI text render uses
// (port of the old handler's dependencies/failures/evidence arms).
attachCliBinding("multi-agent.dependencies", {
  path: ["multi-agent", "dependencies"],
  jsonMode: "flag",
  handler: (args) => ({
    json: loadMultiAgentCli().multiAgentDependenciesCli({ runId: required(args.positionals[0], "run id"), ...args.options }),
    text: loadMultiAgentCli().multiAgentDependenciesText({ runId: required(args.positionals[0], "run id"), ...args.options }),
  }),
});
REGISTRY_BY_CAPABILITY.get("multi-agent.dependencies")!.mcp!.handler = (args) => loadMultiAgentCli().multiAgentDependenciesCli(args);

attachCliBinding("multi-agent.failures", {
  path: ["multi-agent", "failures"],
  jsonMode: "flag",
  handler: (args) => ({
    json: loadMultiAgentCli().multiAgentFailuresCli({ runId: required(args.positionals[0], "run id"), ...args.options }),
    text: loadMultiAgentCli().multiAgentFailuresText({ runId: required(args.positionals[0], "run id"), ...args.options }),
  }),
});
REGISTRY_BY_CAPABILITY.get("multi-agent.failures")!.mcp!.handler = (args) => loadMultiAgentCli().multiAgentFailuresCli(args);

attachCliBinding("multi-agent.evidence", {
  path: ["multi-agent", "evidence"],
  jsonMode: "flag",
  handler: (args) => ({
    json: loadMultiAgentCli().multiAgentEvidenceCli({ runId: required(args.positionals[0], "run id"), ...args.options }),
    text: loadMultiAgentCli().multiAgentEvidenceText({ runId: required(args.positionals[0], "run id"), ...args.options }),
  }),
});
REGISTRY_BY_CAPABILITY.get("multi-agent.evidence")!.mcp!.handler = (args) => loadMultiAgentCli().multiAgentEvidenceCli(args);

// GAP: `cw multi-agent reasoning <run> [--refresh|--evidence <id>]` — the
// evidence-adoption reasoning chain (cw_evidence_reasoning /
// cw_evidence_reasoning_refresh MCP tools were declared but notYetImplemented,
// and no CLI verb was bound). `--refresh` prints the durable index (JSON only,
// matching the old handler's printJson refresh arm); otherwise it prints the
// report (text, or JSON under --json).
function multiAgentReasoningHandler(args: CapabilityCliArgs): CliHandlerResult {
  const call = { runId: required(args.positionals[0], "run id"), ...args.options };
  if (args.options.refresh && args.options.evidence === undefined && args.options.evidenceId === undefined) {
    return { json: loadMultiAgentCli().multiAgentReasoningRefreshCli(call) };
  }
  return { json: loadMultiAgentCli().multiAgentReasoningCli(call), text: loadMultiAgentCli().multiAgentReasoningText(call) };
}
attachCliBinding("multi-agent.reasoning", { path: ["multi-agent", "reasoning"], helpPath: ["multi-agent", "reasoning"], jsonMode: "flag", handler: multiAgentReasoningHandler });
// `multi-agent.reasoning.refresh` (the durable evidence-adoption index) shares
// the ["multi-agent","reasoning"] dispatch path — `cw multi-agent reasoning
// <run> --refresh` is served by the reasoning binding above (first row wins).
// This row exists so the refresh capability also carries a cli binding (the
// both-surface pairing) and `cw help multi-agent` lists it. Same handler.
attachCliBinding("multi-agent.reasoning.refresh", { path: ["multi-agent", "reasoning"], helpPath: ["multi-agent", "reasoning"], jsonMode: "default", handler: multiAgentReasoningHandler });
REGISTRY_BY_CAPABILITY.get("multi-agent.reasoning")!.mcp!.handler = (args) => loadMultiAgentCli().multiAgentReasoningCli(args);
REGISTRY_BY_CAPABILITY.get("multi-agent.reasoning.refresh")!.mcp!.handler = (args) => loadMultiAgentCli().multiAgentReasoningRefreshCli(args);

// GAP: the state-explosion / contract read views (cw_multi_agent_summarize /
// cw_blackboard_summarize / cw_multi_agent_graph_compact / cw_contract_show)
// were declared MCP tools left on notYetImplemented, and their CLI verbs were
// unbound. Wire both surfaces to the ported read fns.
attachCliBinding("multi-agent.summarize", {
  path: ["multi-agent", "summarize"],
  jsonMode: "flag",
  handler: (args) => {
    const result = loadMultiAgentCli().multiAgentSummarizeCli({ runId: required(args.positionals[0], "run id"), ...args.options });
    return { json: result, text: formatStateExplosionReport(result as never) };
  },
});
REGISTRY_BY_CAPABILITY.get("multi-agent.summarize")!.mcp!.handler = (args) => loadMultiAgentCli().multiAgentSummarizeCli(args);
REGISTRY_BY_CAPABILITY.get("multi-agent.graph.compact")!.mcp!.handler = (args) => loadMultiAgentCli().multiAgentGraphCompactCli(args);

attachCliBinding("blackboard.summarize", {
  path: ["blackboard", "summarize"],
  jsonMode: "flag",
  handler: (args) => ({ json: loadMultiAgentCli().blackboardSummarizeCli({ runId: required(args.positionals[0], "run id"), ...args.options }) }),
});
REGISTRY_BY_CAPABILITY.get("blackboard.summarize")!.mcp!.handler = (args) => loadMultiAgentCli().blackboardSummarizeCli(args);

attachCliBinding("contract.show", {
  path: ["contract", "show"],
  jsonMode: "default",
  handler: (args) => ({ json: loadMultiAgentCli().contractShowCli({ runId: required(args.positionals[0], "run id"), ...args.options }, args.positionals[1]) }),
});
REGISTRY_BY_CAPABILITY.get("contract.show")!.mcp!.handler = (args) => loadMultiAgentCli().contractShowCli(args);

attachCliBinding("multi-agent.run.create", {
  path: ["multi-agent", "role"],
  helpPath: ["multi-agent", "role"],
  jsonMode: "default",
  handler: (args) => ({
    json: loadMultiAgentCli().multiAgentRoleCli({
      ...args.options,
      runId: required(args.positionals[0], "run id"),
      roleId: args.options.id === undefined && args.positionals.length >= 2 ? args.positionals[1] : args.options.roleId,
    }),
  }),
});
attachCliBinding("multi-agent.group.create", {
  path: ["multi-agent", "group"],
  helpPath: ["multi-agent", "group"],
  jsonMode: "default",
  handler: (args) => ({
    json: loadMultiAgentCli().multiAgentGroupCli({
      ...args.options,
      runId: required(args.positionals[0], "run id"),
      groupId: args.options.id === undefined && args.positionals.length >= 2 ? args.positionals[1] : args.options.groupId,
    }),
  }),
});
attachCliBinding("multi-agent.membership.create", {
  path: ["multi-agent", "membership"],
  helpPath: ["multi-agent", "membership"],
  jsonMode: "default",
  handler: (args) => ({
    json: loadMultiAgentCli().multiAgentMembershipCli({
      ...args.options,
      runId: required(args.positionals[0], "run id"),
      membershipId: args.options.id === undefined && args.positionals.length >= 2 ? args.positionals[1] : args.options.membershipId,
    }),
  }),
});
attachCliBinding("multi-agent.fanout.create", {
  path: ["multi-agent", "fanout"],
  helpPath: ["multi-agent", "fanout"],
  jsonMode: "default",
  handler: (args) => ({
    json: loadMultiAgentCli().multiAgentFanoutCli({
      ...args.options,
      runId: required(args.positionals[0], "run id"),
      fanoutId: args.options.id === undefined && args.positionals.length >= 2 ? args.positionals[1] : args.options.fanoutId,
    }),
  }),
});
attachCliBinding("multi-agent.fanin.collect", {
  path: ["multi-agent", "fanin"],
  helpPath: ["multi-agent", "fanin"],
  jsonMode: "default",
  handler: (args) => ({
    json: loadMultiAgentCli().multiAgentFaninCli({
      ...args.options,
      runId: required(args.positionals[0], "run id"),
      faninId: args.options.id === undefined && args.positionals.length >= 2 ? args.positionals[1] : args.options.faninId,
    }),
  }),
});
REGISTRY_BY_CAPABILITY.get("multi-agent.run.create")!.mcp!.handler = (args) => loadMultiAgentCli().multiAgentRoleCli(args);
REGISTRY_BY_CAPABILITY.get("multi-agent.role.create")!.mcp!.handler = (args) => loadMultiAgentCli().multiAgentRoleCli(args);
REGISTRY_BY_CAPABILITY.get("multi-agent.group.create")!.mcp!.handler = (args) => loadMultiAgentCli().multiAgentGroupCli(args);
REGISTRY_BY_CAPABILITY.get("multi-agent.membership.create")!.mcp!.handler = (args) => loadMultiAgentCli().multiAgentMembershipCli(args);
REGISTRY_BY_CAPABILITY.get("multi-agent.fanout.create")!.mcp!.handler = (args) => loadMultiAgentCli().multiAgentFanoutCli(args);
REGISTRY_BY_CAPABILITY.get("multi-agent.fanin.collect")!.mcp!.handler = (args) => loadMultiAgentCli().multiAgentFaninCli(args);
// GAP: the *.show MCP tools were declared but left notYetImplemented. Route
// each to its create CLI fn's read arm (id-only args return the record).
REGISTRY_BY_CAPABILITY.get("multi-agent.role.show")!.mcp!.handler = (args) => loadMultiAgentCli().multiAgentRoleCli({ ...args, roleId: args.roleId ?? args.id });
REGISTRY_BY_CAPABILITY.get("multi-agent.group.show")!.mcp!.handler = (args) => loadMultiAgentCli().multiAgentGroupCli({ ...args, groupId: args.groupId ?? args.id });
REGISTRY_BY_CAPABILITY.get("multi-agent.membership.show")!.mcp!.handler = (args) => loadMultiAgentCli().multiAgentMembershipCli({ ...args, membershipId: args.membershipId ?? args.id });
REGISTRY_BY_CAPABILITY.get("multi-agent.fanout.show")!.mcp!.handler = (args) => loadMultiAgentCli().multiAgentFanoutCli({ ...args, fanoutId: args.fanoutId ?? args.id });
REGISTRY_BY_CAPABILITY.get("multi-agent.fanin.show")!.mcp!.handler = (args) => loadMultiAgentCli().multiAgentFaninCli({ ...args, faninId: args.faninId ?? args.id });

// The create/show pairs for role/group/membership/fanout/fanin each SHARE
// one dispatch path (["multi-agent","role"] etc.); `cw multi-agent role
// <run> [id]` is served by the create binding declared above (first row
// wins findCapabilityByCliPath), and an id-only invocation returns the
// existing record (the read arm). These extra rows exist so each show
// capability — and multi-agent.role.create, distinct from the
// multi-agent.run.create binding that already owns the ["multi-agent",
// "role"] path — also carries a cli binding (the both-surface pairing),
// exactly like blackboard.message.post/list. Same handler, same shell fn.
function multiAgentRoleHandler(args: CapabilityCliArgs): CliHandlerResult {
  return {
    json: loadMultiAgentCli().multiAgentRoleCli({
      ...args.options,
      runId: required(args.positionals[0], "run id"),
      roleId: args.options.id === undefined && args.positionals.length >= 2 ? args.positionals[1] : args.options.roleId,
    }),
  };
}
attachCliBinding("multi-agent.role.create", { path: ["multi-agent", "role"], helpPath: ["multi-agent", "role"], jsonMode: "default", handler: multiAgentRoleHandler });
attachCliBinding("multi-agent.role.show", { path: ["multi-agent", "role"], helpPath: ["multi-agent", "role"], jsonMode: "default", handler: multiAgentRoleHandler });
attachCliBinding("multi-agent.group.show", {
  path: ["multi-agent", "group"],
  helpPath: ["multi-agent", "group"],
  jsonMode: "default",
  handler: (args) => ({ json: loadMultiAgentCli().multiAgentGroupCli({ ...args.options, runId: required(args.positionals[0], "run id"), groupId: args.options.id === undefined && args.positionals.length >= 2 ? args.positionals[1] : args.options.groupId }) }),
});
attachCliBinding("multi-agent.membership.show", {
  path: ["multi-agent", "membership"],
  helpPath: ["multi-agent", "membership"],
  jsonMode: "default",
  handler: (args) => ({ json: loadMultiAgentCli().multiAgentMembershipCli({ ...args.options, runId: required(args.positionals[0], "run id"), membershipId: args.options.id === undefined && args.positionals.length >= 2 ? args.positionals[1] : args.options.membershipId }) }),
});
attachCliBinding("multi-agent.fanout.show", {
  path: ["multi-agent", "fanout"],
  helpPath: ["multi-agent", "fanout"],
  jsonMode: "default",
  handler: (args) => ({ json: loadMultiAgentCli().multiAgentFanoutCli({ ...args.options, runId: required(args.positionals[0], "run id"), fanoutId: args.options.id === undefined && args.positionals.length >= 2 ? args.positionals[1] : args.options.fanoutId }) }),
});
attachCliBinding("multi-agent.fanin.show", {
  path: ["multi-agent", "fanin"],
  helpPath: ["multi-agent", "fanin"],
  jsonMode: "default",
  handler: (args) => ({ json: loadMultiAgentCli().multiAgentFaninCli({ ...args.options, runId: required(args.positionals[0], "run id"), faninId: args.options.id === undefined && args.positionals.length >= 2 ? args.positionals[1] : args.options.faninId }) }),
});

attachCliBinding("multi-agent.run.transition", {
  path: ["multi-agent", "transition"],
  jsonMode: "default",
  handler: (args) => ({ json: loadMultiAgentCli().multiAgentRunCli({ ...args.options, runId: required(args.positionals[0], "run id") }) }),
});
REGISTRY_BY_CAPABILITY.get("multi-agent.run.transition")!.mcp!.handler = (args) => loadMultiAgentCli().multiAgentRunCli(args);

attachCliBinding("multi-agent.run.show", {
  path: ["multi-agent", "show"],
  jsonMode: "default",
  handler: (args) => ({ json: loadMultiAgentCli().multiAgentShowCli({ runId: required(args.positionals[0], "run id"), ...args.options }, required(args.positionals[1], "id")) }),
});
REGISTRY_BY_CAPABILITY.get("multi-agent.run.show")!.mcp!.handler = (args) => loadMultiAgentCli().multiAgentShowCli(args, required(optionalArg(args.multiAgentRunId ?? args.id), "id"));

// ---- blackboard / coordinator -------------------------------------------

attachCliBinding("blackboard.summary", {
  path: ["blackboard", "summary"],
  jsonMode: "default",
  handler: (args) => ({ json: loadMultiAgentCli().blackboardSummaryCli({ runId: required(args.positionals[0], "run id"), ...args.options }) }),
});
REGISTRY_BY_CAPABILITY.get("blackboard.summary")!.mcp!.handler = (args) => loadMultiAgentCli().blackboardSummaryCli(args);

attachCliBinding("blackboard.graph", {
  path: ["blackboard", "graph"],
  jsonMode: "default",
  handler: (args) => ({ json: loadMultiAgentCli().blackboardGraphCli({ runId: required(args.positionals[0], "run id"), ...args.options }) }),
});
REGISTRY_BY_CAPABILITY.get("blackboard.graph")!.mcp!.handler = (args) => loadMultiAgentCli().blackboardGraphCli(args);

attachCliBinding("blackboard.resolve", {
  path: ["blackboard", "resolve"],
  jsonMode: "default",
  handler: (args) => ({ json: loadMultiAgentCli().blackboardResolveCli({ ...args.options, runId: required(args.positionals[0], "run id") }) }),
});
REGISTRY_BY_CAPABILITY.get("blackboard.resolve")!.mcp!.handler = (args) => loadMultiAgentCli().blackboardResolveCli(args);

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
function blackboardRunAndAction(args: CapabilityCliArgs): { runId: string; action?: string } {
  const [first, second] = args.positionals;
  if (first !== undefined && BLACKBOARD_ACTION_WORDS.has(first)) {
    return { runId: required(second, "run id"), action: first };
  }
  return { runId: required(first, "run id"), action: second };
}

attachCliBinding("blackboard.topic.create", {
  path: ["blackboard", "topic"],
  helpPath: ["blackboard", "topic", "create"],
  jsonMode: "default",
  handler: (args) => ({ json: loadMultiAgentCli().blackboardTopicCreateCli({ ...args.options, runId: blackboardRunAndAction(args).runId }) }),
});
REGISTRY_BY_CAPABILITY.get("blackboard.topic.create")!.mcp!.handler = (args) => loadMultiAgentCli().blackboardTopicCreateCli(args);

function blackboardMessageHandler(args: CapabilityCliArgs): CliHandlerResult {
  const { runId, action } = blackboardRunAndAction(args);
  if (action === "list") return { json: loadMultiAgentCli().blackboardMessageListCli({ ...args.options, runId }) };
  return { json: loadMultiAgentCli().blackboardMessagePostCli({ ...args.options, runId }) };
}
attachCliBinding("blackboard.message.post", { path: ["blackboard", "message"], helpPath: ["blackboard", "message", "post"], jsonMode: "default", handler: blackboardMessageHandler });
attachCliBinding("blackboard.message.list", { path: ["blackboard", "message"], helpPath: ["blackboard", "message", "list"], jsonMode: "default", handler: blackboardMessageHandler });
REGISTRY_BY_CAPABILITY.get("blackboard.message.post")!.mcp!.handler = (args) => loadMultiAgentCli().blackboardMessagePostCli(args);
REGISTRY_BY_CAPABILITY.get("blackboard.message.list")!.mcp!.handler = (args) => loadMultiAgentCli().blackboardMessageListCli(args);

attachCliBinding("blackboard.context.put", {
  path: ["blackboard", "context"],
  helpPath: ["blackboard", "context", "put"],
  jsonMode: "default",
  handler: (args) => ({ json: loadMultiAgentCli().blackboardContextPutCli({ ...args.options, runId: blackboardRunAndAction(args).runId }) }),
});
REGISTRY_BY_CAPABILITY.get("blackboard.context.put")!.mcp!.handler = (args) => loadMultiAgentCli().blackboardContextPutCli(args);

function blackboardArtifactHandler(args: CapabilityCliArgs): CliHandlerResult {
  const { runId, action } = blackboardRunAndAction(args);
  if (action === "list") return { json: loadMultiAgentCli().blackboardArtifactListCli({ ...args.options, runId }) };
  return { json: loadMultiAgentCli().blackboardArtifactAddCli({ ...args.options, runId }) };
}
attachCliBinding("blackboard.artifact.add", { path: ["blackboard", "artifact"], helpPath: ["blackboard", "artifact", "add"], jsonMode: "default", handler: blackboardArtifactHandler });
attachCliBinding("blackboard.artifact.list", { path: ["blackboard", "artifact"], helpPath: ["blackboard", "artifact", "list"], jsonMode: "default", handler: blackboardArtifactHandler });
REGISTRY_BY_CAPABILITY.get("blackboard.artifact.add")!.mcp!.handler = (args) => loadMultiAgentCli().blackboardArtifactAddCli(args);
REGISTRY_BY_CAPABILITY.get("blackboard.artifact.list")!.mcp!.handler = (args) => loadMultiAgentCli().blackboardArtifactListCli(args);

attachCliBinding("blackboard.snapshot", {
  path: ["blackboard", "snapshot"],
  jsonMode: "default",
  handler: (args) => ({ json: loadMultiAgentCli().blackboardSnapshotCli({ ...args.options, runId: required(args.positionals[0], "run id") }) }),
});
REGISTRY_BY_CAPABILITY.get("blackboard.snapshot")!.mcp!.handler = (args) => loadMultiAgentCli().blackboardSnapshotCli(args);

attachCliBinding("coordinator.summary", {
  path: ["coordinator", "summary"],
  jsonMode: "default",
  handler: (args) => ({ json: loadMultiAgentCli().coordinatorSummaryCli({ runId: required(args.positionals[0], "run id"), ...args.options }) }),
});
REGISTRY_BY_CAPABILITY.get("coordinator.summary")!.mcp!.handler = (args) => loadMultiAgentCli().coordinatorSummaryCli(args);

attachCliBinding("coordinator.decision", {
  path: ["coordinator", "decision"],
  jsonMode: "default",
  handler: (args) => ({ json: loadMultiAgentCli().coordinatorDecisionCli({ ...args.options, runId: required(args.positionals[0], "run id") }) }),
});
REGISTRY_BY_CAPABILITY.get("coordinator.decision")!.mcp!.handler = (args) => loadMultiAgentCli().coordinatorDecisionCli(args);

// ---- candidate scoring ----------------------------------------------------

attachCliBinding("candidate.list", {
  path: ["candidate", "list"],
  jsonMode: "default",
  handler: (args) => ({ json: loadMultiAgentCli().candidateListCli({ runId: required(args.positionals[0], "run id"), ...args.options }) }),
});
REGISTRY_BY_CAPABILITY.get("candidate.list")!.mcp!.handler = (args) => loadMultiAgentCli().candidateListCli(args);

attachCliBinding("candidate.show", {
  path: ["candidate", "show"],
  jsonMode: "default",
  handler: (args) => ({ json: loadMultiAgentCli().candidateShowCli({ runId: required(args.positionals[0], "run id"), ...args.options }, required(args.positionals[1], "candidate id")) }),
});
REGISTRY_BY_CAPABILITY.get("candidate.show")!.mcp!.handler = (args) => loadMultiAgentCli().candidateShowCli(args, required(optionalArg(args.candidateId), "candidate id"));

attachCliBinding("candidate.register", {
  path: ["candidate", "register"],
  jsonMode: "default",
  handler: (args) => ({ json: loadMultiAgentCli().candidateRegisterCli({ ...args.options, runId: required(args.positionals[0], "run id") }) }),
});
REGISTRY_BY_CAPABILITY.get("candidate.register")!.mcp!.handler = (args) => loadMultiAgentCli().candidateRegisterCli(args);

attachCliBinding("candidate.score", {
  path: ["candidate", "score"],
  jsonMode: "default",
  handler: (args) => ({ json: loadMultiAgentCli().candidateScoreCli({ ...args.options, runId: required(args.positionals[0], "run id") }, required(args.positionals[1], "candidate id")) }),
});
REGISTRY_BY_CAPABILITY.get("candidate.score")!.mcp!.handler = (args) => loadMultiAgentCli().candidateScoreCli(args, required(optionalArg(args.candidateId), "candidate id"));

attachCliBinding("candidate.rank", {
  path: ["candidate", "rank"],
  jsonMode: "default",
  handler: (args) => ({ json: loadMultiAgentCli().candidateRankCli({ runId: required(args.positionals[0], "run id"), ...args.options }) }),
});
REGISTRY_BY_CAPABILITY.get("candidate.rank")!.mcp!.handler = (args) => loadMultiAgentCli().candidateRankCli(args);

attachCliBinding("candidate.select", {
  path: ["candidate", "select"],
  jsonMode: "default",
  handler: (args) => ({ json: loadMultiAgentCli().candidateSelectCli({ ...args.options, runId: required(args.positionals[0], "run id") }, required(args.positionals[1], "candidate id")) }),
});
REGISTRY_BY_CAPABILITY.get("candidate.select")!.mcp!.handler = (args) => loadMultiAgentCli().candidateSelectCli(args, required(optionalArg(args.candidateId), "candidate id"));

attachCliBinding("candidate.reject", {
  path: ["candidate", "reject"],
  jsonMode: "default",
  handler: (args) => ({ json: loadMultiAgentCli().candidateRejectCli({ ...args.options, runId: required(args.positionals[0], "run id") }, required(args.positionals[1], "candidate id")) }),
});
REGISTRY_BY_CAPABILITY.get("candidate.reject")!.mcp!.handler = (args) => loadMultiAgentCli().candidateRejectCli(args, required(optionalArg(args.candidateId), "candidate id"));

// jsonMode "flag": human `Candidates` panel by default, canonical JSON under
// --json (old build's candidate.summary was flag).
attachCliBinding("candidate.summary", {
  path: ["candidate", "summary"],
  jsonMode: "flag",
  handler: (args) => {
    const summary = loadMultiAgentCli().candidateSummaryCli({ runId: required(args.positionals[0], "run id"), ...args.options });
    return { json: summary, text: `${loadOperatorUxText().formatCandidateSummaryText(summary as OperatorCandidateSummary)}\n` };
  },
});
REGISTRY_BY_CAPABILITY.get("candidate.summary")!.mcp!.handler = (args) => loadMultiAgentCli().candidateSummaryCli(args);

// ---- collaboration ---------------------------------------------------------

attachCliBinding("approve", {
  path: ["approve"],
  jsonMode: "default",
  handler: (args) => ({ json: loadMultiAgentCli().approveCli({ ...args.options, runId: required(args.positionals[1], "run id"), body: args.positionals[3] }, args.positionals[0], args.positionals[2]) }),
});
REGISTRY_BY_CAPABILITY.get("approve")!.mcp!.handler = (args) => loadMultiAgentCli().approveCli(args);

attachCliBinding("reject", {
  path: ["reject"],
  jsonMode: "default",
  handler: (args) => ({ json: loadMultiAgentCli().rejectCollabCli({ ...args.options, runId: required(args.positionals[1], "run id") }, args.positionals[0], args.positionals[2]) }),
});
REGISTRY_BY_CAPABILITY.get("reject")!.mcp!.handler = (args) => loadMultiAgentCli().rejectCollabCli(args);

attachCliBinding("comment.add", {
  path: ["comment", "add"],
  jsonMode: "default",
  handler: (args) => ({ json: loadMultiAgentCli().commentAddCli({ ...args.options, runId: required(args.positionals[1], "run id"), body: args.options.body ?? args.positionals[3] }, args.positionals[0], args.positionals[2]) }),
});
REGISTRY_BY_CAPABILITY.get("comment.add")!.mcp!.handler = (args) => loadMultiAgentCli().commentAddCli(args);

// jsonMode "flag": human comment list by default, canonical JSON under
// --json (old build's comment.list was flag).
attachCliBinding("comment.list", {
  path: ["comment", "list"],
  jsonMode: "flag",
  handler: (args) => {
    const report = loadMultiAgentCli().commentListCli({ runId: required(args.positionals[0], "run id"), ...args.options });
    return { json: report, text: `${loadCollaborationIo().formatCommentList(report as CommentListReport)}\n` };
  },
});
REGISTRY_BY_CAPABILITY.get("comment.list")!.mcp!.handler = (args) => loadMultiAgentCli().commentListCli(args);

attachCliBinding("handoff", {
  path: ["handoff"],
  jsonMode: "default",
  // `cw handoff <kind> <run-id> [target-id]` (byte-behavior port of the old
  // build's handleHandoff): the FIRST required() is on the target-kind
  // positional, so a bare `cw handoff` fails with "Missing target kind" — not
  // "Missing run id". The kind check must fire before the run-id read.
  handler: (args) => {
    const kind = required(args.positionals[0], "target kind");
    const runId = required(args.positionals[1], "run id");
    return { json: loadMultiAgentCli().handoffCli({ ...args.options, runId }, kind, args.positionals[2]) };
  },
});
REGISTRY_BY_CAPABILITY.get("handoff")!.mcp!.handler = (args) => loadMultiAgentCli().handoffCli(args);

// jsonMode "flag": human review-status report by default, canonical JSON
// under --json (old build's review.status was flag).
attachCliBinding("review.status", {
  path: ["review", "status"],
  jsonMode: "flag",
  handler: (args) => {
    const report = loadMultiAgentCli().reviewStatusCli({ runId: required(args.positionals[0], "run id"), ...args.options });
    return { json: report, text: `${loadCollaborationIo().formatReviewStatus(report as ReviewStatusReport)}\n` };
  },
});
REGISTRY_BY_CAPABILITY.get("review.status")!.mcp!.handler = (args) => loadMultiAgentCli().reviewStatusCli(args);

attachCliBinding("review.policy", {
  path: ["review", "policy"],
  jsonMode: "default",
  handler: (args) => ({ json: loadMultiAgentCli().reviewPolicyCli({ ...args.options, runId: required(args.positionals[0], "run id") }) }),
});
REGISTRY_BY_CAPABILITY.get("review.policy")!.mcp!.handler = (args) => loadMultiAgentCli().reviewPolicyCli(args);

// ---- eval replay harness ---------------------------------------------------

// eval snapshot|replay|compare|score|gate|report — `jsonMode: flag` so a bare
// call renders the human eval report (formatMultiAgentEval) and `--json`
// prints the result object, matching the old build's eval handler.
attachCliBinding("eval.snapshot", {
  path: ["eval", "snapshot"],
  jsonMode: "flag",
  handler: (args) => {
    const result = loadMultiAgentCli().evalSnapshotCli({ runId: required(args.positionals[0], "run id"), ...args.options });
    return { json: result, text: loadEvalText().formatMultiAgentEval(result) };
  },
});
REGISTRY_BY_CAPABILITY.get("eval.snapshot")!.mcp!.handler = (args) => loadMultiAgentCli().evalSnapshotCli(args);

attachCliBinding("eval.replay", {
  path: ["eval", "replay"],
  jsonMode: "flag",
  handler: (args) => {
    const result = loadMultiAgentCli().evalReplayCli({ snapshot: args.positionals[0], ...args.options });
    return { json: result, text: loadEvalText().formatMultiAgentEval(result) };
  },
});
REGISTRY_BY_CAPABILITY.get("eval.replay")!.mcp!.handler = (args) => loadMultiAgentCli().evalReplayCli(args);

attachCliBinding("eval.compare", {
  path: ["eval", "compare"],
  jsonMode: "flag",
  handler: (args) => {
    const result = loadMultiAgentCli().evalCompareCli({ baseline: args.positionals[0], replay: args.positionals[1], ...args.options });
    return { json: result, text: loadEvalText().formatMultiAgentEval(result) };
  },
});
REGISTRY_BY_CAPABILITY.get("eval.compare")!.mcp!.handler = (args) => loadMultiAgentCli().evalCompareCli(args);

attachCliBinding("eval.score", {
  path: ["eval", "score"],
  jsonMode: "flag",
  handler: (args) => {
    const result = loadMultiAgentCli().evalScoreCli({ replay: args.positionals[0], ...args.options });
    return { json: result, text: loadEvalText().formatMultiAgentEval(result) };
  },
});
REGISTRY_BY_CAPABILITY.get("eval.score")!.mcp!.handler = (args) => loadMultiAgentCli().evalScoreCli(args);

attachCliBinding("eval.gate", {
  path: ["eval", "gate"],
  jsonMode: "flag",
  handler: (args) => {
    const gate = loadMultiAgentCli().evalGateCli({ suite: args.positionals[0], ...args.options }) as { verdict: string };
    return { json: gate, text: loadEvalText().formatMultiAgentEval(gate), exitCode: gate.verdict === "ship" ? undefined : 1 };
  },
});
REGISTRY_BY_CAPABILITY.get("eval.gate")!.mcp!.handler = (args) => loadMultiAgentCli().evalGateCli(args);

attachCliBinding("eval.report", {
  path: ["eval", "report"],
  jsonMode: "flag",
  handler: (args) => {
    const result = loadMultiAgentCli().evalReportCli({ replay: args.positionals[0], ...args.options });
    return { json: result, text: loadEvalText().formatMultiAgentEval(result) };
  },
});
REGISTRY_BY_CAPABILITY.get("eval.report")!.mcp!.handler = (args) => loadMultiAgentCli().evalReportCli(args);

// ---------------------------------------------------------------------
