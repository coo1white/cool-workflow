#!/usr/bin/env node
// entry-recoveryhint — pins cli/entry.ts's recoveryHint(message): the
// content-based if-chain that maps a top-level error message to ONE
// copy-pasteable recovery command (see that file for the full chain and
// its own doc comment).
//
// This test adds coverage for the "Missing required input: question" case
// (the single most likely first error on the `cw quickstart` no-args path,
// e.g. `node scripts/cw.js quickstart` with no `-q`), plus a few of the
// existing branches so a future edit to the if-chain cannot silently
// shadow one case with another.

const assert = require("node:assert/strict");
const { recoveryHint } = require("../dist/cli/entry");

// The new case: a bare `cw quickstart` (no -q/--question) throws "Missing
// required input: question" (shell/pipeline.ts's required-input check).
// Before this change, recoveryHint had no branch for it, so the CLI's
// top-level catch printed the "cw: <message>" line with NO "Try:" line
// at all — the one gap most first-run users hit first.
{
  const hint = recoveryHint("Missing required input: question");
  assert.equal(hint, 'cw -q "<question>"', "a missing-question error hints the -q shorthand");
}

// Case is not sensitive (the chain lowercases the message first).
{
  const hint = recoveryHint("MISSING REQUIRED INPUT: QUESTION");
  assert.equal(hint, 'cw -q "<question>"', "the match is case-insensitive");
}

// The new branch must not fire on an unrelated "missing" message (it needs
// BOTH "missing required input" and "question").
{
  const hint = recoveryHint("Missing required input --repo");
  assert.notEqual(hint, 'cw -q "<question>"', "a missing-repo error must not get the missing-question hint");
  assert.equal(hint, 'cw -q "<question>" -dir <project-folder>', "a missing-repo error still gets its own existing hint");
}

// A few pre-existing branches must still return their own hints unchanged
// (the new branch must be an ADD, never a reorder that shadows an older
// branch).
{
  assert.equal(recoveryHint("Unknown command: foo"), "cw help", "unknown-command hint unchanged");
  assert.equal(recoveryHint("Agent backend not configured"), "cw doctor", "not-configured hint unchanged");
  assert.equal(recoveryHint("run not found: abc"), "cw run list", "run-not-found hint unchanged");
}

// A message that matches nothing still returns undefined (no bad guess).
{
  assert.equal(recoveryHint("some other failure"), undefined, "an unmatched message returns no hint");
}

process.stdout.write("entry-recoveryhint: ok\n");
