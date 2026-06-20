#!/usr/bin/env node
// run-import-path-traversal-smoke — a crafted run archive must not be able to
// write outside the target's runs directory via a traversal run id (zip-slip
// class). The run id from the archive becomes a directory name under
// <target>/.cw/runs/, so an id like "../../../escape/ESCAPED" would otherwise
// escape the target entirely. importRun (and therefore the "safe inspect"
// command cw report verify-bundle, which restores into a throwaway tmpdir) must
// refuse such an id BEFORE any directory is created or any byte is written.
//
// This also fixes a fail-open seam: before the guard, importRun trusted
// raw.run.id straight into path.join with no containment check, contradicting
// the module's own promise ("no trust in paths from the archive without
// containment checks").
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { createRunPaths, ensureRunDirs, saveCheckpoint, readJson, writeJson, assertSafeRunId } = require("../dist/state");
const { exportRun, importRun } = require("../dist/run-export");

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cw-import-traversal-"));

// --- Build a real, valid bundle for a benign run -------------------------
const runId = "traversal-src";
const runDir = path.join(tmp, ".cw", "runs", runId);
const paths = createRunPaths(runDir);
ensureRunDirs(paths);
const artifactPath = path.join(paths.artifactsDir, "evidence.txt");
fs.writeFileSync(artifactPath, "benign artifact bytes\n", "utf8");

const run = {
  schemaVersion: 1,
  id: runId,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  cwd: tmp,
  workflow: { id: "test", title: "Test", summary: "", limits: { maxAgents: 1, maxConcurrentAgents: 1 } },
  inputs: { question: "hello" },
  loopStage: "interpret",
  phases: [{ id: "analyze", name: "Analyze", status: "completed", taskIds: [] }],
  tasks: [],
  dispatches: [],
  commits: [],
  paths,
  nodes: [{ id: `${runId}:input`, kind: "input", status: "completed", loopStage: "interpret",
    outputs: {}, artifacts: [{ id: "artifact-1", kind: "text", path: artifactPath }] }],
  contracts: []
};
saveCheckpoint(run);

const exportPath = path.join(tmp, "run-export.json");
exportRun(run, exportPath);
assert.ok(fs.existsSync(exportPath), "export file should exist");

// --- Positive control: the guard must NOT reject a benign id -------------
// (POLA: a normal round-trip still imports cleanly.)
const benignTarget = path.join(tmp, "benign-target");
fs.mkdirSync(benignTarget, { recursive: true });
const benign = importRun(exportPath, benignTarget);
assert.equal(benign.run.id, runId, "benign run id should import unchanged");
assert.ok(
  fs.existsSync(path.join(benignTarget, ".cw", "runs", runId, "state.json")),
  "benign import should land state under the target's runs directory"
);

// --- Attack: mutate the bundle's run id into a traversal --------------------
// digestManifest covers only `files` (not run.id), so mutating run.id keeps the
// archive's integrity block valid — the malicious bundle reaches the run-id
// guard rather than being rejected earlier for a digest mismatch. That is the
// whole point: only the new guard stops it.
const victim = path.join(tmp, "victim");
fs.mkdirSync(victim, { recursive: true });
const victimRunsRoot = path.join(victim, ".cw", "runs");
const escapeDir = path.join(tmp, "escape");
const escapedRunDir = path.join(escapeDir, "ESCAPED");
const traversalId = path.relative(victimRunsRoot, escapedRunDir); // e.g. ../../../escape/ESCAPED
assert.ok(traversalId.includes(".."), "sanity: crafted id should traverse upward");

const archive = readJson(exportPath);
archive.run.id = traversalId;
const maliciousPath = path.join(tmp, "malicious-export.json");
writeJson(maliciousPath, archive);

assert.throws(
  () => importRun(maliciousPath, victim),
  /Unsafe run id|escapes the runs directory/,
  "import must refuse a traversal run id"
);
assert.ok(
  !fs.existsSync(escapedRunDir),
  "no run directory may be created outside the target's runs directory"
);
assert.ok(
  !fs.existsSync(path.join(escapedRunDir, "state.json")),
  "no run file may be written outside the target's runs directory"
);

// --- Unit coverage for the guard itself ------------------------------------
for (const bad of ["../evil", "..", ".", "a/b", "a\\b", "/abs", "", "x/../../y", "foo/..", "..bar/../baz"]) {
  assert.throws(() => assertSafeRunId(bad), /Invalid run id|Unsafe run id/, `assertSafeRunId must reject ${JSON.stringify(bad)}`);
}
for (const good of ["traversal-src", "architecture-review-20260620T101500Z-1234-1", "a", "A_b.c-1", "..lead-but-no-traversal".replace("..", "x")]) {
  assert.equal(assertSafeRunId(good), good, `assertSafeRunId must accept ${JSON.stringify(good)}`);
}
// A bare-dotted name without a `..` sequence is a valid single segment.
assert.equal(assertSafeRunId("v1.2.3"), "v1.2.3", "dotted-but-non-traversal id is allowed");

process.stdout.write("run-import-path-traversal-smoke: ok\n");
