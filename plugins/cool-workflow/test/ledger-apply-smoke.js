#!/usr/bin/env node
"use strict";

// Smoke: `cw ledger apply` — the fail-closed bridge from a verified proposal to
// a `git apply`-able patch. A proposal carries a `suggestedDiff`, but the diff
// must only ESCAPE after the entry verifies, so `cw ledger apply <file> | git
// apply` can never feed git an unverified patch. Proves:
//   - a verified proposal's diff round-trips AND is a real patch git accepts;
//   - a tampered entry, a review (not a proposal), a diff-less proposal, and
//     non-JSON bytes each exit 1 with `diff:null` — no patch leaks.
//
// Fails before the verb exists (`apply` is unknown); passes after.

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

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cw-ledger-apply-"));
const repo = path.join(dir, "repo");
fs.mkdirSync(repo);
function git(args) {
  const r = spawnSync("git", args, { cwd: repo, encoding: "utf8" });
  assert.equal(r.status, 0, `git ${args.join(" ")} ok: ${r.stderr}`);
  return r.stdout;
}

// --- Build a REAL unified diff via git, then revert so the patch re-applies ---
git(["init", "-q"]);
git(["config", "user.email", "t@t"]);
git(["config", "user.name", "t"]);
fs.writeFileSync(path.join(repo, "f.txt"), "alpha\n");
git(["add", "f.txt"]);
git(["commit", "-qm", "init"]);
fs.writeFileSync(path.join(repo, "f.txt"), "beta\n");
const realDiff = git(["diff"]);
git(["checkout", "--", "f.txt"]); // back to "alpha" so the patch applies cleanly
assert.ok(realDiff.includes("-alpha") && realDiff.includes("+beta"), "captured a real unified diff");

// --- 1. a verified proposal -> apply emits its diff (exit 0) -----------------
let r = runCli(["ledger", "propose", "--from", "cool-workflow", "--to", "chime",
  "--title", "Flip alpha to beta", "--rationale", "the test says so", "--files", "f.txt", "--diff", realDiff]);
assert.equal(r.status, 0, "propose exits 0");
const proposal = JSON.parse(r.stdout);
const proposalFile = path.join(dir, "proposal.json");
fs.writeFileSync(proposalFile, JSON.stringify(proposal));

r = runCli(["ledger", "apply", "--file", proposalFile]);
assert.equal(r.status, 0, "apply on a verified proposal exits 0");
const applied = JSON.parse(r.stdout);
assert.equal(applied.ok, true, "apply ok:true");
assert.equal(applied.kind, "proposal", "kind is proposal");
assert.equal(applied.diff, realDiff, "the emitted diff round-trips the proposal's suggestedDiff");

// --- 2. the emitted diff is a REAL patch git apply accepts -------------------
const patchFile = path.join(dir, "out.patch");
fs.writeFileSync(patchFile, applied.diff);
let g = spawnSync("git", ["apply", "--check", patchFile], { cwd: repo, encoding: "utf8" });
assert.equal(g.status, 0, `git apply --check accepts the emitted diff: ${g.stderr}`);

// --- 3. FAIL-CLOSED: a tampered proposal leaks NO diff -----------------------
const forged = { ...proposal, title: "Delete production database" }; // digest no longer matches
const forgedFile = path.join(dir, "forged.json");
fs.writeFileSync(forgedFile, JSON.stringify(forged));
r = runCli(["ledger", "apply", "--file", forgedFile]);
assert.equal(r.status, 1, "apply on a tampered entry exits 1 (fail-closed)");
let out = JSON.parse(r.stdout);
assert.equal(out.ok, false, "tampered apply ok:false");
assert.equal(out.diff, null, "NO diff escapes a tampered proposal");
assert.ok(out.failedChecks.some((c) => c.code === "ledger-digest-mismatch"), "reports the verify failure");

// --- 4. a review is not a proposal -> refused, no diff ----------------------
r = runCli(["ledger", "review", "--from", "chime", "--to", "cool-workflow",
  "--target", proposal.id, "--verdict", "approved", "--findings", "ok"]);
const review = JSON.parse(r.stdout);
const reviewFile = path.join(dir, "review.json");
fs.writeFileSync(reviewFile, JSON.stringify(review));
r = runCli(["ledger", "apply", "--file", reviewFile]);
assert.equal(r.status, 1, "apply on a review exits 1");
out = JSON.parse(r.stdout);
assert.equal(out.diff, null, "a review yields no diff");
assert.ok(out.failedChecks.some((c) => c.code === "ledger-not-a-proposal"), "reports ledger-not-a-proposal");

// --- 5. a proposal with no suggestedDiff -> refused -------------------------
r = runCli(["ledger", "propose", "--from", "a", "--to", "b", "--title", "no diff", "--rationale", "none"]);
const noDiff = JSON.parse(r.stdout);
assert.equal(noDiff.suggestedDiff, "", "a diff-less proposal seals with an empty suggestedDiff");
const noDiffFile = path.join(dir, "nodiff.json");
fs.writeFileSync(noDiffFile, JSON.stringify(noDiff));
r = runCli(["ledger", "apply", "--file", noDiffFile]);
assert.equal(r.status, 1, "apply on a diff-less proposal exits 1");
out = JSON.parse(r.stdout);
assert.equal(out.diff, null, "no diff to emit");
assert.ok(out.failedChecks.some((c) => c.code === "ledger-empty-diff"), "reports ledger-empty-diff");

// --- 6. non-JSON bytes -> refused, not crashed ------------------------------
const junkFile = path.join(dir, "junk.json");
fs.writeFileSync(junkFile, "{ not json");
r = runCli(["ledger", "apply", "--file", junkFile]);
assert.equal(r.status, 1, "non-JSON apply exits 1");
out = JSON.parse(r.stdout);
assert.ok(out.failedChecks.some((c) => c.code === "ledger-bad-json"), "reports ledger-bad-json");

// --- 7. stdin transport works too -------------------------------------------
r = runCli(["ledger", "apply"], { input: JSON.stringify(proposal) });
assert.equal(r.status, 0, "apply from stdin exits 0");
assert.equal(JSON.parse(r.stdout).diff, realDiff, "stdin apply emits the diff");

process.stdout.write("ledger-apply-smoke: ok (verified proposal -> git-apply-able diff; tampered/review/diffless/junk each leak no diff, fail-closed; stdin)\n");
