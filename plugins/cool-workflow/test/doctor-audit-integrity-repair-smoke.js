#!/usr/bin/env node
"use strict";

// doctor-audit-integrity-repair-smoke (robustness) —
//   1. `cw doctor`'s two new checks: run-state-integrity (every run under
//      .cw/runs must have a loadable state.json — not corrupt, not an
//      unsupported schema, not suspected data loss) and audit-integrity
//      (a run's trust-audit log must verify clean). Both are READ-ONLY:
//      doctor only dry-run loads/verifies, never repairs anything itself.
//   2. `cw audit repair <run> [--write]` — the fix doctor's audit-integrity
//      check recommends: repairs a torn trailing write in the audit event
//      log, dry-run by default, fails closed (outcome:"refused") when the
//      corruption isn't confined to exactly the trailing line. CLI/MCP
//      parity for the new cw_audit_repair tool.

const assert = require("node:assert/strict");
const { execFileSync, spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const pluginRoot = path.resolve(__dirname, "..");
const node = process.execPath;
const cli = path.join(pluginRoot, "dist", "cli.js");
const mcpServer = path.join(pluginRoot, "dist", "mcp-server.js");
const { runDoctor } = require(path.join(pluginRoot, "dist", "shell", "doctor.js"));
const { createRunPaths, ensureRunDirs, saveCheckpoint } = require(path.join(pluginRoot, "dist", "shell", "run-store.js"));
const { recordTrustAuditEvent, verifyTrustAudit, repairTrustAuditTornTail, trustAuditHead } = require(path.join(pluginRoot, "dist", "shell", "trust-audit.js"));

function freshCwd() {
  return fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "cw-doctor-audit-")));
}

function makeRun(cwd, runId) {
  const runDir = path.join(cwd, ".cw", "runs", runId);
  const paths = createRunPaths(runDir);
  ensureRunDirs(paths);
  const run = {
    schemaVersion: 1,
    id: runId,
    createdAt: new Date(0).toISOString(),
    updatedAt: new Date(0).toISOString(),
    cwd,
    workflow: { id: runId, title: "Demo", summary: "", limits: { maxAgents: 2, maxConcurrentAgents: 1 } },
    inputs: {},
    loopStage: "interpret",
    phases: [],
    tasks: [],
    dispatches: [],
    commits: [],
    paths,
    nodes: [],
    contracts: [],
    feedback: [],
    workers: [],
    sandboxProfiles: [],
    candidates: [],
    candidateSelections: []
  };
  saveCheckpoint(run);
  return run;
}

function doctorEnv() {
  return { ...process.env, CW_NO_AUTO_AGENT: "1" };
}

// ---- 1. no runs at all => both new checks ok, "no runs" wording -----------
{
  const cwd = freshCwd();
  const report = runDoctor({}, doctorEnv(), cwd);
  const stateCheck = report.checks.find((c) => c.name === "run-state-integrity");
  const auditCheck = report.checks.find((c) => c.name === "audit-integrity");
  assert.equal(stateCheck.status, "ok", "no runs => run-state-integrity ok");
  assert.match(stateCheck.detail, /No runs/, "no runs => wording says so");
  assert.equal(auditCheck.status, "ok", "no runs => audit-integrity ok");
}

// ---- 2. a healthy run with real audit events => both checks ok -----------
{
  const cwd = freshCwd();
  const run = makeRun(cwd, "healthy-run");
  recordTrustAuditEvent(run, { kind: "sandbox.path", decision: "allowed", source: "cw-validated", workerId: "w1" });
  const report = runDoctor({}, doctorEnv(), cwd);
  assert.equal(report.checks.find((c) => c.name === "run-state-integrity").status, "ok", "healthy run => run-state-integrity ok");
  assert.equal(report.checks.find((c) => c.name === "audit-integrity").status, "ok", "healthy run with a clean audit log => audit-integrity ok");
  assert.equal(report.ok, true, "no blocking problems overall");
}

