#!/usr/bin/env node
// drivedecide-moved-from-drive — refactor phase 5 moved the pure helpers of
// shell/drive.ts into core/pipeline/drive-decide.ts (agentConfigured,
// spawningAgentLine, renderSubInputs, roundPhaseLabel) and core/util/
// collate.ts (compareBytes, which run-registry-io also had a copy of). Each
// one is tested here directly, and the last part holds the rule that
// drive.ts and run-registry-io.ts keep no copy of their own.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { agentConfigured, spawningAgentLine, renderSubInputs, roundPhaseLabel } from "../../../dist/core/pipeline/drive-decide.js";
import { compareBytes } from "../../../dist/core/util/collate.js";
import { compareBytes as registryCompareBytes } from "../../../dist/shell/run-registry-io.js";

// agentConfigured: a command or an endpoint is enough; neither is not.
assert.equal(agentConfigured({ command: "claude" }), true);
assert.equal(agentConfigured({ endpoint: "http://127.0.0.1:1" }), true);
assert.equal(agentConfigured({}), false);
assert.equal(agentConfigured({ command: "", endpoint: "" }), false);

// spawningAgentLine: the label (or the id) and the phase, with "dispatched, " only when asked.
assert.equal(spawningAgentLine({ id: "t1", label: "Map", phase: "map" }, false), "→ Map (map) — spawning agent, may take minutes…");
assert.equal(spawningAgentLine({ id: "t1", phase: "map" }, true), "→ t1 (map) — dispatched, spawning agent, may take minutes…");

// renderSubInputs: {{name}} from the parent's inputs, "" for a missing one, other text kept.
assert.deepEqual(renderSubInputs({ inputs: { q: "about {{topic}} in {{repo}}", n: "{{missing}}" } }, { topic: "routing", repo: "cw" }), { q: "about routing in cw", n: "" });
assert.deepEqual(renderSubInputs({}, { topic: "x" }), {});
assert.deepEqual(renderSubInputs({ inputs: { k: "{{n}}" } }, { n: 3 }), { k: "3" });

// roundPhaseLabel: the runnable phase's name (or id), first letter upper case; "" when none.
{
  const phase = (id, name, taskIds) => ({ id, name, status: "pending", taskIds });
  const run = (phases, tasks) => ({ phases, tasks });
  assert.equal(roundPhaseLabel(run([phase("p1", "assess", ["t1"])], [{ id: "t1", phase: "p1", status: "pending" }])), "Assess");
  assert.equal(roundPhaseLabel(run([phase("verify", "", ["t1"])], [{ id: "t1", phase: "verify", status: "running" }])), "Verify");
  assert.equal(roundPhaseLabel(run([phase("p1", "map", ["t1"])], [{ id: "t1", phase: "p1", status: "completed" }])), "");
}

// compareBytes: code-unit order, no locale (an upper-case letter sorts first).
assert.equal(compareBytes("B", "a"), -1);
assert.equal(compareBytes("a", "B"), 1);
assert.equal(compareBytes("x", "x"), 0);
assert.equal(registryCompareBytes, compareBytes, "run-registry-io gives back the one compareBytes");

// No copies left behind.
const SRC = path.resolve(import.meta.dirname, "../../../src");
for (const file of ["shell/drive.ts", "shell/run-registry-io.ts"]) {
  const text = fs.readFileSync(path.join(SRC, file), "utf8");
  for (const name of ["agentConfigured", "spawningAgentLine", "renderSubInputs", "roundPhaseLabel", "compareBytes"]) {
    assert.doesNotMatch(text, new RegExp(`^(export )?function ${name}\\(`, "m"), `${file} defines its own ${name}`);
  }
}

process.stdout.write("drivedecide-moved-from-drive: ok\n");
