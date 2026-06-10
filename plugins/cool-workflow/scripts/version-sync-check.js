#!/usr/bin/env node
"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const pluginRoot = path.resolve(__dirname, "..");
const repoRoot = path.resolve(pluginRoot, "..", "..");

// Deterministic source-of-record: validate the COMMIT being released (the blob
// at HEAD), NOT the mutable working tree. A working tree is a moving target —
// any concurrent editor, formatter, or stray process can write-then-revert a
// surface file, and a read that lands in that window makes a release gate
// false-RED on a clean tree (and, symmetrically, a gate that trusts an
// uncommitted edit could false-GREEN). Reading `git show HEAD:<path>` removes
// that entire failure class: the bytes are immutable for the life of the commit.
// CI checks out HEAD, so HEAD === the tree it is releasing.
//
// Fallback to the filesystem only when we cannot read from HEAD: not a git work
// tree, or the path is not tracked at HEAD (e.g. the gitignored package-lock).
// node + git only — no ripgrep (CI portability rule).
const insideGitWorkTree = (() => {
  const r = spawnSync("git", ["rev-parse", "--is-inside-work-tree"], { cwd: repoRoot, encoding: "utf8" });
  return r.status === 0 && (r.stdout || "").trim() === "true";
})();

function readReleaseSource(relativePath) {
  // relativePath is repoRoot-relative (the form every check below already uses).
  if (insideGitWorkTree) {
    const r = spawnSync("git", ["show", `HEAD:${relativePath}`], {
      cwd: repoRoot,
      encoding: "utf8",
      maxBuffer: 1024 * 1024 * 32
    });
    if (r.status === 0) return { text: r.stdout, exists: true, fromHead: true };
    // Not tracked at HEAD — fall through to the working tree (e.g. package-lock).
  }
  const abs = path.join(repoRoot, relativePath);
  if (!fs.existsSync(abs)) return { text: null, exists: false, fromHead: false };
  return { text: fs.readFileSync(abs, "utf8"), exists: true, fromHead: false };
}

