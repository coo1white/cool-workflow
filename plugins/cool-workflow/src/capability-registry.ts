// CLI <-> MCP Capability Registry — the SINGLE declared source of truth for
// every capability Cool Workflow exposes, and the contract both front doors are
// validated against.
//
// BSD discipline:
//  - SEPARATE MECHANISM FROM POLICY. Each capability names ONE shared core
//    `entry` (the mechanism, the single source). `cli` and `mcp` are two
//    renderings (policy) of that entry's canonical payload.
//  - ONE SOURCE, TWO RENDERINGS. A capability marked `payloadIdentical` MUST
//    return a byte-for-byte equal JSON payload from `cw <cmd> --json` and from
//    the `cw_<tool>` MCP result (whitespace aside). Any divergence is drift.
//  - LEAST ASTONISHMENT. Names, flags, and argument order line up across
//    surfaces so a human who learns one can predict the other.
//  - FAIL CLOSED ON DRIFT. A capability reachable on one surface but absent on
//    the other, an MCP tool or CLI command not declared here, or an undeclared
//    payload divergence, is a release-blocking error — see scripts/parity-check.js.
//  - STABLE INTERFACES. We add what is missing and map the rest; we never drop
//    or rename a shipped CLI command or MCP tool to force symmetry.
//
// When a capability is intentionally on one surface only, or intentionally
// renders different payloads per surface, it MUST carry a `reason`. A
// surface-specific or payload-divergent capability WITHOUT a recorded reason is
// itself release-blocking (a fail-closed default), exactly like the vendor
// manifest generator's `--check`.

export type ParitySurface = "both" | "cli-only" | "mcp-only";

export type CliJsonMode =
  | "default" // command always prints the canonical JSON payload
  | "flag" //    human text by default; canonical JSON under --json/--format json
  | "human"; //  human-only rendering; no canonical JSON on this surface

export interface CliBinding {
  /** Human-facing invocation tokens, e.g. ["worker", "list"]. */
  path: string[];
  /** Actual `case` tokens the dispatcher matches (defaults to `path`). Action
   *  words dispatched via `if (action === ...)` rather than `case` are omitted. */
  caseTokens?: string[];
  jsonMode: CliJsonMode;
}

export interface McpBinding {
  tool: string;
  /** Required argument groups for this tool. Each element is a "keyA|keyB"
   *  group meaning at least one of those arg keys must be present. Declared
   *  once here as data instead of an if-ladder in the MCP server. */
  requiredArgs?: string[];
}

export interface McpToolDefinition {
  name: string;
  description: string;
  inputSchema: {
    type: "object";
    properties: Record<string, unknown>;
    additionalProperties: true;
  };
}

export interface CapabilityDescriptor {
  /** Canonical capability id, dot-namespaced, e.g. "worker.list". */
  capability: string;
  summary: string;
  /** The ONE shared core entry both surfaces route through. */
  entry: string;
  surface: ParitySurface;
  cli?: CliBinding;
  mcp?: McpBinding;
  /** True when `cw <cmd> --json` === `cw_<tool>` result (whitespace aside). Only
   *  meaningful when surface === "both". Defaults to true for "both". */
  payloadIdentical?: boolean;
  /** Required when surface !== "both" OR payloadIdentical === false. */
  reason?: string;
}

export type PayloadProbeKind = "global" | "run" | "scenario";

export interface PayloadProbeTarget {
  capability: string;
  kind: PayloadProbeKind;
}

export interface PayloadProbeDeferred {
  capability: string;
  reason: string;
}

export interface PayloadProbePlan {
  targets: PayloadProbeTarget[];
  deferred: PayloadProbeDeferred[];
  unclassified: string[];
  duplicateClassifications: string[];
  invalidClassifications: string[];
}

export interface ParityReport {
  ok: boolean;
  registrySize: number;
  /** Tools declared here but absent from the live MCP server. */
  missingMcpTools: string[];
  /** Live MCP tools not declared here (undeclared drift). */
  undeclaredMcpTools: string[];
  /** CLI case tokens declared here but absent from cli source. */
  missingCliTokens: string[];
  /** CLI case tokens in cli source not declared here (undeclared drift). */
  undeclaredCliTokens: string[];
  /** Top-level CLI commands declared here but absent from `cw help`. */
  helpMissingCliTokens: string[];
  /** Top-level CLI commands shown in `cw help` but absent from the registry. */
  helpUndeclaredCliTokens: string[];
  /** Descriptors that must carry a reason but do not. */
  reasonlessExceptions: string[];
  /** Payload-identical both-surface capabilities that are neither probed nor deferred. */
  payloadProbeUnclassified: string[];
  /** Capabilities named more than once in the payload probe classification. */
  payloadProbeDuplicateClassifications: string[];
  /** Payload probe classifications that do not name a payload-identical capability. */
  payloadProbeInvalidClassifications: string[];
  /** Internal registry lint failures (duplicate ids/tools, malformed bindings). */
  registryLint: string[];
}

