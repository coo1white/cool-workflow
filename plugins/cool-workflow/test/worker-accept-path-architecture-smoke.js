#!/usr/bin/env node
"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

// CUTOVER NOTE (v2 audit): NO-EQUIVALENT.
// This smoke pins an OLD internal file layout: it asserts that
// src/worker-isolation.ts delegated its accept path to five focused
// src/worker-accept/*.ts modules (validation, acceptance, telemetry-ledger,
// verifier-completion, blackboard-fanout), and that no side-effect writers
// or accept-step functions live inside worker-isolation itself.
//
// The v2 rebuild does NOT reproduce this decomposition. In v2:
//   - worker-isolation.ts moved to src/shell/worker-isolation.ts (path
//     repointed below);
//   - there is NO src/worker-accept/ directory — the accept path is one
//     inlined orchestrator (recordWorkerOutput) inside the single file,
//     a deliberate "byte-exact port of the old build's real-execution
//     path" per src/shell/worker-isolation.ts:1-16;
//   - the side-effect helpers this smoke forbids ARE called directly there
//     (appendTelemetryAttestation / verifyTelemetryAttestation at
//     src/shell/worker-isolation.ts:38-39,385,488).
// External CLI behavior is byte-identical (conformance 101/101); only the
// internal split named by commit 6b8662f "Split worker accept path" is
// absent. There is no v2 equivalent structure to adapt to, so the module /
// import / no-inline assertions below legitimately fail. The source-path
// require is repointed so the failure lands on the real architectural gap
// rather than an ENOENT crash. Do NOT weaken the assertions to force green.
const pluginRoot = path.resolve(__dirname, "..");
const workerSourcePath = path.join(pluginRoot, "src", "shell", "worker-isolation.ts");
const acceptRoot = path.join(pluginRoot, "src", "worker-accept");

const expectedModules = [
  "validation.ts",
  "acceptance.ts",
  "telemetry-ledger.ts",
  "verifier-completion.ts",
  "blackboard-fanout.ts"
];

const workerSource = fs.readFileSync(workerSourcePath, "utf8");
for (const moduleName of expectedModules) {
  assert.ok(fs.existsSync(path.join(acceptRoot, moduleName)), `worker accept path must own ${moduleName}`);
}

assert.match(workerSource, /from "\.\/worker-accept\/validation"/, "recordWorkerOutput must delegate validation");
assert.match(workerSource, /from "\.\/worker-accept\/acceptance"/, "recordWorkerOutput must delegate acceptance/state-node writes");
assert.match(workerSource, /from "\.\/worker-accept\/telemetry-ledger"/, "recordWorkerOutput must delegate telemetry ledger writes");
assert.match(workerSource, /from "\.\/worker-accept\/verifier-completion"/, "recordWorkerOutput must delegate verifier completion");
assert.match(workerSource, /from "\.\/worker-accept\/blackboard-fanout"/, "recordWorkerOutput must delegate blackboard fanout");

assert.doesNotMatch(workerSource, /from "\.\/coordinator"/, "worker-isolation must not import coordinator side-effect writers");
assert.doesNotMatch(workerSource, /from "\.\/telemetry-(attestation|ledger)"/, "worker-isolation must not import telemetry side-effect helpers");
assert.doesNotMatch(workerSource, /\b(addBlackboardArtifact|postBlackboardMessage|appendTelemetryAttestation|verifyTelemetryAttestation)\b/, "blackboard/telemetry side effects must stay out of worker-isolation");
assert.doesNotMatch(workerSource, /function\s+(validateWorkerResult|acceptWorkerResult|recordWorkerDelegationLedger|runWorkerVerify|recordWorkerCompletion|fanOutWorkerOutput)\s*\(/, "accept-path steps must live in focused worker-accept modules");

process.stdout.write("worker-accept-path-architecture-smoke: ok\n");
