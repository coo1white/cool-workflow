#!/usr/bin/env node
"use strict";

// CW_CODEX_SANDBOX given an unknown value must fail closed: exit 2, the
// exact usage/error line on stderr, and NEVER a silent downgrade to
// read-only (scripts-runtime.md invariant "Fail closed on config"). This is
// checked by invoking the codex wrapper script (scripts/agents/codex-agent.js)
// directly as a plain Node CLI, the same way CW itself spawns it — it is
// shipped, zero-dependency runtime JS, not the compiled dist/src under test
// elsewhere in this suite, and the invariant is byte-stable regardless of
// which build's dist/cli.js drives it.
//
// PATH is narrowed to just this fixture's own node symlink, so a real
// `codex` binary can never be found — proving the check happens BEFORE any
// attempt to spawn codex (no network, no real agent CLI, ever).

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { freshDir, caseMain, assert } = require("../lib");

const CODEX_AGENT = path.join(
  __dirname,
  "..",
  "..",
  "..",
  "plugins",
  "cool-workflow",
  "scripts",
  "agents",
  "codex-agent.js"
);

function narrowPathDir() {
  // A PATH containing ONLY a symlink to this same node binary — no other
  // executable (in particular no `codex`) can ever resolve.
  const d = freshDir("narrow-path");
  fs.symlinkSync(process.execPath, path.join(d, "node"));
  return d;
}

caseMain(() => {
  assert.ok(fs.existsSync(CODEX_AGENT), `expected the shipped wrapper at ${CODEX_AGENT}`);

  const work = freshDir("codex-sandbox-work");
  const inputPath = path.join(work, "input.md");
  const resultPath = path.join(work, "result.md");
  fs.writeFileSync(inputPath, "# Worker\n\n## Task\n\nirrelevant — never reached\n");

  const narrowPath = narrowPathDir();

  const r = spawnSync(process.execPath, [CODEX_AGENT, inputPath, resultPath], {
    cwd: work,
    env: {
      PATH: narrowPath,
      HOME: os.tmpdir(),
      NO_COLOR: "1",
      CW_CODEX_SANDBOX: "not-a-real-sandbox-mode",
    },
    encoding: "utf8",
    timeout: 15000,
  });

  assert.equal(r.status, 2, `expected exit 2, got ${r.status}; stderr=${r.stderr}`);
  assert.equal(
    r.stderr,
    'codex-agent: invalid CW_CODEX_SANDBOX="not-a-real-sandbox-mode" — expected one of read-only, workspace-write, danger-full-access\n'
  );
  assert.equal(r.stdout, "", "no report JSON on stdout for a bad-config refusal");

  // Fail-closed on config means no result.md was ever written and codex was
  // never spawned (proving the check runs before the codex exec attempt,
  // not after some doomed spawn attempt under the narrow PATH).
  assert.ok(!fs.existsSync(resultPath), "result.md must not be written on a CW_CODEX_SANDBOX config refusal");

  // A KNOWN sandbox value under the same narrow PATH does reach the point
  // of trying to spawn `codex` — which then fails with ENOENT (spawn
  // error), never exit 2 and never a fabricated success. This proves the
  // exit-2 path above is specific to the bad enum value, not just "codex
  // isn't installed".
  const okValue = spawnSync(process.execPath, [CODEX_AGENT, inputPath, resultPath], {
    cwd: work,
    env: {
      PATH: narrowPath,
      HOME: os.tmpdir(),
      NO_COLOR: "1",
      CW_CODEX_SANDBOX: "read-only",
    },
    encoding: "utf8",
    timeout: 15000,
  });
  assert.notEqual(okValue.status, 2, "a VALID sandbox value must not hit the config-refusal exit code");
  assert.notEqual(okValue.status, 0, "codex cannot really run under the narrow PATH, so this must not fabricate success");
  assert.ok(!fs.existsSync(resultPath), "no result.md when codex itself could never be spawned");
});
