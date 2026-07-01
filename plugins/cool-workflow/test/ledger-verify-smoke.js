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

process.stdout.write("ledger-verify-smoke: ok (propose/review round-trip, tamper+junk+truncation fail-closed, stdin, git-transport inbox)\n");
