#!/usr/bin/env node
"use strict";

// test-layout-smoke — holds the shape of test/, the way pixelcrosshair's
// docs-layout test holds its docs tree. Included in `npm test`.
//
// The rule: a unit test (*.test.js) lives in a folder that mirrors the src/
// folder it tests (src/core/state/run-paths.ts -> test/core/state/), so a
// reader finds the test next to where the code sits. Smokes (*-smoke.js) are
// black-box runs of the CLI and stay flat in test/, since run-all.js
// discovers only test/*-smoke.js — a smoke put in a sub folder would never
// run, and this smoke fails closed on that.
//
// 1. positive: the real test/ tree passes.
// 2. teeth: a throwaway tree with each kind of fault is refused, one
//    finding per fault.

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const pluginRoot = path.resolve(__dirname, "..");

// test/ top-level folders that are not unit-test mirrors of src/.
const NON_MIRROR_DIRS = new Set(["fixtures", "node_modules"]);

function checkTestLayout(testDir, srcDir) {
  const findings = [];
  const walk = (dir, rel) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const relPath = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        if (!rel && NON_MIRROR_DIRS.has(entry.name)) continue;
        if (!fs.existsSync(path.join(srcDir, relPath))) {
          findings.push(`test/${relPath}/: no src/${relPath}/ to mirror`);
        }
        walk(path.join(dir, entry.name), relPath);
        continue;
      }
      if (!rel) {
        if (entry.name.endsWith(".test.js")) {
          findings.push(`test/${relPath}: unit test at the top of test/; move it to the folder that mirrors its src/ folder`);
        }
        continue;
      }
      if (entry.name.endsWith("-smoke.js")) {
        findings.push(`test/${relPath}: smoke in a sub folder never runs (run-all.js reads test/*-smoke.js only)`);
      } else if (!entry.name.endsWith(".test.js")) {
        findings.push(`test/${relPath}: only *.test.js files belong in a src/ mirror folder`);
      }
    }
  };
  walk(testDir, "");
  return findings;
}

// 1. The real tree.
const realFindings = checkTestLayout(path.join(pluginRoot, "test"), path.join(pluginRoot, "src"));
assert.deepEqual(realFindings, [], "the real test/ tree must hold the layout");

// 2. Teeth: one finding per fault, nothing else.
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cw-test-layout-"));
try {
  const testDir = path.join(tmp, "test");
  const srcDir = path.join(tmp, "src");
  const touch = (file) => {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, "");
  };
  fs.mkdirSync(path.join(srcDir, "core", "state"), { recursive: true });
  touch(path.join(testDir, "fine-smoke.js"));
  touch(path.join(testDir, "run-all.js"));
  touch(path.join(testDir, "fixtures", "runs", "x", "state.json"));
  touch(path.join(testDir, "core", "state", "fine.test.js"));
  assert.deepEqual(checkTestLayout(testDir, srcDir), [], "a clean tree has no findings");

  touch(path.join(testDir, "flat.test.js"));
  touch(path.join(testDir, "core", "state", "hidden-smoke.js"));
  touch(path.join(testDir, "core", "state", "helper.js"));
  touch(path.join(testDir, "nowhere", "orphan.test.js"));
  assert.deepEqual(checkTestLayout(testDir, srcDir).sort(), [
    "test/core/state/helper.js: only *.test.js files belong in a src/ mirror folder",
    "test/core/state/hidden-smoke.js: smoke in a sub folder never runs (run-all.js reads test/*-smoke.js only)",
    "test/flat.test.js: unit test at the top of test/; move it to the folder that mirrors its src/ folder",
    "test/nowhere/: no src/nowhere/ to mirror",
  ]);

  process.stdout.write("test-layout-smoke: ok\n");
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}
