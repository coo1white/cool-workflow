#!/usr/bin/env node
// cli-args-findprogram — findProgram is the one PATH lookup in src/. It took
// the place of three copies (doctor's whichBinary, agent-config's
// detectAgentFromPath, the execution-backend probes' hasExecutable). CW runs
// on POSIX only (native Windows was cut: use WSL), so the lookup takes no
// platform and tries no PATHEXT suffix. This test drives the pure function
// with a fake file test, and holds the rule that no other src/ file walks
// PATH itself.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { findProgram } from "../../../dist/core/util/cli-args.js";

const files = (list) => (file) => list.includes(file);

// ":" between dirs, empty entries skipped, the first dir wins, no suffixes.
{
  const env = { PATH: "/a:/b::/c" };
  assert.equal(findProgram("node", env, files(["/b/node", "/c/node"])), "/b/node");
  assert.equal(findProgram("node", env, files([])), undefined);
  assert.equal(findProgram("node", {}, files(["/node"])), undefined, "no PATH, no match");
  assert.equal(findProgram("node", { ...env, PATHEXT: ".EXE" }, files(["/a/node.EXE"])), undefined, "PATHEXT is never tried");
}

// One home: no other src/ file splits PATH into dirs.
const SRC = path.resolve(import.meta.dirname, "../../../src");
const walk = (dir, out = []) => {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (p.endsWith(".ts")) out.push(p);
  }
  return out;
};
const copies = walk(SRC)
  .filter((f) => !f.endsWith(path.join("core", "util", "cli-args.ts")))
  .filter((f) => /\.PATH\s*\|\|\s*""\)\.split\(/.test(fs.readFileSync(f, "utf8")));
assert.deepEqual(copies.map((f) => path.relative(SRC, f)), [], "a PATH walk outside core/util/cli-args.ts: use findProgram");

process.stdout.write("cli-args-findprogram: ok\n");
