#!/usr/bin/env node
"use strict";

// execution-backends-smoke — v0.1.29 proof.
//
// Proves the Execution Backends driver layer:
//   1. IDENTICAL ENVELOPES, ANY BACKEND. CW's own self-verify run executes through
//      node + shell + bun and produces byte-stable result/evidence envelopes; only
//      the backend id + attestation (provenance) differ.
//   2. FAIL CLOSED. A backend that cannot run the command under the sandbox
//      contract (denied command) or cannot enforce/attest a required dimension, or
//      a delegating backend with no delegation target, REFUSES — it never silently
//      downgrades to an unsandboxed execution.
//   3. BACKEND RECORDED AS PROVENANCE. Dispatch + worker isolation record the
//      selected backend + sandbox attestation in run state and the manifest.
//   4. DELEGATING DRIVERS record an execution handle + attestation.
//   5. KERNEL STAYS BACKEND-AGNOSTIC. The verifier/result pipeline and the run
//      registry work identically regardless of which backend was selected.

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const pluginRoot = path.resolve(__dirname, "..");
const cli = path.join(pluginRoot, "dist", "cli.js");
const {
  runBackend,
  attestSandbox,
  getBackendDescriptor,
  listBackendDescriptors,
  requiredSandboxDimensions,
  backendListPayload,
  DEFAULT_BACKEND_ID
} = require("../dist/execution-backend");
const { showBundledSandboxProfile, sandboxContextForValidation } = require("../dist/sandbox-profile");
const { createRunPaths, ensureRunDirs, saveCheckpoint, loadRunFromCwd } = require("../dist/state");

const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "cw-execution-backends-")));
const ctx = sandboxContextForValidation(tmp);

// Keep delegating backends fail-closed by default during the smoke.
delete process.env.CW_REMOTE_ENDPOINT;
delete process.env.CW_CI_ENDPOINT;
delete process.env.CW_CONTAINER_IMAGE;
delete process.env.CW_BACKEND;

// ---------------------------------------------------------------------------
// 0. The driver registry is deterministic and exposes the contract.
// ---------------------------------------------------------------------------
const listPayload = backendListPayload();
assert.equal(listPayload.default, "node", "node is the default backend");
assert.equal(DEFAULT_BACKEND_ID, "node");
const ids = listPayload.backends.map((b) => b.id);
assert.deepEqual(ids, ["bun", "ci", "container", "node", "remote", "shell"], "all six drivers present, sorted");
for (const descriptor of listBackendDescriptors()) {
  assert.equal(descriptor.schemaVersion, 1);
  assert.equal(descriptor.capabilities.length, 5, `${descriptor.id} declares all five sandbox dimensions`);
  for (const cap of descriptor.capabilities) {
    assert.ok(["enforce", "attest", "unsupported"].includes(cap.support), `${descriptor.id}.${cap.dimension} support`);
  }
}
assert.equal(listBackendDescriptors().filter((d) => d.default).length, 1, "exactly one default backend");

// ---------------------------------------------------------------------------
// 1. IDENTICAL ENVELOPES, ANY BACKEND. Run CW's own self-verify (`cw list`)
//    through node + shell + bun; result/evidence must be byte-stable.
// ---------------------------------------------------------------------------
const policy = showBundledSandboxProfile("default", ctx);
const command = "node";
const args = [cli, "list"];
const envelopes = {};
for (const id of ["node", "shell", "bun"]) {
  const envelope = runBackend({
    schemaVersion: 1,
    backendId: id,
    command,
    args,
    cwd: pluginRoot,
    sandboxPolicy: policy,
    label: "cw-self-verify"
  });
  assert.equal(envelope.status, "completed", `${id} self-verify should complete (got ${envelope.status})`);
  assert.equal(envelope.provenance.backendId, id, `${id} provenance records the backend id`);
  assert.ok(envelope.provenance.attestation, `${id} records a sandbox attestation`);
  envelopes[id] = envelope;
}

const nodeResult = JSON.stringify(envelopes.node.result);
assert.equal(JSON.stringify(envelopes.shell.result), nodeResult, "shell result envelope is byte-identical to node");
assert.equal(JSON.stringify(envelopes.bun.result), nodeResult, "bun result envelope is byte-identical to node");
assert.deepEqual(envelopes.shell.evidence, envelopes.node.evidence, "shell evidence is identical to node");
assert.deepEqual(envelopes.bun.evidence, envelopes.node.evidence, "bun evidence is identical to node");

// The canonical evidence is a deterministic command + exit + output digest.
assert.ok(envelopes.node.evidence.some((e) => e.startsWith("stdoutSha256:sha256:")), "evidence carries an output digest");
assert.ok(envelopes.node.evidence.includes("exitCode:0"), "evidence carries the exit code");

// Provenance (backend id) differs across backends; the canonical evidence does not.
assert.notEqual(envelopes.node.provenance.backendId, envelopes.shell.provenance.backendId, "backend ids differ in provenance");
assert.notEqual(envelopes.shell.provenance.backendId, envelopes.bun.provenance.backendId);
// node/shell enforce command + env at execution time.
assert.deepEqual(envelopes.node.provenance.attestation.enforced.sort(), ["env"], "node enforces env for the default profile");

