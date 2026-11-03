#!/usr/bin/env node
// test-layout-smoke — holds the shape of test/, the way pixelcrosshair's
// docs-layout test holds its docs tree. Included in `npm test`.
//
// The rule: a unit test (*.test.mjs) lives in a folder that mirrors the src/
// folder it tests (src/core/state/run-paths.ts -> test/core/state/), so a
// reader finds the test next to where the code sits. Smokes (*-smoke.mjs) are
// black-box runs of the CLI and stay flat in test/, since run-all.mjs
// discovers only test/*-smoke.mjs — a smoke put in a sub folder would never
// run, and this smoke fails closed on that. A test with the old CommonJS
// name (*-smoke.js, *.test.js) is never run by either runner, so it is
// refused too (slim-and-esm step 7). test/helpers/ holds the shared test
// set-up (refactor phase 3) and its own *.test.mjs; it mirrors no src/
// folder, and a smoke there would never run, so it holds no *-smoke.mjs.
//
// 1. positive: the real test/ tree passes.
// 2. teeth: a throwaway tree with each kind of fault is refused, one
//    finding per fault.

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const pluginRoot = path.resolve(import.meta.dirname, "..");

// test/ top-level folders that are not unit-test mirrors of src/.
const NON_MIRROR_DIRS = new Set(["fixtures", "helpers", "node_modules"]);

function checkTestLayout(testDir, srcDir) {
  const findings = [];
  const walk = (dir, rel) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const relPath = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        if (!rel && entry.name === "helpers") {
          checkHelpers(path.join(dir, entry.name), relPath);
          continue;
        }
        if (!rel && NON_MIRROR_DIRS.has(entry.name)) continue;
        if (!fs.existsSync(path.join(srcDir, relPath))) {
          findings.push(`test/${relPath}/: no src/${relPath}/ to mirror`);
        }
        walk(path.join(dir, entry.name), relPath);
        continue;
      }
      if (!rel) {
        if (entry.name.endsWith(".test.mjs")) {
          findings.push(`test/${relPath}: unit test at the top of test/; move it to the folder that mirrors its src/ folder`);
        } else if (entry.name.endsWith("-smoke.js") || entry.name.endsWith(".test.js")) {
          findings.push(`test/${relPath}: old .js name; the runners read only .mjs, so it never runs`);
        }
        continue;
      }
      if (entry.name.endsWith("-smoke.mjs")) {
        findings.push(`test/${relPath}: smoke in a sub folder never runs (run-all.mjs reads test/*-smoke.mjs only)`);
      } else if (!entry.name.endsWith(".test.mjs")) {
        findings.push(`test/${relPath}: only *.test.mjs files belong in a src/ mirror folder`);
      }
    }
  };
  const checkHelpers = (dir, rel) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const relPath = `${rel}/${entry.name}`;
      if (entry.isDirectory()) checkHelpers(path.join(dir, entry.name), relPath);
      else if (entry.name.endsWith("-smoke.mjs")) {
        findings.push(`test/${relPath}: smoke in test/helpers/ never runs; helpers hold shared code and its *.test.mjs only`);
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
  touch(path.join(testDir, "fine-smoke.mjs"));
  touch(path.join(testDir, "run-all.mjs"));
  touch(path.join(testDir, "fixtures", "runs", "x", "state.json"));
  touch(path.join(testDir, "core", "state", "fine.test.mjs"));
  touch(path.join(testDir, "helpers", "workspace.mjs"));
  touch(path.join(testDir, "helpers", "helpers.test.mjs"));
  assert.deepEqual(checkTestLayout(testDir, srcDir), [], "a clean tree has no findings");

  touch(path.join(testDir, "flat.test.mjs"));
  touch(path.join(testDir, "core", "state", "hidden-smoke.mjs"));
  touch(path.join(testDir, "core", "state", "helper.js"));
  touch(path.join(testDir, "nowhere", "orphan.test.mjs"));
  touch(path.join(testDir, "old-smoke.js"));
  touch(path.join(testDir, "helpers", "stray-smoke.mjs"));
  assert.deepEqual(checkTestLayout(testDir, srcDir).sort(), [
    "test/core/state/helper.js: only *.test.mjs files belong in a src/ mirror folder",
    "test/core/state/hidden-smoke.mjs: smoke in a sub folder never runs (run-all.mjs reads test/*-smoke.mjs only)",
    "test/flat.test.mjs: unit test at the top of test/; move it to the folder that mirrors its src/ folder",
    "test/helpers/stray-smoke.mjs: smoke in test/helpers/ never runs; helpers hold shared code and its *.test.mjs only",
    "test/nowhere/: no src/nowhere/ to mirror",
    "test/old-smoke.js: old .js name; the runners read only .mjs, so it never runs",
  ]);

  process.stdout.write("test-layout-smoke: ok\n");
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}
