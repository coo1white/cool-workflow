#!/usr/bin/env node

// cli-completion-bytes — `cw completion bash|zsh|fish` stdout, byte for
// byte, against captures in fixtures/cli-completion/<shell>.txt (raw stdout,
// no header line). cli-completion.case.mjs checks the shape and the word
// list; this case pins the whole script, so any later change to it (a new
// command word, a changed line) is a changed pin that `npm run pola:check`
// holds to the operator's record. Also: exit 0, nothing on stderr.

import fs from "node:fs";
import path from "node:path";
import { run, caseMain, assert } from "../lib.mjs";

const FIXTURE_DIR = path.join(import.meta.dirname, "fixtures", "cli-completion");

caseMain(() => {
  for (const shell of ["bash", "zsh", "fish"]) {
    const expected = fs.readFileSync(path.join(FIXTURE_DIR, `${shell}.txt`), "utf8");
    const result = run(["completion", shell]);
    assert.equal(result.status, 0, `completion ${shell} exits 0`);
    assert.equal(result.stderr, "", `completion ${shell} writes nothing to stderr`);
    assert.equal(result.stdout, expected, `completion ${shell}: stdout is byte-identical to fixtures/cli-completion/${shell}.txt`);
  }
});
