#!/usr/bin/env node
"use strict";

// Ledger id-mismatch forgery (ledger-trust.md Rebuild risk #6). `id` sits
// OUTSIDE the ledger digest (the digest covers every field except id and
// digest itself), so a forger who leaves the digest internally consistent
// but swaps in ANOTHER entry's id must still be caught -- otherwise a
// spoofed id could slip through union de-duplication. This extends the
// tamper pattern in state-ledger-trust.case.js (which tampers "title" and
// gets ledger-digest-mismatch) with the id-forgery arm: tamper ONLY "id",
// recompute nothing else, and confirm CW reports the DISTINCT
// "ledger-id-mismatch" code -- never digest-mismatch, since the digest
// itself still matches its (unchanged) content.

const path = require("node:path");
const { run, freshDir, caseMain, assert } = require("../lib");

caseMain(() => {
  const proposeArgs = [
    "ledger",
    "propose",
    "--from",
    "cool-workflow",
    "--to",
    "chime",
    "--title",
    "Add retry",
    "--rationale",
    "flaky net",
  ];
  const propose = run(proposeArgs);
  assert.equal(propose.status, 0);
  const proposal = JSON.parse(propose.stdout);
  assert.match(proposal.digest, /^sha256:[0-9a-f]{64}$/);
  assert.equal(proposal.id, `ldg-${proposal.digest.slice(7, 23)}`);

  // A second, distinct proposal supplies a REAL foreign id to forge with --
  // not a made-up string, so this is a realistic "spoof another entry's id"
  // attack, exactly the union-de-duplication threat the spec calls out.
  const propose2 = run([
    "ledger",
    "propose",
    "--from",
    "chime",
    "--to",
    "cool-workflow",
    "--title",
    "Unrelated change",
    "--rationale",
    "other",
  ]);
  const proposal2 = JSON.parse(propose2.stdout);
  assert.notEqual(proposal2.id, proposal.id, "sanity: the two seed proposals must have distinct ids");

  // Forge: keep proposal's content and digest EXACTLY as-is (so "digest"
  // check passes), but swap in proposal2's id. The digest is still
  // internally consistent with the (unchanged) content -- only the id lies.
  const forged = Object.assign({}, proposal, { id: proposal2.id });

  const dir = freshDir("ledger-dir");
  const forgedPath = path.join(dir, "forged.json");
  require("node:fs").writeFileSync(forgedPath, JSON.stringify(forged));

  const verify = run(["ledger", "verify", "--file", forgedPath]);
  assert.equal(verify.status, 1, "an id-forged entry must fail verification, exit 1");
  const result = JSON.parse(verify.stdout);
  assert.equal(result.ok, false);

  // The "digest" check itself must still PASS (content didn't change) --
  // the failure must come from a distinct, later "id" check, never be
  // reported as ledger-digest-mismatch.
  const digestCheck = result.checks.find((c) => c.name === "digest");
  assert.ok(digestCheck, "digest check must still run and be reported");
  assert.equal(digestCheck.pass, true, "digest matches its own (unchanged) content -- the forgery is id-only");

  assert.equal(result.failedChecks.length, 1);
  assert.equal(result.failedChecks[0].name, "id");
  assert.equal(result.failedChecks[0].code, "ledger-id-mismatch");
  assert.notEqual(result.failedChecks[0].code, "ledger-digest-mismatch", "id forgery must be a DISTINCT code from digest forgery");
  assert.match(result.failedChecks[0].detail, new RegExp(`not the content-addressed id.*expected ${proposal.id}`));

  // apply must also refuse it (diff:null), same fail-closed contract as any
  // other failing verify.
  const apply = run(["ledger", "apply", "--file", forgedPath]);
  assert.equal(apply.status, 1);
  const applyResult = JSON.parse(apply.stdout);
  assert.equal(applyResult.ok, false);
  assert.equal(applyResult.diff, null);
});
