#!/usr/bin/env node
// drive-audit-batches — audit-batches program, PR 2
// (project/docs/intent/2026-09-26-audit-batches.md).
//
// 1. A serial drive writes each worker's trust-audit events in 3 durable
//    appends (dispatch group, accept group, agent-env), not one per event,
//    and every event is still there, in a whole chain.
// 2. A checkpoint saved while a batch is open (recordWorkerFailure does this
//    on a sandbox violation) reaches disk only after the audit events
//    recorded before it: audit first, then state.

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const pluginRoot = path.resolve(__dirname, "..", "..");
const { drive } = require(path.join(pluginRoot, "dist/shell/drive"));
const { plan } = require(path.join(pluginRoot, "dist/shell/pipeline"));
const { createRun, saveCheckpoint } = require(path.join(pluginRoot, "dist/shell/run-store"));
const { recordTrustAuditEvent, verifyTrustAudit, withTrustAuditBatch } = require(path.join(pluginRoot, "dist/shell/trust-audit"));
const api = require(path.join(pluginRoot, "dist/core/workflow-apps/app-schema"));

const WORKERS = 4;

function writeStub(file) {
  const fence = String.fromCharCode(96).repeat(3);
  fs.writeFileSync(
    file,
    [
      'const fs = require("fs");',
      `fs.writeFileSync(process.argv[2], "# R\\n\\n" + ${JSON.stringify(fence)} + "cw:result\\n" + JSON.stringify({ summary: "s", findings: [], evidence: [process.cwd() + "/README.md:1"] }) + "\\n" + ${JSON.stringify(fence)} + "\\n");`,
      'process.stdout.write(JSON.stringify({ model: "stub", usage: { input_tokens: 1, output_tokens: 1 } }));',
    ].join("\n")
  );
  return file;
}

// Counts fsyncs on one file by remembering which path each fd was opened on
// (and forgetting it on close, since fd numbers are reused).
function countFsyncs(file, fn) {
  const open = fs.openSync;
  const close = fs.closeSync;
  const fsync = fs.fsyncSync;
  const fds = new Set();
  let count = 0;
  fs.openSync = function (p, ...rest) {
    const fd = open.call(fs, p, ...rest);
    if (path.resolve(String(p)) === file) fds.add(fd);
    return fd;
  };
  fs.closeSync = function (fd) {
    fds.delete(fd);
    return close.call(fs, fd);
  };
  fs.fsyncSync = function (fd) {
    if (fds.has(fd)) count += 1;
    return fsync.call(fs, fd);
  };
  try {
    fn();
  } finally {
    fs.openSync = open;
    fs.closeSync = close;
    fs.fsyncSync = fsync;
  }
  return count;
}

const cwd0 = process.cwd();

// 1. A serial drive: 3 audit flushes a worker.
{
  const work = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "cw-audit-batches-")));
  fs.writeFileSync(path.join(work, "README.md"), "# target\n", "utf8");
  try {
    process.chdir(work);
    const def = api.workflow({
      id: "audit-batches-probe",
      title: "audit-batches-probe",
      limits: { maxAgents: WORKERS, maxConcurrentAgents: 1 },
      inputs: [{ name: "repo", type: "path", required: true }],
      phases: [api.phase("Map", Array.from({ length: WORKERS }, (_, i) => api.agent(`t${i}`, `probe ${i}`)))],
    });
    const p = plan({ id: def.id, title: def.title, summary: "", version: "0.0.1", workflow: def, sandboxProfiles: [], sourcePath: path.join(work, `${def.id}.app.json`) }, { repo: work });
    const agentConfig = { schemaVersion: 1, command: process.execPath, args: [writeStub(path.join(work, "stub.js")), "{{result}}"], source: "flag" };
    const log = path.join(p.paths.runDir, "audit", "events.jsonl");

    let result;
    const flushes = countFsyncs(log, () => {
      result = drive(p.id, work, { now: "2026-07-01T00:00:00.000Z", agentConfig });
    });

    const events = fs.readFileSync(log, "utf8").split("\n").filter(Boolean).map((line) => JSON.parse(line));
    const workerEvents = events.filter((e) => e.workerId);
    assert.equal(result.steps.filter((s) => s.status === "ok").length, WORKERS, "every task accepted");
    assert.equal(workerEvents.length, 7 * WORKERS, "all 7 events of each worker are written");
    assert.equal(flushes, events.length - workerEvents.length + 3 * WORKERS, `3 durable appends a worker (got ${flushes} for ${events.length} events)`);
    assert.equal(verifyTrustAudit({ id: p.id, paths: p.paths }).verified, true, "the chain is whole");
  } finally {
    process.chdir(cwd0);
    fs.rmSync(work, { recursive: true, force: true });
  }
}

// 2. Audit first, then state: a save inside an open batch writes the batch's
//    events before state.json is replaced.
{
  const work = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "cw-audit-order-")));
  try {
    const run = createRun(path.join(work, ".cw", "runs", "order-run"), "order-run", "order-probe", work);
    const log = path.join(run.paths.runDir, "audit", "events.jsonl");
    const rename = fs.renameSync;
    let eventsAtStateWrite;
    fs.renameSync = function (from, to) {
      if (path.resolve(String(to)) === path.resolve(run.paths.state)) {
        eventsAtStateWrite = fs.existsSync(log) ? fs.readFileSync(log, "utf8").split("\n").filter(Boolean).length : 0;
      }
      return rename.call(fs, from, to);
    };
    try {
      withTrustAuditBatch(run, () => {
        recordTrustAuditEvent(run, { kind: "worker.failure", decision: "failed", source: "runtime-derived", workerId: "w1", taskId: "t1" });
        saveCheckpoint(run);
        recordTrustAuditEvent(run, { kind: "worker.output", decision: "recorded", source: "cw-validated", workerId: "w1", taskId: "t1" });
      });
    } finally {
      fs.renameSync = rename;
    }
    assert.equal(eventsAtStateWrite, 1, "the event recorded before the save is on disk when state.json is replaced");
    assert.equal(fs.readFileSync(log, "utf8").split("\n").filter(Boolean).length, 2, "the event after the save is written when the batch ends");
    assert.equal(verifyTrustAudit(run).verified, true, "the chain is whole across the mid-batch flush");
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }
}

process.stdout.write("drive-audit-batches: ok\n");
