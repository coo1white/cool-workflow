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
} = require("../dist/core/trust/evidence-grounding");
const { isContainedPath, realResolve, durableAppendFileSync } = require("../dist/shell/fs-atomic");
const { taskRequiresEvidence } = require("../dist/shell/verifier");

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
// 2. Grounding policy: a required-evidence task with ungrounded evidence must be
//    caught, while optional-evidence tasks stay flexible (so map/assess still
//    pass with opaque evidence). In v2 the old `validateResultEnvelope(task,
//    envelope)` throw-wrapper is gone; the same policy is enforced by the pair
//    `taskRequiresEvidence(task)` + `hasGroundedEvidence(evidence)` that the
//    v2 commit gate itself uses (src/core/pipeline/commit-gate.ts
//    groundVerifierEvidence). Assert on that equivalent pair.
{
  const verifyTask = { id: "verify:risks", requiresEvidence: true };
  // required task + ungrounded evidence -> policy would reject.
  assert.ok(taskRequiresEvidence(verifyTask), "verify: task is held to the evidence bar");
  assert.ok(!hasGroundedEvidence(["x"]), "required task with ungrounded evidence is rejected");
  // required task + grounded evidence -> policy passes.
  assert.ok(hasGroundedEvidence(["src/x.ts:1"]), "required task with grounded evidence passes");
  // optional task -> not held to the bar, opaque evidence is fine.
  assert.ok(!taskRequiresEvidence({ id: "map:x" }), "map: optional task is not held to the evidence bar");
  console.log("self-audit-hardening: required-task grounding policy ok");
}
// NO v2 EQUIVALENT: the old validateResultEnvelope also rejected any P0/P1/P2
// FINDING whose own evidence was ungrounded (per-finding severity gate). v2 moved
// grounding enforcement to the verifier-node / commit-gate level, which grades the
// node's aggregate evidence list and no task-level, per-finding-severity grounding
// check exists. Reported for a human judgment call; not reconstructed here so the
// smoke keeps asserting only real v2 behavior.

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
// v2's resolveEvidenceLocator is pure: it takes injected fs/path predicates so
// core/ never touches fs directly. Inject the real ones to preserve the original
// on-disk resolution intent.
const exists = (p) => fs.existsSync(p);
const isAbs = (p) => path.isAbsolute(p);
const resolvePath = (base, rel) => path.resolve(base, rel);
assert.equal(requireResolvableEvidence(), false, "strict mode defaults off");
assert.equal(resolveEvidenceLocator("https://x.test", [], exists, isAbs, resolvePath), "external", "urls are external");
assert.equal(resolveEvidenceLocator("exitCode:0", [], exists, isAbs, resolvePath), "opaque", "tokens are opaque (not file paths)");
assert.equal(resolveEvidenceLocator(path.join(tmp, "audit", "events.jsonl"), [tmp], exists, isAbs, resolvePath), "resolved", "an existing file resolves");
assert.equal(resolveEvidenceLocator("does/not/exist.ts:1", [tmp], exists, isAbs, resolvePath), "unresolved", "a missing file is unresolved");
console.log("self-audit-hardening: strict resolution classification ok");

console.log("self-audit-hardening: ok");
