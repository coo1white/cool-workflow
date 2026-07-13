#!/usr/bin/env node
"use strict";

// trust-audit-ensure-create-no-truncate-smoke (robustness) —
// ensureTrustAudit runs OUTSIDE the append lock. It used to create a
// missing events.jsonl with a plain (truncating) writeFileSync behind an
// existsSync check. Between one process seeing "no file" and its create,
// another process could create the log AND append a real event under the
// lock — the first process's create then cut the file back to zero bytes,
// silently deleting that event. The next append saw an empty log and
// started the chain from genesis again, so the loss verified "clean":
// one event short, chain green, no corrupt lines. This is what made
// trust-audit-append-lock-concurrency-smoke fail once on CI (89 of 90)
// under coverage-slowed I/O. The fix creates with flag "a" (O_CREAT
// without O_TRUNC), which never cuts an existing file.
//
// This smoke pins that by force: child A parks INSIDE the create window
// (a patched fs.writeFileSync sleeps before the real empty-create), child
// B appends a real event during the sleep, then A finishes. With the old
// code A's create deletes B's event (count 1); with the fix both events
// survive (count 2).

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");

const pluginRoot = path.resolve(__dirname, "..");
const trustAuditJs = path.join(pluginRoot, "dist", "shell", "trust-audit.js");
const node = process.execPath;

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cw-audit-trunc-"));
const runDir = path.join(dir, "run");
fs.mkdirSync(runDir, { recursive: true });
const runId = "create-truncate-race-run";

// Child A: hold the create of events.jsonl open for 400ms so child B can
// create the log and append first. The patch fires only on the zero-byte
// create (data === ""), never on any other write.
const childA = path.join(dir, "child-a.js");
fs.writeFileSync(
  childA,
  [
    `const fs = require("node:fs");`,
    `const orig = fs.writeFileSync;`,
    `fs.writeFileSync = function (p, data, ...rest) {`,
    `  if (String(p).endsWith("events.jsonl") && data === "") {`,
    `    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 400);`,
    `  }`,
    `  return orig.call(fs, p, data, ...rest);`,
    `};`,
    `const { recordTrustAuditEvent } = require(${JSON.stringify(trustAuditJs)});`,
    `const run = { id: ${JSON.stringify(runId)}, paths: { runDir: ${JSON.stringify(runDir)} } };`,
    `recordTrustAuditEvent(run, { kind: "sandbox.path", decision: "allowed", source: "cw-validated", workerId: "wa" });`,
  ].join("\n")
);

// Child B: a normal writer, no patch.
const childB = path.join(dir, "child-b.js");
fs.writeFileSync(
  childB,
  [
    `const { recordTrustAuditEvent } = require(${JSON.stringify(trustAuditJs)});`,
    `const run = { id: ${JSON.stringify(runId)}, paths: { runDir: ${JSON.stringify(runDir)} } };`,
    `recordTrustAuditEvent(run, { kind: "sandbox.path", decision: "allowed", source: "cw-validated", workerId: "wb" });`,
  ].join("\n")
);

function wait(p) {
  return new Promise((resolve, reject) => {
    p.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`child exited ${code}`))));
    p.on("error", reject);
  });
}

(async () => {
  try {
    const a = spawn(node, [childA], { stdio: "inherit" });
    // Let A get past its existsSync and park inside the patched create.
    await new Promise((r) => setTimeout(r, 150));
    const b = spawn(node, [childB], { stdio: "inherit" });
    await Promise.all([wait(a), wait(b)]);

    const { verifyTrustAudit } = require(trustAuditJs);
    const integrity = verifyTrustAudit({ id: runId, paths: { runDir } });

    assert.equal(integrity.eventCount, 2, `the create of a missing log must never cut events another process already appended (got ${integrity.eventCount} of 2)`);
    assert.equal(integrity.verified, true, `the chain must verify clean: ${JSON.stringify(integrity.checks)}`);
    assert.equal(integrity.corruptLines, 0, "no corrupt lines");

    process.stdout.write("trust-audit-ensure-create-no-truncate-smoke: ok\n");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
