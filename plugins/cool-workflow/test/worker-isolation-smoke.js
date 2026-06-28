#!/usr/bin/env node
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const { createDispatchManifest } = require("../dist/dispatch");
const { createRunPaths, ensureRunDirs, loadRunFromCwd, saveCheckpoint } = require("../dist/state");
const { workerTrustAudit } = require("../dist/trust-audit");
const {
  allocateWorkerScope,
  getWorkerScope,
  listWorkerScopes,
  recordWorkerFailure,
  recordWorkerOutput,
  summarizeWorkers,
  validateWorkerBoundary,
  writeWorkerManifest
} = require("../dist/worker-isolation");

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cw-worker-isolation-"));
const paths = createRunPaths(path.join(tmp, ".cw", "runs", "worker-smoke"));
ensureRunDirs(paths);

const taskPath = path.join(paths.tasksDir, "map.md");
fs.writeFileSync(taskPath, "map the system\n", "utf8");

const run = {
  schemaVersion: 1,
  id: "worker-smoke",
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  cwd: tmp,
  workflow: {
    id: "worker-smoke",
    title: "Worker Smoke",
    summary: "",
    limits: { maxAgents: 2, maxConcurrentAgents: 2 }
  },
  inputs: {},
  loopStage: "interpret",
  phases: [{ id: "map", name: "Map", status: "pending", taskIds: ["map:system", "map:other"] }],
  tasks: [
    {
      id: "map:system",
      kind: "agent",
      phase: "Map",
      status: "pending",
      requiresEvidence: false,
      prompt: "Map system boundaries.",
      taskPath,
      resultPath: "",
      loopStage: "interpret",
      stateNodeId: "worker-smoke:task:map:system"
    },
    {
      id: "map:other",
      kind: "agent",
      phase: "Map",
      status: "pending",
      requiresEvidence: false,
      prompt: "Map other boundaries.",
      taskPath,
      resultPath: "",
      loopStage: "interpret",
      stateNodeId: "worker-smoke:task:map:other"
    }
  ],
  dispatches: [],
  commits: [],
  paths,
  nodes: [],
  contracts: [],
  feedback: [],
  workers: []
};
saveCheckpoint(run);

const manual = allocateWorkerScope(run, run.tasks[0], { workerId: "worker-map-system", persist: false });
assert.equal(manual.status, "allocated");
assert.ok(fs.existsSync(path.join(manual.workerDir, "worker.json")));
assert.ok(fs.existsSync(path.join(manual.workerDir, "manifest.json")));
assert.ok(fs.existsSync(manual.inputPath));
assert.ok(fs.existsSync(manual.artifactsDir));
assert.ok(fs.existsSync(manual.logsDir));
const manualScopePath = path.join(manual.workerDir, "worker.json");
const seededScope = JSON.parse(fs.readFileSync(manualScopePath, "utf8"));
seededScope.metadata = { ...(seededScope.metadata || {}), scopeOnlySentinel: "must-survive-manifest-rewrite" };
seededScope.retryCount = 7;
fs.writeFileSync(manualScopePath, `${JSON.stringify(seededScope, null, 2)}\n`, "utf8");
const manifest = writeWorkerManifest(run, manual);
assert.equal(manifest.id, manual.id);
assert.equal(manifest.manifestPath, path.join(manual.workerDir, "manifest.json"));
assert.equal(manifest.scopePath, path.join(manual.workerDir, "worker.json"));
const persistedScope = JSON.parse(fs.readFileSync(manualScopePath, "utf8"));
assert.equal(persistedScope.metadata.scopeOnlySentinel, "must-survive-manifest-rewrite", "manifest write must not overwrite worker scope state");
assert.equal(persistedScope.retryCount, 7, "scope-only retry state survives manifest rewrite");
const persistedManifest = JSON.parse(fs.readFileSync(path.join(manual.workerDir, "manifest.json"), "utf8"));
assert.equal(persistedManifest.id, manual.id);
assert.equal(persistedManifest.manifestPath, path.join(manual.workerDir, "manifest.json"));
assert.equal(getWorkerScope(run, manual.id).id, manual.id);
assert.equal(listWorkerScopes(run).length, 1);

assert.equal(validateWorkerBoundary(run, manual.id, { path: manual.resultPath }), null);
assert.equal(validateWorkerBoundary(run, manual.id, { path: path.join(manual.artifactsDir, "notes.md") }), null);
assert.match(validateWorkerBoundary(run, manual.id, { path: path.join(tmp, "outside.md") }).message, /outside/);

