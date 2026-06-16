#!/usr/bin/env node
"use strict";

// sched-policy-validation-smoke — `cw sched policy set` must FAIL CLOSED on a
// non-numeric flag instead of silently substituting the default (which would
// report source:"file" + exit 0, so the operator believes they set a value they
// didn't — the exact silent-fallback §4 forbids). Valid input is unchanged.
//
// Included in `npm test`.

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const pluginRoot = path.resolve(__dirname, "..");
const { RunRegistry } = require(path.join(pluginRoot, "dist", "run-registry.js"));
const { schedPolicySet, schedPolicyShow } = require(path.join(pluginRoot, "dist", "capability-core.js"));

const home = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "cw-schedpol-home-")));
const repo = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "cw-schedpol-repo-")));
fs.mkdirSync(path.join(home, "registry"), { recursive: true });
const reg = new RunRegistry(repo, undefined, { ...process.env, CW_HOME: home });

// 1. Valid numeric input is accepted and persisted (unchanged behavior).
const ok = schedPolicySet(reg, { maxConcurrent: 8 });
assert.equal(ok.policy.maxConcurrent, 8, "valid --maxConcurrent persists");
assert.equal(ok.source, "file", "valid set reports source:file");

// 2. A non-numeric flag FAILS CLOSED with an actionable message — no silent default.
assert.throws(
  () => schedPolicySet(reg, { maxConcurrent: "abc" }),
  /Invalid --maxConcurrent "abc": expected a number/,
  "non-numeric --maxConcurrent must fail closed, not silently become the default"
);

// 3. The rejected set did NOT mutate the stored policy (still 8, not the default 1).
assert.equal(schedPolicyShow(reg).policy.maxConcurrent, 8, "a rejected set leaves the prior value intact");

// 4. The guard covers every numeric policy field.
for (const key of ["maxAttempts", "leaseTtlMs", "backoffBaseMs", "backoffFactor", "backoffCapMs"]) {
  assert.throws(() => schedPolicySet(reg, { [key]: "nope" }), new RegExp(`Invalid --${key}`), `${key} is guarded`);
}

process.stdout.write("sched-policy-validation-smoke: ok (valid set persists; non-numeric flags fail closed; rejected set leaves prior value intact)\n");