// ---------------------------------------------------------------------------
// Builtin entries. Grouped to mirror the CLI dispatch and the MCP tool list.
// ---------------------------------------------------------------------------
const BUILTIN_CAPABILITIES: CapabilityDescriptor[] = [
  // ---- top-level workflow & run lifecycle ---------------------------------
  {
    capability: "help",
    summary: "Print the human CLI help text.",
    entry: "formatHelp",
    surface: "cli-only",
    cli: { path: ["help"], jsonMode: "human" },
    reason: "Human help text. MCP hosts enumerate capabilities via tools/list, not a help command."
  },
  {
    capability: "version",
    summary: "Print the current cool-workflow version.",
    entry: "CURRENT_COOL_WORKFLOW_VERSION",
    surface: "cli-only",
    cli: { path: ["version"], jsonMode: "human" },
    reason: "Version string — no structured data contract."
  },
  {
    capability: "update",
    summary: "Update cool-workflow to the latest release via npm.",
    entry: "npmUpdate",
    surface: "cli-only",
    cli: { path: ["update"], jsonMode: "human" },
    reason: "Self-update via npm — inherently local shell operation, no MCP surface."
  },
  {
    capability: "fix",
    summary: "Print consolidated fix commands for CW setup issues.",
    entry: "runDoctor",
    surface: "cli-only",
    cli: { path: ["fix"], jsonMode: "human" },
    reason: "Environment fix commands are local diagnostics, same reasoning as doctor."
  },
  {
    capability: "list",
    summary: "List bundled CW workflows.",
    entry: "listWorkflows",
    surface: "both",
    cli: { path: ["list"], jsonMode: "default" },
    mcp: { tool: "cw_list" }
  },
  {
    capability: "info",
    summary: "Show what a workflow app does: title, description, inputs, sandbox, phases, and a runnable example.",
    entry: "showApp",
    surface: "cli-only",
    cli: { path: ["info"], jsonMode: "flag" },
    reason: "Human-focused workflow discovery tool (like Homebrew's `brew info`). MCP agents discover workflows via cw_list and cw_app_show tools."
  },
  {
    capability: "search",
    summary: "Search workflow apps by keyword (title, description, id).",
    entry: "listApps",
    surface: "cli-only",
    cli: { path: ["search"], jsonMode: "flag" },
    reason: "Human-focused workflow discovery (like Homebrew's `brew search`). MCP agents discover workflows via cw_list tool."
  },
  {
    capability: "man",
    summary: "Show a man page from docs/ (e.g. cw man release-tooling).",
    entry: "n/a",
    surface: "cli-only",
    cli: { path: ["man"], jsonMode: "human" },
    reason: "Human documentation viewer. MCP agents read docs/ directly via file tools."
  },
  {
    capability: "doctor",
    summary: "Diagnose the host for setup problems (Node version, agent backend, agent binary on PATH, git, writable home/repo state) and print an actionable fix per check.",
    entry: "runDoctor",
    surface: "cli-only",
    cli: { path: ["doctor"], jsonMode: "flag" },
    reason: "Environment diagnostics are inherently local to the CLI host — Node version, $PATH, $CW_HOME/cwd writability. An MCP client diagnosing the server process's environment is not meaningful; agents already receive the same readiness facts in their typed results (e.g. status: blocked, agentConfigured). Inspired by `brew doctor`."
  },
  {
    capability: "init",
    summary: "Scaffold a new workflow definition.",
    entry: "init",
    surface: "both",
    cli: { path: ["init"], jsonMode: "default" },
    mcp: { tool: "cw_init", requiredArgs: ["workflowId"] }
  },
  {
    capability: "plan",
    summary: "Create a CW run and return its canonical plan summary.",
    entry: "planSummary",
    surface: "both",
    cli: { path: ["plan"], jsonMode: "default" },
    mcp: { tool: "cw_plan", requiredArgs: ["workflowId"] }
  },
  {
    capability: "status",
    summary: "Read run checkpoint status.",
    entry: "status",
    surface: "both",
    cli: { path: ["status"], jsonMode: "flag" },
    mcp: { tool: "cw_status", requiredArgs: ["runId"] }
  },
  {
    capability: "next",
    summary: "Read the next recommended tasks for a run.",
    entry: "next",
    surface: "both",
    cli: { path: ["next"], jsonMode: "default" },
    mcp: { tool: "cw_next", requiredArgs: ["runId"] }
  },
  {
    capability: "dispatch",
    summary: "Create a subagent dispatch manifest.",
    entry: "dispatch",
    surface: "both",
    cli: { path: ["dispatch"], jsonMode: "default" },
    mcp: { tool: "cw_dispatch", requiredArgs: ["runId"] }
  },
  {
    capability: "result",
    summary: "Record a subagent result file against a task.",
    entry: "recordResult",
    surface: "both",
    cli: { path: ["result"], jsonMode: "default" },
    mcp: { tool: "cw_result", requiredArgs: ["runId"] }
  },
  {
    capability: "commit",
    summary: "Create a verifier-gated commit or checkpoint.",
    entry: "commit",
    surface: "both",
    cli: { path: ["commit"], jsonMode: "default" },
    mcp: { tool: "cw_commit", requiredArgs: ["runId"] },
    payloadIdentical: false,
    reason:
      "Both surfaces route through the single core entry runner.commit. The CLI emits the raw StateCommitResult for scripting (commit.id, commit.evidence, commit.gate, commit.acceptanceRationale); cw_commit emits the operator commit envelope (commitId, verifierGated, checkpoint, evidenceCount, snapshotPath, nextActions, plus the raw result under `commit`). Declared projection via capability-core.commitEnvelope, not drift."
  },
  {
    capability: "commit.summary",
    summary: "Read the structured commit summary for a run.",
    entry: "summarizeCommitRecords",
    surface: "both",
    cli: { path: ["commit", "summary"], jsonMode: "flag" },
    mcp: { tool: "cw_commit_summary", requiredArgs: ["runId"] }
  },
  {
    capability: "report",
    summary: "Render a run report and return its canonical descriptor.",
    entry: "report",
    surface: "both",
    cli: { path: ["report"], jsonMode: "flag" },
    mcp: { tool: "cw_report", requiredArgs: ["runId"] }
  },
  {
    capability: "graph",
    summary: "Read the structured Operator UX run graph.",
    entry: "operatorGraph",
    surface: "both",
    cli: { path: ["graph"], jsonMode: "flag" },
    mcp: { tool: "cw_operator_graph", requiredArgs: ["runId"] }
  },
  {
    capability: "loop",
    summary: "Create a recurring loop schedule.",
    entry: "scheduler.create",
    surface: "cli-only",
    cli: { path: ["loop"], jsonMode: "default" },
    reason: "Convenience alias of `schedule create` with kind=loop. MCP hosts use cw_schedule_create with kind=loop."
  },

  // ---- operator inspection ------------------------------------------------
  {
    capability: "operator.status",
    summary: "Read the structured Operator UX run status.",
    entry: "operatorStatus",
    surface: "both",
    cli: { path: ["operator", "status"], jsonMode: "flag" },
    mcp: { tool: "cw_operator_status", requiredArgs: ["runId"] }
  },
  {
    capability: "operator.report",
    summary: "Refresh and read the structured Operator UX report summary.",
    entry: "operatorReport",
    surface: "both",
    cli: { path: ["operator", "report"], jsonMode: "flag" },
    mcp: { tool: "cw_operator_report", requiredArgs: ["runId"] }
  },

  // ---- app management -----------------------------------------------------
  { capability: "app.list", summary: "List CW workflow apps.", entry: "listApps", surface: "both", cli: { path: ["app", "list"], jsonMode: "default" }, mcp: { tool: "cw_app_list" } },
  { capability: "app.show", summary: "Show a CW workflow app contract.", entry: "showApp", surface: "both", cli: { path: ["app", "show"], jsonMode: "default" }, mcp: { tool: "cw_app_show" } },
  { capability: "app.validate", summary: "Validate an app by path or id.", entry: "validateApp", surface: "both", cli: { path: ["app", "validate"], jsonMode: "default" }, mcp: { tool: "cw_app_validate" } },
  { capability: "app.init", summary: "Create a CW workflow app directory.", entry: "initApp", surface: "both", cli: { path: ["app", "init"], jsonMode: "default" }, mcp: { tool: "cw_app_init" } },
  { capability: "app.package", summary: "Package an app as a JSON artifact.", entry: "packageApp", surface: "both", cli: { path: ["app", "package"], jsonMode: "default" }, mcp: { tool: "cw_app_package" } },
  { capability: "app.run", summary: "Create a run from an app id + structured inputs.", entry: "appRun", surface: "both", cli: { path: ["app", "run"], jsonMode: "default" }, mcp: { tool: "cw_app_run", requiredArgs: ["appId"] } },

  // ---- state / contract / node --------------------------------------------
  { capability: "state.check", summary: "Check run-state schema compatibility.", entry: "checkState", surface: "both", cli: { path: ["state", "check"], jsonMode: "default" }, mcp: { tool: "cw_state_check", requiredArgs: ["runId"] } },
  { capability: "contract.show", summary: "Show a run's pipeline contract.", entry: "showContract", surface: "both", cli: { path: ["contract", "show"], jsonMode: "default" }, mcp: { tool: "cw_contract_show", requiredArgs: ["runId"] } },
  { capability: "node.list", summary: "List state nodes for a run.", entry: "listNodes", surface: "both", cli: { path: ["node", "list"], jsonMode: "default" }, mcp: { tool: "cw_node_list", requiredArgs: ["runId"] } },
  { capability: "node.show", summary: "Show one state node for a run.", entry: "showNode", surface: "both", cli: { path: ["node", "show"], jsonMode: "default" }, mcp: { tool: "cw_node_show", requiredArgs: ["runId","nodeId"] } },
  { capability: "node.graph", summary: "Read the state-node graph for a run.", entry: "graphNodes", surface: "both", cli: { path: ["node", "graph"], jsonMode: "flag" }, mcp: { tool: "cw_node_graph", requiredArgs: ["runId"] } },
  { capability: "node.snapshot", summary: "Snapshot one state node (derived + fingerprinted).", entry: "nodeSnapshot", surface: "both", cli: { path: ["node", "snapshot"], caseTokens: ["node", "snapshot"], jsonMode: "default" }, mcp: { tool: "cw_node_snapshot" } },
  { capability: "node.diff", summary: "Structurally diff two node snapshots.", entry: "nodeDiff", surface: "both", cli: { path: ["node", "diff"], caseTokens: ["node", "diff"], jsonMode: "default" }, mcp: { tool: "cw_node_diff" } },
  { capability: "node.replay", summary: "Deterministically replay one node from a snapshot.", entry: "nodeReplay", surface: "both", cli: { path: ["node", "replay"], caseTokens: ["node", "replay"], jsonMode: "default" }, mcp: { tool: "cw_node_replay" } },
  { capability: "node.replay.verify", summary: "Verify a node replay against its source.", entry: "nodeReplayVerify", surface: "both", cli: { path: ["node", "verify"], caseTokens: ["node", "verify"], jsonMode: "default" }, mcp: { tool: "cw_node_replay_verify" } },
  { capability: "migration.list", summary: "List the declared migration registry.", entry: "migrationList", surface: "both", cli: { path: ["migration", "list"], caseTokens: ["migration", "list"], jsonMode: "default" }, mcp: { tool: "cw_migration_list" } },
  { capability: "migration.check", summary: "Dry-run migration verdict for a target.", entry: "migrationCheck", surface: "both", cli: { path: ["migration", "check"], caseTokens: ["migration", "check"], jsonMode: "default" }, mcp: { tool: "cw_migration_check" } },
  { capability: "migration.prove", summary: "Round-trip / non-destruction migration proof for a target.", entry: "migrationProve", surface: "both", cli: { path: ["migration", "prove"], caseTokens: ["migration", "prove"], jsonMode: "default" }, mcp: { tool: "cw_migration_prove" } },

  // ---- topology -----------------------------------------------------------
  { capability: "topology.list", summary: "List official topology definitions.", entry: "listTopologies", surface: "both", cli: { path: ["topology", "list"], jsonMode: "default" }, mcp: { tool: "cw_topology_list" } },
  { capability: "topology.show", summary: "Show a topology definition or run.", entry: "showTopology", surface: "both", cli: { path: ["topology", "show"], jsonMode: "default" }, mcp: { tool: "cw_topology_show", requiredArgs: ["topologyId|id"] } },
  { capability: "topology.validate", summary: "Validate a topology definition.", entry: "validateTopology", surface: "both", cli: { path: ["topology", "validate"], jsonMode: "default" }, mcp: { tool: "cw_topology_validate", requiredArgs: ["topologyId|id"] } },
  { capability: "topology.apply", summary: "Apply a topology to a run.", entry: "applyTopology", surface: "both", cli: { path: ["topology", "apply"], jsonMode: "default" }, mcp: { tool: "cw_topology_apply", requiredArgs: ["runId","topologyId|id"] } },
  { capability: "topology.summary", summary: "Read topology progress and next actions.", entry: "topologySummary", surface: "both", cli: { path: ["topology", "summary"], jsonMode: "flag" }, mcp: { tool: "cw_topology_summary", requiredArgs: ["runId"] } },
  { capability: "topology.graph", summary: "Read topology graph nodes and edges.", entry: "topologyGraph", surface: "both", cli: { path: ["topology", "graph"], jsonMode: "flag" }, mcp: { tool: "cw_topology_graph", requiredArgs: ["runId"] } },

  // ---- state-explosion summaries ------------------------------------------
  { capability: "summary.refresh", summary: "Refresh state-explosion summaries.", entry: "summaryRefresh", surface: "both", cli: { path: ["summary", "refresh"], jsonMode: "flag" }, mcp: { tool: "cw_summary_refresh", requiredArgs: ["runId"] } },
  { capability: "summary.show", summary: "Read the persisted state-explosion report.", entry: "summaryShow", surface: "both", cli: { path: ["summary", "show"], jsonMode: "flag" }, mcp: { tool: "cw_summary_show", requiredArgs: ["runId"] } },

  // ---- multi-agent host loop ----------------------------------------------
  { capability: "multi-agent.run", summary: "Create or attach a topology-backed multi-agent run.", entry: "hostMultiAgentRun", surface: "both", cli: { path: ["multi-agent", "run"], jsonMode: "default" }, mcp: { tool: "cw_multi_agent_run" } },
  { capability: "multi-agent.status", summary: "Read combined topology/blackboard/worker status.", entry: "hostMultiAgentStatus", surface: "both", cli: { path: ["multi-agent", "status"], jsonMode: "flag" }, mcp: { tool: "cw_multi_agent_status", requiredArgs: ["runId"] } },
  { capability: "multi-agent.step", summary: "Perform one safe deterministic host step.", entry: "hostMultiAgentStep", surface: "both", cli: { path: ["multi-agent", "step"], jsonMode: "default" }, mcp: { tool: "cw_multi_agent_step", requiredArgs: ["runId"] } },
  { capability: "multi-agent.blackboard", summary: "Operate on the active multi-agent blackboard.", entry: "hostMultiAgentBlackboard", surface: "both", cli: { path: ["multi-agent", "blackboard"], jsonMode: "default" }, mcp: { tool: "cw_multi_agent_blackboard", requiredArgs: ["runId"] } },
  { capability: "multi-agent.score", summary: "Score a candidate with evidence.", entry: "hostMultiAgentScore", surface: "both", cli: { path: ["multi-agent", "score"], jsonMode: "default" }, mcp: { tool: "cw_multi_agent_score", requiredArgs: ["runId"] } },
  { capability: "multi-agent.select", summary: "Select a candidate with the verifier gate.", entry: "hostMultiAgentSelect", surface: "both", cli: { path: ["multi-agent", "select"], jsonMode: "default" }, mcp: { tool: "cw_multi_agent_select", requiredArgs: ["runId"] } },
  { capability: "multi-agent.summary", summary: "Read the structured multi-agent runtime summary for a run.", entry: "multiAgentSummary", surface: "both", cli: { path: ["multi-agent", "summary"], jsonMode: "flag" }, mcp: { tool: "cw_multi_agent_summary", requiredArgs: ["runId"] } },
  { capability: "multi-agent.summarize", summary: "Read the combined state-explosion report.", entry: "multiAgentSummarize", surface: "both", cli: { path: ["multi-agent", "summarize"], jsonMode: "flag" }, mcp: { tool: "cw_multi_agent_summarize", requiredArgs: ["runId"] } },
  { capability: "multi-agent.graph", summary: "Read the structured multi-agent operator graph for a run.", entry: "multiAgentOperatorGraph", surface: "both", cli: { path: ["multi-agent", "graph"], jsonMode: "flag" }, mcp: { tool: "cw_multi_agent_graph", requiredArgs: ["runId"] } },
  { capability: "multi-agent.graph.compact", summary: "Read a compact/focused multi-agent graph view.", entry: "multiAgentGraphView", surface: "both", cli: { path: ["multi-agent", "graph"], caseTokens: ["multi-agent", "graph"], jsonMode: "flag" }, mcp: { tool: "cw_multi_agent_graph_compact", requiredArgs: ["runId"] } },
  { capability: "multi-agent.dependencies", summary: "Read derived multi-agent dependency edges for operator inspection.", entry: "multiAgentDependencies", surface: "both", cli: { path: ["multi-agent", "dependencies"], jsonMode: "flag" }, mcp: { tool: "cw_multi_agent_dependencies", requiredArgs: ["runId"] } },
  { capability: "multi-agent.failures", summary: "Read failed, blocked, rejected, and ambiguous multi-agent records.", entry: "multiAgentFailures", surface: "both", cli: { path: ["multi-agent", "failures"], jsonMode: "flag" }, mcp: { tool: "cw_multi_agent_failures", requiredArgs: ["runId"] } },
  { capability: "multi-agent.evidence", summary: "Read evidence adoption status from worker output through selection and commit. Each row carries a derived rationaleStatus (explained|unexplained|not-applicable).", entry: "multiAgentEvidence", surface: "both", cli: { path: ["multi-agent", "evidence"], jsonMode: "flag" }, mcp: { tool: "cw_multi_agent_evidence", requiredArgs: ["runId"] } },
  { capability: "multi-agent.reasoning", summary: "Explain why each evidence item was adopted/rejected.", entry: "multiAgentReasoning", surface: "both", cli: { path: ["multi-agent", "reasoning"], jsonMode: "flag" }, mcp: { tool: "cw_evidence_reasoning", requiredArgs: ["runId"] } },
  { capability: "multi-agent.reasoning.refresh", summary: "Refresh the durable evidence-reasoning index.", entry: "multiAgentReasoningRefresh", surface: "both", cli: { path: ["multi-agent", "reasoning"], caseTokens: ["multi-agent", "reasoning"], jsonMode: "default" }, mcp: { tool: "cw_evidence_reasoning_refresh", requiredArgs: ["runId"] } },

  // ---- multi-agent lifecycle records --------------------------------------
  { capability: "multi-agent.run.create", summary: "Create a MultiAgentRun state record.", entry: "createMultiAgentRun", surface: "both", cli: { path: ["multi-agent", "run"], caseTokens: ["multi-agent", "run"], jsonMode: "default" }, mcp: { tool: "cw_multi_agent_run_create", requiredArgs: ["runId"] } },
  { capability: "multi-agent.run.transition", summary: "Transition a MultiAgentRun lifecycle.", entry: "transitionMultiAgentRun", surface: "both", cli: { path: ["multi-agent", "run"], caseTokens: ["multi-agent", "run"], jsonMode: "default" }, mcp: { tool: "cw_multi_agent_run_transition", requiredArgs: ["runId"] } },
  { capability: "multi-agent.run.show", summary: "Show one MultiAgentRun record.", entry: "showMultiAgentRun", surface: "both", cli: { path: ["multi-agent", "show"], jsonMode: "default" }, mcp: { tool: "cw_multi_agent_run_show", requiredArgs: ["runId"] } },
  { capability: "multi-agent.role.create", summary: "Create an AgentRole record.", entry: "createAgentRole", surface: "both", cli: { path: ["multi-agent", "role"], jsonMode: "default" }, mcp: { tool: "cw_multi_agent_role_create", requiredArgs: ["runId"] } },
  { capability: "multi-agent.role.show", summary: "Show one AgentRole record.", entry: "showAgentRole", surface: "both", cli: { path: ["multi-agent", "role"], caseTokens: ["multi-agent", "role"], jsonMode: "default" }, mcp: { tool: "cw_multi_agent_role_show", requiredArgs: ["runId","roleId"] } },
  { capability: "multi-agent.group.create", summary: "Create an AgentGroup record.", entry: "createAgentGroup", surface: "both", cli: { path: ["multi-agent", "group"], jsonMode: "default" }, mcp: { tool: "cw_multi_agent_group_create", requiredArgs: ["runId"] } },
  { capability: "multi-agent.group.show", summary: "Show one AgentGroup record.", entry: "showAgentGroup", surface: "both", cli: { path: ["multi-agent", "group"], caseTokens: ["multi-agent", "group"], jsonMode: "default" }, mcp: { tool: "cw_multi_agent_group_show", requiredArgs: ["runId","groupId"] } },
  { capability: "multi-agent.membership.create", summary: "Create an AgentMembership record.", entry: "assignAgentMembership", surface: "both", cli: { path: ["multi-agent", "membership"], jsonMode: "default" }, mcp: { tool: "cw_multi_agent_membership_create", requiredArgs: ["runId"] } },
  { capability: "multi-agent.membership.show", summary: "Show one AgentMembership record.", entry: "showAgentMembership", surface: "both", cli: { path: ["multi-agent", "membership"], caseTokens: ["multi-agent", "membership"], jsonMode: "default" }, mcp: { tool: "cw_multi_agent_membership_show", requiredArgs: ["runId","membershipId"] } },
  { capability: "multi-agent.fanout.create", summary: "Create an AgentFanout record.", entry: "createAgentFanout", surface: "both", cli: { path: ["multi-agent", "fanout"], jsonMode: "default" }, mcp: { tool: "cw_multi_agent_fanout_create", requiredArgs: ["runId"] } },
  { capability: "multi-agent.fanout.show", summary: "Show one AgentFanout record.", entry: "showAgentFanout", surface: "both", cli: { path: ["multi-agent", "fanout"], caseTokens: ["multi-agent", "fanout"], jsonMode: "default" }, mcp: { tool: "cw_multi_agent_fanout_show", requiredArgs: ["runId","fanoutId"] } },
  { capability: "multi-agent.fanin.collect", summary: "Collect an AgentFanin with evidence coverage.", entry: "collectAgentFanin", surface: "both", cli: { path: ["multi-agent", "fanin"], jsonMode: "default" }, mcp: { tool: "cw_multi_agent_fanin_collect", requiredArgs: ["runId"] } },
  { capability: "multi-agent.fanin.show", summary: "Show one AgentFanin record.", entry: "showAgentFanin", surface: "both", cli: { path: ["multi-agent", "fanin"], caseTokens: ["multi-agent", "fanin"], jsonMode: "default" }, mcp: { tool: "cw_multi_agent_fanin_show", requiredArgs: ["runId","faninId"] } },

  // ---- eval & replay ------------------------------------------------------
  { capability: "eval.snapshot", summary: "Create a deterministic replay snapshot.", entry: "evalSnapshot", surface: "both", cli: { path: ["eval", "snapshot"], jsonMode: "flag" }, mcp: { tool: "cw_eval_snapshot", requiredArgs: ["runId"] } },
  { capability: "eval.replay", summary: "Replay a snapshot without live agents.", entry: "evalReplay", surface: "both", cli: { path: ["eval", "replay"], jsonMode: "flag" }, mcp: { tool: "cw_eval_replay", requiredArgs: ["snapshot|snapshotId|path"] } },
  { capability: "eval.compare", summary: "Compare baseline and replay deterministically.", entry: "evalCompare", surface: "both", cli: { path: ["eval", "compare"], jsonMode: "flag" }, mcp: { tool: "cw_eval_compare", requiredArgs: ["baseline|baselinePath","replay|replayPath"] } },
  { capability: "eval.score", summary: "Score replay quality.", entry: "evalScore", surface: "both", cli: { path: ["eval", "score"], jsonMode: "flag" }, mcp: { tool: "cw_eval_score", requiredArgs: ["replay|replayPath|path"] } },
  { capability: "eval.gate", summary: "Run the eval/replay regression gate.", entry: "evalGate", surface: "both", cli: { path: ["eval", "gate"], jsonMode: "flag" }, mcp: { tool: "cw_eval_gate", requiredArgs: ["suite|suiteId|path"] } },
  { capability: "eval.report", summary: "Render an eval/replay report.", entry: "evalReport", surface: "both", cli: { path: ["eval", "report"], jsonMode: "flag" }, mcp: { tool: "cw_eval_report", requiredArgs: ["replay|replayPath|path"] } },

  // ---- blackboard & coordinator -------------------------------------------
  { capability: "blackboard.summary", summary: "Read the blackboard/coordinator summary.", entry: "blackboardSummary", surface: "both", cli: { path: ["blackboard", "summary"], jsonMode: "default" }, mcp: { tool: "cw_blackboard_summary", requiredArgs: ["runId"] } },
  { capability: "blackboard.summarize", summary: "Read a blackboard digest with conflicts/evidence.", entry: "blackboardSummarize", surface: "both", cli: { path: ["blackboard", "summarize"], jsonMode: "flag" }, mcp: { tool: "cw_blackboard_summarize", requiredArgs: ["runId"] } },
  { capability: "blackboard.graph", summary: "Read blackboard graph nodes and edges.", entry: "blackboardGraph", surface: "both", cli: { path: ["blackboard", "graph"], jsonMode: "default" }, mcp: { tool: "cw_blackboard_graph", requiredArgs: ["runId"] } },
  { capability: "blackboard.resolve", summary: "Create or resolve a run blackboard.", entry: "resolveRunBlackboard", surface: "both", cli: { path: ["blackboard", "resolve"], jsonMode: "default" }, mcp: { tool: "cw_blackboard_resolve", requiredArgs: ["runId"] } },
  { capability: "blackboard.topic.create", summary: "Create a blackboard topic.", entry: "createBlackboardTopic", surface: "both", cli: { path: ["blackboard", "topic", "create"], caseTokens: ["blackboard", "topic"], jsonMode: "default" }, mcp: { tool: "cw_blackboard_topic_create", requiredArgs: ["runId"] } },
  { capability: "blackboard.message.post", summary: "Post a blackboard message.", entry: "postBlackboardMessage", surface: "both", cli: { path: ["blackboard", "message", "post"], caseTokens: ["blackboard", "message"], jsonMode: "default" }, mcp: { tool: "cw_blackboard_message_post", requiredArgs: ["runId"] } },
  { capability: "blackboard.message.list", summary: "List blackboard messages.", entry: "listBlackboardMessages", surface: "both", cli: { path: ["blackboard", "message", "list"], caseTokens: ["blackboard", "message"], jsonMode: "default" }, mcp: { tool: "cw_blackboard_message_list", requiredArgs: ["runId"] } },
  { capability: "blackboard.context.put", summary: "Publish a shared context frame.", entry: "putBlackboardContext", surface: "both", cli: { path: ["blackboard", "context", "put"], caseTokens: ["blackboard", "context"], jsonMode: "default" }, mcp: { tool: "cw_blackboard_context_put", requiredArgs: ["runId"] } },
  { capability: "blackboard.artifact.add", summary: "Index an artifact in the blackboard.", entry: "addBlackboardArtifact", surface: "both", cli: { path: ["blackboard", "artifact", "add"], caseTokens: ["blackboard", "artifact"], jsonMode: "default" }, mcp: { tool: "cw_blackboard_artifact_add", requiredArgs: ["runId"] } },
  { capability: "blackboard.artifact.list", summary: "List blackboard artifact refs.", entry: "listBlackboardArtifacts", surface: "both", cli: { path: ["blackboard", "artifact", "list"], caseTokens: ["blackboard", "artifact"], jsonMode: "default" }, mcp: { tool: "cw_blackboard_artifact_list", requiredArgs: ["runId"] } },
  { capability: "blackboard.snapshot", summary: "Create a durable blackboard snapshot.", entry: "snapshotBlackboard", surface: "both", cli: { path: ["blackboard", "snapshot"], jsonMode: "default" }, mcp: { tool: "cw_blackboard_snapshot", requiredArgs: ["runId"] } },
  { capability: "coordinator.summary", summary: "Read the coordinator summary.", entry: "coordinatorSummary", surface: "both", cli: { path: ["coordinator", "summary"], jsonMode: "default" }, mcp: { tool: "cw_coordinator_summary", requiredArgs: ["runId"] } },
  { capability: "coordinator.decision", summary: "Record a coordinator decision.", entry: "recordCoordinatorDecision", surface: "both", cli: { path: ["coordinator", "decision"], jsonMode: "default" }, mcp: { tool: "cw_coordinator_decision", requiredArgs: ["runId"] } },

  // ---- audit & trust ------------------------------------------------------
  { capability: "audit.summary", summary: "Read the trust/audit summary.", entry: "auditSummary", surface: "both", cli: { path: ["audit", "summary"], jsonMode: "default" }, mcp: { tool: "cw_audit_summary", requiredArgs: ["runId"] } },
  { capability: "audit.verify", summary: "Re-prove a run's trust-audit hash chain (fail-closed exit).", entry: "auditVerify", surface: "both", cli: { path: ["audit", "verify"], jsonMode: "default" }, mcp: { tool: "cw_audit_verify", requiredArgs: ["runId"] } },
  { capability: "audit.worker", summary: "Read trust/audit for one worker.", entry: "workerAudit", surface: "both", cli: { path: ["audit", "worker"], jsonMode: "default" }, mcp: { tool: "cw_audit_worker", requiredArgs: ["runId"] } },
  { capability: "audit.provenance", summary: "Inspect evidence provenance.", entry: "evidenceProvenance", surface: "both", cli: { path: ["audit", "provenance"], jsonMode: "default" }, mcp: { tool: "cw_audit_provenance", requiredArgs: ["runId"] } },
  { capability: "audit.multi-agent", summary: "Read the multi-agent trust/policy/provenance audit.", entry: "auditMultiAgent", surface: "both", cli: { path: ["audit", "multi-agent"], jsonMode: "flag" }, mcp: { tool: "cw_audit_multi_agent", requiredArgs: ["runId"] } },
  { capability: "audit.policy", summary: "Read role policies and permission decisions.", entry: "auditPolicy", surface: "both", cli: { path: ["audit", "policy"], jsonMode: "flag" }, mcp: { tool: "cw_audit_policy", requiredArgs: ["runId"] } },
  { capability: "audit.role", summary: "Read policy/audit for one role.", entry: "auditRole", surface: "both", cli: { path: ["audit", "role"], jsonMode: "flag" }, mcp: { tool: "cw_audit_role", requiredArgs: ["runId"] } },
  { capability: "audit.blackboard", summary: "Read the blackboard write audit.", entry: "auditBlackboard", surface: "both", cli: { path: ["audit", "blackboard"], jsonMode: "flag" }, mcp: { tool: "cw_audit_blackboard", requiredArgs: ["runId"] } },
  { capability: "audit.judge", summary: "Read judge rationale/panel decision audit.", entry: "auditJudge", surface: "both", cli: { path: ["audit", "judge"], jsonMode: "flag" }, mcp: { tool: "cw_audit_judge", requiredArgs: ["runId"] } },
  { capability: "audit.attest", summary: "Record a host/operator sandbox attestation.", entry: "recordAuditAttestation", surface: "both", cli: { path: ["audit", "attest"], jsonMode: "default" }, mcp: { tool: "cw_audit_attest", requiredArgs: ["runId"] } },
  { capability: "audit.decision", summary: "Validate and record a sandbox decision.", entry: "recordAuditDecision", surface: "both", cli: { path: ["audit", "decision"], jsonMode: "default" }, mcp: { tool: "cw_audit_decision", requiredArgs: ["runId"] } },

  // ---- sandbox profiles ---------------------------------------------------
  { capability: "sandbox.list", summary: "List bundled sandbox profiles.", entry: "listSandboxProfiles", surface: "both", cli: { path: ["sandbox", "list"], jsonMode: "default" }, mcp: { tool: "cw_sandbox_list" } },
  { capability: "sandbox.show", summary: "Show a resolved sandbox profile.", entry: "showSandboxProfile", surface: "both", cli: { path: ["sandbox", "show"], jsonMode: "default" }, mcp: { tool: "cw_sandbox_show", requiredArgs: ["profileId"] } },
  { capability: "sandbox.validate", summary: "Validate a sandbox profile JSON file.", entry: "validateSandboxProfile", surface: "both", cli: { path: ["sandbox", "validate"], jsonMode: "default" }, mcp: { tool: "cw_sandbox_validate", requiredArgs: ["profileFile"] } },
  { capability: "sandbox.choose", summary: "Resolve and validate a sandbox profile choice.", entry: "sandboxChoose", surface: "both", cli: { path: ["sandbox", "choose"], jsonMode: "default" }, mcp: { tool: "cw_sandbox_choose" } },
  { capability: "sandbox.resolve", summary: "Alias of sandbox.choose.", entry: "sandboxChoose", surface: "both", cli: { path: ["sandbox", "resolve"], jsonMode: "default" }, mcp: { tool: "cw_sandbox_resolve" } },

  // ---- execution backends (v0.1.29) ---------------------------------------
  { capability: "backend.list", summary: "List available execution backends and their capabilities.", entry: "listBackends", surface: "both", cli: { path: ["backend", "list"], jsonMode: "default" }, mcp: { tool: "cw_backend_list" } },
  { capability: "backend.show", summary: "Show one execution backend descriptor.", entry: "showBackend", surface: "both", cli: { path: ["backend", "show"], jsonMode: "default" }, mcp: { tool: "cw_backend_show" } },
  { capability: "backend.probe", summary: "Probe execution backend readiness (live, deterministic).", entry: "probeBackend", surface: "both", cli: { path: ["backend", "probe"], jsonMode: "default" }, mcp: { tool: "cw_backend_probe" } },

  // ---- agent delegation drive (v0.1.38) -----------------------------------
  { capability: "backend.agent.config.show", summary: "Show the effective agent delegation config (flags>env>file, secret-stripped, host-stable).", entry: "backendAgentConfigShow", surface: "both", cli: { path: ["backend", "agent", "config"], caseTokens: ["backend", "agent"], jsonMode: "default" }, mcp: { tool: "cw_backend_agent_config_show" } },
  { capability: "backend.agent.config.set", summary: "Set the durable agent delegation config (command-template/endpoint/model; API keys never written).", entry: "backendAgentConfigSet", surface: "both", cli: { path: ["backend", "agent", "config"], caseTokens: ["backend", "agent"], jsonMode: "default" }, mcp: { tool: "cw_backend_agent_config_set" }, payloadIdentical: false, reason: "Mutating: persists $CW_HOME/agent-config.json (secret-stripped) before returning the effective config; both surfaces perform the same write — it is a surface-mutating verb, not a read probe." },

  // ---- worker isolation ---------------------------------------------------
  { capability: "worker.list", summary: "List worker isolation scopes.", entry: "listWorkers", surface: "both", cli: { path: ["worker", "list"], jsonMode: "default" }, mcp: { tool: "cw_worker_list", requiredArgs: ["runId"] } },
  { capability: "worker.summary", summary: "Read the structured worker summary for a run.", entry: "summarizeWorkerRecords", surface: "both", cli: { path: ["worker", "summary"], jsonMode: "flag" }, mcp: { tool: "cw_worker_summary", requiredArgs: ["runId"] } },
  { capability: "worker.show", summary: "Show one worker isolation scope.", entry: "showWorker", surface: "both", cli: { path: ["worker", "show"], jsonMode: "default" }, mcp: { tool: "cw_worker_show", requiredArgs: ["runId","workerId"] } },
  { capability: "worker.manifest", summary: "Write and return a worker manifest.", entry: "showWorkerManifest", surface: "both", cli: { path: ["worker", "manifest"], jsonMode: "default" }, mcp: { tool: "cw_worker_manifest", requiredArgs: ["runId"] } },
  { capability: "worker.output", summary: "Record worker output.", entry: "recordWorkerOutput", surface: "both", cli: { path: ["worker", "output"], jsonMode: "default" }, mcp: { tool: "cw_worker_output", requiredArgs: ["runId"] } },
  { capability: "worker.fail", summary: "Record a structured worker failure.", entry: "recordWorkerFailure", surface: "both", cli: { path: ["worker", "fail"], jsonMode: "default" }, mcp: { tool: "cw_worker_fail", requiredArgs: ["runId"] } },
  { capability: "worker.validate", summary: "Validate a worker output boundary.", entry: "validateWorker", surface: "both", cli: { path: ["worker", "validate"], jsonMode: "default" }, mcp: { tool: "cw_worker_validate", requiredArgs: ["runId"] } },

  // ---- candidate scoring & selection --------------------------------------
  { capability: "candidate.list", summary: "List candidates for a run.", entry: "listCandidates", surface: "both", cli: { path: ["candidate", "list"], jsonMode: "default" }, mcp: { tool: "cw_candidate_list", requiredArgs: ["runId"] } },
  { capability: "candidate.show", summary: "Show one candidate.", entry: "showCandidate", surface: "both", cli: { path: ["candidate", "show"], jsonMode: "default" }, mcp: { tool: "cw_candidate_show", requiredArgs: ["runId","candidateId"] } },
  { capability: "candidate.register", summary: "Register a candidate from evidence.", entry: "registerCandidate", surface: "both", cli: { path: ["candidate", "register"], jsonMode: "default" }, mcp: { tool: "cw_candidate_register", requiredArgs: ["runId"] } },
  { capability: "candidate.score", summary: "Score a candidate with criteria/evidence.", entry: "scoreCandidate", surface: "both", cli: { path: ["candidate", "score"], jsonMode: "default" }, mcp: { tool: "cw_candidate_score", requiredArgs: ["runId"] } },
  { capability: "candidate.rank", summary: "Rank candidates with gates.", entry: "rankCandidates", surface: "both", cli: { path: ["candidate", "rank"], jsonMode: "default" }, mcp: { tool: "cw_candidate_rank", requiredArgs: ["runId"] } },
  { capability: "candidate.select", summary: "Select a candidate with the verifier gate.", entry: "selectCandidate", surface: "both", cli: { path: ["candidate", "select"], jsonMode: "default" }, mcp: { tool: "cw_candidate_select", requiredArgs: ["runId"] } },
  { capability: "candidate.reject", summary: "Reject a candidate with a reason.", entry: "rejectCandidate", surface: "both", cli: { path: ["candidate", "reject"], jsonMode: "default" }, mcp: { tool: "cw_candidate_reject", requiredArgs: ["runId"] } },
  { capability: "candidate.summary", summary: "Read the structured candidate summary for a run.", entry: "summarizeCandidateOperatorRecords", surface: "both", cli: { path: ["candidate", "summary"], jsonMode: "flag" }, mcp: { tool: "cw_candidate_summary", requiredArgs: ["runId"] } },

  // ---- feedback -----------------------------------------------------------
  { capability: "feedback.list", summary: "List run feedback records.", entry: "listFeedback", surface: "both", cli: { path: ["feedback", "list"], jsonMode: "default" }, mcp: { tool: "cw_feedback_list", requiredArgs: ["runId"] } },
  { capability: "feedback.show", summary: "Show a run feedback record.", entry: "showFeedback", surface: "both", cli: { path: ["feedback", "show"], jsonMode: "default" }, mcp: { tool: "cw_feedback_show", requiredArgs: ["runId","feedbackId"] } },
  { capability: "feedback.collect", summary: "Collect feedback from failed nodes.", entry: "collectFeedback", surface: "both", cli: { path: ["feedback", "collect"], jsonMode: "default" }, mcp: { tool: "cw_feedback_collect", requiredArgs: ["runId"] } },
  { capability: "feedback.summary", summary: "Read the structured feedback summary for a run.", entry: "summarizeFeedbackRecords", surface: "both", cli: { path: ["feedback", "summary"], jsonMode: "flag" }, mcp: { tool: "cw_feedback_summary", requiredArgs: ["runId"] } },
  { capability: "feedback.task", summary: "Create a correction task for feedback.", entry: "createFeedbackTask", surface: "both", cli: { path: ["feedback", "task"], jsonMode: "default" }, mcp: { tool: "cw_feedback_task", requiredArgs: ["runId"] } },
  { capability: "feedback.resolve", summary: "Resolve or reject feedback.", entry: "resolveFeedback", surface: "both", cli: { path: ["feedback", "resolve"], jsonMode: "default" }, mcp: { tool: "cw_feedback_resolve", requiredArgs: ["runId"] } },

  // ---- scheduling ---------------------------------------------------------
  { capability: "schedule.create", summary: "Create a scheduled CW task.", entry: "scheduler.create", surface: "both", cli: { path: ["schedule", "create"], jsonMode: "default" }, mcp: { tool: "cw_schedule_create" } },
  { capability: "schedule.list", summary: "List scheduled CW tasks.", entry: "scheduler.list", surface: "both", cli: { path: ["schedule", "list"], jsonMode: "default" }, mcp: { tool: "cw_schedule_list" } },
  { capability: "schedule.delete", summary: "Delete a scheduled CW task.", entry: "scheduler.delete", surface: "both", cli: { path: ["schedule", "delete"], jsonMode: "default" }, mcp: { tool: "cw_schedule_delete", requiredArgs: ["id"] } },
  { capability: "schedule.due", summary: "List due scheduled CW tasks.", entry: "scheduler.due", surface: "both", cli: { path: ["schedule", "due"], jsonMode: "default" }, mcp: { tool: "cw_schedule_due" } },
  { capability: "schedule.complete", summary: "Mark a scheduled task complete.", entry: "scheduler.complete", surface: "both", cli: { path: ["schedule", "complete"], jsonMode: "default" }, mcp: { tool: "cw_schedule_complete", requiredArgs: ["id"] } },
  { capability: "schedule.pause", summary: "Pause a scheduled CW task.", entry: "scheduler.pause", surface: "both", cli: { path: ["schedule", "pause"], jsonMode: "default" }, mcp: { tool: "cw_schedule_pause", requiredArgs: ["id"] } },
  { capability: "schedule.resume", summary: "Resume a scheduled CW task.", entry: "scheduler.resume", surface: "both", cli: { path: ["schedule", "resume"], jsonMode: "default" }, mcp: { tool: "cw_schedule_resume", requiredArgs: ["id"] } },
  { capability: "schedule.run-now", summary: "Create an immediate scheduled-task run record.", entry: "scheduler.runNow", surface: "both", cli: { path: ["schedule", "run-now"], jsonMode: "default" }, mcp: { tool: "cw_schedule_run_now", requiredArgs: ["id"] } },
  { capability: "schedule.history", summary: "List scheduled-task run history.", entry: "scheduler.history", surface: "both", cli: { path: ["schedule", "history"], jsonMode: "default" }, mcp: { tool: "cw_schedule_history" } },
  {
    capability: "schedule.daemon",
    summary: "Run the desktop scheduler daemon loop.",
    entry: "DesktopSchedulerDaemon.run",
    surface: "cli-only",
    cli: { path: ["schedule", "daemon"], jsonMode: "human" },
    reason: "Long-running desktop daemon process, not a request/response tool. MCP hosts drive ticks via cw_schedule_due + cw_schedule_run_now."
  },

  // ---- routines / triggers ------------------------------------------------
  { capability: "routine.create", summary: "Create a routine-style API/GitHub trigger.", entry: "triggers.create", surface: "both", cli: { path: ["routine", "create"], jsonMode: "default" }, mcp: { tool: "cw_routine_create" } },
  { capability: "routine.list", summary: "List routine-style triggers.", entry: "triggers.list", surface: "both", cli: { path: ["routine", "list"], jsonMode: "default" }, mcp: { tool: "cw_routine_list" } },
  { capability: "routine.delete", summary: "Delete a routine-style trigger.", entry: "triggers.delete", surface: "both", cli: { path: ["routine", "delete"], jsonMode: "default" }, mcp: { tool: "cw_routine_delete", requiredArgs: ["id"] } },
  { capability: "routine.fire", summary: "Record an API/GitHub trigger event.", entry: "triggers.fire", surface: "both", cli: { path: ["routine", "fire"], jsonMode: "default" }, mcp: { tool: "cw_routine_fire", requiredArgs: ["kind"] } },
  { capability: "routine.events", summary: "List routine trigger events.", entry: "triggers.events", surface: "both", cli: { path: ["routine", "events"], jsonMode: "default" }, mcp: { tool: "cw_routine_events" } },

  // ---- run registry / control plane (v0.1.28) -----------------------------
  // A derived, fingerprinted, fail-closed index over `.cw/runs/<id>/state.json`
  // across repos. Every verb is declared once here so the CLI and MCP surfaces
  // are two renderings of one source and pass the parity gate. `cw <cmd> --json`
  // is schema-identical to `cw_<tool>`; the per-run state.json remains the truth.
  { capability: "registry.refresh", summary: "Recompute and persist the derived run registry index.", entry: "runRegistry.refresh", surface: "both", cli: { path: ["registry", "refresh"], jsonMode: "flag" }, mcp: { tool: "cw_registry_refresh" } },
  { capability: "registry.show", summary: "Read the run registry index with valid|stale|absent freshness.", entry: "runRegistry.show", surface: "both", cli: { path: ["registry", "show"], jsonMode: "flag" }, mcp: { tool: "cw_registry_show" } },
  { capability: "run.search", summary: "Search runs by app/status/time/repo/free-text, deterministic + paginated.", entry: "runRegistry.search", surface: "both", cli: { path: ["run", "search"], jsonMode: "flag" }, mcp: { tool: "cw_run_search" } },
  { capability: "run.list", summary: "List indexed runs across repos (search with no filters).", entry: "runRegistry.list", surface: "both", cli: { path: ["run", "list"], jsonMode: "flag" }, mcp: { tool: "cw_run_list" } },
  { capability: "run.show", summary: "Resolve one run by id across the registry; fail closed on missing source.", entry: "runRegistry.showRun", surface: "both", cli: { path: ["run", "show"], jsonMode: "flag" }, mcp: { tool: "cw_run_show", requiredArgs: ["runId"] } },
  { capability: "run.resume", summary: "Resolve a run by id and return its next runnable tasks/actions (read-only by default; the opt-in --drive/--once mode hands it to the shared agent-drive core, which mutates and is covered by run.drive.step).", entry: "runRegistry.resume", surface: "both", cli: { path: ["run", "resume"], jsonMode: "flag" }, mcp: { tool: "cw_run_resume", requiredArgs: ["runId"] } },
  { capability: "run.archive", summary: "Archive/unarchive a run (overlay mark; never deletes source).", entry: "runRegistry.archive", surface: "both", cli: { path: ["run", "archive"], jsonMode: "default" }, mcp: { tool: "cw_run_archive", requiredArgs: ["runId|olderThanDays"] } },
  { capability: "run.rerun", summary: "Re-run a failed run as a NEW run linked to the original by provenance.", entry: "runRegistry.rerun", surface: "both", cli: { path: ["run", "rerun"], jsonMode: "default" }, mcp: { tool: "cw_run_rerun", requiredArgs: ["runId"] } },
  { capability: "run.export", summary: "Export a run to a portable archive with run-local files and digest integrity.", entry: "runExportArchive", surface: "both", cli: { path: ["run", "export"], jsonMode: "default" }, mcp: { tool: "cw_run_export", requiredArgs: ["runId"] } },
  { capability: "run.import", summary: "Restore a portable run archive into a target repo and verify restored file digests.", entry: "runImportArchive", surface: "both", cli: { path: ["run", "import"], jsonMode: "default" }, mcp: { tool: "cw_run_import", requiredArgs: ["archive|path|file"] } },
  { capability: "run.verify-import", summary: "Verify an imported run against its restore manifest and telemetry chain.", entry: "runVerifyImport", surface: "both", cli: { path: ["run", "verify-import"], jsonMode: "default" }, mcp: { tool: "cw_run_verify_import", requiredArgs: ["runId"] } },
  { capability: "run.inspect-archive", summary: "Read-only integrity inspection of a portable run archive without importing it.", entry: "runInspectArchive", surface: "both", cli: { path: ["run", "inspect-archive"], jsonMode: "default" }, mcp: { tool: "cw_run_inspect_archive", requiredArgs: ["archive|path|file"] } },
  { capability: "run.restore", summary: "Fail-closed restore of a portable run archive: integrity-inspect, import, and verify in one step; refuses anything that does not verify.", entry: "runRestoreArchive", surface: "both", cli: { path: ["run", "restore"], jsonMode: "default" }, mcp: { tool: "cw_run_restore", requiredArgs: ["archive|path|file"] } },
  { capability: "report.verify-bundle", summary: "Offline self-contained verify of a portable run bundle: archive bytes + telemetry chain + trust-audit chain + embedded-key signatures.", entry: "runVerifyReportBundle", surface: "both", cli: { path: ["report", "verify-bundle"], caseTokens: ["report"], jsonMode: "default" }, mcp: { tool: "cw_report_verify_bundle", requiredArgs: ["archive|path|file|bundle"] } },
  { capability: "report.bundle", summary: "Produce-and-prove: export a run to a portable bundle sealed with the trust key, then self-verify it offline (fail-closed) so the producer knows it is verifiable before shipping.", entry: "reportBundle", surface: "both", cli: { path: ["report", "bundle"], caseTokens: ["report"], jsonMode: "default" }, mcp: { tool: "cw_report_bundle", requiredArgs: ["runId"] } },
  { capability: "run.drive", summary: "Preview the next agent-delegation drive step for a run (read-only, deterministic).", entry: "runDrivePreview", surface: "both", cli: { path: ["run", "drive"], caseTokens: ["run", "drive"], jsonMode: "default" }, mcp: { tool: "cw_run_drive" } },
  { capability: "run.drive.step", summary: "Drive a run by delegating each worker to the agent backend (plan->dispatch->fulfill->accept->commit; --once for one step).", entry: "runDrive", surface: "both", cli: { path: ["run", "drive"], caseTokens: ["run", "drive"], jsonMode: "default" }, mcp: { tool: "cw_run_drive_step" }, payloadIdentical: false, reason: "Mutating: advances the run by spawning the external agent per worker and recording attested output — not a read probe. CLI (--drive/--step) and MCP route through the same drive() core." },
  {
    capability: "quickstart",
    summary: "ONE-COMMAND quickstart: --check preflights without writes; otherwise plan(app, default architecture-review) -> run --drive -> report in a single invocation (--preview for a read-only dry run; --bundle [--with-trust-key K] seals a completed run into a self-verified portable bundle).",
    entry: "quickstart",
    surface: "cli-only",
    cli: { path: ["quickstart"], caseTokens: ["quickstart", "audit-run"], jsonMode: "default" },
    reason: "CLI UX convenience layer (newcomer first value in one command) over the existing run.drive.step + report verbs; it spawns nothing new and delegates worker execution to the operator's agent backend. MCP hosts compose the same outcome from cw_run_drive_step + cw_report (+ cw_report_bundle for --bundle). `audit-run` is a CLI-only alias of the same wrapper."
  },
  { capability: "queue.add", summary: "Enqueue a pending/planned run with explicit ordering policy.", entry: "runRegistry.queueAdd", surface: "both", cli: { path: ["queue", "add"], jsonMode: "default" }, mcp: { tool: "cw_queue_add" } },
  { capability: "queue.list", summary: "List the durable run queue in policy order.", entry: "runRegistry.queueList", surface: "both", cli: { path: ["queue", "list"], jsonMode: "flag" }, mcp: { tool: "cw_queue_list" } },
  { capability: "queue.drain", summary: "Mark the next ready queue entries drained (the host still executes).", entry: "runRegistry.queueDrain", surface: "both", cli: { path: ["queue", "drain"], jsonMode: "default" }, mcp: { tool: "cw_queue_drain" } },
  { capability: "queue.show", summary: "Show one durable queue entry.", entry: "runRegistry.queueShow", surface: "both", cli: { path: ["queue", "show"], jsonMode: "default" }, mcp: { tool: "cw_queue_show", requiredArgs: ["id"] } },

  // ---- control-plane scheduling (v0.1.37) ---------------------------------
  { capability: "sched.plan", summary: "Read-only control-plane lease plan for the queue+policy+now.", entry: "schedPlan", surface: "both", cli: { path: ["sched", "plan"], caseTokens: ["sched", "plan"], jsonMode: "default" }, mcp: { tool: "cw_sched_plan" } },
  { capability: "sched.lease", summary: "Claim eligible queue entries as leases (concurrency-bounded).", entry: "schedLease", surface: "both", cli: { path: ["sched", "lease"], caseTokens: ["sched", "lease"], jsonMode: "default" }, mcp: { tool: "cw_sched_lease" } },
  { capability: "sched.release", summary: "Release a held lease (failed -> retry/backoff or park).", entry: "schedRelease", surface: "both", cli: { path: ["sched", "release"], caseTokens: ["sched", "release"], jsonMode: "default" }, mcp: { tool: "cw_sched_release" } },
  { capability: "sched.complete", summary: "Complete a held lease (terminal success).", entry: "schedComplete", surface: "both", cli: { path: ["sched", "complete"], caseTokens: ["sched", "complete"], jsonMode: "default" }, mcp: { tool: "cw_sched_complete" } },
  { capability: "sched.reclaim", summary: "Reclaim expired leases (each counts a failed attempt).", entry: "schedReclaim", surface: "both", cli: { path: ["sched", "reclaim"], caseTokens: ["sched", "reclaim"], jsonMode: "default" }, mcp: { tool: "cw_sched_reclaim" } },
  { capability: "sched.reset", summary: "Reset a parked entry to ready (operator recovery).", entry: "schedReset", surface: "both", cli: { path: ["sched", "reset"], caseTokens: ["sched", "reset"], jsonMode: "default" }, mcp: { tool: "cw_sched_reset" } },
  { capability: "sched.policy.show", summary: "Show the scheduling policy (file or default).", entry: "schedPolicyShow", surface: "both", cli: { path: ["sched", "policy"], caseTokens: ["sched", "policy"], jsonMode: "default" }, mcp: { tool: "cw_sched_policy_show" } },
  { capability: "sched.policy.set", summary: "Set scheduling policy fields (concurrency/attempts/backoff/TTL).", entry: "schedPolicySet", surface: "both", cli: { path: ["sched", "policy"], caseTokens: ["sched", "policy"], jsonMode: "default" }, mcp: { tool: "cw_sched_policy_set" } },

  // ---- run retention & provable reclamation (v0.1.39) ---------------------
  // Tiered, append-only, cryptographically-verifiable run reclamation. `plan` and
  // `verify` are read-only + deterministic (only generatedAt is now-derived ISO);
  // `run` is the disk-freeing tier. All three route through the single core.
  { capability: "gc.plan", summary: "Dry-run plan of run reclamation (per-kind bytes + capability downgrade); frees nothing.", entry: "gcPlan", surface: "both", cli: { path: ["gc", "plan"], caseTokens: ["gc", "plan"], jsonMode: "flag" }, mcp: { tool: "cw_gc_plan" } },
  { capability: "gc.run", summary: "Execute the write-ahead reclamation transaction (skeleton -> tombstone -> fsync -> free).", entry: "gcRun", surface: "both", cli: { path: ["gc", "run"], caseTokens: ["gc", "run"], jsonMode: "flag" }, mcp: { tool: "cw_gc_run" }, payloadIdentical: false, reason: "Mutating: frees disk and appends a tombstone; both surfaces perform the identical transaction but the payload reports now-derived bytesFreed/tombstone." },
  { capability: "gc.verify", summary: "Re-prove a reclaimed run: skeleton-complete, tombstone chain untampered, artifacts reconstructable.", entry: "gcVerify", surface: "both", cli: { path: ["gc", "verify"], caseTokens: ["gc", "verify"], jsonMode: "flag" }, mcp: { tool: "cw_gc_verify", requiredArgs: ["runId"] } },
  { capability: "clones.list", summary: "List the cached remote-source checkouts that --link/URL reviews populate (origin URL, kind, commit, age, bytes). Read-only.", entry: "listClones", surface: "both", cli: { path: ["clones", "list"], caseTokens: ["clones", "list"], jsonMode: "flag" }, mcp: { tool: "cw_clones_list" } },
  { capability: "clones.gc", summary: "Reclaim cached remote-source checkouts: a TTL sweep (--older-than-days, default 30) or --all. Deletes only inside the clones cache.", entry: "gcClones", surface: "both", cli: { path: ["clones", "gc"], caseTokens: ["clones", "gc"], jsonMode: "flag" }, mcp: { tool: "cw_clones_gc" }, payloadIdentical: false, reason: "Mutating: removes cache directories and reports now-derived freedBytes/removed; both surfaces perform the identical reclamation." },
  { capability: "telemetry.verify", summary: "Re-prove a run's telemetry attestation ledger offline: chain linkage + independent hash recompute, and (with --pubkey / CW_AGENT_ATTEST_PUBKEY) re-verify each attested hop's ed25519 signature against the public key.", entry: "telemetryVerify", surface: "both", cli: { path: ["telemetry", "verify"], caseTokens: ["telemetry"], jsonMode: "flag" }, mcp: { tool: "cw_telemetry_verify", requiredArgs: ["runId"] } },
  { capability: "demo.tamper", summary: "Prove tamper-evidence: build a signed telemetry ledger, forge it, watch verification fail offline.", entry: "demoTamper", surface: "cli-only", cli: { path: ["demo", "tamper"], caseTokens: ["demo", "tamper"], jsonMode: "flag" }, reason: "Human-facing demonstration (operator/newcomer onboarding); the underlying integrity check is exposed programmatically as the both-surface telemetry.verify. No agent or MCP client needs to invoke a demo." },
  { capability: "demo.bundle", summary: "Prove portable-bundle verification: export a sealed report bundle, forge it two ways, watch report verify-bundle catch both offline with only the embedded public key.", entry: "demoBundle", surface: "cli-only", cli: { path: ["demo", "bundle"], caseTokens: ["demo", "bundle"], jsonMode: "flag" }, reason: "Human-facing demonstration (operator/newcomer onboarding); the underlying integrity check is exposed programmatically as the both-surface report.verify-bundle. No agent or MCP client needs to invoke a demo." },
  { capability: "history", summary: "Read a cross-repo unified run timeline (newest first).", entry: "runRegistry.history", surface: "both", cli: { path: ["history"], jsonMode: "flag" }, mcp: { tool: "cw_history" } },

  // ---- web / desktop workbench (v0.1.30) ----------------------------------
  // A THIRD FRONT DOOR — a read-only renderer, not a new brain. Both verbs route
  // through the single core in src/workbench.ts; each panel of `workbench.view`
  // embeds, verbatim, the canonical `--json` payload of an already-declared
  // capability (graph/blackboard/worker/candidate/audit), so the Workbench can
  // show nothing the CLI/MCP cannot. It holds zero authoritative state.
  { capability: "workbench.view", summary: "Read the read-only five-panel Workbench view of one run (graph, blackboard, worker, candidate, audit).", entry: "buildWorkbenchRunView", surface: "both", cli: { path: ["workbench", "view"], jsonMode: "flag" }, mcp: { tool: "cw_workbench_view", requiredArgs: ["runId"] } },
  { capability: "workbench.serve", summary: "Describe/serve the optional localhost-only, read-only Workbench host.", entry: "buildWorkbenchServeDescriptor", surface: "both", cli: { path: ["workbench", "serve"], jsonMode: "flag" }, mcp: { tool: "cw_workbench_serve" },
    payloadIdentical: false,
    reason:
      "Both surfaces route through the single core entry buildWorkbenchServeDescriptor and return the IDENTICAL serve descriptor under `cw workbench serve --json`/`--once` and `cw_workbench_serve`. They diverge only in side effect, not payload: the CLI's default `cw workbench serve` (no --once) additionally STARTS the blocking localhost host (like `schedule daemon`), which an MCP stdio host cannot do, so cw_workbench_serve only ever returns the descriptor. Declared divergence, not drift." },

  // ---- observability + cost accounting (v0.1.31) --------------------------
  // DERIVED metrics + ATTESTED cost over existing durable state — no metrics db,
  // no collector daemon, no hidden counter. Per-run `metrics.show` and cross-repo
  // `metrics.summary` are two renderings of ONE core (src/observability.ts):
  // `cw <cmd> --json` is byte-identical to the MCP tool (durations come from
  // recorded timestamps, only the ISO `generatedAt` is now-derived), and the
  // v0.1.30 Workbench metrics panel embeds the same payload read-only.
  { capability: "metrics.show", summary: "Read the derived per-run observability + attested-cost report (durations, failure/verifier/acceptance rates with sample counts, attested usage, cost, coverage).", entry: "metricsShow", surface: "both", cli: { path: ["metrics", "show"], jsonMode: "flag" }, mcp: { tool: "cw_metrics_show", requiredArgs: ["runId"] } },
  { capability: "metrics.summary", summary: "Read the cross-repo observability + cost rollup over the v0.1.28 run registry, with per-app and per-backend breakdowns.", entry: "metricsSummary", surface: "both", cli: { path: ["metrics", "summary"], jsonMode: "flag" }, mcp: { tool: "cw_metrics_summary" } },

  // ---- team collaboration (v0.1.32) ---------------------------------------
  // The human-decision layer: append-only, host-ATTESTED (never authenticated)
  // approvals/comments/handoffs provenance-linked to a durable target, plus a
  // review-gate POLICY that STACKS ON the verifier gate. Each verb routes through
  // ONE orchestrator method, so `cw <cmd> --json` is identical to `cw_<tool>`.
  // Mutating verbs (approve/reject/comment add/handoff/review policy) are
  // both-surface and payload-identical but excluded from the read-only payload
  // probe; the read-only review status / comment list ARE probed.
  { capability: "approve", summary: "Append a host-attested approval of a candidate/commit/selection.", entry: "collaborationApprove", surface: "both", cli: { path: ["approve"], jsonMode: "default" }, mcp: { tool: "cw_approve", requiredArgs: ["runId","targetKind|kind","targetId|target"] } },
  { capability: "reject", summary: "Append a host-attested rejection (blocking veto) of a candidate/commit/selection.", entry: "collaborationReject", surface: "both", cli: { path: ["reject"], jsonMode: "default" }, mcp: { tool: "cw_reject", requiredArgs: ["runId","targetKind|kind","targetId|target"] } },
  { capability: "comment.add", summary: "Append a comment to a durable target.", entry: "collaborationComment", surface: "both", cli: { path: ["comment", "add"], caseTokens: ["comment"], jsonMode: "default" }, mcp: { tool: "cw_comment_add", requiredArgs: ["runId","targetKind|kind","targetId|target","body|message|text"] } },
  { capability: "comment.list", summary: "List append-only comments for a run (optionally one target).", entry: "collaborationCommentList", surface: "both", cli: { path: ["comment", "list"], caseTokens: ["comment"], jsonMode: "flag" }, mcp: { tool: "cw_comment_list", requiredArgs: ["runId"] } },
  { capability: "handoff", summary: "Record an ownership transfer (from-actor → to-actor) of a run/task.", entry: "collaborationHandoff", surface: "both", cli: { path: ["handoff"], jsonMode: "default" }, mcp: { tool: "cw_handoff", requiredArgs: ["runId","targetKind|kind","targetId|target","to|toActor"] } },
  { capability: "review.status", summary: "Read the derived per-target review state + collaboration timeline for a run.", entry: "reviewStatus", surface: "both", cli: { path: ["review", "status"], caseTokens: ["review"], jsonMode: "flag" }, mcp: { tool: "cw_review_status", requiredArgs: ["runId"] } },
  { capability: "review.policy", summary: "Set the run's review-gate policy (required approvals, authorized roles, self-approval rule).", entry: "reviewPolicy", surface: "both", cli: { path: ["review", "policy"], caseTokens: ["review"], jsonMode: "default" }, mcp: { tool: "cw_review_policy", requiredArgs: ["runId"] } },

  // ---- Cross-agent handoff ledger (stage 2, MCP surface + git transport) --
  { capability: "ledger.propose", summary: "Build a verifiable cross-agent change proposal entry (printed as JSON).", entry: "buildLedgerProposal", surface: "both", cli: { path: ["ledger", "propose"], caseTokens: ["ledger", "propose"], jsonMode: "default" }, mcp: { tool: "cw_ledger_propose", requiredArgs: ["from", "to", "title", "rationale"] }, payloadIdentical: false, reason: "Mints a fresh entry each call: createdAt is the wall-clock instant and the id/digest are derived from it, so the output is inherently non-deterministic and a byte-identity probe does not apply. Both surfaces call the same buildLedgerProposal core; round-trip + fail-closed behavior is covered by ledger-verify-smoke." },
  { capability: "ledger.review", summary: "Build a verifiable cross-agent review verdict entry (printed as JSON).", entry: "buildLedgerReview", surface: "both", cli: { path: ["ledger", "review"], caseTokens: ["ledger", "review"], jsonMode: "default" }, mcp: { tool: "cw_ledger_review", requiredArgs: ["from", "to", "target", "verdict"] }, payloadIdentical: false, reason: "Mints a fresh timestamped/digested verdict each call — non-deterministic output, same reasoning as ledger.propose. Both surfaces call the same buildLedgerReview core." },
  { capability: "ledger.verify", summary: "Verify a ledger entry against its content digest (fail-closed on tampering).", entry: "verifyLedgerEntry", surface: "both", cli: { path: ["ledger", "verify"], caseTokens: ["ledger", "verify"], jsonMode: "default" }, mcp: { tool: "cw_ledger_verify", requiredArgs: ["entry"] }, payloadIdentical: false, reason: "The entry arrives by --file/stdin on the CLI and as an `entry` argument over MCP; there is no shared arg-bag the byte-identity probe can feed both. Both surfaces call the same verifyLedgerEntry core; ledger-verify-smoke proves the fail-closed contract." },
  { capability: "ledger.apply", summary: "Verify a proposal entry and return its suggestedDiff for `git apply` (fail-closed: no diff unless the entry verifies as a proposal).", entry: "applyLedgerProposal", surface: "both", cli: { path: ["ledger", "apply"], caseTokens: ["ledger", "apply"], jsonMode: "default" }, mcp: { tool: "cw_ledger_apply", requiredArgs: ["entry"] }, payloadIdentical: false, reason: "The entry arrives by --file/stdin on the CLI and as an `entry` argument over MCP; there is no shared arg-bag the byte-identity probe can feed both. Both surfaces call the same applyLedgerProposal core (a fail-closed wrapper over verifyLedgerEntry); ledger-apply-smoke proves the diff only escapes a verified proposal." },
  { capability: "ledger.list", summary: "Read + verify every entry in one or more shared ledger directories (fail-closed inbox; 2+ dirs union-verify mirrors).", entry: "listLedgerEntries", surface: "both", cli: { path: ["ledger", "list"], caseTokens: ["ledger", "list"], jsonMode: "default" }, mcp: { tool: "cw_ledger_list", requiredArgs: ["dir|dirs"] }, payloadIdentical: false, reason: "Output depends on the on-disk contents of the named ledger directory/directories, which the generic payload probe does not populate. Both surfaces call the same listLedgerEntries/unionLedgerEntries core; ledger-verify-smoke covers the fail-closed inbox and the multi-mirror union." }
];

