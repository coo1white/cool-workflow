#!/usr/bin/env node
"use strict";

// Smoke: the cross-agent handoff ledger (`cw ledger propose|review|verify`).
// Proves the round-trip and — the point of the verb — that verification is
// FAIL-CLOSED: a tampered or malformed entry is refused with a non-zero exit,
// so `cw ledger verify <file> && open-pr` can never proceed on a lie.
//
// Fails before the feature exists (the `ledger` verb is unknown); passes after.

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const cli = path.join(__dirname, "..", "dist", "cli.js");

function runCli(args, opts) {
  const r = spawnSync(process.execPath, [cli, ...args], { encoding: "utf8", ...opts });
  return { status: r.status, stdout: r.stdout, stderr: r.stderr };
}

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cw-ledger-"));

// --- 1. propose -> a digest-sealed proposal entry that verifies -------------
let r = runCli(["ledger", "propose", "--from", "cool-workflow", "--to", "chime",
  "--title", "Add retry", "--rationale", "flaky net", "--files", "a.ts,b.ts", "--diff", "@@ -1 +1 @@"]);
assert.equal(r.status, 0, "propose exits 0");
const proposal = JSON.parse(r.stdout);
assert.equal(proposal.kind, "proposal", "kind is proposal");
assert.equal(proposal.to, "chime", "to preserved");
assert.deepEqual(proposal.targetFiles, ["a.ts", "b.ts"], "files parsed from CSV");
assert.ok(/^sha256:[0-9a-f]{64}$/.test(proposal.digest), "full sha256 digest");
assert.ok(proposal.id.startsWith("ldg-"), "content-addressed id");

const proposalFile = path.join(dir, "proposal.json");
fs.writeFileSync(proposalFile, JSON.stringify(proposal));
r = runCli(["ledger", "verify", "--file", proposalFile]);
assert.equal(r.status, 0, "intact proposal verify exits 0");
assert.equal(JSON.parse(r.stdout).ok, true, "intact proposal ok:true");

// --- 2. review -> a digest-sealed verdict entry that verifies ---------------
r = runCli(["ledger", "review", "--from", "chime", "--to", "cool-workflow",
  "--target", proposal.id, "--verdict", "approved", "--findings", "looks good,tests pass"]);
assert.equal(r.status, 0, "review exits 0");
const review = JSON.parse(r.stdout);
assert.equal(review.kind, "review", "kind is review");
assert.equal(review.verdict, "APPROVED", "verdict normalized to upper-case");
assert.deepEqual(review.findings, ["looks good", "tests pass"], "findings parsed");

const reviewFile = path.join(dir, "review.json");
fs.writeFileSync(reviewFile, JSON.stringify(review));
r = runCli(["ledger", "verify", "--file", reviewFile]);
assert.equal(r.status, 0, "intact review verify exits 0");
assert.equal(JSON.parse(r.stdout).ok, true, "intact review ok:true");

// --- 3. TAMPER the content but keep the old digest -> fail-closed -----------
const forged = { ...proposal, title: "Delete production database" };
const forgedFile = path.join(dir, "forged.json");
fs.writeFileSync(forgedFile, JSON.stringify(forged));
r = runCli(["ledger", "verify", "--file", forgedFile]);
assert.equal(r.status, 1, "forged entry exits 1 (fail-closed)");
let out = JSON.parse(r.stdout);
assert.equal(out.ok, false, "forged entry ok:false");
assert.ok(out.failedChecks.some((c) => c.code === "ledger-digest-mismatch"),
  "reports ledger-digest-mismatch");

// --- 4. malformed JSON -> refused, not crashed ------------------------------
const junkFile = path.join(dir, "junk.json");
fs.writeFileSync(junkFile, "{ not json");
r = runCli(["ledger", "verify", "--file", junkFile]);
assert.equal(r.status, 1, "non-JSON exits 1");
out = JSON.parse(r.stdout);
assert.equal(out.ok, false, "non-JSON ok:false");
assert.ok(out.failedChecks.some((c) => c.code === "ledger-bad-json"), "reports ledger-bad-json");

