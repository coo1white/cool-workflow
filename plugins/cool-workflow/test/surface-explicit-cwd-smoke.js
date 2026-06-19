#!/usr/bin/env node
"use strict";

// surface-explicit-cwd-smoke: MCP and Workbench surface calls must use explicit
// cwd scoping, not process-global chdir. This protects long-lived hosts from
// cross-request cwd bleed while preserving run lookup and relative output paths.

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const pluginRoot = path.resolve(__dirname, "..");
const srcGuards = [
  path.join(pluginRoot, "src", "mcp-surface.ts"),
  path.join(pluginRoot, "src", "workbench-host.ts")
];
const carvedToolCall = path.join(pluginRoot, "src", "mcp", "tool-call.ts");
if (fs.existsSync(carvedToolCall)) srcGuards.push(carvedToolCall);

for (const file of srcGuards) {
  const source = fs.readFileSync(file, "utf8");
  assert.doesNotMatch(source, /process\.chdir\(/, `${path.relative(pluginRoot, file)} must not use process.chdir`);
}

const { callTool } = require(path.join(pluginRoot, "dist", "mcp-surface.js"));
const workspace = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "cw-explicit-cwd-")));
fs.writeFileSync(path.join(workspace, "README.md"), "# explicit cwd smoke\n", "utf8");

const cwdBefore = process.cwd();

const plan = callTool("cw_plan", {
  cwd: workspace,
  workflowId: "end-to-end-golden-path",
  question: "prove explicit cwd scoping"
});
assert.equal(process.cwd(), cwdBefore, "cw_plan must not change process cwd");
assert.equal(plan.workflowId, "end-to-end-golden-path");
assert.ok(String(plan.statePath).startsWith(path.join(workspace, ".cw", "runs") + path.sep), "plan state is under explicit cwd");

const status = callTool("cw_status", { cwd: workspace, runId: plan.runId });
assert.equal(process.cwd(), cwdBefore, "cw_status must not change process cwd");
assert.equal(status.runId, plan.runId);
assert.equal(status.workflowId, "end-to-end-golden-path");

const packaged = callTool("cw_app_package", { cwd: workspace, appId: "end-to-end-golden-path" });
assert.equal(process.cwd(), cwdBefore, "cw_app_package must not change process cwd");
assert.ok(
  String(packaged.path).startsWith(path.join(workspace, ".cw", "packages") + path.sep),
  "default app package path is anchored under explicit cwd"
);
assert.ok(fs.existsSync(packaged.path), "app package is written at the anchored path");

process.stdout.write("surface-explicit-cwd-smoke: ok\n");
