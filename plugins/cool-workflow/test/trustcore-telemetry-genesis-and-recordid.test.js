#!/usr/bin/env node
// trustcore-telemetry-genesis-and-recordid — pins genesisPrevHash and
// recordId (SPEC/ledger-trust.md "Telemetry ledger record": genesis
// prevHash of record 1 = sha256("cw-telemetry-ledger:" + runId); recordId =
// "tel-" + chain POSITION zero-padded to 3, never a clock value).

const assert = require("node:assert/strict");
const { genesisPrevHash, recordId } = require("../dist/core/trust/telemetry-ledger");
const { sha256 } = require("../dist/core/hash");

// genesisPrevHash(runId) === sha256("cw-telemetry-ledger:" + runId) exactly.
{
  const g = genesisPrevHash("run-abc");
  assert.equal(g, sha256("cw-telemetry-ledger:run-abc"), "genesisPrevHash must equal sha256 of the exact literal template");
  assert.ok(g.startsWith("sha256:"), "genesisPrevHash must carry the sha256: prefix");
}

// Different runIds produce different genesis hashes (distinctness).
{
  const a = genesisPrevHash("run-a");
  const b = genesisPrevHash("run-b");
  assert.notEqual(a, b, "different runIds must produce different genesis hashes");
}

// Empty-string runId is a legal edge case, still deterministic.
{
  const a = genesisPrevHash("");
  const b = genesisPrevHash("");
  assert.equal(a, b, "genesisPrevHash must be deterministic even for an empty runId");
  assert.equal(a, sha256("cw-telemetry-ledger:"));
}

// recordId: "tel-" + chain position, zero-padded to 3.
{
  assert.equal(recordId(1), "tel-001");
  assert.equal(recordId(2), "tel-002");
  assert.equal(recordId(10), "tel-010");
  assert.equal(recordId(100), "tel-100");
}

// recordId beyond 3 digits does not truncate (padStart only pads, never cuts).
{
  assert.equal(recordId(1000), "tel-1000", "4-digit positions must not be truncated, only 3-digit ones are zero-padded");
}

// recordId(0) — boundary value.
{
  assert.equal(recordId(0), "tel-000");
}

process.stdout.write("trustcore-telemetry-genesis-and-recordid: ok\n");
