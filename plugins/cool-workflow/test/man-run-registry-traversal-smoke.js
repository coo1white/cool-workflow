#!/usr/bin/env node
// man-run-registry-traversal-smoke — two read-path traversal guards:
//
// 1. `cw man <topic>` (man-cli.ts readManPage): the third candidate is a bare
//    path.join(docsDir, topic) with no separator/`..` filter, so a topic like
//    "../../../../etc/passwd" would otherwise read any file on disk to stdout.
//    A containment check (isContainedPath) must reject any candidate that
//    resolves outside docsDir, while a normal topic still resolves fine.
//
// 2. RunRegistry.locate/loadRun (run-registry-io.ts): unlike run-store.ts's
//    loadRunFromCwd, these never called assertSafeRunId on the runId before
//    joining it into a filesystem path, so run.show/resume/archive/rerun (all
//    routed through locate()) could probe or read any file named state.json
//    reachable via a crafted "../../.../state.json"-shaped runId. Both entry
//    points must now reject an unsafe id up front, and a benign id must still
//    resolve correctly (POLA).
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { readManPage, ManPageNotFoundError } = require("../dist/shell/man-cli");
const { RunRegistry } = require("../dist/shell/run-registry-io");
const { createRunPaths, ensureRunDirs, saveCheckpoint } = require("../dist/shell/run-store");

// --- 1. cw man traversal ----------------------------------------------------

// Positive control: a real topic under docs/ still resolves.
const docsDir = path.join(__dirname, "..", "docs");
const realTopic = fs
  .readdirSync(docsDir)
  .find((f) => f.endsWith(".7.md"))
  ?.replace(/\.7\.md$/, "");
assert.ok(realTopic, "sanity: docs/ must have at least one *.7.md topic to test against");
const page = readManPage(realTopic);
assert.ok(page.length > 0, "a real topic must still return its man page body");

// Attack: escape docsDir via the topic string, several traversal shapes.
const secretPath = path.join(os.tmpdir(), `cw-man-traversal-secret-${process.pid}.txt`);
fs.writeFileSync(secretPath, "SECRET-OUTSIDE-DOCS\n", "utf8");
const relFromDocs = path.relative(docsDir, secretPath);
assert.ok(relFromDocs.includes(".."), "sanity: the secret file must be outside docsDir");

for (const evilTopic of [relFromDocs, "../../../../../../../../etc/passwd", secretPath]) {
  assert.throws(
    () => readManPage(evilTopic),
    ManPageNotFoundError,
    `readManPage must refuse to escape docsDir via ${JSON.stringify(evilTopic)}`
  );
}
fs.rmSync(secretPath, { force: true });

// --- 2. RunRegistry runId traversal ----------------------------------------

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cw-registry-traversal-"));
const repo = path.join(tmp, "repo");
fs.mkdirSync(repo, { recursive: true });
const env = { ...process.env, CW_HOME: path.join(tmp, "home") };

// A real state.json OUTSIDE the repo's runs dir, reachable only via traversal.
const victimDir = path.join(tmp, "victim");
const victimRunDir = path.join(victimDir, "secret-run");
const paths = createRunPaths(victimRunDir);
ensureRunDirs(paths);
saveCheckpoint({
  schemaVersion: 1,
  id: "secret-run",
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  cwd: victimDir,
  workflow: { id: "test", title: "Test", summary: "", limits: { maxAgents: 1, maxConcurrentAgents: 1 } },
  inputs: {},
  loopStage: "interpret",
  phases: [],
  tasks: [],
  dispatches: [],
  commits: [],
  paths,
  nodes: [],
  contracts: []
});
assert.ok(fs.existsSync(path.join(victimRunDir, "state.json")), "sanity: victim state.json must exist");

const registry = new RunRegistry(repo, undefined, env);
const repoRunsDir = path.join(repo, ".cw", "runs");
const traversalId = path.relative(repoRunsDir, victimRunDir);
assert.ok(traversalId.includes(".."), "sanity: crafted id must traverse upward out of the repo's runs dir");

for (const bad of [traversalId, "../../../../etc", "..", ".", "a/b"]) {
  assert.throws(
    () => registry.locate(bad, "repo"),
    /Unsafe run id|Invalid run id/,
    `locate() must reject ${JSON.stringify(bad)}`
  );
  assert.throws(
    () => registry.loadRun(repo, bad),
    /Unsafe run id|Invalid run id/,
    `loadRun() must reject ${JSON.stringify(bad)}`
  );
  assert.throws(
    () => registry.showRun(bad, { scope: "repo" }),
    /Unsafe run id|Invalid run id/,
    `showRun() must reject ${JSON.stringify(bad)}`
  );
}

// Positive control: a benign, non-existent-but-safe id is a clean miss, not a
// throw — the guard must not reject ordinary single-segment ids.
const miss = registry.showRun("no-such-run", { scope: "repo" });
assert.equal(miss.found, false, "showRun must report a normal not-found id as found:false, not throw");

process.stdout.write("man-run-registry-traversal-smoke: ok\n");
