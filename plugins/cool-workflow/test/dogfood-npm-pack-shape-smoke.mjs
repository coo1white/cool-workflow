#!/usr/bin/env node
// The release-cut dogfood's npm-pack-dry-run check reads `npm pack --json`.
// npm <= 11 prints an array of package entries; npm 12 prints an object keyed
// by package name. Both must pass; a .cw leak and an empty or odd shape must
// fail closed. A fake `npm` on PATH prints each shape.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { packDryRunCommand } from "../scripts/dogfood-release.mjs";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cw-npm-pack-shape-"));
const entry = (files) => ({ name: "cool-workflow", filename: "cool-workflow-0.0.0.tgz", entryCount: files.length, files: files.map((p) => ({ path: p, size: 1, mode: 420 })) });

function runWith(stdoutJson) {
  const bin = path.join(tmp, `bin-${Math.random().toString(16).slice(2)}`);
  fs.mkdirSync(bin);
  const fake = path.join(bin, "npm");
  fs.writeFileSync(fake, `#!${process.execPath}\nprocess.stdout.write(${JSON.stringify(stdoutJson)});\n`, { mode: 0o755 });
  const [cmd, args] = packDryRunCommand();
  return spawnSync(cmd, args, { encoding: "utf8", env: { ...process.env, PATH: `${bin}${path.delimiter}${process.env.PATH}` } });
}

try {
  const okFiles = ["package.json", "dist/cli.js"];

  const npm11 = runWith(JSON.stringify([entry(okFiles)]));
  assert.equal(npm11.status, 0, `npm 11 array shape must pass: ${npm11.stderr}`);
  assert.match(npm11.stdout, /"checked":"npm-pack-dry-run","entryCount":2/);

  const npm12 = runWith(JSON.stringify({ "cool-workflow": entry(okFiles) }));
  assert.equal(npm12.status, 0, `npm 12 object shape must pass: ${npm12.stderr}`);
  assert.match(npm12.stdout, /"checked":"npm-pack-dry-run","entryCount":2/);

  const leak = runWith(JSON.stringify({ "cool-workflow": entry(["package.json", ".cw/runs/x/state.json"]) }));
  assert.equal(leak.status, 1, "a .cw file in the pack must fail");
  assert.match(leak.stderr, /npm pack includes \.cw files/);

  for (const odd of ["{}", "[]", JSON.stringify({ "cool-workflow": { name: "cool-workflow" } })]) {
    const r = runWith(odd);
    assert.equal(r.status, 1, `odd shape ${odd} must fail closed`);
    assert.match(r.stderr, /no package entry with a files list/);
  }

  console.log("dogfood-npm-pack-shape-smoke: ok");
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}
