#!/usr/bin/env node
"use strict";

// cli-color-env — the color decision (src/term.ts colorEnabled, SPEC's
// "Color rule (exact)"): NO_COLOR/CW_NO_COLOR (any non-empty value) always
// wins and forces color off; otherwise FORCE_COLOR (defined, not "" and
// not "0") forces color on even off a TTY; otherwise off (spawnSync always
// gives a non-TTY stream, so the "else" branch is always off in this
// suite). The --no-color flag sets CW_NO_COLOR=1 and so reproduces the
// "NO_COLOR wins" branch even under FORCE_COLOR.
//
// lib.run()'s base env sets NO_COLOR=1 for every case in this suite (so
// other cases never see ANSI by accident) — this case explicitly clears it
// per-call to exercise the color-ON branches, since Object.assign(base,
// opts.env) lets opts.env override the base.

const { run, caseMain, assert } = require("../lib");

const ESC = /\x1b\[/;

caseMain(() => {
  // Baseline: no color env at all, no TTY (spawnSync) -> plain text.
  const plain = run(["help"], { env: { NO_COLOR: "" } });
  assert.equal(plain.status, 0);
  assert.ok(!ESC.test(plain.stdout), "no color env + no TTY must stay plain");

  // FORCE_COLOR alone (empty NO_COLOR/CW_NO_COLOR) forces color ON even
  // though stdout is piped, not a TTY. "Cool Workflow" is bold: \x1b[1m ... \x1b[0m.
  const forced = run(["help"], { env: { NO_COLOR: "", FORCE_COLOR: "1" } });
  assert.equal(forced.status, 0);
  assert.ok(ESC.test(forced.stdout), "FORCE_COLOR=1 must force color on");
  assert.ok(forced.stdout.startsWith("\x1b[1mCool Workflow\x1b[0m\n"), "the header must be bold");

  // FORCE_COLOR="0" does NOT force color on (spec: "not \"0\"").
  const forcedZero = run(["help"], { env: { NO_COLOR: "", FORCE_COLOR: "0" } });
  assert.ok(!ESC.test(forcedZero.stdout), 'FORCE_COLOR="0" must not force color on');

  // FORCE_COLOR="" (present but empty) does not force color on either.
  const forcedEmpty = run(["help"], { env: { NO_COLOR: "", FORCE_COLOR: "" } });
  assert.ok(!ESC.test(forcedEmpty.stdout), 'FORCE_COLOR="" must not force color on');

  // NO_COLOR wins over FORCE_COLOR (rule order: NO_COLOR checked first).
  const noColorWins = run(["help"], { env: { NO_COLOR: "1", FORCE_COLOR: "1" } });
  assert.ok(!ESC.test(noColorWins.stdout), "NO_COLOR must win over FORCE_COLOR");

  // CW_NO_COLOR behaves exactly like NO_COLOR.
  const cwNoColorWins = run(["help"], { env: { NO_COLOR: "", CW_NO_COLOR: "1", FORCE_COLOR: "1" } });
  assert.ok(!ESC.test(cwNoColorWins.stdout), "CW_NO_COLOR must win over FORCE_COLOR");

  // Error path: colors key off stderr, independent of stdout. Bold "cw:",
  // red message, dim "Try:" — proven on an unknown-command error.
  const forcedError = run(["badcmd"], { env: { NO_COLOR: "", FORCE_COLOR: "1" } });
  assert.equal(forcedError.status, 1);
  assert.equal(forcedError.stdout, "", "stdout must stay clean even on a colored error");
  assert.equal(
    forcedError.stderr,
    "\x1b[1mcw:\x1b[0m \x1b[31mUnknown command: badcmd\x1b[0m\n  \x1b[2mTry:\x1b[0m cw help\n"
  );

  // The --no-color FLAG sets CW_NO_COLOR=1 before dispatch, so it reproduces
  // the color-off branch even under FORCE_COLOR — this must be given AFTER
  // the command word (a bare --no-color as argv[0] is parsed as the command
  // itself, since only recognized top-level redirects run before the switch).
  const flagNoColor = run(["badcmd", "--no-color"], { env: { NO_COLOR: "", FORCE_COLOR: "1" } });
  assert.equal(flagNoColor.status, 1);
  assert.ok(!ESC.test(flagNoColor.stderr), "--no-color flag must turn color off even under FORCE_COLOR");
  assert.equal(flagNoColor.stderr, "cw: Unknown command: badcmd\n  Try: cw help\n");

  // stdout stays ANSI-free under FORCE_COLOR for a JSON/data command —
  // printJson never applies styling, regardless of color env.
  const jsonForced = run(["list"], { env: { NO_COLOR: "", FORCE_COLOR: "1" } });
  assert.ok(!ESC.test(jsonForced.stdout), "machine JSON stdout must never carry ANSI, even under FORCE_COLOR");
});