// --- 5. missing a required field -> refused ---------------------------------
const truncated = { ...proposal };
delete truncated.rationale;
const truncFile = path.join(dir, "trunc.json");
fs.writeFileSync(truncFile, JSON.stringify(truncated));
r = runCli(["ledger", "verify", "--file", truncFile]);
assert.equal(r.status, 1, "missing-field entry exits 1");
out = JSON.parse(r.stdout);
assert.ok(out.failedChecks.some((c) => c.code === "ledger-missing-field" || c.code === "ledger-digest-mismatch"),
  "missing field refused");

// --- 6. stdin transport works too -------------------------------------------
r = runCli(["ledger", "verify"], { input: JSON.stringify(proposal) });
assert.equal(r.status, 0, "verify from stdin exits 0");
assert.equal(JSON.parse(r.stdout).ok, true, "stdin entry ok:true");

// --- 7. git-transport inbox: `cw ledger list --dir` verifies the whole dir ---
const ledgerDir = path.join(dir, "shared-ledger");
fs.mkdirSync(ledgerDir);
fs.writeFileSync(path.join(ledgerDir, `${proposal.id}.json`), JSON.stringify(proposal));
fs.writeFileSync(path.join(ledgerDir, `${review.id}.json`), JSON.stringify(review));
r = runCli(["ledger", "list", "--dir", ledgerDir]);
assert.equal(r.status, 0, "clean inbox exits 0");
let list = JSON.parse(r.stdout);
assert.equal(list.count, 2, "inbox lists both entries");
assert.equal(list.allOk, true, "clean inbox allOk:true");

// drop a tampered entry into the same dir -> the whole inbox is refused
fs.writeFileSync(path.join(ledgerDir, "forged.json"), JSON.stringify(forged));
r = runCli(["ledger", "list", "--dir", ledgerDir]);
assert.equal(r.status, 1, "inbox with a forged entry exits 1 (fail-closed)");
list = JSON.parse(r.stdout);
assert.equal(list.allOk, false, "mixed inbox allOk:false");
const bad = list.entries.find((e) => e.file === "forged.json");
assert.ok(bad && bad.ok === false && bad.failedChecks.some((c) => c.code === "ledger-digest-mismatch"),
  "the forged entry is the one flagged");

// --- 8. multi-mirror union: repeatable --dir union-verifies mirrors ----------
// mirrorA has the proposal; mirrorB has the review + a COPY of the proposal.
const mirrorA = path.join(dir, "mirrorA");
const mirrorB = path.join(dir, "mirrorB");
fs.mkdirSync(mirrorA);
fs.mkdirSync(mirrorB);
fs.writeFileSync(path.join(mirrorA, `${proposal.id}.json`), JSON.stringify(proposal));
fs.writeFileSync(path.join(mirrorB, `${proposal.id}.json`), JSON.stringify(proposal)); // same entry, mirrored
fs.writeFileSync(path.join(mirrorB, `${review.id}.json`), JSON.stringify(review));
r = runCli(["ledger", "list", "--dir", mirrorA, "--dir", mirrorB]);
assert.equal(r.status, 0, "clean mirror union exits 0");
let union = JSON.parse(r.stdout);
assert.deepEqual(union.dirs, [mirrorA, mirrorB], "union reports both dirs");
assert.equal(union.allOk, true, "clean union allOk:true");
// proposal is de-duplicated across mirrors; review is unique -> 2 distinct entries
assert.equal(union.count, 2, "union de-dupes the mirrored proposal (2 distinct entries)");
const dup = union.entries.find((e) => e.id === proposal.id);
assert.ok(dup && dup.dirs.length === 2, "the mirrored proposal records both mirror dirs");

// a single --dir keeps the ORIGINAL single-dir shape (POLA) -> `dir`, no `dirs`
r = runCli(["ledger", "list", "--dir", mirrorA]);
const single = JSON.parse(r.stdout);
assert.ok(Object.prototype.hasOwnProperty.call(single, "dir") && !("dirs" in single),
  "single --dir keeps the original shape (dir, not dirs)");

