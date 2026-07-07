#!/usr/bin/env node
// pipelinecore-commitgate-checkpoint-and-ids — the two commit worlds
// (gated commit vs. plain checkpoint metadata), formatCommitId,
// gateFailureSeq, emptyCaptureWarning and verifierNodeRequiresEvidence
// helpers directly. SPEC/pipeline-run.md "Rebuild risks" #2 ("the two
// commit worlds"), "Deterministic id formats".

const assert = require("node:assert/strict");
const {
  resolveCommitGate,
  formatCommitId,
  gateFailureSeq,
  emptyCaptureWarning,
  verifierNodeRequiresEvidence,
} = require("../dist/core/pipeline/commit-gate");

const NOW = "2026-07-04T00:00:00.000Z";

// A non-gated commit's metadata is EXACTLY {verifierGated:false, checkpoint:true}
// with no other keys — this is the "checkpoint" world.
{
  const run = { id: "run-1", tasks: [], nodes: [], candidates: [], candidateSelections: [] };
  const res = resolveCommitGate(run, { reason: "manual" }, { now: NOW });
  assert.deepEqual(res.metadata, { verifierGated: false, checkpoint: true });
  assert.equal(res.verifierGated, false);
  assert.equal(res.verifierNodeId, undefined);
}

// A gated commit's metadata starts as {verifierGated:true, checkpoint:false}
// and gains verifierNodeId/candidateId/selectionId/selectionNodeId keys —
// this is the "committed" world, structurally distinct.
{
  const node = { id: "v1", kind: "verifier", status: "verified", evidence: [{ id: "e1", path: "a.ts:1" }] };
  const run = { id: "run-1", tasks: [], nodes: [node], candidates: [], candidateSelections: [] };
  const res = resolveCommitGate(run, { reason: "manual", verifierNodeId: "v1" }, { now: NOW });
  assert.equal(res.metadata.verifierGated, true);
  assert.equal(res.metadata.checkpoint, false);
  assert.equal(res.metadata.verifierNodeId, "v1");
}

// formatCommitId: state-<4-digit-seq>, 1-based position in the commit log.
{
  assert.equal(formatCommitId(1), "state-0001");
  assert.equal(formatCommitId(42), "state-0042");
  assert.equal(formatCommitId(10000), "state-10000");
}

// gateFailureSeq: counts existing ":commit-gate-failed:" node ids on the
// run and returns the NEXT 4-digit sequence.
{
  const run = { nodes: [] };
  assert.equal(gateFailureSeq(run), "0001", "empty run starts at 0001");
}
{
  const run = { nodes: [{ id: "run-1:commit-gate-failed:0001" }, { id: "run-1:commit-gate-failed:0002" }] };
  assert.equal(gateFailureSeq(run), "0003", "must count existing commit-gate-failed nodes and continue the sequence");
}
{
  const run = { nodes: [{ id: "run-1:commit-gate-failed:0001" }, { id: "run-1:task:foo" }] };
  assert.equal(gateFailureSeq(run), "0002", "unrelated node ids must not be counted toward the sequence");
}
{
  // No run.nodes array at all -> treated as zero existing failures.
  const run = {};
  assert.equal(gateFailureSeq(run), "0001");
}

// emptyCaptureWarning: undefined backingResult -> undefined (no 1:1 task,
// nothing to warn about at this layer).
{
  assert.equal(emptyCaptureWarning(undefined), undefined);
}

// emptyCaptureWarning: a genuinely empty capture (no findings, no
// evidence) -> the exact warning string.
{
  assert.equal(emptyCaptureWarning({ summary: "x", findings: [], evidence: [] }), "no findings or evidence captured from result.md");
}

// emptyCaptureWarning: findings present (even with empty evidence) ->
// undefined (not empty).
{
  assert.equal(emptyCaptureWarning({ summary: "x", findings: [{ id: "f1" }], evidence: [] }), undefined);
}

// emptyCaptureWarning: evidence present (even with empty findings) ->
// undefined (not empty).
{
  assert.equal(emptyCaptureWarning({ summary: "x", findings: [], evidence: ["a.ts:1"] }), undefined);
}

// verifierNodeRequiresEvidence: undefined input defaults to enforced
// (true) — "no 1:1 task" always enforces the grounding bar.
{
  assert.equal(verifierNodeRequiresEvidence(undefined), true);
  assert.equal(verifierNodeRequiresEvidence(true), true);
  assert.equal(verifierNodeRequiresEvidence(false), false);
}

process.stdout.write("pipelinecore-commitgate-checkpoint-and-ids: ok\n");