/** The capability registry — the single source of truth, deduplicated by
 *  capability id (last declaration wins). Derived directly from the table above:
 *  there is no load-order-sensitive registration step, so nothing can be a
 *  silently-dead duplicate the way the old snapshot-then-register design allowed. */
export const CAPABILITY_REGISTRY: readonly CapabilityDescriptor[] = Array.from(
  new Map(BUILTIN_CAPABILITIES.map((cap) => [cap.capability, cap])).values()
);

// ---------------------------------------------------------------------------
// Payload probe classification.
// ---------------------------------------------------------------------------

const GLOBAL_PAYLOAD_PROBE_CAPABILITIES = [
  "list",
  "app.list",
  "topology.list",
  "sandbox.list",
  "backend.list",
  "backend.agent.config.show",
  "metrics.summary"
];

const RUN_PAYLOAD_PROBE_CAPABILITIES = [
  "status",
  "operator.status",
  "operator.report",
  "graph",
  "report",
  "next",
  "state.check",
  "contract.show",
  "node.list",
  "node.graph",
  "worker.summary",
  "candidate.summary",
  "feedback.summary",
  "commit.summary",
  "audit.summary",
  "multi-agent.summary",
  "workbench.view",
  "metrics.show",
  "review.status",
  "comment.list",
  "run.drive",
  "gc.plan",
  "gc.verify"
];