// Single source of truth: package.json. `scripts/bump-version.js` rewrites this
// (and every other surface); version:sync then asserts all surfaces equal it.
// Read it from the released commit so the asserted-against version is itself
// taken from HEAD, not a half-written working copy.
const VERSION = JSON.parse(readReleaseSource("plugins/cool-workflow/package.json").text).version;
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
  // package-lock.json is a gitignored install artifact (the documented install
  // uses `npm install --no-package-lock`), so only validate it when present.
  checkJsonIfPresent("plugins/cool-workflow/package-lock.json", "version", VERSION, checks);
  checkJson("plugins/cool-workflow/.codex-plugin/plugin.json", "version", VERSION, checks);
  checkNestedJson("plugins/cool-workflow/manifest/plugin.manifest.json", ["identity", "version"], VERSION, checks);
  checkJson("plugins/cool-workflow/.claude-plugin/plugin.json", "version", VERSION, checks);
  checkIncludes("plugins/cool-workflow/src/version.ts", `CURRENT_COOL_WORKFLOW_VERSION = "${VERSION}"`, checks);
  checkIncludes("plugins/cool-workflow/src/version.ts", "CURRENT_RUN_STATE_SCHEMA_VERSION = 1", checks);
  checkIncludes("plugins/cool-workflow/src/mcp-server.ts", "CURRENT_COOL_WORKFLOW_VERSION", checks);
  checkIncludes("plugins/cool-workflow/src/workflow-app-framework.ts", "CURRENT_COOL_WORKFLOW_VERSION", checks);

  for (const appId of canonicalApps) {
    checkJson(`plugins/cool-workflow/apps/${appId}/app.json`, "version", VERSION, checks);
  }

  checkIncludes("plugins/cool-workflow/scripts/golden-path.js", VERSION, checks);
  checkIncludes("plugins/cool-workflow/scripts/canonical-apps.js", VERSION, checks);
  checkIncludes("plugins/cool-workflow/scripts/dogfood-release.js", VERSION, checks);
  checkIncludes("plugins/cool-workflow/test/dogfood-release-smoke.js", VERSION, checks);
  checkIncludes("plugins/cool-workflow/test/coordinator-blackboard-smoke.js", "coordinator-blackboard-smoke", checks);
  checkIncludes("plugins/cool-workflow/test/multi-agent-topologies-smoke.js", "multi-agent-topologies-smoke", checks);
  checkIncludes("plugins/cool-workflow/test/multi-agent-cli-mcp-surface-smoke.js", "multi-agent-cli-mcp-surface-smoke", checks);
  checkIncludes("plugins/cool-workflow/test/multi-agent-eval-replay-harness-smoke.js", "multi-agent-eval-replay-smoke", checks);
  checkIncludes("plugins/cool-workflow/test/state-explosion-management-smoke.js", "state-explosion-management-smoke", checks);
  checkIncludes("plugins/cool-workflow/test/evidence-adoption-reasoning-smoke.js", "evidence-adoption-reasoning-smoke", checks);
  checkIncludes("plugins/cool-workflow/test/mcp-app-surface-smoke.js", VERSION, checks);
  checkIncludes("plugins/cool-workflow/test/canonical-workflow-apps-smoke.js", VERSION, checks);
  checkIncludes("plugins/cool-workflow/test/workflow-app-framework-smoke.js", VERSION, checks);
  checkIncludes("plugins/cool-workflow/dist/version.js", VERSION, checks);
  checkIncludes("plugins/cool-workflow/dist/mcp-server.js", "CURRENT_COOL_WORKFLOW_VERSION", checks);
  checkIncludes("plugins/cool-workflow/dist/workflow-app-framework.js", "CURRENT_COOL_WORKFLOW_VERSION", checks);

  checkIncludes("plugins/cool-workflow/README.md", `v${VERSION}`, checks);
  checkIncludes("plugins/cool-workflow/docs/index.md", "release and migration", checks);
  checkIncludes("plugins/cool-workflow/docs/multi-agent-topologies.7.md", "Multi-Agent Topologies", checks);
  checkIncludes("plugins/cool-workflow/docs/multi-agent-cli-mcp-surface.7.md", VERSION, checks);
  checkIncludes("plugins/cool-workflow/docs/multi-agent-operator-ux.7.md", VERSION, checks);
  checkIncludes("plugins/cool-workflow/docs/multi-agent-eval-replay-harness.7.md", VERSION, checks);
  checkIncludes("plugins/cool-workflow/docs/state-explosion-management.7.md", "State Explosion Management", checks);
  checkIncludes("plugins/cool-workflow/docs/state-explosion-management.7.md", VERSION, checks);
  checkIncludes("plugins/cool-workflow/docs/evidence-adoption-reasoning-chain.7.md", "Evidence Adoption Reasoning Chain", checks);
  checkIncludes("plugins/cool-workflow/docs/evidence-adoption-reasoning-chain.7.md", VERSION, checks);
  checkIncludes("plugins/cool-workflow/docs/coordinator-blackboard.7.md", "Coordinator / Blackboard", checks);
  checkIncludes("plugins/cool-workflow/docs/cli-mcp-parity.7.md", "CLI", checks);
  checkIncludes("plugins/cool-workflow/docs/cli-mcp-parity.7.md", VERSION, checks);
  checkIncludes("plugins/cool-workflow/docs/index.md", "cli-mcp-parity.7.md", checks);
  checkIncludes("plugins/cool-workflow/docs/run-registry-control-plane.7.md", "Run Registry / Control Plane", checks);
  checkIncludes("plugins/cool-workflow/docs/run-registry-control-plane.7.md", VERSION, checks);
  checkIncludes("plugins/cool-workflow/docs/index.md", "run-registry-control-plane.7.md", checks);
  checkIncludes("plugins/cool-workflow/test/run-registry-control-plane-smoke.js", "run-registry-control-plane-smoke", checks);
  checkIncludes("plugins/cool-workflow/docs/execution-backends.7.md", "Execution Backends", checks);
  checkIncludes("plugins/cool-workflow/docs/execution-backends.7.md", VERSION, checks);
  checkIncludes("plugins/cool-workflow/docs/index.md", "execution-backends.7.md", checks);
  checkIncludes("plugins/cool-workflow/test/execution-backends-smoke.js", "execution-backends-smoke", checks);
  checkIncludes("plugins/cool-workflow/docs/web-desktop-workbench.7.md", "Web / Desktop Workbench", checks);
  checkIncludes("plugins/cool-workflow/docs/web-desktop-workbench.7.md", VERSION, checks);
  checkIncludes("plugins/cool-workflow/docs/index.md", "web-desktop-workbench.7.md", checks);
  checkIncludes("plugins/cool-workflow/test/web-desktop-workbench-smoke.js", "web-desktop-workbench-smoke", checks);
  checkIncludes("plugins/cool-workflow/docs/observability-cost-accounting.7.md", "Observability + Cost Accounting", checks);
  checkIncludes("plugins/cool-workflow/docs/observability-cost-accounting.7.md", VERSION, checks);
  checkIncludes("plugins/cool-workflow/docs/index.md", "observability-cost-accounting.7.md", checks);
  checkIncludes("plugins/cool-workflow/test/observability-cost-accounting-smoke.js", "observability-cost-accounting-smoke", checks);
  checkIncludes("plugins/cool-workflow/docs/team-collaboration.7.md", "Team Collaboration", checks);
  checkIncludes("plugins/cool-workflow/docs/team-collaboration.7.md", VERSION, checks);
  checkIncludes("plugins/cool-workflow/docs/index.md", "team-collaboration.7.md", checks);
  checkIncludes("plugins/cool-workflow/test/team-collaboration-smoke.js", "team-collaboration-smoke", checks);
  checkIncludes("plugins/cool-workflow/docs/release-tooling.7.md", "Release Tooling", checks);
  checkIncludes("plugins/cool-workflow/docs/release-tooling.7.md", VERSION, checks);
  checkIncludes("plugins/cool-workflow/docs/index.md", "release-tooling.7.md", checks);
  checkIncludes("plugins/cool-workflow/test/release-tooling-smoke.js", "release-tooling-smoke", checks);
  checkIncludes("plugins/cool-workflow/docs/real-execution-backends.7.md", "Real Execution Backend Integrations", checks);
  checkIncludes("plugins/cool-workflow/docs/real-execution-backends.7.md", VERSION, checks);
  checkIncludes("plugins/cool-workflow/docs/index.md", "real-execution-backends.7.md", checks);
  checkIncludes("plugins/cool-workflow/test/real-execution-backends-smoke.js", "real-execution-backends-smoke", checks);
  checkIncludes("plugins/cool-workflow/docs/node-snapshot-diff-replay.7.md", "Node Snapshot / Diff / Replay", checks);
  checkIncludes("plugins/cool-workflow/docs/node-snapshot-diff-replay.7.md", VERSION, checks);
  checkIncludes("plugins/cool-workflow/docs/index.md", "node-snapshot-diff-replay.7.md", checks);
  checkIncludes("plugins/cool-workflow/test/node-snapshot-diff-replay-smoke.js", "node-snapshot-diff-replay-smoke", checks);
  checkIncludes("plugins/cool-workflow/docs/contract-migration-tooling.7.md", "Contract Migration Tooling", checks);
  checkIncludes("plugins/cool-workflow/docs/contract-migration-tooling.7.md", VERSION, checks);
  checkIncludes("plugins/cool-workflow/docs/index.md", "contract-migration-tooling.7.md", checks);
  checkIncludes("plugins/cool-workflow/test/contract-migration-tooling-smoke.js", "contract-migration-tooling-smoke", checks);
  checkIncludes("plugins/cool-workflow/docs/control-plane-scheduling.7.md", "Control-Plane Scheduling", checks);
  checkIncludes("plugins/cool-workflow/docs/control-plane-scheduling.7.md", VERSION, checks);
  checkIncludes("plugins/cool-workflow/docs/index.md", "control-plane-scheduling.7.md", checks);
  checkIncludes("plugins/cool-workflow/test/control-plane-scheduling-smoke.js", "control-plane-scheduling-smoke", checks);
  checkIncludes("plugins/cool-workflow/docs/agent-delegation-drive.7.md", "Agent Delegation Drive", checks);
  checkIncludes("plugins/cool-workflow/docs/agent-delegation-drive.7.md", VERSION, checks);
  checkIncludes("plugins/cool-workflow/docs/index.md", "agent-delegation-drive.7.md", checks);
  checkIncludes("plugins/cool-workflow/test/agent-delegation-drive-smoke.js", "agent-delegation-drive-smoke", checks);
  checkIncludes("plugins/cool-workflow/docs/run-retention-reclamation.7.md", "Run Retention & Provable Reclamation", checks);
  checkIncludes("plugins/cool-workflow/docs/run-retention-reclamation.7.md", VERSION, checks);
  checkIncludes("plugins/cool-workflow/docs/index.md", "run-retention-reclamation.7.md", checks);
  checkIncludes("plugins/cool-workflow/test/run-retention-reclamation-smoke.js", "run-retention-reclamation-smoke", checks);
  checkIncludes("plugins/cool-workflow/src/capability-registry.ts", "gc.plan", checks);
  checkIncludes("plugins/cool-workflow/docs/durable-state-and-locking.7.md", "Durable State & Locking", checks);
  checkIncludes("plugins/cool-workflow/docs/durable-state-and-locking.7.md", VERSION, checks);
  checkIncludes("plugins/cool-workflow/docs/index.md", "durable-state-and-locking.7.md", checks);
  checkIncludes("plugins/cool-workflow/test/durable-atomic-write-smoke.js", "durable-atomic-write-smoke", checks);
  checkIncludes("plugins/cool-workflow/src/state.ts", "withFileLock", checks);
  checkIncludes("plugins/cool-workflow/src/drive.ts", "driveStep", checks);
  checkIncludes("plugins/cool-workflow/dist/drive.js", "driveStep", checks);
  checkIncludes("plugins/cool-workflow/src/capability-registry.ts", "run.drive", checks);
  checkIncludes("plugins/cool-workflow/src/collaboration.ts", "deriveReviewState", checks);
  checkIncludes("plugins/cool-workflow/dist/collaboration.js", "deriveReviewState", checks);
  checkIncludes("plugins/cool-workflow/src/capability-registry.ts", "review.status", checks);
  checkIncludes("plugins/cool-workflow/src/observability.ts", "deriveMetricsReport", checks);
  checkIncludes("plugins/cool-workflow/dist/observability.js", "deriveMetricsReport", checks);
  checkIncludes("plugins/cool-workflow/src/capability-registry.ts", "metrics.show", checks);
  checkIncludes("plugins/cool-workflow/manifest/pricing.policy.json", "schemaVersion", checks);
  checkIncludes("plugins/cool-workflow/src/workbench.ts", "buildWorkbenchRunView", checks);
  checkIncludes("plugins/cool-workflow/dist/workbench.js", "buildWorkbenchRunView", checks);
  checkIncludes("plugins/cool-workflow/src/capability-registry.ts", "workbench.view", checks);
  checkIncludes("plugins/cool-workflow/src/execution-backend.ts", "ExecutionBackend", checks);
  checkIncludes("plugins/cool-workflow/dist/execution-backend.js", "ExecutionBackend", checks);
  checkIncludes("plugins/cool-workflow/src/capability-registry.ts", "backend.list", checks);
  checkIncludes("plugins/cool-workflow/src/run-registry.ts", "RunRegistry", checks);
  checkIncludes("plugins/cool-workflow/dist/run-registry.js", "RunRegistry", checks);
  checkIncludes("plugins/cool-workflow/src/capability-registry.ts", "registry.refresh", checks);
  checkIncludes("plugins/cool-workflow/package.json", "parity:check", checks);
  checkIncludes("plugins/cool-workflow/scripts/parity-check.js", "buildParityReport", checks);
  checkIncludes("plugins/cool-workflow/test/cli-mcp-parity-smoke.js", "cli-mcp-parity-smoke", checks);
  checkIncludes("plugins/cool-workflow/src/capability-registry.ts", "CAPABILITY_REGISTRY", checks);
  checkIncludes("plugins/cool-workflow/src/capability-core.ts", "planSummary", checks);
  checkIncludes("plugins/cool-workflow/dist/capability-registry.js", "CAPABILITY_REGISTRY", checks);
  checkIncludes("plugins/cool-workflow/docs/multi-agent-runtime-core.7.md", "Multi-Agent Runtime Core", checks);
  checkIncludes("plugins/cool-workflow/docs/dogfood-one-real-repo.7.md", "Dogfood One Real Repo", checks);
  checkIncludes("plugins/cool-workflow/docs/getting-started.md", "npm run release:check", checks);
  checkIncludes("plugins/cool-workflow/package.json", "eval:replay", checks);
  checkIncludes("plugins/cool-workflow/docs/release-and-migration.7.md", VERSION, checks);
  checkIncludes("CHANGELOG.md", `## ${VERSION}`, checks);
  checkIncludes("RELEASE.md", VERSION, checks);
  checkIncludes("plugins/cool-workflow/skills/cool-workflow/SKILL.md", "release:check", checks);

  process.stdout.write(
    `${JSON.stringify({ ok: true, version: VERSION, source: insideGitWorkTree ? "git:HEAD" : "working-tree", checks }, null, 2)}\n`
  );
}

