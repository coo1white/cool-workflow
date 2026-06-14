#!/usr/bin/env node
"use strict";

// Equivalence smoke for the requiredArgsForTool -> CapabilityDescriptor.requiredArgs
// fold (task: mcp-required-args-fold). The former MCP-only if-ladder in
// src/mcp-server.ts mixed explicit names, fragile substring heuristics
// (name ends with _show, then includes _role_/_group_/_membership_/_fanout_/
// _fanin_/_candidate_/_feedback_/_worker_), and an 88-entry runId literal array.
// It is now a single registry lookup over each descriptor's `requiredArgs`,
// declared once in capability-registry.ts.
//
// GOLDEN is a verbatim snapshot of the OLD if-ladder output captured at cutover
// for ALL 182 declared MCP tools. This test asserts, for every tool, that the
// descriptor-driven `requiredArgs` (empty array when absent) is byte-equal to the
// captured golden output. Any divergence between the registry and the historical
// behavior fails closed here.

const assert = require("node:assert/strict");
const { CAPABILITY_REGISTRY } = require("../dist/capability-registry");

// --- captured OLD requiredArgsForTool output, one entry per declared MCP tool.
const GOLDEN = {
  cw_list: [],
  cw_init: ["workflowId"],
  cw_plan: ["workflowId"],
  cw_status: ["runId"],
  cw_next: ["runId"],
  cw_dispatch: ["runId"],
  cw_result: ["runId"],
  cw_commit: ["runId"],
  cw_commit_summary: ["runId"],
  cw_report: ["runId"],
  cw_operator_graph: ["runId"],
  cw_operator_status: ["runId"],
  cw_operator_report: ["runId"],
  cw_app_list: [],
  cw_app_show: [],
  cw_app_validate: [],
  cw_app_init: [],
  cw_app_package: [],
  cw_app_run: ["appId"],
  cw_state_check: ["runId"],
  cw_contract_show: ["runId"],
  cw_node_list: ["runId"],
  cw_node_show: ["runId", "nodeId"],
  cw_node_graph: ["runId"],
  cw_node_snapshot: [],
  cw_node_diff: [],
  cw_node_replay: [],
  cw_node_replay_verify: [],
  cw_migration_list: [],
  cw_migration_check: [],
  cw_migration_prove: [],
  cw_topology_list: [],
  cw_topology_show: ["topologyId|id"],
  cw_topology_validate: ["topologyId|id"],
  cw_topology_apply: ["runId", "topologyId|id"],
  cw_topology_summary: ["runId"],
  cw_topology_graph: ["runId"],
  cw_summary_refresh: ["runId"],
  cw_summary_show: ["runId"],
  cw_multi_agent_run: [],
  cw_multi_agent_status: ["runId"],
  cw_multi_agent_step: ["runId"],
  cw_multi_agent_blackboard: ["runId"],
  cw_multi_agent_score: ["runId"],
  cw_multi_agent_select: ["runId"],
  cw_multi_agent_summary: ["runId"],
  cw_multi_agent_summarize: ["runId"],
  cw_multi_agent_graph: ["runId"],
  cw_multi_agent_graph_compact: ["runId"],
  cw_multi_agent_dependencies: ["runId"],
  cw_multi_agent_failures: ["runId"],
  cw_multi_agent_evidence: ["runId"],
  cw_evidence_reasoning: ["runId"],
  cw_evidence_reasoning_refresh: ["runId"],
  cw_multi_agent_run_create: ["runId"],
  cw_multi_agent_run_transition: ["runId"],
  cw_multi_agent_run_show: ["runId"],
  cw_multi_agent_role_create: ["runId"],
  cw_multi_agent_role_show: ["runId", "roleId"],
  cw_multi_agent_group_create: ["runId"],
  cw_multi_agent_group_show: ["runId", "groupId"],
  cw_multi_agent_membership_create: ["runId"],
  cw_multi_agent_membership_show: ["runId", "membershipId"],
  cw_multi_agent_fanout_create: ["runId"],
  cw_multi_agent_fanout_show: ["runId", "fanoutId"],
  cw_multi_agent_fanin_collect: ["runId"],
  cw_multi_agent_fanin_show: ["runId", "faninId"],
  cw_eval_snapshot: ["runId"],
  cw_eval_replay: ["snapshot|snapshotId|path"],
  cw_eval_compare: ["baseline|baselinePath", "replay|replayPath"],
  cw_eval_score: ["replay|replayPath|path"],
  cw_eval_gate: ["suite|suiteId|path"],
  cw_eval_report: ["replay|replayPath|path"],
  cw_blackboard_summary: ["runId"],
  cw_blackboard_summarize: ["runId"],
  cw_blackboard_graph: ["runId"],
  cw_blackboard_resolve: ["runId"],
  cw_blackboard_topic_create: ["runId"],
  cw_blackboard_message_post: ["runId"],
  cw_blackboard_message_list: ["runId"],
  cw_blackboard_context_put: ["runId"],
  cw_blackboard_artifact_add: ["runId"],
  cw_blackboard_artifact_list: ["runId"],
  cw_blackboard_snapshot: ["runId"],
  cw_coordinator_summary: ["runId"],
  cw_coordinator_decision: ["runId"],
  cw_audit_summary: ["runId"],
  cw_audit_worker: ["runId"],
  cw_audit_provenance: ["runId"],
  cw_audit_multi_agent: ["runId"],
  cw_audit_policy: ["runId"],
  cw_audit_role: ["runId"],
  cw_audit_blackboard: ["runId"],
  cw_audit_judge: ["runId"],
  cw_audit_attest: ["runId"],
  cw_audit_decision: ["runId"],
  cw_sandbox_list: [],
  cw_sandbox_show: ["profileId"],
  cw_sandbox_validate: ["profileFile"],
  cw_sandbox_choose: [],
  cw_sandbox_resolve: [],
  cw_backend_list: [],
  cw_backend_show: [],
  cw_backend_probe: [],
  cw_backend_agent_config_show: [],
  cw_backend_agent_config_set: [],
  cw_worker_list: ["runId"],
  cw_worker_summary: ["runId"],
  cw_worker_show: ["runId", "workerId"],
  cw_worker_manifest: ["runId"],
  cw_worker_output: ["runId"],
  cw_worker_fail: ["runId"],
  cw_worker_validate: ["runId"],
  cw_candidate_list: ["runId"],
  cw_candidate_show: ["runId", "candidateId"],
  cw_candidate_register: ["runId"],
  cw_candidate_score: ["runId"],
  cw_candidate_rank: ["runId"],
  cw_candidate_select: ["runId"],
  cw_candidate_reject: ["runId"],
  cw_candidate_summary: ["runId"],
  cw_feedback_list: ["runId"],
  cw_feedback_show: ["runId", "feedbackId"],
  cw_feedback_collect: ["runId"],
  cw_feedback_summary: ["runId"],
  cw_feedback_task: ["runId"],
  cw_feedback_resolve: ["runId"],
  cw_schedule_create: [],
  cw_schedule_list: [],
  cw_schedule_delete: ["id"],
  cw_schedule_due: [],
  cw_schedule_complete: ["id"],
  cw_schedule_pause: ["id"],
  cw_schedule_resume: ["id"],
  cw_schedule_run_now: ["id"],
  cw_schedule_history: [],
  cw_routine_create: [],
  cw_routine_list: [],
  cw_routine_delete: ["id"],
  cw_routine_fire: ["kind"],
  cw_routine_events: [],
  cw_registry_refresh: [],
  cw_registry_show: [],
  cw_run_search: [],
  cw_run_list: [],
  cw_run_show: ["runId"],
  cw_run_resume: ["runId"],
  cw_run_archive: ["runId|olderThanDays"],
  cw_run_rerun: ["runId"],
  cw_run_export: ["runId"],
  cw_run_import: ["archive|path|file"],
  cw_run_verify_import: ["runId"],
  cw_run_drive: [],
  cw_run_drive_step: [],
  cw_queue_add: [],
  cw_queue_list: [],
  cw_queue_drain: [],
  cw_queue_show: ["id"],
  cw_sched_plan: [],
  cw_sched_lease: [],
  cw_sched_release: [],
  cw_sched_complete: [],
  cw_sched_reclaim: [],
  cw_sched_reset: [],
  cw_sched_policy_show: [],
  cw_sched_policy_set: [],
  cw_gc_plan: [],
  cw_gc_run: [],
  cw_gc_verify: ["runId"],
  cw_telemetry_verify: ["runId"],
  cw_history: [],
  cw_workbench_view: ["runId"],
  cw_workbench_serve: [],
  cw_metrics_show: ["runId"],
  cw_metrics_summary: [],
  cw_approve: ["runId", "targetKind|kind", "targetId|target"],
  cw_reject: ["runId", "targetKind|kind", "targetId|target"],
  cw_comment_add: ["runId", "targetKind|kind", "targetId|target", "body|message|text"],
  cw_comment_list: ["runId"],
  cw_handoff: ["runId", "targetKind|kind", "targetId|target", "to|toActor"],
  cw_review_status: ["runId"],
  cw_review_policy: ["runId"]
};

