#!/usr/bin/env node
"use strict";

// cw doctor — read-only host checks. Fixed check order (node, agent,
// sandbox-enforceability, git, home-registry, repo-state — agent-binary only
// fires for a command agent), fixed glyphs and summary strings, --json shape,
// fail-closed exit code, and the read-only invariant (it never creates
// $CW_HOME or <cwd>/.cw). sandbox-enforceability is always "ok" (a fixed
// architectural fact, not a per-host problem) so it never contaminates the
// warning count or blocks the "ready — all checks passed" summary.

const fs = require("node:fs");
const path = require("node:path");
const { run, freshDir, readJson, caseMain, assert } = require("../lib");

// A PATH with only node on it (no git, no claude) forces deterministic
// agent=warn + git=warn checks, so the whole report is stable.
function nodeOnlyPath() {
  return path.dirname(process.execPath);
}

caseMain(() => {
  const cwd = freshDir("cwd");

  // --- human text, warn path (no agent, no git) ---
  const human = run(["doctor"], { cwd, env: { PATH: nodeOnlyPath() } });
  assert.equal(human.status, 0, "warnings alone must not fail the exit code");
  assert.equal(human.stderr, "");
  assert.match(human.stdout, /^cw doctor\n/);
  assert.match(human.stdout, /  ✓ node: Node v\d+\.\d+\.\d+ \(>= 18\)\.\n/);
  assert.match(
    human.stdout,
    /  ! agent: No agent backend configured — `demo` and `--preview` work, but a real run reports status: blocked\.\n/
  );
  assert.match(
    human.stdout,
    /      fix: Pass --agent-command "claude -p", set \$CW_AGENT_COMMAND, or use --agent-command builtin:claude\.\n/
  );
  assert.match(human.stdout, /  ! git: git is not available/);
  assert.match(human.stdout, /  ✓ home-registry: Home registry location is writable \(.*\)\.\n/);
  assert.match(human.stdout, /  ✓ repo-state: Run state location is writable \(.*\)\.\n/);
  assert.match(human.stdout, /\n✓ ready, with 2 warnings\n$/);

  // --- --json, same warn scenario ---
  const json = run(["doctor", "--json"], { cwd, env: { PATH: nodeOnlyPath() } });
  assert.equal(json.status, 0);
  assert.equal(json.stderr, "");
  const report = JSON.parse(json.stdout);
  assert.equal(report.schemaVersion, 1);
  assert.equal(report.ok, true);
  assert.equal(report.summary, "ready, with 2 warnings");
  assert.deepEqual(
    report.checks.map((c) => c.name),
    ["node", "agent", "sandbox-enforceability", "git", "home-registry", "repo-state", "run-state-integrity", "audit-integrity"]
  );
  const byName = Object.fromEntries(report.checks.map((c) => [c.name, c]));
  assert.equal(byName.node.status, "ok");
  assert.equal(byName.agent.status, "warn");
  assert.ok(byName.agent.fix, "a non-ok check must carry a fix line");
  assert.equal(byName["sandbox-enforceability"].status, "ok", "sandbox-enforceability is a fixed fact, always ok, never warn");
  assert.equal(byName["sandbox-enforceability"].fix, undefined, "an ok check must not carry a fix line");
  assert.equal(byName.git.status, "warn");
  // A fresh cwd has no runs at all -- both new integrity checks are "ok"
  // ("nothing to check yet"), never contributing a warning of their own.
  assert.equal(byName["run-state-integrity"].status, "ok", "no runs yet: run-state-integrity is ok, not a warning");
  assert.equal(byName["audit-integrity"].status, "ok", "no runs yet: audit-integrity is ok, not a warning");
  assert.equal(byName.node.fix, undefined, "an ok check must not carry a fix line");
  assert.equal(report.onramp, undefined, "no --onramp means no onramp block");

  // --json never carries ANSI, even when FORCE_COLOR asks for color.
  const jsonForced = run(["doctor", "--json"], { cwd, env: { PATH: nodeOnlyPath(), FORCE_COLOR: "1" } });
  assert.equal(jsonForced.stdout, json.stdout, "machine payload is never styled");

  // --- all-ok scenario (only on a host where every check is clean — git,
  // an agent backend, and a writable home registry all present; CI hosts
  // commonly lack an agent backend, so this only fires on some dev boxes) ---
  const ok = run(["doctor", "--json"], { cwd });
  const okReport = JSON.parse(ok.stdout);
  if (okReport.checks.every((c) => c.status === "ok")) {
    assert.equal(okReport.summary, "ready — all checks passed");
  }

  // --- fail-closed: home-registry parent is a FILE, not a dir ---
  const blockerDir = freshDir("blocker-parent");
  const blockerFile = path.join(blockerDir, "blocker");
  fs.writeFileSync(blockerFile, "not a directory\n");
  const badHome = path.join(blockerFile, "cw-home");
  const failing = run(["doctor", "--json"], { cwd, env: { PATH: nodeOnlyPath(), CW_HOME: badHome } });
  assert.equal(failing.status, 1, "any fail check must exit 1");
  const failReport = JSON.parse(failing.stdout);
  assert.equal(failReport.ok, false);
  assert.equal(failReport.summary, "1 blocking problem found");
  const homeCheck = failReport.checks.find((c) => c.name === "home-registry");
  assert.equal(homeCheck.status, "fail");
  assert.ok(homeCheck.fix);
  // Read-only: doctor must never create the directory it only probed.
  assert.ok(!fs.existsSync(badHome), "doctor must not create $CW_HOME");
  assert.ok(fs.existsSync(blockerFile), "doctor must not touch the blocking file either");

  // --- doctor never writes anything under the checked repo cwd ---
  const beforeEntries = fs.readdirSync(cwd);
  run(["doctor", "--json"], { cwd, env: { PATH: nodeOnlyPath() } });
  const afterEntries = fs.readdirSync(cwd);
  assert.deepEqual(afterEntries, beforeEntries, "doctor is read-only over the repo cwd too");
});
