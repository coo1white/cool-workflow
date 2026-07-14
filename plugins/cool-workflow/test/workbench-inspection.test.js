#!/usr/bin/env node
"use strict";

// Action-first inspection is a pure projection over one capability payload.
// It may copy source facts for display, but it must not infer a new state,
// rank, or action.

const assert = require("node:assert/strict");
const path = require("node:path");

const inspectionPath = path.join(__dirname, "..", "ui", "workbench", "inspection.js");
const { actionFacts } = require(inspectionPath);

assert.deepEqual(actionFacts(null), []);
assert.deepEqual(actionFacts({ total: 2, status: "complete" }), []);

assert.deepEqual(
  actionFacts({ integrity: { verified: true, eventCount: 12, corruptLines: 0, ignored: "not shown" } }),
  [{ key: "integrity", label: "integrity", items: ["verified: true", "event count: 12", "corrupt lines: 0"] }]
);
assert.deepEqual(actionFacts({ integrity: { checks: [] } }), []);

assert.deepEqual(actionFacts({ problems: [] }), [
  { key: "problems", label: "problems", items: ["none"] },
]);
assert.deepEqual(actionFacts({ problems: ["first problem", { code: "p2", count: 1 }] }), [
  { key: "problems", label: "problems", items: ["first problem", '{"code":"p2","count":1}'] },
]);
assert.deepEqual(actionFacts({ missingEvidence: [] }), [
  { key: "missingEvidence", label: "missing evidence", items: ["none"] },
]);

assert.deepEqual(actionFacts({ nextAction: "cw run status run-1" }), [
  { key: "nextAction", label: "next action", items: ["cw run status run-1"] },
]);
assert.deepEqual(actionFacts({ nextActions: ["cw doctor", 4, "cw report run-1"] }), [
  { key: "nextActions", label: "next actions", items: ["cw doctor", "cw report run-1"] },
]);
assert.deepEqual(actionFacts({ nextAction: "", nextActions: [] }), []);

const source = { problems: [{ code: "fixed" }], nextAction: "cw doctor" };
const before = JSON.stringify(source);
actionFacts(source);
assert.equal(JSON.stringify(source), before, "projection does not change the source payload");

process.stdout.write("workbench-inspection.test: ok\n");
