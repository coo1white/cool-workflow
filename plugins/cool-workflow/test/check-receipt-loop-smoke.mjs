#!/usr/bin/env node
// check-receipt-loop-smoke — the "done receipt" user loop, end to end, as a
// new user walks it:
//   cw check -- <pass>  -> exit 0, receipt saved, usable
//   cw check -- <fail>  -> exit 1, receipt says failed, next = run it again
//   cw check list / show -> see them; a missing id says "cw check list"
//   a drive whose stub agent cites receipt:<pass> completes, and report.md
//   says "verified by receipt rc-… (exit 0 at <sha>)"
//   a drive citing the failed, a missing, or a stale receipt is refused with
//   the plain reason and one next command; a changed receipt is "tampered"
//   report bundle + verify-bundle still verify the run that carries a receipt.
// The stub agent is a local script, never a model.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { cw } from "./helpers/cw.mjs";
import { tmpDir } from "./helpers/workspace.mjs";

const env = { ...process.env, CW_NO_AUTO_AGENT: "1", CW_DRIVE_PROGRESS: "0", NO_COLOR: "1" };
delete env.CW_AGENT_COMMAND;
delete env.CW_CHECK_PUBKEY;
delete env.CW_CHECK_PRIVKEY;

const work = tmpDir("cw-receipt-loop-");
const repo = path.join(work, "repo");
fs.mkdirSync(repo);
const git = (...args) => spawnSync("git", ["-C", repo, ...args], { encoding: "utf8" });
git("init", "-q");
for (const [k, v] of [["user.email", "t@t"], ["user.name", "t"], ["commit.gpgsign", "false"]]) git("config", k, v);
fs.writeFileSync(path.join(repo, "README.md"), "# tiny project\n");
fs.writeFileSync(path.join(repo, "pass.mjs"), 'console.log("1 test passed");\n');
fs.writeFileSync(path.join(repo, "fail.mjs"), 'console.error("1 test failed"); process.exit(1);\n');
git("add", "-A");
git("commit", "-qm", "init");

const run = (args) => cw(args, { cwd: repo, env });
const json = (r) => JSON.parse(r.stdout);

// 1. A passing check.
const pass = run(["check", "--", process.execPath, "pass.mjs"]);
assert.equal(pass.status, 0, pass.stderr);
const passed = json(pass);
assert.equal(passed.ok, true);
assert.equal(passed.usable, true);
assert.match(passed.id, /^rc-[0-9a-f]{16}$/);
assert.equal(passed.cite, `receipt:${passed.id}`);
assert.equal(passed.next, `cw check show ${passed.id}`);
assert.ok(fs.existsSync(path.join(repo, ".cw", "receipts", `${passed.id}.json`)), "receipt saved under .cw/receipts");
assert.doesNotMatch(pass.stderr, /1 test passed/, "piped, the command's own output is not echoed (Rule of Silence); stdout stays data");
const head = git("rev-parse", "HEAD").stdout.trim();
assert.equal(passed.gitHead, head);

// 2. A failing check: cw check fails too, and says so.
const fail = run(["check", "--", process.execPath, "fail.mjs"]);
assert.equal(fail.status, 1);
const failed = json(fail);
assert.equal(failed.ok, false);
assert.equal(failed.code, "receipt-failed");
assert.match(failed.reason, /shows the check failed \(exit 1 at [0-9a-f]{7}\)/);
assert.match(failed.next, /^cw check -- .+ fail\.mjs$/);

// 3. See them.
const list = json(run(["check", "list"]));
assert.deepEqual(list.map((e) => e.id).sort(), [passed.id, failed.id].sort());
assert.equal(list.find((e) => e.id === passed.id).usable, true);
const show = run(["check", "show", passed.id]);
assert.equal(show.status, 0);
assert.equal(json(show).receipt.exitCode, 0);
const missing = run(["check", "show", "rc-0000000000000000"]);
assert.equal(missing.status, 1);
assert.equal(json(missing).code, "receipt-not-found");
assert.equal(json(missing).next, "cw check list");

// A stub agent that cites one receipt in every result.
function stubCiting(evidence) {
  const file = path.join(work, `stub-${Math.random().toString(16).slice(2)}.cjs`);
  const fence = "`".repeat(3);
  fs.writeFileSync(file, [
    'const fs = require("fs");',
    `const body = "# R\\n\\n" + ${JSON.stringify(fence)} + "cw:result\\n" + JSON.stringify({ summary: "tests pass", findings: [], evidence: [process.cwd() + "/README.md:1", ${JSON.stringify(evidence)}] }) + "\\n" + ${JSON.stringify(fence)} + "\\n";`,
    "fs.writeFileSync(process.argv[2], body);",
    'process.stdout.write(JSON.stringify({ model: "stub", usage: { input_tokens: 1, output_tokens: 1 } }));',
  ].join("\n"));
  return `${process.execPath} ${file} {{result}}`;
}
const drive = (evidence) => cw(["-q", "do the tests pass?", "-dir", repo, "--agent-command", stubCiting(evidence), "--json"], { cwd: work, env });
function runStateText(out) {
  const runDir = path.join(repo, ".cw", "runs", out.runId);
  return fs.readFileSync(path.join(runDir, "state.json"), "utf8");
}

