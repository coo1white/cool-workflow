#!/usr/bin/env node
"use strict";

// run-all-agent-env-hermetic-smoke — the smoke runner must hand every smoke child
// a clean agent/backend slate, even when the operator exported one into its OWN
// parent env.
//
// The bug this guards: `release-flow.js --cut` runs the deterministic gate
// (release-gate.sh → `npm test` → run-all.js) in the SAME process env as the
// reviewer config. When the reviewer is set via the CW_AGENT_COMMAND *env var*
// (which release-flow's own "no reviewer agent configured" hint suggests), that
// var leaked into the gate's smoke children. CW_NO_AUTO_AGENT=1 only blocks PATH
// auto-detection — an explicit CW_AGENT_COMMAND/ENDPOINT still resolves (flags >
// env > file, src/agent-config.ts) — so every fail-closed / no-agent / blocked
// smoke false-FAILED and the cut REJECTED at the gate, even though
// `npm run release:check` (run without that env var) passed.
//
// We copy run-all.js alone into a temp dir (it is self-contained by design),
// drop a probe smoke, and run the copied runner with the whole agent/backend set
// PLUS a non-agent sentinel exported into its parent env. The probe asserts the
// agent set was stripped and the sentinel survived — proving the scrub is real,
// targeted (not a sledgehammer), and non-vacuous. Fails-before against an
// unpatched run-all.js; passes-after.
//
// Portable: node only, isolated tmpdir, no real agent spawned.

const assert = require("node:assert/strict");
const cp = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const testDir = __dirname;
const temp = fs.mkdtempSync(path.join(os.tmpdir(), "cw-run-all-agent-env-"));

try {
  const runner = path.join(temp, "run-all.js");
  fs.copyFileSync(path.join(testDir, "run-all.js"), runner);

  // The ambient agent/backend env that must NOT reach a smoke child. Mirrors the
  // env layer of src/agent-config.ts (agentConfigFromEnv) + CW_BACKEND.
  const AGENT_ENV = {
    CW_AGENT_COMMAND: "claude -p {{input}}",
    CW_AGENT_ENDPOINT: "https://example.invalid/agent",
    CW_AGENT_MODEL: "leak-model",
    CW_AGENT_TIMEOUT_MS: "1234",
    CW_AGENT_ATTEST_PUBKEY: "leak-pubkey",
    CW_AGENT_ATTEST_PRIVKEY: "leak-privkey",
    CW_REQUIRE_ATTESTED_TELEMETRY: "1",
    CW_BACKEND: "agent"
  };

  // A probe smoke: it fails (non-zero exit → the runner reports FAIL) if ANY agent
  // var leaked in, or if the non-agent sentinel was wrongly stripped.
  const probe = [
    'const assert = require("node:assert/strict");',
    `const agentKeys = ${JSON.stringify(Object.keys(AGENT_ENV))};`,
    "const leaked = agentKeys.filter((k) => process.env[k] !== undefined);",
    'assert.deepEqual(leaked, [], "agent/backend env leaked into a smoke child: " + leaked.join(","));',
    'assert.equal(process.env.CW_PROBE_KEEP, "keep-me", "non-agent env must still pass through (targeted scrub, not a sledgehammer)");',
    'process.stdout.write("agent-env-probe: ok\\n");',
    ""
  ].join("\n");
  fs.writeFileSync(path.join(temp, "agent-env-probe-smoke.js"), probe, "utf8");

  const parentEnv = { ...process.env, ...AGENT_ENV, CW_PROBE_KEEP: "keep-me" };
  const run = cp.spawnSync(process.execPath, [runner, "--concurrency", "1"], {
    cwd: temp,
    env: parentEnv,
    encoding: "utf8"
  });

  assert.equal(
    run.status,
    0,
    `runner must keep the smoke green despite agent env in its parent:\n${run.stdout}\n${run.stderr}`
  );
  assert.match(run.stdout, /PASS {2}agent-env-probe-smoke\.js/, "the probe smoke must run and PASS");

  process.stdout.write("run-all-agent-env-hermetic-smoke: ok\n");
} finally {
  fs.rmSync(temp, { recursive: true, force: true });
}
