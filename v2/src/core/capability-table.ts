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
 *  groups by); `jsonMode` mirrors the old registry's `CliJsonMode`.
 *
 *  `helpPath` — OPTIONAL display-only override for `cw help <verb>`'s
 *  per-row command column, used ONLY when a capability's real dispatch
 *  `path` (what `dispatchTable` matches against) is shorter than the
 *  fuller token sequence a human help page shows — the old registry's
 *  `caseTokens` field, e.g. `backend.agent.config.show`/`.set` both
 *  dispatch on `["backend","agent"]` (the sub-action lives in a
 *  positional the handler reads) but the help page shows the full
 *  `cw backend agent config` token sequence, once per capability row. */
export interface CliBinding {
  path: string[];
  helpPath?: string[];
  jsonMode: CliJsonMode;
  /** Called with the parsed argv for this command; returns what to print
   *  (see `CliHandlerResult`) or throws on a recoverable failure (the
   *  entry point's top-level catch turns that into the `cw: <message>`
   *  stderr shape + exit 1, per cli/entry.ts's `main`). */
  handler: (args: CapabilityCliArgs) => CliHandlerResult;
  /** MILESTONE 10 addition. A 1-token `path` row (e.g. `["clones"]`) that
   *  exists ONLY to own the unknown-subcommand usage error for a verb
   *  whose real subcommands are each their own 2-token row (e.g.
   *  `clones.list` at `["clones","list"]`) must not ALSO show up as its
   *  own `cw help <verb>` line — the old build's registry never declared
   *  a row for the bare verb in this shape, only for its leaf
   *  subcommands. `cliCommandHelpRows` (core/format/help.ts) skips a row
   *  with this flag; `dispatchTable` (cli/dispatch.ts) is untouched — the
   *  1-token candidate is still tried (and still wins) exactly when no
   *  2-token candidate matches, per that file's existing reversed-
   *  candidate-order contract. */
  hiddenFromHelp?: boolean;
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
  "summary.refresh": (args) => summaryRefreshCli(required(optionalString(args.runId), "run id"), args),
  "summary.show": (args) => summaryShowCli(required(optionalString(args.runId), "run id"), args),
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

/** `cw status` / `cw_status` — SPEC/cli-surface.md pins the no-id JSON
 *  shape exactly (`{runId:null, nextActions}`); a real run id resolves to
 *  `summarizeRun`'s payload (MILESTONE 11, reporting/observability). */
export function statusPayload(runId: string | undefined, cwd?: string): unknown {
  if (!runId) {
    return { runId: null, nextActions: statusAdviseNoRun() };
  }
  const run = statusLoadRunFromCwd(runId, cwd || process.cwd());
  return statusSummarizeRun(run);
}

// Aliased on import so this milestone-3 placeholder's own local names
// (adviseNoRun/loadRunFromCwd/summarizeRun) don't collide with any later
// milestone section importing the same symbols under their own name.
import { loadRunFromCwd as statusLoadRunFromCwd } from "../shell/run-store";
import { adviseNoRun as statusAdviseNoRun, summarizeRun as statusSummarizeRun } from "../shell/operator-ux";

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

// ---------------------------------------------------------------------
// MILESTONE 4 (state-explosion summaries) CLI bindings: summary.refresh,
// summary.show. Handler BODIES live in shell/state-explosion-cli.ts
// (impure — disk reads/writes summaries under the run dir); this table
// only wires argv shape -> handler call, per cli/dispatch.ts's generic
// executor contract. Per SPEC/state-core.md's CLI verbs section: without
// `--json` both print `formatStateExplosionReport` text (jsonMode
// "flag" — text by default, JSON under --json/--format json).
// ---------------------------------------------------------------------

import { formatStateExplosionReport } from "./format/state-explosion-text";
import { summaryRefreshCli, summaryShowCli } from "../shell/state-explosion-cli";
import { wantsJson } from "../cli/io";

attachCliBinding("summary.refresh", {
  path: ["summary", "refresh"],
  jsonMode: "flag",
  handler: (args) => {
    const runId = required(args.positionals[0], "run id");
    const index = summaryRefreshCli(runId, args.options);
    // Byte-exact port of the old build's handleSummary "refresh": the
    // human-text branch re-reads via a fresh summaryShow call rather than
    // formatting the refresh's own index record (src/cli/handlers/
    // operator.ts:118-127); only computed when actually needed, so a
    // --json call does exactly the one read the old build's if/else did.
    if (wantsJson(args.options)) return { json: index };
    return { json: index, text: formatStateExplosionReport(summaryShowCli(runId, args.options)) };
  },
});

attachCliBinding("summary.show", {
  path: ["summary", "show"],
  jsonMode: "flag",
  handler: (args) => {
    const runId = required(args.positionals[0], "run id");
    const report = summaryShowCli(runId, args.options);
    return { json: report, text: formatStateExplosionReport(report) };
  },
});

// ---------------------------------------------------------------------
// MILESTONE 5 (execution backend, agent spawn, sandbox) CLI bindings:
// sandbox.list|show|validate, backend.list|show|probe,
// backend.agent.config.show|set, doctor, fix. Handler BODIES live in
// shell/exec-backend-cli.ts / shell/doctor.ts (impure — env/fs reads);
// this table only wires argv shape -> handler call, per cli/dispatch.ts's
// generic executor contract. `sandbox.list`/`backend.list` are ALREADY
// declared MCP-only rows from milestone 2 (MCP_TOOL_DATA above) — this
// section layers a `cli` binding onto them (attachCliBinding) and replaces
// their milestone-2 placeholder `mcp.handler` with the real body, exactly
// as milestones 3/4 did for their own rows.
// ---------------------------------------------------------------------

import {
  backendAgentConfigSet,
  backendAgentConfigShow,
  listBackendsCli,
  listSandboxProfilesCli,
  probeBackendCli,
  showBackendCli,
  showSandboxProfileCli,
  validateSandboxProfileCli,
} from "../shell/exec-backend-cli";
import { formatDoctorFixes, formatDoctorReport, runDoctor } from "../shell/doctor";
import { optionalArg } from "../cli/io";

attachCliBinding("sandbox.list", {
  path: ["sandbox", "list"],
  jsonMode: "default",
  handler: (args) => ({ json: listSandboxProfilesCli(args.options) }),
});
REGISTRY_BY_CAPABILITY.get("sandbox.list")!.mcp!.handler = (args) => listSandboxProfilesCli(args);

attachCliBinding("sandbox.show", {
  path: ["sandbox", "show"],
  jsonMode: "default",
  handler: (args) => ({ json: showSandboxProfileCli(required(args.positionals[0], "profile id"), args.options) }),
});
REGISTRY_BY_CAPABILITY.get("sandbox.show")!.mcp!.handler = (args) =>
  showSandboxProfileCli(required(optionalArg(args.profileId), "profile id"), args);

attachCliBinding("sandbox.validate", {
  path: ["sandbox", "validate"],
  jsonMode: "default",
  handler: (args) => {
    const result = validateSandboxProfileCli(required(args.positionals[0], "profile file"), args.options);
    return { json: result, exitCode: result.valid ? undefined : 1 };
  },
});
REGISTRY_BY_CAPABILITY.get("sandbox.validate")!.mcp!.handler = (args) =>
  validateSandboxProfileCli(required(optionalArg(args.profileFile), "profile file"), args);

attachCliBinding("backend.list", {
  path: ["backend", "list"],
  jsonMode: "default",
  handler: () => ({ json: listBackendsCli() }),
});
REGISTRY_BY_CAPABILITY.get("backend.list")!.mcp!.handler = () => listBackendsCli();

attachCliBinding("backend.show", {
  path: ["backend", "show"],
  jsonMode: "default",
  handler: (args) => ({ json: showBackendCli(required(args.positionals[0], "backend id")) }),
});
REGISTRY_BY_CAPABILITY.get("backend.show")!.mcp!.handler = (args) => showBackendCli(required(optionalArg(args.backendId), "backend id"));

attachCliBinding("backend.probe", {
  path: ["backend", "probe"],
  jsonMode: "default",
  handler: (args) => ({ json: probeBackendCli(args.positionals[0], args.options) }),
});
REGISTRY_BY_CAPABILITY.get("backend.probe")!.mcp!.handler = (args) => probeBackendCli(optionalArg(args.backendId), args);

// `backend agent config [show]` = read-only; `backend agent config set
// ...` = mutating. CLI path is ["backend", "agent"] (2 tokens, matching
// dispatchTable's supported path lengths); the remaining positionals
// ("config", "show"/"set") are read inside the handler, byte-exact to the
// old build's handleBackend "agent" case (src/cli/handlers/
// operational.ts:52-62).
attachCliBinding("backend.agent.config.show", {
  path: ["backend", "agent"],
  helpPath: ["backend", "agent", "config"],
  jsonMode: "default",
  handler: (args) => {
    const action = args.positionals[1];
    if (action === "set") return { json: backendAgentConfigSet(args.options) };
    return { json: backendAgentConfigShow(args.options) };
  },
});
// `backend.agent.config.set` shares the SAME dispatch path/handler as
// `.show` above (dispatchTable only supports 2-token paths, and the
// show-vs-set branch lives inside that one handler on positionals[1] —
// byte-exact to the old build's handleBackend "agent" case). This second
// attachCliBinding call exists ONLY so `cw help backend` lists both rows
// (cliCommandHelpRows iterates cliCapabilities(), one row per capability),
// matching the old registry's two declared rows sharing one caseTokens
// group; dispatchTable itself never reaches this row a second time because
// `backend.agent.config.show`'s row is found first by
// findCapabilityByCliPath's linear scan and its handler already covers
// both actions.
attachCliBinding("backend.agent.config.set", {
  path: ["backend", "agent"],
  helpPath: ["backend", "agent", "config"],
  jsonMode: "default",
  handler: (args) => {
    const action = args.positionals[1];
    if (action === "set") return { json: backendAgentConfigSet(args.options) };
    return { json: backendAgentConfigShow(args.options) };
  },
});
REGISTRY_BY_CAPABILITY.get("backend.agent.config.show")!.mcp!.handler = (args) => backendAgentConfigShow(args);
REGISTRY_BY_CAPABILITY.get("backend.agent.config.set")!.mcp!.handler = (args) => backendAgentConfigSet(args);

addCliOnlyCapability(
  "doctor",
  "Diagnose the host for setup problems (Node version, agent backend, agent binary on PATH, git, writable home/repo state) and print an actionable fix per check.",
  {
    path: ["doctor"],
    jsonMode: "flag",
    handler: (args) => {
      const report = runDoctor(args.options, process.env, String(args.options.cwd || process.cwd()));
      // Byte-exact port of src/cli/command-surface.ts:170-176: both text
      // branches are written as `${formatX(report)}\n` UNCONDITIONALLY —
      // formatDoctorFixes already ends in its own "\n" (its last joined
      // element is ""), so its case needs one MORE explicit "\n" here to
      // reproduce that unconditional append; cli/dispatch.ts's generic
      // renderer only appends "\n" when the text does NOT already end in
      // one, so a bare `formatDoctorFixes(report)` here would silently
      // drop the old build's trailing blank line.
      const text = wantsJson(args.options) ? undefined : args.options.fix ? `${formatDoctorFixes(report)}\n` : formatDoctorReport(report);
      return { json: report, text, exitCode: report.ok ? undefined : 1 };
    },
  },
  "Environment diagnostics are inherently local to the CLI host — Node version, $PATH, $CW_HOME/cwd writability. An MCP client diagnosing the server process's environment is not meaningful; agents already receive the same readiness facts in their typed results (e.g. status: blocked, agentConfigured). Inspired by `brew doctor`."
);

addCliOnlyCapability(
  "fix",
  "Print consolidated fix commands for CW setup issues.",
  {
    path: ["fix"],
    jsonMode: "human",
    handler: (args) => {
      const report = runDoctor(args.options, process.env, String(args.options.cwd || process.cwd()));
      // See the "doctor" handler's comment above: formatDoctorFixes
      // already ends in "\n", so one more explicit "\n" here reproduces
      // src/cli/command-surface.ts:126-130's unconditional
      // `${formatDoctorFixes(report)}\n` write.
      return { text: `${formatDoctorFixes(report)}\n`, exitCode: report.ok ? undefined : 1 };
    },
  },
  "Environment fix commands are local diagnostics, same reasoning as doctor."
);

// ---------------------------------------------------------------------
// MILESTONE 6+7 (combined; see v2/PLAN.md Open risk 10) CLI bindings:
// plan, quickstart, run --drive, run drive (preview), dispatch, result,
// commit. Handler BODIES live in shell/pipeline-cli.ts (impure — they
// plan/drive/dispatch/commit real run state on disk); this table only
// wires argv shape -> handler call, per cli/dispatch.ts's generic
// executor contract.
// ---------------------------------------------------------------------

import { planRun, runDrivePreview, runDriveStep, quickstartRun, dispatchRun, recordResultRun, commitRun } from "../shell/pipeline-cli";

attachCliBinding("plan", {
  path: ["plan"],
  jsonMode: "default",
  handler: (args) => {
    const workflowId = optionalArg(args.positionals[0]);
    if (!workflowId) {
      throw new Error('Missing workflow id.\n  Tip: plan an architecture review with "cw plan architecture-review"');
    }
    return { json: planRun({ ...args.options, workflowId }) };
  },
});

// `cw run <app> --drive [--once]` and `cw run drive <run-id> [--step]`
// share the single `run` dispatch path (byte-exact to the old build's
// handleRun: a run-REGISTRY subcommand keyword is never hijacked by the
// bare `--drive` intercept just because it carries its own --drive/--step
// flag). Both rows below dispatch on `["run"]`; the FIRST one registered
// (run.drive.step) is found first by findCapabilityByCliPath's linear
// scan, so its handler carries the full branch — the second row exists
// only so `cw help run` lists both capabilities.
attachCliBinding("run.drive.step", {
  path: ["run"],
  helpPath: ["run", "drive"],
  jsonMode: "default",
  handler: (args) => {
    const registrySubcommands = new Set(["drive", "search", "list", "show", "resume", "archive", "rerun", "export", "import", "verify-import", "inspect-archive", "restore"]);
    const target = args.positionals[0];
    if (args.options.drive && !registrySubcommands.has(String(target || ""))) {
      const runId = optionalArg(args.options.run) || optionalArg(args.options.runId);
      if (args.options.preview) return { json: runDrivePreview({ ...args.options, runId: runId || target }) };
      const driveArgs: Record<string, unknown> = { ...args.options };
      if (runId) driveArgs.runId = runId;
      else driveArgs.appId = target;
      return { json: runDriveStep(driveArgs) };
    }
    const [subcommand, id] = args.positionals;
    if (subcommand === "drive") {
      if (args.options.step) {
        const driveArgs: Record<string, unknown> = { ...args.options };
        if (id) driveArgs.runId = id;
        return { json: runDriveStep(driveArgs) };
      }
      return { json: runDrivePreview({ ...args.options, runId: required(id, "run id") }) };
    }
    // MILESTONE 11 (reporting/run-export) — the archive family. Handler
    // bodies live in shell/run-export-cli.ts; this arm only wires argv
    // shape -> handler call.
    if (subcommand === "export") {
      const result = runExportCli(required(id, "run id"), args.options);
      return { json: result };
    }
    if (subcommand === "import") {
      const result = runImportCli(required(id, "archive path"), args.options);
      return { json: result };
    }
    if (subcommand === "verify-import") {
      const result = runVerifyImportCli(required(id, "run id"), args.options);
      return { json: result, exitCode: args.options.strict && !result.ok ? 1 : undefined };
    }
    if (subcommand === "inspect-archive") {
      const result = runInspectArchiveCli(required(id, "archive path"), args.options);
      return { json: result, exitCode: result.ok ? undefined : 1 };
    }
    if (subcommand === "restore") {
      const result = runRestoreCli(required(id, "archive path"), args.options);
      return { json: result, exitCode: result.ok ? undefined : 1 };
    }
    throw new Error(
      "Usage: cw.js run search|list|show|resume|archive|rerun|drive|export|import|verify-import|inspect-archive|restore [run-id|archive] [--scope repo|home] [--json]  |  cw.js run <app> --drive [--once] [--incremental] [--repo R --question Q]"
    );
  },
});

// `run.drive` (the read-only MCP preview tool) has NO separate CLI dispatch
// path of its own — `cw run drive <run-id>` is served by run.drive.step's
// handler above (byte-exact to the old build's single handleRun switch,
// which the same source function backs both branches from). Attaching a
// SECOND row to cli.path ["run"] would create an ambiguous match (the
// registry-order-first row would always win over the intended one) — see
// the comment on run.drive.step above. run.drive keeps its MCP handler
// only; `cw help run` still lists it via REGISTRY, just without its own
// cli binding (a capability with no `.cli` is skipped by cliCapabilities()).
REGISTRY_BY_CAPABILITY.get("run.drive")!.mcp!.handler = (args) => runDrivePreview(args);
REGISTRY_BY_CAPABILITY.get("run.drive.step")!.mcp!.handler = (args) => runDriveStep(args);
REGISTRY_BY_CAPABILITY.get("plan")!.mcp!.handler = (args) => planRun(args);
REGISTRY_BY_CAPABILITY.get("dispatch")!.mcp!.handler = (args) => dispatchRun(args);
REGISTRY_BY_CAPABILITY.get("result")!.mcp!.handler = (args) => recordResultRun(args);
REGISTRY_BY_CAPABILITY.get("commit")!.mcp!.handler = (args) => commitRun(args);

// MILESTONE 11 — run.export/import/verify-import/inspect-archive/restore
// MCP handlers (the CLI side is served by run.drive.step's combined
// handler above; these tools are called directly by name over MCP, so
// each needs its own mcp.handler per byte-compat item 5's two-field
// row shape).
import { runExportCli, runImportCli, runVerifyImportCli, runInspectArchiveCli, runRestoreCli } from "../shell/run-export-cli";

REGISTRY_BY_CAPABILITY.get("run.export")!.mcp!.handler = (args) => runExportCli(required(optionalArg(args.runId), "run id"), args);
REGISTRY_BY_CAPABILITY.get("run.import")!.mcp!.handler = (args) => runImportCli(required(optionalArg(args.archive || args.path || args.file), "archive path"), args);
REGISTRY_BY_CAPABILITY.get("run.verify-import")!.mcp!.handler = (args) => runVerifyImportCli(required(optionalArg(args.runId), "run id"), args);
REGISTRY_BY_CAPABILITY.get("run.inspect-archive")!.mcp!.handler = (args) => runInspectArchiveCli(required(optionalArg(args.archive || args.path || args.file), "archive path"), args);
REGISTRY_BY_CAPABILITY.get("run.restore")!.mcp!.handler = (args) => runRestoreCli(required(optionalArg(args.archive || args.path || args.file), "archive path"), args);

addCliOnlyCapability(
  "quickstart",
  "ONE-COMMAND quickstart: --check preflights without writes; otherwise plan(app, default architecture-review) -> run --drive -> report in a single invocation (--preview for a read-only dry run; --bundle [--with-trust-key K] seals a completed run into a self-verified portable bundle).",
  {
    path: ["quickstart"],
    jsonMode: "default",
    handler: (args) => {
      const appId = optionalArg(args.positionals[0]);
      return { json: quickstartRun({ ...args.options, appId }) };
    },
  },
  "quickstart composes plan/runDrive/report; SPEC/mcp.md's declared cli-only list names it explicitly (no MCP peer)."
);

attachCliBinding("dispatch", {
  path: ["dispatch"],
  jsonMode: "default",
  handler: (args) => {
    const runId = required(optionalArg(args.positionals[0]), "run id");
    return { json: dispatchRun({ ...args.options, runId }) };
  },
});

attachCliBinding("result", {
  path: ["result"],
  jsonMode: "default",
  handler: (args) => {
    const runId = required(optionalArg(args.positionals[0]), "run id");
    const taskId = required(optionalArg(args.positionals[1]), "task id");
    const resultPath = required(optionalArg(args.positionals[2]), "result file path");
    return { json: recordResultRun({ ...args.options, runId, taskId, resultPath }) };
  },
});

attachCliBinding("commit", {
  path: ["commit"],
  jsonMode: "default",
  handler: (args) => {
    const runId = required(optionalArg(args.positionals[0]), "run id");
    return { json: commitRun({ ...args.options, runId }) };
  },
});

// ---------------------------------------------------------------------
// MILESTONE 8 (ledger, telemetry, trust-audit, tamper/bundle demos) CLI
// bindings: ledger propose|review|verify|apply|list, telemetry verify,
// audit verify, demo tamper|bundle, report bundle|verify-bundle. Handler
// BODIES live in shell/ledger-cli.ts, shell/telemetry-cli.ts, shell/
// audit-cli.ts, shell/demo-cli.ts, shell/report-cli.ts (impure — file/
// stdin reads, run-state loads, archive IO); this table only wires argv
// shape -> handler call, per cli/dispatch.ts's generic executor
// contract. `ledger` is intentionally absent from KNOWN_COMMANDS (see
// cli/parseargv.ts) even though dispatchTable now handles it as a real
// row — a known, preserved wart.
// ---------------------------------------------------------------------

import {
  ledgerApplyCli,
  ledgerApplyEntry,
  ledgerListCli,
  ledgerListMcp,
  ledgerProposeCli,
  ledgerProposeMcp,
  ledgerReviewCli,
  ledgerReviewMcp,
  ledgerVerifyCli,
  ledgerVerifyEntry,
} from "../shell/ledger-cli";
import { telemetryVerifyCli } from "../shell/telemetry-cli";
import { auditVerifyCli } from "../shell/audit-cli";
import { demoBundleCli, demoTamperCli } from "../shell/demo-cli";
import { formatTamperDemo, formatBundleDemo, formatTelemetryVerify } from "../shell/telemetry-demo";
import { reportBundleCli, reportVerifyBundleCli } from "../shell/report-cli";

attachCliBinding("ledger.propose", {
  path: ["ledger", "propose"],
  jsonMode: "default",
  handler: (args) => ({ json: ledgerProposeCli(args.options) }),
});
REGISTRY_BY_CAPABILITY.get("ledger.propose")!.mcp!.handler = (args) => ledgerProposeMcp(args);

attachCliBinding("ledger.review", {
  path: ["ledger", "review"],
  jsonMode: "default",
  handler: (args) => ({ json: ledgerReviewCli(args.options) }),
});
REGISTRY_BY_CAPABILITY.get("ledger.review")!.mcp!.handler = (args) => ledgerReviewMcp(args);

attachCliBinding("ledger.verify", {
  path: ["ledger", "verify"],
  jsonMode: "default",
  handler: (args) => {
    const result = ledgerVerifyCli(args.options);
    return { json: result, exitCode: result.ok ? undefined : 1 };
  },
});
REGISTRY_BY_CAPABILITY.get("ledger.verify")!.mcp!.handler = (args) => ledgerVerifyEntry(args.entry);

attachCliBinding("ledger.apply", {
  path: ["ledger", "apply"],
  jsonMode: "default",
  handler: (args) => {
    const result = ledgerApplyCli(args.options);
    return { json: result, exitCode: result.ok ? undefined : 1 };
  },
});
REGISTRY_BY_CAPABILITY.get("ledger.apply")!.mcp!.handler = (args) => ledgerApplyEntry(args.entry);

attachCliBinding("ledger.list", {
  path: ["ledger", "list"],
  jsonMode: "default",
  handler: (args) => {
    const result = ledgerListCli(args.options);
    return { json: result, exitCode: result.allOk ? undefined : 1 };
  },
});
REGISTRY_BY_CAPABILITY.get("ledger.list")!.mcp!.handler = (args) => ledgerListMcp(args);

attachCliBinding("telemetry.verify", {
  path: ["telemetry", "verify"],
  jsonMode: "flag",
  handler: (args) => {
    const runId = required(optionalArg(args.positionals[0]) || optionalArg(args.options.runId) || optionalArg(args.options.run), "run id");
    const result = telemetryVerifyCli(runId, args.options);
    return { json: result, text: formatTelemetryVerify(result), exitCode: result.verified ? undefined : 1 };
  },
});
REGISTRY_BY_CAPABILITY.get("telemetry.verify")!.mcp!.handler = (args) =>
  telemetryVerifyCli(required(optionalArg(args.runId), "run id"), args);

attachCliBinding("audit.verify", {
  path: ["audit", "verify"],
  jsonMode: "default",
  handler: (args) => {
    const runId = required(optionalArg(args.positionals[0]), "run id");
    const result = auditVerifyCli(runId, args.options);
    return { json: result, exitCode: result.verified ? undefined : 1 };
  },
});
REGISTRY_BY_CAPABILITY.get("audit.verify")!.mcp!.handler = (args) =>
  auditVerifyCli(required(optionalArg(args.runId), "run id"), args);

addCliOnlyCapability(
  "demo.tamper",
  "Prove tamper-evidence: build a signed telemetry ledger, forge it, watch verification fail offline.",
  {
    path: ["demo", "tamper"],
    jsonMode: "flag",
    handler: (args) => {
      const result = demoTamperCli();
      return { json: result, text: formatTamperDemo(result), exitCode: result.proven ? undefined : 1 };
    },
  },
  "Human-facing demonstration (operator/newcomer onboarding); the underlying integrity check is exposed programmatically as the both-surface telemetry.verify. No agent or MCP client needs to invoke a demo."
);

addCliOnlyCapability(
  "demo.bundle",
  "Prove portable-bundle verification: export a sealed report bundle, forge it two ways, watch report verify-bundle catch both offline with only the embedded public key.",
  {
    path: ["demo", "bundle"],
    jsonMode: "flag",
    handler: (args) => {
      const result = demoBundleCli();
      return { json: result, text: formatBundleDemo(result), exitCode: result.proven ? undefined : 1 };
    },
  },
  "Human-facing demonstration (operator/newcomer onboarding); the underlying integrity check is exposed programmatically as the both-surface report.verify-bundle. No agent or MCP client needs to invoke a demo."
);

attachCliBinding("report.bundle", {
  path: ["report", "bundle"],
  jsonMode: "default",
  handler: (args) => {
    const runId = required(optionalArg(args.positionals[0]), "run id");
    const result = reportBundleCli(runId, args.options);
    return { json: result, exitCode: result.ok ? undefined : 1 };
  },
});
REGISTRY_BY_CAPABILITY.get("report.bundle")!.mcp!.handler = (args) =>
  reportBundleCli(required(optionalArg(args.runId), "run id"), args);

attachCliBinding("report.verify-bundle", {
  path: ["report", "verify-bundle"],
  jsonMode: "default",
  handler: (args) => {
    const archivePath = required(optionalArg(args.positionals[0]), "bundle path");
    const result = reportVerifyBundleCli({ ...args.options, archive: archivePath });
    return { json: result, exitCode: result.ok ? undefined : 1 };
  },
});
REGISTRY_BY_CAPABILITY.get("report.verify-bundle")!.mcp!.handler = (args) => {
  const result = reportVerifyBundleCli(args);
  return result;
};

// ---------------------------------------------------------------------
// MILESTONE 9 (multi-agent, topology, coordinator/blackboard, candidate
// scoring, collaboration, eval replay) CLI bindings. Handler BODIES live
// in shell/multi-agent-cli.ts (impure — they read/write multi-agent/
// blackboard/candidate/collaboration/eval state on disk); this table
// only wires argv shape -> handler call, per cli/dispatch.ts's generic
// executor contract.
// ---------------------------------------------------------------------

import {
  approveCli,
  blackboardArtifactAddCli,
  blackboardArtifactListCli,
  blackboardContextPutCli,
  blackboardGraphCli,
  blackboardMessageListCli,
  blackboardMessagePostCli,
  blackboardResolveCli,
  blackboardSnapshotCli,
  blackboardSummaryCli,
  blackboardTopicCreateCli,
  candidateListCli,
  candidateRankCli,
  candidateRegisterCli,
  candidateRejectCli,
  candidateScoreCli,
  candidateSelectCli,
  candidateShowCli,
  candidateSummaryCli,
  commentAddCli,
  commentListCli,
  coordinatorDecisionCli,
  coordinatorSummaryCli,
  evalCompareCli,
  evalGateCli,
  evalReplayCli,
  evalReportCli,
  evalScoreCli,
  evalSnapshotCli,
  handoffCli,
  multiAgentBlackboardCli,
  multiAgentFaninCli,
  multiAgentFanoutCli,
  multiAgentGraphCli,
  multiAgentGroupCli,
  multiAgentMembershipCli,
  multiAgentRoleCli,
  multiAgentRunCli,
  multiAgentScoreCli,
  multiAgentSelectCli,
  multiAgentShowCli,
  multiAgentStatusCli,
  multiAgentStepCli,
  multiAgentSummaryCli,
  rejectCollabCli,
  reviewPolicyCli,
  reviewStatusCli,
  topologyApplyCli,
  topologyGraphCli,
  topologyList,
  topologyRunShowCli,
  topologyShowCli,
  topologySummaryCli,
  topologyValidateCli,
} from "../shell/multi-agent-cli";
attachCliBinding("topology.list", { path: ["topology", "list"], jsonMode: "default", handler: () => ({ json: topologyList() }) });
REGISTRY_BY_CAPABILITY.get("topology.list")!.mcp!.handler = () => topologyList();

attachCliBinding("topology.show", {
  path: ["topology", "show"],
  jsonMode: "default",
  handler: (args) => ({ json: topologyShowCli(required(args.positionals[0], "topology id")) }),
});
REGISTRY_BY_CAPABILITY.get("topology.show")!.mcp!.handler = (args) => topologyShowCli(required(optionalArg(args.topologyId ?? args.id), "topology id"));

attachCliBinding("topology.validate", {
  path: ["topology", "validate"],
  jsonMode: "default",
  handler: (args) => {
    const result = topologyValidateCli(required(args.positionals[0], "topology id"));
    return { json: result, exitCode: result.valid ? undefined : 1 };
  },
});
REGISTRY_BY_CAPABILITY.get("topology.validate")!.mcp!.handler = (args) => topologyValidateCli(required(optionalArg(args.topologyId ?? args.id), "topology id"));

attachCliBinding("topology.apply", {
  path: ["topology", "apply"],
  jsonMode: "default",
  handler: (args) => ({
    json: topologyApplyCli({ ...args.options, runId: required(args.positionals[0], "run id"), topologyId: required(args.positionals[1], "topology id") }),
  }),
});
REGISTRY_BY_CAPABILITY.get("topology.apply")!.mcp!.handler = (args) => topologyApplyCli({ ...args, topologyId: args.topologyId ?? args.id });

attachCliBinding("topology.summary", {
  path: ["topology", "summary"],
  jsonMode: "default",
  handler: (args) => ({ json: topologySummaryCli({ runId: required(args.positionals[0], "run id"), ...args.options }) }),
});
REGISTRY_BY_CAPABILITY.get("topology.summary")!.mcp!.handler = (args) => topologySummaryCli(args);

attachCliBinding("topology.graph", {
  path: ["topology", "graph"],
  jsonMode: "default",
  handler: (args) => ({ json: topologyGraphCli({ runId: required(args.positionals[0], "run id"), ...args.options }) }),
});
REGISTRY_BY_CAPABILITY.get("topology.graph")!.mcp!.handler = (args) => topologyGraphCli(args);

// ---- multi-agent kernel + host -----------------------------------------

attachCliBinding("multi-agent.run", {
  path: ["multi-agent", "run"],
  jsonMode: "default",
  handler: (args) => ({ json: multiAgentRunCli({ ...args.options, runId: required(args.positionals[0], "run id") }) }),
});
REGISTRY_BY_CAPABILITY.get("multi-agent.run")!.mcp!.handler = (args) => multiAgentRunCli(args);

attachCliBinding("multi-agent.status", {
  path: ["multi-agent", "status"],
  jsonMode: "default",
  handler: (args) => ({ json: multiAgentStatusCli({ runId: required(args.positionals[0], "run id"), ...args.options }) }),
});
REGISTRY_BY_CAPABILITY.get("multi-agent.status")!.mcp!.handler = (args) => multiAgentStatusCli(args);

attachCliBinding("multi-agent.step", {
  path: ["multi-agent", "step"],
  jsonMode: "default",
  handler: (args) => ({ json: multiAgentStepCli({ ...args.options, runId: required(args.positionals[0], "run id") }) }),
});
REGISTRY_BY_CAPABILITY.get("multi-agent.step")!.mcp!.handler = (args) => multiAgentStepCli(args);

attachCliBinding("multi-agent.blackboard", {
  path: ["multi-agent", "blackboard"],
  jsonMode: "default",
  handler: (args) => ({ json: multiAgentBlackboardCli({ ...args.options, runId: required(args.positionals[0], "run id") }, args.positionals[1]) }),
});
REGISTRY_BY_CAPABILITY.get("multi-agent.blackboard")!.mcp!.handler = (args) => multiAgentBlackboardCli(args, args.action as string | undefined);

attachCliBinding("multi-agent.score", {
  path: ["multi-agent", "score"],
  jsonMode: "default",
  handler: (args) => ({ json: multiAgentScoreCli({ ...args.options, runId: required(args.positionals[0], "run id"), candidate: args.options.candidate ?? args.positionals[1] }) }),
});
REGISTRY_BY_CAPABILITY.get("multi-agent.score")!.mcp!.handler = (args) => multiAgentScoreCli(args);

attachCliBinding("multi-agent.select", {
  path: ["multi-agent", "select"],
  jsonMode: "default",
  handler: (args) => ({ json: multiAgentSelectCli({ ...args.options, runId: required(args.positionals[0], "run id"), candidate: args.options.candidate ?? args.positionals[1] }) }),
});
REGISTRY_BY_CAPABILITY.get("multi-agent.select")!.mcp!.handler = (args) => multiAgentSelectCli(args);

attachCliBinding("multi-agent.summary", {
  path: ["multi-agent", "summary"],
  jsonMode: "default",
  handler: (args) => ({ json: multiAgentSummaryCli({ runId: required(args.positionals[0], "run id"), ...args.options }) }),
});
REGISTRY_BY_CAPABILITY.get("multi-agent.summary")!.mcp!.handler = (args) => multiAgentSummaryCli(args);

attachCliBinding("multi-agent.graph", {
  path: ["multi-agent", "graph"],
  jsonMode: "default",
  handler: (args) => ({ json: multiAgentGraphCli({ runId: required(args.positionals[0], "run id"), ...args.options }) }),
});
REGISTRY_BY_CAPABILITY.get("multi-agent.graph")!.mcp!.handler = (args) => multiAgentGraphCli(args);

attachCliBinding("multi-agent.run.create", {
  path: ["multi-agent", "role"],
  helpPath: ["multi-agent", "role"],
  jsonMode: "default",
  handler: (args) => ({
    json: multiAgentRoleCli({
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
    json: multiAgentGroupCli({
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
    json: multiAgentMembershipCli({
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
    json: multiAgentFanoutCli({
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
    json: multiAgentFaninCli({
      ...args.options,
      runId: required(args.positionals[0], "run id"),
      faninId: args.options.id === undefined && args.positionals.length >= 2 ? args.positionals[1] : args.options.faninId,
    }),
  }),
});
REGISTRY_BY_CAPABILITY.get("multi-agent.run.create")!.mcp!.handler = (args) => multiAgentRoleCli(args);
REGISTRY_BY_CAPABILITY.get("multi-agent.role.create")!.mcp!.handler = (args) => multiAgentRoleCli(args);
REGISTRY_BY_CAPABILITY.get("multi-agent.group.create")!.mcp!.handler = (args) => multiAgentGroupCli(args);
REGISTRY_BY_CAPABILITY.get("multi-agent.membership.create")!.mcp!.handler = (args) => multiAgentMembershipCli(args);
REGISTRY_BY_CAPABILITY.get("multi-agent.fanout.create")!.mcp!.handler = (args) => multiAgentFanoutCli(args);
REGISTRY_BY_CAPABILITY.get("multi-agent.fanin.collect")!.mcp!.handler = (args) => multiAgentFaninCli(args);

attachCliBinding("multi-agent.run.transition", {
  path: ["multi-agent", "transition"],
  jsonMode: "default",
  handler: (args) => ({ json: multiAgentRunCli({ ...args.options, runId: required(args.positionals[0], "run id") }) }),
});
REGISTRY_BY_CAPABILITY.get("multi-agent.run.transition")!.mcp!.handler = (args) => multiAgentRunCli(args);

attachCliBinding("multi-agent.run.show", {
  path: ["multi-agent", "show"],
  jsonMode: "default",
  handler: (args) => ({ json: multiAgentShowCli({ runId: required(args.positionals[0], "run id"), ...args.options }, required(args.positionals[1], "id")) }),
});
REGISTRY_BY_CAPABILITY.get("multi-agent.run.show")!.mcp!.handler = (args) => multiAgentShowCli(args, required(optionalArg(args.multiAgentRunId ?? args.id), "id"));

// ---- blackboard / coordinator -------------------------------------------

attachCliBinding("blackboard.summary", {
  path: ["blackboard", "summary"],
  jsonMode: "default",
  handler: (args) => ({ json: blackboardSummaryCli({ runId: required(args.positionals[0], "run id"), ...args.options }) }),
});
REGISTRY_BY_CAPABILITY.get("blackboard.summary")!.mcp!.handler = (args) => blackboardSummaryCli(args);

attachCliBinding("blackboard.graph", {
  path: ["blackboard", "graph"],
  jsonMode: "default",
  handler: (args) => ({ json: blackboardGraphCli({ runId: required(args.positionals[0], "run id"), ...args.options }) }),
});
REGISTRY_BY_CAPABILITY.get("blackboard.graph")!.mcp!.handler = (args) => blackboardGraphCli(args);

attachCliBinding("blackboard.resolve", {
  path: ["blackboard", "resolve"],
  jsonMode: "default",
  handler: (args) => ({ json: blackboardResolveCli({ ...args.options, runId: required(args.positionals[0], "run id") }) }),
});
REGISTRY_BY_CAPABILITY.get("blackboard.resolve")!.mcp!.handler = (args) => blackboardResolveCli(args);

attachCliBinding("blackboard.topic.create", {
  path: ["blackboard", "topic"],
  helpPath: ["blackboard", "topic", "create"],
  jsonMode: "default",
  handler: (args) => ({ json: blackboardTopicCreateCli({ ...args.options, runId: required(args.positionals[0], "run id") }) }),
});
REGISTRY_BY_CAPABILITY.get("blackboard.topic.create")!.mcp!.handler = (args) => blackboardTopicCreateCli(args);

attachCliBinding("blackboard.message.post", {
  path: ["blackboard", "message"],
  helpPath: ["blackboard", "message", "post"],
  jsonMode: "default",
  handler: (args) => {
    const action = args.positionals[1];
    if (action === "list") return { json: blackboardMessageListCli({ ...args.options, runId: required(args.positionals[0], "run id") }) };
    return { json: blackboardMessagePostCli({ ...args.options, runId: required(args.positionals[0], "run id") }) };
  },
});
attachCliBinding("blackboard.message.list", {
  path: ["blackboard", "message"],
  helpPath: ["blackboard", "message", "list"],
  jsonMode: "default",
  handler: (args) => {
    const action = args.positionals[1];
    if (action === "list") return { json: blackboardMessageListCli({ ...args.options, runId: required(args.positionals[0], "run id") }) };
    return { json: blackboardMessagePostCli({ ...args.options, runId: required(args.positionals[0], "run id") }) };
  },
});
REGISTRY_BY_CAPABILITY.get("blackboard.message.post")!.mcp!.handler = (args) => blackboardMessagePostCli(args);
REGISTRY_BY_CAPABILITY.get("blackboard.message.list")!.mcp!.handler = (args) => blackboardMessageListCli(args);

attachCliBinding("blackboard.context.put", {
  path: ["blackboard", "context"],
  helpPath: ["blackboard", "context", "put"],
  jsonMode: "default",
  handler: (args) => ({ json: blackboardContextPutCli({ ...args.options, runId: required(args.positionals[0], "run id") }) }),
});
REGISTRY_BY_CAPABILITY.get("blackboard.context.put")!.mcp!.handler = (args) => blackboardContextPutCli(args);

attachCliBinding("blackboard.artifact.add", {
  path: ["blackboard", "artifact"],
  helpPath: ["blackboard", "artifact", "add"],
  jsonMode: "default",
  handler: (args) => {
    const action = args.positionals[1];
    if (action === "list") return { json: blackboardArtifactListCli({ ...args.options, runId: required(args.positionals[0], "run id") }) };
    return { json: blackboardArtifactAddCli({ ...args.options, runId: required(args.positionals[0], "run id") }) };
  },
});
attachCliBinding("blackboard.artifact.list", {
  path: ["blackboard", "artifact"],
  helpPath: ["blackboard", "artifact", "list"],
  jsonMode: "default",
  handler: (args) => {
    const action = args.positionals[1];
    if (action === "list") return { json: blackboardArtifactListCli({ ...args.options, runId: required(args.positionals[0], "run id") }) };
    return { json: blackboardArtifactAddCli({ ...args.options, runId: required(args.positionals[0], "run id") }) };
  },
});
REGISTRY_BY_CAPABILITY.get("blackboard.artifact.add")!.mcp!.handler = (args) => blackboardArtifactAddCli(args);
REGISTRY_BY_CAPABILITY.get("blackboard.artifact.list")!.mcp!.handler = (args) => blackboardArtifactListCli(args);

attachCliBinding("blackboard.snapshot", {
  path: ["blackboard", "snapshot"],
  jsonMode: "default",
  handler: (args) => ({ json: blackboardSnapshotCli({ ...args.options, runId: required(args.positionals[0], "run id") }) }),
});
REGISTRY_BY_CAPABILITY.get("blackboard.snapshot")!.mcp!.handler = (args) => blackboardSnapshotCli(args);

attachCliBinding("coordinator.summary", {
  path: ["coordinator", "summary"],
  jsonMode: "default",
  handler: (args) => ({ json: coordinatorSummaryCli({ runId: required(args.positionals[0], "run id"), ...args.options }) }),
});
REGISTRY_BY_CAPABILITY.get("coordinator.summary")!.mcp!.handler = (args) => coordinatorSummaryCli(args);

attachCliBinding("coordinator.decision", {
  path: ["coordinator", "decision"],
  jsonMode: "default",
  handler: (args) => ({ json: coordinatorDecisionCli({ ...args.options, runId: required(args.positionals[0], "run id") }) }),
});
REGISTRY_BY_CAPABILITY.get("coordinator.decision")!.mcp!.handler = (args) => coordinatorDecisionCli(args);

// ---- candidate scoring ----------------------------------------------------

attachCliBinding("candidate.list", {
  path: ["candidate", "list"],
  jsonMode: "default",
  handler: (args) => ({ json: candidateListCli({ runId: required(args.positionals[0], "run id"), ...args.options }) }),
});
REGISTRY_BY_CAPABILITY.get("candidate.list")!.mcp!.handler = (args) => candidateListCli(args);

attachCliBinding("candidate.show", {
  path: ["candidate", "show"],
  jsonMode: "default",
  handler: (args) => ({ json: candidateShowCli({ runId: required(args.positionals[0], "run id"), ...args.options }, required(args.positionals[1], "candidate id")) }),
});
REGISTRY_BY_CAPABILITY.get("candidate.show")!.mcp!.handler = (args) => candidateShowCli(args, required(optionalArg(args.candidateId), "candidate id"));

attachCliBinding("candidate.register", {
  path: ["candidate", "register"],
  jsonMode: "default",
  handler: (args) => ({ json: candidateRegisterCli({ ...args.options, runId: required(args.positionals[0], "run id") }) }),
});
REGISTRY_BY_CAPABILITY.get("candidate.register")!.mcp!.handler = (args) => candidateRegisterCli(args);

attachCliBinding("candidate.score", {
  path: ["candidate", "score"],
  jsonMode: "default",
  handler: (args) => ({ json: candidateScoreCli({ ...args.options, runId: required(args.positionals[0], "run id") }, required(args.positionals[1], "candidate id")) }),
});
REGISTRY_BY_CAPABILITY.get("candidate.score")!.mcp!.handler = (args) => candidateScoreCli(args, required(optionalArg(args.candidateId), "candidate id"));

attachCliBinding("candidate.rank", {
  path: ["candidate", "rank"],
  jsonMode: "default",
  handler: (args) => ({ json: candidateRankCli({ runId: required(args.positionals[0], "run id"), ...args.options }) }),
});
REGISTRY_BY_CAPABILITY.get("candidate.rank")!.mcp!.handler = (args) => candidateRankCli(args);

attachCliBinding("candidate.select", {
  path: ["candidate", "select"],
  jsonMode: "default",
  handler: (args) => ({ json: candidateSelectCli({ ...args.options, runId: required(args.positionals[0], "run id") }, required(args.positionals[1], "candidate id")) }),
});
REGISTRY_BY_CAPABILITY.get("candidate.select")!.mcp!.handler = (args) => candidateSelectCli(args, required(optionalArg(args.candidateId), "candidate id"));

attachCliBinding("candidate.reject", {
  path: ["candidate", "reject"],
  jsonMode: "default",
  handler: (args) => ({ json: candidateRejectCli({ ...args.options, runId: required(args.positionals[0], "run id") }, required(args.positionals[1], "candidate id")) }),
});
REGISTRY_BY_CAPABILITY.get("candidate.reject")!.mcp!.handler = (args) => candidateRejectCli(args, required(optionalArg(args.candidateId), "candidate id"));

attachCliBinding("candidate.summary", {
  path: ["candidate", "summary"],
  jsonMode: "default",
  handler: (args) => ({ json: candidateSummaryCli({ runId: required(args.positionals[0], "run id"), ...args.options }) }),
});
REGISTRY_BY_CAPABILITY.get("candidate.summary")!.mcp!.handler = (args) => candidateSummaryCli(args);

// ---- collaboration ---------------------------------------------------------

attachCliBinding("approve", {
  path: ["approve"],
  jsonMode: "default",
  handler: (args) => ({ json: approveCli({ ...args.options, runId: required(args.positionals[1], "run id"), body: args.positionals[3] }, args.positionals[0], args.positionals[2]) }),
});
REGISTRY_BY_CAPABILITY.get("approve")!.mcp!.handler = (args) => approveCli(args);

attachCliBinding("reject", {
  path: ["reject"],
  jsonMode: "default",
  handler: (args) => ({ json: rejectCollabCli({ ...args.options, runId: required(args.positionals[1], "run id") }, args.positionals[0], args.positionals[2]) }),
});
REGISTRY_BY_CAPABILITY.get("reject")!.mcp!.handler = (args) => rejectCollabCli(args);

attachCliBinding("comment.add", {
  path: ["comment", "add"],
  jsonMode: "default",
  handler: (args) => ({ json: commentAddCli({ ...args.options, runId: required(args.positionals[1], "run id"), body: args.options.body ?? args.positionals[3] }, args.positionals[0], args.positionals[2]) }),
});
REGISTRY_BY_CAPABILITY.get("comment.add")!.mcp!.handler = (args) => commentAddCli(args);

attachCliBinding("comment.list", {
  path: ["comment", "list"],
  jsonMode: "default",
  handler: (args) => ({ json: commentListCli({ runId: required(args.positionals[0], "run id"), ...args.options }) }),
});
REGISTRY_BY_CAPABILITY.get("comment.list")!.mcp!.handler = (args) => commentListCli(args);

attachCliBinding("handoff", {
  path: ["handoff"],
  jsonMode: "default",
  handler: (args) => ({ json: handoffCli({ ...args.options, runId: required(args.positionals[1], "run id") }, args.positionals[0], args.positionals[2]) }),
});
REGISTRY_BY_CAPABILITY.get("handoff")!.mcp!.handler = (args) => handoffCli(args);

attachCliBinding("review.status", {
  path: ["review", "status"],
  jsonMode: "default",
  handler: (args) => ({ json: reviewStatusCli({ runId: required(args.positionals[0], "run id"), ...args.options }) }),
});
REGISTRY_BY_CAPABILITY.get("review.status")!.mcp!.handler = (args) => reviewStatusCli(args);

attachCliBinding("review.policy", {
  path: ["review", "policy"],
  jsonMode: "default",
  handler: (args) => ({ json: reviewPolicyCli({ ...args.options, runId: required(args.positionals[0], "run id") }) }),
});
REGISTRY_BY_CAPABILITY.get("review.policy")!.mcp!.handler = (args) => reviewPolicyCli(args);

// ---- eval replay harness ---------------------------------------------------

attachCliBinding("eval.snapshot", {
  path: ["eval", "snapshot"],
  jsonMode: "default",
  handler: (args) => ({ json: evalSnapshotCli({ runId: required(args.positionals[0], "run id"), ...args.options }) }),
});
REGISTRY_BY_CAPABILITY.get("eval.snapshot")!.mcp!.handler = (args) => evalSnapshotCli(args);

attachCliBinding("eval.replay", {
  path: ["eval", "replay"],
  jsonMode: "default",
  handler: (args) => ({ json: evalReplayCli({ snapshot: args.positionals[0], ...args.options }) }),
});
REGISTRY_BY_CAPABILITY.get("eval.replay")!.mcp!.handler = (args) => evalReplayCli(args);

attachCliBinding("eval.compare", {
  path: ["eval", "compare"],
  jsonMode: "default",
  handler: (args) => ({ json: evalCompareCli({ baseline: args.positionals[0], replay: args.positionals[1], ...args.options }) }),
});
REGISTRY_BY_CAPABILITY.get("eval.compare")!.mcp!.handler = (args) => evalCompareCli(args);

attachCliBinding("eval.score", {
  path: ["eval", "score"],
  jsonMode: "default",
  handler: (args) => ({ json: evalScoreCli({ replay: args.positionals[0], ...args.options }) }),
});
REGISTRY_BY_CAPABILITY.get("eval.score")!.mcp!.handler = (args) => evalScoreCli(args);

attachCliBinding("eval.gate", {
  path: ["eval", "gate"],
  jsonMode: "default",
  handler: (args) => {
    const gate = evalGateCli({ suite: args.positionals[0], ...args.options }) as { verdict: string };
    return { json: gate, exitCode: gate.verdict === "ship" ? undefined : 1 };
  },
});
REGISTRY_BY_CAPABILITY.get("eval.gate")!.mcp!.handler = (args) => evalGateCli(args);

attachCliBinding("eval.report", {
  path: ["eval", "report"],
  jsonMode: "default",
  handler: (args) => ({ json: evalReportCli({ replay: args.positionals[0], ...args.options }) }),
});
REGISTRY_BY_CAPABILITY.get("eval.report")!.mcp!.handler = (args) => evalReportCli(args);

// ---------------------------------------------------------------------
// MILESTONE 10 (scheduling, registry, gc/reclamation, orphans, clones)
// CLI bindings: schedule *, cw loop, routine *, sched *, registry *,
// queue *, gc *, orphans *, clones *, run search|list|show|resume|
// archive|rerun, history. Handler BODIES live in shell/registry-cli.ts,
// shell/scheduler-io.ts, shell/scheduling-io.ts, shell/reclamation-io.ts,
// shell/run-registry-io.ts (impure — disk-scanning IO); this table only
// wires argv shape -> handler call, per cli/dispatch.ts's generic
// executor contract. Usage-error strings are copied byte-for-byte from
// the old build's handlers/{scheduling,registry,maintenance,orphans,
// clones}.ts.
// ---------------------------------------------------------------------

import {
  clonesGcCli,
  clonesListCli,
  gcPlanCli,
  gcRunCli,
  gcVerifyCli,
  historyCli,
  orphansGcCli,
  orphansListCli,
  queueAddCli,
  queueDrainCli,
  queueListCli,
  queueShowCli,
  registryRefreshCli,
  registryShowCli,
  routineCreateCli,
  routineDeleteCli,
  routineEventsCli,
  routineFireCli,
  routineListCli,
  runArchiveCli,
  runListCli,
  runRerunCli,
  runResumeCli,
  runSearchCli,
  runShowCli,
  scheduleCompleteCli,
  scheduleCreateCli,
  scheduleDaemonRunForever,
  scheduleDaemonTickCli,
  scheduleDeleteCli,
  scheduleDueCli,
  scheduleHistoryCli,
  schedulePauseCli,
  scheduleResumeCli,
  scheduleRunNowCli,
  scheduleListCli,
} from "../shell/registry-cli";
import {
  formatClonesGc,
  formatClonesList,
  formatGcPlan,
  formatGcRun,
  formatGcVerify,
  formatOrphanRunsGc,
  formatOrphanRunsList,
} from "../shell/reclamation-io";
import {
  formatHistory,
  formatQueueList,
  formatRegistryReport,
  formatResume,
  formatRunSearch,
  formatRunShow,
} from "../shell/run-registry-io";
import {
  schedCompleteCli,
  schedLeaseCli,
  schedPlanCli,
  schedPolicySetCli,
  schedPolicyShowCli,
  schedReclaimCli,
  schedReleaseCli,
  schedResetCli,
} from "../shell/scheduling-io";
import fs from "node:fs";

function firstPositionalArg(args: CapabilityCliArgs, index = 0): string | undefined {
  return args.positionals[index];
}

// ---- schedule (+ cw loop) ----------------------------------------------

addCliOnlyCapability(
  "loop",
  'cw loop — sugar for "schedule create --kind loop".',
  {
    path: ["loop"],
    jsonMode: "default",
    handler: (args) => ({ json: scheduleCreateCli({ ...args.options, kind: "loop" }) }),
  },
  "loop is CLI-only sugar over schedule.create; the old build never gave it an MCP tool of its own (SPEC/scheduling-registry.md section I)."
);

addCliOnlyCapability(
  "schedule",
  "cw schedule create|list|delete|due|complete|pause|resume|run-now|history|daemon — the wall-clock scheduler.",
  {
    path: ["schedule"],
    jsonMode: "default",
    hiddenFromHelp: true,
    handler: (args) => {
      const [subcommand, id] = args.positionals;
      switch (subcommand) {
        case "create":
          return { json: scheduleCreateCli(args.options) };
        case "list":
          return { json: scheduleListCli(args.options) };
        case "delete":
          return { json: scheduleDeleteCli(required(id, "schedule id"), args.options) };
        case "due":
          return { json: scheduleDueCli(args.options) };
        case "complete":
          return { json: scheduleCompleteCli(required(id, "schedule id"), args.options) };
        case "pause":
          return { json: schedulePauseCli(required(id, "schedule id"), args.options) };
        case "resume":
          return { json: scheduleResumeCli(required(id, "schedule id"), args.options) };
        case "run-now":
          return { json: scheduleRunNowCli(required(id, "schedule id"), args.options) };
        case "history":
          return { json: scheduleHistoryCli(id, args.options) };
        case "daemon": {
          if (args.options.once) return { json: scheduleDaemonTickCli(args.options) };
          // Never returns (matches the old build's forever daemon loop);
          // the process stays alive via the DesktopSchedulerDaemon's own
          // setInterval, printing one tick line per interval.
          void scheduleDaemonRunForever(args.options);
          return {};
        }
        default:
          throw new Error("Usage: cw.js schedule create|list|delete|due|complete|pause|resume|run-now|history|daemon");
      }
    },
  },
  "cw schedule is the desktop wall-clock scheduler; SPEC/mcp.md declares its MCP peers per verb (cw_schedule_*), each wired below."
);

// ---- routine ------------------------------------------------------------

addCliOnlyCapability(
  "routine",
  "cw routine create|list|delete|fire|events — API/GitHub-style triggers.",
  {
    path: ["routine"],
    jsonMode: "default",
    hiddenFromHelp: true,
    handler: (args) => {
      const [subcommand, idOrKind, payloadPath] = args.positionals;
      switch (subcommand) {
        case "create":
          return { json: routineCreateCli(args.options) };
        case "list":
          return { json: routineListCli(args.options) };
        case "delete":
          return { json: routineDeleteCli(required(idOrKind, "trigger id"), args.options) };
        case "fire": {
          const kind = required(idOrKind, "trigger kind");
          let payload: unknown;
          try {
            payload = payloadPath ? JSON.parse(fs.readFileSync(payloadPath, "utf8")) : args.options;
          } catch (e) {
            throw new Error(`Failed to parse payload${payloadPath ? ` file "${payloadPath}"` : ""}: ${String((e && (e as Error).message) || e)}`);
          }
          return { json: routineFireCli(kind, payload, args.options) };
        }
        case "events":
          return { json: routineEventsCli(idOrKind, args.options) };
        default:
          throw new Error("Usage: cw.js routine create|list|delete|fire|events");
      }
    },
  },
  "cw routine is the API/GitHub-style trigger bridge; SPEC/mcp.md declares its MCP peers per verb (cw_routine_*), each wired below."
);
REGISTRY_BY_CAPABILITY.get("routine.create")!.mcp!.handler = (args) => routineCreateCli(args);
REGISTRY_BY_CAPABILITY.get("routine.list")!.mcp!.handler = (args) => routineListCli(args);
REGISTRY_BY_CAPABILITY.get("routine.delete")!.mcp!.handler = (args) => routineDeleteCli(required(optionalArg(args.id), "trigger id"), args);
REGISTRY_BY_CAPABILITY.get("routine.fire")!.mcp!.handler = (args) => routineFireCli(required(optionalArg(args.kind), "trigger kind"), args.payload, args);
REGISTRY_BY_CAPABILITY.get("routine.events")!.mcp!.handler = (args) => routineEventsCli(optionalArg(args.id), args);

// ---- sched (control-plane leases over the durable queue) ---------------

addCliOnlyCapability(
  "sched",
  "cw sched plan|lease|release|complete|reclaim|reset|policy [show|set] — control-plane lease scheduling over the durable queue.",
  {
    path: ["sched"],
    jsonMode: "default",
    hiddenFromHelp: true,
    handler: (args) => {
      const [subcommand, idArg] = args.positionals;
      switch (subcommand) {
        case "plan":
          return { json: schedPlanCli(args.options) };
        case "lease":
          return { json: schedLeaseCli(args.options) };
        case "release":
          return { json: schedReleaseCli(String(args.options.leaseId || idArg || ""), args.options) };
        case "complete":
          return { json: schedCompleteCli(String(args.options.leaseId || idArg || ""), args.options) };
        case "reclaim":
          return { json: schedReclaimCli(args.options) };
        case "reset":
          return { json: schedResetCli(String(args.options.id || idArg || ""), args.options) };
        case "policy": {
          const action = args.positionals[1];
          if (action === "set") return { json: schedPolicySetCli(args.options) };
          return { json: schedPolicyShowCli(args.options) };
        }
        default:
          throw new Error("Usage: cw.js sched plan|lease|release|complete|reclaim|reset|policy [show|set] [id] [--maxConcurrent N --maxAttempts N ...]");
      }
    },
  },
  "cw sched is the durable-queue lease scheduler; SPEC/mcp.md declares its MCP peers per verb (cw_sched_*), each wired below."
);
REGISTRY_BY_CAPABILITY.get("sched.plan")!.mcp!.handler = (args) => schedPlanCli(args);
REGISTRY_BY_CAPABILITY.get("sched.lease")!.mcp!.handler = (args) => schedLeaseCli(args);
REGISTRY_BY_CAPABILITY.get("sched.release")!.mcp!.handler = (args) => schedReleaseCli(String(args.leaseId || ""), args);
REGISTRY_BY_CAPABILITY.get("sched.complete")!.mcp!.handler = (args) => schedCompleteCli(String(args.leaseId || ""), args);
REGISTRY_BY_CAPABILITY.get("sched.reclaim")!.mcp!.handler = (args) => schedReclaimCli(args);
REGISTRY_BY_CAPABILITY.get("sched.reset")!.mcp!.handler = (args) => schedResetCli(String(args.id || ""), args);
REGISTRY_BY_CAPABILITY.get("sched.policy.show")!.mcp!.handler = (args) => schedPolicyShowCli(args);
REGISTRY_BY_CAPABILITY.get("sched.policy.set")!.mcp!.handler = (args) => schedPolicySetCli(args);

// ---- registry (refresh|show) --------------------------------------------

addCliOnlyCapability(
  "registry",
  "cw registry refresh|show [--scope repo|home] [--json] — the derived run registry index.",
  {
    path: ["registry"],
    jsonMode: "flag",
    hiddenFromHelp: true,
    handler: (args) => {
      const subcommand = firstPositionalArg(args);
      let report;
      if (subcommand === "refresh") report = registryRefreshCli(args.options);
      else if (subcommand === "show") report = registryShowCli(args.options);
      else throw new Error("Usage: cw.js registry refresh|show [--scope repo|home] [--json]");
      return { json: report, text: formatRegistryReport(report) };
    },
  },
  "cw registry is the derived run-registry index; SPEC/mcp.md declares its MCP peers (cw_registry_refresh|show), each wired below."
);
REGISTRY_BY_CAPABILITY.get("registry.refresh")!.mcp!.handler = (args) => registryRefreshCli(args);
REGISTRY_BY_CAPABILITY.get("registry.show")!.mcp!.handler = (args) => registryShowCli(args);

// ---- queue (add|list|drain|show) ----------------------------------------

addCliOnlyCapability(
  "queue",
  "cw queue add|list|drain|show [queue-id] [--repo PATH] [--priority N] — the durable run queue.",
  {
    path: ["queue"],
    jsonMode: "flag",
    hiddenFromHelp: true,
    handler: (args) => {
      const [subcommand, id] = args.positionals;
      switch (subcommand) {
        case "add":
          return { json: queueAddCli(args.options) };
        case "list": {
          const result = queueListCli(args.options);
          return wantsJson(args.options) ? { json: result } : { json: result, text: formatQueueList(result) };
        }
        case "drain":
          return { json: queueDrainCli(args.options) };
        case "show":
          return { json: queueShowCli(required(id, "queue id"), args.options) };
        default:
          throw new Error("Usage: cw.js queue add|list|drain|show [queue-id] [--repo PATH] [--priority N]");
      }
    },
  },
  "cw queue is the durable run queue; SPEC/mcp.md declares its MCP peers (cw_queue_add|list|drain|show), each wired below."
);
REGISTRY_BY_CAPABILITY.get("queue.add")!.mcp!.handler = (args) => queueAddCli(args);
REGISTRY_BY_CAPABILITY.get("queue.list")!.mcp!.handler = (args) => queueListCli(args);
REGISTRY_BY_CAPABILITY.get("queue.drain")!.mcp!.handler = (args) => queueDrainCli(args);
REGISTRY_BY_CAPABILITY.get("queue.show")!.mcp!.handler = (args) => queueShowCli(required(optionalArg(args.id), "queue id"), args);

// ---- gc (plan|run|verify) ------------------------------------------------

addCliOnlyCapability(
  "gc",
  "cw gc plan|run|verify [run-id] [--reclaimAfterArchiveDays N] [--keep-scratch] [--keep-snapshots] [--limit N] [--json] — run retention & provable reclamation.",
  {
    path: ["gc"],
    jsonMode: "flag",
    hiddenFromHelp: true,
    handler: (args) => {
      const [subcommand, id] = args.positionals;
      switch (subcommand) {
        case "plan": {
          const result = gcPlanCli(id, args.options);
          return wantsJson(args.options) ? { json: result } : { json: result, text: formatGcPlan(result) };
        }
        case "run": {
          const result = gcRunCli(id, args.options);
          return wantsJson(args.options) ? { json: result } : { json: result, text: formatGcRun(result) };
        }
        case "verify": {
          const result = gcVerifyCli(required(id, "run id"), args.options);
          const text = formatGcVerify(result);
          return { json: result, text, exitCode: result.reclaimed && !result.verified ? 1 : undefined };
        }
        default:
          throw new Error("Usage: cw.js gc plan|run|verify [run-id] [--reclaimAfterArchiveDays N] [--keep-scratch] [--keep-snapshots] [--limit N] [--json]");
      }
    },
  },
  "cw gc is run retention & provable reclamation; SPEC/mcp.md declares its MCP peers (cw_gc_plan|run|verify), each wired below."
);
REGISTRY_BY_CAPABILITY.get("gc.plan")!.mcp!.handler = (args) => gcPlanCli(optionalArg(args.runId), args);
REGISTRY_BY_CAPABILITY.get("gc.run")!.mcp!.handler = (args) => gcRunCli(optionalArg(args.runId), args);
REGISTRY_BY_CAPABILITY.get("gc.verify")!.mcp!.handler = (args) => gcVerifyCli(required(optionalArg(args.runId), "run id"), args);

// ---- orphans (list|gc) ---------------------------------------------------

addCliOnlyCapability(
  "orphans",
  "cw orphans list|gc — reclaim run directories a killed process never registered (no state.json).",
  {
    path: ["orphans"],
    jsonMode: "flag",
    hiddenFromHelp: true,
    handler: (args) => {
      const subcommand = firstPositionalArg(args);
      switch (subcommand) {
        case "list": {
          const result = orphansListCli(args.options);
          return wantsJson(args.options) ? { json: result } : { json: result, text: formatOrphanRunsList(result) };
        }
        case "gc": {
          const result = orphansGcCli(args.options);
          return wantsJson(args.options) ? { json: result } : { json: result, text: formatOrphanRunsGc(result) };
        }
        default:
          throw new Error(
            "Usage: cw.js orphans list [--scope repo|home] [--json] | orphans gc [--scope repo|home] [--min-age-minutes N] [--all] [--json]  (scope defaults to home: every registered repo)"
          );
      }
    },
  },
  "cw orphans reclaims killed-process run dirs with no state.json; SPEC/mcp.md declares its MCP peers (cw_orphans_list|gc), each wired below."
);
REGISTRY_BY_CAPABILITY.get("orphans.list")!.mcp!.handler = (args) => orphansListCli(args);
REGISTRY_BY_CAPABILITY.get("orphans.gc")!.mcp!.handler = (args) => orphansGcCli(args);

// ---- clones (list|gc) ------------------------------------------------------

addCliOnlyCapability(
  "clones",
  "cw clones list|gc [--older-than-days N] [--all] — the cached remote-source checkout cache.",
  {
    path: ["clones"],
    jsonMode: "flag",
    hiddenFromHelp: true,
    handler: (args) => {
      const subcommand = firstPositionalArg(args);
      switch (subcommand) {
        case "list": {
          const result = clonesListCli();
          return wantsJson(args.options) ? { json: result } : { json: result, text: formatClonesList(result) };
        }
        case "gc": {
          const result = clonesGcCli(args.options);
          return wantsJson(args.options) ? { json: result } : { json: result, text: formatClonesGc(result) };
        }
        default:
          throw new Error("Usage: cw.js clones list [--json] | clones gc [--older-than-days N] [--all] [--json]");
      }
    },
  },
  "cw clones is the cached remote-source checkout cache; SPEC/mcp.md declares its MCP peers (cw_clones_list|gc), each wired below."
);
REGISTRY_BY_CAPABILITY.get("clones.list")!.mcp!.handler = () => clonesListCli();
REGISTRY_BY_CAPABILITY.get("clones.gc")!.mcp!.handler = (args) => clonesGcCli(args);

// ---- run search|list|show|resume|archive|rerun (2-token rows, found
// BEFORE the 1-token run.drive.step row per dispatchTable's reversed
// candidate order — see that row's own comment for why the run-registry
// keyword guard set still lists these words) --------------------------

attachCliBinding("run.search", {
  path: ["run", "search"],
  jsonMode: "flag",
  handler: (args) => {
    const result = runSearchCli(args.options);
    return { json: result, text: formatRunSearch(result) };
  },
});
REGISTRY_BY_CAPABILITY.get("run.search")!.mcp!.handler = (args) => runSearchCli(args);

attachCliBinding("run.list", {
  path: ["run", "list"],
  jsonMode: "flag",
  handler: (args) => {
    const result = runListCli(args.options);
    return { json: result, text: formatRunSearch(result) };
  },
});
REGISTRY_BY_CAPABILITY.get("run.list")!.mcp!.handler = (args) => runListCli(args);

attachCliBinding("run.show", {
  path: ["run", "show"],
  jsonMode: "flag",
  handler: (args) => {
    const runId = required(args.positionals[0], "run id");
    const result = runShowCli(runId, args.options);
    return { json: result, text: formatRunShow(result) };
  },
});
REGISTRY_BY_CAPABILITY.get("run.show")!.mcp!.handler = (args) => runShowCli(required(optionalArg(args.runId), "run id"), args);

attachCliBinding("run.resume", {
  path: ["run", "resume"],
  jsonMode: "flag",
  handler: (args) => {
    const runId = required(args.positionals[0], "run id");
    const result = runResumeCli(runId, args.options);
    return { json: result, text: formatResume(result) };
  },
});
REGISTRY_BY_CAPABILITY.get("run.resume")!.mcp!.handler = (args) => runResumeCli(required(optionalArg(args.runId), "run id"), args);

attachCliBinding("run.archive", {
  path: ["run", "archive"],
  jsonMode: "default",
  handler: (args) => ({ json: runArchiveCli(optionalArg(args.positionals[0]), args.options) }),
});
REGISTRY_BY_CAPABILITY.get("run.archive")!.mcp!.handler = (args) => runArchiveCli(optionalArg(args.runId), args);

attachCliBinding("run.rerun", {
  path: ["run", "rerun"],
  jsonMode: "default",
  handler: (args) => ({ json: runRerunCli(required(args.positionals[0], "run id"), args.options) }),
});
REGISTRY_BY_CAPABILITY.get("run.rerun")!.mcp!.handler = (args) => runRerunCli(required(optionalArg(args.runId), "run id"), args);

// ---- history ---------------------------------------------------------

attachCliBinding("history", {
  path: ["history"],
  jsonMode: "flag",
  handler: (args) => {
    const result = historyCli(args.options);
    return { json: result, text: formatHistory(result) };
  },
});
REGISTRY_BY_CAPABILITY.get("history")!.mcp!.handler = (args) => historyCli(args);

// ---------------------------------------------------------------------
// MILESTONE 11 (reporting, observability, doctor/fix, workbench, run
// export/bundle) CLI bindings: report, status (real run id), graph,
// operator.status|report|graph. Handler bodies live in shell/report-
// view-cli.ts (impure — they load run state and, for `report`/`operator
// report`, re-write report.md); this table only wires argv shape ->
// handler call, per cli/dispatch.ts's generic executor contract.
// ---------------------------------------------------------------------

import { reportWriteCli, statusCli, statusSummaryText, statusFullText, operatorStatusCli, operatorReportCli, operatorReportText, graphCli, graphText } from "../shell/report-view-cli";

attachCliBinding("report", {
  path: ["report"],
  jsonMode: "flag",
  handler: (args) => {
    const runId = required(optionalArg(args.positionals[0]), "run id");
    const result = reportWriteCli(runId, args.options);
    if (args.options.show || args.options.summary) {
      const stateExplosion = formatStateExplosionReport(summaryShowCli(runId, args.options));
      return { json: result, text: `${operatorReportText(runId, args.options)}\n\n${stateExplosion}\n` };
    }
    return { json: result, text: `${result.path}\n` };
  },
});
REGISTRY_BY_CAPABILITY.get("report")!.mcp!.handler = (args) => reportWriteCli(required(optionalArg(args.runId), "run id"), args);

// `status` already carries a milestone-2 CLI binding (`attachCliBinding("status", ...)`
// above); replace its handler here with the real run-id-aware body while
// keeping the same row/path (no reshape needed — see byte-compat item 5).
REGISTRY_BY_CAPABILITY.get("status")!.cli = {
  path: ["status"],
  jsonMode: "flag",
  handler: (args) => {
    const runId = optionalArg(args.positionals[0]);
    if (!runId) return { json: statusCli(undefined, args.options), text: `No run selected\n\nNext Action\n${adviseNoRunLines()}` };
    if (args.options.summary || args.options.brief) {
      return { json: statusCli(runId, args.options), text: `${statusSummaryText(runId, args.options)}\n` };
    }
    return { json: statusCli(runId, args.options), text: `${statusFullText(runId, args.options)}\n` };
  },
};
REGISTRY_BY_CAPABILITY.get("status")!.mcp!.handler = (args) => statusCli(optionalArg(args.runId), args);

function adviseNoRunLines(): string {
  return "  node scripts/cw.js plan <workflow-id> --repo <path>\n    reason: No run id is available yet; create a workflow run before dispatching or recording evidence.\n";
}

attachCliBinding("graph", {
  path: ["graph"],
  jsonMode: "flag",
  handler: (args) => {
    const runId = required(optionalArg(args.positionals[0]), "run id");
    return { json: graphCli(runId, args.options), text: `${graphText(runId, args.options)}\n` };
  },
});
REGISTRY_BY_CAPABILITY.get("graph")!.mcp!.handler = (args) => graphCli(required(optionalArg(args.runId), "run id"), args);

attachCliBinding("operator.status", {
  path: ["operator", "status"],
  jsonMode: "flag",
  handler: (args) => {
    const runId = required(optionalArg(args.positionals[0]), "run id");
    if (args.options.summary || args.options.brief) {
      return { json: operatorStatusCli(runId, args.options), text: `${statusSummaryText(runId, args.options)}\n` };
    }
    return { json: operatorStatusCli(runId, args.options), text: `${statusFullText(runId, args.options)}\n` };
  },
});
REGISTRY_BY_CAPABILITY.get("operator.status")!.mcp!.handler = (args) => operatorStatusCli(required(optionalArg(args.runId), "run id"), args);

attachCliBinding("operator.report", {
  path: ["operator", "report"],
  jsonMode: "flag",
  handler: (args) => {
    const runId = required(optionalArg(args.positionals[0]), "run id");
    return { json: operatorReportCli(runId, args.options), text: `${operatorReportText(runId, args.options)}\n` };
  },
});
REGISTRY_BY_CAPABILITY.get("operator.report")!.mcp!.handler = (args) => operatorReportCli(required(optionalArg(args.runId), "run id"), args);

// ---- metrics.show / metrics.summary -----------------------------------

import { metricsShowCli, metricsSummaryCli } from "../shell/metrics-cli";
import { formatMetricsReport, formatMetricsSummary } from "../shell/observability";

attachCliBinding("metrics.show", {
  path: ["metrics", "show"],
  jsonMode: "flag",
  handler: (args) => {
    const runId = required(optionalArg(args.positionals[0]), "run id");
    const report = metricsShowCli(runId, args.options);
    return { json: report, text: `${formatMetricsReport(report)}\n` };
  },
});
REGISTRY_BY_CAPABILITY.get("metrics.show")!.mcp!.handler = (args) => metricsShowCli(required(optionalArg(args.runId), "run id"), args);

attachCliBinding("metrics.summary", {
  path: ["metrics", "summary"],
  jsonMode: "flag",
  handler: (args) => {
    const report = metricsSummaryCli(args.options);
    return { json: report, text: `${formatMetricsSummary(report)}\n` };
  },
});
REGISTRY_BY_CAPABILITY.get("metrics.summary")!.mcp!.handler = (args) => metricsSummaryCli(args);

// ---- worker.summary (the workbench worker panel + `cw worker summary`) ----

import { summarizeWorkers } from "../shell/worker-isolation";
import * as workerPath from "node:path";

function workerSummaryCli(args: Record<string, unknown>): ReturnType<typeof summarizeWorkers> {
  const runId = required(optionalArg(args.runId), "run id");
  const run = statusLoadRunFromCwd(runId, invocationCwdFor(args));
  return summarizeWorkers(run);
}
function invocationCwdFor(args: Record<string, unknown>): string {
  return typeof args.cwd === "string" && args.cwd.trim() ? workerPath.resolve(args.cwd) : process.cwd();
}

attachCliBinding("worker.summary", {
  path: ["worker", "summary"],
  jsonMode: "default",
  handler: (args) => ({ json: workerSummaryCli({ ...args.options, runId: args.positionals[0] }) }),
});
REGISTRY_BY_CAPABILITY.get("worker.summary")!.mcp!.handler = (args) => workerSummaryCli(args);

// ---- workbench.view / workbench.serve ---------------------------------

import { buildWorkbenchRunView } from "../shell/workbench";
import { formatWorkbenchView } from "../shell/workbench-text";
import { WorkbenchHost } from "../shell/workbench-host";

attachCliBinding("workbench.view", {
  path: ["workbench", "view"],
  jsonMode: "flag",
  handler: (args) => {
    const runId = required(optionalArg(args.positionals[0]), "run id");
    const view = buildWorkbenchRunView(runId, args.options);
    return { json: view, text: `${formatWorkbenchView(view)}\n` };
  },
});
// The MCP path is CLI-facing byte-identical (buildWorkbenchRunView takes
// the same args shape either way) — required here since `.cli` and
// `.mcp` never share a handler object per byte-compat item 5.
REGISTRY_BY_CAPABILITY.get("workbench.view")!.mcp!.handler = (args) => buildWorkbenchRunView(required(optionalArg(args.runId), "run id"), args);

attachCliBinding("workbench.serve", {
  path: ["workbench", "serve"],
  jsonMode: "flag",
  handler: (args) => {
    const host = new WorkbenchHost(args.options);
    if (args.options.once || wantsJson(args.options)) {
      return { json: host.descriptor(true) };
    }
    // The default (no --once, no --json) actually binds and blocks — this
    // returns a promise the generic dispatcher does not await today, so
    // instead we run it directly here and never return (matching the old
    // build's own blocking `serve` behavior). See cli/dispatch.ts's
    // renderCliResult: it is synchronous, so a genuinely blocking serve
    // must perform its own stdout write and keep the event loop alive
    // rather than returning a CliHandlerResult at all.
    void host.run();
    return { json: undefined };
  },
});
// `cw_workbench_serve` NEVER starts the server — the MCP path forces
// `once: true` unconditionally, per SPEC/reporting-ux.md's "one declared
// divergence": an MCP client must never be able to make the server
// process open a persistent listening socket.
REGISTRY_BY_CAPABILITY.get("workbench.serve")!.mcp!.handler = (args) => new WorkbenchHost(args).descriptor(true);

// ---- audit.summary / audit.multi-agent / audit.policy / audit.judge ----

import { auditSummaryCli, auditMultiAgentCli, auditPolicyCli, auditJudgeCli } from "../shell/audit-cli";

attachCliBinding("audit.summary", {
  path: ["audit", "summary"],
  jsonMode: "default",
  handler: (args) => ({ json: auditSummaryCli(required(args.positionals[0], "run id"), args.options) }),
});
REGISTRY_BY_CAPABILITY.get("audit.summary")!.mcp!.handler = (args) => auditSummaryCli(required(optionalArg(args.runId), "run id"), args);

attachCliBinding("audit.multi-agent", {
  path: ["audit", "multi-agent"],
  jsonMode: "default",
  handler: (args) => ({ json: auditMultiAgentCli(required(args.positionals[0], "run id"), args.options) }),
});
REGISTRY_BY_CAPABILITY.get("audit.multi-agent")!.mcp!.handler = (args) => auditMultiAgentCli(required(optionalArg(args.runId), "run id"), args);

attachCliBinding("audit.policy", {
  path: ["audit", "policy"],
  jsonMode: "default",
  handler: (args) => ({ json: auditPolicyCli(required(args.positionals[0], "run id"), args.options) }),
});
REGISTRY_BY_CAPABILITY.get("audit.policy")!.mcp!.handler = (args) => auditPolicyCli(required(optionalArg(args.runId), "run id"), args);

attachCliBinding("audit.judge", {
  path: ["audit", "judge"],
  jsonMode: "default",
  handler: (args) => ({ json: auditJudgeCli(required(args.positionals[0], "run id"), args.options) }),
});
REGISTRY_BY_CAPABILITY.get("audit.judge")!.mcp!.handler = (args) => auditJudgeCli(required(optionalArg(args.runId), "run id"), args);


