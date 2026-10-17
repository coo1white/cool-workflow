#!/usr/bin/env node
// The live parity gate must catch a dispatcher lookup which no longer resolves
// a declared CLI path. This is independent of token-set report test input.

import assert from "node:assert/strict";
import path from "node:path";

const pluginRoot = path.resolve(import.meta.dirname, "..");
import { cliReachabilityIssues } from "../scripts/parity-check.mjs";

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
