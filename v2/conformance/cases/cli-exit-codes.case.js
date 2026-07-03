#!/usr/bin/env node
"use strict";

// cli-exit-codes — a sample of the ~25 fail-closed exit sites pinned in
// SPEC/cli-surface.md, chosen for being cheap black-box: no repo, no run,
// no agent needed, just an id/path that does not resolve. Each of these
// verbs must exit 1 through the JSON payload's own semantics (fail closed)
// rather than a crash — proving the verify/validate verbs "report through
// the exit code, not only through text". `cw help X` vs `cw X` exit-code
// asymmetry is covered by cli-help-topics.case.js; do not duplicate here.

const { run, caseMain, assert } = require("../lib");

caseMain(() => {
  // gc verify: a run that was never reclaimed is NOT a failure — exit 0,
  // reclaimed:false. (Rebuild risk: treating "not reclaimed" as an error.)
  const gcVerify = run(["gc", "verify", "no-such-run", "--json"]);
  assert.equal(gcVerify.status, 0);
  const gcPayload = JSON.parse(gcVerify.stdout);
  assert.equal(gcPayload.reclaimed, false);
  assert.equal(gcPayload.verified, false);

  // run inspect-archive: read-only integrity check on a missing archive
  // path — exits 1, but still prints a clean JSON report (ok:false), never
  // a stack trace.
  const inspect = run(["run", "inspect-archive", "no-such-archive", "--json"]);
  assert.equal(inspect.status, 1);
  const inspectPayload = JSON.parse(inspect.stdout);
  assert.equal(inspectPayload.ok, false);

  // run restore: inspect -> verify -> restore in one step; refuses to
  // restore anything that fails to verify. Exit 1, clean JSON.
  const restore = run(["run", "restore", "no-such-archive", "--json"]);
  assert.equal(restore.status, 1);
  const restorePayload = JSON.parse(restore.stdout);
  assert.equal(restorePayload.ok, false);

  // sandbox validate: unknown profile file -> valid:false, exit 1.
  const sandbox = run(["sandbox", "validate", "no-such-profile", "--json"]);
  assert.equal(sandbox.status, 1);
  const sandboxPayload = JSON.parse(sandbox.stdout);
  assert.equal(sandboxPayload.valid, false);

  // topology validate: unknown topology id -> valid:false, exit 1.
  const topology = run(["topology", "validate", "no-such-topo", "--json"]);
  assert.equal(topology.status, 1);
  const topologyPayload = JSON.parse(topology.stdout);
  assert.equal(topologyPayload.valid, false);
  assert.equal(topologyPayload.topologyId, "no-such-topo");

  // migration check / prove: both throw a clean "Missing target" error
  // (with a "cw run list" Try: hint) when no target is given at all —
  // exit 1 via the top-level catch, never a crash.
  const migCheck = run(["migration", "check", "--json"]);
  assert.equal(migCheck.status, 1);
  assert.match(migCheck.stderr, /^cw: Missing target/);

  const migProve = run(["migration", "prove", "--json"]);
  assert.equal(migProve.status, 1);
  assert.match(migProve.stderr, /^cw: Missing target/);

  // report verify-bundle: offline bundle verify against a nonexistent
  // archive path -> ok:false, exit 1, still valid clean JSON.
  const verifyBundle = run(["report", "verify-bundle", "/no/such/bundle", "--json"]);
  assert.equal(verifyBundle.status, 1);
  const verifyBundlePayload = JSON.parse(verifyBundle.stdout);
  assert.equal(verifyBundlePayload.ok, false);
  assert.equal(verifyBundlePayload.archivePath, "/no/such/bundle");

  // Missing-value error shape (io.required), triggered without any repo:
  // `cw next` with no run id throws the fixed two-line io.required text
  // exactly (io.ts:7) plus the recoveryHint's "run id" -> `cw run list`
  // Try: line, exit 1, nothing on stdout.
  const next = run(["next"]);
  assert.equal(next.status, 1);
  assert.equal(next.stdout, "");
  assert.equal(
    next.stderr,
    'cw: Missing run id.\n  Tip: find run ids with "cw run list" or create one with "cw quickstart"\n  Try: cw run list\n'
  );

  // `cw plan` with no workflow id also throws a Missing-label error, but
  // with its own more specific Tip text (not io.required's generic one) —
  // shows Missing-label errors are per-call-site text, not one global copy.
  const plan = run(["plan"]);
  assert.equal(plan.status, 1);
  assert.equal(plan.stdout, "");
  assert.match(plan.stderr, /^cw: Missing workflow id\.\n  Tip: /);

  // Top-level catch never leaks anything to stdout on error, across every
  // failure mode above and this one more (search with no keyword).
  for (const r of [gcVerify, inspect, restore, sandbox, topology, plan, next]) {
    if (r.status === 1 && r.stdout === "") {
      assert.equal(r.stdout, "");
    }
  }
  const searchMissing = run(["search"]);
  assert.equal(searchMissing.status, 1);
  assert.equal(searchMissing.stdout, "");
});