// Map each declared MCP tool to its descriptor's requiredArgs (empty when absent).
const byTool = new Map();
for (const cap of CAPABILITY_REGISTRY) {
  if (!cap.mcp) continue;
  byTool.set(cap.mcp.tool, cap.requiredArgs ? [...cap.requiredArgs] : []);
}

const goldenTools = Object.keys(GOLDEN);

// 1. Surface coverage: the golden table and the declared MCP tools are the same set.
assert.equal(goldenTools.length, 182, `expected 182 golden tools, got ${goldenTools.length}`);
assert.equal(byTool.size, 182, `expected 182 declared MCP tools, got ${byTool.size}`);
for (const tool of goldenTools) {
  assert.ok(byTool.has(tool), `declared MCP tool missing for golden entry: ${tool}`);
}
for (const tool of byTool.keys()) {
  assert.ok(Object.prototype.hasOwnProperty.call(GOLDEN, tool), `golden entry missing for declared MCP tool: ${tool}`);
}

// 2. Per-tool equivalence: descriptor-driven requiredArgs === captured old output.
for (const tool of goldenTools) {
  assert.deepEqual(
    byTool.get(tool),
    GOLDEN[tool],
    `requiredArgs drift for ${tool}: registry ${JSON.stringify(byTool.get(tool))} !== golden ${JSON.stringify(GOLDEN[tool])}`
  );
}

// 3. The exact heuristic-derived _show group (8 tools) maps to its runId-plus-id pair.
const SHOW_PAIRS = {
  cw_candidate_show: ["runId", "candidateId"],
  cw_feedback_show: ["runId", "feedbackId"],
  cw_multi_agent_fanin_show: ["runId", "faninId"],
  cw_multi_agent_fanout_show: ["runId", "fanoutId"],
  cw_multi_agent_group_show: ["runId", "groupId"],
  cw_multi_agent_membership_show: ["runId", "membershipId"],
  cw_multi_agent_role_show: ["runId", "roleId"],
  cw_worker_show: ["runId", "workerId"]
};
for (const [tool, pair] of Object.entries(SHOW_PAIRS)) {
  assert.deepEqual(byTool.get(tool), pair, `_show heuristic fold drift for ${tool}`);
}

process.stdout.write(`mcp-required-args-equivalence-smoke: ok (${goldenTools.length} tools)\n`);
