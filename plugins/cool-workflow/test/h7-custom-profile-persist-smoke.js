#!/usr/bin/env node
// H7 regression: a custom sandbox profile loaded from a FILE at dispatch must
// PERSIST as a DEFINITION on run.customSandboxProfiles, so that after a worker
// scope snapshot is lost the boundary can RE-RESOLVE the policy by its LOGICAL id
// (e.g. "h7-custom") against the WORKER context — re-enforcing the SAME policy
// instead of throwing not-found.
//
// Before the fix: re-resolution by logical id fell back to bundled-only lookup and
// threw sandbox-profile-not-found (fail-closed but unable to re-enforce). It also
// risked re-resolving against dispatch-time paths and falsely denying a legit
// worker write — the test pins worker-path re-binding via $workerDir tokens.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { createDispatchManifest } = require("../dist/dispatch");
const { createRunPaths, ensureRunDirs, saveCheckpoint } = require("../dist/state");
const { getWorkerScope, validateWorkerBoundary } = require("../dist/worker-isolation");
const { resolveSandboxProfileById, sandboxContextForRun, SandboxProfileError } = require("../dist/sandbox-profile");

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cw-h7-custom-profile-"));
const paths = createRunPaths(path.join(tmp, ".cw", "runs", "h7-smoke"));
ensureRunDirs(paths);

const taskPath = path.join(paths.tasksDir, "h7.md");
fs.writeFileSync(taskPath, "exercise custom profile persistence\n", "utf8");

// A CUSTOM profile loaded from a FILE. writePaths uses the worker-specific
// $workerDir token: re-resolution MUST bind it to the actual worker's dir, not the
// validation/dispatch-time placeholder dir, or a legit worker write is falsely denied.
const CUSTOM_ID = "h7-custom";
const profileFile = path.join(tmp, "h7-custom.json");
fs.writeFileSync(
  profileFile,
  JSON.stringify(
    {
      schemaVersion: 1,
      id: CUSTOM_ID,
      title: "H7 Custom Worker Boundary",
      readPaths: ["$cwd", "$workerDir"],
      writePaths: ["$workerDir"],
      workerOutput: { result: true, artifacts: true, logs: true },
      execute: { mode: "none" },
      network: { mode: "none" },
      env: { inherit: false, expose: [] }
    },
    null,
    2
  ),
  "utf8"
);

const run = {
  schemaVersion: 1,
  id: "h7-smoke",
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  cwd: tmp,
  workflow: { id: "h7-smoke", title: "H7 Smoke", summary: "", limits: { maxAgents: 1, maxConcurrentAgents: 1 } },
  inputs: {},
  loopStage: "interpret",
  phases: [{ id: "map", name: "Map", status: "pending", taskIds: ["map:h7"] }],
  tasks: [
    {
      id: "map:h7",
      kind: "agent",
      phase: "Map",
      status: "pending",
      requiresEvidence: false,
      prompt: "Exercise the custom sandbox profile.",
      taskPath,
      resultPath: "",
      loopStage: "interpret",
      stateNodeId: "h7-smoke:task:map:h7"
    }
  ],
  dispatches: [],
  commits: [],
  paths,
  nodes: [],
  contracts: [],
  feedback: [],
  workers: [],
  sandboxProfiles: []
};
saveCheckpoint(run);

// --- Dispatch with the custom profile FILE -------------------------------------
const manifest = createDispatchManifest(run, 1, { sandbox: profileFile });
assert.equal(manifest.tasks.length, 1, "one task dispatched");

// (1) The custom DEFINITION persists on the run, keyed by its LOGICAL id.
assert.ok(run.customSandboxProfiles, "run.customSandboxProfiles is populated");
assert.ok(run.customSandboxProfiles[CUSTOM_ID], "custom profile persisted by logical id");
assert.equal(run.customSandboxProfiles[CUSTOM_ID].id, CUSTOM_ID);
assert.deepEqual(
  run.customSandboxProfiles[CUSTOM_ID].writePaths,
  ["$workerDir"],
  "the raw DEFINITION (path tokens intact) is stored, not a resolved policy"
);

const workerId = manifest.tasks[0].workerId;
assert.ok(workerId, "worker allocated");
const scope = getWorkerScope(run, workerId);
assert.ok(scope, "worker scope exists");
// The worker scope re-resolves the custom profile by its LOGICAL id (file path is
// transient): scope.sandboxProfileId carries the logical id, which is what a later
// re-resolve after snapshot loss will key on.
assert.equal(scope.sandboxProfileId, CUSTOM_ID, "scope carries the logical custom id, not the file path");

