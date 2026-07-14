#!/usr/bin/env node
"use strict";

// Workbench navigation is a small browser policy over read-only capability
// data. Keep its route and key rules pure so they can be checked without a
// browser package or a second UI state store.

const assert = require("node:assert/strict");
const path = require("node:path");

const navigationPath = path.join(__dirname, "..", "ui", "workbench", "navigation.js");
const {
  DEFAULT_TAB,
  TAB_KEYS,
  formatFragment,
  moveTab,
  parseFragment,
} = require(navigationPath);

assert.equal(DEFAULT_TAB, "graph");
assert.deepEqual(TAB_KEYS, ["graph", "blackboard", "worker", "candidate", "audit", "metrics", "collaboration"]);

assert.deepEqual(parseFragment(""), { runId: null, tab: "graph", replace: false });
assert.deepEqual(parseFragment("#run=run%2Fone"), { runId: "run/one", tab: "graph", replace: false });
assert.deepEqual(parseFragment("#run=run%2Fone&tab=audit"), { runId: "run/one", tab: "audit", replace: false });
assert.deepEqual(parseFragment("#run=run%2Fone&tab=unknown"), { runId: "run/one", tab: "graph", replace: true });
assert.deepEqual(parseFragment("#tab=metrics"), { runId: null, tab: "metrics", replace: false });

assert.equal(formatFragment("run/one", "audit"), "#run=run%2Fone&tab=audit");
assert.equal(formatFragment("run with space", "graph"), "#run=run%20with%20space&tab=graph");

assert.equal(moveTab("graph", "ArrowRight"), "blackboard");
assert.equal(moveTab("collaboration", "ArrowRight"), "graph");
assert.equal(moveTab("graph", "ArrowLeft"), "collaboration");
assert.equal(moveTab("candidate", "Home"), "graph");
assert.equal(moveTab("candidate", "End"), "collaboration");
assert.equal(moveTab("candidate", "Enter"), "candidate");
assert.equal(moveTab("not-a-tab", "ArrowRight"), "blackboard");

process.stdout.write("workbench-navigation.test: ok\n");