const SCENARIO_PAYLOAD_PROBE_CAPABILITIES = [
  "plan",
  "app.show",
  "app.validate",
  "app.package",
  "topology.show",
  "topology.validate",
  "topology.apply",
  "topology.summary",
  "topology.graph",
  "summary.refresh",
  "summary.show",
  "sandbox.show",
  "sandbox.validate",
  "sandbox.choose",
  "sandbox.resolve",
  "approve",
  "reject",
  "comment.add",
  "handoff",
  "review.policy",
  "worker.list",
  "worker.show",
  "worker.manifest",
  "worker.output",
  "worker.fail",
  "worker.validate",
  "candidate.list",
  "candidate.show",
  "candidate.register",
  "candidate.score",
  "candidate.rank",
  "candidate.select",
  "candidate.reject",
  "feedback.list",
  "feedback.show",
  "feedback.collect",
  "feedback.task",
  "feedback.resolve",
  "node.show",
  "node.snapshot",
  "node.diff",
  "node.replay",
  "node.replay.verify"
];

const PAYLOAD_PROBE_DEFERRED_GROUPS: Array<{ reason: string; capabilities: string[] }> = [
  {
    reason:
      "Not safe for the deterministic bootstrap parity probe yet: this capability needs extra target ids/files, mutates durable state, depends on external state, or needs a dedicated fixture beyond cwd/runId.",
    capabilities: [
      "init",
      "dispatch",
      "result",
      // clones.list is payload-identical by construction (both surfaces call listClones), but it
      // reads the external filesystem clone cache (absolute paths + per-entry bytes/timestamps),
      // so it is not byte-probed by the deterministic bootstrap.
      "clones.list",
      "app.init",
      "app.run",
      "migration.list",
      "migration.check",
      "migration.prove",
      "multi-agent.run",
      "multi-agent.status",
      "multi-agent.step",
      "multi-agent.blackboard",
      "multi-agent.score",
      "multi-agent.select",
      "multi-agent.summarize",
      "multi-agent.graph",
      "multi-agent.graph.compact",
      "multi-agent.dependencies",
      "multi-agent.failures",
      "multi-agent.evidence",
      "multi-agent.reasoning",
      "multi-agent.reasoning.refresh",
      "multi-agent.run.create",
      "multi-agent.run.transition",
      "multi-agent.run.show",
      "multi-agent.role.create",
      "multi-agent.role.show",
      "multi-agent.group.create",
      "multi-agent.group.show",
      "multi-agent.membership.create",
      "multi-agent.membership.show",
      "multi-agent.fanout.create",
      "multi-agent.fanout.show",
      "multi-agent.fanin.collect",
      "multi-agent.fanin.show",
      "eval.snapshot",
      "eval.replay",
      "eval.compare",
      "eval.score",
      "eval.gate",
      "eval.report",
      "blackboard.summary",
      "blackboard.summarize",
      "blackboard.graph",
      "blackboard.resolve",
      "blackboard.topic.create",
      "blackboard.message.post",
      "blackboard.message.list",
      "blackboard.context.put",
      "blackboard.artifact.add",
      "blackboard.artifact.list",
      "blackboard.snapshot",
      "coordinator.summary",
      "coordinator.decision",
      "audit.verify",
      "audit.worker",
      "audit.provenance",
      "audit.multi-agent",
      "audit.policy",
      "audit.role",
      "audit.blackboard",
      "audit.judge",
      "audit.attest",
      "audit.decision",
      "backend.show",
      "backend.probe",
      "schedule.create",
      "schedule.list",
      "schedule.delete",
      "schedule.due",
      "schedule.complete",
      "schedule.pause",
      "schedule.resume",
      "schedule.run-now",
      "schedule.history",
      "routine.create",
      "routine.list",
      "routine.delete",
      "routine.fire",
      "routine.events",
      "registry.refresh",
      "registry.show",
      "run.search",
      "run.list",
      "run.show",
      "run.resume",
      "run.archive",
      "run.rerun",
      "run.export",
      "run.import",
      "run.verify-import",
      "run.inspect-archive",
      "run.restore",
      "report.verify-bundle",
      "report.bundle",
      "queue.add",
      "queue.list",
      "queue.drain",
      "queue.show",
      "sched.plan",
      "sched.lease",
      "sched.release",
      "sched.complete",
      "sched.reclaim",
      "sched.reset",
      "sched.policy.show",
      "sched.policy.set",
      "telemetry.verify",
      "history"
    ]
  }
];