function checkJson(relativePath, key, expected, checks) {
  const src = readReleaseSource(relativePath);
  assert.ok(src.exists, `${relativePath} must exist`);
  const value = JSON.parse(src.text)[key];
  assert.equal(value, expected, `${relativePath}.${key} must be ${expected}`);
  checks.push({ path: relativePath, key, value });
}

function checkNestedJson(relativePath, keyPath, expected, checks) {
  const src = readReleaseSource(relativePath);
  assert.ok(src.exists, `${relativePath} must exist`);
  let value = JSON.parse(src.text);
  for (const key of keyPath) value = value?.[key];
  assert.equal(value, expected, `${relativePath}.${keyPath.join(".")} must be ${expected}`);
  checks.push({ path: relativePath, key: keyPath.join("."), value });
}

function checkJsonIfPresent(relativePath, key, expected, checks) {
  const src = readReleaseSource(relativePath);
  if (!src.exists) {
    checks.push({ path: relativePath, key, skipped: "absent" });
    return;
  }
  const value = JSON.parse(src.text)[key];
  assert.equal(value, expected, `${relativePath}.${key} must be ${expected}`);
  checks.push({ path: relativePath, key, value });
}

function checkIncludes(relativePath, needle, checks) {
  const src = readReleaseSource(relativePath);
  assert.ok(src.exists, `${relativePath} must exist`);
  assert.ok(src.text.includes(needle), `${relativePath} must include ${needle}`);
  checks.push({ path: relativePath, includes: needle });
}

main();
