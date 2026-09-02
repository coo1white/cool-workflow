#!/usr/bin/env node
// pipelinecore-commitgate-verifier-errors — resolveCommitGate: the
// verifier-required / verifier-not-found / verifier-wrong-kind /
// verifier-not-verified / verifier-missing-evidence / evidence-ungrounded
// / evidence-unresolvable / empty-capture error codes, each fired under
// its own precise condition. SPEC/pipeline-run.md "Commit gate" section (now
// src/core/pipeline/commit-gate.ts), "Commit-gate error codes (fixed strings)".

const assert = require("node:assert/strict");
const { resolveCommitGate } = require("../dist/core/pipeline/commit-gate");

const NOW = "2026-07-04T00:00:00.000Z";

function baseRun(nodes) {
  return { id: "run-1", tasks: [], nodes, candidates: [], candidateSelections: [] };
}

function verifierNode(overrides) {
  return {
    id: "run-1:verifier:t1",
    kind: "verifier",
    status: "verified",
    evidence: [{ id: "e1", source: "cw:result", path: "src/foo.ts:10" }],
    ...overrides,
  };
}

// Not verifier-gated at all (no verifierNodeId/candidateId/selectionId,
// verifierGated not set, reason does not match "result:<task>") -> zero
// errors, a checkpoint (not gated) resolution.
{
  const run = baseRun([]);
  const res = resolveCommitGate(run, { reason: "manual" }, { now: NOW });
  assert.equal(res.verifierGated, false);
  assert.deepEqual(res.errors, []);
  assert.deepEqual(res.metadata, { verifierGated: false, checkpoint: true });
}

// commit-verifier-required: verifierGated true (explicit verifierGated:
// true) but no verifierNodeId/candidateId/selectionId resolves — fires
// with the exact hint message.
{
  const run = baseRun([]);
  const res = resolveCommitGate(run, { reason: "manual", verifierGated: true }, { now: NOW });
  assert.equal(res.verifierGated, true);
  const err = res.errors.find((e) => e.code === "commit-verifier-required");
  assert.ok(err, "commit-verifier-required must fire");
  assert.equal(err.message, "Verifier-gated commit requires --verifier, --candidate, or --selection");
  assert.equal(err.details.hint, "Use --allow-unverified-checkpoint to write a non-gated checkpoint.");
}

// Auto-gate: reason "result:<task-id>" where that task HAS a
// verifierNodeId makes the commit gated even with no explicit options.
{
  const run = baseRun([verifierNode()]);
  run.tasks = [{ id: "t1", verifierNodeId: "run-1:verifier:t1" }];
  const res = resolveCommitGate(run, { reason: "result:t1" }, { now: NOW });
  assert.equal(res.verifierGated, true);
  assert.equal(res.verifierNodeId, "run-1:verifier:t1");
  assert.deepEqual(res.errors, [], "a fully valid auto-gated verifier must produce zero errors");
}

// A reason of "result:<task-id>" where the task has NO verifierNodeId is
// NOT auto-gated (stays a plain checkpoint).
{
  const run = baseRun([]);
  run.tasks = [{ id: "t1" }];
  const res = resolveCommitGate(run, { reason: "result:t1" }, { now: NOW });
  assert.equal(res.verifierGated, false);
}

// commit-verifier-not-found: an explicit verifierNodeId that does not
// resolve to any node.
{
  const run = baseRun([]);
  const res = resolveCommitGate(run, { reason: "manual", verifierNodeId: "does-not-exist" }, { now: NOW });
  const err = res.errors.find((e) => e.code === "commit-verifier-not-found");
  assert.ok(err);
  assert.equal(err.message, "Verifier node not found: does-not-exist");
  assert.equal(err.details.verifierNodeId, "does-not-exist");
}

// commit-verifier-wrong-kind: the resolved node exists but its kind is not
// "verifier".
{
  const wrongKind = { id: "n1", kind: "result", status: "verified", evidence: [] };
  const run = baseRun([wrongKind]);
  const res = resolveCommitGate(run, { reason: "manual", verifierNodeId: "n1" }, { now: NOW });
  const err = res.errors.find((e) => e.code === "commit-verifier-wrong-kind");
  assert.ok(err);
  assert.equal(err.message, "Node n1 is not a verifier node");
  assert.equal(err.details.kind, "result");
}

// commit-verifier-not-verified: kind is verifier but status is not
// "verified".
{
  const notVerified = verifierNode({ status: "completed" });
  const run = baseRun([notVerified]);
  const res = resolveCommitGate(run, { reason: "manual", verifierNodeId: notVerified.id }, { now: NOW });
  const err = res.errors.find((e) => e.code === "commit-verifier-not-verified");
  assert.ok(err);
  assert.equal(err.message, `Verifier node ${notVerified.id} is completed`);
}