fs.writeFileSync(
  manual.resultPath,
  [
    "# Result",
    "",
    "Mapped the system.",
    "",
    "```cw:result",
    '{ "summary": "mapped", "findings": [], "evidence": ["test/worker-isolation-smoke.js:1"] }',
    "```",
    ""
  ].join("\n"),
  "utf8"
);
const output = recordWorkerOutput(run, manual.id, manual.resultPath, { persist: false });
assert.equal(output.workerId, manual.id);
assert.equal(run.tasks[0].status, "completed");
assert.equal(getWorkerScope(run, manual.id).status, "verified");
// Sandbox boundary audit: a successful write-path check must record that
// command/network limits are delegated to the host.
const workerEvents = workerTrustAudit(run, manual.id);
const boundaryEvent = workerEvents.events.find((e) => e.kind === "worker.sandbox-boundary");
assert.ok(boundaryEvent, "a worker.sandbox-boundary audit event must be recorded");
assert.equal(boundaryEvent.decision, "allowed");
assert.equal(boundaryEvent.source, "cw-validated");
assert.ok(boundaryEvent.metadata, "boundary event must carry metadata");
assert.ok(boundaryEvent.metadata.enforced_by_cw, "metadata must show what CW enforced");
assert.ok(boundaryEvent.metadata.delegated_to_host, "metadata must show what was delegated to host");

const dispatch = createDispatchManifest(run, 1);
assert.equal(dispatch.tasks.length, 1);
assert.equal(dispatch.tasks[0].id, "map:other");
assert.ok(dispatch.tasks[0].workerId);
assert.ok(dispatch.tasks[0].workerManifestPath);
assert.ok(fs.existsSync(dispatch.tasks[0].workerManifestPath));
assert.equal(path.basename(dispatch.tasks[0].workerManifestPath), "manifest.json");

const dispatchedWorker = dispatch.tasks[0].workerId;
const failed = recordWorkerFailure(run, dispatchedWorker, "worker failed", { persist: false });
assert.equal(failed.status, "failed");
assert.equal(failed.feedbackIds.length, 1);
assert.equal(run.feedback.length, 1);

const summary = summarizeWorkers(run);
assert.equal(summary.total, 2);
assert.equal(summary.byStatus.verified, 1);
assert.equal(summary.byStatus.failed, 1);
saveCheckpoint(run);

const loaded = loadRunFromCwd("worker-smoke", tmp);
assert.equal(loaded.paths.workersDir, paths.workersDir);
assert.equal(loaded.workers.length, 2);

const cliList = JSON.parse(execFileSync("node", [path.join(__dirname, "../dist/cli.js"), "worker", "list", "worker-smoke"], {
  cwd: tmp,
  encoding: "utf8"
}));
assert.equal(cliList.length, 2);

const cliShow = JSON.parse(execFileSync("node", [path.join(__dirname, "../dist/cli.js"), "worker", "show", "worker-smoke", manual.id], {
  cwd: tmp,
  encoding: "utf8"
}));
assert.equal(cliShow.id, manual.id);

const cliManifest = JSON.parse(execFileSync("node", [path.join(__dirname, "../dist/cli.js"), "worker", "manifest", "worker-smoke", manual.id], {
  cwd: tmp,
  encoding: "utf8"
}));
assert.equal(cliManifest.id, manual.id);

const cliValidate = execFileSync("node", [path.join(__dirname, "../dist/cli.js"), "worker", "validate", "worker-smoke", manual.id, manual.resultPath], {
  cwd: tmp,
  encoding: "utf8"
}).trim();
assert.equal(cliValidate, "null");

// `cw worker` is dispatched into src/cli/handlers/worker.ts — a bare verb (no
// subcommand) fails closed with the carved handler's usage string.
let workerUsageErr = "";
try {
  execFileSync("node", [path.join(__dirname, "../dist/cli.js"), "worker"], { cwd: tmp, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  assert.fail("bare `cw worker` should exit non-zero");
} catch (e) {
  workerUsageErr = String(e.stderr || "");
}
assert.match(workerUsageErr, /worker list\|summary\|show\|manifest/, "cw worker routes through the carved handler");

const nodeList = JSON.parse(execFileSync("node", [path.join(__dirname, "../dist/cli.js"), "node", "list", "worker-smoke"], {
  cwd: tmp,
  encoding: "utf8"
}));
assert.ok(nodeList.some((node) => node.id === output.stateNodeId));

const feedbackList = JSON.parse(execFileSync("node", [path.join(__dirname, "../dist/cli.js"), "feedback", "list", "worker-smoke"], {
  cwd: tmp,
  encoding: "utf8"
}));
assert.equal(feedbackList.length, 1);

process.stdout.write("worker-isolation-smoke: ok\n");
