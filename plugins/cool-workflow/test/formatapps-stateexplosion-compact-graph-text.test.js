#!/usr/bin/env node
// formatapps-stateexplosion-compact-graph-text — pins formatCompactGraph's
// digest text shape: header includes the view name + runId, section order,
// the "none" fallbacks for Summary Nodes/Blockers, the truncation note past
// 80 nodes, and the ONE deliberately un-guarded section (Nodes has no
// "none" fallback when empty — unlike every sibling section).
//
// Evidence: SPEC/state-core.md "Human formatters (CLI text only, never
// --json)"; src/core/format/state-explosion-text.ts's formatCompactGraph.

const assert = require("node:assert/strict");
const { formatCompactGraph } = require("../dist/core/format/state-explosion-text");
const { buildCompactGraphFromView } = require("../dist/core/state/state-explosion/graph");

// Empty graph: header names the view + runId, every guarded section falls
// back to "none", and the Next Action line echoes record.nextAction.
{
  const record = buildCompactGraphFromView("run-1", { nodes: [], edges: [] }, "compact", { now: "2024-01-01T00:00:00.000Z" });
  const text = formatCompactGraph(record);
  const lines = text.split("\n");

  assert.equal(lines[0], "Compact Graph (compact): run-1", "header names the view in parens + the runId");
  assert.equal(lines[1], "  full=0 nodes/0 edges -> view=0 nodes/0 edges", "counts line echoes full/compact node+edge counts");

  const summaryIndex = lines.indexOf("Summary Nodes");
  assert.equal(lines[summaryIndex + 1], "  none", "Summary Nodes falls back to 'none' when syntheticNodes is empty");
  const blockersIndex = lines.indexOf("Blockers");
  assert.equal(lines[blockersIndex + 1], "  none", "Blockers falls back to 'none' when blockedReasons is empty");

  // DELIBERATE: "Nodes" is the one section with NO "none" fallback — an
  // empty node list renders the bare header with nothing after it before
  // the next blank line + "Next Action".
  const nodesIndex = lines.indexOf("Nodes");
  assert.equal(lines[nodesIndex + 1], "", "Nodes has no 'none' fallback: the line right after the header is blank, not '  none'");

  const nextActionIndex = lines.indexOf("Next Action");
  assert.equal(lines[nextActionIndex + 1], `  ${record.nextAction}`, "Next Action echoes record.nextAction verbatim");
}

// Critical path always includes at least the run-root anchor node, even
// for an empty graph (never renders "none" for critical path).
{
  const record = buildCompactGraphFromView("run-1", { nodes: [], edges: [] }, "compact", { now: "x" });
  const text = formatCompactGraph(record);
  const lines = text.split("\n");
  const criticalPathIndex = lines.indexOf("Critical Path");
  assert.equal(lines[criticalPathIndex + 1], "  -> run-1:run", "critical path always anchors on the run-root node");
}

// Node rows render "[status] kind id" with no synthetic suffix for a real
// (non-collapsed) node.
{
  const full = {
    nodes: [{ id: "task-a", kind: "task", status: "completed", label: "Task A" }],
    edges: [],
  };
  const record = buildCompactGraphFromView("run-1", full, "full", { now: "x" });
  const text = formatCompactGraph(record);
  assert.ok(text.includes("  [completed] task task-a"), "a real node renders '[status] kind id' with no synthetic suffix");
}

// Node truncation: more than 80 nodes renders only the first 80 plus a
// "... N more" trailer line with the exact remainder count.
{
  const nodes = [];
  for (let i = 0; i < 85; i += 1) {
    nodes.push({ id: `n${i}`, kind: "task", status: "pending", label: `n${i}` });
  }
  const record = buildCompactGraphFromView("run-1", { nodes, edges: [] }, "full", { now: "x" });
  const text = formatCompactGraph(record);
  const lines = text.split("\n");
  const nodeLines = lines.filter((l) => l.startsWith("  [pending] task "));
  assert.equal(nodeLines.length, 80, "at most 80 node rows render even when more nodes exist");
  assert.ok(lines.includes("  ... 5 more"), "a truncation trailer names the exact remainder (85 - 80 = 5)");
}

process.stdout.write("formatapps-stateexplosion-compact-graph-text: ok\n");