// ---------------------------------------------------------------------------
// Derivations + the fail-closed parity report builder.
// ---------------------------------------------------------------------------

/** The MCP tool names this registry declares. */
export function declaredMcpTools(): string[] {
  return CAPABILITY_REGISTRY.filter((cap) => cap.mcp).map((cap) => cap.mcp!.tool);
}

/** The descriptor for a registry-declared MCP tool name. */
export function mcpCapabilityForTool(tool: string): CapabilityDescriptor | undefined {
  return CAPABILITY_REGISTRY.find((capability) => capability.mcp?.tool === tool);
}

/** The descriptor for a registry-declared capability id. */
export function mcpCapabilityForId(capabilityId: string): CapabilityDescriptor | undefined {
  const descriptor = CAPABILITY_REGISTRY.find((capability) => capability.capability === capabilityId);
  return descriptor?.mcp ? descriptor : undefined;
}

/** Required MCP argument groups for a registry-declared tool. */
export function mcpRequiredArgsForTool(tool: string): string[] {
  return mcpCapabilityForTool(tool)?.mcp?.requiredArgs ?? [];
}

/** Build the public tools/list entry for a registry-declared capability. */
export function mcpToolDefinition(capabilityId: string, properties: Record<string, unknown>): McpToolDefinition;
export function mcpToolDefinition(capabilityId: string, description: string, properties: Record<string, unknown>): McpToolDefinition;
export function mcpToolDefinition(
  capabilityId: string,
  descriptionOrProperties: string | Record<string, unknown>,
  maybeProperties?: Record<string, unknown>
): McpToolDefinition {
  const descriptor = mcpCapabilityForId(capabilityId);
  if (!descriptor?.mcp) throw new Error(`MCP capability not declared: ${capabilityId}`);
  const description = typeof descriptionOrProperties === "string" ? descriptionOrProperties : descriptor.summary;
  const properties = typeof descriptionOrProperties === "string" ? maybeProperties : descriptionOrProperties;
  if (!properties) throw new Error(`MCP capability ${capabilityId} missing input schema properties.`);
  return {
    name: descriptor.mcp.tool,
    description,
    inputSchema: {
      type: "object",
      properties,
      additionalProperties: true
    }
  };
}

