#!/usr/bin/env node
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const pluginRoot = path.resolve(__dirname, "..");
const cli = path.join(pluginRoot, "dist/cli.js");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cw-workflow-app-framework-"));

function execOptions(cwd, env) {
  const options = { cwd, encoding: "utf8" };
  if (env) options.env = { ...process.env, ...env };
  return options;
}

function run(args, cwd = pluginRoot, env) {
  return JSON.parse(execFileSync("node", [cli, ...args], execOptions(cwd, env)));
}

function runText(args, cwd = pluginRoot) {
  return execFileSync("node", [cli, ...args], { cwd, encoding: "utf8" });
}

function runInvalid(args, cwd = pluginRoot, env) {
  try {
    execFileSync("node", [cli, ...args], { ...execOptions(cwd, env), stdio: "pipe" });
  } catch (error) {
    return {
      stdout: String(error.stdout || ""),
      stderr: String(error.stderr || "")
    };
  }
  assert.fail(`Expected command to fail: ${args.join(" ")}`);
}

const workflowList = run(["list"]);
assert.ok(workflowList.some((entry) => entry.id === "architecture-review"));
assert.ok(workflowList.some((entry) => entry.id === "architecture-review-fast"));
assert.ok(workflowList.some((entry) => entry.id === "legacy-architecture-review"));
assert.ok(workflowList.some((entry) => entry.id === "workflow-app-framework-demo"));

const canonicalResearchPlan = run([
  "plan",
  "research-synthesis",
  "--cwd",
  tmp,
  "--question",
  "Do canonical workflow apps still plan?",
  "--source",
  "local docs"
]);
assert.equal(canonicalResearchPlan.workflowId, "research-synthesis");
// REAL-GAP (v2): this smoke is pure-CLI (no flat-dist requires to repoint), so the
// failure already lands on genuine v2 behavior. v2's `cw plan --json` payload drops
// the canonical `pendingTasks` key and emits `taskCount` instead (plus an
// unspecified `schemaVersion: 1`). Old build + v2 SPEC both mandate `pendingTasks`:
//   - old: src/capability-core.ts:79 `pendingTasks: run.tasks.filter(pending).length`
//   - SPEC: plugins/cool-workflow/project/docs/rebuild/SPEC/workflow-apps.md:62 and :163 ("pendingTasks": 14)
//   - v2 defect: src/shell/pipeline-cli.ts:74 returns `taskCount: run.tasks.length`
// Conformance is 101/101 but no case covers the plan --json key, so it slipped through.
// Left failing on purpose (do NOT weaken): reports the gap for Phase B to fix in v2.
assert.equal(canonicalResearchPlan.pendingTasks, 6);
const canonicalResearchState = JSON.parse(fs.readFileSync(canonicalResearchPlan.statePath, "utf8"));
assert.equal(canonicalResearchState.workflow.app.id, "research-synthesis");
assert.equal(canonicalResearchState.workflow.app.version, "0.2.6");

const legacyPlan = run([
  "plan",
  "legacy-research-synthesis",
  "--repo",
  tmp,
  "--question",
  "Do legacy workflow files still plan?"
]);
// REAL-GAP (v2, secondary): `cw list` shows `legacy-research-synthesis` (a
// compatibility workflow-file wrapper), but `cw plan legacy-research-synthesis`
// dies with "Workflow app not found". v2's planRun calls loadWorkflowApp(appId)
// (src/shell/pipeline-cli.ts:72) which cannot resolve the legacy workflow-file
// wrapper that the list surface CAN resolve. Old build could plan it. Left
// failing on purpose; reports the gap for Phase B.
assert.equal(legacyPlan.workflowId, "legacy-research-synthesis");
assert.equal(legacyPlan.pendingTasks, 5);

const appList = run(["app", "list"]);
const demoSummary = appList.find((entry) => entry.id === "workflow-app-framework-demo");
assert.ok(demoSummary);
assert.equal(demoSummary.version, "0.1.0");
assert.equal(demoSummary.legacy, false);
assert.deepEqual(demoSummary.sandboxProfiles, ["readonly", "workspace-write"]);

const demoShow = run(["app", "show", "workflow-app-framework-demo"]);
assert.equal(demoShow.app.version, "0.1.0");
assert.equal(demoShow.workflow.phases[2].tasks[0].requiresEvidence, true);
assert.equal(demoShow.workflow.phases[1].tasks[0].sandboxProfileId, "workspace-write");

const demoValidate = run(["app", "validate", path.join(pluginRoot, "apps/workflow-app-framework-demo/app.json")]);
assert.equal(demoValidate.valid, true);
assert.equal(demoValidate.summary.id, "workflow-app-framework-demo");

