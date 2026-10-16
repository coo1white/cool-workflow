#!/usr/bin/env node
"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

// The accept path (src/shell/worker-isolation.ts, recordWorkerOutput) is
// one inlined orchestrator, not split across separate modules. This smoke
// checks the property that split was guarding: the accept path still runs
// its five steps in the documented order (validate -> attest delegation ->
// accept -> verify -> completion), with no blackboard or multi-agent
// membership write in it.
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

// The blackboard/multi-agent fanout this accept path used to call through
// multi-agent-io went with that family (slim-and-esm step 2): the accept path
// must not grow a blackboard or membership write back, inline or imported.
assert.doesNotMatch(workerSource, /from "\.\/(coordinator|coordinator-io|multi-agent-io)"/, "worker-isolation must not import the removed multi-agent modules");
assert.doesNotMatch(workerSource, /\b(addBlackboardArtifact|postBlackboardMessage|recordMultiAgentWorkerOutput)\b/, "the accept path must not write blackboard or membership records");

process.stdout.write("worker-accept-path-architecture-smoke: ok\n");