// 4. A result citing the passing receipt is accepted, and the report says so.
const good = drive(`receipt:${passed.id}`);
assert.equal(good.status, 0, good.stderr);
const goodOut = json(good);
assert.equal(goodOut.status, "complete");
const runDir = path.join(repo, ".cw", "runs", goodOut.runId);
assert.ok(fs.existsSync(path.join(runDir, "receipts", `${passed.id}.json`)), "the run pins the receipt it used");
const report = fs.readFileSync(path.join(runDir, "report.md"), "utf8");
assert.match(report, new RegExp(`- receipt:${passed.id} — verified by receipt ${passed.id} \\(exit 0 at ${head.slice(0, 7)}\\)`));
assert.match(report, /## Check Receipts/);

// 5. The bundle carries the receipt and still verifies offline.
const bundle = cw(["report", "bundle", goodOut.runId, "--output", path.join(work, "good.cwrun.json")], { cwd: repo, env });
assert.equal(bundle.status, 0, bundle.stderr);
const verify = cw(["report", "verify-bundle", path.join(work, "good.cwrun.json"), "--json"], { cwd: work, env });
assert.equal(verify.status, 0, verify.stdout);
const archive = JSON.parse(fs.readFileSync(path.join(work, "good.cwrun.json"), "utf8"));
assert.ok(archive.files.some((f) => f.relativePath === `receipts/${passed.id}.json`), "receipt travels in the bundle");
// A pinned receipt changed in the run folder: the bundle no longer verifies.
{
  const pinned = path.join(runDir, "receipts", `${passed.id}.json`);
  const kept = fs.readFileSync(pinned, "utf8");
  fs.writeFileSync(pinned, kept.replace('"bytes": 0', '"bytes": 1'));
  const bad = cw(["report", "bundle", goodOut.runId, "--output", path.join(work, "bad.cwrun.json")], { cwd: repo, env });
  assert.equal(bad.status, 1, "report bundle refuses a run whose receipt was changed");
  const badVerify = cw(["report", "verify-bundle", path.join(work, "bad.cwrun.json"), "--json"], { cwd: work, env });
  assert.equal(badVerify.status, 1);
  assert.ok(JSON.parse(badVerify.stdout).failedChecks.some((c) => c.code === `receipt-tampered:${passed.id}`), badVerify.stdout);
  fs.writeFileSync(pinned, kept);
}

// 6. Refusals: failed, missing, stale, tampered — each with a plain reason and one next step.
function refused(evidence, reason, next) {
  const r = drive(evidence);
  const out = json(r);
  assert.notEqual(out.status, "complete", `${evidence} must not complete`);
  const state = runStateText(out);
  assert.match(state, reason, `${evidence}: reason recorded`);
  assert.match(state, next, `${evidence}: next step recorded`);
  return out;
}
refused(`receipt:${failed.id}`, /shows the check failed \(exit 1/, /Next: cw check -- .+ fail\.mjs/);
refused("receipt:rc-0000000000000000", /receipt rc-0000000000000000 was not found in .cw\/receipts/, /Next: cw check list/);

fs.writeFileSync(path.join(repo, "pass.mjs"), 'console.log("2 tests passed");\n');
git("commit", "-qam", "change the code");
refused(`receipt:${passed.id}`, /the code changed since receipt/, /Next: cw check -- .+ pass\.mjs/);
const stale = json(run(["check", "show", passed.id]));
assert.equal(stale.code, "receipt-stale");

// An agent (or anyone) edits a failed receipt to say exit 0: caught.
const lie = json(run(["check", "--", process.execPath, "fail.mjs"]));
const file = path.join(repo, ".cw", "receipts", `${lie.id}.json`);
const forged = JSON.parse(fs.readFileSync(file, "utf8"));
forged.exitCode = 0;
fs.writeFileSync(file, JSON.stringify(forged));
assert.equal(json(run(["check", "show", lie.id])).code, "receipt-tampered");
refused(`receipt:${lie.id}`, /does not match its own digest/, /Next: cw check list/);

console.log("check-receipt-loop-smoke: ok");
