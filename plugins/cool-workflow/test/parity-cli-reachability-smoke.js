#!/usr/bin/env node
"use strict";

// The live parity gate must catch a dispatcher lookup which no longer resolves
// a declared CLI path. This is independent of token-set report test input.

const assert = require("node:assert/strict");
const path = require("node:path");

const pluginRoot = path.resolve(__dirname, "..");
const { cliReachabilityIssues } = require(path.join(pluginRoot, "scripts", "parity-check.js"));

const cap = { capability: "test.show", cli: { path: ["test", "show"], handler() {} } };

assert.deepEqual(cliReachabilityIssues({
  cliCapabilities: () => [cap],
  findCapabilityByCliPath: () => cap,
}), []);

assert.deepEqual(cliReachabilityIssues({
  cliCapabilities: () => [cap],
  findCapabilityByCliPath: () => undefined,
}), ["test.show: CLI path test show does not resolve through the dispatcher"]);

assert.deepEqual(cliReachabilityIssues({
  cliCapabilities: () => [cap],
  findCapabilityByCliPath: () => ({ capability: "test.show", cli: { path: ["test", "show"] } }),
}), ["test.show: CLI path test show does not resolve through the dispatcher"]);

process.stdout.write("parity-cli-reachability-smoke: ok\n");