// ---- 3. an unsupported (future) schemaVersion run => run-state-integrity warn --
{
  const cwd = freshCwd();
  const run = makeRun(cwd, "future-schema-run");
  const statePath = run.paths.state;
  const raw = JSON.parse(fs.readFileSync(statePath, "utf8"));
  raw.schemaVersion = 99;
  fs.writeFileSync(statePath, JSON.stringify(raw));
  const report = runDoctor({}, doctorEnv(), cwd);
  const check = report.checks.find((c) => c.name === "run-state-integrity");
  assert.equal(check.status, "warn", "unsupported schema run => run-state-integrity warns");
  assert.match(check.detail, /future-schema-run/, "the specific run id is named");
  assert.match(check.fix, /cw status/, "the fix hint points at cw status for details");
}

// ---- 4. suspected-data-loss run => run-state-integrity warn ---------------
{
  const cwd = freshCwd();
  const run = makeRun(cwd, "wiped-run");
  fs.writeFileSync(path.join(run.paths.tasksDir, "task-0001.json"), JSON.stringify({ id: "task-0001" }));
  fs.writeFileSync(run.paths.state, JSON.stringify({}));
  const report = runDoctor({}, doctorEnv(), cwd);
  const check = report.checks.find((c) => c.name === "run-state-integrity");
  assert.equal(check.status, "warn", "a wiped state.json with real content => run-state-integrity warns");
  assert.match(check.detail, /wiped-run/, "the specific run id is named");
}

// ---- 5. a torn audit tail (state.json fine) => audit-integrity warn -------
{
  const cwd = freshCwd();
  const run = makeRun(cwd, "torn-audit-run");
  recordTrustAuditEvent(run, { kind: "sandbox.path", decision: "allowed", source: "cw-validated", workerId: "w1" });
  recordTrustAuditEvent(run, { kind: "commit.gate", decision: "recorded", source: "cw-validated" });
  const logPath = path.join(run.paths.auditDir, "events.jsonl");
  const content = fs.readFileSync(logPath, "utf8");
  fs.writeFileSync(logPath, content.slice(0, content.length - 30)); // torn trailing write

  const before = fs.readFileSync(logPath, "utf8");
  const report = runDoctor({}, doctorEnv(), cwd);
  const stateCheck = report.checks.find((c) => c.name === "run-state-integrity");
  const auditCheck = report.checks.find((c) => c.name === "audit-integrity");
  assert.equal(stateCheck.status, "ok", "state.json itself is fine, only the audit log is torn");
  assert.equal(auditCheck.status, "warn", "a torn audit tail => audit-integrity warns");
  assert.match(auditCheck.detail, /torn-audit-run/, "the specific run id is named");
  assert.match(auditCheck.fix, /cw audit repair/, "the fix hint recommends cw audit repair");
  // READ-ONLY: doctor must not have touched the log itself.
  assert.equal(fs.readFileSync(logPath, "utf8"), before, "doctor must never repair anything itself (read-only)");
}

// ---- 6. cw audit repair end to end: dry-run, then --write, then verify ----
{
  const cwd = freshCwd();
  const run = makeRun(cwd, "repair-me-run");
  recordTrustAuditEvent(run, { kind: "sandbox.path", decision: "allowed", source: "cw-validated", workerId: "w1" });
  recordTrustAuditEvent(run, { kind: "commit.gate", decision: "recorded", source: "cw-validated" });
  const logPath = path.join(run.paths.auditDir, "events.jsonl");
  const content = fs.readFileSync(logPath, "utf8");
  const beforeRepair = content.slice(0, content.length - 25);
  fs.writeFileSync(logPath, beforeRepair);

  const dry = JSON.parse(execFileSync(node, [cli, "audit", "repair", "repair-me-run", "--json"], { cwd, encoding: "utf8" }));
  assert.equal(dry.outcome, "repaired", "dry-run reports repairable");
  assert.equal(dry.write, false, "dry-run defaults write:false");
  assert.equal(fs.readFileSync(logPath, "utf8"), beforeRepair, "dry-run must not touch the file");

  const write = JSON.parse(execFileSync(node, [cli, "audit", "repair", "repair-me-run", "--write", "--json"], { cwd, encoding: "utf8" }));
  assert.equal(write.outcome, "repaired", "--write actually repairs");
  assert.equal(write.write, true);

  const verify = JSON.parse(execFileSync(node, [cli, "audit", "verify", "repair-me-run", "--json"], { cwd, encoding: "utf8" }));
  assert.equal(verify.verified, true, "the repaired log now verifies clean");
  assert.equal(verify.eventCount, 1, "one intact event survived, the torn one was removed");
}

