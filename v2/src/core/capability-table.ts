// core/capability-table.ts — THE one data table: one row per capability.
//
// MILESTONE 2 (v2/PLAN.md build order, step 2). Replaces the old build's
// `capability-registry.ts` (940 lines) + 40 CLI handler files + the
// 196-arm MCP switch + the 1000-line tool-definitions array with ONE data
// table plus two generic front-door readers (`cli/dispatch.ts`,
// `mcp/dispatch.ts`).
//
// Per PLAN.md's build order note, this milestone wires only a HANDFUL of
// capabilities end to end (version, help, list, status, sandbox.list —
// exactly what conformance/cases/mcp-basic.case.js and the milestone-1
// carry-over cases need). Every later milestone adds capabilities as table
// ROWS ONLY; this file's shape (and cli/dispatch.ts + mcp/dispatch.ts) is
// not touched again — see v2/PLAN.md's Revision note.
//
// Byte-compat item 5 (v2/PLAN.md): 12 capabilities have CLI and MCP call
// DIFFERENT functions with DIFFERENT payloads. So a row carries a SEPARATE
// `cli.handler` and `mcp.handler`, never one shared "handler" — even
// though every row landed so far happens to share one function, the type
// itself must not collapse the two fields into one, or a later milestone
// would need a breaking shape change to add the first real divergent row.
//
// `MCP_TOOL_DATA` below is the full, literal 196-tool surface transcribed
// from SPEC/mcp.md's "All 196 MCP tools" table (name, capability id,
// required-argument groups, input property names, description) — this is
// exactly the kind of declarative surface data this table exists to hold.
// `tools/list` must report the full 196-tool set NOW (mcp-basic.case.js
// asserts `tools.length >= 100` and checks specific names/order), even
// though only a few of those 196 capabilities have a real, working
// `tools/call` handler at this milestone. Every other tool's `mcp.handler`
// is `notYetImplemented(capability)`, which throws a clean, typed error
// if ever actually called — safe, because no case in this milestone's
// filter calls an unimplemented tool. Each later milestone replaces the
// placeholder handler for the rows it implements; the row's name,
// schema, and position in the array do not change.

export type ParitySurface = "both" | "cli-only" | "mcp-only";
export type CliJsonMode = "default" | "flag" | "human";

/** JSON-schema-ish property shape used by every MCP tool's inputSchema,
 *  per SPEC/mcp.md: every property is one of string/number/boolean/object/
 *  array, each carrying only a `description` (plus `additionalProperties`
 *  for the object case, `items` for the array case). This milestone only
 *  ever emits the plain string form (see `stringProperty` below); the
 *  richer per-capability property shapes are additive, later-milestone
 *  work — this type just has to be ABLE to hold them without a reshape. */
export interface McpPropertySchema {
  type: "string" | "number" | "boolean" | "object" | "array";
  description: string;
  additionalProperties?: true;
  items?: Record<string, never>;
}

export interface McpToolDefinition {
  name: string;
  description: string;
  inputSchema: {
    type: "object";
    properties: Record<string, McpPropertySchema>;
    additionalProperties: true;
  };
}

/** What a `cli.handler` gives back to cli/dispatch.ts. Handlers stay pure
 *  (core/ never calls `process.stdout.write` or sets `process.exitCode`
 *  directly — see v2/PLAN.md's core/shell split); the generic executor in
 *  cli/dispatch.ts is the one place that turns this into real output.
 *   - `text` — human-readable stdout body (dispatch.ts appends "\n" only
 *     if the string doesn't already end in one, matching the old
 *     build's per-call-site convention of pre-joined lines).
 *   - `json` — a plain JS value; dispatch.ts prints it via `printJson`.
 *   - `exitCode` — set when the capability's own success/failure shape
 *     needs a specific process exit code (e.g. `gc verify` on an
 *     unreclaimed run is a clean exit 0 with `reclaimed:false`, while
 *     other verbs fail-close to exit 1 on the same "not found" shape). */
export interface CliHandlerResult {
  text?: string;
  json?: unknown;
  exitCode?: number;
}

/** A capability's CLI-facing binding. `path` is the `cw <path...>` token
 *  sequence (path[0] is the verb `formatCommandHelp`/help-token generation
 *  groups by); `jsonMode` mirrors the old registry's `CliJsonMode`. */
export interface CliBinding {
  path: string[];
  jsonMode: CliJsonMode;
  /** Called with the parsed argv for this command; returns what to print
   *  (see `CliHandlerResult`) or throws on a recoverable failure (the
   *  entry point's top-level catch turns that into the `cw: <message>`
   *  stderr shape + exit 1, per cli/entry.ts's `main`). */
  handler: (args: CapabilityCliArgs) => CliHandlerResult;
}

/** A capability's MCP-facing binding. `requiredArgs` is a list of
 *  "keyA|keyB" OR-groups (all groups are AND'd); a bare "key" is a
 *  one-element OR-group. */
export interface McpBinding {
  tool: string;
  requiredArgs?: string[];
  properties: string[];
  description: string;
  /** Called with the resolved arguments object (cwd already re-based by
   *  mcp/dispatch.ts); returns the plain JS value to pretty-print into
   *  `content[0].text`. */
  handler: (args: Record<string, unknown>) => unknown;
}

export interface CapabilityCliArgs {
  positionals: string[];
  options: Record<string, unknown>;
}

/** One row per capability. `cli` and `mcp` are both optional and
 *  INDEPENDENT — never collapsed into one shared `handler` field (see the
 *  file header's byte-compat note). */
export interface Capability {
  capability: string;
  summary: string;
  surface: ParitySurface;
  cli?: CliBinding;
  mcp?: McpBinding;
  payloadIdentical?: boolean;
  reason?: string;
}

/** Thrown by every not-yet-wired MCP tool handler. Never hit by this
 *  milestone's conformance filter — every tool mcp-basic.case.js actually
 *  calls (`cw_list`, `cw_sandbox_list`) has a real handler below. */
export class CapabilityNotImplementedError extends Error {
  constructor(capability: string) {
    super(`${capability} is not implemented in this milestone`);
    this.name = "CapabilityNotImplementedError";
  }
}

function notYetImplemented(capability: string): (args: Record<string, unknown>) => unknown {
  return () => {
    throw new CapabilityNotImplementedError(capability);
  };
}

function stringProperty(name: string): McpPropertySchema {
  return { type: "string", description: name };
}

/** SPEC/mcp.md's two hand-written property-shape exceptions (see that
 *  file's "All 196 MCP tools" section header note): every OTHER property
 *  on every OTHER tool is the plain string form above. */
const PROPERTY_OVERRIDES: Record<string, Record<string, McpPropertySchema>> = {
  cw_commit: {
    allowUnverifiedCheckpoint: {
      type: "boolean",
      description: "Write a non-gated checkpoint instead of committed state",
    },
  },
  cw_routine_fire: {
    payload: { type: "object", description: "Event payload" },
  },
};

/** Literal transcription of SPEC/mcp.md's "All 196 MCP tools" table, in
 *  its exact source order (`cw_list` first, `cw_history` last — the array
 *  order IS the `tools/list` order, per that spec's "Exact outputs"
 *  section). Do not reorder, alphabetize, or regroup this array; the
 *  order itself is a pinned behavior. */
interface McpToolRow {
  tool: string;
  capability: string;
  requiredArgs: string[];
  properties: string[];
  description: string;
}

