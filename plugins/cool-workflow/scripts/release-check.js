#!/usr/bin/env node
"use strict";

const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const pluginRoot = path.resolve(__dirname, "..");
const repoRoot = path.resolve(pluginRoot, "..", "..");
const checks = [
  {
    name: "docs presence",
    run: () => {
      for (const file of [
        "README.md",
        "docs/index.md",
        "docs/getting-started.md",
        "docs/release-and-migration.7.md",
        "docs/multi-agent-cli-mcp-surface.7.md",
        "docs/multi-agent-operator-ux.7.md",
        "docs/multi-agent-trust-policy-audit.7.md",
        "docs/multi-agent-eval-replay-harness.7.md",
        "docs/state-explosion-management.7.md",
        "docs/evidence-adoption-reasoning-chain.7.md",
        "docs/cli-mcp-parity.7.md",
        "docs/run-registry-control-plane.7.md",
        "docs/execution-backends.7.md",
        "docs/web-desktop-workbench.7.md",
        "docs/observability-cost-accounting.7.md",
        "docs/team-collaboration.7.md",
        "docs/release-tooling.7.md",
        "docs/real-execution-backends.7.md",
        "docs/node-snapshot-diff-replay.7.md",
        "docs/contract-migration-tooling.7.md",
        "docs/control-plane-scheduling.7.md",
        "docs/agent-delegation-drive.7.md",
        "docs/security-trust-hardening.7.md",
        "../../CHANGELOG.md",
        "../../RELEASE.md"
      ]) {
        const absolute = path.resolve(pluginRoot, file);
        if (!fs.existsSync(absolute)) throw new Error(`missing ${path.relative(repoRoot, absolute)}`);
      }
    }
  },
  // NOTE: the individual `node test/<x>-smoke.js` steps were removed — every one
  // is already run by `npm test` below (proven by set intersection). Re-running
  // them here doubled wall time (~86s -> ~25s) without adding coverage. The steps
  // kept below are the ones NOT covered by `npm test`: the build/typecheck, the
  // app/script runners (canonical-apps, golden-path), and the dedicated gates
  // (parity, manifest drift, version sync). `npm test` already runs every smoke,
  // including eval-replay-harness, fixture-compat, dogfood, security, and the
  // per-feature smokes.
  // `dist:check` builds from src/ AND fails closed if the committed dist/ drifted
  // from that fresh build — strictly stronger than a bare `npm run build`.
  { name: "dist freshness", command: ["npm", "run", "dist:check"] },
  { name: "type check", command: ["npm", "run", "check"] },
  { name: "tests", command: ["npm", "test"] },
  { name: "canonical apps", command: ["npm", "run", "canonical-apps"] },
  { name: "golden path", command: ["npm", "run", "golden-path"] },
  { name: "CLI MCP parity", command: ["npm", "run", "parity:check"] },
  { name: "vendor manifest synchronization", command: ["npm", "run", "gen:manifests", "--", "--check"] },
  { name: "version synchronization", command: ["npm", "run", "version:sync"] }
];

function main() {
  const results = [];
  for (const check of checks) {
    process.stdout.write(`release:check ${check.name} ... `);
    const started = Date.now();
    try {
      if (check.run) check.run();
      else runCommand(check.command);
      const elapsedMs = Date.now() - started;
      results.push({ name: check.name, ok: true, elapsedMs });
      process.stdout.write(`ok (${elapsedMs}ms)\n`);
    } catch (error) {
      const elapsedMs = Date.now() - started;
      results.push({ name: check.name, ok: false, elapsedMs, error: error.message });
      process.stdout.write(`failed (${elapsedMs}ms)\n`);
      process.stderr.write(`${error.message}\n`);
    }
  }

  const failed = results.filter((entry) => !entry.ok);
  process.stdout.write("\nRelease Check Summary\n");
  for (const result of results) {
    process.stdout.write(`- ${result.ok ? "PASS" : "FAIL"} ${result.name}\n`);
  }
  process.stdout.write(`\nDry-run only: no tag, push, publish, or fixture mutation was requested.\n`);
  if (failed.length > 0) {
    process.stderr.write(`\n${failed.length} release-blocking check(s) failed.\n`);
    process.exitCode = 1;
  }
}

function runCommand(command) {
  const result = spawnSync(command[0], command.slice(1), {
    cwd: pluginRoot,
    encoding: "utf8",
    stdio: "pipe",
    env: { ...process.env, CW_RELEASE_CHECK: "1" }
  });
  if (result.status !== 0) {
    const output = [result.stdout, result.stderr].filter(Boolean).join("\n").trim();
    throw new Error(`${command.join(" ")} exited ${result.status}\n${output}`);
  }
}

main();
