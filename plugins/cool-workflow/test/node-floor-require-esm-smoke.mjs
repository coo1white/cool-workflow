#!/usr/bin/env node
// node-floor-require-esm-smoke — the Node floor (slim-and-esm step 4, D4).
// Pins: package.json engines.node is ">=22.13.0"; the Node running the suite
// is at or above it; `cw doctor`'s node check names the same floor; and, on
// the Node in use, a CommonJS caller loads an ES module `dist/` with
// require() — no flag, exit 0, the right exports, and NOTHING on stderr.
//
// Why 22.13.0 (measured 2026-10-17 with the node-linux-x64 builds from npm,
// a CJS file doing require() of a "type": "module" file):
//   22.11.0  ERR_REQUIRE_ESM (exit 1)
//   22.12.0  loads, but writes an ExperimentalWarning to stderr (463 bytes)
//   22.13.0  loads, 0 bytes on stderr; the same on 22.22.0 and 24.22.0
// Step 5 makes dist/ an ES module that the CommonJS tests and scripts still
// require(); a warning on every load would break the Rule of Silence.
//
// Included in `npm test`.

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const pluginRoot = path.resolve(import.meta.dirname, "..");
const pkg = JSON.parse(fs.readFileSync(path.join(pluginRoot, "package.json"), "utf8"));
const FLOOR = ">=22.13.0";

// ---- 1. one floor: engines, the running Node, doctor ------------------------
assert.equal(pkg.engines && pkg.engines.node, FLOOR, "package.json engines.node is the measured floor");
const [major, minor] = process.version.slice(1).split(".").map(Number);
assert.ok(major > 22 || (major === 22 && minor >= 13), `the suite runs on Node ${process.version}, below the floor ${FLOOR}`);
import { runDoctor } from "../dist/shell/doctor.js";
const home = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "cw-node-floor-home-")));
const nodeCheck = runDoctor({}, { ...process.env, CW_HOME: home }, home).checks.find((c) => c.name === "node");
assert.equal(nodeCheck.status, "ok");
assert.equal(nodeCheck.detail, `Node ${process.version} (>= 22.13).`, "doctor names the same floor as engines");

// ---- 2. require() of an ES module dist/, silent ----------------------------
function esmDist(root) {
  const dist = path.join(root, "dist");
  fs.mkdirSync(dist, { recursive: true });
  fs.writeFileSync(path.join(dist, "package.json"), '{ "type": "module" }\n');
  fs.writeFileSync(path.join(dist, "version.js"), `export const CW_VERSION = ${JSON.stringify(pkg.version)};\n`);
  fs.writeFileSync(path.join(dist, "cli.js"), [
    'import { createRequire } from "node:module";',
    'import { CW_VERSION } from "./version.js";',
    "const require = createRequire(import.meta.url);",
    'const path = require("node:path");',
    "export const version = CW_VERSION;",
    "export const here = path.basename(import.meta.dirname);",
    "export default function main() { return `cw ${CW_VERSION}`; }",
    ""
  ].join("\n"));
  return dist;
}

function load(caller, env) {
  const r = spawnSync(process.execPath, [caller], { encoding: "utf8", env });
  return { code: r.status, out: r.stdout || "", err: r.stderr || "" };
}

const env = { ...process.env };
delete env.NODE_OPTIONS;
delete env.NODE_NO_WARNINGS;

// a CJS caller beside dist/ (a repo checkout: tests, scripts, conformance)
// and one under node_modules/ (an npm or Homebrew install).
const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "cw-node-floor-")));
const checkout = path.join(base, "checkout");
const installed = path.join(base, "app", "node_modules", "cool-workflow");
for (const root of [checkout, installed]) {
  esmDist(root);
  fs.writeFileSync(path.join(root, "package.json"), '{ "type": "commonjs" }\n');
  const caller = path.join(root, "caller.js");
  fs.writeFileSync(caller, [
    '"use strict";',
    'const cli = require("./dist/cli.js");',
    "process.stdout.write(JSON.stringify({ version: cli.version, here: cli.here, main: cli.default() }) + \"\\n\");",
    ""
  ].join("\n"));
  const r = load(caller, env);
  assert.equal(r.code, 0, `require() of an ES module must load on ${process.version}:\n${r.err}`);
  assert.equal(r.err, "", `require() of an ES module must write nothing to stderr on ${process.version}; got:\n${r.err}`);
  assert.deepEqual(JSON.parse(r.out), { version: pkg.version, here: "dist", main: `cw ${pkg.version}` });
}

// ---- 3. bite proof: a warning on stderr is caught --------------------------
// A caller that warns the same way Node 22.12 does must fail the stderr check
// above, so an empty-stderr pass is not a check that cannot fail.
{
  const caller = path.join(checkout, "warns.js");
  fs.writeFileSync(caller, '"use strict";\nprocess.emitWarning("loading ES Module using require()", "ExperimentalWarning");\nrequire("./dist/cli.js");\n');
  const r = load(caller, env);
  assert.equal(r.code, 0);
  assert.match(r.err, /ExperimentalWarning/, "a warning on stderr is seen");
}

fs.rmSync(base, { recursive: true, force: true });
fs.rmSync(home, { recursive: true, force: true });
console.log("node-floor-require-esm-smoke: ok");
