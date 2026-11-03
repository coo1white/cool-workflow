// test/helpers/workspace.mjs — scratch folders for tests (refactor phase 3,
// project/docs/intent/2026-11-03-refactor-whole-tree.md).
//
// Consumers: test/helpers/helpers.test.mjs, test/concurrent-workflow-dsl-smoke.mjs.
//
// tmpDir(prefix): a new folder under os.tmpdir(), realpath'd (macOS /var ->
// /private/var), and taken away when the process exits, pass or fail.
// tmpWorkspace(prefix): tmpDir plus the README.md ("# target\n") that the
// stub agents name as evidence. This is the shape most local tmpWorkspace()
// copies had.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const made = [];
let hooked = false;

function removeAll() {
  for (const dir of made.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
}

export function tmpDir(prefix = "cw-test-") {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
  made.push(dir);
  if (!hooked) {
    hooked = true;
    process.on("exit", removeAll);
  }
  return dir;
}

export function tmpWorkspace(prefix = "cw-test-") {
  const work = tmpDir(prefix);
  fs.writeFileSync(path.join(work, "README.md"), "# target\n", "utf8");
  return work;
}
