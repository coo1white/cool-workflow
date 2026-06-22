#!/usr/bin/env node
"use strict";

// cli-io-smoke: the shared CLI io helpers extracted from command-surface.ts into
// src/cli/io.ts. Pin their behaviour so the god-object extraction stays exact.

const assert = require("node:assert/strict");
const { required, optionalArg, printJson, wantsJson } = require("../dist/cli/io");

// required: passthrough vs fail-with-tip.
assert.equal(required("run-1", "run id"), "run-1");
assert.throws(() => required(undefined, "run id"), /Missing run id\./);
assert.throws(() => required("", "run id"), /Missing run id\./);

// optionalArg: trim non-empty strings, else undefined.
assert.equal(optionalArg("  x  "), "x");
assert.equal(optionalArg("y"), "y");
assert.equal(optionalArg(""), undefined);
assert.equal(optionalArg("   "), undefined);
assert.equal(optionalArg(42), undefined);
assert.equal(optionalArg(undefined), undefined);

// wantsJson: --json or --format json.
assert.equal(wantsJson({ json: true }), true);
assert.equal(wantsJson({ format: "json" }), true);
assert.equal(wantsJson({ format: "human" }), false);
assert.equal(wantsJson({}), false);

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
