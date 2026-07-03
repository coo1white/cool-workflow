#!/usr/bin/env node
"use strict";

// cli-quickstart-redirect — the `cw -q "text"` / `cw --question ...`
// top-level redirect to `quickstart` (SPEC/cli-surface.md: "cw -q "text"
// ... as the FIRST token: the positional is taken off and stored as
// options.question ... then the command becomes quickstart"). Uses the
// 1-worker end-to-end-golden-path app with no agent configured (narrow
// PATH) so every run blocks fast instead of spawning 14 architecture-review
// workers or touching a network.
//
// IMPORTANT: live-build correction to the spec text. The spec's prose says
// "cw --question=... with no command also becomes quickstart" — this does
// NOT hold against the running old build: `--question=value` (equals form)
// as argv[0] is NOT recognized as the redirect trigger and is instead
// dispatched as a literal (unknown) command. Only the space-separated
// form `--question value` as the exact first token triggers the redirect,
// matching parseArgv's own rule that "the first token is command, taken
// as-is" — the redirect check is a literal string match on argv[0], not a
// parsed-option lookup. This case pins the OLD BUILD's real behavior,
// which is the source of truth here, not the prose.

const { run, gitRepo, caseMain, assert } = require("../lib");

const NARROW_PATH = { PATH: "/usr/bin:/bin" };

caseMain(() => {
  const repo = gitRepo({ "a.txt": "hello\n" });

  // `-q "text"` as the very first token: command becomes quickstart,
  // question is consumed, default app is architecture-review (spec:
  // "plan(app, default architecture-review)"). Keep this one repo-only,
  // no --drive, so it stays a cheap plan-only quickstart check via --check.
  // --check exits 1 because "ok" is false here (no agent configured under
  // the narrow PATH) — that is itself proof the redirect reached quickstart
  // (a plain unknown-command error would give an EMPTY stdout, not a
  // structured check report).
  const qShort = run(["-q", "hello", "--check", "--json"], { cwd: repo, env: NARROW_PATH });
  assert.equal(qShort.status, 1);
  const qShortPayload = JSON.parse(qShort.stdout);
  assert.equal(qShortPayload.mode, "check");
  assert.equal(qShortPayload.appId, "architecture-review");
  assert.ok(qShortPayload.checks.some((c) => c.name === "question" && c.status === "ok"));

  // `--question value` (space form) as the first token ALSO redirects to
  // quickstart — proven the same way.
  const longForm = run(["--question", "hello", "--check", "--json"], { cwd: repo, env: NARROW_PATH });
  assert.equal(longForm.status, 1);
  const longFormPayload = JSON.parse(longForm.stdout);
  assert.equal(longFormPayload.mode, "check");
  assert.equal(longFormPayload.appId, "architecture-review");

  // `--question=value` (equals form) as the first token does NOT redirect:
  // it is dispatched as a literal unknown command and fails with exit 1
  // and EMPTY stdout — the clear black-box signature of "never reached
  // quickstart at all", unlike the two checks above.
  const eqForm = run(["--question=hello", "--check", "--json"], { cwd: repo, env: NARROW_PATH });
  assert.equal(eqForm.status, 1);
  assert.equal(eqForm.stdout, "");
  assert.match(eqForm.stderr, /^cw: Unknown command: --question=hello\n/);

  // Edge case: `-q <text>` consumes the positional into options.question,
  // but if `--question` is ALSO given later, the positional from `-q` is
  // NOT discarded — it stays a positional and becomes the quickstart appId
  // instead, while the LATER --question wins as the actual question text.
  const both = run(
    ["run", "end-to-end-golden-path", "--drive", "--question", "the real question", "--json"],
    { cwd: repo, env: NARROW_PATH }
  );
  assert.equal(both.status, 0);
  const bothPayload = JSON.parse(both.stdout);
  assert.equal(bothPayload.workflowId, "end-to-end-golden-path");

  const qWithLaterQuestion = run(
    ["-q", "end-to-end-golden-path", "--drive", "--question", "the real question", "--json"],
    { cwd: repo, env: NARROW_PATH }
  );
  assert.equal(qWithLaterQuestion.status, 0);
  const qWithLaterPayload = JSON.parse(qWithLaterQuestion.stdout);
  assert.equal(qWithLaterPayload.appId, "end-to-end-golden-path", "the -q positional must become appId when --question is also given");
  assert.equal(qWithLaterPayload.workflowId, "end-to-end-golden-path");
});