const MCP_TOOL_DATA: McpToolRow[] = [
  { tool: "cw_list", capability: "list", requiredArgs: [], properties: [], description: "List bundled CW workflows." },
  { tool: "cw_plan", capability: "plan", requiredArgs: ["workflowId"], properties: ["workflowId", "repo", "question"], description: "Create a CW run and return its canonical plan summary." },
  { tool: "cw_app_run", capability: "app.run", requiredArgs: ["appId"], properties: ["cwd", "appId", "inputs", "sandbox", "sandboxProfile", "sandboxProfileId"], description: "Create a run from an app id + structured inputs." },
  { tool: "cw_status", capability: "status", requiredArgs: ["runId"], properties: ["runId", "cwd"], description: "Read run checkpoint status." },
  { tool: "cw_init", capability: "init", requiredArgs: ["workflowId"], properties: ["workflowId", "title", "output"], description: "Scaffold a new workflow definition." },
  { tool: "cw_next", capability: "next", requiredArgs: ["runId"], properties: ["runId", "cwd", "limit"], description: "Read the next recommended tasks for a run." },
  { tool: "cw_state_check", capability: "state.check", requiredArgs: ["runId"], properties: ["runId", "cwd", "state", "write"], description: "Check run-state schema compatibility." },
  { tool: "cw_contract_show", capability: "contract.show", requiredArgs: ["runId"], properties: ["runId", "cwd", "contractId"], description: "Show a run's pipeline contract." },
  { tool: "cw_node_list", capability: "node.list", requiredArgs: ["runId"], properties: ["runId", "cwd"], description: "List state nodes for a run." },
  { tool: "cw_node_show", capability: "node.show", requiredArgs: ["runId, nodeId"], properties: ["runId", "cwd", "nodeId"], description: "Show one state node for a run." },
  { tool: "cw_node_graph", capability: "node.graph", requiredArgs: ["runId"], properties: ["runId", "cwd"], description: "Read the state-node graph for a run." },
  { tool: "cw_node_snapshot", capability: "node.snapshot", requiredArgs: [], properties: ["runId", "cwd", "nodeId"], description: "Snapshot one state node (derived + fingerprinted)." },
  { tool: "cw_node_diff", capability: "node.diff", requiredArgs: [], properties: ["runId", "cwd", "baselineSnapshotId", "candidateSnapshotId"], description: "Structurally diff two node snapshots." },
  { tool: "cw_node_replay", capability: "node.replay", requiredArgs: [], properties: ["runId", "cwd", "snapshotId"], description: "Deterministically replay one node from a snapshot." },
  { tool: "cw_node_replay_verify", capability: "node.replay.verify", requiredArgs: [], properties: ["runId", "cwd", "replayId"], description: "Verify a node replay against its source." },
  { tool: "cw_migration_list", capability: "migration.list", requiredArgs: [], properties: [], description: "List the declared migration registry." },
  { tool: "cw_migration_check", capability: "migration.check", requiredArgs: [], properties: ["target", "contract", "cwd"], description: "Dry-run migration verdict for a target." },
  { tool: "cw_migration_prove", capability: "migration.prove", requiredArgs: [], properties: ["target", "contract", "cwd"], description: "Round-trip / non-destruction migration proof for a target." },
  { tool: "cw_operator_status", capability: "operator.status", requiredArgs: ["runId"], properties: ["runId", "cwd"], description: "Read the structured Operator UX run status." },
  { tool: "cw_operator_graph", capability: "graph", requiredArgs: ["runId"], properties: ["runId", "cwd"], description: "Read the structured Operator UX run graph." },
  { tool: "cw_operator_report", capability: "operator.report", requiredArgs: ["runId"], properties: ["runId", "cwd"], description: "Refresh and read the structured Operator UX report summary." },
  { tool: "cw_worker_summary", capability: "worker.summary", requiredArgs: ["runId"], properties: ["runId", "cwd"], description: "Read the structured worker summary for a run." },
  { tool: "cw_workbench_view", capability: "workbench.view", requiredArgs: ["runId"], properties: ["runId", "cwd"], description: "Read the read-only five-panel Workbench view of one run (graph, blackboard, worker, candidate, audit)." },
  { tool: "cw_workbench_serve", capability: "workbench.serve", requiredArgs: [], properties: ["cwd", "port", "scope"], description: "Describe/serve the optional localhost-only, read-only Workbench host." },
  { tool: "cw_candidate_summary", capability: "candidate.summary", requiredArgs: ["runId"], properties: ["runId", "cwd"], description: "Read the structured candidate summary for a run." },
  { tool: "cw_feedback_summary", capability: "feedback.summary", requiredArgs: ["runId"], properties: ["runId", "cwd"], description: "Read the structured feedback summary for a run." },
  { tool: "cw_commit_summary", capability: "commit.summary", requiredArgs: ["runId"], properties: ["runId", "cwd"], description: "Read the structured commit summary for a run." },
  { tool: "cw_multi_agent_summary", capability: "multi-agent.summary", requiredArgs: ["runId"], properties: ["runId", "cwd"], description: "Read the structured multi-agent runtime summary for a run." },
  { tool: "cw_multi_agent_graph", capability: "multi-agent.graph", requiredArgs: ["runId"], properties: ["runId", "cwd"], description: "Read the structured multi-agent operator graph for a run." },
  { tool: "cw_multi_agent_dependencies", capability: "multi-agent.dependencies", requiredArgs: ["runId"], properties: ["runId", "cwd"], description: "Read derived multi-agent dependency edges for operator inspection." },
  { tool: "cw_multi_agent_failures", capability: "multi-agent.failures", requiredArgs: ["runId"], properties: ["runId", "cwd"], description: "Read failed, blocked, rejected, and ambiguous multi-agent records." },
  { tool: "cw_multi_agent_evidence", capability: "multi-agent.evidence", requiredArgs: ["runId"], properties: ["runId", "cwd"], description: "Read evidence adoption status from worker output through selection and commit. Each row carries a derived rationaleStatus (explained|unexplained|not-applicable)." },
  { tool: "cw_evidence_reasoning", capability: "multi-agent.reasoning", requiredArgs: ["runId"], properties: ["runId", "cwd", "evidence", "refresh"], description: "Explain why each evidence item was adopted/rejected." },
  { tool: "cw_evidence_reasoning_refresh", capability: "multi-agent.reasoning.refresh", requiredArgs: ["runId"], properties: ["runId", "cwd"], description: "Refresh the durable evidence-reasoning index." },
  { tool: "cw_summary_refresh", capability: "summary.refresh", requiredArgs: ["runId"], properties: ["runId", "cwd", "view"], description: "Refresh state-explosion summaries." },
  { tool: "cw_summary_show", capability: "summary.show", requiredArgs: ["runId"], properties: ["runId", "cwd"], description: "Read the persisted state-explosion report." },
  { tool: "cw_blackboard_summarize", capability: "blackboard.summarize", requiredArgs: ["runId"], properties: ["runId", "cwd", "blackboardId"], description: "Read a blackboard digest with conflicts/evidence." },
  { tool: "cw_multi_agent_summarize", capability: "multi-agent.summarize", requiredArgs: ["runId"], properties: ["runId", "cwd"], description: "Read the combined state-explosion report." },
  { tool: "cw_multi_agent_graph_compact", capability: "multi-agent.graph.compact", requiredArgs: ["runId"], properties: ["runId", "cwd", "view", "focus", "depth"], description: "Read a compact/focused multi-agent graph view." },
  { tool: "cw_multi_agent_run", capability: "multi-agent.run", requiredArgs: [], properties: ["runId", "cwd", "app", "appId", "workflow", "workflowId", "topology", "topologyId", "task", "mapperCount", "judgeCount", "debateRounds"], description: "Create or attach a topology-backed multi-agent run." },
  { tool: "cw_multi_agent_status", capability: "multi-agent.status", requiredArgs: ["runId"], properties: ["runId", "cwd"], description: "Read combined topology/blackboard/worker status." },
  { tool: "cw_multi_agent_step", capability: "multi-agent.step", requiredArgs: ["runId"], properties: ["runId", "cwd", "sandbox", "backend", "limit"], description: "Perform one safe deterministic host step." },
  { tool: "cw_multi_agent_blackboard", capability: "multi-agent.blackboard", requiredArgs: ["runId"], properties: ["runId", "cwd", "action", "blackboardId", "topicId", "body", "kind", "path", "evidence"], description: "Operate on the active multi-agent blackboard." },
  { tool: "cw_multi_agent_score", capability: "multi-agent.score", requiredArgs: ["runId"], properties: ["runId", "cwd", "candidate", "candidateId", "worker", "criterion", "criteria", "evidence", "maxTotal"], description: "Score a candidate with evidence." },
  { tool: "cw_multi_agent_select", capability: "multi-agent.select", requiredArgs: ["runId"], properties: ["runId", "cwd", "candidate", "candidateId", "score", "scoreId", "reason", "allowUnverified"], description: "Select a candidate with the verifier gate." },
  { tool: "cw_eval_snapshot", capability: "eval.snapshot", requiredArgs: ["runId"], properties: ["runId", "cwd", "id"], description: "Create a deterministic replay snapshot." },
  { tool: "cw_eval_replay", capability: "eval.replay", requiredArgs: ["snapshot|snapshotId|path"], properties: ["cwd", "snapshot", "snapshotId", "path", "id"], description: "Replay a snapshot without live agents." },
  { tool: "cw_eval_compare", capability: "eval.compare", requiredArgs: ["baseline|baselinePath, replay|replayPath"], properties: ["cwd", "baseline", "baselinePath", "replay", "replayPath"], description: "Compare baseline and replay deterministically." },
  { tool: "cw_eval_score", capability: "eval.score", requiredArgs: ["replay|replayPath|path"], properties: ["cwd", "replay", "replayPath", "path"], description: "Score replay quality." },
  { tool: "cw_eval_gate", capability: "eval.gate", requiredArgs: ["suite|suiteId|path"], properties: ["cwd", "suite", "suiteId", "path"], description: "Run the eval/replay regression gate." },
  { tool: "cw_eval_report", capability: "eval.report", requiredArgs: ["replay|replayPath|path"], properties: ["cwd", "replay", "replayPath", "path"], description: "Render an eval/replay report." },
  { tool: "cw_multi_agent_run_create", capability: "multi-agent.run.create", requiredArgs: ["runId"], properties: ["runId", "cwd", "id", "title", "objective"], description: "Create a MultiAgentRun state record." },
  { tool: "cw_multi_agent_run_transition", capability: "multi-agent.run.transition", requiredArgs: ["runId"], properties: ["runId", "cwd", "multiAgentRunId", "id", "status", "reason"], description: "Transition a MultiAgentRun lifecycle." },
  { tool: "cw_multi_agent_run_show", capability: "multi-agent.run.show", requiredArgs: ["runId"], properties: ["runId", "cwd", "multiAgentRunId", "id"], description: "Show one MultiAgentRun record." },
  { tool: "cw_multi_agent_role_create", capability: "multi-agent.role.create", requiredArgs: ["runId"], properties: ["runId", "cwd", "id", "multiAgentRunId", "multiAgentRun", "title", "responsibility", "requiredEvidence", "sandboxProfileHint", "expectedArtifact", "faninObligation"], description: "Create an AgentRole record." },
  { tool: "cw_multi_agent_role_show", capability: "multi-agent.role.show", requiredArgs: ["runId, roleId"], properties: ["runId", "cwd", "roleId", "id"], description: "Show one AgentRole record." },
  { tool: "cw_multi_agent_group_create", capability: "multi-agent.group.create", requiredArgs: ["runId"], properties: ["runId", "cwd", "id", "multiAgentRunId", "multiAgentRun", "title", "phase", "task"], description: "Create an AgentGroup record." },
  { tool: "cw_multi_agent_group_show", capability: "multi-agent.group.show", requiredArgs: ["runId, groupId"], properties: ["runId", "cwd", "groupId", "id"], description: "Show one AgentGroup record." },
  { tool: "cw_multi_agent_membership_create", capability: "multi-agent.membership.create", requiredArgs: ["runId"], properties: ["runId", "cwd", "id", "groupId", "roleId", "taskId", "workerId", "dispatchId", "fanoutId"], description: "Create an AgentMembership record." },
  { tool: "cw_multi_agent_membership_show", capability: "multi-agent.membership.show", requiredArgs: ["runId, membershipId"], properties: ["runId", "cwd", "membershipId", "id"], description: "Show one AgentMembership record." },
  { tool: "cw_multi_agent_fanout_create", capability: "multi-agent.fanout.create", requiredArgs: ["runId"], properties: ["runId", "cwd", "id", "groupId", "reason", "role", "task", "limit", "sandboxChoice"], description: "Create an AgentFanout record." },
  { tool: "cw_multi_agent_fanout_show", capability: "multi-agent.fanout.show", requiredArgs: ["runId, fanoutId"], properties: ["runId", "cwd", "fanoutId", "id"], description: "Show one AgentFanout record." },
  { tool: "cw_multi_agent_fanin_collect", capability: "multi-agent.fanin.collect", requiredArgs: ["runId"], properties: ["runId", "cwd", "id", "groupId", "fanoutId", "requiredRole", "strategy"], description: "Collect an AgentFanin with evidence coverage." },
  { tool: "cw_multi_agent_fanin_show", capability: "multi-agent.fanin.show", requiredArgs: ["runId, faninId"], properties: ["runId", "cwd", "faninId", "id"], description: "Show one AgentFanin record." },
  { tool: "cw_topology_list", capability: "topology.list", requiredArgs: [], properties: [], description: "List official topology definitions." },
  { tool: "cw_topology_show", capability: "topology.show", requiredArgs: ["topologyId|id"], properties: ["runId", "cwd", "topologyId", "topologyRunId", "id"], description: "Show a topology definition or run." },
  { tool: "cw_topology_validate", capability: "topology.validate", requiredArgs: ["topologyId|id"], properties: ["topologyId", "id"], description: "Validate a topology definition." },
  { tool: "cw_topology_apply", capability: "topology.apply", requiredArgs: ["runId, topologyId|id"], properties: ["runId", "cwd", "topologyId", "id", "task", "mapperCount", "judgeCount", "debateRounds", "blackboardId", "multiAgentRunId", "collectInitialFanin"], description: "Apply a topology to a run." },
  { tool: "cw_topology_summary", capability: "topology.summary", requiredArgs: ["runId"], properties: ["runId", "cwd"], description: "Read topology progress and next actions." },
  { tool: "cw_topology_graph", capability: "topology.graph", requiredArgs: ["runId"], properties: ["runId", "cwd"], description: "Read topology graph nodes and edges." },
  { tool: "cw_blackboard_summary", capability: "blackboard.summary", requiredArgs: ["runId"], properties: ["runId", "cwd"], description: "Read the blackboard/coordinator summary." },
  { tool: "cw_blackboard_graph", capability: "blackboard.graph", requiredArgs: ["runId"], properties: ["runId", "cwd"], description: "Read blackboard graph nodes and edges." },
  { tool: "cw_blackboard_resolve", capability: "blackboard.resolve", requiredArgs: ["runId"], properties: ["runId", "cwd", "id", "title", "multiAgentRunId", "groupId", "roleId", "membershipId"], description: "Create or resolve a run blackboard." },
  { tool: "cw_blackboard_topic_create", capability: "blackboard.topic.create", requiredArgs: ["runId"], properties: ["runId", "cwd", "id", "title", "description", "blackboardId", "tag"], description: "Create a blackboard topic." },
  { tool: "cw_blackboard_message_post", capability: "blackboard.message.post", requiredArgs: ["runId"], properties: ["runId", "cwd", "id", "topic", "topicId", "body", "replyTo", "visibility", "evidence", "artifact"], description: "Post a blackboard message." },
  { tool: "cw_blackboard_message_list", capability: "blackboard.message.list", requiredArgs: ["runId"], properties: ["runId", "cwd", "topic", "topicId", "blackboardId"], description: "List blackboard messages." },
  { tool: "cw_blackboard_context_put", capability: "blackboard.context.put", requiredArgs: ["runId"], properties: ["runId", "cwd", "id", "topic", "topicId", "kind", "key", "value", "supersedes", "evidence", "artifact"], description: "Publish a shared context frame." },
  { tool: "cw_blackboard_artifact_add", capability: "blackboard.artifact.add", requiredArgs: ["runId"], properties: ["runId", "cwd", "id", "topic", "kind", "path", "locator", "source", "evidence"], description: "Index an artifact in the blackboard." },
  { tool: "cw_blackboard_artifact_list", capability: "blackboard.artifact.list", requiredArgs: ["runId"], properties: ["runId", "cwd", "topic", "blackboardId"], description: "List blackboard artifact refs." },
  { tool: "cw_blackboard_snapshot", capability: "blackboard.snapshot", requiredArgs: ["runId"], properties: ["runId", "cwd", "blackboardId"], description: "Create a durable blackboard snapshot." },
  { tool: "cw_coordinator_summary", capability: "coordinator.summary", requiredArgs: ["runId"], properties: ["runId", "cwd"], description: "Read the coordinator summary." },
  { tool: "cw_coordinator_decision", capability: "coordinator.decision", requiredArgs: ["runId"], properties: ["runId", "cwd", "id", "kind", "outcome", "reason", "subject", "evidence", "artifact", "message"], description: "Record a coordinator decision." },
  { tool: "cw_audit_summary", capability: "audit.summary", requiredArgs: ["runId"], properties: ["runId", "cwd"], description: "Read the trust/audit summary." },
  { tool: "cw_audit_verify", capability: "audit.verify", requiredArgs: ["runId"], properties: ["runId", "cwd"], description: "Re-prove a run's trust-audit hash chain (fail-closed exit)." },
  { tool: "cw_audit_worker", capability: "audit.worker", requiredArgs: ["runId"], properties: ["runId", "cwd", "workerId"], description: "Read trust/audit for one worker." },
  { tool: "cw_audit_provenance", capability: "audit.provenance", requiredArgs: ["runId"], properties: ["runId", "cwd", "workerId", "worker", "candidateId", "candidate", "commitId", "commit"], description: "Inspect evidence provenance." },
  { tool: "cw_audit_multi_agent", capability: "audit.multi-agent", requiredArgs: ["runId"], properties: ["runId", "cwd"], description: "Read the multi-agent trust/policy/provenance audit." },
  { tool: "cw_audit_policy", capability: "audit.policy", requiredArgs: ["runId"], properties: ["runId", "cwd"], description: "Read role policies and permission decisions." },
  { tool: "cw_audit_role", capability: "audit.role", requiredArgs: ["runId"], properties: ["runId", "cwd", "roleId", "id"], description: "Read policy/audit for one role." },
  { tool: "cw_audit_blackboard", capability: "audit.blackboard", requiredArgs: ["runId"], properties: ["runId", "cwd"], description: "Read the blackboard write audit." },
  { tool: "cw_audit_judge", capability: "audit.judge", requiredArgs: ["runId"], properties: ["runId", "cwd"], description: "Read judge rationale/panel decision audit." },
  { tool: "cw_audit_attest", capability: "audit.attest", requiredArgs: ["runId"], properties: ["runId", "cwd", "workerId", "worker", "actor", "hostEnforced", "env", "note"], description: "Record a host/operator sandbox attestation." },
  { tool: "cw_audit_decision", capability: "audit.decision", requiredArgs: ["runId"], properties: ["runId", "cwd", "workerId", "path", "command", "network", "env", "kind"], description: "Validate and record a sandbox decision." },
  { tool: "cw_dispatch", capability: "dispatch", requiredArgs: ["runId"], properties: ["runId", "cwd", "limit", "sandbox", "sandboxProfile", "sandboxProfileId", "backend", "backendId"], description: "Create a subagent dispatch manifest." },
  { tool: "cw_sandbox_list", capability: "sandbox.list", requiredArgs: [], properties: ["cwd"], description: "List bundled sandbox profiles." },
  { tool: "cw_sandbox_show", capability: "sandbox.show", requiredArgs: ["profileId"], properties: ["cwd", "profileId"], description: "Show a resolved sandbox profile." },
  { tool: "cw_sandbox_validate", capability: "sandbox.validate", requiredArgs: ["profileFile"], properties: ["cwd", "profileFile"], description: "Validate a sandbox profile JSON file." },
  { tool: "cw_sandbox_choose", capability: "sandbox.choose", requiredArgs: [], properties: ["cwd", "profileId", "sandbox", "sandboxProfile", "sandboxProfileId"], description: "Resolve and validate a sandbox profile choice." },
  { tool: "cw_sandbox_resolve", capability: "sandbox.resolve", requiredArgs: [], properties: ["cwd", "profileId", "sandbox", "sandboxProfile", "sandboxProfileId"], description: "Alias of sandbox.choose." },
  { tool: "cw_backend_list", capability: "backend.list", requiredArgs: [], properties: ["cwd"], description: "List available execution backends and their capabilities." },
  { tool: "cw_backend_show", capability: "backend.show", requiredArgs: [], properties: ["cwd", "backendId"], description: "Show one execution backend descriptor." },
  { tool: "cw_backend_probe", capability: "backend.probe", requiredArgs: [], properties: ["cwd", "backendId"], description: "Probe execution backend readiness (live, deterministic)." },
  { tool: "cw_backend_agent_config_show", capability: "backend.agent.config.show", requiredArgs: [], properties: ["cwd", "agentCommand", "agentEndpoint", "agentModel"], description: "Show the effective agent delegation config (flags>env>file, secret-stripped, host-stable)." },
  { tool: "cw_backend_agent_config_set", capability: "backend.agent.config.set", requiredArgs: [], properties: ["cwd", "agentCommand", "agentEndpoint", "agentModel"], description: "Set the durable agent delegation config (command-template/endpoint/model; API keys never written)." },
  { tool: "cw_result", capability: "result", requiredArgs: ["runId"], properties: ["runId", "taskId", "resultPath", "cwd"], description: "Record a subagent result file against a task." },
  { tool: "cw_commit", capability: "commit", requiredArgs: ["runId"], properties: ["runId", "reason", "verifier", "verifierNode", "candidate", "selection", "allowUnverifiedCheckpoint", "cwd"], description: "Create a verifier-gated commit or checkpoint." },
  { tool: "cw_report", capability: "report", requiredArgs: ["runId"], properties: ["runId", "cwd"], description: "Render a run report and return its canonical descriptor." },
  { tool: "cw_app_list", capability: "app.list", requiredArgs: [], properties: ["cwd"], description: "List CW workflow apps." },
  { tool: "cw_app_show", capability: "app.show", requiredArgs: [], properties: ["cwd", "appId"], description: "Show a CW workflow app contract." },
  { tool: "cw_app_validate", capability: "app.validate", requiredArgs: [], properties: ["cwd", "target"], description: "Validate an app by path or id." },
  { tool: "cw_app_init", capability: "app.init", requiredArgs: [], properties: ["cwd", "appId", "title", "directory"], description: "Create a CW workflow app directory." },
  { tool: "cw_app_package", capability: "app.package", requiredArgs: [], properties: ["cwd", "appId", "output"], description: "Package an app as a JSON artifact." },
  { tool: "cw_worker_list", capability: "worker.list", requiredArgs: ["runId"], properties: ["runId", "cwd", "status"], description: "List worker isolation scopes." },
  { tool: "cw_worker_show", capability: "worker.show", requiredArgs: ["runId, workerId"], properties: ["runId", "cwd", "workerId"], description: "Show one worker isolation scope." },
  { tool: "cw_worker_manifest", capability: "worker.manifest", requiredArgs: ["runId"], properties: ["runId", "cwd", "workerId"], description: "Write and return a worker manifest." },
  { tool: "cw_worker_output", capability: "worker.output", requiredArgs: ["runId"], properties: ["runId", "cwd", "workerId", "resultPath"], description: "Record worker output." },
  { tool: "cw_worker_fail", capability: "worker.fail", requiredArgs: ["runId"], properties: ["runId", "cwd", "workerId", "message", "code", "path", "retryable"], description: "Record a structured worker failure." },
  { tool: "cw_worker_validate", capability: "worker.validate", requiredArgs: ["runId"], properties: ["runId", "cwd", "workerId", "path", "resultPath"], description: "Validate a worker output boundary." },
  { tool: "cw_candidate_list", capability: "candidate.list", requiredArgs: ["runId"], properties: ["runId", "cwd", "status", "kind"], description: "List candidates for a run." },
  { tool: "cw_candidate_show", capability: "candidate.show", requiredArgs: ["runId, candidateId"], properties: ["runId", "cwd", "candidateId"], description: "Show one candidate." },
  { tool: "cw_candidate_register", capability: "candidate.register", requiredArgs: ["runId"], properties: ["runId", "cwd", "id", "kind", "worker", "task", "resultNode", "verifierNode", "resultPath"], description: "Register a candidate from evidence." },
  { tool: "cw_candidate_score", capability: "candidate.score", requiredArgs: ["runId"], properties: ["runId", "cwd", "candidateId", "criteria", "criterion", "evidence", "maxTotal", "max", "verdict", "notes", "scorer"], description: "Score a candidate with criteria/evidence." },
  { tool: "cw_candidate_rank", capability: "candidate.rank", requiredArgs: ["runId"], properties: ["runId", "cwd", "includeRejected", "minNormalized", "requireEvidence", "requireVerifierGate", "tieBreaker"], description: "Rank candidates with gates." },
  { tool: "cw_candidate_select", capability: "candidate.select", requiredArgs: ["runId"], properties: ["runId", "cwd", "candidateId", "reason", "selectedBy", "by", "score", "allowUnverified", "minNormalized", "requireVerifierGate"], description: "Select a candidate with the verifier gate." },
  { tool: "cw_candidate_reject", capability: "candidate.reject", requiredArgs: ["runId"], properties: ["runId", "cwd", "candidateId", "reason"], description: "Reject a candidate with a reason." },
  { tool: "cw_approve", capability: "approve", requiredArgs: ["runId", "targetKind|kind", "targetId|target"], properties: ["runId", "cwd", "targetKind", "targetId", "actor", "actorKind", "role", "displayName", "attested", "attestation", "rationale", "supersedes"], description: "Append a host-attested approval of a candidate/commit/selection." },
  { tool: "cw_reject", capability: "reject", requiredArgs: ["runId", "targetKind|kind", "targetId|target"], properties: ["runId", "cwd", "targetKind", "targetId", "actor", "actorKind", "role", "displayName", "attested", "attestation", "rationale"], description: "Append a host-attested rejection (blocking veto) of a candidate/commit/selection." },
  { tool: "cw_comment_add", capability: "comment.add", requiredArgs: ["runId", "targetKind|kind", "targetId|target", "body|message|text"], properties: ["runId", "cwd", "targetKind", "targetId", "actor", "actorKind", "role", "displayName", "attested", "attestation", "body", "thread", "parent"], description: "Append a comment to a durable target." },
  { tool: "cw_comment_list", capability: "comment.list", requiredArgs: ["runId"], properties: ["runId", "cwd", "targetKind", "target"], description: "List append-only comments for a run (optionally one target)." },
  { tool: "cw_handoff", capability: "handoff", requiredArgs: ["runId", "targetKind|kind", "targetId|target", "to|toActor"], properties: ["runId", "cwd", "targetKind", "targetId", "actor", "actorKind", "role", "displayName", "attested", "attestation", "to", "toRole", "from", "reason"], description: "Record an ownership transfer (from-actor → to-actor) of a run/task." },
  { tool: "cw_ledger_propose", capability: "ledger.propose", requiredArgs: ["from", "to", "title", "rationale"], properties: ["from", "to", "title", "rationale", "files", "diff"], description: "Build a verifiable cross-agent change proposal entry (printed as JSON)." },
  { tool: "cw_ledger_review", capability: "ledger.review", requiredArgs: ["from", "to", "target", "verdict"], properties: ["from", "to", "target", "verdict", "findings"], description: "Build a verifiable cross-agent review verdict entry (printed as JSON)." },
  { tool: "cw_ledger_verify", capability: "ledger.verify", requiredArgs: ["entry"], properties: ["entry"], description: "Verify a ledger entry against its content digest (fail-closed on tampering)." },
  { tool: "cw_ledger_apply", capability: "ledger.apply", requiredArgs: ["entry"], properties: ["entry"], description: "Verify a proposal entry and return its suggestedDiff for `git apply` (fail-closed: no diff unless the entry verifies as a proposal)." },
  { tool: "cw_ledger_list", capability: "ledger.list", requiredArgs: ["dir|dirs"], properties: ["dir", "dirs"], description: "Read + verify every entry in one or more shared ledger directories (fail-closed inbox; 2+ dirs union-verify mirrors)." },
  { tool: "cw_review_status", capability: "review.status", requiredArgs: ["runId"], properties: ["runId", "cwd", "targetKind", "target", "now"], description: "Read the derived per-target review state + collaboration timeline for a run." },
  { tool: "cw_review_policy", capability: "review.policy", requiredArgs: ["runId"], properties: ["runId", "cwd", "requiredApprovals", "authorizedRoles", "allowSelfApproval", "requireAttestedActor", "appliesTo"], description: "Set the run's review-gate policy (required approvals, authorized roles, self-approval rule)." },
  { tool: "cw_feedback_list", capability: "feedback.list", requiredArgs: ["runId"], properties: ["runId", "cwd", "status"], description: "List run feedback records." },
  { tool: "cw_feedback_show", capability: "feedback.show", requiredArgs: ["runId, feedbackId"], properties: ["runId", "feedbackId", "cwd"], description: "Show a run feedback record." },
  { tool: "cw_feedback_collect", capability: "feedback.collect", requiredArgs: ["runId"], properties: ["runId", "cwd"], description: "Collect feedback from failed nodes." },
  { tool: "cw_feedback_task", capability: "feedback.task", requiredArgs: ["runId"], properties: ["runId", "feedbackId", "cwd", "verify"], description: "Create a correction task for feedback." },
  { tool: "cw_feedback_resolve", capability: "feedback.resolve", requiredArgs: ["runId"], properties: ["runId", "feedbackId", "cwd", "node", "status"], description: "Resolve or reject feedback." },
  { tool: "cw_schedule_create", capability: "schedule.create", requiredArgs: [], properties: ["cwd", "kind", "prompt", "intervalMinutes", "cron", "delayMinutes"], description: "Create a scheduled CW task." },
  { tool: "cw_schedule_list", capability: "schedule.list", requiredArgs: [], properties: ["cwd", "status"], description: "List scheduled CW tasks." },
  { tool: "cw_schedule_due", capability: "schedule.due", requiredArgs: [], properties: ["cwd"], description: "List due scheduled CW tasks." },
  { tool: "cw_schedule_complete", capability: "schedule.complete", requiredArgs: ["id"], properties: ["cwd", "id"], description: "Mark a scheduled task complete." },
  { tool: "cw_schedule_pause", capability: "schedule.pause", requiredArgs: ["id"], properties: ["cwd", "id"], description: "Pause a scheduled CW task." },
  { tool: "cw_schedule_resume", capability: "schedule.resume", requiredArgs: ["id"], properties: ["cwd", "id"], description: "Resume a scheduled CW task." },
  { tool: "cw_schedule_run_now", capability: "schedule.run-now", requiredArgs: ["id"], properties: ["cwd", "id"], description: "Create an immediate scheduled-task run record." },
  { tool: "cw_schedule_history", capability: "schedule.history", requiredArgs: [], properties: ["cwd", "id"], description: "List scheduled-task run history." },
  { tool: "cw_schedule_delete", capability: "schedule.delete", requiredArgs: ["id"], properties: ["cwd", "id"], description: "Delete a scheduled CW task." },
  { tool: "cw_routine_create", capability: "routine.create", requiredArgs: [], properties: ["cwd", "kind", "prompt", "match"], description: "Create a routine-style API/GitHub trigger." },
  { tool: "cw_routine_list", capability: "routine.list", requiredArgs: [], properties: ["cwd", "kind"], description: "List routine-style triggers." },
  { tool: "cw_routine_fire", capability: "routine.fire", requiredArgs: ["kind"], properties: ["cwd", "kind", "payload"], description: "Record an API/GitHub trigger event." },
  { tool: "cw_routine_events", capability: "routine.events", requiredArgs: [], properties: ["cwd", "id"], description: "List routine trigger events." },
  { tool: "cw_routine_delete", capability: "routine.delete", requiredArgs: ["id"], properties: ["cwd", "id"], description: "Delete a routine-style trigger." },
  { tool: "cw_registry_refresh", capability: "registry.refresh", requiredArgs: [], properties: ["cwd", "scope"], description: "Recompute and persist the derived run registry index." },
  { tool: "cw_registry_show", capability: "registry.show", requiredArgs: [], properties: ["cwd", "scope"], description: "Read the run registry index with valid|stale|absent freshness." },
  { tool: "cw_metrics_show", capability: "metrics.show", requiredArgs: ["runId"], properties: ["runId", "cwd", "pricing", "now"], description: "Read the derived per-run observability + attested-cost report (durations, failure/verifier/acceptance rates with sample counts, attested usage, cost, coverage)." },
  { tool: "cw_metrics_summary", capability: "metrics.summary", requiredArgs: [], properties: ["cwd", "scope", "pricing", "now"], description: "Read the cross-repo observability + cost rollup over the v0.1.28 run registry, with per-app and per-backend breakdowns." },
  { tool: "cw_run_search", capability: "run.search", requiredArgs: [], properties: ["cwd", "scope", "text", "app", "status", "repo", "since", "until", "includeArchived", "limit", "offset"], description: "Search runs by app/status/time/repo/free-text, deterministic + paginated." },
  { tool: "cw_run_list", capability: "run.list", requiredArgs: [], properties: ["cwd", "scope", "includeArchived", "limit", "offset"], description: "List indexed runs across repos (search with no filters)." },
  { tool: "cw_run_show", capability: "run.show", requiredArgs: ["runId"], properties: ["runId", "cwd", "scope"], description: "Resolve one run by id across the registry; fail closed on missing source." },
  { tool: "cw_run_resume", capability: "run.resume", requiredArgs: ["runId"], properties: ["runId", "cwd", "scope", "limit"], description: "Resolve a run by id and return its next runnable tasks/actions (read-only by default; the opt-in --drive/--once mode hands it to the shared agent-drive core, which mutates and is covered by run.drive.step)." },
  { tool: "cw_run_archive", capability: "run.archive", requiredArgs: ["runId|olderThanDays"], properties: ["runId", "cwd", "scope", "reason", "unarchive", "olderThanDays", "state"], description: "Archive/unarchive a run (overlay mark; never deletes source)." },
  { tool: "cw_run_rerun", capability: "run.rerun", requiredArgs: ["runId"], properties: ["runId", "cwd", "scope", "reason"], description: "Re-run a failed run as a NEW run linked to the original by provenance." },
  { tool: "cw_run_export", capability: "run.export", requiredArgs: ["runId"], properties: ["runId", "cwd", "output", "path", "archive", "trustKey", "withTrustKey"], description: "Export a run to a portable archive with run-local files and digest integrity." },
  { tool: "cw_run_import", capability: "run.import", requiredArgs: ["archive|path|file"], properties: ["archive", "path", "file", "target", "repo", "cwd"], description: "Restore a portable run archive into a target repo and verify restored file digests." },
  { tool: "cw_run_verify_import", capability: "run.verify-import", requiredArgs: ["runId"], properties: ["runId", "cwd"], description: "Verify an imported run against its restore manifest and telemetry chain." },
  { tool: "cw_run_inspect_archive", capability: "run.inspect-archive", requiredArgs: ["archive|path|file"], properties: ["archive", "path", "file", "cwd"], description: "Read-only integrity inspection of a portable run archive without importing it." },
  { tool: "cw_run_restore", capability: "run.restore", requiredArgs: ["archive|path|file"], properties: ["archive", "path", "file", "target", "repo", "cwd"], description: "Fail-closed restore of a portable run archive: integrity-inspect, import, and verify in one step; refuses anything that does not verify." },
  { tool: "cw_report_verify_bundle", capability: "report.verify-bundle", requiredArgs: ["archive|path|file|bundle"], properties: ["archive", "path", "file", "bundle", "pubkey", "extractReport", "strictSignatures", "cwd"], description: "Offline self-contained verify of a portable run bundle: archive bytes + telemetry chain + trust-audit chain + embedded-key signatures." },
  { tool: "cw_report_bundle", capability: "report.bundle", requiredArgs: ["runId"], properties: ["runId", "cwd", "output", "path", "trustKey", "withTrustKey", "extractReport", "strictSignatures"], description: "Produce-and-prove: export a run to a portable bundle sealed with the trust key, then self-verify it offline (fail-closed) so the producer knows it is verifiable before shipping." },
  { tool: "cw_run_drive", capability: "run.drive", requiredArgs: [], properties: ["runId", "cwd"], description: "Preview the next agent-delegation drive step for a run (read-only, deterministic)." },
  { tool: "cw_run_drive_step", capability: "run.drive.step", requiredArgs: [], properties: ["runId", "appId", "repo", "question", "once", "now", "concurrency", "cwd"], description: "Drive a run by delegating each worker to the agent backend (plan->dispatch->fulfill->accept->commit; --once for one step)." },
  { tool: "cw_queue_add", capability: "queue.add", requiredArgs: [], properties: ["cwd", "runId", "appId", "workflowId", "repo", "priority", "note"], description: "Enqueue a pending/planned run with explicit ordering policy." },
  { tool: "cw_queue_list", capability: "queue.list", requiredArgs: [], properties: ["cwd", "status", "repo"], description: "List the durable run queue in policy order." },
  { tool: "cw_queue_drain", capability: "queue.drain", requiredArgs: [], properties: ["cwd", "limit", "repo"], description: "Mark the next ready queue entries drained (the host still executes)." },
  { tool: "cw_queue_show", capability: "queue.show", requiredArgs: ["id"], properties: ["cwd", "id"], description: "Show one durable queue entry." },
  { tool: "cw_sched_plan", capability: "sched.plan", requiredArgs: [], properties: ["cwd"], description: "Read-only control-plane lease plan for the queue+policy+now." },
  { tool: "cw_sched_lease", capability: "sched.lease", requiredArgs: [], properties: ["cwd", "limit"], description: "Claim eligible queue entries as leases (concurrency-bounded)." },
  { tool: "cw_sched_release", capability: "sched.release", requiredArgs: [], properties: ["cwd", "leaseId", "failed", "reason"], description: "Release a held lease (failed -> retry/backoff or park)." },
  { tool: "cw_sched_complete", capability: "sched.complete", requiredArgs: [], properties: ["cwd", "leaseId"], description: "Complete a held lease (terminal success)." },
  { tool: "cw_sched_reclaim", capability: "sched.reclaim", requiredArgs: [], properties: ["cwd"], description: "Reclaim expired leases (each counts a failed attempt)." },
  { tool: "cw_sched_reset", capability: "sched.reset", requiredArgs: [], properties: ["cwd", "id"], description: "Reset a parked entry to ready (operator recovery)." },
  { tool: "cw_sched_policy_show", capability: "sched.policy.show", requiredArgs: [], properties: ["cwd"], description: "Show the scheduling policy (file or default)." },
  { tool: "cw_sched_policy_set", capability: "sched.policy.set", requiredArgs: [], properties: ["cwd", "maxConcurrent", "maxAttempts", "leaseTtlMs", "backoffBaseMs", "backoffFactor", "backoffCapMs"], description: "Set scheduling policy fields (concurrency/attempts/backoff/TTL)." },
  { tool: "cw_gc_plan", capability: "gc.plan", requiredArgs: [], properties: ["cwd", "scope", "runId", "reclaimAfterArchiveDays", "keepScratch", "keepSnapshots"], description: "Dry-run plan of run reclamation (per-kind bytes + capability downgrade); frees nothing." },
  { tool: "cw_gc_run", capability: "gc.run", requiredArgs: [], properties: ["cwd", "scope", "runId", "reclaimAfterArchiveDays", "keepScratch", "keepSnapshots", "limit", "actor"], description: "Execute the write-ahead reclamation transaction (skeleton -> tombstone -> fsync -> free)." },
  { tool: "cw_gc_verify", capability: "gc.verify", requiredArgs: ["runId"], properties: ["cwd", "scope", "runId"], description: "Re-prove a reclaimed run: skeleton-complete, tombstone chain untampered, artifacts reconstructable." },
  { tool: "cw_clones_list", capability: "clones.list", requiredArgs: [], properties: [], description: "List the cached remote-source checkouts that --link/URL reviews populate (origin URL, kind, commit, age, bytes). Read-only." },
  { tool: "cw_clones_gc", capability: "clones.gc", requiredArgs: [], properties: ["olderThanDays", "all"], description: "Reclaim cached remote-source checkouts: a TTL sweep (--older-than-days, default 30) or --all. Deletes only inside the clones cache." },
  { tool: "cw_orphans_list", capability: "orphans.list", requiredArgs: [], properties: ["cwd", "scope"], description: "List run directories under .cw/runs/ that the run registry cannot see (no state.json — a killed/interrupted process never wrote one), with age + bytes. Read-only." },
  { tool: "cw_orphans_gc", capability: "orphans.gc", requiredArgs: [], properties: ["cwd", "scope", "minAgeMinutes", "all"], description: "Reclaim orphan run directories (no state.json): an age sweep (--min-age-minutes, default 60) or --all. Deletes only inside a scanned repo's .cw/runs/, never a run the registry knows about." },
  { tool: "cw_telemetry_verify", capability: "telemetry.verify", requiredArgs: ["runId"], properties: ["cwd", "runId", "pubkey"], description: "Re-prove a run's telemetry attestation ledger offline: chain linkage + independent hash recompute, and (with --pubkey / CW_AGENT_ATTEST_PUBKEY) re-verify each attested hop's ed25519 signature against the public key." },
  { tool: "cw_history", capability: "history", requiredArgs: [], properties: ["cwd", "scope", "app", "status", "limit", "offset"], description: "Read a cross-repo unified run timeline (newest first)." },
];

