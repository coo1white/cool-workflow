#!/usr/bin/env node
"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const pluginRoot = path.resolve(__dirname, "..");
const repoRoot = path.resolve(pluginRoot, "..", "..");
const VERSION = "0.1.17";
const canonicalApps = [
  "architecture-review",
  "end-to-end-golden-path",
  "pr-review-fix-ci",
  "release-cut",
  "research-synthesis"
];

function main() {
  const checks = [];
  checkJson("plugins/cool-workflow/package.json", "version", VERSION, checks);
  checkJson("plugins/cool-workflow/package-lock.json", "version", VERSION, checks);
  checkJson("plugins/cool-workflow/.codex-plugin/plugin.json", "version", VERSION, checks);
  checkIncludes("plugins/cool-workflow/src/version.ts", `CURRENT_COOL_WORKFLOW_VERSION = "${VERSION}"`, checks);
  checkIncludes("plugins/cool-workflow/src/version.ts", "CURRENT_RUN_STATE_SCHEMA_VERSION = 1", checks);
  checkIncludes("plugins/cool-workflow/src/mcp-server.ts", "CURRENT_COOL_WORKFLOW_VERSION", checks);
  checkIncludes("plugins/cool-workflow/src/workflow-app-sdk.ts", "CURRENT_COOL_WORKFLOW_VERSION", checks);

  for (const appId of canonicalApps) {
    checkJson(`plugins/cool-workflow/apps/${appId}/app.json`, "version", VERSION, checks);
  }

  checkIncludes("plugins/cool-workflow/scripts/golden-path.js", VERSION, checks);
  checkIncludes("plugins/cool-workflow/scripts/canonical-apps.js", VERSION, checks);
  checkIncludes("plugins/cool-workflow/scripts/dogfood-release.js", VERSION, checks);
  checkIncludes("plugins/cool-workflow/test/dogfood-release-smoke.js", VERSION, checks);
  checkIncludes("plugins/cool-workflow/test/mcp-app-surface-smoke.js", VERSION, checks);
  checkIncludes("plugins/cool-workflow/test/canonical-workflow-apps-smoke.js", VERSION, checks);
  checkIncludes("plugins/cool-workflow/test/workflow-app-sdk-smoke.js", VERSION, checks);
  checkIncludes("plugins/cool-workflow/dist/version.js", VERSION, checks);
  checkIncludes("plugins/cool-workflow/dist/mcp-server.js", "CURRENT_COOL_WORKFLOW_VERSION", checks);
  checkIncludes("plugins/cool-workflow/dist/workflow-app-sdk.js", "CURRENT_COOL_WORKFLOW_VERSION", checks);

  checkIncludes("plugins/cool-workflow/README.md", `v${VERSION}`, checks);
  checkIncludes("plugins/cool-workflow/docs/index.md", "release and migration", checks);
  checkIncludes("plugins/cool-workflow/docs/multi-agent-runtime-core.7.md", VERSION, checks);
  checkIncludes("plugins/cool-workflow/docs/dogfood-one-real-repo.7.md", VERSION, checks);
  checkIncludes("plugins/cool-workflow/docs/getting-started.md", "npm run release:check", checks);
  checkIncludes("plugins/cool-workflow/docs/release-and-migration.7.md", VERSION, checks);
  checkIncludes("CHANGELOG.md", `## ${VERSION}`, checks);
  checkIncludes("RELEASE.md", VERSION, checks);
  checkIncludes("plugins/cool-workflow/skills/cool-workflow/SKILL.md", "release:check", checks);

  process.stdout.write(`${JSON.stringify({ ok: true, version: VERSION, checks }, null, 2)}\n`);
}

function checkJson(relativePath, key, expected, checks) {
  const file = path.join(repoRoot, relativePath);
  assert.ok(fs.existsSync(file), `${relativePath} must exist`);
  const value = JSON.parse(fs.readFileSync(file, "utf8"))[key];
  assert.equal(value, expected, `${relativePath}.${key} must be ${expected}`);
  checks.push({ path: relativePath, key, value });
}

function checkIncludes(relativePath, needle, checks) {
  const file = path.join(repoRoot, relativePath);
  assert.ok(fs.existsSync(file), `${relativePath} must exist`);
  const text = fs.readFileSync(file, "utf8");
  assert.ok(text.includes(needle), `${relativePath} must include ${needle}`);
  checks.push({ path: relativePath, includes: needle });
}

main();