/** The CLI `case` tokens this registry declares (deduped). */
export function declaredCliTokens(): string[] {
  const tokens = new Set<string>();
  for (const cap of CAPABILITY_REGISTRY) {
    if (!cap.cli) continue;
    for (const token of cap.cli.caseTokens ?? cap.cli.path) tokens.add(token);
  }
  return [...tokens].sort();
}

/** The top-level CLI commands that should be visible in `cw help`. Subcommands
 *  are intentionally collapsed to their first token; aliases such as audit-run
 *  stay visible. */
export function declaredCliHelpTokens(): string[] {
  const tokens = new Set<string>();
  for (const cap of CAPABILITY_REGISTRY) {
    if (!cap.cli) continue;
    const subcommandTokens = new Set(cap.cli.path.slice(1));
    tokens.add(cap.cli.path[0]);
    for (const token of cap.cli.caseTokens || []) {
      if (!subcommandTokens.has(token)) tokens.add(token);
    }
  }
  tokens.delete("help");
  return [...tokens].sort();
}

/** Whether a descriptor MUST carry a reason (surface-specific or divergent). */
export function requiresReason(cap: CapabilityDescriptor): boolean {
  if (cap.surface !== "both") return true;
  if (cap.payloadIdentical === false) return true;
  return false;
}

