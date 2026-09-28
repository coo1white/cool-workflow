#!/usr/bin/env node
// formatapps-appschema-overlap — validatePhase's `overlapPrevious` rules
// (code "workflow-phase-overlap"): a non-boolean value, the flag on the
// first phase, the flag on a loop phase, and the flag alongside a task
// that reads previous-phase results via resultCache are all refused; a
// valid overlapping second phase gives no such issue.
//
// Evidence: src/core/workflow-apps/app-schema.ts validatePhase's
// overlapPrevious block.

const assert = require("node:assert/strict");
const { validateWorkflowDefinition, workflow, phase, agent } = require("../../../dist/core/workflow-apps/app-schema");

const CTX = { bundledSandboxProfileIds: ["default", "locked-down", "readonly", "workspace-write"], currentCoolWorkflowVersion: "0.1.98" };

function baseWorkflow(phases) {
  return workflow({ id: "my-app", title: "My App", phases });
}

function overlapIssues(phases) {
  return validateWorkflowDefinition(baseWorkflow(phases), CTX).filter((i) => i.code === "workflow-phase-overlap");
}

// A non-boolean overlapPrevious is rejected.
{
  const phases = [phase("Map", [agent("map:1", "x")]), phase("Assess", [agent("assess:1", "y")], { overlapPrevious: "yes" })];
  const issues = overlapIssues(phases);
  assert.ok(issues.some((i) => i.message.includes("must be a boolean")), "a non-boolean overlapPrevious is rejected");
}

// overlapPrevious on the first phase (no phase before it) is rejected.
{
  const phases = [phase("Map", [agent("map:1", "x")], { overlapPrevious: true })];
  const issues = overlapIssues(phases);
  assert.ok(issues.some((i) => i.message.includes("no phase before it")), "overlapPrevious on the first phase is rejected");
}

// overlapPrevious on a loop phase is rejected.
{
  const loopPhase = phase("Assess", [agent("assess:1", "y")], {
    overlapPrevious: true,
    loop: { maxRounds: 2, until: { kind: "budget-target", target: 1 } },
  });
  const phases = [phase("Map", [agent("map:1", "x")]), loopPhase];
  const issues = overlapIssues(phases);
  assert.ok(issues.some((i) => i.message.includes("loop phase cannot overlap")), "overlapPrevious on a loop phase is rejected");
}

// overlapPrevious alongside a task with resultCache.includeCompletedResults
// === "previous-phases" is rejected (it would start before those results
// exist).
{
  const reader = agent("assess:1", "y", { resultCache: { includeCompletedResults: "previous-phases" } });
  const phases = [phase("Map", [agent("map:1", "x")]), phase("Assess", [reader], { overlapPrevious: true })];
  const issues = overlapIssues(phases);
  assert.ok(issues.some((i) => i.message.includes("reads previous-phase results")), "overlapPrevious with a previous-phases result-cache reader is rejected");
}

// A valid overlapping second phase (non-loop, no previous-phases reader)
// gives no workflow-phase-overlap issue.
{
  const phases = [phase("Map", [agent("map:1", "x")]), phase("Assess", [agent("assess:1", "y")], { overlapPrevious: true })];
  const issues = overlapIssues(phases);
  assert.deepEqual(issues, [], "a valid overlapping second phase gives no workflow-phase-overlap issue");
}

process.stdout.write("formatapps-appschema-overlap: ok\n");
