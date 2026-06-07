#!/usr/bin/env node
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const pluginRoot = path.resolve(__dirname, "..");
const cli = path.join(pluginRoot, "dist/cli.js");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cw-workflow-app-sdk-"));

function run(args, cwd = pluginRoot) {
  return JSON.parse(execFileSync("node", [cli, ...args], { cwd, encoding: "utf8" }));
}

function runText(args, cwd = pluginRoot) {
  return execFileSync("node", [cli, ...args], { cwd, encoding: "utf8" });
}

function runInvalid(args, cwd = pluginRoot) {
  try {
    execFileSync("node", [cli, ...args], { cwd, encoding: "utf8", stdio: "pipe" });
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
assert.ok(workflowList.some((entry) => entry.id === "legacy-architecture-review"));
assert.ok(workflowList.some((entry) => entry.id === "workflow-app-sdk-demo"));

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
assert.equal(canonicalResearchPlan.pendingTasks, 6);
const canonicalResearchState = JSON.parse(fs.readFileSync(canonicalResearchPlan.statePath, "utf8"));
assert.equal(canonicalResearchState.workflow.app.id, "research-synthesis");
assert.equal(canonicalResearchState.workflow.app.version, "0.1.17");

const legacyPlan = run([
  "plan",
  "legacy-research-synthesis",
  "--repo",
  tmp,
  "--question",
  "Do legacy workflow files still plan?"
]);
assert.equal(legacyPlan.workflowId, "legacy-research-synthesis");
assert.equal(legacyPlan.pendingTasks, 5);

const appList = run(["app", "list"]);
const demoSummary = appList.find((entry) => entry.id === "workflow-app-sdk-demo");
assert.ok(demoSummary);
assert.equal(demoSummary.version, "0.1.0");
assert.equal(demoSummary.legacy, false);
assert.deepEqual(demoSummary.sandboxProfiles, ["readonly", "workspace-write"]);

const demoShow = run(["app", "show", "workflow-app-sdk-demo"]);
assert.equal(demoShow.app.version, "0.1.0");
assert.equal(demoShow.workflow.phases[2].tasks[0].requiresEvidence, true);
assert.equal(demoShow.workflow.phases[1].tasks[0].sandboxProfileId, "workspace-write");

const demoValidate = run(["app", "validate", path.join(pluginRoot, "apps/workflow-app-sdk-demo/app.json")]);
assert.equal(demoValidate.valid, true);
assert.equal(demoValidate.summary.id, "workflow-app-sdk-demo");

const generatedDir = path.join(tmp, "generated-app");
const generated = run([
  "app",
  "init",
  "smoke-sdk-app",
  "--title",
  "Smoke SDK App",
  "--directory",
  generatedDir
]);
assert.equal(generated.id, "smoke-sdk-app");
assert.ok(fs.existsSync(generated.manifestPath));
assert.ok(fs.existsSync(generated.entrypointPath));
assert.equal(run(["app", "validate", generated.manifestPath]).valid, true);

const packagePath = path.join(tmp, "workflow-app-sdk-demo.cwapp.json");
const packaged = run(["app", "package", "workflow-app-sdk-demo", "--output", packagePath]);
assert.equal(packaged.id, "workflow-app-sdk-demo");
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
const duplicateValidation = JSON.parse(runInvalid(["app", "validate", path.join(duplicateDir, "app.json")]).stdout);
assert.equal(duplicateValidation.valid, false);
assert.ok(duplicateValidation.issues.some((entry) => entry.code === "workflow-task-duplicate"));

const missingDir = path.join(tmp, "missing-fields-app");
fs.mkdirSync(missingDir, { recursive: true });
fs.writeFileSync(
  path.join(missingDir, "app.json"),
  JSON.stringify({ schemaVersion: 1, id: "missing-fields-app", workflow: { entrypoint: "workflow.js" } }, null, 2),
  "utf8"
);
const missingValidation = JSON.parse(runInvalid(["app", "validate", path.join(missingDir, "app.json")]).stdout);
assert.equal(missingValidation.valid, false);
assert.ok(missingValidation.issues.some((entry) => entry.code === "workflow-app-title"));
assert.ok(missingValidation.issues.some((entry) => entry.code === "workflow-app-version"));

const appPlan = run([
  "plan",
  "workflow-app-sdk-demo",
  "--repo",
  tmp,
  "--question",
  "Record app metadata"
]);
const appState = JSON.parse(fs.readFileSync(appPlan.statePath, "utf8"));
assert.equal(appState.workflow.app.id, "workflow-app-sdk-demo");
assert.equal(appState.workflow.app.version, "0.1.0");
assert.match(fs.readFileSync(appPlan.reportPath, "utf8"), /Workflow App: workflow-app-sdk-demo@0\.1\.0/);

const dispatch = run(["dispatch", appPlan.runId, "--limit", "1"], tmp);
assert.equal(dispatch.tasks.length, 1);
assert.equal(dispatch.tasks[0].sandboxProfileId, "readonly");

const reportPath = runText(["report", appPlan.runId], tmp).trim();
assert.equal(reportPath, appPlan.reportPath);

process.stdout.write("workflow-app-sdk-smoke: ok\n");