/**
 * Whether a `surface:"both"` capability is DOCUMENTED out of the payload-identity
 * probe. The probe defaults capabilities IN (every both-surface, dual-bound verb —
 * including write/complex-arg verbs) and requires an EXPLICIT, REASONED opt-out to
 * fall out of scope. A capability escapes the probe only when it carries BOTH
 * `payloadIdentical: false` AND a non-empty `reason`. A bare `payloadIdentical:
 * false` with no recorded reason does NOT silently escape — it stays in the probe
 * set so the undocumented divergence trips the gate (FAIL CLOSED). This mirrors the
 * `requiresReason`/`reasonlessExceptions` gate, but enforces it at the probe-scope
 * boundary too, so the marshalling-drift surface cannot be narrowed without a paper
 * trail.
 */
export function isPayloadProbeOptOut(cap: CapabilityDescriptor): boolean {
  return cap.payloadIdentical === false && !!(cap.reason && cap.reason.trim());
}

/** Descriptors for the payload-identity probe. Defaults to EVERY both-surface,
 *  dual-bound capability (read OR write); a capability is excluded only by a
 *  documented opt-out (`payloadIdentical: false` + a non-empty `reason`) — see
 *  `isPayloadProbeOptOut`. Fail-closed: an undocumented `payloadIdentical: false`
 *  stays in scope so its divergence is caught, not silently excused. */
