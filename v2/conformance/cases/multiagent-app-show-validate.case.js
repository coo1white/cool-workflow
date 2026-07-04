#!/usr/bin/env node
"use strict";

// cw app show <id> and cw app validate <id> — no repo, no run needed.
// Pins the "app not found" error string, the show payload's extra blocks
// (source/app/workflow) on top of the summary keys, and the validate
// success/failure shapes + exit codes for a known-good and a known-bad id.

const { run, caseMain, assert } = require("../lib");

caseMain(() => {
  const bad = run(["app", "show", "nosuchapp"]);
  assert.equal(bad.status, 1);
  assert.equal(bad.stdout, "");
  assert.equal(bad.stderr, "cw: Workflow app not found: nosuchapp\n  Try: cw app list\n");

  const ok = run(["app", "show", "architecture-review"]);
  assert.equal(ok.status, 0);
  const payload = JSON.parse(ok.stdout);
  assert.equal(payload.id, "architecture-review");
  assert.equal(payload.taskCount, 14);
  assert.ok(payload.source && payload.source.path, "source block present");
  assert.equal(payload.app.id, "architecture-review");
  assert.equal(payload.app.schemaVersion, 1);
  assert.equal(payload.workflow.id, "architecture-review");
  assert.ok(Array.isArray(payload.workflow.phases));
  const firstTask = payload.workflow.phases[0].tasks[0];
  assert.deepEqual(Object.keys(firstTask), ["id", "kind", "requiresEvidence", "sandboxProfileId"]);

  // cw info <id> mirrors app show but with a human card by default.
  const info = run(["info", "architecture-review"]);
  assert.equal(info.status, 0);
  assert.match(info.stdout, /^cw info architecture-review\n/);
  assert.match(info.stdout, /Compatible: yes/);
  assert.match(info.stdout, /Sandbox: readonly/);

  // cw app validate on a known-good app id.
  const validGood = run(["app", "validate", "architecture-review"]);
  assert.equal(validGood.status, 0);
  const goodPayload = JSON.parse(validGood.stdout);
  assert.equal(goodPayload.valid, true);
  assert.equal(goodPayload.appId, "architecture-review");
  assert.deepEqual(goodPayload.issues, []);
  assert.ok(goodPayload.summary, "successful validate carries a summary");

  // cw app validate on an unknown id/path: valid=false, exit 1.
  const validBad = run(["app", "validate", "nosuchapp"]);
  assert.equal(validBad.status, 1);
  const badPayload = JSON.parse(validBad.stdout);
  assert.equal(badPayload.valid, false);
  assert.equal(badPayload.appId, "nosuchapp");
  assert.ok(Array.isArray(badPayload.issues) && badPayload.issues.length > 0);
});
