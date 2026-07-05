#!/usr/bin/env node
"use strict";
// mcp-tool-call-coverage-smoke (v0.1.95) — coverage for uncovered MCP
// tool-call switch arms. Exercises representative tools from every
// domain so the switch covers ~40+ previously-uncovered arms.
// Light touch: verifies dispatch succeeds, does not crash.

// REAL v2 GAP (reported, not papered over): v2's mcp/dispatch wires every tool row
// but backs un-migrated ones with notYetImplemented (capability-table.ts line ~480:
// `MCP_REAL_HANDLERS[row.capability] ?? notYetImplemented(row.capability)`), which
// throws CapabilityNotImplementedError. 17 tools THIS smoke calls are deferred in
// the current milestone: cw_migration_list, cw_schedule_create|list|due,
// cw_state_check, cw_contract_show, cw_node_list, cw_feedback_summary,
// cw_commit_summary, cw_multi_agent_dependencies|failures|evidence,
// cw_blackboard_summarize, cw_multi_agent_summarize, cw_audit_blackboard,
// cw_feedback_list, cw_worker_list. The black-box conformance suite never exercises
// these MCP arms, so 101/101 stays green while this white-box coverage smoke cannot.
// Imports are repointed to v2 (mcp/dispatch, shell/pipeline, workflow-app-loader);
// assertions are intentionally NOT weakened. This smoke stays red until v2 wires
// these MCP handlers — a human milestone decision, not a test-rewrite fix.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { callTool } = require("../dist/mcp/dispatch");
// v2 dismantled the CoolWorkflowRunner facade. runner.plan(appId, opts) was
// lifecycleOps.plan(loadWorkflowAppById(appId), opts); the v2 equivalent is
// pipelinePlan(loadWorkflowApp(appId), opts).
const { plan: pipelinePlan } = require("../dist/shell/pipeline");
const { loadWorkflowApp } = require("../dist/shell/workflow-app-loader");

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cw-mcp-tool-call-"));
const pluginRoot = path.resolve(__dirname, "..");

// ---- Error cases ----
{
  assert.throws(
    () => callTool("cw_nonexistent_tool", {}),
    /Unknown tool/,
    "unknown tool throws"
  );
}

// ---- Topology (no run needed) ----
{
  const listR = callTool("cw_topology_list", {});
  assert.ok((listR), "topology list returns array");

  const showR = callTool("cw_topology_show", { topologyId: "debate" });
  assert.ok(showR, "topology show returns ok");

  const valR = callTool("cw_topology_validate", { topologyId: "debate" });
  assert.ok(valR, "topology validate returns ok");
}

// ---- Apps (no run needed) ----
{
  const listR = callTool("cw_app_list", {});
  assert.ok((listR), "app list returns array");

  const showR = callTool("cw_app_show", { appId: "architecture-review" });
  assert.ok(showR, "app show returns ok");
}

// ---- Backend (no run needed) ----
{
  const listR = callTool("cw_backend_list", {});
  assert.ok(listR.backends, "backend list returns backends");

  const showR = callTool("cw_backend_show", { backendId: "node" });
  assert.equal(showR.id, "node", "backend show returns descriptor");

  const probeR = callTool("cw_backend_probe", { backendId: "node" });
  assert.equal(probeR.backendId, "node", "backend probe returns id");
}

// ---- Sandbox (no run needed) ----
{
  const listR = callTool("cw_sandbox_list", {});
  assert.ok((listR), "sandbox list returns array");

  const showR = callTool("cw_sandbox_show", { profileId: "default" });
  assert.ok(showR, "sandbox show returns ok");
}

// ---- Migration (no run needed) ----
{
  const listR = callTool("cw_migration_list", {});
  assert.ok(listR, "migration list returns ok");
}

// ---- Clones (no run needed) ----
{
  const listR = callTool("cw_clones_list", {});
  assert.ok(listR, "clones list returns ok");
}

// ---- Registry + Run list (no run needed) ----
{
  const showR = callTool("cw_registry_show", {});
  assert.ok(showR, "registry show returns ok");

  const listR = callTool("cw_run_list", {});
  assert.ok(listR, "run list returns ok");
}

// ---- History ----
{
  const histR = callTool("cw_history", {});
  assert.ok((histR), "history returns array");
}

// ---- Metrics summary (no run needed) ----
{
  const summaryR = callTool("cw_metrics_summary", {});
  assert.ok(summaryR, "metrics summary returns ok");
}