// A path inside the worker's $workerDir — must be writable under the policy.
const allowedWrite = path.join(scope.workerDir, "out", "report.md");
// A path OUTSIDE the policy — must stay denied even after re-resolution.
const deniedWrite = path.join(tmp, "outside", "escape.md");

// Sanity: with the snapshot present, the boundary enforces correctly.
assert.equal(validateWorkerBoundary(run, workerId, { path: allowedWrite }), null, "in-policy write allowed (snapshot present)");
const preLossDenied = validateWorkerBoundary(run, workerId, { path: deniedWrite });
assert.ok(preLossDenied && preLossDenied.code === "sandbox-write-denied", "out-of-policy write denied (snapshot present)");

// --- Simulate snapshot loss: clear scope.sandboxPolicy --------------------------
// This forces sandboxPolicyForBoundary to RE-RESOLVE by logical id instead of
// returning the cached policy. For a custom profile this is exactly the H7 hole.
// Clear it on the live in-memory scope (what validateWorkerBoundary reads) AND on
// disk, so neither path can restore the lost snapshot.
delete scope.sandboxPolicy;
const scopeFile = path.join(scope.workerDir, "worker.json");
const onDisk = JSON.parse(fs.readFileSync(scopeFile, "utf8"));
delete onDisk.sandboxPolicy;
fs.writeFileSync(scopeFile, `${JSON.stringify(onDisk, null, 2)}\n`, "utf8");
const afterLoss = getWorkerScope(run, workerId);
assert.equal(afterLoss.sandboxPolicy, undefined, "snapshot cleared");

// (2) The boundary RE-RESOLVES the custom policy by logical id and ENFORCES it
// (does NOT throw not-found). Re-resolution binds $workerDir to THIS worker's dir,
// so the legitimate in-policy write is still allowed.
let reResolved;
assert.doesNotThrow(() => {
  reResolved = validateWorkerBoundary(run, workerId, { path: allowedWrite });
}, "re-resolution must NOT throw after snapshot loss");
assert.equal(reResolved, null, "in-policy worker write re-resolves to ALLOWED (worker paths, not dispatch paths)");

// And the out-of-policy write is still denied after re-resolution (fail-closed kept).
const reDenied = validateWorkerBoundary(run, workerId, { path: deniedWrite });
assert.ok(reDenied && reDenied.code === "sandbox-write-denied", "out-of-policy write still denied after re-resolution");

// (3) The run context threads the persisted custom DEFINITIONS so a re-resolve by
// logical id can find them. A KNOWN custom id re-resolves cleanly; an UNKNOWN id
// still fails closed (not silently allowed).
const runCtx = sandboxContextForRun(run);
assert.ok(runCtx.customProfiles && runCtx.customProfiles[CUSTOM_ID], "run context threads persisted custom profiles");

// Known custom id re-resolves by logical id. Because this profile references the
// worker-specific $workerDir token, supply the WORKER's paths in the context — the
// same way sandboxPolicyForBoundary does — so tokens bind to the real worker dir.
const workerCtx = {
  ...runCtx,
  workerDir: scope.workerDir,
  inputPath: scope.inputPath,
  resultPath: scope.resultPath,
  artifactsDir: scope.artifactsDir,
  logsDir: scope.logsDir
};
const reResolvedById = resolveSandboxProfileById(CUSTOM_ID, workerCtx);
assert.equal(reResolvedById.id, CUSTOM_ID, "known custom id re-resolves by logical id");
assert.ok(
  reResolvedById.writePaths.includes(scope.workerDir),
  "re-resolved write path binds to the WORKER dir (worker paths, not dispatch paths)"
);

// Unknown id is not in customProfiles and is not bundled / not a file ⇒ fail closed.
assert.throws(
  () => resolveSandboxProfileById("h7-unknown-profile", workerCtx),
  (error) => error instanceof SandboxProfileError && error.code === "sandbox-profile-not-found",
  "unknown custom id fails closed (sandbox-profile-not-found)"
);

// H7 hardening: a custom FILE that reuses a BUNDLED id must be REJECTED — else it
// would be silently shadowed by the WIDER bundled policy on a snapshot-loss
// re-resolve (bundled-first ordering), widening the sandbox with no error.
const collidingFile = path.join(tmp, "h7-colliding.json");
fs.writeFileSync(
  collidingFile,
  JSON.stringify({ schemaVersion: 1, id: "default", title: "colliding", writePaths: [], network: "none", execute: "none" }),
  "utf8"
);
assert.throws(
  () => resolveSandboxProfileById(collidingFile, workerCtx),
  (error) => error instanceof SandboxProfileError && error.code === "sandbox-profile-invalid",
  "a custom profile reusing a bundled id is rejected, never silently shadowed"
);

console.log("h7-custom-profile-persist-smoke: ok");
