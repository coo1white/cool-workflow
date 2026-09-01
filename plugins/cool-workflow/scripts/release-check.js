#!/usr/bin/env node
"use strict";

const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const pluginRoot = path.resolve(__dirname, "..");
const repoRoot = path.resolve(pluginRoot, "..", "..");
const skipTests = process.argv.includes("--skip-tests") || process.env.CW_RELEASE_CHECK_SKIP_TESTS === "1";
const checks = [
  {
    name: "docs presence",
    run: () => {
      for (const file of [
        "README.md",
        "docs/index.md",
        "docs/getting-started.md",
        "docs/release-history.md",
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
        "docs/run-retention-reclamation.7.md",
        "docs/durable-state-and-locking.7.md",
        "docs/security-trust-hardening.7.md",
        "docs/trust-audit-anchor.7.md",
        "docs/control-bands.7.md"
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
  { name: "core/shell purity", command: ["npm", "run", "purity:check"] },
  { name: "language policy (JS/TS only)", command: ["npm", "run", "lang:check"] },
  { name: "type check", command: ["npm", "run", "check"] },
  { name: "onramp contract", command: ["npm", "run", "onramp:check"] },
  { name: "run-state schema consistency", command: ["node", "scripts/validate-run-state-schema.js"] },
  // Every test path uses --concurrency auto by default (parallel, race-free:
  // each smoke runs in a private cwd + state roots). The release tag-gate
  // (release-gate.js) forces CW_TEST_CONCURRENCY=1 to stay sequential as the
  // deterministic backstop.
  { name: "tests", command: ["npm", "run", "test:ci"] },
  // Pure core/ unit tests (test/*.test.js) — a separate suite from the smoke
  // tests above (see test/run-unit.js's header). --skip-tests also skips
  // this one, matching "tests": ci.yml runs test:unit directly, so this
  // entry would just repeat it a second time in the release-check pass.
  { name: "unit tests", command: ["npm", "run", "test:unit"] },
  { name: "canonical apps", command: ["npm", "run", "canonical-apps"] },
  { name: "golden path", command: ["npm", "run", "golden-path"] },
  { name: "CLI MCP parity", command: ["npm", "run", "parity:check"] },
  { name: "vendor manifest synchronization", command: ["npm", "run", "gen:manifests", "--", "--check"] },
  { name: "version synchronization", command: ["npm", "run", "version:sync"] },
  // Lightweight (~50ms) standalone gate: fail closed if docs/project-index.md has
  // drifted from a fresh source scan. The teeth-on-the-gate live in
  // test/project-index-sync-smoke.js (run by `npm test`); this entry gives the
  // real-doc check its own visible PASS/FAIL line in the release summary.
  { name: "project index sync", command: ["npm", "run", "index:check"] },
  // Fail closed if the npm README (plugins/cool-workflow/README.md) has drifted
  // from the GitHub README.md it is generated from. Keeps the two pages identical
  // by construction; teeth live in test/readme-sync-smoke.js (run by `npm test`).
  { name: "readme sync", command: ["npm", "run", "readme:check"] },
  // Fail closed if a live doc (docs/*.7.md and friends, AGENTS.md, READMEs)
  // names a source file that is not in the tree. Teeth live in
  // test/citation-check-smoke.js (run by `npm test`).
  { name: "doc citation freshness", command: ["npm", "run", "citation:check"] }
];

function main() {
  const results = [];
  for (const check of checks) {
    process.stdout.write(`release:check ${check.name} ... `);
    const started = Date.now();
    try {
      if (skipTests && (check.name === "tests" || check.name === "unit tests")) {
        results.push({ name: check.name, ok: true, skipped: true, elapsedMs: 0 });
        process.stdout.write("skipped\n");
        continue;
      }
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
    process.stdout.write(`- ${result.skipped ? "SKIP" : result.ok ? "PASS" : "FAIL"} ${result.name}\n`);
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