export function payloadIdenticalCapabilities(): CapabilityDescriptor[] {
  return CAPABILITY_REGISTRY.filter(
    (cap) => cap.surface === "both" && cap.cli && cap.mcp && !isPayloadProbeOptOut(cap)
  );
}

export function payloadProbeTargets(): PayloadProbeTarget[] {
  return [
    ...GLOBAL_PAYLOAD_PROBE_CAPABILITIES.map((capability) => ({ capability, kind: "global" as const })),
    ...RUN_PAYLOAD_PROBE_CAPABILITIES.map((capability) => ({ capability, kind: "run" as const })),
    ...SCENARIO_PAYLOAD_PROBE_CAPABILITIES.map((capability) => ({ capability, kind: "scenario" as const }))
  ];
}

export function deferredPayloadProbeCapabilities(): PayloadProbeDeferred[] {
  return PAYLOAD_PROBE_DEFERRED_GROUPS.flatMap((group) =>
    group.capabilities.map((capability) => ({ capability, reason: group.reason }))
  );
}

export function buildPayloadProbePlan(targets: PayloadProbeTarget[], deferred: PayloadProbeDeferred[]): PayloadProbePlan {
  const candidateIds = new Set(payloadIdenticalCapabilities().map((cap) => cap.capability));
  const counts = new Map<string, number>();
  const classified = [...targets.map((entry) => entry.capability), ...deferred.map((entry) => entry.capability)];
  for (const capability of classified) counts.set(capability, (counts.get(capability) || 0) + 1);
  const classifiedIds = new Set(classified);
  return {
    targets,
    deferred,
    unclassified: [...candidateIds].filter((capability) => !classifiedIds.has(capability)).sort(),
    duplicateClassifications: [...counts.entries()].filter(([, count]) => count > 1).map(([capability]) => capability).sort(),
    invalidClassifications: [...classifiedIds].filter((capability) => !candidateIds.has(capability)).sort()
  };
}

export function payloadProbePlan(): PayloadProbePlan {
  return buildPayloadProbePlan(payloadProbeTargets(), deferredPayloadProbeCapabilities());
}

function lintRegistry(): string[] {
  const issues: string[] = [];
  const seenCaps = new Set<string>();
  const seenTools = new Set<string>();
  for (const cap of CAPABILITY_REGISTRY) {
    if (seenCaps.has(cap.capability)) issues.push(`duplicate capability id: ${cap.capability}`);
    seenCaps.add(cap.capability);
    if (cap.mcp) {
      if (seenTools.has(cap.mcp.tool)) issues.push(`duplicate MCP tool: ${cap.mcp.tool}`);
      seenTools.add(cap.mcp.tool);
    }
    if (cap.surface === "both" && (!cap.cli || !cap.mcp)) {
      issues.push(`${cap.capability}: surface "both" requires both cli and mcp bindings`);
    }
    if (cap.surface === "cli-only" && (cap.mcp || !cap.cli)) {
      issues.push(`${cap.capability}: surface "cli-only" requires a cli binding and no mcp binding`);
    }
    if (cap.surface === "mcp-only" && (cap.cli || !cap.mcp)) {
      issues.push(`${cap.capability}: surface "mcp-only" requires an mcp binding and no cli binding`);
    }
  }
  return issues;
}

/**
 * Compare the declared registry against the ACTUAL surfaces and report every
 * fail-closed gap. `mcpTools` is the live `tools/list` result; `cliTokens` is the
 * set of `case "<token>"` strings parsed from the CLI source.
 */
export function buildParityReport(input: { mcpTools: string[]; cliTokens: string[]; helpTokens?: string[] }): ParityReport {
  const declaredTools = new Set(declaredMcpTools());
  const actualTools = new Set(input.mcpTools);
  const declaredTokens = new Set(declaredCliTokens());
  const actualTokens = new Set(input.cliTokens);
  const declaredHelpTokens = new Set(declaredCliHelpTokens());
  const actualHelpTokens = new Set(input.helpTokens || []);

  const missingMcpTools = [...declaredTools].filter((tool) => !actualTools.has(tool)).sort();
  const undeclaredMcpTools = [...actualTools].filter((tool) => !declaredTools.has(tool)).sort();
  const missingCliTokens = [...declaredTokens].filter((token) => !actualTokens.has(token)).sort();
  const undeclaredCliTokens = [...actualTokens].filter((token) => !declaredTokens.has(token)).sort();
  const helpMissingCliTokens = input.helpTokens ? [...declaredHelpTokens].filter((token) => !actualHelpTokens.has(token)).sort() : [];
  const helpUndeclaredCliTokens = input.helpTokens ? [...actualHelpTokens].filter((token) => !declaredHelpTokens.has(token)).sort() : [];

  const reasonlessExceptions = CAPABILITY_REGISTRY.filter(
    (cap) => requiresReason(cap) && !(cap.reason && cap.reason.trim())
  )
    .map((cap) => cap.capability)
    .sort();

  const payloadPlan = payloadProbePlan();
  const registryLint = lintRegistry();

  const ok =
    missingMcpTools.length === 0 &&
    undeclaredMcpTools.length === 0 &&
    missingCliTokens.length === 0 &&
    undeclaredCliTokens.length === 0 &&
    helpMissingCliTokens.length === 0 &&
    helpUndeclaredCliTokens.length === 0 &&
    reasonlessExceptions.length === 0 &&
    payloadPlan.unclassified.length === 0 &&
    payloadPlan.duplicateClassifications.length === 0 &&
    payloadPlan.invalidClassifications.length === 0 &&
    registryLint.length === 0;

  return {
    ok,
    registrySize: CAPABILITY_REGISTRY.length,
    missingMcpTools,
    undeclaredMcpTools,
    missingCliTokens,
    undeclaredCliTokens,
    helpMissingCliTokens,
    helpUndeclaredCliTokens,
    reasonlessExceptions,
    payloadProbeUnclassified: payloadPlan.unclassified,
    payloadProbeDuplicateClassifications: payloadPlan.duplicateClassifications,
    payloadProbeInvalidClassifications: payloadPlan.invalidClassifications,
    registryLint
  };
}
