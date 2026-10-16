#!/usr/bin/env node
"use strict";

// Workbench navigation is a small browser policy over read-only capability
// data. Keep its route and key rules pure so they can be checked without a
// browser package or a second UI state store.

const assert = require("node:assert/strict");

const {
  DEFAULT_TAB,
  TAB_KEYS,
  formatFragment,
  moveTab,
  parseFragment,
} = require("../src/navigation.ts");

assert.equal(DEFAULT_TAB, "graph");
assert.deepEqual(TAB_KEYS, ["graph", "worker", "audit", "metrics"]);

assert.deepEqual(parseFragment(""), { runId: null, tab: "graph", replace: false });
assert.deepEqual(parseFragment("#run=run%2Fone"), { runId: "run/one", tab: "graph", replace: false });
assert.deepEqual(parseFragment("#run=run%2Fone&tab=audit"), { runId: "run/one", tab: "audit", replace: false });
assert.deepEqual(parseFragment("#run=run%2Fone&tab=unknown"), { runId: "run/one", tab: "graph", replace: true });
assert.deepEqual(parseFragment("#tab=metrics"), { runId: null, tab: "metrics", replace: false });

assert.equal(formatFragment("run/one", "audit"), "#run=run%2Fone&tab=audit");
assert.equal(formatFragment("run with space", "graph"), "#run=run%20with%20space&tab=graph");

assert.equal(moveTab("graph", "ArrowRight"), "worker");
assert.equal(moveTab("metrics", "ArrowRight"), "graph");
assert.equal(moveTab("graph", "ArrowLeft"), "metrics");
assert.equal(moveTab("audit", "Home"), "graph");
assert.equal(moveTab("audit", "End"), "metrics");
assert.equal(moveTab("audit", "Enter"), "audit");
assert.equal(moveTab("not-a-tab", "ArrowRight"), "worker");

process.stdout.write("workbench-navigation.test: ok\n");
