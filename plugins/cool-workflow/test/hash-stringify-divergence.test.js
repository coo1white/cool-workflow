#!/usr/bin/env node
// hash-stringify-divergence (milestone 0) — pins the THREE named, divergent
// stringify-before-hash behaviors that project/docs/rebuild/PLAN.md's byte-compat item 2
// requires to stay separately named and separately tested: this is the
// single biggest named judge risk in the whole rebuild (Open risk #1). A
// naive "collapse to one function with a flag" implementation would pass
// the easy cases and silently break eventHash chain verification.

const assert = require("node:assert/strict");
const {
  stableStringify,
  ledgerStableStringify,
  telemetryStableStringify,
  eventHashInput
} = require("../dist/core/hash");

// --- Shared behavior: all three sort object keys recursively -------------
{
  const a = { b: 1, a: { z: 1, y: 2 } };
  const b = { a: { y: 2, z: 1 }, b: 1 };
  assert.equal(stableStringify(a), stableStringify(b), "stableStringify sorts keys recursively");
  assert.equal(
    ledgerStableStringify(a),
    ledgerStableStringify(b),
    "ledgerStableStringify sorts keys recursively"
  );
  assert.equal(
    telemetryStableStringify(a),
    telemetryStableStringify(b),
    "telemetryStableStringify sorts keys recursively"
  );
}

// --- ledgerStableStringify: NO special-casing of top-level undefined -----
// (src/core/hash.ts's ledgerStableStringify — a top-level undefined is not a real
// call site in practice, but must not silently behave like the telemetry
// variant.)
{
  assert.equal(
    ledgerStableStringify(undefined),
    stableStringify(undefined),
    "ledgerStableStringify must behave exactly like the shared primitive at the top level"
  );
  assert.equal(
    typeof ledgerStableStringify(undefined),
    "undefined",
    "ledgerStableStringify(undefined) must be JS undefined, not the string \"null\""
  );
}

// --- telemetryStableStringify: top-level undefined -> the literal string
// "null" (src/core/trust/telemetry-attestation.ts's stableStringify). This is the exact
// point of divergence from ledgerStableStringify.
{
  assert.equal(
    telemetryStableStringify(undefined),
    "null",
    'telemetryStableStringify(undefined) must be the literal string "null"'
  );
  assert.notEqual(
    telemetryStableStringify(undefined),
    ledgerStableStringify(undefined),
    "the two variants must genuinely diverge at top-level undefined"
  );
}

// --- telemetryStableStringify matches ledgerStableStringify/stableStringify
// on every NON-undefined-top-level input (the two are identical except at
// that one edge). -----------------------------------------------------------
{
  const value = { usage: { input_tokens: 10 }, runId: "r1", taskId: "t1", promptDigest: "sha256:ab" };
  assert.equal(
    telemetryStableStringify(value),
    stableStringify(value),
    "telemetryStableStringify must match the shared primitive on ordinary object input"
  );
}

// --- eventHashInput: JSON round-trips FIRST, dropping every undefined-
// valued key (nested or top-level), THEN sorts-and-stringifies. This is a
// pre-pass that changes the shape being hashed, not a formatting flag on the
// same shape (src/core/hash.ts's eventHashInput). --------------------------------
{
  const eventSansHash = {
    kind: "worker.accept",
    dispatchId: undefined,
    metadata: { scoreId: undefined, workerId: "w-1" }
  };
  const out = eventHashInput(eventSansHash);
  assert.equal(
    out,
    '{"kind":"worker.accept","metadata":{"workerId":"w-1"}}',
    "eventHashInput must drop nested and top-level undefined keys before stringifying"
  );
  // Prove this differs from calling stableStringify directly (which does NOT
  // round-trip first, so undefined keys survive as literal `undefined` in the
  // output rather than being dropped).
  const direct = stableStringify(eventSansHash);
  assert.notEqual(
    out,
    direct,
    "eventHashInput must diverge from a direct stableStringify call (the round-trip pre-pass matters)"
  );
}

// --- eventHashInput is a pre-pass, not a formatting rule: record-time (an
// in-memory event object with nested undefined) must hash identically to
// verify-time (the same event re-parsed from a JSON.stringify'd file on
// disk, which never had those keys in the first place). ---------------------
{
  const inMemoryEvent = { kind: "x", extra: undefined, nested: { a: 1, b: undefined } };
  const persistedBytes = JSON.stringify(inMemoryEvent); // what actually lands in events.jsonl
  const parsedFromDisk = JSON.parse(persistedBytes);

  const recordTimeHash = eventHashInput(inMemoryEvent);
  const verifyTimeHash = eventHashInput(parsedFromDisk);
  assert.equal(
    recordTimeHash,
    verifyTimeHash,
    "eventHashInput must hash identically for an in-memory event and its parsed-from-disk form"
  );
}

// --- eventHashInput preserves explicit null (only undefined is dropped) ----
{
  const withNull = { a: null, b: 1 };
  const out = eventHashInput(withNull);
  assert.equal(out, '{"a":null,"b":1}', "eventHashInput must preserve an explicit null value");
}

process.stdout.write("hash-stringify-divergence: ok\n");
