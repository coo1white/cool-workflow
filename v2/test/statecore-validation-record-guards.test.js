#!/usr/bin/env node
// statecore-validation-record-guards (milestone 3) — pins
// validateNodeSnapshot/validateNodeReplayRun's fail-closed shape guards and
// RecordValidationError's exact message format. SPEC/state-core.md
// "src/validation.ts — persisted-record shape guards": message =
// "Invalid persisted <TypeName>: <reason>".

const assert = require("node:assert/strict");
const { validateNodeSnapshot, validateNodeReplayRun, RecordValidationError } = require("../dist/core/state/validation");

function validSnapshotBody() {
  return {
    id: "n1", kind: "task", status: "pending", loopStage: "interpret",
    inputs: {}, outputs: {}, artifacts: [], evidence: [], errors: [], parents: [], children: [],
  };
}

function validSnapshot() {
  return {
    schemaVersion: 1, snapshotId: "snap-n1-abc", runId: "r1", nodeId: "n1",
    capturedAt: "2020-01-01T00:00:00.000Z", sourceFingerprint: "sha256:abc",
    body: validSnapshotBody(),
  };
}

function validReplay() {
  return {
    schemaVersion: 1, replayId: "replay-x", runId: "r1", nodeId: "n1", snapshotId: "snap-n1-abc",
    replayedAt: "2020-01-01T00:00:00.000Z", freshness: "valid", contractValidated: false,
    outputFingerprint: "sha256:def", body: validSnapshotBody(),
  };
}

// A well-formed NodeSnapshot passes through unchanged.
{
  const snap = validSnapshot();
  assert.equal(validateNodeSnapshot(snap), snap);
}

// A well-formed NodeReplayRun passes through unchanged.
{
  const replay = validReplay();
  assert.equal(validateNodeReplayRun(replay), replay);
}

// RecordValidationError message format: "Invalid persisted <Type>: <reason>".
{
  try {
    validateNodeSnapshot({ not: "a snapshot" });
    assert.fail("must have thrown");
  } catch (err) {
    assert.ok(err instanceof RecordValidationError);
    assert.equal(err.name, "RecordValidationError");
    assert.equal(err.code, "record-shape-invalid");
    assert.equal(err.typeName, "NodeSnapshot");
    assert.ok(err.message.startsWith("Invalid persisted NodeSnapshot: "), "message must follow the exact format");
  }
}

// Not an object at all.
{
  assert.throws(() => validateNodeSnapshot("just a string"), RecordValidationError);
  assert.throws(() => validateNodeSnapshot(null), RecordValidationError);
  assert.throws(() => validateNodeSnapshot([1, 2, 3]), RecordValidationError);
}

// Wrong schemaVersion.
{
  const bad = { ...validSnapshot(), schemaVersion: 2 };
  try {
    validateNodeSnapshot(bad);
    assert.fail("must have thrown");
  } catch (err) {
    assert.equal(err.field, "schemaVersion");
  }
}

// Missing required string field (snapshotId).
{
  const bad = validSnapshot();
  delete bad.snapshotId;
  try {
    validateNodeSnapshot(bad);
    assert.fail("must have thrown");
  } catch (err) {
    assert.equal(err.field, "snapshotId");
  }
}

// Body missing a required string field.
{
  const bad = validSnapshot();
  delete bad.body.kind;
  try {
    validateNodeSnapshot(bad);
    assert.fail("must have thrown");
  } catch (err) {
    assert.equal(err.field, "body.kind");
  }
}

// Body with non-array artifacts.
{
  const bad = validSnapshot();
  bad.body.artifacts = "not-an-array";
  try {
    validateNodeSnapshot(bad);
    assert.fail("must have thrown");
  } catch (err) {
    assert.equal(err.field, "body.artifacts");
  }
}

// NodeReplayRun: invalid freshness value.
{
  const bad = { ...validReplay(), freshness: "not-a-real-freshness" };
  try {
    validateNodeReplayRun(bad);
    assert.fail("must have thrown");
  } catch (err) {
    assert.equal(err.field, "freshness");
    assert.equal(err.typeName, "NodeReplayRun");
  }
}

// NodeReplayRun: contractValidated must be a boolean.
{
  const bad = { ...validReplay(), contractValidated: "yes" };
  try {
    validateNodeReplayRun(bad);
    assert.fail("must have thrown");
  } catch (err) {
    assert.equal(err.field, "contractValidated");
  }
}

// Every valid NodeSnapshotFreshness value is accepted.
{
  for (const freshness of ["valid", "stale", "absent"]) {
    const replay = { ...validReplay(), freshness };
    assert.doesNotThrow(() => validateNodeReplayRun(replay), `freshness=${freshness} must be accepted`);
  }
}

process.stdout.write("statecore-validation-record-guards: ok\n");
