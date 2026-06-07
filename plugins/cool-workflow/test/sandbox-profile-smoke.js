#!/usr/bin/env node
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const { createRunPaths, ensureRunDirs, loadRunFromCwd, saveCheckpoint } = require("../dist/state");
const {
  validateSandboxCommand,
  validateSandboxNetwork,
  validateSandboxProfileFile
} = require("../dist/sandbox-profile");

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cw-sandbox-profile-"));
const cli = path.join(__dirname, "../dist/cli.js");
const paths = createRunPaths(path.join(tmp, ".cw", "runs", "sandbox-smoke"));
ensureRunDirs(paths);

const taskPath = path.join(paths.tasksDir, "sandbox.md");
fs.writeFileSync(taskPath, "check sandbox profiles\n", "utf8");

const run = {
  schemaVersion: 1,
  id: "sandbox-smoke",
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  cwd: tmp,
  workflow: {
    id: "sandbox-smoke",
    title: "Sandbox Smoke",
    summary: "",
    limits: { maxAgents: 2, maxConcurrentAgents: 1 }
  },
  inputs: {},
  loopStage: "interpret",
  phases: [{ id: "map", name: "Map", status: "pending", taskIds: ["map:sandbox"] }],
  tasks: [
    {
      id: "map:sandbox",
      kind: "agent",
      phase: "Map",
      status: "pending",
      requiresEvidence: false,
      prompt: "Map sandbox boundaries.",
      taskPath,
      resultPath: "",
      loopStage: "interpret",
      stateNodeId: "sandbox-smoke:task:map:sandbox"
    }
  ],
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

const list = JSON.parse(execFileSync("node", [cli, "sandbox", "list"], { cwd: tmp, encoding: "utf8" }));
assert.deepEqual(list.map((profile) => profile.id), ["default", "readonly", "workspace-write", "locked-down"]);

const lockedDown = JSON.parse(execFileSync("node", [cli, "sandbox", "show", "locked-down"], { cwd: tmp, encoding: "utf8" }));
assert.equal(lockedDown.id, "locked-down");
assert.equal(lockedDown.network.mode, "none");
assert.ok(lockedDown.enforcement.enforcedByCW.length > 0);
assert.ok(lockedDown.enforcement.hostRequired.some((entry) => /network/.test(entry)));
assert.equal(validateSandboxCommand(lockedDown, "npm").code, "sandbox-command-denied");
assert.equal(validateSandboxNetwork(lockedDown, "example.com").code, "sandbox-network-denied");

const validProfilePath = path.join(tmp, "site-profile.json");
fs.writeFileSync(
  validProfilePath,
  JSON.stringify(
    {
      schemaVersion: 1,
      id: "site-readonly",
      title: "Site Readonly",
      readPaths: ["$cwd"],
      writePaths: ["out"],
      workerOutput: { result: true, artifacts: true, logs: true },
      execute: { mode: "none" },
      network: { mode: "none" },
      env: { inherit: false, expose: ["PATH"] }
    },
    null,
    2
  ),
  "utf8"
);
const validProfile = JSON.parse(execFileSync("node", [cli, "sandbox", "validate", validProfilePath], { cwd: tmp, encoding: "utf8" }));
assert.equal(validProfile.valid, true);
assert.equal(validProfile.profile.id, "site-readonly");

const invalidProfilePath = path.join(tmp, "invalid-profile.json");
fs.writeFileSync(
  invalidProfilePath,
  JSON.stringify({ schemaVersion: 1, id: "bad", title: "Bad", readPaths: ["../secret"], writePaths: [] }),
  "utf8"
);
const invalidProfile = validateSandboxProfileFile(invalidProfilePath, { cwd: tmp });
assert.equal(invalidProfile.valid, false);
assert.equal(invalidProfile.issues[0].code, "sandbox-profile-invalid");

const dispatch = JSON.parse(
  execFileSync("node", [cli, "dispatch", "sandbox-smoke", "--limit", "1", "--sandbox", "readonly"], {
    cwd: tmp,
    encoding: "utf8"
  })
);
assert.equal(dispatch.sandboxProfileId, "readonly");
assert.equal(dispatch.tasks.length, 1);
assert.equal(dispatch.tasks[0].sandboxProfileId, "readonly");
assert.equal(dispatch.tasks[0].sandboxPolicy.id, "readonly");

const workerId = dispatch.tasks[0].workerId;
const manifest = JSON.parse(execFileSync("node", [cli, "worker", "manifest", "sandbox-smoke", workerId], { cwd: tmp, encoding: "utf8" }));
assert.equal(manifest.sandboxProfileId, "readonly");
assert.equal(manifest.sandbox.profileId, "readonly");
assert.ok(manifest.sandbox.policy.readPaths.includes(tmp));
assert.ok(manifest.sandbox.enforcedByCW.some((entry) => /result acceptance/.test(entry)));
assert.ok(manifest.sandbox.hostRequired.some((entry) => /OS-level write/.test(entry)));
assert.ok(manifest.allowedPaths.includes(manifest.resultPath));
assert.ok(manifest.allowedPaths.includes(manifest.artifactsDir));
assert.ok(manifest.allowedPaths.includes(manifest.logsDir));

let denied = null;
try {
  execFileSync("node", [cli, "worker", "output", "sandbox-smoke", workerId, path.join(tmp, "outside.md")], {
    cwd: tmp,
    encoding: "utf8",
    stdio: "pipe"
  });
} catch (error) {
  denied = error;
}
assert.ok(denied);

const afterDenied = loadRunFromCwd("sandbox-smoke", tmp);
assert.equal(afterDenied.workers[0].status, "rejected");
assert.equal(afterDenied.feedback.length, 1);
assert.equal(afterDenied.feedback[0].code, "sandbox-write-denied");
assert.equal(afterDenied.feedback[0].classification, "sandbox-policy");
assert.equal(afterDenied.sandboxProfiles[0].id, "readonly");

process.stdout.write("sandbox-profile-smoke: ok\n");
