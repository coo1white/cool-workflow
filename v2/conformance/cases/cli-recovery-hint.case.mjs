#!/usr/bin/env node

// cli-recovery-hint — the top-level catch's recoveryHint map
// (SPEC/cli-surface.md "Top-level error path"): the `Try: <cmd>` tail is
// picked by substring match against the thrown message text, not by which
// command failed. This case proves both sides: messages that DO contain a
// matching substring get the expected hint, and one that does not gets NO
// Try: line at all, never a wrong guess.

import { run, caseMain, assert, freshDir } from "../lib.mjs";

caseMain(() => {
  // unknown command -> "cw help"
  const unknown = run(["nosuchcommand"]);
  assert.equal(unknown.status, 1);
  assert.equal(unknown.stderr, "cw: Unknown command: nosuchcommand\n  Try: cw help\n");

  // "run not found" -> start a new run.
  const cwd = freshDir("norun");
  const missingRun = run(["report", "no-such-run-id"], { cwd });
  assert.equal(missingRun.status, 1);
  assert.match(missingRun.stderr, /^cw: Run not found: no-such-run-id \(no \.cw\/runs\/no-such-run-id\/state\.json under .*\)\n {2}Try: cw -q "<question>"\n$/);

  // "not a git project" -> the -dir hint.
  const notGit = run(["-q", "what is this?"], { cwd: freshDir("notgit"), env: { CW_NO_AUTO_AGENT: "1" } });
  assert.equal(notGit.status, 1);
  assert.match(notGit.stderr, /is not a git project\. Run cw inside a project, or pass --repo <path>\.\n {2}Try: cw -q "<question>" -dir <project-folder>\n$/);

  // NEGATIVE proof: a usage error matches no hint, so it gets no Try: line.
  const noHint = run(["report", "bundle"]);
  assert.equal(noHint.status, 1);
  assert.equal(noHint.stderr, "cw: report bundle requires a run id (cw report bundle <run-id>)\n");
  assert.doesNotMatch(noHint.stderr, /Try:/);

  // Every error above kept stdout empty: the error path never writes there.
  for (const r of [unknown, missingRun, notGit, noHint]) assert.equal(r.stdout, "");
});
