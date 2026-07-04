#!/usr/bin/env node
// macollab-eval-normalized-shape — eval-replay.ts's assertNormalizedShape
// and the METRIC_SECTIONS/ALL_METRIC_SECTIONS section lists: only the
// first 22 required sections are shape-checked; the 9 later (v0.1.25/
// v0.1.26) optional sections are not required to exist.
//
// Evidence: SPEC/multi-agent.md "The 31 metrics, in order" ("Only the
// first 22 sections are required by shape checks; the later 9 default to
// [] on old snapshots"), edge case "Old eval snapshots without the
// v0.1.25/v0.1.26 sections load fine".

const assert = require("node:assert/strict");
const { assertNormalizedShape, METRIC_SECTIONS, ALL_METRIC_SECTIONS } = require("../dist/core/multi-agent/eval-replay");

function fullValidNormalized() {
  const value = { workflow: { id: "w-1" } };
  for (const spec of METRIC_SECTIONS) {
    if (spec.section !== "workflow") value[spec.section] = [];
  }
  return value;
}

// METRIC_SECTIONS has exactly 22 required sections; ALL_METRIC_SECTIONS has 31 total.
{
  assert.equal(METRIC_SECTIONS.length, 22, "METRIC_SECTIONS (the required, shape-checked set) has exactly 22 entries");
  assert.equal(ALL_METRIC_SECTIONS.length, 31, "ALL_METRIC_SECTIONS (required + the 9 optional v0.1.25/v0.1.26 sections) has exactly 31 entries");
}

// METRIC_SECTIONS starts with replay_completed/graph_parity and ends with report_parity, in the SPEC's exact order.
{
  assert.equal(METRIC_SECTIONS[0].metric, "replay_completed", "first required metric is replay_completed");
  assert.equal(METRIC_SECTIONS[1].metric, "graph_parity", "second required metric is graph_parity");
  assert.equal(METRIC_SECTIONS[METRIC_SECTIONS.length - 1].metric, "report_parity", "last required metric is report_parity");
}

// assertNormalizedShape: a fully valid value (all 22 required sections as arrays, workflow as object) passes.
{
  assert.doesNotThrow(() => assertNormalizedShape(fullValidNormalized(), "should be valid"), "a value with all 22 required sections present and correctly typed passes");
}

// assertNormalizedShape: a value missing one of the 22 required array sections throws, naming that section.
{
  const value = fullValidNormalized();
  delete value.roles;
  assert.throws(() => assertNormalizedShape(value, "bad snapshot"), /bad snapshot; roles must be an array/, "a missing required array section throws naming exactly that section");
}

// assertNormalizedShape: workflow must be an object, not an array or a scalar.
{
  const value = fullValidNormalized();
  value.workflow = ["not", "an", "object"];
  assert.throws(() => assertNormalizedShape(value, "bad snapshot"), /bad snapshot; workflow must be an object/, "workflow as an array throws (arrays are objects in JS but explicitly excluded)");
  const scalarValue = fullValidNormalized();
  scalarValue.workflow = "nope";
  assert.throws(() => assertNormalizedShape(scalarValue, "bad snapshot"), /bad snapshot; workflow must be an object/, "workflow as a string throws too");
}

// assertNormalizedShape: null, non-object, or array top-level value throws the bare message (no section detail).
{
  assert.throws(() => assertNormalizedShape(null, "bad snapshot"), (error) => error.message === "bad snapshot", "null top-level value throws the bare message with no section suffix");
  assert.throws(() => assertNormalizedShape([], "bad snapshot"), (error) => error.message === "bad snapshot", "an array top-level value throws the bare message (explicitly rejected)");
}

// assertNormalizedShape: the 9 optional (v0.1.25/v0.1.26) sections are NOT required — an old-shaped
// snapshot missing summaryFreshness/compactGraphShape/etc. entirely still passes.
{
  const value = fullValidNormalized();
  // Confirm none of the 22 required keys accidentally include any of the 9 optional ones.
  const optionalKeys = ["summaryFreshness", "compactGraphShape", "blackboardDigest", "criticalPath", "evidenceDigest", "expansionRefs", "reasoningFreshness", "reasoningChains", "reasoningUnexplained"];
  for (const key of optionalKeys) assert.ok(!(key in value), `${key} is genuinely absent from an old-shaped snapshot object (not just empty)`);
  assert.doesNotThrow(() => assertNormalizedShape(value, "old snapshot missing optional sections"), "a value with all 22 required sections but none of the 9 optional ones still passes shape validation");
}

process.stdout.write("macollab-eval-normalized-shape: ok\n");