const generatedDir = path.join(tmp, "generated-app");
const generated = run([
  "app",
  "init",
  "smoke-sdk-app",
  "--title",
  "Smoke Framework App",
  "--directory",
  generatedDir
]);
assert.equal(generated.id, "smoke-sdk-app");
assert.ok(fs.existsSync(generated.manifestPath));
assert.ok(fs.existsSync(generated.entrypointPath));
// `app init --directory` can point anywhere outside CW's trusted app roots
// (that is the flag's whole purpose), and `initWorkflowApp`'s OWN internal
// self-check already validated this exact manifest at creation time
// (validateGeneratedManifest, gate-free — see workflow-app-loader.ts) — but a
// SEPARATE, later `cw app validate <path>` call is a fresh process with no
// memory of who wrote that file, so it is indistinguishable from "someone
// handed me a suspicious app" and correctly requires the same explicit
// opt-in an external app would (architecture-review P1 fix).
assert.equal(run(["app", "validate", generated.manifestPath], pluginRoot, { CW_ALLOW_EXTERNAL_APP_CODE: "1" }).valid, true);

const packagePath = path.join(tmp, "workflow-app-framework-demo.cwapp.json");
const packaged = run(["app", "package", "workflow-app-framework-demo", "--output", packagePath]);
assert.equal(packaged.id, "workflow-app-framework-demo");
assert.ok(fs.existsSync(packagePath));

const duplicateDir = path.join(tmp, "duplicate-task-app");
fs.mkdirSync(duplicateDir, { recursive: true });
fs.writeFileSync(
  path.join(duplicateDir, "app.json"),
  JSON.stringify(
    {
      schemaVersion: 1,
      id: "duplicate-task-app",
      title: "Duplicate Task App",
      summary: "Invalid duplicate task app.",
      version: "0.1.0",
      inputs: [{ name: "question", type: "string", required: true }],
      sandboxProfiles: ["readonly"],
      workflow: { entrypoint: "workflow.js" }
    },
    null,
    2
  ),
  "utf8"
);
fs.writeFileSync(
  path.join(duplicateDir, "workflow.js"),
  `module.exports = ({ workflow, phase, agent, input }) => {
  const inputs = [input("question", { type: "string", required: true })];
  return workflow({
    id: "duplicate-task-app",
    title: "Duplicate Task App",
    summary: "Invalid duplicate task app.",
    limits: { maxAgents: 4, maxConcurrentAgents: 2 },
    inputs,
    sandboxProfiles: ["readonly"],
    phases: [
      phase("One", [
        agent("dup:task", "first", { sandboxProfileId: "readonly" }),
        agent("dup:task", "second", { sandboxProfileId: "readonly" })
      ])
    ]
  });
};\n`,
  "utf8"
);
// This fixture lives under a plain tmpdir (untrusted source) and exercises
// SCHEMA validation (duplicate task ids), not the trust-boundary gate itself
// — opt in so the schema check actually runs (architecture-review P1 fix).
const duplicateValidation = JSON.parse(
  runInvalid(["app", "validate", path.join(duplicateDir, "app.json")], pluginRoot, { CW_ALLOW_EXTERNAL_APP_CODE: "1" }).stdout
);
assert.equal(duplicateValidation.valid, false);
assert.ok(duplicateValidation.issues.some((entry) => entry.code === "workflow-task-duplicate"));

const missingDir = path.join(tmp, "missing-fields-app");
fs.mkdirSync(missingDir, { recursive: true });
fs.writeFileSync(
  path.join(missingDir, "app.json"),
  JSON.stringify({ schemaVersion: 1, id: "missing-fields-app", workflow: { entrypoint: "workflow.js" } }, null, 2),
  "utf8"
);
// Same reasoning as duplicateValidation above: untrusted-tmpdir fixture,
// opt in so the missing-fields schema check runs instead of the gate.
const missingValidation = JSON.parse(
  runInvalid(["app", "validate", path.join(missingDir, "app.json")], pluginRoot, { CW_ALLOW_EXTERNAL_APP_CODE: "1" }).stdout
);
assert.equal(missingValidation.valid, false);
assert.ok(missingValidation.issues.some((entry) => entry.code === "workflow-app-title"));
assert.ok(missingValidation.issues.some((entry) => entry.code === "workflow-app-version"));

const appPlan = run([
  "plan",
  "workflow-app-framework-demo",
  "--repo",
  tmp,
  "--question",
  "Record app metadata"
]);
const appState = JSON.parse(fs.readFileSync(appPlan.statePath, "utf8"));
assert.equal(appState.workflow.app.id, "workflow-app-framework-demo");
assert.equal(appState.workflow.app.version, "0.1.0");
assert.match(fs.readFileSync(appPlan.reportPath, "utf8"), /Workflow App: workflow-app-framework-demo@0\.1\.0/);

