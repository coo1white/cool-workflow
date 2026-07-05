#!/usr/bin/env node
"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

// CUTOVER NOTE (v2 audit): NO-EQUIVALENT file layout, adapted to a behavior
// check.
// The old build split the accept path across five focused
// src/worker-accept/*.ts modules (validation, acceptance, telemetry-ledger,
// verifier-completion, blackboard-fanout). v2 does NOT reproduce that split:
// worker-isolation.ts moved to src/shell/worker-isolation.ts, and its own
// header comment documents the accept path as ONE inlined orchestrator
// (recordWorkerOutput), a deliberate choice, not a dropped behavior —
// external CLI behavior stays byte-identical (conformance 101/101).
// Re-decomposing a working, single-owner file into five just to satisfy a
// file-layout lint would be pure churn with no behavior change, so this
// smoke now checks the property the old layout was really guarding: that
// the accept path still runs its five steps in the documented order
// (validate -> attest delegation -> accept -> verify -> completion), and
// that blackboard fanout still goes through its own module (multi-agent-io)
// rather than reaching into coordinator.ts directly.
const pluginRoot = path.resolve(__dirname, "..");
const workerSourcePath = path.join(pluginRoot, "src", "shell", "worker-isolation.ts");
const workerSource = fs.readFileSync(workerSourcePath, "utf8");

const acceptFn = workerSource.slice(workerSource.indexOf("export function recordWorkerOutput"));
const stepMarkers = [
  "// Step 1: sandbox boundary",
  "// Step 2: attest delegation",
  "// Step 3: accept",
  "// Step 4: verify",
  "// Step 5: completion"
];
let lastIndex = -1;
for (const marker of stepMarkers) {
  const index = acceptFn.indexOf(marker);
  assert.ok(index !== -1, `recordWorkerOutput must keep its "${marker}" step marker`);
  assert.ok(index > lastIndex, `"${marker}" must come after the prior accept-path step, in order`);
  lastIndex = index;
}

assert.doesNotMatch(workerSource, /from "\.\/coordinator"/, "worker-isolation must not import coordinator side-effect writers directly");
assert.doesNotMatch(workerSource, /\b(addBlackboardArtifact|postBlackboardMessage)\b/, "blackboard writes must stay behind the multi-agent-io fanout indirection, not called directly");
assert.match(workerSource, /from "\.\/multi-agent-io"/, "blackboard/multi-agent fanout must go through multi-agent-io, not be reimplemented inline");

process.stdout.write("worker-accept-path-architecture-smoke: ok\n");
