#!/usr/bin/env node
"use strict";

// cw fix — same checks as doctor, but prints ONLY the fix commands (or
// "No fixes needed."). Confirmed DOC DRIFT: docs/fix.7.md says --json
// works here, but the code has no --json branch for fix — it always
// prints the fix text. This case pins the ACTUAL behavior (code wins).

const path = require("node:path");
const { run, freshDir, caseMain, assert } = require("../lib");

function nodeOnlyPath() {
  return path.dirname(process.execPath);
}

caseMain(() => {
  const cwd = freshDir("cwd");

  // --- warn scenario: two numbered fix lines ---
  const fixed = run(["fix"], { cwd, env: { PATH: nodeOnlyPath() } });
  assert.equal(fixed.status, 0, "warn-only must not fail fix's exit code");
  assert.equal(fixed.stderr, "");
  assert.equal(
    fixed.stdout,
    "Fix Commands\n" +
      '  1. Pass --agent-command "claude -p", set $CW_AGENT_COMMAND, or use --agent-command builtin:claude.\n' +
      "  2. Install git (e.g. `brew install git`) if you want commit provenance.\n" +
      "\n"
  );

  // --- DOC DRIFT: docs/fix.7.md promises --json, but the code has no
  // --json branch for fix. --json is silently ignored; the output is the
  // identical human fix-commands text, NOT valid JSON. ---
  const fixedJson = run(["fix", "--json"], { cwd, env: { PATH: nodeOnlyPath() } });
  assert.equal(fixedJson.status, 0);
  assert.equal(fixedJson.stdout, fixed.stdout, "cw fix --json has no JSON branch; text is unchanged");
  assert.throws(
    () => JSON.parse(fixedJson.stdout),
    "cw fix --json output is plain text, not JSON — pins the doc/code drift"
  );

  // --- cw doctor --fix must match cw fix exactly ---
  const doctorFix = run(["doctor", "--fix"], { cwd, env: { PATH: nodeOnlyPath() } });
  assert.equal(doctorFix.stdout, fixed.stdout);
  assert.equal(doctorFix.status, 0);

  // --- clean setup: "No fixes needed." (only asserted when the ambient
  // PATH happens to have both git and an agent, since this case does not
  // control that dimension the way the warn scenario above does) ---
  const clean = run(["fix"], { cwd });
  if (clean.stdout === "No fixes needed.\n") {
    assert.equal(clean.status, 0);
    assert.equal(clean.stderr, "");
  }

  // --- fail scenario still exits 1, but fix's OWN body is still just fix
  // lines (agent + git warn, home-registry fail => 3 numbered steps) ---
  const blockerDir = freshDir("blocker-parent");
  const fs = require("node:fs");
  const blockerFile = path.join(blockerDir, "blocker");
  fs.writeFileSync(blockerFile, "x\n");
  const badHome = path.join(blockerFile, "cw-home");
  const failing = run(["fix"], { cwd, env: { PATH: nodeOnlyPath(), CW_HOME: badHome } });
  assert.equal(failing.status, 1, "a fail check makes fix exit 1 too");
  assert.equal(
    failing.stdout,
    "Fix Commands\n" +
      '  1. Pass --agent-command "claude -p", set $CW_AGENT_COMMAND, or use --agent-command builtin:claude.\n' +
      "  2. Install git (e.g. `brew install git`) if you want commit provenance.\n" +
      "  3. Set $CW_HOME to a writable directory, or fix the permissions.\n" +
      "\n"
  );
});
