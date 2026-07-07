#!/usr/bin/env node
// formatapps-stateexplosion-report-text — pins formatStateExplosionReport's
// exact digest text shape: every section header, the "none" fallback for
// empty sections, and that counts in the text echo the underlying report's
// real field values (not re-derived independently).
//
// Evidence: SPEC/state-core.md "Human formatters (CLI text only, never
// --json)"; src/core/format/state-explosion-text.ts (byte-exact port of
// src/state-explosion/format.ts).

const assert = require("node:assert/strict");
const { formatStateExplosionReport } = require("../dist/core/format/state-explosion-text");
const { buildStateExplosionReport } = require("../dist/core/state/state-explosion/report");

function minimalRun(overrides = {}) {
  return {
    id: "run-1",
    loopStage: "interpret",
    paths: { state: "/run-1/state.json" },
    tasks: [],
    dispatches: [],
    commits: [],
    ...overrides,
  };
}

// An empty run's report renders every section with its own header and the
// "none"/"not needed" fallback text, in the fixed section order.
{
  const report = buildStateExplosionReport(minimalRun(), { now: "2024-01-01T00:00:00.000Z" });
  const text = formatStateExplosionReport(report);
  const lines = text.split("\n");

  assert.equal(lines[0], "State Explosion Report: run-1", "first line names the report + runId");
  assert.ok(lines[1].startsWith("Freshness: "), "second line is the Freshness line");
  assert.ok(lines.includes("State Size"), "State Size section header present");
  assert.ok(lines.includes("Compact Graph"), "Compact Graph section header present");
  assert.ok(lines.includes("Blackboard Digest"), "Blackboard Digest section header present");
  assert.ok(lines.includes("Critical Path"), "Critical Path section header present");
  assert.ok(lines.includes("Failures / Blockers"), "Failures / Blockers section header present");
  assert.ok(lines.includes("Evidence Digest"), "Evidence Digest section header present");
  assert.ok(lines.includes("Trust / Policy Digest"), "Trust / Policy Digest section header present");
  assert.ok(lines.includes("Hidden Source Records"), "Hidden Source Records section header present");
  assert.ok(lines.includes("Expansion Commands"), "Expansion Commands section header present");
  assert.ok(lines.includes("Next Action"), "Next Action section header present");

  // Sections stay in this fixed order (never reordered).
  const order = [
    "State Size",
    "Compact Graph",
    "Blackboard Digest",
    "Critical Path",
    "Failures / Blockers",
    "Evidence Digest",
    "Trust / Policy Digest",
    "Hidden Source Records",
    "Expansion Commands",
    "Next Action",
  ];
  const indices = order.map((title) => lines.indexOf(title));
  for (let i = 1; i < indices.length; i += 1) {
    assert.ok(indices[i] > indices[i - 1], `section "${order[i]}" must appear after "${order[i - 1]}"`);
  }

  // Empty-run fallbacks: "none" / "none (all records shown)". The
  // critical path always includes at least the run-root node
  // ("<runId>:run"), even for an otherwise-empty run, so it is NOT "none".
  const criticalPathIndex = lines.indexOf("Critical Path");
  assert.equal(lines[criticalPathIndex + 1], "  -> run-1:run", "the run-root node always anchors the critical path, even for an empty run");
  const failuresIndex = lines.indexOf("Failures / Blockers");
  assert.equal(lines[failuresIndex + 1], "  none", "no failures renders '  none'");
  const hiddenIndex = lines.indexOf("Hidden Source Records");
  assert.equal(lines[hiddenIndex + 1], "  none (all records shown)", "no hidden records renders the explicit 'all records shown' fallback");

  // Next Action's rendered line echoes the report's own nextAction value
  // verbatim (never re-derived by the text formatter).
  const nextActionIndex = lines.indexOf("Next Action");
  assert.equal(lines[nextActionIndex + 1], `  ${report.nextAction}`, "Next Action text must echo report.nextAction verbatim");
}

// The State Size line's counts are pulled directly from report.stateSize
// (total/graphNodes/graphEdges/messages/compactionRecommended), not
// recomputed by the text formatter — change the input, the text tracks it.
{
  const report = buildStateExplosionReport(minimalRun({ tasks: [{ id: "t1", status: "pending", taskPath: "/t1.json" }] }), {
    now: "2024-01-01T00:00:00.000Z",
  });
  const text = formatStateExplosionReport(report);
  const size = report.stateSize;
  const expectedLine = `  records=${size.total}; graph nodes=${size.graphNodes}; graph edges=${size.graphEdges}; messages=${size.messages}; compaction=${
    size.compactionRecommended ? "recommended" : "not needed"
  }`;
  assert.ok(text.includes(expectedLine), "the State Size line must echo the exact report.stateSize fields");
}

// Freshness line: an ABSENT persisted index gives status "absent" and no
// "(stale: ...)" suffix (the suffix only appears when staleScopes is
// non-empty).
{
  const report = buildStateExplosionReport(minimalRun(), { now: "2024-01-01T00:00:00.000Z" });
  const text = formatStateExplosionReport(report);
  assert.equal(report.freshness.status, "absent", "sanity: no index passed in gives absent freshness");
  assert.ok(text.split("\n")[1].endsWith("Freshness: absent"), "no stale suffix appears when staleScopes is empty");
}

process.stdout.write("formatapps-stateexplosion-report-text: ok\n");
