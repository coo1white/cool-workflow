#!/usr/bin/env node
"use strict";

// cli-io-smoke: the shared CLI io helpers extracted from command-surface.ts into
// src/cli/io.ts. Pin their behaviour so the god-object extraction stays exact.
// required/optionalArg/wantsJson moved to core/util/cli-args.ts
// (architecture-review P2) — see cliargs-requiredoptionalargwantsjson.test.js
// for their coverage. Only printJson (and styledHelp, untested here) still
// live in cli/io.ts.

const assert = require("node:assert/strict");
const { printJson } = require("../dist/cli/io");

// printJson: pretty JSON to stdout, trailing newline, nothing to stderr.
const orig = process.stdout.write.bind(process.stdout);
let out = "";
process.stdout.write = (chunk) => { out += chunk; return true; };
try {
  printJson({ a: 1, b: ["x"] });
} finally {
  process.stdout.write = orig;
}
assert.equal(out, '{\n  "a": 1,\n  "b": [\n    "x"\n  ]\n}\n', "printJson writes 2-space pretty JSON + newline");

process.stdout.write("cli-io-smoke: ok\n");
