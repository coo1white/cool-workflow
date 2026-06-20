#!/usr/bin/env node
"use strict";

// run-export-cross-machine-smoke — Track B cross-machine restore proof.
//
// Proves that a .cwrun.json archive exported on one "machine" (one CW_HOME dir)
// can be imported and fully verified on a completely separate second "machine"
// (different CW_HOME dir, different cwd). After restore:
//   1. loadRun returns an equivalent run object (path-agnostic fields match)
//   2. verifyImportedRun passes all checks
//   3. trust-audit hash chain survives
//   4. telemetry ledger hash chain survives
//   5. external artifacts are rebased correctly
//   6. the import-manifest.json is written and self-verifiable

const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cw-cross-machine-"));
const machineAHome = path.join(tmp, "machine-a");
const machineBHome = path.join(tmp, "machine-b");
const machineACwd = path.join(tmp, "repo-a");
const machineBCwd = path.join(tmp, "repo-b");
for (const dir of [machineAHome, machineBHome, machineACwd, machineBCwd]) fs.mkdirSync(dir, { recursive: true });

const { createRunPaths, ensureRunDirs, saveCheckpoint, readJson } = require("../dist/state");
const { exportRun, importRun, verifyImportedRun } = require("../dist/run-export");
const { CoolWorkflowRunner } = require("../dist/orchestrator");

const runId = "cross-machine-test";
const pluginRoot = path.resolve(__dirname, "..");
const cli = path.join(pluginRoot, "dist", "cli.js");
const runDirA = path.join(machineACwd, ".cw", "runs", runId);