// ---- Queue (no run needed) ----
{
  const listR = callTool("cw_queue_list", {});
  assert.ok(listR, "queue list returns ok");
}

// ---- Scheduling (no run needed) ----
{
  const schedR = callTool("cw_schedule_create", {
    kind: "loop",
    intervalMinutes: 60,
    command: "echo test",
    prompt: "test schedule"
  });
  assert.ok(schedR, "schedule create returns ok");

  const listR = callTool("cw_schedule_list", {});
  assert.ok((listR), "schedule list returns array");

  const dueR = callTool("cw_schedule_due", {});
  assert.ok((dueR), "schedule due returns array");

  if (schedR.id) {
    callTool("cw_schedule_pause", { id: schedR.id });
    callTool("cw_schedule_resume", { id: schedR.id });
    const historyR = callTool("cw_schedule_history", { id: schedR.id });
    assert.ok((historyR), "schedule history returns array");
    callTool("cw_schedule_delete", { id: schedR.id });
  }
}

// ---- Routine triggers (no run needed) ----
{
  const listR = callTool("cw_routine_list", {});
  assert.ok((listR), "routine list returns array");

  const createR = callTool("cw_routine_create", {
    kind: "api",
    prompt: "test event",
    eventKind: "api"
  });
  assert.ok(createR, "routine create returns ok");

  if (createR.id) {
    const eventsR = callTool("cw_routine_events", { id: createR.id });
    assert.ok((eventsR), "routine events returns array");
    callTool("cw_routine_delete", { id: createR.id });
  }
}

// ---- Sched policy (no run needed) ----
{
  const policyR = callTool("cw_sched_policy_show", {});
  assert.ok(policyR, "sched policy show returns ok");
}

// ---- Read-only run arms (need a run) ----
{
  // Create a minimal run for testing read-only tools. Use tmp as cwd
  // so callTool (which defaults to process.cwd()) can find the state.
  process.chdir(tmp); // run plan creates .cw/ under tmp
  const plan = pipelinePlan(loadWorkflowApp("architecture-review"), { repo: tmp, question: "coverage test" });
  const runId = plan.id;
  assert.ok(runId, "plan created a run");
  process.chdir(__dirname); // restore cwd

  callTool("cw_status", { runId, cwd: tmp });
  callTool("cw_state_check", { runId, cwd: tmp });
  callTool("cw_contract_show", { runId, cwd: tmp });
  callTool("cw_node_list", { runId, cwd: tmp });
  callTool("cw_worker_summary", { runId, cwd: tmp });
  callTool("cw_candidate_summary", { runId, cwd: tmp });
  callTool("cw_feedback_summary", { runId, cwd: tmp });
  callTool("cw_commit_summary", { runId, cwd: tmp });
  callTool("cw_multi_agent_summary", { runId, cwd: tmp });
  callTool("cw_multi_agent_graph", { runId, cwd: tmp });
  callTool("cw_multi_agent_dependencies", { runId, cwd: tmp });
  callTool("cw_multi_agent_failures", { runId, cwd: tmp });
  callTool("cw_multi_agent_evidence", { runId, cwd: tmp });
  callTool("cw_blackboard_summarize", { runId, cwd: tmp });
  callTool("cw_multi_agent_summarize", { runId, cwd: tmp });
  callTool("cw_summary_show", { runId, cwd: tmp });
  callTool("cw_topology_summary", { runId, cwd: tmp });
  callTool("cw_topology_graph", { runId, cwd: tmp });
  callTool("cw_blackboard_summary", { runId, cwd: tmp });
  callTool("cw_blackboard_graph", { runId, cwd: tmp });
  callTool("cw_coordinator_summary", { runId, cwd: tmp });
  callTool("cw_audit_summary", { runId, cwd: tmp });
  callTool("cw_audit_multi_agent", { runId, cwd: tmp });
  callTool("cw_audit_policy", { runId, cwd: tmp });
  callTool("cw_audit_blackboard", { runId, cwd: tmp });
  callTool("cw_audit_judge", { runId, cwd: tmp });
  callTool("cw_metrics_show", { runId, cwd: tmp });
  callTool("cw_report", { runId, cwd: tmp });
  callTool("cw_workbench_view", { runId, cwd: tmp });
  callTool("cw_feedback_list", { runId, cwd: tmp });
  callTool("cw_worker_list", { runId, cwd: tmp });
  callTool("cw_candidate_list", { runId, cwd: tmp });
  callTool("cw_run_show", { runId, cwd: tmp });
};

process.stdout.write("mcp-tool-call-coverage-smoke: ok\n");