/** Real handlers implemented at THIS milestone, keyed by capability id.
 *  Every tool row not listed here gets `notYetImplemented`. Kept as a
 *  small side table (rather than inlined into MCP_TOOL_DATA above) so the
 *  196-row literal above stays a pure, mechanically-checkable transcript
 *  of the spec table — handler wiring is a separate, obviously-later-
 *  editable concern. */
const MCP_REAL_HANDLERS: Record<string, (args: Record<string, unknown>) => unknown> = {
  list: () => listBundledWorkflows(),
  "sandbox.list": () => listBundledSandboxProfiles(),
  status: (args) => statusPayload(optionalString(args.runId)),
};

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

// ---------------------------------------------------------------------
// Real, minimal capability bodies (shared by both front doors when both
// are wired; `list`/`sandbox.list`/`status` happen to share one function
// today, but the row type keeps `cli.handler`/`mcp.handler` independent
// per byte-compat item 5, so a later milestone can split any one of
// these into two genuinely different functions without a table reshape).
// ---------------------------------------------------------------------

export interface WorkflowSummary {
  id: string;
  title: string;
  summary: string;
  file: string;
}

/** PLACEHOLDER (milestone 12, workflow-apps) — the real `listWorkflows`
 *  discovers every `apps/*\/workflow.js` + legacy `workflows/*.workflow.js`
 *  on disk (10 bundled apps in the old build; see SPEC/cli-probe.md). This
 *  milestone reproduces only the observable SHAPE (id/title/summary/file,
 *  non-empty array) that mcp-basic.case.js and cli/dispatch.ts's `search`
 *  placeholder need, not the real app directory scan. */
