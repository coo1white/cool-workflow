#!/usr/bin/env node
// trustcore-telemetry-attestation-canonical-payload — pins
// canonicalTelemetryPayload's exact signed bytes and telemetry-attestation's
// own stableStringify (SPEC/ledger-trust.md "Attestation verify": "keys come
// out sorted (promptDigest, resultDigest, runId, taskId, usage)"; project/docs/rebuild/PLAN.md
// byte-compat item 2's divergent top-level-undefined rule).

const assert = require("node:assert/strict");
const { canonicalTelemetryPayload, stableStringify } = require("../dist/core/trust/telemetry-attestation");

const CTX = { runId: "run-1", taskId: "task-1", promptDigest: "sha256:aaaa" };
const USAGE = { input_tokens: 10, output_tokens: 20 };

// 4-field payload (no resultDigest): keys sorted alphabetically —
// promptDigest, runId, taskId, usage.
{
  const payload = canonicalTelemetryPayload(USAGE, CTX);
  const expected = `{"promptDigest":"sha256:aaaa","runId":"run-1","taskId":"task-1","usage":{"input_tokens":10,"output_tokens":20}}`;
  assert.equal(payload, expected, "4-field canonical payload must have exactly these sorted keys and this exact byte layout");
}

// 5-field payload (with resultDigest): resultDigest slots in alphabetically
// between promptDigest and runId.
{
  const ctx = { ...CTX, resultDigest: "sha256:bbbb" };
  const payload = canonicalTelemetryPayload(USAGE, ctx);
  const expected = `{"promptDigest":"sha256:aaaa","resultDigest":"sha256:bbbb","runId":"run-1","taskId":"task-1","usage":{"input_tokens":10,"output_tokens":20}}`;
  assert.equal(payload, expected, "5-field canonical payload must include resultDigest in sorted position");
}

// Absent usage (undefined) maps to the literal JSON null, not omitted.
{
  const payload = canonicalTelemetryPayload(undefined, CTX);
  const expected = `{"promptDigest":"sha256:aaaa","runId":"run-1","taskId":"task-1","usage":null}`;
  assert.equal(payload, expected, "absent usage must serialize as usage:null, never omitted");
}

// stableStringify: sorts object keys recursively.
{
  const a = stableStringify({ b: 1, a: { z: 1, y: 2 } });
  const b = stableStringify({ a: { y: 2, z: 1 }, b: 1 });
  assert.equal(a, b, "stableStringify must sort keys recursively regardless of insertion order");
  assert.equal(a, `{"a":{"y":2,"z":1},"b":1}`);
}

// stableStringify: array order is preserved (only object keys sort).
{
  const a = stableStringify({ list: [3, 1, 2] });
  assert.equal(a, `{"list":[3,1,2]}`, "array element order must not be touched");
}

// stableStringify: THE divergent behavior — a top-level undefined maps to
// the literal string "null" (JSON.stringify(undefined) is JS `undefined`,
// not a string; this wrapper coerces it). This is the exact edge that
// differs from core/hash.ts's ledgerStableStringify, per project/docs/rebuild/PLAN.md byte-
// compat item 2.
{
  assert.equal(stableStringify(undefined), "null", "a top-level undefined must stringify to the literal string \"null\"");
}

// stableStringify: nested undefined (inside an object) is RECURSIVELY
// coerced to "null" too, not dropped — because the function walks
// Object.keys(value) (which still lists a key whose value is undefined)
// and recurses stableStringify on each value, hitting the same top-level
// undefined->"null" branch at that nested position. This differs from
// plain JSON.stringify, which would drop an undefined-valued key entirely
// (JSON.stringify({a:undefined}) is "{}").
{
  const result = stableStringify({ a: undefined, b: 1 });
  assert.equal(result, `{"a":null,"b":1}`, "a nested undefined-valued key must be recursively coerced to null, since Object.keys still lists it and the recursive call hits the same undefined->\"null\" branch");
}

// stableStringify: null value (not undefined) stringifies as the literal
// JSON null both at top level and nested — distinct code path from the
// undefined-coercion branch above.
{
  assert.equal(stableStringify(null), "null");
  assert.equal(stableStringify({ a: null }), `{"a":null}`);
}

// stableStringify over an empty object / empty array — boundary shapes.
{
  assert.equal(stableStringify({}), "{}");
  assert.equal(stableStringify([]), "[]");
}

process.stdout.write("trustcore-telemetry-attestation-canonical-payload: ok\n");
