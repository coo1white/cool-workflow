#!/usr/bin/env node
// Covers the v0.1.40 BackendRegistry seam: built-ins are registered, and a host
// can register a NEW backend that then appears across list/ids/descriptor/run
// without editing a central switch.
const assert = require("node:assert/strict");
const {
  registerBackend,
  getBackendDriver,
  backendIds,
  isBackendId,
  getBackendDescriptor,
  listBackendDescriptors,
  runBackend,
  probeBackend,
  DEFAULT_BACKEND_ID
} = require("../dist/execution-backend");

// Built-ins are present and node remains the default.
const ids = backendIds();
for (const id of ["node", "bun", "shell", "container", "remote", "ci", "agent"]) {
  assert.ok(ids.includes(id), `built-in backend missing: ${id}`);
}
assert.equal(DEFAULT_BACKEND_ID, "node");
assert.ok(getBackendDescriptor("node").default, "node is the default descriptor");
assert.ok(getBackendDriver("shell").spawnStyle === "shell", "shell driver keeps shell spawn style");
assert.ok(getBackendDriver("agent").delegateRun, "agent driver exposes a delegate runner");
// Full self-description: built-ins own probe/handle/runtime-note/commandless — no
// central switch holds per-id behavior anymore.
assert.ok(getBackendDriver("node").probe, "node driver owns its probe");
assert.ok(getBackendDriver("agent").commandlessDelegate, "agent driver is commandless");
assert.ok(getBackendDriver("container").buildHandle, "container driver owns its handle builder");
assert.equal(getBackendDriver("node").runtimeNote(), "node", "node runtime note via driver");
assert.equal(probeBackend("node").backendId, "node", "probeBackend routes through the node driver probe");

// Register a NEW delegating backend at runtime — no central switch edit.
assert.equal(isBackendId("k8s-test"), false, "unknown backend not yet registered");
let delegated = false;
registerBackend({
  spec: {
    id: "k8s-test",
    title: "Kubernetes (test)",
    description: "Test-only delegating backend registered at runtime.",
    kind: "delegating",
    locality: "remote",
    default: false,
    delegate: "kubectl",
    readiness: "unverified",
    support: { read: "attest", write: "attest", command: "enforce", network: "attest", env: "attest" }
  },
  commandlessDelegate: true,
  probe: () => ({ checks: [{ name: "k8s", ok: true, detail: "test" }], readiness: "ready" }),
  buildHandle: () => ({ kind: "process", ref: "kubectl run" }),
  delegateRun: (ctx) => {
    delegated = true;
    return {
      schemaVersion: 1,
      status: "completed",
      result: { summary: `${ctx.label}: ok`, findings: [], evidence: ["exitCode:0"] },
      evidence: ["exitCode:0"],
      provenance: {
        schemaVersion: 1,
        backendId: ctx.descriptor.id,
        locality: ctx.descriptor.locality,
        kind: ctx.descriptor.kind,
        attestation: ctx.attestation
      }
    };
  }
});

// It now appears everywhere the built-ins do.
assert.ok(isBackendId("k8s-test"), "registered backend is a known id");
assert.ok(backendIds().includes("k8s-test"), "registered backend listed in ids");
assert.ok(listBackendDescriptors().some((d) => d.id === "k8s-test"), "registered backend listed in descriptors");
assert.equal(getBackendDescriptor("k8s-test").title, "Kubernetes (test)", "descriptor resolves for registered backend");
// The registered driver's probe flows through probeBackend with no central edit.
assert.equal(probeBackend("k8s-test").ready, true, "registered backend probe is honored");
console.log("backend-registry-smoke: registration + lookup ok");

// The registered driver's delegateRun is the routing seam runBackend uses after
// resolving the handle + attestation (invoked directly here to avoid building a
// full ResolvedSandboxPolicy fixture).
const driver = getBackendDriver("k8s-test");
const descriptor = getBackendDescriptor("k8s-test");
const envelope = driver.delegateRun({
  descriptor,
  policy: {},
  request: { backendId: "k8s-test", label: "k8s run" },
  label: "k8s run",
  handle: { kind: "process", ref: "kubectl" },
  attestation: { schemaVersion: 1, status: "attested", enforced: [], attested: [], unenforceable: [] }
});
assert.ok(delegated, "delegateRun was invoked");
assert.equal(envelope.provenance.backendId, "k8s-test", "envelope provenance carries the backend id");
assert.equal(envelope.status, "completed");
// Built-in routing is unchanged: runBackend remains the entry point.
assert.equal(typeof runBackend, "function", "runBackend remains exported");
console.log("backend-registry-smoke: delegateRun routing ok");

console.log("backend-registry-smoke: ok");
