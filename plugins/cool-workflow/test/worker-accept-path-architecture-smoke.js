#!/usr/bin/env node
"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const pluginRoot = path.resolve(__dirname, "..");
const workerSourcePath = path.join(pluginRoot, "src", "worker-isolation.ts");
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