export function listBundledWorkflows(): WorkflowSummary[] {
  return [
    {
      id: "workflow-app-framework-demo",
      title: "Workflow App framework Demo",
      summary: "Small framework app showing inputs, phases, evidence gates, and sandbox profile hints.",
      file: "apps/workflow-app-framework-demo/workflow.js",
    },
  ];
}

export interface SandboxProfileSummary {
  schemaVersion: 1;
  id: string;
  title: string;
}

/** PLACEHOLDER (milestone 5, execution-backend/sandbox) — the real
 *  `sandbox.list` resolves and stamps each of the 4 bundled profiles
 *  (default/readonly/workspace-write/locked-down) with real path lists
 *  via `resolveSandboxProfile` (SPEC/execution-backend.md). This
 *  milestone reproduces only the id/title/schemaVersion subset that
 *  mcp-basic.case.js checks. */
export function listBundledSandboxProfiles(): SandboxProfileSummary[] {
  return [
    { schemaVersion: 1, id: "default", title: "Default Worker Boundary" },
    { schemaVersion: 1, id: "readonly", title: "Readonly Workspace" },
    { schemaVersion: 1, id: "workspace-write", title: "Workspace Write" },
    { schemaVersion: 1, id: "locked-down", title: "Locked Down" },
  ];
}

