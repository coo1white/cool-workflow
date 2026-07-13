#!/usr/bin/env node
// core-format-recovery-hint — pins recoveryHint(message)'s content-based
// lookup from an error message to ONE copy-pasteable follow-up command.
// Pure function, no IO — a plain require + assert is enough.
//
// Evidence: src/core/format/recovery-hint.ts (moved out of cli/entry.ts so
// mcp/server.ts can reuse it without crossing the mcp/-may-never-import-
// cli/ layer rule scripts/purity-gate.js enforces).

const assert = require("node:assert/strict");
const { recoveryHint } = require("../dist/core/format/recovery-hint");

// "run not found" -> points at `cw run list`.
{
  const hint = recoveryHint("Run not found: abc123");
  assert.equal(hint, "cw run list", "a 'run not found' message must point at cw run list");
}

// "unknown command" (at the start of the message) -> points at `cw help`.
{
  const hint = recoveryHint("Unknown command: frobnicate");
  assert.equal(hint, "cw help", "an 'unknown command' message must point at cw help");
}

// "not configured" / "agent backend" -> points at `cw doctor`.
{
  assert.equal(recoveryHint("agent backend not configured"), "cw doctor");
  assert.equal(recoveryHint("No agent backend is configured."), "cw doctor");
}

// "missing" + "repo" -> points at the -dir flag form.
{
  const hint = recoveryHint("Missing required input --repo");
  assert.equal(hint, 'cw -q "<question>" -dir <project-folder>', "a missing --repo message must point at the -dir flag");
}

// "app" + "not found"/"not available" -> points at `cw app list`.
{
  assert.equal(recoveryHint("Workflow app not found: bogus-app"), "cw app list");
  assert.equal(recoveryHint("App is not available: bogus-app"), "cw app list");
}

// No pattern matches -> undefined, never a wrong guess.
{
  const hint = recoveryHint("something totally unrelated went wrong");
  assert.equal(hint, undefined, "a message with no matching pattern must return undefined, not a guess");
}

process.stdout.write("core-format-recovery-hint: ok\n");
