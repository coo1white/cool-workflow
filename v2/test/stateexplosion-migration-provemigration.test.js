#!/usr/bin/env node
// stateexplosion-migration-provemigration — pins proveMigration's 4-proof
// invariant: validatesAtCurrent, appendOnly, idempotent, sourceImmutable
// must ALL be true (plus zero errors) for pass:true; an unsupported
// verdict never transforms and never claims a positive proof; hashes use
// stableHash (key-sorted, 64 hex, sha256: prefix).
//
// Evidence: SPEC/state-core.md "proveMigration(contractId, snapshot) —
// MigrationProof { ... }; pass requires all four proofs true AND zero
// errors. An unsupported verdict never transforms"; "pass requires ALL of:
// validatesAtCurrent ..., appendOnly ..., idempotent ..., sourceImmutable
// ..., and 0 errors."

const assert = require("node:assert/strict");
const { proveMigration } = require("../dist/core/state/contract-migration");
const { stableHash } = require("../dist/core/hash");

// A clean legacy run-state snapshot proves ALL FOUR true, pass:true, zero errors.
{
  const snapshot = { id: "run-1" };
  const proof = proveMigration("run-state", snapshot);
  assert.equal(proof.schemaVersion, 1, "MigrationProof.schemaVersion is 1");
  assert.equal(proof.contract, "run-state", "contract is echoed back");
  assert.equal(proof.validatesAtCurrent, true, "a clean legacy snapshot validates at current schema after migration");
  assert.equal(proof.appendOnly, true, "migration only adds keys to a clean legacy snapshot, never drops any");
  assert.equal(proof.idempotent, true, "re-running migration on the result yields zero further changes");
  assert.equal(proof.sourceImmutable, true, "the source snapshot's hash is unchanged after proving");
  assert.equal(proof.pass, true, "all four proofs true and zero errors -> pass:true");
  assert.deepEqual(proof.errors, [], "a clean proof has zero errors");
}

// sourceHash uses stableHash (prefixed sha256:, 64 hex, key-sorted) over the ORIGINAL, unmigrated snapshot.
{
  const snapshot = { b: 1, id: "run-1", a: 2 };
  const proof = proveMigration("run-state", snapshot);
  assert.equal(proof.sourceHash, stableHash(snapshot), "sourceHash is exactly stableHash(snapshot)");
  assert.ok(proof.sourceHash.startsWith("sha256:"), "sourceHash carries the sha256: prefix");
  assert.equal(proof.sourceHash.length, "sha256:".length + 64, "sourceHash is 64 hex chars after the prefix");
}

// sourceHash is stable under key reordering (stableHash key-sorts).
{
  const a = proveMigration("run-state", { id: "run-1", z: 1, a: 2 });
  const b = proveMigration("run-state", { a: 2, z: 1, id: "run-1" });
  assert.equal(a.sourceHash, b.sourceHash, "sourceHash must be independent of key insertion order (stableHash sorts keys)");
}

// resultHash is stableHash of the migrated OUTPUT, and generally differs from sourceHash for a legacy input.
{
  const snapshot = { id: "run-1" };
  const proof = proveMigration("run-state", snapshot);
  assert.notEqual(proof.resultHash, proof.sourceHash, "resultHash (post-migration) differs from sourceHash (pre-migration) for a legacy snapshot that actually changes");
}

// fingerprint is a deterministic stableHash of the proof's own decision fields (order-independent, since it hashes an object literal).
{
  const proof = proveMigration("run-state", { id: "run-1" });
  const expectedFingerprint = stableHash({
    contract: proof.contract,
    detectedVersion: proof.verdict.detectedVersion,
    chain: proof.verdict.chain,
    status: proof.verdict.status,
    validatesAtCurrent: proof.validatesAtCurrent,
    appendOnly: proof.appendOnly,
    idempotent: proof.idempotent,
    sourceImmutable: proof.sourceImmutable,
    sourceHash: proof.sourceHash,
    resultHash: proof.resultHash,
  });
  assert.equal(proof.fingerprint, expectedFingerprint, "fingerprint is exactly stableHash of the named decision-field object");
}

// An UNSUPPORTED verdict (schemaVersion below minimum) NEVER transforms:
// validatesAtCurrent/appendOnly/idempotent all stay false, pass is false,
// and result === snapshot (resultHash === sourceHash, since result is
// never reassigned away from the raw snapshot).
{
  const snapshot = { schemaVersion: -1 };
  const proof = proveMigration("run-state", snapshot);
  assert.equal(proof.verdict.status, "unsupported", "sanity: this snapshot is unsupported");
  assert.equal(proof.validatesAtCurrent, false, "unsupported verdict: validatesAtCurrent stays false (never attempted)");
  assert.equal(proof.appendOnly, false, "unsupported verdict: appendOnly stays false (never attempted)");
  assert.equal(proof.idempotent, false, "unsupported verdict: idempotent stays false (never attempted)");
  assert.equal(proof.pass, false, "unsupported verdict can never pass");
  assert.equal(proof.resultHash, proof.sourceHash, "unsupported verdict never transforms: resultHash equals sourceHash (result IS the raw snapshot)");
  assert.ok(proof.errors.length > 0, "unsupported verdict carries at least one error, forcing pass:false even if it somehow proved all four");
}

// sourceImmutable is proven by re-hashing the ORIGINAL snapshot object
// after migration runs — even if migrateRunState mutates a clone
// internally, the caller's own object identity/content must be provably
// unchanged. Passing a snapshot and checking it is byte-identical after
// the call (JSON-wise) is the black-box proof available to this test.
{
  const snapshot = { id: "run-1", nested: { z: 1 } };
  const before = JSON.stringify(snapshot);
  proveMigration("run-state", snapshot);
  assert.equal(JSON.stringify(snapshot), before, "proveMigration must not mutate the caller's snapshot object");
}

// workflow-app contract: appendOnly/idempotent are unconditionally true
// once status !== unsupported (no destructive transform exists for this
// contract at all), validatesAtCurrent tracks status === "current".
{
  const proof = proveMigration("workflow-app", { schemaVersion: 1 });
  assert.equal(proof.validatesAtCurrent, true, "workflow-app at its current version validates");
  assert.equal(proof.appendOnly, true, "workflow-app proof: appendOnly is unconditionally true when not unsupported");
  assert.equal(proof.idempotent, true, "workflow-app proof: idempotent is unconditionally true when not unsupported");
  assert.equal(proof.pass, true, "a current workflow-app snapshot passes");
}

// workflow-app contract: an unsupported snapshot (missing schemaVersion, detected as 0, below minVersion 1) never passes.
{
  const proof = proveMigration("workflow-app", {});
  assert.equal(proof.verdict.status, "unsupported", "workflow-app snapshot missing schemaVersion is unsupported");
  assert.equal(proof.pass, false, "an unsupported workflow-app proof never passes");
}

process.stdout.write("stateexplosion-migration-provemigration: ok\n");