/** PLACEHOLDER (milestone 3, state kernel) — the real `status` with no
 *  run id reads `runner.status`/`formatOperatorStatus`; SPEC/cli-
 *  surface.md pins the no-id JSON shape exactly (`{runId:null,
 *  nextActions}`), reproduced here literally since it needs no run state
 *  at all. A real runId is not yet resolvable at this milestone. */
export function statusPayload(runId: string | undefined): unknown {
  if (!runId) {
    return {
      runId: null,
      nextActions: [
        {
          command: "node scripts/cw.js plan <workflow-id> --repo <path>",
          reason: "No run id is available yet; create a workflow run before dispatching or recording evidence.",
          priority: "high",
        },
      ],
    };
  }
  throw new CapabilityNotImplementedError("status");
}

// ---------------------------------------------------------------------
// Public table-derived API
// ---------------------------------------------------------------------

function buildMcpBinding(row: McpToolRow): McpBinding {
  const handler = MCP_REAL_HANDLERS[row.capability] ?? notYetImplemented(row.capability);
  return {
    tool: row.tool,
    requiredArgs: row.requiredArgs.length ? row.requiredArgs : undefined,
    properties: row.properties,
    description: row.description,
    handler,
  };
}

/** The full capability table: one row per MCP tool (196, per SPEC/mcp.md),
 *  in the exact source order `tools/list` must report. CLI bindings are
 *  layered on top for the small set of capabilities this milestone also
 *  exposes on the CLI front door (see `CLI_ROWS` below); every other row
 *  is MCP-only AT THIS MILESTONE (not a permanent `mcp-only` declaration —
 *  just not yet CLI-wired; later milestones add the `cli` binding without
 *  touching this array's mcp side). */
