#!/usr/bin/env node
// cli-args-findprogram — findProgram is the one PATH lookup in src/. It took
// the place of three copies (doctor's whichBinary, agent-config's
// detectAgentFromPath, the execution-backend probes' hasExecutable), and the
// probes copy did not try PATHEXT, so on Windows it never found node.exe.
// This test drives the pure function with a fake file test for both
// platforms, and holds the rule that no other src/ file walks PATH itself.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { findProgram } from "../../../dist/core/util/cli-args.js";

const files = (list) => (file) => list.includes(file);

// POSIX: no suffixes, ":" between dirs, the first dir wins.
{
  const env = { PATH: "/a:/b::/c" };
  assert.equal(findProgram("node", env, "linux", files(["/b/node", "/c/node"])), "/b/node");
  assert.equal(findProgram("node", env, "darwin", files([])), undefined);
  assert.equal(findProgram("node", {}, "linux", files(["/node"])), undefined, "no PATH, no match");
  assert.equal(findProgram("node", env, "linux", files(["/a/node.EXE"])), undefined, "no PATHEXT off win32");
}

// win32: ";" between dirs, each PATHEXT suffix in order, "\" joins.
{
  const env = { PATH: "C:\\tools;C:\\nodejs", PATHEXT: ".COM;.EXE;.CMD" };
  assert.equal(findProgram("node", env, "win32", files(["C:\\nodejs\\node.EXE"])), "C:\\nodejs\\node.EXE", "finds node.exe (the probes copy could not)");
  assert.equal(findProgram("claude", env, "win32", files(["C:\\tools\\claude.CMD", "C:\\nodejs\\claude.EXE"])), "C:\\tools\\claude.CMD", "the first dir wins over a later suffix");
  assert.equal(findProgram("node", env, "win32", files(["C:\\nodejs\\node"])), undefined, "a bare name is not tried on win32");
  assert.equal(findProgram("git", { PATH: "C:\\g" }, "win32", files(["C:\\g\\git.BAT"])), "C:\\g\\git.BAT", "PATHEXT defaults to .EXE;.CMD;.BAT");
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
