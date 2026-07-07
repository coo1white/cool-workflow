#!/usr/bin/env node
"use strict";

// require-attested-telemetry manual-accept gap (closes a fail-open hole).
//
// The require-attested-telemetry gate (worker-isolation.ts) blocks a
// delegated hop whose telemetry is not `attested`. But it only fired when
// options.agentDelegation was present -- a MANUAL accept (`cw worker output`
// / `cw result`) passes no delegation at all, so `telemetry` was `undefined`
// and the old `telemetry && telemetry.status !== "attested"` condition
// short-circuited false: an unattested result could be laundered through
// the manual accept path even with the operator's require flag on.
//
// This case drives that exact black-box path: `cw plan` + `cw dispatch`
// (creates a real worker scope with NO agent-delegation metadata), then a
// bare `cw worker output` under CW_REQUIRE_ATTESTED_TELEMETRY=1.
//   - with no override: BLOCKED, exit 1, distinct code telemetry-missing-blocked;
//   - with --allow-unattested: ACCEPTED, and a telemetry.gate-override
//     trust-audit event is recorded (never silent);
//   - with the require flag OFF (default): the bare accept is unaffected (POLA).

const { run, gitRepo, caseMain, assert } = require("../lib");

function dispatchOneWorker(repo) {
  const plan = run(["plan", "architecture-review", "--question", "prove it", "--repo", repo, "--json"], { cwd: repo });
  assert.equal(plan.status, 0);
  const runId = JSON.parse(plan.stdout).runId;
  const dispatch = run(["dispatch", runId, "--json"], { cwd: repo });
  assert.equal(dispatch.status, 0);
  const task = JSON.parse(dispatch.stdout).tasks[0];
  return { runId, workerId: task.workerId, resultPath: task.workerResultPath };
}

function writeResult(resultPath) {
  const fence = String.fromCharCode(96).repeat(3);
  const body = `Stub finding.\n\n${fence}cw:result\n${JSON.stringify({ summary: "s", findings: [], evidence: ["a.txt:1"] })}\n${fence}\n`;
  require("node:fs").writeFileSync(resultPath, body, "utf8");
}

caseMain(() => {
  const repo = gitRepo({ "a.txt": "hello\n" });
  const requireEnv = { CW_REQUIRE_ATTESTED_TELEMETRY: "1" };

  // --- 1. blocked without an override ---
  {
    const { runId, workerId, resultPath } = dispatchOneWorker(repo);
    writeResult(resultPath);
    const blocked = run(["worker", "output", runId, workerId, resultPath, "--json"], { cwd: repo, env: requireEnv });
    assert.equal(blocked.status, 1, "a manual accept with no delegation metadata is blocked under require-attested-telemetry");
    assert.match(blocked.stderr, /no agent-delegation telemetry at all/i);

    // the run's audit trail must NOT show a completed accept for this worker.
    const audit = run(["audit", "worker", runId, workerId, "--json"], { cwd: repo });
    assert.equal(audit.status, 0);
    const events = JSON.parse(audit.stdout).events || JSON.parse(audit.stdout);
    assert.ok(!events.some((e) => e.kind === "telemetry.gate-override"), "no override event without the flag");
  }

  // --- 2. accepted with --allow-unattested, and the override is audited ---
  {
    const { runId, workerId, resultPath } = dispatchOneWorker(repo);
    writeResult(resultPath);
    const accepted = run(["worker", "output", runId, workerId, resultPath, "--allow-unattested", "--json"], { cwd: repo, env: requireEnv });
    assert.equal(accepted.status, 0, "an --allow-unattested manual accept is NOT blocked");

    const audit = run(["audit", "worker", runId, workerId, "--json"], { cwd: repo });
    assert.equal(audit.status, 0);
    const events = JSON.parse(audit.stdout).events || JSON.parse(audit.stdout);
    const overrides = events.filter((e) => e.kind === "telemetry.gate-override");
    assert.equal(overrides.length, 1, "the override is recorded, not silent");
    assert.equal(overrides[0].decision, "allowed");
    assert.equal(overrides[0].workerId, workerId);

    const verify = run(["audit", "verify", runId, "--json"], { cwd: repo });
    assert.equal(verify.status, 0);
    assert.equal(JSON.parse(verify.stdout).verified, true, "the override event chains cleanly into the trust-audit log");
  }

  // --- 3. POLA: require flag OFF (default), the same bare accept is unaffected ---
  {
    const { runId, workerId, resultPath } = dispatchOneWorker(repo);
    writeResult(resultPath);
    const defaultAccept = run(["worker", "output", runId, workerId, resultPath, "--json"], { cwd: repo });
    assert.equal(defaultAccept.status, 0, "default (require flag off) manual accept is unaffected");
  }
});