// ---------------------------------------------------------------------------
// 2. FAIL CLOSED.
// ---------------------------------------------------------------------------
// (a) A denied command (locked-down: execute.mode "none") is refused, not run.
const lockedDown = showBundledSandboxProfile("locked-down", ctx);
const deniedCommand = runBackend({
  schemaVersion: 1,
  backendId: "node",
  command,
  args,
  cwd: pluginRoot,
  sandboxPolicy: lockedDown,
  label: "cw-self-verify"
});
assert.equal(deniedCommand.status, "refused", "locked-down command execution is refused");
assert.equal(deniedCommand.provenance.attestation.status, "refused");
assert.ok(deniedCommand.evidence.some((e) => e.startsWith("refused:")), "refusal is recorded as evidence");
assert.ok(!deniedCommand.evidence.some((e) => e.startsWith("stdoutSha256:")), "a refused command never produced output (no execution)");

// (b) A delegating backend with no delegation target refuses (never runs unsandboxed).
const remoteRefused = runBackend({
  schemaVersion: 1,
  backendId: "remote",
  command,
  args,
  cwd: pluginRoot,
  sandboxPolicy: showBundledSandboxProfile("readonly", ctx),
  label: "cw-self-verify",
  delegation: {}
});
assert.equal(remoteRefused.status, "refused", "remote backend with no endpoint refuses");
assert.equal(remoteRefused.provenance.attestation.status, "refused");

// (c) Dimension-level fail-closed: a backend that cannot enforce OR attest a
//     required dimension is refused. requiredSandboxDimensions(readonly) demands
//     network; a descriptor that marks network "unsupported" must refuse.
const readonly = showBundledSandboxProfile("readonly", ctx);
assert.ok(requiredSandboxDimensions(readonly).includes("network"), "readonly requires the network dimension");
const base = getBackendDescriptor("remote");
const noNetworkDescriptor = {
  ...base,
  id: "test-no-network",
  capabilities: base.capabilities.map((cap) => (cap.dimension === "network" ? { ...cap, support: "unsupported" } : cap))
};
const refusedAttestation = attestSandbox(noNetworkDescriptor, readonly, { mode: "execute" });
assert.ok(refusedAttestation.unenforceable.includes("network"), "unenforceable dimension is reported");
assert.equal(refusedAttestation.status, "refused", "an unenforceable required dimension fails closed");

// ---------------------------------------------------------------------------
// 3. BACKEND RECORDED AS PROVENANCE (dispatch + worker isolation path).
// ---------------------------------------------------------------------------
const runId = "execution-backends-smoke";
const paths = createRunPaths(path.join(tmp, ".cw", "runs", runId));
ensureRunDirs(paths);
const taskPath = path.join(paths.tasksDir, "verify.md");
fs.writeFileSync(taskPath, "run the cw self-verify\n", "utf8");
const run = {
  schemaVersion: 1,
  id: runId,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  cwd: tmp,
  workflow: { id: runId, title: "Execution Backends Smoke", summary: "", limits: { maxAgents: 2, maxConcurrentAgents: 1 } },
  inputs: {},
  loopStage: "interpret",
  phases: [{ id: "verify", name: "Verify", status: "pending", taskIds: ["verify:cw"] }],
  tasks: [
    {
      id: "verify:cw",
      kind: "agent",
      phase: "Verify",
      status: "pending",
      requiresEvidence: false,
      prompt: "Run the CW self-verify and report.",
      taskPath,
      resultPath: "",
      loopStage: "interpret",
      stateNodeId: `${runId}:task:verify:cw`
    }
  ],
  dispatches: [],
  commits: [],
  paths,
  nodes: [],
  contracts: [],
  feedback: [],
  workers: [],
  sandboxProfiles: [],
  candidates: [],
  candidateSelections: []
};
saveCheckpoint(run);

const dispatch = JSON.parse(
  execFileSync("node", [cli, "dispatch", runId, "--limit", "1", "--backend", "shell"], { cwd: tmp, encoding: "utf8" })
);
assert.equal(dispatch.backendId, "shell", "dispatch records the selected backend");
assert.equal(dispatch.backendSelection.source, "flag", "selection source is the flag");
assert.equal(dispatch.tasks[0].backendId, "shell", "task records the backend");
assert.ok(dispatch.backendAttestation, "dispatch records a sandbox attestation");
assert.equal(dispatch.backendAttestation.backendId, "shell");
assert.ok(["enforced", "attested"].includes(dispatch.backendAttestation.status), "attestation honored, not refused");

const workerId = dispatch.tasks[0].workerId;
const manifest = JSON.parse(execFileSync("node", [cli, "worker", "manifest", runId, workerId], { cwd: tmp, encoding: "utf8" }));
assert.equal(manifest.backendId, "shell", "worker manifest records the backend");
assert.equal(manifest.backend.id, "shell", "worker manifest carries the backend block");
assert.equal(manifest.backend.attestation.backendId, "shell");
assert.ok(Array.isArray(manifest.backend.enforces), "backend block lists enforced dimensions");
assert.ok(manifest.sandbox.profileId, "the sandbox block is preserved alongside the backend block");