const dispatch = run(["dispatch", appPlan.runId, "--limit", "1"], tmp);
assert.equal(dispatch.tasks.length, 1);
assert.equal(dispatch.tasks[0].sandboxProfileId, "readonly");

const reportPath = runText(["report", appPlan.runId], tmp).trim();
assert.equal(reportPath, appPlan.reportPath);

// --- architecture-review P1 fix: untrusted external app source is fail-closed ---

const externalAppDir = fs.mkdtempSync(path.join(os.tmpdir(), "cw-external-app-"));
const externalMarker = path.join(externalAppDir, "executed.marker");
fs.writeFileSync(
  path.join(externalAppDir, "app.json"),
  JSON.stringify(
    {
      schemaVersion: 1,
      id: "external-fixture-app",
      title: "External Fixture App",
      summary: "Fixture living outside every CW-trusted app root.",
      version: "0.1.0",
      inputs: [],
      sandboxProfiles: ["readonly"],
      compatibility: { minVersion: "0.1.9" },
      workflow: { entrypoint: "workflow.js" }
    },
    null,
    2
  ),
  "utf8"
);
fs.writeFileSync(
  path.join(externalAppDir, "workflow.js"),
  `require("node:fs").writeFileSync(${JSON.stringify(externalMarker)}, "executed\\n");
module.exports = ({ workflow, phase, artifact }) => workflow({
  id: "external-fixture-app",
  title: "External Fixture App",
  summary: "Fixture living outside every CW-trusted app root.",
  limits: { maxAgents: 1, maxConcurrentAgents: 1 },
  inputs: [],
  sandboxProfiles: ["readonly"],
  phases: [phase("Only", [artifact("only:report", "Report.", { sandboxProfileId: "readonly" })])]
});
`,
  "utf8"
);
const externalManifestPath = path.join(externalAppDir, "app.json");

const blockedValidation = JSON.parse(runInvalid(["app", "validate", externalManifestPath]).stdout);
assert.equal(blockedValidation.valid, false);
assert.ok(blockedValidation.issues.some((entry) => entry.code === "workflow-app-untrusted-source"));
assert.ok(!fs.existsSync(externalMarker), "workflow.js must not execute when its source is untrusted and unauthorized");

const allowedValidation = run(["app", "validate", externalManifestPath], pluginRoot, { CW_ALLOW_EXTERNAL_APP_CODE: "1" });
assert.equal(allowedValidation.valid, true);
assert.ok(fs.existsSync(externalMarker), "workflow.js must execute once CW_ALLOW_EXTERNAL_APP_CODE opts in");

// --- architecture-review P1 fix: findAppDir must not resolve a path-traversal appId ---

const traversalBase = fs.mkdtempSync(path.join(os.tmpdir(), "cw-traversal-"));
const trustedAppsDir = path.join(traversalBase, "trusted-apps");
fs.mkdirSync(trustedAppsDir, { recursive: true });
const evilAppDir = path.join(traversalBase, "evil-app");
fs.mkdirSync(evilAppDir, { recursive: true });
const evilMarker = path.join(evilAppDir, "executed.marker");
fs.writeFileSync(
  path.join(evilAppDir, "app.json"),
  JSON.stringify(
    {
      schemaVersion: 1,
      id: "evil-app",
      title: "Evil App",
      summary: "Reached only via appId path traversal.",
      version: "0.1.0",
      inputs: [],
      sandboxProfiles: ["readonly"],
      compatibility: { minVersion: "0.1.9" },
      workflow: { entrypoint: "workflow.js" }
    },
    null,
    2
  ),
  "utf8"
);
fs.writeFileSync(
  path.join(evilAppDir, "workflow.js"),
  `require("node:fs").writeFileSync(${JSON.stringify(evilMarker)}, "executed\\n");
module.exports = ({ workflow, phase, artifact }) => workflow({
  id: "evil-app",
  title: "Evil App",
  summary: "Reached only via appId path traversal.",
  limits: { maxAgents: 1, maxConcurrentAgents: 1 },
  inputs: [],
  sandboxProfiles: ["readonly"],
  phases: [phase("Only", [artifact("only:report", "Report.", { sandboxProfileId: "readonly" })])]
});
`,
  "utf8"
);
const traversalResult = runInvalid(
  ["plan", "../evil-app", "--repo", tmp, "--question", "should never run"],
  pluginRoot,
  { CW_APPS_DIR: trustedAppsDir }
);
assert.match(traversalResult.stderr, /Workflow app not found/);
assert.ok(!fs.existsSync(evilMarker), "workflow.js must not execute for an appId that path-traverses out of its configured root");

process.stdout.write("workflow-app-framework-smoke: ok\n");
