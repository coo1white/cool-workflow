#!/usr/bin/env node
"use strict";

// A broken vendor registry used to fall back to hard-coded legacy shapes.
// It must now stop before any generated file is written.

const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const pluginRoot = path.resolve(__dirname, "..");
const generator = path.join(pluginRoot, "scripts", "gen-manifests.js");

function filesUnder(root) {
  const found = [];
  function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const absolute = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(absolute);
      else found.push(path.relative(root, absolute));
    }
  }
  walk(root);
  return found.sort();
}

function fixture(source) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cw-manifest-registry-"));
  const scripts = path.join(root, "plugins", "cool-workflow", "scripts");
  const manifest = path.join(root, "plugins", "cool-workflow", "manifest");
  fs.mkdirSync(scripts, { recursive: true });
  fs.mkdirSync(manifest, { recursive: true });
  fs.copyFileSync(generator, path.join(scripts, "gen-manifests.js"));
  fs.writeFileSync(path.join(manifest, "plugin.manifest.json"), `${JSON.stringify(source, null, 2)}\n`);
  return root;
}

function run(root) {
  return spawnSync(process.execPath, [path.join(root, "plugins", "cool-workflow", "scripts", "gen-manifests.js")], {
    cwd: root,
    encoding: "utf8",
  });
}

const invalid = [
  ["missing", {}],
  ["null", { vendors: null }],
  ["array", { vendors: [] }],
  ["empty", { vendors: {} }],
  ["zero outputs", { vendors: { test: { outputs: [] } } }],
  ["bad output", { vendors: { test: { outputs: [null] } } }],
  ["missing path", { vendors: { test: { outputs: [{ json: { ok: true } }] } } }],
  ["missing json", { vendors: { test: { outputs: [{ path: "generated/test.json" }] } } }],
];

for (const [name, source] of invalid) {
  const root = fixture(source);
  const before = filesUnder(root);
  const result = run(root);
  assert.notEqual(result.status, 0, `${name}: broken registry must fail`);
  assert.equal(result.stdout, "", `${name}: failure must not write data to stdout`);
  assert.match(result.stderr, /^gen-manifests: /, `${name}: failure has one clear diagnostic`);
  assert.deepEqual(filesUnder(root), before, `${name}: failure must not write a partial manifest`);
  fs.rmSync(root, { recursive: true, force: true });
}

{
  const root = fixture({
    targets: { test: { pluginRootVar: "./" } },
    vendors: { test: { outputs: [{ path: "generated/test.json", json: { name: "ok" } }] } },
  });
  const result = run(root);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stderr, "");
  assert.deepEqual(JSON.parse(result.stdout), {
    ok: true,
    mode: "write",
    results: [{ path: "generated/test.json", status: "written" }],
  });
  assert.equal(fs.readFileSync(path.join(root, "generated", "test.json"), "utf8"), '{\n  "name": "ok"\n}\n');
  fs.rmSync(root, { recursive: true, force: true });
}

process.stdout.write("manifest-vendor-registry-failclosed-smoke: ok\n");
