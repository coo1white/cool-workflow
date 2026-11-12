#!/usr/bin/env node

// cli-help-topics — byte-exact help text for the root help and a sample of
// per-command help pages, diffed against captures taken from the old build
// (SPEC/cli-help/<cmd>.txt, copied into fixtures/cli-help/). Each fixture
// file starts with a "# exit: N" comment line, then the exact stdout bytes;
// this case strips that first line and compares the rest byte for byte.
//
// Also covers: `cw` bare, `cw --help` and `cw -h` are byte-aliases of `cw
// help`; `cw <verb> --help` is the same page as `cw help <verb>`; `help
// <cmd>` exits 0 even when <cmd> is not a real command, in contrast to
// `cw <cmd>` alone which exits 1. Fixtures re-captured from the batch-5
// build (2026-11-12), when the removed verbs' pages went away.

import fs from "node:fs";
import path from "node:path";
import { run, caseMain, assert } from "../lib.mjs";

const FIXTURE_DIR = path.join(import.meta.dirname, "fixtures", "cli-help");

function loadFixture(name) {
  const raw = fs.readFileSync(path.join(FIXTURE_DIR, `${name}.txt`), "utf8");
  const lines = raw.split("\n");
  assert.match(lines[0], /^# exit: \d+$/, `${name}.txt must start with a "# exit: N" line`);
  const exit = Number(lines[0].replace("# exit: ", ""));
  const body = lines.slice(1).join("\n");
  return { exit, body };
}

caseMain(() => {
  // Root help: bare `cw` and `cw --help` must byte-match `cw help`, and all
  // three must byte-match the captured fixture (no header line stripping
  // needed here — this file is the raw stdout capture, not a probed one).
  const rootFixture = fs.readFileSync(path.join(FIXTURE_DIR, "_root.txt"), "utf8");
  const bare = run([]);
  assert.equal(bare.status, 0);
  assert.equal(bare.stdout, rootFixture);

  const helpNoArgs = run(["help"]);
  assert.equal(helpNoArgs.status, 0);
  assert.equal(helpNoArgs.stdout, rootFixture);

  const dashDashHelp = run(["--help"]);
  assert.equal(dashDashHelp.status, 0);
  assert.equal(dashDashHelp.stdout, rootFixture);

  const dashH = run(["-h"]);
  assert.equal(dashH.status, 0);
  assert.equal(dashH.stdout, rootFixture);

  // Per-command help pages, byte-exact against captures.
  for (const cmd of ["version", "doctor", "fix", "report", "check", "demo"]) {
    const fx = loadFixture(cmd);
    const r = run(["help", cmd]);
    assert.equal(r.status, fx.exit, `cw help ${cmd}: exit code`);
    assert.equal(r.stdout, fx.body, `cw help ${cmd}: stdout body`);
    assert.equal(r.stderr, "", `cw help ${cmd}: stderr must be empty`);
  }

  // `cw <verb> --help` is the same page as `cw help <verb>`.
  const viaFlag = run(["report", "--help"]);
  const viaHelp = run(["help", "report"]);
  assert.equal(viaFlag.stdout, viaHelp.stdout);
  assert.equal(viaFlag.status, 0);

  // `help <cmd>` always exits 0, even for total garbage — in contrast to
  // `cw <cmd>` alone (with no `help` prefix) which exits 1.
  const helpGarbage = run(["help", "totally-not-a-command-xyz"]);
  assert.equal(helpGarbage.status, 0);
  assert.equal(helpGarbage.stdout, "Unknown command: totally-not-a-command-xyz\n  Try:  cw help   (list all commands)\n");

  const bareGarbage = run(["totally-not-a-command-xyz"]);
  assert.equal(bareGarbage.status, 1);
});
