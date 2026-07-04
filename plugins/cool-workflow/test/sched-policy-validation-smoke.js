#!/usr/bin/env node
"use strict";

// sched-policy-validation-smoke — `cw sched policy set` must FAIL CLOSED on a
// non-numeric flag instead of silently substituting the default (which would
// report source:"file" + exit 0, so the operator believes they set a value they
// didn't — the exact silent-fallback §4 forbids). Valid input is unchanged.
//
// Included in `npm test`.
//
// v2 cutover: the old flat dist/capability-core.js schedPolicySet(reg, patch) /
// schedPolicyShow(reg) moved to dist/shell/scheduling-io.js as
// schedPolicySetCli(options) / schedPolicyShowCli(options). The new CLI helpers
// build their own RunRegistry from resolveCwd(options.cwd) using process.env, so
// we pass cwd through options and set CW_HOME on process.env (the constructor
// reads env for the home registry root). The fail-closed guard is the same
// numericFlag() throw ("Invalid --<key> \"<raw>\": expected a number"), so every
// assertion's intent is preserved 1:1.

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const pluginRoot = path.resolve(__dirname, "..");
const { schedPolicySetCli, schedPolicyShowCli } = require(path.join(pluginRoot, "dist", "shell", "scheduling-io.js"));

const home = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "cw-schedpol-home-")));
const repo = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "cw-schedpol-repo-")));
fs.mkdirSync(path.join(home, "registry"), { recursive: true });
// v2 scheduling-io builds RunRegistry(resolveCwd(options)) with process.env, so
// CW_HOME must live on process.env to isolate the policy store in our temp home.
process.env.CW_HOME = home;
const opts = { cwd: repo };

// 1. Valid numeric input is accepted and persisted (unchanged behavior).
const ok = schedPolicySetCli({ ...opts, maxConcurrent: 8 });
assert.equal(ok.policy.maxConcurrent, 8, "valid --maxConcurrent persists");
assert.equal(ok.source, "file", "valid set reports source:file");

// 2. A non-numeric flag FAILS CLOSED with an actionable message — no silent default.
assert.throws(
  () => schedPolicySetCli({ ...opts, maxConcurrent: "abc" }),
  /Invalid --maxConcurrent "abc": expected a number/,
  "non-numeric --maxConcurrent must fail closed, not silently become the default"
);

// 3. The rejected set did NOT mutate the stored policy (still 8, not the default 1).
assert.equal(schedPolicyShowCli(opts).policy.maxConcurrent, 8, "a rejected set leaves the prior value intact");

// 4. The guard covers every numeric policy field.
for (const key of ["maxAttempts", "leaseTtlMs", "backoffBaseMs", "backoffFactor", "backoffCapMs"]) {
  assert.throws(() => schedPolicySetCli({ ...opts, [key]: "nope" }), new RegExp(`Invalid --${key}`), `${key} is guarded`);
}

process.stdout.write("sched-policy-validation-smoke: ok (valid set persists; non-numeric flags fail closed; rejected set leaves prior value intact)\n");
