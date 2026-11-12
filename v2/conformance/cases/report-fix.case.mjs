#!/usr/bin/env node

// cw fix — same checks as doctor, but prints ONLY the fix commands (or
// "No fixes needed.").  The code has no --json branch for fix — this case
// pins that ACTUAL behavior. (docs/fix.7.md used to promise --json; the
// doc was fixed 2026-07-13 to match the code.)

import fs from "node:fs";
import path from "node:path";
import { run, freshDir, caseMain, assert } from "../lib.mjs";

// No git on PATH, auto-detect off: agent=warn + git=warn, deterministic.
const ENV = { PATH: path.dirname(process.execPath), CW_NO_AUTO_AGENT: "1" };

caseMain(() => {
  const cwd = freshDir("cwd");

  // --- warn scenario: two numbered fix lines ---
  const fixed = run(["fix"], { cwd, env: ENV });
  assert.equal(fixed.status, 0, "warn-only must not fail fix's exit code");
  assert.equal(fixed.stderr, "");
  assert.equal(
    fixed.stdout,
    "Fix Commands\n" +
      '  1. Install an agent CLI such as Claude Code, then add -claude to your cw command, for one: cw -q "your question" -claude (or set CW_AGENT_COMMAND=builtin:claude). -codex, -gemini and -opencode work too.\n' +
      "  2. Install git (e.g. `brew install git`) if you want commit provenance.\n" +
      "\n"
  );

  // --- --json is not a fix option (doc fixed 2026-07-13): the code has no
  // --json branch for fix. --json is silently ignored; the output is the
  // identical human fix-commands text, NOT valid JSON. ---
  const fixedJson = run(["fix", "--json"], { cwd, env: ENV });
  assert.equal(fixedJson.status, 0);
  assert.equal(fixedJson.stdout, fixed.stdout, "cw fix --json has no JSON branch; text is unchanged");
  assert.throws(
    () => JSON.parse(fixedJson.stdout),
    "cw fix --json output is plain text, not JSON — pins the doc/code drift"
  );

  // --- cw doctor --fix must match cw fix exactly ---
  const doctorFix = run(["doctor", "--fix"], { cwd, env: ENV });
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

  // --- a third warning adds a third numbered step ---
  const broken = freshDir("broken");
  fs.mkdirSync(path.join(broken, ".cw", "runs", "r1"), { recursive: true });
  fs.writeFileSync(path.join(broken, ".cw", "runs", "r1", "state.json"), "{bad");
  const three = run(["fix"], { cwd: broken, env: ENV });
  assert.equal(three.status, 0);
  assert.equal(
    three.stdout,
    "Fix Commands\n" +
      '  1. Install an agent CLI such as Claude Code, then add -claude to your cw command, for one: cw -q "your question" -claude (or set CW_AGENT_COMMAND=builtin:claude). -codex, -gemini and -opencode work too.\n' +
      "  2. Install git (e.g. `brew install git`) if you want commit provenance.\n" +
      "  3. Restore state.json from a backup, or remove the run directory and start a new run.\n" +
      "\n"
  );
});
