#!/usr/bin/env node
// core-format-recovery-hint — pins recoveryHint(message)'s content-based
// lookup from an error message to ONE copy-pasteable follow-up command.
// Pure function, no IO — a plain require + assert is enough.
//
// Evidence: src/core/format/recovery-hint.ts.

import assert from "node:assert/strict";
import { recoveryHint } from "../../../dist/core/format/recovery-hint.js";

// "run not found" or an old run -> start a new one.
{
  assert.equal(recoveryHint("Run not found: abc123"), 'cw -q "<question>"');
  assert.equal(recoveryHint("Run old-run was made by an older cw and cannot be read by this one"), 'cw -q "<question>"');
}

// A missing question -> the -q form.
{
  assert.equal(recoveryHint("Missing required input: question"), 'cw -q "<question>"');
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
  assert.equal(recoveryHint("/x is not a git project. Run cw inside a project, or pass --repo <path>."), 'cw -q "<question>" -dir <project-folder>', "a folder that is not a git project points at the -dir flag");
}

// No pattern matches -> undefined, never a wrong guess.
{
  const hint = recoveryHint("something totally unrelated went wrong");
  assert.equal(hint, undefined, "a message with no matching pattern must return undefined, not a guess");
}

process.stdout.write("core-format-recovery-hint: ok\n");