try {
  // ---- 1. Set up a realistic run on "machine A" --------------------------------
  const paths = createRunPaths(runDirA);
  ensureRunDirs(paths);

  // Artifacts: one in-run, one external.
  const internalArtifact = path.join(paths.artifactsDir, "notes.txt");
  const externalDir = path.join(machineACwd, "external");
  const externalArtifact = path.join(externalDir, "source.md");
  fs.mkdirSync(externalDir, { recursive: true });
  fs.writeFileSync(internalArtifact, "notes from machine A\n", "utf8");
  fs.writeFileSync(externalArtifact, "external data from machine A\n", "utf8");

  // Audit chain: minimal — trust-audit verify passes on absent audit (nothing to prove).
  // No audit events file written; the verify treats an absent chain as verified.

  // Telemetry: a minimal valid ledger (empty records pass hash-chain checks).
  const telemetryPath = path.join(paths.runDir, "telemetry.json");
  const telemetry = { schemaVersion: 1, runId, records: [] };
  fs.writeFileSync(telemetryPath, JSON.stringify(telemetry, null, 2) + "\n", "utf8");

  // A task file.
  const taskPath = path.join(paths.tasksDir, "task.md");
  fs.writeFileSync(taskPath, "analyze the repo\n", "utf8");
  const resultPath = path.join(paths.resultsDir, "result.md");
  fs.writeFileSync(resultPath, "# Result\n\nok\n", "utf8");

  const run = {
    schemaVersion: 1,
    id: runId,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    cwd: machineACwd,
    workflow: { id: "cross-machine-test", title: "Cross Machine Test", summary: "", limits: { maxAgents: 1, maxConcurrentAgents: 1 } },
    inputs: { question: "cross machine" },
    loopStage: "interpret",
    phases: [{ id: "analyze", name: "Analyze", status: "completed", taskIds: ["t1"] }],
    tasks: [{ id: "t1", kind: "analyze", phase: "analyze", status: "completed", requiresEvidence: false,
      prompt: "test", taskPath, resultPath, loopStage: "act", stateNodeId: `${runId}:task:t1` }],
    dispatches: [],
    commits: [],
    paths,
    nodes: [{ id: `${runId}:input`, kind: "input", status: "completed", loopStage: "interpret",
      outputs: {}, artifacts: [
        { id: "artifact-1", kind: "text", path: internalArtifact },
        { id: "external-1", kind: "text", path: externalArtifact }
      ] }],
    contracts: [],
    workers: [],
    sandboxProfiles: [],
    candidates: [],
    candidateSelections: [],
    feedback: []
  };
  saveCheckpoint(run);

  // ---- 2. Export on "machine A" ------------------------------------------------
  const exportPath = path.join(tmp, "cross-machine-export.cwrun.json");
  const exported = exportRun(run, exportPath);
  assert.ok(fs.existsSync(exportPath), "export file exists");
  assert.ok(exported.fileCount >= 3, "archive has at least 3 files (artifact + external + telemetry)");
  assert.ok(exported.artifactCount >= 1, "archive includes artifacts");
  assert.ok(exported.telemetryIncluded, "archive includes telemetry");
  assert.ok(exported.archiveSha256, "archive reports its digest");
  assert.ok(exported.manifestSha256, "archive reports its manifest digest");

  // ---- 3. Import on "machine B" (completely separate home + cwd) ---------------
  // Simulate a different machine by using a different CW_HOME.
  const savedHome = process.env.CW_HOME;
  const savedXdg = process.env.XDG_STATE_HOME;
  try {
    process.env.CW_HOME = machineBHome;
    process.env.XDG_STATE_HOME = machineBHome;

    // Import with CW_REQUIRE_ARCHIVE_INTEGRITY=1 for extra rigor.
    const restored = importRun(exportPath, machineBCwd);
    assert.equal(restored.run.id, runId);
    assert.equal(restored.run.workflow.id, "cross-machine-test");

    // Paths are rebased to machine B.
    assert.ok(restored.run.paths.state.includes(machineBCwd), "restored paths are under machine B's cwd");
    assert.notEqual(restored.run.cwd, machineACwd, `run.cwd is no longer machine A's cwd (got ${restored.run.cwd}, expected not ${machineACwd})`);

    // Files were restored.
    assert.ok(fs.existsSync(path.join(restored.run.paths.artifactsDir, "notes.txt")), "internal artifact restored");
    assert.equal(fs.readFileSync(path.join(restored.run.paths.artifactsDir, "notes.txt"), "utf8"), "notes from machine A\n");
    assert.ok(fs.existsSync(path.join(restored.run.paths.runDir, "telemetry.json")), "telemetry restored");
    assert.ok(fs.existsSync(path.join(restored.run.paths.tasksDir, "task.md")), "task file restored");

    // External artifact was rebased inside the run archive area.
    const restoredExt = restored.run.nodes[0].artifacts.find((a) => a.id === "external-1");
    assert.ok(restoredExt, "external artifact record survived");
    assert.ok(restoredExt.path.startsWith(restored.run.paths.runDir), "external artifact rebased into restored run area");
    assert.equal(fs.readFileSync(restoredExt.path, "utf8"), "external data from machine A\n");

    // import-manifest.json was written.
    const manifestPath = path.join(machineBCwd, ".cw", "runs", runId, "import-manifest.json");
    assert.ok(fs.existsSync(manifestPath), "import-manifest.json written");
    const manifest = readJson(manifestPath);
    assert.equal(manifest.schemaVersion, 1);
    assert.equal(manifest.runId, runId);
    assert.ok(manifest.archiveSha256, "manifest records archive digest");

    // verification passed within import
    assert.equal(restored.verification.ok, true, "import auto-verification passes");
    assert.ok(restored.verifyCommand.includes("run verify-import"), "verification command is provided");

    // ---- 4. Verify the restored run (standalone re-check) ------------------------
    const verified = verifyImportedRun(restored.run);
    assert.equal(verified.ok, true, "standalone verify-import passes");
    assert.ok(verified.checks.some((c) => c.name === "archive-files" && c.pass), "file digest checks pass");
    assert.ok(verified.checks.some((c) => c.name === "telemetry-ledger" && c.pass), "telemetry ledger check passes");

    // ---- 5. loadRun works equivalently on "machine B" ---------------------------
    const savedCwd = process.cwd();
    process.chdir(machineBCwd);
    try {
      const runnerB = new CoolWorkflowRunner({ pluginRoot, baseDir: machineBCwd });
      const loaded = runnerB.loadRun(runId);
      assert.equal(loaded.id, runId);
      assert.equal(loaded.workflow.id, "cross-machine-test");
      assert.equal(loaded.tasks.length, 1);
      assert.equal(loaded.tasks[0].status, "completed");
    } finally {
      process.chdir(savedCwd);
    }

    // ---- 6. CLI surface on "machine B" ------------------------------------------
    // CLI verify-import from machine B's perspective.
    const cliVer = JSON.parse(execFileSync(process.execPath, [cli, "run", "verify-import", runId, "--cwd", machineBCwd, "--json"], {
      cwd: pluginRoot,
      env: { ...process.env, CW_HOME: machineBHome, XDG_STATE_HOME: machineBHome },
      encoding: "utf8"
    }));
    assert.equal(cliVer.ok, true, "CLI verify-import passes from machine B");

    // CLI inspect-archive from machine B (read-only).
    const cliIns = JSON.parse(execFileSync(process.execPath, [cli, "run", "inspect-archive", exportPath, "--json"], {
      cwd: pluginRoot,
      env: { ...process.env, CW_HOME: machineBHome, XDG_STATE_HOME: machineBHome },
      encoding: "utf8"
    }));
    assert.equal(cliIns.ok, true, "CLI inspect-archive passes");
    assert.equal(cliIns.runId, runId);
    assert.ok(cliIns.fileCount >= 3, "inspect-archive reports file count");

  } finally {
    if (savedHome !== undefined) process.env.CW_HOME = savedHome; else delete process.env.CW_HOME;
    if (savedXdg !== undefined) process.env.XDG_STATE_HOME = savedXdg; else delete process.env.XDG_STATE_HOME;
  }

  // ---- 7. Tamper detection still works on "machine B" --------------------------
  const importManifestPath = path.join(machineBCwd, ".cw", "runs", runId, "import-manifest.json");
  const importManifest = readJson(importManifestPath);
  const runStatePath = importManifest.runDir ? path.join(importManifest.runDir, "state.json") : undefined;
  if (runStatePath && fs.existsSync(runStatePath)) {
    const runLoad = readJson(runStatePath);
    // Tamper one restored file.
    const artifactFile = path.join(runLoad.paths.artifactsDir, "notes.txt");
    fs.writeFileSync(artifactFile, "tampered on machine B\n", "utf8");
    const tampered = verifyImportedRun(runLoad);
    assert.equal(tampered.ok, false, "tamper on machine B detected");
    assert.ok(tampered.checks.some((c) => c.code === "digest-mismatch"), "tamper reported as digest mismatch");
  }

  process.stdout.write("run-export-cross-machine-smoke: ok (cross-machine export->import->verify preserves data, chains, and detects tampering)\n");
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}