export const REGISTRY: Capability[] = MCP_TOOL_DATA.map((row) => ({
  capability: row.capability,
  summary: row.description,
  surface: "both" as ParitySurface,
  mcp: buildMcpBinding(row),
}));

const REGISTRY_BY_CAPABILITY: Map<string, Capability> = new Map(REGISTRY.map((row) => [row.capability, row]));

/** Attach (or replace) a CLI binding for an already-declared MCP capability.
 *  Used once below to wire `list`/`status`/`sandbox.list` onto the CLI
 *  front door too, without duplicating their row data. */
function attachCliBinding(capability: string, cli: CliBinding): void {
  const row = REGISTRY_BY_CAPABILITY.get(capability);
  if (!row) throw new Error(`capability-table: cannot attach cli binding to undeclared capability ${capability}`);
  row.cli = cli;
}

/** Declare a capability that is CLI-only at this milestone (`help`,
 *  `version` — both are permanently `cli-only` per SPEC/mcp.md's
 *  declared one-surface list, so no mcp row is created for them). */
function addCliOnlyCapability(capability: string, summary: string, cli: CliBinding, reason: string): void {
  const row: Capability = { capability, summary, surface: "cli-only", cli, reason };
  REGISTRY.push(row);
  REGISTRY_BY_CAPABILITY.set(capability, row);
}

