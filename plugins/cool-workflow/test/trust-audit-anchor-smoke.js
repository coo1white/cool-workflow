#!/usr/bin/env node
"use strict";

// trust-audit-anchor-smoke (v0.2.1). Proves, end to end:
//   1. trustAuditHead is a read-only projection: {eventCount, headHash},
//      headHash = the last event's eventHash (genesis when empty);
//   2. verifyTrustAudit with an anchor FAILS CLOSED on a tail-truncated
//      log (code trust-audit-truncated) — the one tamper shape a pure
//      chain walk cannot see — and on a truncate-then-append forgery;
//   3. with no anchor the verify output is unchanged (POLA);
//   4. cw audit head --json === cw_audit_head (CLI <-> MCP parity), and
//      the anchored cw audit verify === cw_audit_verify with
//      expectHead/expectCount.

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync, spawnSync } = require("node:child_process");
const {
  recordTrustAuditEvent,
  verifyTrustAudit,
  trustAuditHead,
  trustAuditGenesis,
} = require("../dist/shell/trust-audit");

const pluginRoot = path.resolve(__dirname, "..");
const node = process.execPath;
const cli = path.join(pluginRoot, "dist", "cli.js");
const mcpServer = path.join(pluginRoot, "dist", "mcp-server.js");

function tmpRun(prefix) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  return { id: "anchor-run", paths: { runDir: dir } };
}

function logPathOf(run) {
  return path.join(run.paths.runDir, "audit", "events.jsonl");
}

function readLines(p) {
  return fs.readFileSync(p, "utf8").split("\n").filter(Boolean);
}

// ---- 1. head projection --------------------------------------------------
(function headProjection() {
  const run = tmpRun("anchor-head-");
  // empty log -> genesis head, zero count.
  let head = trustAuditHead(run);
  assert.equal(head.eventCount, 0, "empty log counts 0");
  assert.equal(head.headHash, trustAuditGenesis(run.id), "empty log head = genesis");

  recordTrustAuditEvent(run, { kind: "sandbox.path", decision: "allowed", source: "cw-validated", workerId: "w1" });
  recordTrustAuditEvent(run, { kind: "commit.gate", decision: "recorded", source: "cw-validated" });
  head = trustAuditHead(run);
  assert.equal(head.eventCount, 2);
  const lines = readLines(logPathOf(run));
  assert.equal(head.headHash, JSON.parse(lines[1]).eventHash, "head = last event's eventHash");
})();

// ---- 2. anchor catches truncation; 3. no anchor -> unchanged ---------------
(function anchorCatchesTruncation() {
  const run = tmpRun("anchor-cut-");
  for (let i = 0; i < 4; i++) {
    recordTrustAuditEvent(run, { kind: "sandbox.path", decision: "allowed", source: "cw-validated", workerId: `w${i}` });
  }
  const anchor = trustAuditHead(run);
  assert.equal(anchor.eventCount, 4);

  // intact log: anchored verify passes.
  let v = verifyTrustAudit(run, { expectHead: anchor.headHash, expectCount: anchor.eventCount });
  assert.equal(v.verified, true, "anchored verify passes on the intact log");

  // cut the last 2 lines off.
  const lines = readLines(logPathOf(run));
  fs.writeFileSync(logPathOf(run), `${lines.slice(0, 2).join("\n")}\n`);

  // POLA: a plain walk still reads green — the documented blind spot.
  v = verifyTrustAudit(run);
  assert.equal(v.verified, true, "a plain chain walk cannot see tail truncation");
  assert.equal(v.eventCount, 2);

  // the anchor catches it, with the distinct code.
  v = verifyTrustAudit(run, { expectHead: anchor.headHash, expectCount: anchor.eventCount });
  assert.equal(v.verified, false, "anchored verify fails closed on a truncated log");
  const codes = v.checks.filter((c) => !c.pass).map((c) => c.code);
  assert.deepEqual(codes, ["trust-audit-truncated", "trust-audit-truncated"], "count + head shortfalls both reported");

  // truncate-then-append forgery: pad the log back past the captured count.
  for (let i = 0; i < 3; i++) {
    recordTrustAuditEvent(run, { kind: "sandbox.path", decision: "allowed", source: "cw-validated", workerId: `pad${i}` });
  }
  v = verifyTrustAudit(run, { expectHead: anchor.headHash, expectCount: anchor.eventCount });
  assert.equal(v.verified, false, "a truncated-then-padded log still fails the head check");
  assert.deepEqual(
    v.checks.filter((c) => !c.pass).map((c) => ({ name: c.name, code: c.code })),
    [{ name: "anchor-head", code: "trust-audit-truncated" }],
    "the padded count passes; the missing head is the one remaining failure"
  );
})();

// ---- 4. CLI <-> MCP parity ------------------------------------------------
(function cliMcpParity() {
  // lay a run out the way the CLI resolves it: <cwd>/.cw/runs/<id>/state.json
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "anchor-parity-"));
  const runId = "anchor-parity-run";
  const runDir = path.join(workDir, ".cw", "runs", runId);
  fs.mkdirSync(runDir, { recursive: true });
  // workflow/paths (even empty) must be present — a real run always has
  // both from creation onward; a state.json missing both, next to a run
  // dir that already has real audit content, now trips loadRunFromCwd's
  // suspected-data-loss guard (by design: see statecore-suspected-data-loss).
  fs.writeFileSync(path.join(runDir, "state.json"), JSON.stringify({ id: runId, schemaVersion: 1, workflow: {}, paths: {} }));
  const run = { id: runId, paths: { runDir } };
  recordTrustAuditEvent(run, { kind: "sandbox.path", decision: "allowed", source: "cw-validated", workerId: "w1" });
  recordTrustAuditEvent(run, { kind: "commit.gate", decision: "recorded", source: "cw-validated" });

  function mcpCall(tool, args) {
    const out = execFileSync(node, [mcpServer], {
      cwd: workDir,
      input: `${JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: tool, arguments: args } })}\n`,
      encoding: "utf8",
    });
    const line = out.trim().split("\n").find((entry) => entry.includes('"result"'));
    const result = JSON.parse(line).result;
    assert.ok(!result.isError, `${tool} must not error: ${JSON.stringify(result)}`);
    return JSON.parse(result.content[0].text);
  }

  const cliHead = JSON.parse(
    spawnSync(node, [cli, "audit", "head", runId], { cwd: workDir, encoding: "utf8" }).stdout
  );
  const mcpHead = mcpCall("cw_audit_head", { runId, cwd: workDir });
  assert.deepEqual(cliHead, mcpHead, "cw audit head === cw_audit_head");

  const cliVerify = spawnSync(
    node,
    [cli, "audit", "verify", runId, "--expect-head", cliHead.headHash, "--expect-count", String(cliHead.eventCount)],
    { cwd: workDir, encoding: "utf8" }
  );
  assert.equal(cliVerify.status, 0);
  const mcpVerify = mcpCall("cw_audit_verify", {
    runId,
    cwd: workDir,
    expectHead: cliHead.headHash,
    expectCount: String(cliHead.eventCount),
  });
  assert.deepEqual(JSON.parse(cliVerify.stdout), mcpVerify, "anchored cw audit verify === cw_audit_verify");
  assert.equal(mcpVerify.anchor.satisfied, true);
})();

process.stdout.write("trust-audit-anchor-smoke: ok\n");