// tamper one mirror -> the whole union is refused (fail-closed across mirrors)
fs.writeFileSync(path.join(mirrorB, "forged.json"), JSON.stringify(forged));
r = runCli(["ledger", "list", "--dir", mirrorA, "--dir", mirrorB]);
assert.equal(r.status, 1, "a tampered mirror fails the whole union (exit 1)");
union = JSON.parse(r.stdout);
assert.equal(union.allOk, false, "tampered union allOk:false");

// --- 9. id-binding: a valid-content entry with a forged/absent id is refused -
// `id` is NOT part of the digest, so it must be checked against the content-
// addressed id; otherwise a forged id could collide with a legit entry.
const forgedId = { ...review, id: "ldg-0000000000000000" };
fs.writeFileSync(path.join(dir, "forgedid.json"), JSON.stringify(forgedId));
r = runCli(["ledger", "verify", "--file", path.join(dir, "forgedid.json")]);
assert.equal(r.status, 1, "forged-id entry exits 1");
assert.ok(JSON.parse(r.stdout).failedChecks.some((c) => c.code === "ledger-id-mismatch"),
  "forged id reports ledger-id-mismatch");

const noId = { ...review };
delete noId.id;
fs.writeFileSync(path.join(dir, "noid.json"), JSON.stringify(noId));
r = runCli(["ledger", "verify", "--file", path.join(dir, "noid.json")]);
assert.equal(r.status, 1, "id-less entry exits 1 (id is required and content-bound)");
assert.ok(JSON.parse(r.stdout).failedChecks.some((c) => c.code === "ledger-id-mismatch"),
  "id-less entry reports ledger-id-mismatch");

// --- 10. union: a spoofed-id entry cannot silently mask a legit one ----------
const mirrorC = path.join(dir, "mirrorC");
const mirrorD = path.join(dir, "mirrorD");
fs.mkdirSync(mirrorC);
fs.mkdirSync(mirrorD);
fs.writeFileSync(path.join(mirrorC, `${review.id}.json`), JSON.stringify(review)); // legit
// mint a DIFFERENT valid entry, then spoof its id to collide with `review`
const other = JSON.parse(runCli(["ledger", "review", "--from", "x", "--to", "y",
  "--target", "t2", "--verdict", "rejected", "--findings", "different content"]).stdout);
const spoof = { ...other, id: review.id }; // valid content+digest, but id spoofed to collide
fs.writeFileSync(path.join(mirrorD, `${review.id}.json`), JSON.stringify(spoof));
r = runCli(["ledger", "list", "--dir", mirrorC, "--dir", mirrorD]);
assert.equal(r.status, 1, "a spoofed-id entry fails the union (cannot mask a legit entry)");
assert.equal(JSON.parse(r.stdout).allOk, false, "spoofed-id union allOk:false");

// --- 11. ledger list refuses symlink / non-regular entries ------------------
const linkDir = path.join(dir, "link-ledger");
fs.mkdirSync(linkDir);
fs.writeFileSync(path.join(linkDir, `${proposal.id}.json`), JSON.stringify(proposal));
const outside = path.join(dir, "outside.json");
fs.writeFileSync(outside, JSON.stringify(review));
fs.symlinkSync(outside, path.join(linkDir, "linked.json"));
r = runCli(["ledger", "list", "--dir", linkDir]);
assert.equal(r.status, 1, "symlink entry fails the inbox closed");
list = JSON.parse(r.stdout);
assert.equal(list.allOk, false, "symlink inbox allOk:false");
const linked = list.entries.find((e) => e.file === "linked.json");
assert.ok(linked && linked.failedChecks.some((c) => c.code === "ledger-entry-not-regular"), "symlink reports ledger-entry-not-regular");

process.stdout.write("ledger-verify-smoke: ok (round-trip, tamper+junk+truncation fail-closed, stdin, git-transport inbox, multi-mirror union, id-binding + spoof-resistant)\n");