/** Returns the declared row for a capability id, or undefined. */
export function findCapability(capability: string): Capability | undefined {
  return REGISTRY_BY_CAPABILITY.get(capability);
}

/** Returns the declared row whose `cli.path` matches `path` exactly
 *  (path[0] is the verb). Used by cli/dispatch.ts's generic executor. */
export function findCapabilityByCliPath(path: string[]): Capability | undefined {
  for (const row of REGISTRY) {
    if (row.cli && row.cli.path.length === path.length && row.cli.path.every((p, i) => p === path[i])) {
      return row;
    }
  }
  return undefined;
}

/** A capability row known to carry a `cli` binding (narrowed for callers
 *  like `cliCapabilities()` below, so `.cli` needs no non-null assertion
 *  at the call site). */
export type CliCapability = Capability & { cli: CliBinding };

/** Every capability row that declares a `cli` binding, in registry order.
 *  Used to derive `formatCommandHelp`'s per-verb subcommand rows. */
export function cliCapabilities(): CliCapability[] {
  return REGISTRY.filter((row): row is CliCapability => Boolean(row.cli));
}

/** `tools/list`'s exact array, in the pinned source order. */
export function mcpToolDefinitions(): McpToolDefinition[] {
  const definitions: McpToolDefinition[] = [];
  for (const row of REGISTRY) {
    if (!row.mcp) continue;
    const overrides = PROPERTY_OVERRIDES[row.mcp.tool] ?? {};
    const properties: Record<string, McpPropertySchema> = {};
    for (const propName of row.mcp.properties) {
      properties[propName] = overrides[propName] ?? stringProperty(propName);
    }
    definitions.push({
      name: row.mcp.tool,
      description: row.mcp.description,
      inputSchema: { type: "object", properties, additionalProperties: true },
    });
  }
  return definitions;
}

