#!/usr/bin/env node
// script-spawn-argv-smoke — the build and release scripts start npm and gh
// through scripts/spawn-argv.mjs, so on Windows a .cmd shim runs as
// `node <script>` with no shell. Fault: Windows CI, every script step that
// ran `npm` or a gh stub failed at once (Node will not start a .cmd with no
// shell), so dist-drift-check, release-gate, release-flow and the rest were
// red. The Windows branch is run here on any host by naming the platform.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { tmpDir } from "./helpers/workspace.mjs";
import { writeProgram } from "./helpers/program.mjs";

const pluginRoot = path.resolve(import.meta.dirname, "..");
const { scriptArgv, spawnSync } = await import(pathToFileURL(path.join(pluginRoot, "scripts", "spawn-argv.mjs")).href);
const { spawnArgv } = await import(pathToFileURL(path.join(pluginRoot, "dist", "core", "util", "cli-args.js")).href);

const bin = tmpDir("cw-script-spawn-argv-");
const gh = writeProgram(bin, "gh", "process.stdout.write('ok');\n", { platform: "win32" });
// This host's files, read in Windows spelling: `\\` as `/`, suffixes in
// lower case (Windows file names ignore case; this host's may not).
const posix = (file) => file.replace(/\\/g, "/");
const winResolve = (b, a, e, p, n, io) => spawnArgv(b, a, e, p, n, { isFile: (f) => io.isFile(posix(f)), readText: (f) => io.readText(posix(f)) });
const env = { Path: bin.replace(/\//g, "\\"), PATHEXT: ".exe;.cmd" };
const start = (binary, args) => {
  const r = scriptArgv(binary, args, env, "win32", winResolve);
  return { binary: r.binary, args: [posix(r.args[0]), ...r.args.slice(1)] };
};

// Windows: `gh` on Path is gh.cmd, an npm-style shim; it starts as node <script>.
assert.deepEqual(start("gh", ["release", "view"]), { binary: process.execPath, args: [gh, "release", "view"] });
// Windows: a stub named by path (CW_RELEASE_FLOW_GH_CMD and friends) finds its .cmd too.
assert.deepEqual(start(gh.replace(/\//g, "\\"), ["auth", "status"]), { binary: process.execPath, args: [gh, "auth", "status"] });
// Off Windows the argv is left as typed.
assert.deepEqual(scriptArgv("gh", ["x"], env, "linux", spawnArgv), { binary: "gh", args: ["x"] });

// The drop-in still runs a program on this host.
const r = spawnSync(process.execPath, ["-e", "process.stdout.write('ok')"], { encoding: "utf8" });
assert.equal(r.status, 0);
assert.equal(r.stdout, "ok");

// Every build/release script that starts npm or gh goes through the helper.
for (const name of ["bump-version", "dist-drift-check", "release-auto-patch", "release-check", "release-ci-checks", "release-doctor", "release-flow", "release-gate", "release-oneclick", "release-preflight"]) {
  const text = fs.readFileSync(path.join(pluginRoot, "scripts", `${name}.mjs`), "utf8");
  assert.match(text, /from "\.\/spawn-argv\.mjs"/, `${name}.mjs must start children through spawn-argv.mjs`);
  assert.doesNotMatch(text, /from "node:child_process"/, `${name}.mjs must not start children with the bare node:child_process spawnSync`);
}

console.log("script-spawn-argv-smoke: ok");