// commit-verifier-missing-evidence: verified verifier with an EMPTY
// evidence array.
{
  const noEvidence = verifierNode({ evidence: [] });
  const run = baseRun([noEvidence]);
  const res = resolveCommitGate(run, { reason: "manual", verifierNodeId: noEvidence.id }, { now: NOW });
  const err = res.errors.find((e) => e.code === "commit-verifier-missing-evidence");
  assert.ok(err);
  assert.equal(err.message, `Verifier node ${noEvidence.id} has no evidence`);
}

// commit-verifier-evidence-ungrounded: evidence is present but no entry is
// "grounded" (no path-like locator, URL, or namespace:value token) — free
// prose only.
{
  const ungrounded = verifierNode({ evidence: [{ id: "e1", summary: "looks fine to me" }] });
  const run = baseRun([ungrounded]);
  const res = resolveCommitGate(run, { reason: "manual", verifierNodeId: ungrounded.id }, { now: NOW, taskRequiresEvidence: true });
  const err = res.errors.find((e) => e.code === "commit-verifier-evidence-ungrounded");
  assert.ok(err, "prose-only evidence must be flagged as ungrounded");
}

// The grounding check is SKIPPED (no commit-verifier-evidence-ungrounded)
// when taskRequiresEvidence resolves to false (an explicit task that does
// NOT require evidence).
{
  const ungrounded = verifierNode({ evidence: [{ id: "e1", summary: "looks fine to me" }] });
  const run = baseRun([ungrounded]);
  const res = resolveCommitGate(run, { reason: "manual", verifierNodeId: ungrounded.id }, { now: NOW, taskRequiresEvidence: false });
  assert.equal(res.errors.find((e) => e.code === "commit-verifier-evidence-ungrounded"), undefined);
}

// taskRequiresEvidence UNDEFINED defaults to enforced (true) — an
// undefined value means "no 1:1 task", which is always strict.
{
  const ungrounded = verifierNode({ evidence: [{ id: "e1", summary: "looks fine to me" }] });
  const run = baseRun([ungrounded]);
  const res = resolveCommitGate(run, { reason: "manual", verifierNodeId: ungrounded.id }, { now: NOW });
  assert.ok(res.errors.some((e) => e.code === "commit-verifier-evidence-ungrounded"), "no taskRequiresEvidence deps field must default to strict enforcement");
}

// commit-verifier-evidence-unresolvable: opt-in strict resolution
// (unresolvedFileEvidence dep) flags file-style locators that don't exist
// on disk.
{
  const withFileEvidence = verifierNode({ evidence: [{ id: "e1", path: "src/missing.ts:10" }] });
  const run = baseRun([withFileEvidence]);
  const res = resolveCommitGate(run, { reason: "manual", verifierNodeId: withFileEvidence.id }, {
    now: NOW,
    unresolvedFileEvidence: (locators) => locators.filter((l) => l.includes("missing")),
  });
  const err = res.errors.find((e) => e.code === "commit-verifier-evidence-unresolvable");
  assert.ok(err);
  assert.equal(err.message, `Verifier node ${withFileEvidence.id} cites file evidence that does not resolve on disk: src/missing.ts:10`);
}

// commit-rationale-empty-capture: the HARD no-false-green gate — a
// verifier backed by a result with zero findings AND zero evidence fails
// even though the verifier node's OWN evidence array is non-empty.
{
  const node = verifierNode();
  const run = baseRun([node]);
  const res = resolveCommitGate(run, { reason: "manual", verifierNodeId: node.id }, {
    now: NOW,
    backingResult: { summary: "x", findings: [], evidence: [] },
  });
  const err = res.errors.find((e) => e.code === "commit-rationale-empty-capture");
  assert.ok(err);
  assert.equal(err.message, `Verifier node ${node.id} cannot back a commit: no findings or evidence captured from result.md`);
}

// A backingResult with SOME findings or evidence does NOT trip
// commit-rationale-empty-capture.
{
  const node = verifierNode();
  const run = baseRun([node]);
  const res = resolveCommitGate(run, { reason: "manual", verifierNodeId: node.id }, {
    now: NOW,
    backingResult: { summary: "x", findings: [{ id: "f1", classification: "real", severity: "P1", evidence: [] }], evidence: [] },
  });
  assert.equal(res.errors.find((e) => e.code === "commit-rationale-empty-capture"), undefined);
}

// A fully valid, explicit verifierNodeId commit with grounded evidence and
// no backingResult (no 1:1 task) produces ZERO errors.
{
  const node = verifierNode();
  const run = baseRun([node]);
  const res = resolveCommitGate(run, { reason: "manual", verifierNodeId: node.id }, { now: NOW });
  assert.deepEqual(res.errors, []);
  assert.deepEqual(res.evidence, node.evidence);
}

process.stdout.write("pipelinecore-commitgate-verifier-errors: ok\n");
