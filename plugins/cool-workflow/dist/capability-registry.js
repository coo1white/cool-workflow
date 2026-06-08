"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.CAPABILITY_REGISTRY = void 0;
exports.declaredMcpTools = declaredMcpTools;
exports.declaredCliTokens = declaredCliTokens;
exports.requiresReason = requiresReason;
exports.payloadIdenticalCapabilities = payloadIdenticalCapabilities;
exports.buildParityReport = buildParityReport;
// ---------------------------------------------------------------------------
// The registry. Grouped to mirror the CLI dispatch and the MCP tool list.
// ---------------------------------------------------------------------------
exports.CAPABILITY_REGISTRY = [
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
        capability: "list",
        summary: "List bundled CW workflows.",
        entry: "listWorkflows",
        surface: "both",
        cli: { path: ["list"], jsonMode: "default" },
        mcp: { tool: "cw_list" }
    },
    {
        capability: "init",
        summary: "Scaffold a new workflow definition.",
        entry: "init",
        surface: "both",
        cli: { path: ["init"], jsonMode: "default" },
        mcp: { tool: "cw_init" }
    },
    {
        capability: "plan",
        summary: "Create a CW run and return its canonical plan summary.",
        entry: "planSummary",
        surface: "both",
        cli: { path: ["plan"], jsonMode: "default" },
        mcp: { tool: "cw_plan" }
    },
    {
        capability: "status",
        summary: "Read run checkpoint status.",
        entry: "status",
        surface: "both",
        cli: { path: ["status"], jsonMode: "flag" },
        mcp: { tool: "cw_status" }
    },
    {
        capability: "next",
        summary: "Read the next recommended tasks for a run.",
        entry: "next",
        surface: "both",
        cli: { path: ["next"], jsonMode: "default" },
        mcp: { tool: "cw_next" }
    },
    {
        capability: "dispatch",
        summary: "Create a subagent dispatch manifest.",
        entry: "dispatch",
        surface: "both",
        cli: { path: ["dispatch"], jsonMode: "default" },
        mcp: { tool: "cw_dispatch" }
    },
    {
        capability: "result",
        summary: "Record a subagent result file against a task.",
        entry: "recordResult",
        surface: "both",
        cli: { path: ["result"], jsonMode: "default" },
        mcp: { tool: "cw_result" }
    },
    {
        capability: "commit",
        summary: "Create a verifier-gated commit or checkpoint.",
        entry: "commit",
        surface: "both",
        cli: { path: ["commit"], jsonMode: "default" },
        mcp: { tool: "cw_commit" },
        payloadIdentical: false,
        reason: "Both surfaces route through the single core entry runner.commit. The CLI emits the raw StateCommitResult for scripting (commit.id, commit.evidence, commit.gate, commit.acceptanceRationale); cw_commit emits the operator commit envelope (commitId, verifierGated, checkpoint, evidenceCount, snapshotPath, nextActions, plus the raw result under `commit`). Declared projection via capability-core.commitEnvelope, not drift."
    },
    {
        capability: "commit.summary",
        summary: "Read the structured commit summary for a run.",
        entry: "summarizeCommitRecords",
        surface: "both",
        cli: { path: ["commit", "summary"], jsonMode: "flag" },
        mcp: { tool: "cw_commit_summary" }
    },
    {
        capability: "report",
        summary: "Render a run report and return its canonical descriptor.",
        entry: "report",
        surface: "both",
        cli: { path: ["report"], jsonMode: "flag" },
        mcp: { tool: "cw_report" }
    },
    {
        capability: "graph",
        summary: "Read the structured Operator UX run graph.",
        entry: "operatorGraph",
        surface: "both",
        cli: { path: ["graph"], jsonMode: "flag" },
        mcp: { tool: "cw_operator_graph" }
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
        mcp: { tool: "cw_operator_status" }
    },
    {
        capability: "operator.report",
        summary: "Refresh and read the structured Operator UX report summary.",
        entry: "operatorReport",
        surface: "both",
        cli: { path: ["operator", "report"], jsonMode: "flag" },
        mcp: { tool: "cw_operator_report" }
    },
    // ---- app management -----------------------------------------------------
    { capability: "app.list", summary: "List CW workflow apps.", entry: "listApps", surface: "both", cli: { path: ["app", "list"], jsonMode: "default" }, mcp: { tool: "cw_app_list" } },
    { capability: "app.show", summary: "Show a CW workflow app contract.", entry: "showApp", surface: "both", cli: { path: ["app", "show"], jsonMode: "default" }, mcp: { tool: "cw_app_show" } },
    { capability: "app.validate", summary: "Validate an app by path or id.", entry: "validateApp", surface: "both", cli: { path: ["app", "validate"], jsonMode: "default" }, mcp: { tool: "cw_app_validate" } },
    { capability: "app.init", summary: "Create a CW workflow app directory.", entry: "initApp", surface: "both", cli: { path: ["app", "init"], jsonMode: "default" }, mcp: { tool: "cw_app_init" } },
    { capability: "app.package", summary: "Package an app as a JSON artifact.", entry: "packageApp", surface: "both", cli: { path: ["app", "package"], jsonMode: "default" }, mcp: { tool: "cw_app_package" } },
    { capability: "app.run", summary: "Create a run from an app id + structured inputs.", entry: "appRun", surface: "both", cli: { path: ["app", "run"], jsonMode: "default" }, mcp: { tool: "cw_app_run" } },
    // ---- state / contract / node --------------------------------------------
    { capability: "state.check", summary: "Check run-state schema compatibility.", entry: "checkState", surface: "both", cli: { path: ["state", "check"], jsonMode: "default" }, mcp: { tool: "cw_state_check" } },
    { capability: "contract.show", summary: "Show a run's pipeline contract.", entry: "showContract", surface: "both", cli: { path: ["contract", "show"], jsonMode: "default" }, mcp: { tool: "cw_contract_show" } },
    { capability: "node.list", summary: "List state nodes for a run.", entry: "listNodes", surface: "both", cli: { path: ["node", "list"], jsonMode: "default" }, mcp: { tool: "cw_node_list" } },
    { capability: "node.show", summary: "Show one state node for a run.", entry: "showNode", surface: "both", cli: { path: ["node", "show"], jsonMode: "default" }, mcp: { tool: "cw_node_show" } },
    { capability: "node.graph", summary: "Read the state-node graph for a run.", entry: "graphNodes", surface: "both", cli: { path: ["node", "graph"], jsonMode: "flag" }, mcp: { tool: "cw_node_graph" } },
    // ---- topology -----------------------------------------------------------
    { capability: "topology.list", summary: "List official topology definitions.", entry: "listTopologies", surface: "both", cli: { path: ["topology", "list"], jsonMode: "default" }, mcp: { tool: "cw_topology_list" } },
    { capability: "topology.show", summary: "Show a topology definition or run.", entry: "showTopology", surface: "both", cli: { path: ["topology", "show"], jsonMode: "default" }, mcp: { tool: "cw_topology_show" } },
    { capability: "topology.validate", summary: "Validate a topology definition.", entry: "validateTopology", surface: "both", cli: { path: ["topology", "validate"], jsonMode: "default" }, mcp: { tool: "cw_topology_validate" } },
    { capability: "topology.apply", summary: "Apply a topology to a run.", entry: "applyTopology", surface: "both", cli: { path: ["topology", "apply"], jsonMode: "default" }, mcp: { tool: "cw_topology_apply" } },
    { capability: "topology.summary", summary: "Read topology progress and next actions.", entry: "topologySummary", surface: "both", cli: { path: ["topology", "summary"], jsonMode: "flag" }, mcp: { tool: "cw_topology_summary" } },
    { capability: "topology.graph", summary: "Read topology graph nodes and edges.", entry: "topologyGraph", surface: "both", cli: { path: ["topology", "graph"], jsonMode: "flag" }, mcp: { tool: "cw_topology_graph" } },
    // ---- state-explosion summaries ------------------------------------------
    { capability: "summary.refresh", summary: "Refresh state-explosion summaries.", entry: "summaryRefresh", surface: "both", cli: { path: ["summary", "refresh"], jsonMode: "flag" }, mcp: { tool: "cw_summary_refresh" } },
    { capability: "summary.show", summary: "Read the persisted state-explosion report.", entry: "summaryShow", surface: "both", cli: { path: ["summary", "show"], jsonMode: "flag" }, mcp: { tool: "cw_summary_show" } },
    // ---- multi-agent host loop ----------------------------------------------
    { capability: "multi-agent.run", summary: "Create or attach a topology-backed multi-agent run.", entry: "hostMultiAgentRun", surface: "both", cli: { path: ["multi-agent", "run"], jsonMode: "default" }, mcp: { tool: "cw_multi_agent_run" } },
    { capability: "multi-agent.status", summary: "Read combined topology/blackboard/worker status.", entry: "hostMultiAgentStatus", surface: "both", cli: { path: ["multi-agent", "status"], jsonMode: "flag" }, mcp: { tool: "cw_multi_agent_status" } },
    { capability: "multi-agent.step", summary: "Perform one safe deterministic host step.", entry: "hostMultiAgentStep", surface: "both", cli: { path: ["multi-agent", "step"], jsonMode: "default" }, mcp: { tool: "cw_multi_agent_step" } },
    { capability: "multi-agent.blackboard", summary: "Operate on the active multi-agent blackboard.", entry: "hostMultiAgentBlackboard", surface: "both", cli: { path: ["multi-agent", "blackboard"], jsonMode: "default" }, mcp: { tool: "cw_multi_agent_blackboard" } },
    { capability: "multi-agent.score", summary: "Score a candidate with evidence.", entry: "hostMultiAgentScore", surface: "both", cli: { path: ["multi-agent", "score"], jsonMode: "default" }, mcp: { tool: "cw_multi_agent_score" } },
    { capability: "multi-agent.select", summary: "Select a candidate with the verifier gate.", entry: "hostMultiAgentSelect", surface: "both", cli: { path: ["multi-agent", "select"], jsonMode: "default" }, mcp: { tool: "cw_multi_agent_select" } },
    { capability: "multi-agent.summary", summary: "Read the multi-agent runtime summary.", entry: "multiAgentSummary", surface: "both", cli: { path: ["multi-agent", "summary"], jsonMode: "flag" }, mcp: { tool: "cw_multi_agent_summary" } },
    { capability: "multi-agent.summarize", summary: "Read the combined state-explosion report.", entry: "multiAgentSummarize", surface: "both", cli: { path: ["multi-agent", "summarize"], jsonMode: "flag" }, mcp: { tool: "cw_multi_agent_summarize" } },
    { capability: "multi-agent.graph", summary: "Read the multi-agent operator graph.", entry: "multiAgentOperatorGraph", surface: "both", cli: { path: ["multi-agent", "graph"], jsonMode: "flag" }, mcp: { tool: "cw_multi_agent_graph" } },
    { capability: "multi-agent.graph.compact", summary: "Read a compact/focused multi-agent graph view.", entry: "multiAgentGraphView", surface: "both", cli: { path: ["multi-agent", "graph"], caseTokens: ["multi-agent", "graph"], jsonMode: "flag" }, mcp: { tool: "cw_multi_agent_graph_compact" } },
    { capability: "multi-agent.dependencies", summary: "Read derived multi-agent dependency edges.", entry: "multiAgentDependencies", surface: "both", cli: { path: ["multi-agent", "dependencies"], jsonMode: "flag" }, mcp: { tool: "cw_multi_agent_dependencies" } },
    { capability: "multi-agent.failures", summary: "Read failed/blocked/rejected multi-agent records.", entry: "multiAgentFailures", surface: "both", cli: { path: ["multi-agent", "failures"], jsonMode: "flag" }, mcp: { tool: "cw_multi_agent_failures" } },
    { capability: "multi-agent.evidence", summary: "Read evidence adoption status with rationaleStatus.", entry: "multiAgentEvidence", surface: "both", cli: { path: ["multi-agent", "evidence"], jsonMode: "flag" }, mcp: { tool: "cw_multi_agent_evidence" } },
    { capability: "multi-agent.reasoning", summary: "Explain why each evidence item was adopted/rejected.", entry: "multiAgentReasoning", surface: "both", cli: { path: ["multi-agent", "reasoning"], jsonMode: "flag" }, mcp: { tool: "cw_evidence_reasoning" } },
    { capability: "multi-agent.reasoning.refresh", summary: "Refresh the durable evidence-reasoning index.", entry: "multiAgentReasoningRefresh", surface: "both", cli: { path: ["multi-agent", "reasoning"], caseTokens: ["multi-agent", "reasoning"], jsonMode: "default" }, mcp: { tool: "cw_evidence_reasoning_refresh" } },
    // ---- multi-agent lifecycle records --------------------------------------
    { capability: "multi-agent.run.create", summary: "Create a MultiAgentRun state record.", entry: "createMultiAgentRun", surface: "both", cli: { path: ["multi-agent", "run"], caseTokens: ["multi-agent", "run"], jsonMode: "default" }, mcp: { tool: "cw_multi_agent_run_create" } },
    { capability: "multi-agent.run.transition", summary: "Transition a MultiAgentRun lifecycle.", entry: "transitionMultiAgentRun", surface: "both", cli: { path: ["multi-agent", "run"], caseTokens: ["multi-agent", "run"], jsonMode: "default" }, mcp: { tool: "cw_multi_agent_run_transition" } },
    { capability: "multi-agent.run.show", summary: "Show one MultiAgentRun record.", entry: "showMultiAgentRun", surface: "both", cli: { path: ["multi-agent", "show"], jsonMode: "default" }, mcp: { tool: "cw_multi_agent_run_show" } },
    { capability: "multi-agent.role.create", summary: "Create an AgentRole record.", entry: "createAgentRole", surface: "both", cli: { path: ["multi-agent", "role"], jsonMode: "default" }, mcp: { tool: "cw_multi_agent_role_create" } },
    { capability: "multi-agent.role.show", summary: "Show one AgentRole record.", entry: "showAgentRole", surface: "both", cli: { path: ["multi-agent", "role"], caseTokens: ["multi-agent", "role"], jsonMode: "default" }, mcp: { tool: "cw_multi_agent_role_show" } },
    { capability: "multi-agent.group.create", summary: "Create an AgentGroup record.", entry: "createAgentGroup", surface: "both", cli: { path: ["multi-agent", "group"], jsonMode: "default" }, mcp: { tool: "cw_multi_agent_group_create" } },
    { capability: "multi-agent.group.show", summary: "Show one AgentGroup record.", entry: "showAgentGroup", surface: "both", cli: { path: ["multi-agent", "group"], caseTokens: ["multi-agent", "group"], jsonMode: "default" }, mcp: { tool: "cw_multi_agent_group_show" } },
    { capability: "multi-agent.membership.create", summary: "Create an AgentMembership record.", entry: "assignAgentMembership", surface: "both", cli: { path: ["multi-agent", "membership"], jsonMode: "default" }, mcp: { tool: "cw_multi_agent_membership_create" } },
    { capability: "multi-agent.membership.show", summary: "Show one AgentMembership record.", entry: "showAgentMembership", surface: "both", cli: { path: ["multi-agent", "membership"], caseTokens: ["multi-agent", "membership"], jsonMode: "default" }, mcp: { tool: "cw_multi_agent_membership_show" } },
    { capability: "multi-agent.fanout.create", summary: "Create an AgentFanout record.", entry: "createAgentFanout", surface: "both", cli: { path: ["multi-agent", "fanout"], jsonMode: "default" }, mcp: { tool: "cw_multi_agent_fanout_create" } },
    { capability: "multi-agent.fanout.show", summary: "Show one AgentFanout record.", entry: "showAgentFanout", surface: "both", cli: { path: ["multi-agent", "fanout"], caseTokens: ["multi-agent", "fanout"], jsonMode: "default" }, mcp: { tool: "cw_multi_agent_fanout_show" } },
    { capability: "multi-agent.fanin.collect", summary: "Collect an AgentFanin with evidence coverage.", entry: "collectAgentFanin", surface: "both", cli: { path: ["multi-agent", "fanin"], jsonMode: "default" }, mcp: { tool: "cw_multi_agent_fanin_collect" } },
    { capability: "multi-agent.fanin.show", summary: "Show one AgentFanin record.", entry: "showAgentFanin", surface: "both", cli: { path: ["multi-agent", "fanin"], caseTokens: ["multi-agent", "fanin"], jsonMode: "default" }, mcp: { tool: "cw_multi_agent_fanin_show" } },
    // ---- eval & replay ------------------------------------------------------
    { capability: "eval.snapshot", summary: "Create a deterministic replay snapshot.", entry: "evalSnapshot", surface: "both", cli: { path: ["eval", "snapshot"], jsonMode: "flag" }, mcp: { tool: "cw_eval_snapshot" } },
    { capability: "eval.replay", summary: "Replay a snapshot without live agents.", entry: "evalReplay", surface: "both", cli: { path: ["eval", "replay"], jsonMode: "flag" }, mcp: { tool: "cw_eval_replay" } },
    { capability: "eval.compare", summary: "Compare baseline and replay deterministically.", entry: "evalCompare", surface: "both", cli: { path: ["eval", "compare"], jsonMode: "flag" }, mcp: { tool: "cw_eval_compare" } },
    { capability: "eval.score", summary: "Score replay quality.", entry: "evalScore", surface: "both", cli: { path: ["eval", "score"], jsonMode: "flag" }, mcp: { tool: "cw_eval_score" } },
    { capability: "eval.gate", summary: "Run the eval/replay regression gate.", entry: "evalGate", surface: "both", cli: { path: ["eval", "gate"], jsonMode: "flag" }, mcp: { tool: "cw_eval_gate" } },
    { capability: "eval.report", summary: "Render an eval/replay report.", entry: "evalReport", surface: "both", cli: { path: ["eval", "report"], jsonMode: "flag" }, mcp: { tool: "cw_eval_report" } },
    // ---- blackboard & coordinator -------------------------------------------
    { capability: "blackboard.summary", summary: "Read the blackboard/coordinator summary.", entry: "blackboardSummary", surface: "both", cli: { path: ["blackboard", "summary"], jsonMode: "default" }, mcp: { tool: "cw_blackboard_summary" } },
    { capability: "blackboard.summarize", summary: "Read a blackboard digest with conflicts/evidence.", entry: "blackboardSummarize", surface: "both", cli: { path: ["blackboard", "summarize"], jsonMode: "flag" }, mcp: { tool: "cw_blackboard_summarize" } },
    { capability: "blackboard.graph", summary: "Read blackboard graph nodes and edges.", entry: "blackboardGraph", surface: "both", cli: { path: ["blackboard", "graph"], jsonMode: "default" }, mcp: { tool: "cw_blackboard_graph" } },
    { capability: "blackboard.resolve", summary: "Create or resolve a run blackboard.", entry: "resolveRunBlackboard", surface: "both", cli: { path: ["blackboard", "resolve"], jsonMode: "default" }, mcp: { tool: "cw_blackboard_resolve" } },
    { capability: "blackboard.topic.create", summary: "Create a blackboard topic.", entry: "createBlackboardTopic", surface: "both", cli: { path: ["blackboard", "topic", "create"], caseTokens: ["blackboard", "topic"], jsonMode: "default" }, mcp: { tool: "cw_blackboard_topic_create" } },
    { capability: "blackboard.message.post", summary: "Post a blackboard message.", entry: "postBlackboardMessage", surface: "both", cli: { path: ["blackboard", "message", "post"], caseTokens: ["blackboard", "message"], jsonMode: "default" }, mcp: { tool: "cw_blackboard_message_post" } },
    { capability: "blackboard.message.list", summary: "List blackboard messages.", entry: "listBlackboardMessages", surface: "both", cli: { path: ["blackboard", "message", "list"], caseTokens: ["blackboard", "message"], jsonMode: "default" }, mcp: { tool: "cw_blackboard_message_list" } },
    { capability: "blackboard.context.put", summary: "Publish a shared context frame.", entry: "putBlackboardContext", surface: "both", cli: { path: ["blackboard", "context", "put"], caseTokens: ["blackboard", "context"], jsonMode: "default" }, mcp: { tool: "cw_blackboard_context_put" } },
    { capability: "blackboard.artifact.add", summary: "Index an artifact in the blackboard.", entry: "addBlackboardArtifact", surface: "both", cli: { path: ["blackboard", "artifact", "add"], caseTokens: ["blackboard", "artifact"], jsonMode: "default" }, mcp: { tool: "cw_blackboard_artifact_add" } },
    { capability: "blackboard.artifact.list", summary: "List blackboard artifact refs.", entry: "listBlackboardArtifacts", surface: "both", cli: { path: ["blackboard", "artifact", "list"], caseTokens: ["blackboard", "artifact"], jsonMode: "default" }, mcp: { tool: "cw_blackboard_artifact_list" } },
    { capability: "blackboard.snapshot", summary: "Create a durable blackboard snapshot.", entry: "snapshotBlackboard", surface: "both", cli: { path: ["blackboard", "snapshot"], jsonMode: "default" }, mcp: { tool: "cw_blackboard_snapshot" } },
    { capability: "coordinator.summary", summary: "Read the coordinator summary.", entry: "coordinatorSummary", surface: "both", cli: { path: ["coordinator", "summary"], jsonMode: "default" }, mcp: { tool: "cw_coordinator_summary" } },
    { capability: "coordinator.decision", summary: "Record a coordinator decision.", entry: "recordCoordinatorDecision", surface: "both", cli: { path: ["coordinator", "decision"], jsonMode: "default" }, mcp: { tool: "cw_coordinator_decision" } },
    // ---- audit & trust ------------------------------------------------------
    { capability: "audit.summary", summary: "Read the trust/audit summary.", entry: "auditSummary", surface: "both", cli: { path: ["audit", "summary"], jsonMode: "default" }, mcp: { tool: "cw_audit_summary" } },
    { capability: "audit.worker", summary: "Read trust/audit for one worker.", entry: "workerAudit", surface: "both", cli: { path: ["audit", "worker"], jsonMode: "default" }, mcp: { tool: "cw_audit_worker" } },
    { capability: "audit.provenance", summary: "Inspect evidence provenance.", entry: "evidenceProvenance", surface: "both", cli: { path: ["audit", "provenance"], jsonMode: "default" }, mcp: { tool: "cw_audit_provenance" } },
    { capability: "audit.multi-agent", summary: "Read the multi-agent trust/policy/provenance audit.", entry: "auditMultiAgent", surface: "both", cli: { path: ["audit", "multi-agent"], jsonMode: "flag" }, mcp: { tool: "cw_audit_multi_agent" } },
    { capability: "audit.policy", summary: "Read role policies and permission decisions.", entry: "auditPolicy", surface: "both", cli: { path: ["audit", "policy"], jsonMode: "flag" }, mcp: { tool: "cw_audit_policy" } },
    { capability: "audit.role", summary: "Read policy/audit for one role.", entry: "auditRole", surface: "both", cli: { path: ["audit", "role"], jsonMode: "flag" }, mcp: { tool: "cw_audit_role" } },
    { capability: "audit.blackboard", summary: "Read the blackboard write audit.", entry: "auditBlackboard", surface: "both", cli: { path: ["audit", "blackboard"], jsonMode: "flag" }, mcp: { tool: "cw_audit_blackboard" } },
    { capability: "audit.judge", summary: "Read judge rationale/panel decision audit.", entry: "auditJudge", surface: "both", cli: { path: ["audit", "judge"], jsonMode: "flag" }, mcp: { tool: "cw_audit_judge" } },
    { capability: "audit.attest", summary: "Record a host/operator sandbox attestation.", entry: "recordAuditAttestation", surface: "both", cli: { path: ["audit", "attest"], jsonMode: "default" }, mcp: { tool: "cw_audit_attest" } },
    { capability: "audit.decision", summary: "Validate and record a sandbox decision.", entry: "recordAuditDecision", surface: "both", cli: { path: ["audit", "decision"], jsonMode: "default" }, mcp: { tool: "cw_audit_decision" } },
    // ---- sandbox profiles ---------------------------------------------------
    { capability: "sandbox.list", summary: "List bundled sandbox profiles.", entry: "listSandboxProfiles", surface: "both", cli: { path: ["sandbox", "list"], jsonMode: "default" }, mcp: { tool: "cw_sandbox_list" } },
    { capability: "sandbox.show", summary: "Show a resolved sandbox profile.", entry: "showSandboxProfile", surface: "both", cli: { path: ["sandbox", "show"], jsonMode: "default" }, mcp: { tool: "cw_sandbox_show" } },
    { capability: "sandbox.validate", summary: "Validate a sandbox profile JSON file.", entry: "validateSandboxProfile", surface: "both", cli: { path: ["sandbox", "validate"], jsonMode: "default" }, mcp: { tool: "cw_sandbox_validate" } },
    { capability: "sandbox.choose", summary: "Resolve and validate a sandbox profile choice.", entry: "sandboxChoose", surface: "both", cli: { path: ["sandbox", "choose"], jsonMode: "default" }, mcp: { tool: "cw_sandbox_choose" } },
    { capability: "sandbox.resolve", summary: "Alias of sandbox.choose.", entry: "sandboxChoose", surface: "both", cli: { path: ["sandbox", "resolve"], jsonMode: "default" }, mcp: { tool: "cw_sandbox_resolve" } },
    // ---- execution backends (v0.1.29) ---------------------------------------
    { capability: "backend.list", summary: "List available execution backends and their capabilities.", entry: "listBackends", surface: "both", cli: { path: ["backend", "list"], jsonMode: "default" }, mcp: { tool: "cw_backend_list" } },
    { capability: "backend.show", summary: "Show one execution backend descriptor.", entry: "showBackend", surface: "both", cli: { path: ["backend", "show"], jsonMode: "default" }, mcp: { tool: "cw_backend_show" } },
    { capability: "backend.probe", summary: "Probe execution backend readiness (live, deterministic).", entry: "probeBackend", surface: "both", cli: { path: ["backend", "probe"], jsonMode: "default" }, mcp: { tool: "cw_backend_probe" } },
    // ---- worker isolation ---------------------------------------------------
    { capability: "worker.list", summary: "List worker isolation scopes.", entry: "listWorkers", surface: "both", cli: { path: ["worker", "list"], jsonMode: "default" }, mcp: { tool: "cw_worker_list" } },
    { capability: "worker.summary", summary: "Read the structured worker summary.", entry: "summarizeWorkerRecords", surface: "both", cli: { path: ["worker", "summary"], jsonMode: "flag" }, mcp: { tool: "cw_worker_summary" } },
    { capability: "worker.show", summary: "Show one worker isolation scope.", entry: "showWorker", surface: "both", cli: { path: ["worker", "show"], jsonMode: "default" }, mcp: { tool: "cw_worker_show" } },
    { capability: "worker.manifest", summary: "Write and return a worker manifest.", entry: "showWorkerManifest", surface: "both", cli: { path: ["worker", "manifest"], jsonMode: "default" }, mcp: { tool: "cw_worker_manifest" } },
    { capability: "worker.output", summary: "Record worker output.", entry: "recordWorkerOutput", surface: "both", cli: { path: ["worker", "output"], jsonMode: "default" }, mcp: { tool: "cw_worker_output" } },
    { capability: "worker.fail", summary: "Record a structured worker failure.", entry: "recordWorkerFailure", surface: "both", cli: { path: ["worker", "fail"], jsonMode: "default" }, mcp: { tool: "cw_worker_fail" } },
    { capability: "worker.validate", summary: "Validate a worker output boundary.", entry: "validateWorker", surface: "both", cli: { path: ["worker", "validate"], jsonMode: "default" }, mcp: { tool: "cw_worker_validate" } },
    // ---- candidate scoring & selection --------------------------------------
    { capability: "candidate.list", summary: "List candidates for a run.", entry: "listCandidates", surface: "both", cli: { path: ["candidate", "list"], jsonMode: "default" }, mcp: { tool: "cw_candidate_list" } },
    { capability: "candidate.show", summary: "Show one candidate.", entry: "showCandidate", surface: "both", cli: { path: ["candidate", "show"], jsonMode: "default" }, mcp: { tool: "cw_candidate_show" } },
    { capability: "candidate.register", summary: "Register a candidate from evidence.", entry: "registerCandidate", surface: "both", cli: { path: ["candidate", "register"], jsonMode: "default" }, mcp: { tool: "cw_candidate_register" } },
    { capability: "candidate.score", summary: "Score a candidate with criteria/evidence.", entry: "scoreCandidate", surface: "both", cli: { path: ["candidate", "score"], jsonMode: "default" }, mcp: { tool: "cw_candidate_score" } },
    { capability: "candidate.rank", summary: "Rank candidates with gates.", entry: "rankCandidates", surface: "both", cli: { path: ["candidate", "rank"], jsonMode: "default" }, mcp: { tool: "cw_candidate_rank" } },
    { capability: "candidate.select", summary: "Select a candidate with the verifier gate.", entry: "selectCandidate", surface: "both", cli: { path: ["candidate", "select"], jsonMode: "default" }, mcp: { tool: "cw_candidate_select" } },
    { capability: "candidate.reject", summary: "Reject a candidate with a reason.", entry: "rejectCandidate", surface: "both", cli: { path: ["candidate", "reject"], jsonMode: "default" }, mcp: { tool: "cw_candidate_reject" } },
    { capability: "candidate.summary", summary: "Read the structured candidate summary.", entry: "summarizeCandidateOperatorRecords", surface: "both", cli: { path: ["candidate", "summary"], jsonMode: "flag" }, mcp: { tool: "cw_candidate_summary" } },
    // ---- feedback -----------------------------------------------------------
    { capability: "feedback.list", summary: "List run feedback records.", entry: "listFeedback", surface: "both", cli: { path: ["feedback", "list"], jsonMode: "default" }, mcp: { tool: "cw_feedback_list" } },
    { capability: "feedback.show", summary: "Show a run feedback record.", entry: "showFeedback", surface: "both", cli: { path: ["feedback", "show"], jsonMode: "default" }, mcp: { tool: "cw_feedback_show" } },
    { capability: "feedback.collect", summary: "Collect feedback from failed nodes.", entry: "collectFeedback", surface: "both", cli: { path: ["feedback", "collect"], jsonMode: "default" }, mcp: { tool: "cw_feedback_collect" } },
    { capability: "feedback.summary", summary: "Read the structured feedback summary.", entry: "summarizeFeedbackRecords", surface: "both", cli: { path: ["feedback", "summary"], jsonMode: "flag" }, mcp: { tool: "cw_feedback_summary" } },
    { capability: "feedback.task", summary: "Create a correction task for feedback.", entry: "createFeedbackTask", surface: "both", cli: { path: ["feedback", "task"], jsonMode: "default" }, mcp: { tool: "cw_feedback_task" } },
    { capability: "feedback.resolve", summary: "Resolve or reject feedback.", entry: "resolveFeedback", surface: "both", cli: { path: ["feedback", "resolve"], jsonMode: "default" }, mcp: { tool: "cw_feedback_resolve" } },
    // ---- scheduling ---------------------------------------------------------
    { capability: "schedule.create", summary: "Create a scheduled CW task.", entry: "scheduler.create", surface: "both", cli: { path: ["schedule", "create"], jsonMode: "default" }, mcp: { tool: "cw_schedule_create" } },
    { capability: "schedule.list", summary: "List scheduled CW tasks.", entry: "scheduler.list", surface: "both", cli: { path: ["schedule", "list"], jsonMode: "default" }, mcp: { tool: "cw_schedule_list" } },
    { capability: "schedule.delete", summary: "Delete a scheduled CW task.", entry: "scheduler.delete", surface: "both", cli: { path: ["schedule", "delete"], jsonMode: "default" }, mcp: { tool: "cw_schedule_delete" } },
    { capability: "schedule.due", summary: "List due scheduled CW tasks.", entry: "scheduler.due", surface: "both", cli: { path: ["schedule", "due"], jsonMode: "default" }, mcp: { tool: "cw_schedule_due" } },
    { capability: "schedule.complete", summary: "Mark a scheduled task complete.", entry: "scheduler.complete", surface: "both", cli: { path: ["schedule", "complete"], jsonMode: "default" }, mcp: { tool: "cw_schedule_complete" } },
    { capability: "schedule.pause", summary: "Pause a scheduled CW task.", entry: "scheduler.pause", surface: "both", cli: { path: ["schedule", "pause"], jsonMode: "default" }, mcp: { tool: "cw_schedule_pause" } },
    { capability: "schedule.resume", summary: "Resume a scheduled CW task.", entry: "scheduler.resume", surface: "both", cli: { path: ["schedule", "resume"], jsonMode: "default" }, mcp: { tool: "cw_schedule_resume" } },
    { capability: "schedule.run-now", summary: "Create an immediate scheduled-task run record.", entry: "scheduler.runNow", surface: "both", cli: { path: ["schedule", "run-now"], jsonMode: "default" }, mcp: { tool: "cw_schedule_run_now" } },
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
    { capability: "routine.delete", summary: "Delete a routine-style trigger.", entry: "triggers.delete", surface: "both", cli: { path: ["routine", "delete"], jsonMode: "default" }, mcp: { tool: "cw_routine_delete" } },
    { capability: "routine.fire", summary: "Record an API/GitHub trigger event.", entry: "triggers.fire", surface: "both", cli: { path: ["routine", "fire"], jsonMode: "default" }, mcp: { tool: "cw_routine_fire" } },
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
    { capability: "run.show", summary: "Resolve one run by id across the registry; fail closed on missing source.", entry: "runRegistry.showRun", surface: "both", cli: { path: ["run", "show"], jsonMode: "flag" }, mcp: { tool: "cw_run_show" } },
    { capability: "run.resume", summary: "Resolve a run by id and continue it from durable state.", entry: "runRegistry.resume", surface: "both", cli: { path: ["run", "resume"], jsonMode: "flag" }, mcp: { tool: "cw_run_resume" } },
    { capability: "run.archive", summary: "Archive/unarchive a run (overlay mark; never deletes source).", entry: "runRegistry.archive", surface: "both", cli: { path: ["run", "archive"], jsonMode: "default" }, mcp: { tool: "cw_run_archive" } },
    { capability: "run.rerun", summary: "Re-run a failed run as a NEW run linked to the original by provenance.", entry: "runRegistry.rerun", surface: "both", cli: { path: ["run", "rerun"], jsonMode: "default" }, mcp: { tool: "cw_run_rerun" } },
    { capability: "queue.add", summary: "Enqueue a pending/planned run with explicit ordering policy.", entry: "runRegistry.queueAdd", surface: "both", cli: { path: ["queue", "add"], jsonMode: "default" }, mcp: { tool: "cw_queue_add" } },
    { capability: "queue.list", summary: "List the durable run queue in policy order.", entry: "runRegistry.queueList", surface: "both", cli: { path: ["queue", "list"], jsonMode: "flag" }, mcp: { tool: "cw_queue_list" } },
    { capability: "queue.drain", summary: "Mark the next ready queue entries drained (the host still executes).", entry: "runRegistry.queueDrain", surface: "both", cli: { path: ["queue", "drain"], jsonMode: "default" }, mcp: { tool: "cw_queue_drain" } },
    { capability: "queue.show", summary: "Show one durable queue entry.", entry: "runRegistry.queueShow", surface: "both", cli: { path: ["queue", "show"], jsonMode: "default" }, mcp: { tool: "cw_queue_show" } },
    { capability: "history", summary: "Read a cross-repo unified run timeline (newest first).", entry: "runRegistry.history", surface: "both", cli: { path: ["history"], jsonMode: "flag" }, mcp: { tool: "cw_history" } }
];
// ---------------------------------------------------------------------------
// Derivations + the fail-closed parity report builder.
// ---------------------------------------------------------------------------
/** The MCP tool names this registry declares. */
function declaredMcpTools() {
    return exports.CAPABILITY_REGISTRY.filter((cap) => cap.mcp).map((cap) => cap.mcp.tool);
}
/** The CLI `case` tokens this registry declares (deduped). */
function declaredCliTokens() {
    const tokens = new Set();
    for (const cap of exports.CAPABILITY_REGISTRY) {
        if (!cap.cli)
            continue;
        for (const token of cap.cli.caseTokens ?? cap.cli.path)
            tokens.add(token);
    }
    return [...tokens].sort();
}
/** Whether a descriptor MUST carry a reason (surface-specific or divergent). */
function requiresReason(cap) {
    if (cap.surface !== "both")
        return true;
    if (cap.payloadIdentical === false)
        return true;
    return false;
}
/** Descriptors for the payload-identity probe: both-surface, identical payloads,
 *  read-only (safe to call on a planned run with just runId-style args). */