// ---- 7. cw audit repair refuses tampering, not just a crash artifact ------
{
  const cwd = freshCwd();
  const run = makeRun(cwd, "tampered-run");
  recordTrustAuditEvent(run, { kind: "sandbox.path", decision: "allowed", source: "cw-validated", workerId: "w1" });
  recordTrustAuditEvent(run, { kind: "commit.gate", decision: "recorded", source: "cw-validated" });
  const logPath = path.join(run.paths.auditDir, "events.jsonl");
  const lines = fs.readFileSync(logPath, "utf8").split("\n").filter(Boolean);
  const ev = JSON.parse(lines[0]);
  ev.decision = "TAMPERED";
  lines[0] = JSON.stringify(ev);
  lines.push("{ torn trailing garbage no closing");
  const beforeRefuse = `${lines.join("\n")}\n`.slice(0, -1); // keep it torn (no final newline)
  fs.writeFileSync(logPath, beforeRefuse);

  const result = spawnSync(node, [cli, "audit", "repair", "tampered-run", "--write", "--json"], { cwd, encoding: "utf8" });
  assert.equal(result.status, 1, "a refused repair must exit 1 (needs a human)");
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.outcome, "refused", "tampering must be refused, not silently repaired");
  assert.equal(fs.readFileSync(logPath, "utf8"), beforeRefuse, "a refused repair must never touch the file, even with --write");
}

// ---- 8. CLI <-> MCP parity for cw_audit_repair -----------------------------
{
  const cwd = freshCwd();
  const run = makeRun(cwd, "parity-run");
  recordTrustAuditEvent(run, { kind: "sandbox.path", decision: "allowed", source: "cw-validated", workerId: "w1" });
  const logPath = path.join(run.paths.auditDir, "events.jsonl");
  const content = fs.readFileSync(logPath, "utf8");
  fs.writeFileSync(logPath, content.slice(0, content.length - 20));

  function mcpCall(tool, mcpArgs) {
    const out = execFileSync(node, [mcpServer], {
      cwd,
      input: `${JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: tool, arguments: mcpArgs } })}\n`,
      encoding: "utf8"
    });
    const line = out.trim().split("\n").find((entry) => entry.includes('"result"'));
    const result = JSON.parse(line).result;
    assert.ok(!result.isError, `${tool} must not error: ${JSON.stringify(result)}`);
    return JSON.parse(result.content[0].text);
  }

  const cliResult = JSON.parse(execFileSync(node, [cli, "audit", "repair", "parity-run", "--json"], { cwd, encoding: "utf8" }));
  const mcpResult = mcpCall("cw_audit_repair", { runId: "parity-run", cwd });
  assert.deepEqual(cliResult, mcpResult, "cw audit repair --json === cw_audit_repair");
}

