#!/usr/bin/env node
"use strict";

// cli-doctor-fix-app-validate — three more repo-free, agent-free
// invariants from SPEC/cli-surface.md:
//
// - `doctor` --json gives a schemaVersion:1 report with a "checks" array
//   (name/status/detail, optional "fix"); a "warn" status (e.g. no agent
//   configured) is NOT the same as failure — report.ok stays true and the
//   exit code stays 0 (only !report.ok triggers exit 1).
// - `doctor` human output and `fix` both render the SAME underlying
//   fix text for the agent check, in their own formats.
// - `app validate <bad-id>` always prints JSON (valid:false + an issues
//   array) and exits 1.

const { run, freshDir, caseMain, assert } = require("../lib");

// A narrow PATH keeps "no agent backend configured" reliably true without
// depending on whatever agent CLIs happen to be installed on the host.
const NARROW_PATH = { PATH: "/usr/bin:/bin" };

caseMain(() => {
  const doctorJson = run(["doctor", "--json"], { env: NARROW_PATH });
  assert.equal(doctorJson.status, 0, "a warn-only doctor report must still exit 0");
  const report = JSON.parse(doctorJson.stdout);
  assert.equal(report.schemaVersion, 1);
  assert.equal(report.ok, true);
  assert.ok(Array.isArray(report.checks));
  const agentCheck = report.checks.find((c) => c.name === "agent");
  assert.ok(agentCheck, "must have an agent check");
  assert.equal(agentCheck.status, "warn");
  assert.match(agentCheck.fix, /CW_AGENT_COMMAND/);

  const doctorHuman = run(["doctor"], { env: NARROW_PATH });
  assert.equal(doctorHuman.status, 0);
  assert.match(doctorHuman.stdout, /^cw doctor\n/);
  assert.match(doctorHuman.stdout, /! agent: No agent backend configured/);
  assert.match(doctorHuman.stdout, /fix: Pass --agent-command "claude -p"/);

  const fix = run(["fix"], { env: NARROW_PATH });
  assert.equal(fix.status, 0, "warn-only issues are still exit 0 for fix, matching doctor's !report.ok gate");
  assert.match(fix.stdout, /^Fix Commands\n/);
  assert.match(fix.stdout, /Pass --agent-command "claude -p"/);

  // app validate on an id that resolves to nothing: always JSON, exit 1.
  // Pin BOTH calls to the same cwd so the appPath in the payload is
  // identical between them (each call to run() otherwise gets its own
  // fresh cwd, which would make the two payloads differ only in that path).
  const sharedCwd = freshDir("appvalidate");
  const invalid = run(["app", "validate", "no-such-app-xyz", "--json"], { cwd: sharedCwd });
  assert.equal(invalid.status, 1);
  const invalidPayload = JSON.parse(invalid.stdout);
  assert.equal(invalidPayload.valid, false);
  assert.equal(invalidPayload.appId, "no-such-app-xyz");
  assert.ok(Array.isArray(invalidPayload.issues) && invalidPayload.issues.length >= 1);

  // app validate is ALWAYS JSON even without --json (registry-declared
  // jsonMode "default" for the app family).
  const invalidNoFlag = run(["app", "validate", "no-such-app-xyz"], { cwd: sharedCwd });
  assert.equal(invalidNoFlag.status, 1);
  assert.equal(invalidNoFlag.stdout, invalid.stdout);

  // A real bundled app validates clean: valid:true, exit 0.
  const valid = run(["app", "validate", "end-to-end-golden-path", "--json"]);
  assert.equal(valid.status, 0);
  const validPayload = JSON.parse(valid.stdout);
  assert.equal(validPayload.valid, true);
});
