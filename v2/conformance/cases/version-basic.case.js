#!/usr/bin/env node
"use strict";

// version — prints the bare version on stdout, exit 0; --json is the
// same bare value; a command that does not exist fails with the fixed
// two-line stderr help pointer and exit 1.

const { run, caseMain, assert } = require("../lib");

caseMain(() => {
  const v = run(["version"]);
  assert.equal(v.status, 0);
  assert.match(v.stdout, /^\d+\.\d+\.\d+\n$/);
  assert.equal(v.stderr, "");

  const vj = run(["version", "--json"]);
  assert.equal(vj.status, 0);
  assert.equal(vj.stdout, v.stdout);

  const bad = run(["nosuchcommand"]);
  assert.equal(bad.status, 1);
  assert.equal(bad.stdout, "");
  assert.equal(bad.stderr, "cw: Unknown command: nosuchcommand\n  Try: cw help\n");
});
