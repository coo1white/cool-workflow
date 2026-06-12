#!/usr/bin/env node
const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { createRunPaths, ensureRunDirs, saveCheckpoint, readJson, writeJson } = require("../dist/state");
const { exportRun, importRun, verifyImportedRun } = require("../dist/run-export");

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cw-run-export-"));
const runId = "export-test";
const runDir = path.join(tmp, ".cw", "runs", runId);
const paths = createRunPaths(runDir);
ensureRunDirs(paths);
const artifactPath = path.join(paths.artifactsDir, "evidence.txt");
const externalArtifactPath = path.join(tmp, "evidence", "external-note.txt");
const auditPath = path.join(paths.auditDir, "events.jsonl");
const telemetryPath = path.join(paths.runDir, "telemetry.json");
fs.writeFileSync(artifactPath, "portable artifact bytes\n", "utf8");
fs.mkdirSync(path.dirname(externalArtifactPath), { recursive: true });
fs.writeFileSync(externalArtifactPath, "repo-local artifact outside the run dir\n", "utf8");
fs.writeFileSync(
  auditPath,
  JSON.stringify({
    schemaVersion: 1,
    id: "audit-1",
    createdAt: "2026-06-12T00:00:00.000Z",
    runId,
    kind: "worker.output",
    decision: "accepted",
    source: "runtime-derived"
  }) + "\n",
  "utf8"
);
fs.writeFileSync(
  telemetryPath,
  JSON.stringify({
    schemaVersion: 1,
    runId,
    records: []
  }, null, 2) + "\n",
  "utf8"
);

// Create a minimal run
const run = {
  schemaVersion: 1,
  id: runId,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  cwd: tmp,
  workflow: { id: "test", title: "Test", summary: "", limits: { maxAgents: 1, maxConcurrentAgents: 1 } },
  inputs: { question: "hello" },
  loopStage: "interpret",
  phases: [{ id: "analyze", name: "Analyze", status: "completed", taskIds: ["t1"] }],
  tasks: [{ id: "t1", kind: "analyze", phase: "analyze", status: "completed", requiresEvidence: false,
    prompt: "test", taskPath: path.join(paths.tasksDir, "t1.md"), resultPath: path.join(paths.resultsDir, "t1.md"), loopStage: "act" }],
  dispatches: [],
  commits: [],
  paths,
  nodes: [{ id: `${runId}:input`, kind: "input", status: "completed", loopStage: "interpret",
    outputs: {}, artifacts: [
      { id: "artifact-1", kind: "text", path: artifactPath },
      { id: "external-artifact", kind: "text", path: externalArtifactPath }
    ] }],
  contracts: []
};
saveCheckpoint(run);

// Export
const exportPath = path.join(tmp, "run-export.json");
const exported = exportRun(run, exportPath);
assert.ok(fs.existsSync(exportPath), "export file should exist");
assert.equal(exported.runId, runId);
assert.ok(exported.exportedAt, "should have exportedAt timestamp");
assert.ok(exported.fileCount >= 3, "archive should include run-local files");
assert.equal(exported.telemetryIncluded, true, "telemetry overlay should be included");
assert.ok(exported.auditFileCount >= 1, "audit overlay should be included");
assert.ok(exported.archiveSha256, "archive should report its own digest");
const archive = readJson(exportPath);
assert.ok(archive.files.some((entry) => entry.relativePath === "artifacts/evidence.txt"), "artifact bytes should be archived");
assert.ok(archive.files.some((entry) => entry.relativePath.startsWith("external-artifacts/") && entry.sourcePath === externalArtifactPath), "repo-local external artifact bytes should be archived");
assert.ok(archive.files.some((entry) => entry.relativePath === "audit/events.jsonl"), "audit event log should be archived");
assert.ok(archive.files.some((entry) => entry.relativePath === "telemetry.json"), "telemetry overlay should be archived");
for (const entry of archive.files) {
  assert.ok(entry.sha256, `archived file ${entry.relativePath} should carry a digest`);
  assert.ok(entry.contentBase64, `archived file ${entry.relativePath} should carry content`);
}

// Import to new location
const restoreDir = path.join(tmp, "restored");
fs.mkdirSync(restoreDir, { recursive: true });
const restored = importRun(exportPath, restoreDir);
assert.equal(restored.run.id, runId);
assert.equal(restored.run.workflow.id, "test");
assert.ok(restored.run.paths.state.includes(restoreDir), "restored paths should be under restoreDir");
assert.ok(fs.existsSync(path.join(restored.run.paths.artifactsDir, "evidence.txt")), "artifact file should be restored");
assert.equal(fs.readFileSync(path.join(restored.run.paths.artifactsDir, "evidence.txt"), "utf8"), "portable artifact bytes\n");
const restoredExternal = restored.run.nodes[0].artifacts.find((artifact) => artifact.id === "external-artifact");
assert.ok(restoredExternal, "restored run keeps the external artifact record");
assert.ok(restoredExternal.path.startsWith(restored.run.paths.runDir), "external artifact is remapped into the restored run archive area");
assert.equal(fs.readFileSync(restoredExternal.path, "utf8"), "repo-local artifact outside the run dir\n");
assert.ok(fs.existsSync(path.join(restored.run.paths.auditDir, "events.jsonl")), "audit event log should be restored");
assert.ok(fs.existsSync(path.join(restored.run.paths.runDir, "telemetry.json")), "telemetry overlay should be restored");
assert.ok(restored.verifyCommand.includes("run verify-import"), "import should return a restore verification command");
assert.equal(restored.verification.ok, true, "import should verify the restored archive immediately");

const verified = verifyImportedRun(restored.run);
assert.equal(verified.ok, true, "restore verification should pass after import");
assert.ok(verified.checks.some((check) => check.name === "archive-files" && check.pass), "file digest check should pass");

// Real CLI surface: export -> import -> verify-import.
const pluginRoot = path.resolve(__dirname, "..");
const cli = path.join(pluginRoot, "dist", "cli.js");
const cliExportPath = path.join(tmp, "cli-run-export.json");
const cliExported = JSON.parse(execFileSync(process.execPath, [cli, "run", "export", runId, "--cwd", tmp, "--output", cliExportPath], {
  cwd: pluginRoot,
  encoding: "utf8"
}));
assert.equal(cliExported.runId, runId);
assert.ok(cliExported.fileCount >= 3, "CLI export should include restored run-local files");
const cliRestoreDir = path.join(tmp, "cli-restored");
const cliImported = JSON.parse(execFileSync(process.execPath, [cli, "run", "import", cliExportPath, "--target", cliRestoreDir], {
  cwd: pluginRoot,
  encoding: "utf8"
}));
assert.equal(cliImported.verification.ok, true, "CLI import should verify restored files");
const cliVerified = JSON.parse(execFileSync(process.execPath, [cli, "run", "verify-import", runId, "--cwd", cliRestoreDir], {
  cwd: pluginRoot,
  encoding: "utf8"
}));
assert.equal(cliVerified.ok, true, "CLI verify-import should pass after CLI import");

fs.writeFileSync(path.join(restored.run.paths.artifactsDir, "evidence.txt"), "tampered\n", "utf8");
const tampered = verifyImportedRun(restored.run);
assert.equal(tampered.ok, false, "restore verification should detect tampered restored files");
assert.ok(tampered.checks.some((check) => check.code === "digest-mismatch"), "tamper should be reported as a digest mismatch");

process.stdout.write("run-export-import-smoke: ok\n");
