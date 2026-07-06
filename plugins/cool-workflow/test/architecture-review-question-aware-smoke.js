#!/usr/bin/env node
"use strict";

// architecture-review-question-aware-smoke -- every Map/Assess/Verify agent in
// the architecture-review app must scope its work to {{question}} (and
// {{focus}}/{{invariant}} where applicable), not run a fixed risk lens blind
// to what the user actually asked. An independent audit found 11 of the 14
// agent/artifact prompts never referenced {{question}} at all, so the tool's
// final answer kept drifting back to a generic "what are the main risks"
// framing no matter what was asked. This is a pure structural check on the
// RAW prompt strings -- no LLM call, deterministic, fast.

const assert = require("node:assert/strict");
const path = require("node:path");

// Minimal stand-in for the real workflow-app-framework builder functions,
// sufficient to capture the raw (pre-interpolation) prompt strings each
// agent/artifact call receives.
function workflow(def) { return def; }
function phase(name, tasks) { return { name, tasks }; }
function parallel(name, tasks) { return { name, tasks, parallel: true }; }
function agent(id, prompt, opts) { return { id, prompt, opts, kind: "agent" }; }
function artifact(id, prompt, opts) { return { id, prompt, opts, kind: "artifact" }; }
function input(name, opts) { return { name, ...opts }; }

function main() {
  const workflowFactory = require(
    path.join(__dirname, "..", "apps", "architecture-review", "workflow.js")
  );
  const def = workflowFactory({ workflow, phase, parallel, agent, artifact, input });

  const mapPhase = def.phases.find((p) => p.name === "Map");
  const assessPhase = def.phases.find((p) => p.name === "Assess");
  const verifyPhase = def.phases.find((p) => p.name === "Verify");
  const verdictPhase = def.phases.find((p) => p.name === "Verdict");

  assert.ok(mapPhase && mapPhase.tasks.length === 6, "Map phase must keep 6 agents");
  assert.ok(assessPhase && assessPhase.tasks.length === 6, "Assess phase must keep 6 agents");
  assert.ok(verifyPhase && verifyPhase.tasks.length === 1, "Verify phase must keep 1 agent");
  assert.ok(verdictPhase && verdictPhase.tasks.length === 1, "Verdict phase must keep 1 artifact");

  // Every Map, Assess, and Verify agent must scope its work to {{question}} --
  // this is the actual bug: 11/14 prompts never referenced it before this fix.
  for (const task of [...mapPhase.tasks, ...assessPhase.tasks, ...verifyPhase.tasks]) {
    assert.ok(
      task.prompt.includes("{{question}}"),
      `${task.id} prompt must reference {{question}}`
    );
  }

  // Every Map and Assess agent must also carry {{focus}}, so a narrowed
  // investigation actually narrows every lens, not only two of them.
  for (const task of [...mapPhase.tasks, ...assessPhase.tasks]) {
    assert.ok(
      task.prompt.includes("{{focus}}"),
      `${task.id} prompt must reference {{focus}}`
    );
  }

  // Verdict keeps its existing {{question}} usage (already correct before
  // this fix; regression guard only).
  assert.ok(
    verdictPhase.tasks[0].prompt.includes("{{question}}"),
    "verdict:synthesis prompt must still reference {{question}}"
  );

  // Identity guard: the fix must not change WHICH dimension each Map/Assess
  // agent covers, only how it relates that dimension to the question. Pin
  // the task ids so a future edit can't silently drop or rename an agent
  // while rewording prompts.
  const expectedMapIds = [
    "map:server-api",
    "map:web-client",
    "map:db-security",
    "map:deploy-config",
    "map:jobs-operators",
    "map:transport-core"
  ];
  const expectedAssessIds = [
    "assess:security",
    "assess:data-correctness",
    "assess:failure-modes",
    "assess:scale-ops",
    "assess:maintainability",
    "assess:domain"
  ];
  assert.deepEqual(mapPhase.tasks.map((t) => t.id), expectedMapIds, "Map agent ids/order must stay stable");
  assert.deepEqual(assessPhase.tasks.map((t) => t.id), expectedAssessIds, "Assess agent ids/order must stay stable");
  assert.equal(verifyPhase.tasks[0].id, "verify:p0-p2-risks", "Verify agent id must stay stable");
  assert.equal(verdictPhase.tasks[0].id, "verdict:synthesis", "Verdict artifact id must stay stable");

  console.log("architecture-review-question-aware-smoke: ok (all 12 Map/Assess agents + Verify scope to {{question}}; task ids/order pinned)");
}

main();