function payloadIdenticalCapabilities() {
    return exports.CAPABILITY_REGISTRY.filter((cap) => cap.surface === "both" && cap.payloadIdentical !== false && cap.cli && cap.mcp);
}
function lintRegistry() {
    const issues = [];
    const seenCaps = new Set();
    const seenTools = new Set();
    for (const cap of exports.CAPABILITY_REGISTRY) {
        if (seenCaps.has(cap.capability))
            issues.push(`duplicate capability id: ${cap.capability}`);
        seenCaps.add(cap.capability);
        if (cap.mcp) {
            if (seenTools.has(cap.mcp.tool))
                issues.push(`duplicate MCP tool: ${cap.mcp.tool}`);
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
function buildParityReport(input) {
    const declaredTools = new Set(declaredMcpTools());
    const actualTools = new Set(input.mcpTools);
    const declaredTokens = new Set(declaredCliTokens());
    const actualTokens = new Set(input.cliTokens);
    const missingMcpTools = [...declaredTools].filter((tool) => !actualTools.has(tool)).sort();
    const undeclaredMcpTools = [...actualTools].filter((tool) => !declaredTools.has(tool)).sort();
    const missingCliTokens = [...declaredTokens].filter((token) => !actualTokens.has(token)).sort();
    const undeclaredCliTokens = [...actualTokens].filter((token) => !declaredTokens.has(token)).sort();
    const reasonlessExceptions = exports.CAPABILITY_REGISTRY.filter((cap) => requiresReason(cap) && !(cap.reason && cap.reason.trim()))
        .map((cap) => cap.capability)
        .sort();
    const registryLint = lintRegistry();
    const ok = missingMcpTools.length === 0 &&
        undeclaredMcpTools.length === 0 &&
        missingCliTokens.length === 0 &&
        undeclaredCliTokens.length === 0 &&
        reasonlessExceptions.length === 0 &&
        registryLint.length === 0;
    return {
        ok,
        registrySize: exports.CAPABILITY_REGISTRY.length,
        missingMcpTools,
        undeclaredMcpTools,
        missingCliTokens,
        undeclaredCliTokens,
        reasonlessExceptions,
        registryLint
    };
}
