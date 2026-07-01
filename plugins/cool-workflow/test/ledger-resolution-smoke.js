#!/usr/bin/env node
"use strict";

// Smoke: `cw ledger list` inbox RESOLUTION — the derived proposal↔review state.
// The ledger transport (propose/review/verify/list) moves entries; this proves
// the inbox is machine-actionable: `list` pairs each proposal with the review(s)
// that `target` it and reports pending | approved | rejected | contested, so an
// agent can see which proposals are still open WITHOUT opening every file.
//
// It is also FAIL-CLOSED: a tampered review must not resolve a proposal (the
// proposal stays `pending`), and the resolution is additive — the existing list
// output is byte-unchanged (POLA).
//
// Fails before the feature exists (`list` has no `resolution` key → the
// assertions on derived state throw); passes after.

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

// Mint a valid, digest-sealed entry via the CLI and return it parsed.
function propose(title) {
  const r = runCli(["ledger", "propose", "--from", "cool-workflow", "--to", "chime",
    "--title", title, "--rationale", `because ${title}`]);
  assert.equal(r.status, 0, `propose "${title}" exits 0`);
  return JSON.parse(r.stdout);
}
function review(targetId, verdict, findings) {
  const r = runCli(["ledger", "review", "--from", "chime", "--to", "cool-workflow",
    "--target", targetId, "--verdict", verdict, "--findings", findings]);
  assert.equal(r.status, 0, `review ${verdict} exits 0`);
  return JSON.parse(r.stdout);
}
function writeEntry(dir, entry) {
  fs.writeFileSync(path.join(dir, `${entry.id}.json`), JSON.stringify(entry));
}

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cw-ledger-res-"));
const inbox = path.join(dir, "inbox");
fs.mkdirSync(inbox);

// --- Build a mixed inbox: one of each resolution state ----------------------
const p1 = propose("Add retry");                     // approved
const r1 = review(p1.id, "approved", "tests pass,scope ok");
const p2 = propose("Rename thing");                  // pending (no review)
const p3 = propose("Delete module");                 // rejected
const r3 = review(p3.id, "rejected", "breaks API");
const p4 = propose("Change defaults");               // contested (approve + reject)
const r4a = review(p4.id, "approved", "looks fine");
const r4b = review(p4.id, "rejected", "risky");
assert.notEqual(r4a.id, r4b.id, "conflicting reviews are distinct entries");

for (const e of [p1, r1, p2, p3, r3, p4, r4a, r4b]) writeEntry(inbox, e);

let r = runCli(["ledger", "list", "--dir", inbox]);
assert.equal(r.status, 0, "clean inbox exits 0");
const list = JSON.parse(r.stdout);
assert.equal(list.allOk, true, "clean inbox allOk:true");

// --- The derived resolution --------------------------------------------------
const res = list.resolution;
assert.ok(res && Array.isArray(res.proposals), "list carries a resolution summary");
assert.equal(res.proposals.length, 4, "one resolution row per proposal (reviews are not proposals)");

const byId = Object.fromEntries(res.proposals.map((p) => [p.id, p]));
assert.equal(byId[p1.id].resolution, "approved", "single APPROVED review -> approved");
assert.deepEqual(byId[p1.id].reviews, [r1.id], "approved proposal records its answering review");
assert.equal(byId[p1.id].title, "Add retry", "resolution surfaces the proposal title");
assert.equal(byId[p2.id].resolution, "pending", "no review -> pending");
assert.deepEqual(byId[p2.id].reviews, [], "pending proposal has no answering reviews");
assert.equal(byId[p3.id].resolution, "rejected", "single REJECTED review -> rejected");
assert.equal(byId[p4.id].resolution, "contested", "disagreeing reviews -> contested");
assert.deepEqual(byId[p4.id].reviews, [r4a.id, r4b.id].sort(), "contested proposal records both reviews");

assert.equal(res.pending, 1, "pending tally");
assert.equal(res.approved, 1, "approved tally");
assert.equal(res.rejected, 1, "rejected tally");
assert.equal(res.contested, 1, "contested tally");

// --- POLA: the per-entry list shape is additive (existing keys intact) -------
const p1Entry = list.entries.find((e) => e.id === p1.id);
for (const k of ["file", "id", "kind", "from", "to", "ok", "failedChecks"]) {
  assert.ok(Object.prototype.hasOwnProperty.call(p1Entry, k), `entry keeps existing key ${k}`);
}
assert.equal(p1Entry.title, "Add retry", "proposal entry carries its title");
const r1Entry = list.entries.find((e) => e.id === r1.id);
assert.equal(r1Entry.target, p1.id, "review entry carries its target");
assert.equal(r1Entry.verdict, "APPROVED", "review entry carries its verdict");

// --- FAIL-CLOSED: a tampered review must NOT resolve its proposal ------------
const tamperDir = path.join(dir, "tampered");
fs.mkdirSync(tamperDir);
const p5 = propose("Touch the hot path");
writeEntry(tamperDir, p5);
// a review that targets p5 but whose content was altered after sealing
const r5 = review(p5.id, "approved", "looks good");
const forged = { ...r5, findings: ["actually forged"] }; // digest no longer matches
fs.writeFileSync(path.join(tamperDir, "forged-review.json"), JSON.stringify(forged));

r = runCli(["ledger", "list", "--dir", tamperDir]);
assert.equal(r.status, 1, "an inbox with a tampered entry exits 1 (fail-closed)");
const tampered = JSON.parse(r.stdout);
assert.equal(tampered.allOk, false, "tampered inbox allOk:false");
const p5res = tampered.resolution.proposals.find((p) => p.id === p5.id);
assert.equal(p5res.resolution, "pending", "a tampered review does NOT resolve the proposal — stays pending");
assert.deepEqual(p5res.reviews, [], "the forged review is not counted");

// --- Union path carries resolution too (deduped across mirrors) -------------
const mA = path.join(dir, "mirrorA");
const mB = path.join(dir, "mirrorB");
fs.mkdirSync(mA);
fs.mkdirSync(mB);
writeEntry(mA, p1); writeEntry(mA, r1);
writeEntry(mB, p1); writeEntry(mB, r1); // same entries, mirrored
r = runCli(["ledger", "list", "--dir", mA, "--dir", mB]);
assert.equal(r.status, 0, "clean mirror union exits 0");
const union = JSON.parse(r.stdout);
assert.equal(union.resolution.proposals.length, 1, "union de-dupes the mirrored proposal to one resolution row");
assert.equal(union.resolution.proposals[0].resolution, "approved", "union resolves the mirrored proposal");

process.stdout.write("ledger-resolution-smoke: ok (pending/approved/rejected/contested derived; tampered review does not resolve; additive/POLA; union carries resolution)\n");
