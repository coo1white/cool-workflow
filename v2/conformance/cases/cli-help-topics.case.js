#!/usr/bin/env node
"use strict";

// cli-help-topics — byte-exact help text for the root help and a sample of
// per-command help pages, diffed against captures taken from the old build
// (SPEC/cli-help/<cmd>.txt, copied into fixtures/cli-help/). Each fixture
// file starts with a "# exit: N" comment line, then the exact stdout bytes;
// this case strips that first line and compares the rest byte for byte.
//
// Also covers: `cw` bare and `cw --help` are byte-aliases of `cw help`;
// `cw help <verb>` for both a normal command and the `state`/`node` groups
// (sorted, padded subcommand rows); the `audit-run` alias page (an alias
// header line plus the target verb quickstart's own rows — the old
// self-pointing "Unknown command: audit-run / Did you mean: cw audit-run"
// quirk was fixed on purpose); `help <cmd>` exit code is always 0 even
// when <cmd> is not a real command, in contrast to `cw <cmd>` alone which
// exits 1.

const fs = require("node:fs");
const path = require("node:path");
const { run, caseMain, assert } = require("../lib");

const FIXTURE_DIR = path.join(__dirname, "fixtures", "cli-help");

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
  for (const cmd of ["help", "version", "list", "state", "doctor", "ledger", "clones", "node", "backend", "run", "quickstart", "man", "demo"]) {
    const fx = loadFixture(cmd);
    const r = run(["help", cmd]);
    assert.equal(r.status, fx.exit, `cw help ${cmd}: exit code`);
    assert.equal(r.stdout, fx.body, `cw help ${cmd}: stdout body`);
    assert.equal(r.stderr, "", `cw help ${cmd}: stderr must be empty`);
  }

  // `cw <verb> --help` is the same page as `cw help <verb>`.
  const viaFlag = run(["ledger", "--help"]);
  const viaHelp = run(["help", "ledger"]);
  assert.equal(viaFlag.stdout, viaHelp.stdout);
  assert.equal(viaFlag.status, 0);

  // Alias page: audit-run IS a real top-level command (a caseTokens alias
  // of quickstart) but has no help row of its own, so `help audit-run`
  // renders an alias header line plus quickstart's own rows. Before this
  // fix it fell to the unknown-command page AND the Did-you-mean line
  // suggested `cw audit-run` itself — a hint pointing at the very word
  // the user just typed.
  const auditRunFx = loadFixture("audit-run");
  const helpAuditRun = run(["help", "audit-run"]);
  assert.equal(helpAuditRun.status, 0);
  assert.equal(helpAuditRun.status, auditRunFx.exit);
  assert.equal(helpAuditRun.stdout, auditRunFx.body);
  assert.match(helpAuditRun.stdout, /^cw audit-run — alias of cw quickstart\n/);
  assert.match(helpAuditRun.stdout, /cw quickstart\s+ONE-COMMAND quickstart/);
  assert.doesNotMatch(helpAuditRun.stdout, /Unknown command/);
  assert.doesNotMatch(helpAuditRun.stdout, /Did you mean/);
  // The alias page's body below its own header line is byte-identical to
  // `cw help quickstart`'s body below its header — one source of rows.
  const helpQuickstart = run(["help", "quickstart"]);
  assert.equal(
    helpAuditRun.stdout.split("\n").slice(1).join("\n"),
    helpQuickstart.stdout.split("\n").slice(1).join("\n")
  );

  // `help <cmd>` always exits 0, even for total garbage — in contrast to
  // `cw <cmd>` alone (with no `help` prefix) which exits 1.
  const helpGarbage = run(["help", "totally-not-a-command-xyz"]);
  assert.equal(helpGarbage.status, 0);
  assert.equal(helpGarbage.stdout, "Unknown command: totally-not-a-command-xyz\n  Try:  cw help   (list all commands)\n");

  const bareGarbage = run(["totally-not-a-command-xyz"]);
  assert.equal(bareGarbage.status, 1);
});
