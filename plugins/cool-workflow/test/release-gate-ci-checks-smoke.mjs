#!/usr/bin/env node
// release-gate-ci-checks-smoke — the gate's test step taken from GitHub's
// required CI checks on the exact commit, in place of a local test:gate run
// (project/docs/intent/2026-10-16-release-gate-ci.md).
//
// Each case runs the REAL scripts/release-gate.mjs (and, at the end, the real
// scripts/release-flow.mjs) in a throwaway git fixture whose plugin
// package.json has build: true and a test:gate that writes a SUITE MARKER
// file. A stub `gh` on CW_RELEASE_GATE_GH_CMD answers the check-runs call
// with canned JSON and logs its argv. So a case can prove both what the gate
// decided and whether the local suite was spawned at all.
//
// Fails before the change: release-gate.mjs has no --tests-from-ci (the suite
// always runs, the marker is always written, gh is never asked), and
// release-flow.mjs runs the suite by default and has no gateTests key.
// Portable: node + git only, isolated tmpdir, no network.

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const pluginRoot = path.resolve(import.meta.dirname, "..");
const GATE = path.join(pluginRoot, "scripts", "release-gate.mjs");
const FLOW = path.join(pluginRoot, "scripts", "release-flow.mjs");
const REVIEWER = path.join(pluginRoot, "test", "fixtures", "release-rehearsal-reviewer.mjs");
import { REQUIRED_CHECKS, evaluateCheckRuns } from "../scripts/release-ci-checks.mjs";

assert.deepEqual([...REQUIRED_CHECKS], ["check (22)", "check (24)"], "the required list names the two ubuntu legs main's branch protection requires");

