#!/usr/bin/env node
// pipelinecore-resultnormalize-emptycapture — isEmptyCapture's exact
// empty-vs-non-empty boundary. SPEC/pipeline-run.md "Result ingest"
// section (isEmptyCapture, now src/core/pipeline/result-normalize.ts)
// and "Invariants" #3 ("No false green").

const assert = require("node:assert/strict");
const { isEmptyCapture, normalizeResultEnvelope } = require("../dist/core/pipeline/result-normalize");

// Both findings AND evidence empty -> true (the ONLY true case).
{
  assert.equal(isEmptyCapture({ summary: "x", findings: [], evidence: [] }), true);
}

// Findings non-empty, evidence empty -> false.
{
  assert.equal(isEmptyCapture({ summary: "x", findings: [{ id: "f1" }], evidence: [] }), false);
}

// Findings empty, evidence non-empty -> false.
{
  assert.equal(isEmptyCapture({ summary: "x", findings: [], evidence: ["a.ts:1"] }), false);
}

// Both non-empty -> false.
{
  assert.equal(isEmptyCapture({ summary: "x", findings: [{ id: "f1" }], evidence: ["a.ts:1"] }), false);
}

// Missing findings/evidence keys entirely (both undefined) -> treated as
// empty (the `|| 0` fallback in isEmptyCapture's length reads).
{
  assert.equal(isEmptyCapture({ summary: "x" }), true, "undefined findings/evidence must fold to empty, not throw");
}
{
  assert.equal(isEmptyCapture({ summary: "x", findings: undefined, evidence: undefined }), true);
}

// A single finding with no evidence of its own still counts as "findings
// non-empty" at the top level — isEmptyCapture only looks at the envelope
// TOP-LEVEL evidence array, not per-finding evidence.
{
  const env = { summary: "x", findings: [{ id: "f1", classification: "unknown", severity: "none", evidence: [] }], evidence: [] };
  assert.equal(isEmptyCapture(env), false, "a non-empty findings array alone is enough to NOT be an empty capture");
}

// Integration: a genuinely empty cw:result fence really does produce an
// envelope that isEmptyCapture flags.
{
  const md = '```cw:result\n{"summary":"nothing to report","findings":[],"evidence":[]}\n```';
  const env = normalizeResultEnvelope(md);
  assert.equal(isEmptyCapture(env), true);
}

// Integration: a fence-less report that happens to cite a grounded
// locator in prose is NOT an empty capture (evidence gets harvested).
{
  const md = "Reviewed the code. See `src/foo.ts:42` for the relevant line.";
  const env = normalizeResultEnvelope(md);
  assert.equal(isEmptyCapture(env), false, "harvested prose evidence must count toward non-empty");
}

// Integration: a fence-less report with pure prose and NO locator-shaped
// tokens anywhere IS an empty capture.
{
  const md = "Everything looks fine, no concerns at all here.";
  const env = normalizeResultEnvelope(md);
  assert.equal(isEmptyCapture(env), true, "prose with no locator-shaped tokens produces an empty capture");
}

process.stdout.write("pipelinecore-resultnormalize-emptycapture: ok\n");