// ---- 9. regression: a torn write survives a RESUME (another event appended
// right after the torn remnant, merging into one bad line) must still be
// detected, not waved through as "clean" just because the file ends in a
// newline again. (adversarial review finding) ----
{
  const cwd = freshCwd();
  const run = makeRun(cwd, "resumed-after-tear-run");
  recordTrustAuditEvent(run, { kind: "sandbox.path", decision: "allowed", source: "cw-validated", workerId: "w1" });
  recordTrustAuditEvent(run, { kind: "commit.gate", decision: "recorded", source: "cw-validated" });
  const logPath = path.join(run.paths.auditDir, "events.jsonl");
  const content = fs.readFileSync(logPath, "utf8");
  fs.writeFileSync(logPath, content.slice(0, content.length - 25)); // torn, no trailing newline

  // Simulate a resume: another event gets appended right after the torn
  // remnant (durableAppendFileSync never inserts a leading newline of its
  // own), merging into one unparseable line -- the file now DOES end in a
  // newline again, even though it is still genuinely corrupt.
  recordTrustAuditEvent(run, { kind: "sandbox.path", decision: "denied", source: "cw-validated", workerId: "w2" });

  const integrity = verifyTrustAudit(run);
  assert.equal(integrity.verified, false, "the merged post-resume line must still fail verification");

  const dry = repairTrustAuditTornTail(run, { write: false });
  assert.notEqual(dry.outcome, "clean", "a torn-then-resumed log must NOT be reported clean just because the file ends in a newline again");
  assert.equal(dry.outcome, "repaired", "the merged bad line is still exactly the trailing entry, so it is still repairable");

  repairTrustAuditTornTail(run, { write: true });
  const after = verifyTrustAudit(run);
  assert.equal(after.verified, true, "after repair, the surviving 1 pre-tear event must verify clean");
  assert.equal(after.eventCount, 1, "the resumed (merged, unrecoverable) event is gone; only the pre-tear event survives");
}

// ---- 10. regression: deleted history behind a torn-looking fragment must
// be refused when an anchor is given -- an empty/short chain otherwise
// "verifies" trivially, and this tool must never launder that shape into
// a confidently-"repaired" empty log. (adversarial review finding) ----
{
  const cwd = freshCwd();
  const run = makeRun(cwd, "deleted-history-run");
  for (let i = 0; i < 5; i++) {
    recordTrustAuditEvent(run, { kind: "sandbox.path", decision: "allowed", source: "cw-validated", workerId: `w${i}` });
  }
  const anchor = trustAuditHead(run); // captured BEFORE the "attack" -- exactly how a real anchor would be captured
  assert.equal(anchor.eventCount, 5);

  const logPath = path.join(run.paths.auditDir, "events.jsonl");
  const lines = fs.readFileSync(logPath, "utf8").split("\n").filter(Boolean);
  fs.writeFileSync(logPath, lines[lines.length - 1].slice(0, -15)); // drop events 1-4 entirely; tear event 5's tail

  const withoutAnchor = execFileSync(node, [cli, "audit", "repair", "deleted-history-run", "--json"], { cwd, encoding: "utf8" });
  assert.equal(JSON.parse(withoutAnchor).outcome, "repaired", "without an anchor this is the same documented blind spot verifyTrustAudit itself has (nothing NEW to catch it) -- not this cycle's regression to fix alone");

  const withAnchor = spawnSync(
    node,
    [cli, "audit", "repair", "deleted-history-run", "--write", "--expect-head", anchor.headHash, "--expect-count", String(anchor.eventCount), "--json"],
    { cwd, encoding: "utf8" }
  );
  assert.equal(withAnchor.status, 1, "a refused anchor-backed repair must exit 1");
  const parsedWithAnchor = JSON.parse(withAnchor.stdout);
  assert.equal(parsedWithAnchor.outcome, "refused", "an anchor that expected 5 events must refuse a repair that would leave 0");

  const untouchedContent = fs.readFileSync(logPath, "utf8");
  assert.equal(untouchedContent, lines[lines.length - 1].slice(0, -15), "a refused repair, even with --write, must never touch the file");
}

process.stdout.write("doctor-audit-integrity-repair-smoke: ok\n");
