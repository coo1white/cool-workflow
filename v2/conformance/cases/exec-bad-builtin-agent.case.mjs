#!/usr/bin/env node

// An unknown builtin:<name> fails closed with the exact refusal text, never
// a silent fall-through to "no agent configured".

import { run, gitRepo, caseMain, assert } from "../lib.mjs";

caseMain(() => {
  const repo = gitRepo({ "a.txt": "hello\n" });
  const bad = run(["-q", "hi", "--json"], { cwd: repo, env: { CW_AGENT_COMMAND: "builtin:doesnotexist" } });
  assert.equal(bad.status, 1, bad.stdout);
  assert.equal(bad.stdout, "");
  assert.equal(
    bad.stderr,
    'cw: Unknown builtin agent template "doesnotexist" — available: claude, codex, gemini, gemini-cli, opencode, deepseek, muse, copilot, antigravity, grok\n'
  );
});
