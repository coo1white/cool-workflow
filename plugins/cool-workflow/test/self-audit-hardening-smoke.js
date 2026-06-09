#!/usr/bin/env node
// Regression coverage for the v0.1.40 self-audit hardening:
//   P1  evidence grounding (presence -> grounded/strict) at result + commit gate
//   P1  symlink-hardened path containment (realResolve / isContainedPath)
//   P1  durable trust-audit append (durableAppendFileSync)
//   P2  deterministic worker ids (same inputs -> same id)
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const {
  isGroundedEvidence,
  hasGroundedEvidence,
  resolveEvidenceLocator,
  requireResolvableEvidence
} = require("../dist/evidence-grounding");
const { isContainedPath, realResolve, durableAppendFileSync } = require("../dist/state");
const { validateResultEnvelope } = require("../dist/verifier");

const node = process.execPath;
const cli = path.join(__dirname, "..", "dist", "cli.js");

// ---------------------------------------------------------------------------
// 1. Evidence grounding is a pure shape check: machine-shaped locators pass,
//    bare prose does not.
// ---------------------------------------------------------------------------
for (const grounded of ["src/verifier.ts:80-81", "exitCode:0", "stdoutSha256:abc", "https://example.com/x", "README.md", "a/b/c"]) {
  assert.ok(isGroundedEvidence(grounded), `expected grounded: ${grounded}`);
}
for (const ungrounded of ["x", "anything", "HIGH severity", "", "   ", "claimed finding"]) {
  assert.ok(!isGroundedEvidence(ungrounded), `expected NOT grounded: ${ungrounded}`);
}
assert.ok(hasGroundedEvidence(["x", "src/a.ts:1"]), "one grounded entry is enough");
assert.ok(!hasGroundedEvidence(["x", "anything"]), "all-prose evidence is rejected");
console.log("self-audit-hardening: evidence grounding ok");

// ---------------------------------------------------------------------------
// 2. validateResultEnvelope enforces grounding for required-evidence tasks but
//    leaves optional-evidence tasks alone (so map/assess stay flexible).
// ---------------------------------------------------------------------------
const verifyTask = { id: "verify:risks", requiresEvidence: true };
assert.throws(
  () => validateResultEnvelope(verifyTask, { summary: "s", findings: [], evidence: ["x"] }),
  /grounded/i,
  "required task with ungrounded evidence must throw"
);
validateResultEnvelope(verifyTask, { summary: "s", findings: [], evidence: ["src/x.ts:1"] });
// A P1 finding must cite grounded evidence regardless of task.
assert.throws(
  () => validateResultEnvelope({ id: "map:x" }, { summary: "s", findings: [{ id: "f", severity: "P1", evidence: ["nope"] }], evidence: [] }),
  /grounded/i,
  "P1 finding with ungrounded evidence must throw"
);
// Optional task with opaque evidence is fine.
validateResultEnvelope({ id: "map:x" }, { summary: "s", findings: [], evidence: ["x"] });
console.log("self-audit-hardening: validateResultEnvelope policy ok");

// ---------------------------------------------------------------------------
// 3. Symlink-hardened containment: a symlink whose textual path is "inside" an
//    allowed root but whose real target escapes it is NOT contained.
// ---------------------------------------------------------------------------
const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "cw-selfaudit-")));
const allowed = path.join(tmp, "sandbox");
const outside = path.join(tmp, "outside");
fs.mkdirSync(allowed, { recursive: true });
fs.mkdirSync(outside, { recursive: true });
fs.writeFileSync(path.join(outside, "secret.txt"), "secret\n");
fs.symlinkSync(outside, path.join(allowed, "escape"));

assert.ok(isContainedPath(path.join(allowed, "ok.md"), allowed), "a real path inside the sandbox is contained");
assert.ok(
  !isContainedPath(path.join(allowed, "escape", "secret.txt"), allowed),
  "a path through a symlink that escapes the sandbox is NOT contained"
);
assert.equal(realResolve(path.join(allowed, "escape", "secret.txt")), path.join(outside, "secret.txt"), "realResolve follows the symlink");
console.log("self-audit-hardening: symlink containment ok");

// ---------------------------------------------------------------------------
// 4. Durable append writes whole lines and is repeatable.
// ---------------------------------------------------------------------------
const logFile = path.join(tmp, "audit", "events.jsonl");
durableAppendFileSync(logFile, '{"a":1}\n');
durableAppendFileSync(logFile, '{"a":2}\n');
assert.equal(fs.readFileSync(logFile, "utf8"), '{"a":1}\n{"a":2}\n', "durable append preserves both lines");
console.log("self-audit-hardening: durable append ok");

// ---------------------------------------------------------------------------
// 5. Deterministic worker ids: planning + dispatching the SAME workflow with the
//    SAME inputs in two clean workspaces yields identical worker ids.
// ---------------------------------------------------------------------------
function firstWorkerId() {
  const ws = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "cw-detworker-")));
  const plan = JSON.parse(
    execFileSync(node, [cli, "plan", "architecture-review", "--repo", ws, "--question", "determinism"], { cwd: ws, encoding: "utf8" })
  );
  const dispatch = JSON.parse(execFileSync(node, [cli, "dispatch", plan.runId, "--limit", "1"], { cwd: ws, encoding: "utf8" }));
  return dispatch.tasks[0].workerId;
}
const idA = firstWorkerId();
const idB = firstWorkerId();
assert.equal(idA, idB, `worker ids must be deterministic across identical runs (${idA} != ${idB})`);
assert.ok(!/\d{8}T\d{6}Z/.test(idA), `worker id must not embed a wall-clock stamp: ${idA}`);
console.log(`self-audit-hardening: deterministic worker id ok (${idA})`);

// ---------------------------------------------------------------------------
// 6. Opt-in strict resolution is off by default; resolveEvidenceLocator classifies.
// ---------------------------------------------------------------------------
assert.equal(requireResolvableEvidence(), false, "strict mode defaults off");
assert.equal(resolveEvidenceLocator("https://x.test", []), "external", "urls are external");
assert.equal(resolveEvidenceLocator("exitCode:0", []), "opaque", "tokens are opaque (not file paths)");
assert.equal(resolveEvidenceLocator(path.join(tmp, "audit", "events.jsonl"), [tmp]), "resolved", "an existing file resolves");
assert.equal(resolveEvidenceLocator("does/not/exist.ts:1", [tmp]), "unresolved", "a missing file is unresolved");
console.log("self-audit-hardening: strict resolution classification ok");

console.log("self-audit-hardening: ok");
