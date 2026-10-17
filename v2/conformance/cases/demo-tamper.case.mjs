#!/usr/bin/env node

// demo tamper — the offline trust proof. Builds a signed ledger, makes
// three forgeries (ledger, signature, result), and every one must be
// caught with only the public key. Output is byte-stable with NO_COLOR,
// so the whole stdout is pinned to a fixture taken from the old build.

import fs from "node:fs";
import path from "node:path";
import { run, caseMain, assert } from "../lib.mjs";

caseMain(() => {
  const expected = fs.readFileSync(path.join(import.meta.dirname, "fixtures", "demo-tamper.stdout.txt"), "utf8");
  const r = run(["demo", "tamper"]);
  assert.equal(r.status, 0);
  assert.equal(r.stdout, expected);
});
