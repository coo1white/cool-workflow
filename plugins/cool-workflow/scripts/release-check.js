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
        "docs/security-trust-hardening.7.md",
        "../../CHANGELOG.md",
        "../../RELEASE.md"
      ]) {
        const absolute = path.resolve(pluginRoot, file);
        if (!fs.existsSync(absolute)) throw new Error(`missing ${path.relative(repoRoot, absolute)}`);
      }
    }
  },
  { name: "build", command: ["npm", "run", "build"] },
  { name: "type check", command: ["npm", "run", "check"] },
  { name: "tests", command: ["npm", "test"] },
  { name: "multi-agent runtime core smoke", command: ["node", "test/multi-agent-runtime-core-smoke.js"] },
  { name: "multi-agent topologies smoke", command: ["node", "test/multi-agent-topologies-smoke.js"] },
  { name: "multi-agent CLI MCP surface smoke", command: ["node", "test/multi-agent-cli-mcp-surface-smoke.js"] },
  { name: "multi-agent operator UX smoke", command: ["node", "test/multi-agent-operator-ux-smoke.js"] },
  { name: "multi-agent trust policy audit smoke", command: ["node", "test/multi-agent-trust-policy-audit-smoke.js"] },
  { name: "security trust smoke", command: ["node", "test/security-trust-hardening-smoke.js"] },
  { name: "dogfood release smoke", command: ["node", "test/dogfood-release-smoke.js"] },
  { name: "canonical apps", command: ["npm", "run", "canonical-apps"] },
  { name: "golden path", command: ["npm", "run", "golden-path"] },
  { name: "fixture compatibility", command: ["npm", "run", "fixture-compat"] },
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
