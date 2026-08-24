#!/usr/bin/env node
"use strict";

// attest-sandbox-guarantees — pins the per-dimension guarantee labels that
// attestSandbox now records, and the ONE reader every surface must use
// (sandboxGuaranteeLabels). The labels are additive: the existing
// enforced/attested/unenforceable arrays and the "refused" fail-closed
// path stay untouched, and old records without `guarantees` still read
// back honestly (derived, never made up).

const assert = require("node:assert/strict");
const path = require("node:path");
const { attestSandbox, getBackendDescriptor, sandboxGuaranteeLabels } = require(path.join(
  __dirname,
  "..",
  "dist",
  "shell",
  "execution-backend",
  "registry"
));

// A minimal resolved policy — plain data, no fs, no run state.
function policy(overrides = {}) {
  return {
    schemaVersion: 1,
    id: "test-policy",
    title: "Test Policy",
    readPaths: [],
    writePaths: [],
    workerOutput: { result: true, artifacts: true, logs: true },
    execute: { mode: "allowlist", allow: ["node"] },
    network: { mode: "none" },
    env: { inherit: false, expose: [] },
    enforcement: { enforcedByCW: ["write-paths"], hostRequired: ["network"] },
    hostInstructions: [],
    resolvedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

// ---- execute mode: labels come straight from the declared support --------
{
  // node declares: read/write/network attest, command/env enforce.
  const att = attestSandbox(getBackendDescriptor("node"), policy(), { mode: "execute" });
  assert.deepEqual(att.guarantees, {
    read: "attested",
    write: "attested",
    command: "enforced",
    network: "attested",
    env: "enforced",
  });
  // The pre-existing arrays are unchanged by the new field.
  assert.deepEqual(att.enforced.sort(), ["command", "env"]);
  assert.deepEqual(att.attested.sort(), ["network", "read", "write"]);
  assert.deepEqual(att.unenforceable, []);
  assert.equal(att.status, "enforced");
}

// ---- mode "any": a dimension the profile does not limit is "absent" ------
{
  const open = policy({ execute: { mode: "any" }, network: { mode: "any" } });
  const att = attestSandbox(getBackendDescriptor("node"), open, { mode: "execute" });
  assert.equal(att.guarantees.command, "absent", 'execute mode "any" gives an absent label');
  assert.equal(att.guarantees.network, "absent", 'network mode "any" gives an absent label');
  // Absent-because-unrestricted is NOT unenforceable — no refusal.
  assert.deepEqual(att.unenforceable, []);
  assert.notEqual(att.status, "refused");
}

// ---- delegate-host: only write is enforced; the rest is attested ---------
{
  const att = attestSandbox(getBackendDescriptor("agent"), policy(), { mode: "delegate-host" });
  assert.deepEqual(att.guarantees, {
    read: "attested",
    write: "enforced",
    command: "attested",
    network: "attested",
    env: "attested",
  });
  assert.equal(att.status, "enforced");
}

// ---- unsupported required dimension: label absent, fail-closed intact ----
{
  const base = getBackendDescriptor("agent");
  const noNetwork = {
    ...base,
    id: "test-no-network",
    capabilities: base.capabilities.map((cap) => (cap.dimension === "network" ? { ...cap, support: "unsupported" } : cap)),
  };
  const att = attestSandbox(noNetwork, policy(), { mode: "delegate-host" });
  assert.equal(att.guarantees.network, "absent", "an unsupported required dimension reads absent");
  assert.ok(att.unenforceable.includes("network"), "the unenforceable array still names it");
  assert.equal(att.status, "refused", "the fail-closed refusal path is untouched");
}

// ---- sandboxGuaranteeLabels: the one reader ------------------------------
{
  // No attestation at all → all-absent (fail closed, never fail open).
  assert.deepEqual(sandboxGuaranteeLabels(undefined), {
    read: "absent",
    write: "absent",
    command: "absent",
    network: "absent",
    env: "absent",
  });

  // A new record's own labels pass through as-is.
  const att = attestSandbox(getBackendDescriptor("agent"), policy(), { mode: "delegate-host" });
  assert.deepEqual(sandboxGuaranteeLabels(att), att.guarantees);

  // A legacy record (no `guarantees` field) derives its labels from the
  // stored enforced[]/attested[] arrays; anything in neither is absent.
  const legacy = { ...att };
  delete legacy.guarantees;
  const derived = sandboxGuaranteeLabels(legacy);
  assert.deepEqual(derived, {
    read: "attested",
    write: "enforced",
    command: "attested",
    network: "attested",
    env: "attested",
  });

  // A legacy record that covered fewer dimensions leaves the rest absent.
  const sparse = { ...legacy, enforced: ["write"], attested: ["read"] };
  assert.deepEqual(sandboxGuaranteeLabels(sparse), {
    read: "attested",
    write: "enforced",
    command: "absent",
    network: "absent",
    env: "absent",
  });
}

process.stdout.write("attest-sandbox-guarantees.test: ok\n");