/** Every declared MCP tool name, in `tools/list` order. */
export function declaredMcpTools(): string[] {
  return REGISTRY.filter((row) => row.mcp).map((row) => row.mcp!.tool);
}

/** Look up a capability row by its MCP tool name. */
export function findCapabilityByMcpTool(tool: string): Capability | undefined {
  return REGISTRY.find((row) => row.mcp && row.mcp.tool === tool);
}

// ---------------------------------------------------------------------
// CLI bindings wired at THIS milestone (version, list, status,
// sandbox.list). `version` is cli-only per SPEC/mcp.md's declared
// one-surface list (`help` is handled directly by cli/entry.ts's
// top-level flag redirect, same as milestone 1 — it is not itself a
// dispatchable command row); `list`/`status`/`sandbox.list` reuse the mcp
// row's capability id and get a cli binding layered on top. Every handler
// below returns a `CliHandlerResult`; core/ never touches process.stdout
// or process.exitCode directly (see v2/PLAN.md's core/shell split) —
// cli/dispatch.ts's generic executor performs the actual write.
// ---------------------------------------------------------------------

import { CURRENT_COOL_WORKFLOW_VERSION } from "./version";

addCliOnlyCapability(
  "version",
  "Print the current cool-workflow version.",
  {
    path: ["version"],
    jsonMode: "default",
    handler: () => ({ text: `${CURRENT_COOL_WORKFLOW_VERSION}\n` }),
  },
  "version is a local, no-run-state print; the old build never gave it an MCP peer."
);

attachCliBinding("list", {
  path: ["list"],
  jsonMode: "default",
  handler: () => ({ json: listBundledWorkflows() }),
});

attachCliBinding("status", {
  path: ["status"],
  jsonMode: "flag",
  handler: (args) => ({ json: statusPayload(args.positionals[0]) }),
});

attachCliBinding("sandbox.list", {
  path: ["sandbox", "list"],
  jsonMode: "default",
  handler: () => ({ json: listBundledSandboxProfiles() }),
});

// ---------------------------------------------------------------------
// MILESTONE 3 (state kernel) CLI bindings: state.check, migration.list|
// check|prove, node.list|show|graph|snapshot|diff|replay|replay.verify.
// Handler BODIES live in shell/state-cli.ts (impure — they read/write
// run state on disk); this table only wires argv shape -> handler call
// and the row's own exit-code rule, per cli/dispatch.ts's generic
// executor contract. `required`/`optionalArg` are cli/io.ts's shared
// coercion helpers, imported here so the wiring stays a thin adapter
// (Usage-error strings copied byte-for-byte from the old build's
// handlers/*.ts).
// ---------------------------------------------------------------------

import { required } from "../cli/io";
import {
  checkState,
  graphNodes,
  listNodes,
  migrationCheck,
  migrationList,
  migrationProve,
  nodeDiffCli,
  nodeReplayCli,
  nodeReplayVerifyCli,
  nodeSnapshotCli,
  showNode,
} from "../shell/state-cli";

attachCliBinding("state.check", {
  path: ["state", "check"],
  jsonMode: "default",
  handler: (args) => {
    const runId = required(args.positionals[0], "run id");
    const report = checkState(runId, args.options);
    return { json: report, exitCode: report.status === "unsupported" ? 1 : undefined };
  },
});

attachCliBinding("migration.list", {
  path: ["migration", "list"],
  jsonMode: "default",
  handler: () => ({ json: migrationList() }),
});

attachCliBinding("migration.check", {
  path: ["migration", "check"],
  jsonMode: "default",
  handler: (args) => {
    const target = required(args.positionals[0], "target (run-id or state/app file)");
    const report = migrationCheck(target, args.options);
    return { json: report, exitCode: report.status === "unsupported" ? 1 : undefined };
  },
});

attachCliBinding("migration.prove", {
  path: ["migration", "prove"],
  jsonMode: "default",
  handler: (args) => {
    const target = required(args.positionals[0], "target (run-id or state/app file)");
    const proof = migrationProve(target, args.options);
    return { json: proof, exitCode: proof.pass ? undefined : 1 };
  },
});

attachCliBinding("node.list", {
  path: ["node", "list"],
  jsonMode: "default",
  handler: (args) => ({ json: listNodes(required(args.positionals[0], "run id"), args.options) }),
});

attachCliBinding("node.show", {
  path: ["node", "show"],
  jsonMode: "default",
  handler: (args) => {
    const runId = required(args.positionals[0], "run id");
    const nodeId = required(args.positionals[1], "node id");
    return { json: showNode(runId, nodeId, args.options) };
  },
});

attachCliBinding("node.graph", {
  path: ["node", "graph"],
  jsonMode: "default",
  handler: (args) => ({ json: graphNodes(required(args.positionals[0], "run id"), args.options) }),
});

attachCliBinding("node.snapshot", {
  path: ["node", "snapshot"],
  jsonMode: "default",
  handler: (args) => {
    const runId = required(args.positionals[0], "run id");
    const nodeId = required(args.positionals[1], "node id");
    return { json: nodeSnapshotCli(runId, nodeId, args.options) };
  },
});

attachCliBinding("node.diff", {
  path: ["node", "diff"],
  jsonMode: "default",
  handler: (args) => {
    const runId = required(args.positionals[0], "run id");
    const baselineSnapshotId = required(args.positionals[1], "baseline snapshot id");
    const candidateSnapshotId = required(args.positionals[2], "candidate snapshot id");
    return { json: nodeDiffCli(runId, baselineSnapshotId, candidateSnapshotId, args.options) };
  },
});

attachCliBinding("node.replay", {
  path: ["node", "replay"],
  jsonMode: "default",
  handler: (args) => {
    const runId = required(args.positionals[0], "run id");
    const snapshotId = required(args.positionals[1], "snapshot id");
    return { json: nodeReplayCli(runId, snapshotId, args.options) };
  },
});

attachCliBinding("node.replay.verify", {
  path: ["node", "verify"],
  jsonMode: "default",
  handler: (args) => {
    const runId = required(args.positionals[0], "run id");
    const replayId = required(args.positionals[1], "replay id");
    const verdict = nodeReplayVerifyCli(runId, replayId, args.options);
    return { json: verdict, exitCode: verdict.pass ? undefined : 1 };
  },
});

// `contract.show` is not yet a declared MCP_TOOL_DATA row with a CLI peer
// wired here (it IS in MCP_TOOL_DATA already); no milestone-3 conformance
// case reaches it, so it is intentionally left on its placeholder handler
// until a case demands it — avoids speculative, untested wiring.
