#!/usr/bin/env node
"use strict";

// Handoff ledger digest/id shape and fail-closed verify/apply/list, using
// only `cw ledger ...` (no run needed -- the ledger kernel is pure).
// Pins: digest is the 64-hex content-digest family; id is "ldg-" + first
// 16 hex of the digest; a tampered field is caught by "digest" (not by
// "id", which stays byte-stable since id is outside the digest); apply
// only ever lets the diff out on ok:true; list resolves an inbox.

const fs = require("node:fs");
const path = require("node:path");
const { run, freshDir, caseMain, assert } = require("../lib");

const SHA256_64 = /^sha256:[0-9a-f]{64}$/;

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
    "--files",
    "src/net.ts,src/net2.ts",
    "--diff",
    "@@ -1,1 +1,1 @@\n-old\n+new\n",
  ];
  const propose = run(proposeArgs);
  assert.equal(propose.status, 0);
  const proposal = JSON.parse(propose.stdout);

  assert.equal(proposal.kind, "proposal");
  assert.equal(proposal.schemaVersion, 1);
  assert.equal(proposal.from, "cool-workflow");
  assert.equal(proposal.to, "chime");
  assert.deepEqual(proposal.targetFiles, ["src/net.ts", "src/net2.ts"]);
  assert.equal(proposal.suggestedDiff, "@@ -1,1 +1,1 @@\n-old\n+new\n", "diff must pass through verbatim, no trim");
  assert.match(proposal.digest, SHA256_64, "ledger digest must be sha256: + 64 hex");
  assert.equal(proposal.id, `ldg-${proposal.digest.slice(7, 23)}`);

  const dir = freshDir("ledger-dir");
  const proposalPath = path.join(dir, "a.json");
  fs.writeFileSync(proposalPath, JSON.stringify(proposal));

  // clean verify: ok, checks all pass
  const verify = run(["ledger", "verify", "--file", proposalPath]);
  assert.equal(verify.status, 0);
  const verifyResult = JSON.parse(verify.stdout);
  assert.equal(verifyResult.ok, true);
  assert.equal(verifyResult.id, proposal.id);
  assert.deepEqual(verifyResult.failedChecks, []);

  // clean apply: diff comes back only on ok:true
  const apply = run(["ledger", "apply", "--file", proposalPath]);
  assert.equal(apply.status, 0);
  const applyResult = JSON.parse(apply.stdout);
  assert.equal(applyResult.ok, true);
  assert.equal(applyResult.diff, proposal.suggestedDiff);

  // tamper: flip a content field, keep id and digest as-is
  const tampered = Object.assign({}, proposal, { title: "tampered title" });
  const tamperedPath = path.join(dir, "b.json");
  fs.writeFileSync(tamperedPath, JSON.stringify(tampered));

  const tamperVerify = run(["ledger", "verify", "--file", tamperedPath]);
  assert.equal(tamperVerify.status, 1);
  const tamperResult = JSON.parse(tamperVerify.stdout);
  assert.equal(tamperResult.ok, false);
  assert.equal(tamperResult.failedChecks.length, 1);
  assert.equal(tamperResult.failedChecks[0].name, "digest");
  assert.equal(tamperResult.failedChecks[0].code, "ledger-digest-mismatch");
  assert.match(tamperResult.failedChecks[0].detail, /^stored digest does not match content \(recomputed sha256:[0-9a-f]{64}\)$/);

  // apply on a tampered entry: diff:null, exit 1
  const tamperApply = run(["ledger", "apply", "--file", tamperedPath]);
  assert.equal(tamperApply.status, 1);
  const tamperApplyResult = JSON.parse(tamperApply.stdout);
  assert.equal(tamperApplyResult.ok, false);
  assert.equal(tamperApplyResult.diff, null);

  // review round trip: verdict is upper-cased on build
  const review = run([
    "ledger",
    "review",
    "--from",
    "chime",
    "--to",
    "cool-workflow",
    "--target",
    proposal.id,
    "--verdict",
    "approved",
  ]);
  assert.equal(review.status, 0);
  const reviewEntry = JSON.parse(review.stdout);
  assert.equal(reviewEntry.kind, "review");
  assert.equal(reviewEntry.verdict, "APPROVED");
  assert.match(reviewEntry.digest, SHA256_64);

  // a bad verdict is refused before any entry is built
  const badVerdict = run(["ledger", "review", "--from", "a", "--to", "b", "--target", "x", "--verdict", "maybe"]);
  assert.equal(badVerdict.status, 1);
  assert.equal(badVerdict.stdout, "");
  assert.equal(badVerdict.stderr, 'cw: --verdict must be "approved" or "rejected".\n');

  // list resolves the inbox: proposal + its approving review -> "approved"
  fs.writeFileSync(path.join(dir, "c.json"), JSON.stringify(reviewEntry));
  const list = run(["ledger", "list", "--dir", dir]);
  assert.equal(list.status, 1, "the inbox still holds the tampered entry b.json, so allOk is false");
  const listResult = JSON.parse(list.stdout);
  assert.equal(listResult.allOk, false);
  const resolved = listResult.resolution.proposals.find((p) => p.id === proposal.id);
  assert.equal(resolved.resolution, "approved");
  assert.equal(listResult.resolution.approved, 1);
  assert.equal(listResult.resolution.pending, 0);

  // non-JSON input on verify: exact structured refusal, exit 1
  const badJson = run(["ledger", "verify"], { input: "not json at all" });
  assert.equal(badJson.status, 1);
  const badJsonResult = JSON.parse(badJson.stdout);
  assert.equal(badJsonResult.ok, false);
  assert.equal(badJsonResult.checks[0].code, "ledger-bad-json");

  // unknown ledger subcommand: fixed usage string
  const badSub = run(["ledger", "frobnicate"]);
  assert.equal(badSub.status, 1);
  assert.equal(badSub.stderr, "cw: Usage: cw ledger propose|review|verify|apply|list [options]\n");
});