let caseId = 0;
function git(dir, args) {
  const r = spawnSync("git", args, { cwd: dir, encoding: "utf8" });
  if (r.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${r.stderr || r.stdout}`);
  return r.stdout.trim();
}
function write(dir, rel, content) {
  const abs = path.join(dir, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content);
}

// A fixture repo with a previous tag and one good release commit after it,
// an origin on github.com (never contacted: gh is stubbed), and a stub gh.
function fixture({ origin = "https://github.com/acme/widget.git" } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `cw-gate-ci-${caseId++}-`));
  git(dir, ["init", "-q", "-b", "work"]);
  git(dir, ["config", "user.email", "t@t"]);
  git(dir, ["config", "user.name", "t"]);
  git(dir, ["config", "commit.gpgsign", "false"]);
  git(dir, ["config", "tag.gpgsign", "false"]);
  git(dir, ["remote", "add", "origin", origin]);
  write(dir, "plugins/cool-workflow/package.json", JSON.stringify({
    name: "fixture",
    version: "0.0.0",
    scripts: {
      build: "true",
      test: "true",
      "test:gate": "node -e \"require('fs').writeFileSync(process.env.SUITE_MARKER, 'ran')\""
    }
  }));
  write(dir, "README.md", "init\n");
  write(dir, ".gitignore", ".cw-release/gate-*.ok\n.cw-release/gate-ci-*.json\n.cw-release/review-input-*.md\n.stub/\n.cw-home/\n");
  git(dir, ["add", "-A"]);
  git(dir, ["commit", "-q", "-m", "init"]);
  git(dir, ["tag", "v0.0.1"]);
  write(dir, "plugins/cool-workflow/src/feature.ts", "export const x = 1;\n");
  write(dir, "plugins/cool-workflow/test/feature-smoke.mjs", "// asserts feature\n");
  git(dir, ["add", "-A"]);
  git(dir, ["commit", "-q", "-m", "real work"]);
  const sha = git(dir, ["rev-parse", "HEAD"]);

  const stubDir = path.join(dir, ".stub");
  fs.mkdirSync(stubDir, { recursive: true });
  const gh = path.join(stubDir, "gh");
  fs.writeFileSync(gh, `#!/usr/bin/env node
"use strict";
const fs = require("node:fs");
fs.appendFileSync(process.env.GH_STUB_LOG, process.argv.slice(2).join(" ") + "\\n");
const mode = process.env.GH_STUB_MODE;
const sha = process.env.GH_STUB_SHA;
const run = (name, status, conclusion, extra) => Object.assign({
  name, status, conclusion, head_sha: sha,
  html_url: "https://github.com/acme/widget/actions/runs/1/job/" + name.replace(/\\D/g, ""),
  app: { slug: "github-actions" }
}, extra || {});
let runs;
if (mode === "green") runs = [run("check (22)", "completed", "success"), run("check (24)", "completed", "success"), run("release-rehearsal", "completed", "failure")];
else if (mode === "red") runs = [run("check (22)", "completed", "failure"), run("check (24)", "completed", "success")];
else if (mode === "cancelled") runs = [run("check (22)", "completed", "success"), run("check (24)", "completed", "cancelled")];
else if (mode === "missing") runs = [run("check (22)", "completed", "success"), run("release-rehearsal", "completed", "success")];
else if (mode === "pending") runs = [run("check (22)", "completed", "success"), run("check (24)", "in_progress", null)];
else if (mode === "otherapp") runs = [run("check (22)", "completed", "success"), run("check (24)", "completed", "success", { app: { slug: "someone-else" } })];
else if (mode === "othersha") runs = [run("check (22)", "completed", "success"), run("check (24)", "completed", "success", { head_sha: "0".repeat(40) })];
else if (mode === "rerun") runs = [run("check (22)", "completed", "success"), run("check (24)", "completed", "success"), run("check (24)", "completed", "failure")];
else if (mode === "garbage") { process.stdout.write("not json"); process.exit(0); }
else if (mode === "error") { process.stderr.write("HTTP 401: Bad credentials\\n"); process.exit(1); }
else { process.stderr.write("unknown stub mode\\n"); process.exit(2); }
process.stdout.write(JSON.stringify({ total_count: runs.length, check_runs: runs }));
`);
  fs.chmodSync(gh, 0o755);
  return { dir, sha, gh, log: path.join(stubDir, "gh.log"), marker: path.join(stubDir, "suite-ran") };
}

function env(fx, mode, extra) {
  const e = {
    ...process.env,
    CW_RELEASE_GATE_GH_CMD: fx.gh,
    GH_STUB_MODE: mode,
    GH_STUB_SHA: fx.sha,
    GH_STUB_LOG: fx.log,
    SUITE_MARKER: fx.marker,
    CW_NO_AUTO_AGENT: "1",
    CW_HOME: path.join(fx.dir, ".cw-home"),
    XDG_STATE_HOME: path.join(fx.dir, ".cw-home")
  };
  for (const k of ["CW_RELEASE_LOCAL_TESTS", "CW_RELEASE_FLOW_GATE_CMD", "CW_RELEASE_VERDICT_PRIVKEY", "CW_AGENT_COMMAND", "CW_AGENT_ENDPOINT", "GITHUB_HEAD_REF", "GITHUB_REF_NAME"]) delete e[k];
  return Object.assign(e, extra || {});
}
function runGate(fx, mode, args = ["--tests-from-ci"], extra) {
  const r = spawnSync(process.execPath, [GATE, ...args], { cwd: fx.dir, encoding: "utf8", env: env(fx, mode, extra) });
  return { code: r.status, out: r.stdout || "", err: r.stderr || "" };
}
const ghCalls = (fx) => (fs.existsSync(fx.log) ? fs.readFileSync(fx.log, "utf8").trim().split("\n").filter(Boolean) : []);
const okMarker = (fx) => path.join(fx.dir, ".cw-release", `gate-${fx.sha}.ok`);
const evidence = (fx) => path.join(fx.dir, ".cw-release", `gate-ci-${fx.sha}.json`);

// ---- 1. every required check green -> PASS, suite NOT spawned --------------
{
  const fx = fixture();
  const r = runGate(fx, "green");
  assert.equal(r.code, 0, `green required checks must pass the gate:\n${r.out}\n${r.err}`);
  assert.ok(!fs.existsSync(fx.marker), "CI mode must NOT spawn the local test:gate suite");
  assert.ok(fs.existsSync(okMarker(fx)), "a pass writes gate-<sha>.ok");
  assert.deepEqual(ghCalls(fx), [`api repos/acme/widget/commits/${fx.sha}/check-runs?per_page=100`], "the gate asks GitHub once, for the exact HEAD sha of origin's owner/repo");
  const ev = JSON.parse(fs.readFileSync(evidence(fx), "utf8"));
  assert.equal(ev.mode, "ci");
  assert.equal(ev.sha, fx.sha);
  assert.deepEqual(ev.checks.map((c) => [c.name, c.status, c.conclusion]), [["check (22)", "completed", "success"], ["check (24)", "completed", "success"]],
    "the evidence names exactly the required checks (a red non-required release-rehearsal does not count either way)");
  assert.match(r.out, /\[2\/5\] tests — from the required CI checks/);
  assert.match(r.out, /check \(24\): completed \/ success https:\/\/github\.com\/acme\/widget\/actions\/runs\/1\/job\/24/);
  assert.match(r.out, /\[5\/5\] branch naming/, "the cheap local steps still run");
}

// ---- 2. every way of not being green fails closed, suite NOT spawned -------
for (const [mode, why] of [
  ["red", /check \(22\): completed with conclusion failure/],
  ["cancelled", /check \(24\): completed with conclusion cancelled/],
  ["missing", /check \(24\): no check run from github-actions/],
  ["pending", /check \(24\): in_progress \(not completed yet\)/],
  ["otherapp", /check \(24\): no check run from github-actions/],
  ["othersha", /check \(24\): no check run from github-actions/],
  ["rerun", /check \(24\): completed with conclusion failure/],
  ["garbage", /reply is not JSON/],
  ["error", /exited 1: HTTP 401: Bad credentials/]
]) {
  const fx = fixture();
  const r = runGate(fx, mode);
  assert.equal(r.code, 1, `${mode}: must REJECT:\n${r.out}`);
  assert.match(r.out, /GATE FAIL: required CI checks are not green/, `${mode}: names the failed step`);
  assert.match(r.out, why, `${mode}: names the precise reason`);
  assert.match(r.out, /RELEASE GATE: REJECTED/);
  assert.match(r.err, /release-gate: fix: .*--local-tests/, `${mode}: gives the fix, including the opt-in`);
  assert.ok(!fs.existsSync(fx.marker), `${mode}: never falls back to the local suite`);
  assert.ok(!fs.existsSync(okMarker(fx)), `${mode}: no gate-<sha>.ok`);
  assert.ok(!fs.existsSync(evidence(fx)), `${mode}: no CI evidence file`);
}

// ---- 3. gh missing, and an origin that is not on github.com ---------------
{
  const fx = fixture();
  const r = runGate(fx, "green", ["--tests-from-ci"], { CW_RELEASE_GATE_GH_CMD: path.join(fx.dir, "no-such-gh") });
  assert.equal(r.code, 1, "gh missing must REJECT");
  assert.match(r.out, /gh could not be run/);
  assert.ok(!fs.existsSync(fx.marker) && !fs.existsSync(okMarker(fx)));
}
{
  const fx = fixture({ origin: "https://git.example.invalid/acme/widget.git" });
  const r = runGate(fx, "green");
  assert.equal(r.code, 1, "a non-github origin must REJECT");
  assert.match(r.out, /origin is not a github\.com remote/);
  assert.deepEqual(ghCalls(fx), [], "gh is not asked about a repo it cannot name");
}

// ---- 4. a stale evidence file never stands for a new run -------------------
{
  const fx = fixture();
  assert.equal(runGate(fx, "green").code, 0);
  assert.ok(fs.existsSync(evidence(fx)));
  assert.equal(runGate(fx, "pending").code, 1);
  assert.ok(!fs.existsSync(evidence(fx)), "a failed CI-mode run removes the earlier evidence");
}

// ---- 5. the gate's own default is unchanged: the suite runs, gh is not asked
{
  const fx = fixture();
  const r = runGate(fx, "error", []);
  assert.equal(r.code, 0, `the default gate (release.yml's tag-push gate) runs the suite as before:\n${r.out}`);
  assert.ok(fs.existsSync(fx.marker), "default mode spawns test:gate");
  assert.deepEqual(ghCalls(fx), [], "default mode never asks GitHub");
  assert.match(r.out, /^\[2\/5\] tests$/m, "default step line is byte-identical");
  assert.ok(!fs.existsSync(evidence(fx)));
}

// ---- 6. the pure judge ------------------------------------------------------
{
  const sha = "a".repeat(40);
  assert.equal(evaluateCheckRuns(null, sha).state, "missing");
  assert.equal(evaluateCheckRuns({ check_runs: [] }, sha).state, "missing");
  const g = (name, status, conclusion) => ({ name, status, conclusion, head_sha: sha, app: { slug: "github-actions" } });
  assert.equal(evaluateCheckRuns({ check_runs: [g("check (22)", "completed", "success"), g("check (24)", "queued", null)] }, sha).state, "pending");
  assert.equal(evaluateCheckRuns({ check_runs: [g("check (22)", "completed", "skipped"), g("check (24)", "queued", null)] }, sha).state, "failure", "a red check wins over a pending one");
  assert.equal(evaluateCheckRuns({ check_runs: [g("check (22)", "completed", "success"), g("check (24)", "completed", "success")] }, sha).ok, true);
}

// ---- 7. release-flow.mjs: CI mode by default, local suite only on opt-in ----
function runFlow(fx, mode, args, extra) {
  const e = env(fx, mode, { CW_AGENT_COMMAND: `node ${REVIEWER} {{input}}`, ...(extra || {}) });
  const r = spawnSync(process.execPath, [FLOW, ...args], { cwd: fx.dir, encoding: "utf8", env: e });
  return { code: r.status, out: r.stdout || "", err: r.stderr || "" };
}
function lastJson(out) {
  return JSON.parse(out.slice(out.lastIndexOf("\n{") + 1));
}
{
  const fx = fixture();
  const r = runFlow(fx, "green", ["--check"]);
  assert.equal(r.code, 0, `release-flow --check with green CI must pass:\n${r.out}\n${r.err}`);
  assert.ok(!fs.existsSync(fx.marker), "release-flow's default gate does NOT run the local suite");
  assert.equal(ghCalls(fx).length, 1, "release-flow's default gate asks GitHub for the checks");
  assert.equal(lastJson(r.out).gateTests, "ci");
  const input = fs.readFileSync(path.join(fx.dir, ".cw-release", `review-input-${fx.sha}.md`), "utf8");
  assert.match(input, /^- Gate test step: ci — the required CI checks were completed\/success on this exact commit/m, "the reviewer is told which mode the gate used");
  assert.match(input, /^ {2}- check \(22\): success https:\/\/github\.com\/acme\/widget\/actions\/runs\/1\/job\/22$/m, "and the run URL it relied on");
  assert.match(input, /^ {2}- check \(24\): success https:\/\/github\.com\/acme\/widget\/actions\/runs\/1\/job\/24$/m);
  assert.match(input, new RegExp(`gh api repos/\\{owner\\}/\\{repo\\}/commits/${fx.sha}/check-runs`), "the reviewer is shown how to confirm it");
}
{
  const fx = fixture();
  const r = runFlow(fx, "pending", ["--check"]);
  assert.equal(r.code, 1, "release-flow fails closed when CI is not done");
  assert.match(r.err, /deterministic gate FAILED.*--local-tests or CW_RELEASE_LOCAL_TESTS=1/);
  assert.ok(!fs.existsSync(fx.marker), "and never falls back to the local suite");
  assert.ok(!fs.existsSync(path.join(fx.dir, ".cw-release", `review-input-${fx.sha}.md`)), "the reviewer never runs");
}
for (const [label, args, extra] of [["--local-tests", ["--check", "--local-tests"], {}], ["CW_RELEASE_LOCAL_TESTS=1", ["--check"], { CW_RELEASE_LOCAL_TESTS: "1" }]]) {
  const fx = fixture();
  const r = runFlow(fx, "error", args, extra);
  assert.equal(r.code, 0, `${label}: the opt-in runs the local suite and needs no GitHub:\n${r.out}\n${r.err}`);
  assert.ok(fs.existsSync(fx.marker), `${label}: the local test:gate suite ran`);
  assert.deepEqual(ghCalls(fx), [], `${label}: GitHub is not asked`);
  assert.equal(lastJson(r.out).gateTests, "local");
  const input = fs.readFileSync(path.join(fx.dir, ".cw-release", `review-input-${fx.sha}.md`), "utf8");
  assert.match(input, /^- Gate test step: local — the full test:gate suite ran on the release machine/m);
}

process.stdout.write("release-gate-ci-checks-smoke: ok\n");