// The default-backend path is unchanged: dispatching without --backend records node.
const runId2 = "execution-backends-default";
const paths2 = createRunPaths(path.join(tmp, ".cw", "runs", runId2));
ensureRunDirs(paths2);
const taskPath2 = path.join(paths2.tasksDir, "verify.md");
fs.writeFileSync(taskPath2, "default backend\n", "utf8");
const run2 = JSON.parse(JSON.stringify(run));
run2.id = runId2;
run2.workflow.id = runId2;
run2.paths = paths2;
run2.tasks[0].stateNodeId = `${runId2}:task:verify:cw`;
run2.tasks[0].taskPath = taskPath2;
saveCheckpoint(run2);
const defaultDispatch = JSON.parse(execFileSync("node", [cli, "dispatch", runId2, "--limit", "1"], { cwd: tmp, encoding: "utf8" }));
assert.equal(defaultDispatch.backendId, "node", "no --backend defaults to node (behavior-preserving)");
assert.equal(defaultDispatch.backendSelection.source, "default");

// ---------------------------------------------------------------------------
// 4. DELEGATING DRIVERS record a handle + attestation.
// ---------------------------------------------------------------------------
const containerEnvelope = runBackend({
  schemaVersion: 1,
  backendId: "container",
  command,
  args,
  cwd: pluginRoot,
  sandboxPolicy: showBundledSandboxProfile("workspace-write", ctx),
  label: "cw-self-verify",
  delegation: { image: "cw/test", digest: "sha256:deadbeef" }
});
// v0.1.34: the container backend really executes. An unrunnable image (no
// reachable daemon/registry) FAILS CLOSED — never a fabricated completion — while
// still recording the delegation handle + attestation in provenance.
assert.equal(containerEnvelope.status, "refused", "container with an unrunnable image fails closed (no fabricated completion)");
assert.equal(containerEnvelope.provenance.attestation.status, "refused");
assert.ok(containerEnvelope.provenance.handle, "container records a delegation handle even on refusal");
assert.equal(containerEnvelope.provenance.handle.kind, "container");
assert.equal(containerEnvelope.provenance.handle.image, "cw/test");
assert.equal(containerEnvelope.provenance.handle.ref, "cw/test@sha256:deadbeef");
assert.ok(containerEnvelope.evidence.some((e) => e.startsWith("refused:")), "refusal is recorded as evidence");
assert.ok(!containerEnvelope.evidence.some((e) => e.startsWith("stdoutSha256:")), "nothing ran — no output digest");

// ---------------------------------------------------------------------------
// 5. KERNEL STAYS BACKEND-AGNOSTIC. Worker output + verifier work identically on
//    a backend-selected run; the run registry surfaces the backend as metadata
//    without changing lifecycle/verifier behavior.
// ---------------------------------------------------------------------------
const reloaded = loadRunFromCwd(runId, tmp);
const scope = reloaded.workers.find((w) => w.id === workerId);
const resultFile = scope.resultPath;
fs.writeFileSync(
  resultFile,
  ["# Result", "", "CW self-verify passed.", "", "```cw:result", JSON.stringify({ summary: "cw self-verify passed", findings: [], evidence: ["exitCode:0"] }), "```", ""].join("\n"),
  "utf8"
);
execFileSync("node", [cli, "worker", "output", runId, workerId, resultFile], { cwd: tmp, encoding: "utf8" });

const afterOutput = loadRunFromCwd(runId, tmp);
const completedTask = afterOutput.tasks.find((t) => t.id === "verify:cw");
assert.equal(completedTask.status, "completed", "task completed through the unchanged verifier pipeline");
assert.ok(completedTask.resultNodeId, "worker output produced a result node regardless of backend");
assert.ok(completedTask.verifierNodeId, "the verifier ran regardless of backend");
// The ResultEnvelope schema is unchanged — no backend keys leaked into it.
assert.deepEqual(Object.keys(completedTask.result).sort(), ["evidence", "findings", "summary"], "ResultEnvelope schema unchanged");

const show = JSON.parse(execFileSync("node", [cli, "run", "show", runId, "--scope", "repo", "--json"], { cwd: tmp, encoding: "utf8" }));
const record = show.record || show.persisted;
assert.ok(record, "registry resolved the run record");
assert.ok((record.backends || []).includes("shell"), "registry surfaces the backend used by the run");

// Parity surfaces are identical for backend.list (CLI vs the orchestrator core).
const cliBackendList = JSON.parse(execFileSync("node", [cli, "backend", "list"], { cwd: tmp, encoding: "utf8" }));
assert.deepEqual(cliBackendList, JSON.parse(JSON.stringify(backendListPayload())), "cw backend list matches the core payload");

process.stdout.write("execution-backends-smoke: ok\n");
