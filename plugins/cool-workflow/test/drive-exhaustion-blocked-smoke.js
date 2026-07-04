#!/usr/bin/env node
"use strict";

// drive-exhaustion-blocked-smoke — a non-once drive that cannot make terminal
// progress must fail closed as blocked, never report complete or seal a bundle.
//
// v2 module layout + semantics note (INTENT preserved, mechanism adapted):
//   The flat dist facades are gone: dist/orchestrator.js (CoolWorkflowRunner)
//   and dist/drive.js no longer exist. drive is now a free function
//   drive(runId, cwd, options) in dist/shell/drive.js; plan lives in
//   dist/shell/pipeline.js; apps load via dist/shell/workflow-app-loader.js.
//
//   The OLD smoke forced exhaustion by monkeypatching runner.dispatch to return
//   zero tasks, so the drive loop spun without progress until it hit the
//   max-iteration backstop and emitted a blocked step whose reason matched
//   /max iteration limit/. v2 has NO such injection seam — the runner facade
//   (with its .dispatch hook) was dismantled, and drive calls dispatch
//   internally with no override point. v2 also fails closed EARLIER and more
//   directly: every drive round that finds no runnable progress returns an
//   explicit blocked guard from core/pipeline/drive-decide.ts's
//   terminalOrConfigStep and BREAKS the loop on that round. So the
//   max-iteration guard (src/shell/drive.ts:638-639) with reason
//   /max iteration limit/ is now an unreachable defense-in-depth backstop; that
//   exact reason string is a stale old-internal detail with no v2 equivalent.
//
//   INTENT preserved via the v2 equivalent guard: run a one-worker app with an
//   agent that is NOT configured for delegation. terminalOrConfigStep selects
//   the pending worker but refuses to spawn — returning a blocked guard step
//   ("refusing rather than fabricating a completion"). The worker never parks
//   (parkedWorkers stays 0), so finalDriveStatus reports the RUN as blocked
//   (not parked). This is a non-once drive that reaches an explicit blocked
//   guard without terminal progress, fails closed as blocked, and commits
//   nothing — every original assertion's intent, only the guard reason string
//   moves from /max iteration limit/ to the v2 fail-closed refusal guard.

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const pluginRoot = path.resolve(__dirname, "..");
const { drive } = require(path.join(pluginRoot, "dist/shell/drive.js"));
const { plan } = require(path.join(pluginRoot, "dist/shell/pipeline.js"));
const { loadWorkflowApp } = require(path.join(pluginRoot, "dist/shell/workflow-app-loader.js"));

const work = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "cw-drive-exhaust-")));
fs.writeFileSync(path.join(work, "README.md"), "# target\n", "utf8");

const cwd0 = process.cwd();
// v2 drive resolves the agent config from options.agentConfig OR the ambient
// CW_AGENT_* / --agent-* inputs. Clear the env so "not configured" holds
// regardless of the caller's shell (the harness may export CW_* vars).
const savedEnv = {};
for (const v of ["CW_AGENT_COMMAND", "CW_AGENT_ENDPOINT", "CW_AGENT_MODEL", "CW_BACKEND"]) {
  savedEnv[v] = process.env[v];
  delete process.env[v];
}
try {
  // v2 plan/drive read the run's cwd from process.cwd() (loadRunFromCwd defaults
  // to it), so drive from inside the workspace.
  process.chdir(work);
  const p = plan(loadWorkflowApp("end-to-end-golden-path"), { repo: work, question: "exhaustion guard" });

  // Non-once drive with NO agent configured: the drive selects the pending
  // worker but refuses to spawn, hitting the explicit blocked guard.
  const result = drive(p.id, work, { now: "2026-07-01T00:00:00.000Z" });

  assert.equal(result.status, "blocked", "a drive that cannot make terminal progress reports blocked");
  assert.equal(result.commitId, undefined, "a blocked drive does not commit");
  const last = result.steps[result.steps.length - 1];
  assert.equal(last.status, "blocked", "last step is an explicit blocked guard");
  assert.match(
    last.reason || "",
    /refusing rather than fabricating a completion/,
    "blocked reason names the v2 fail-closed guard (equivalent of the old max-iteration guard)"
  );
} finally {
  process.chdir(cwd0);
  for (const v of Object.keys(savedEnv)) {
    if (savedEnv[v] === undefined) delete process.env[v];
    else process.env[v] = savedEnv[v];
  }
  fs.rmSync(work, { recursive: true, force: true });
}

process.stdout.write("drive-exhaustion-blocked-smoke: ok\n");
