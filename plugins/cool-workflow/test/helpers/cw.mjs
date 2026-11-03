// test/helpers/cw.mjs — run the built CLI as a child (refactor phase 3,
// project/docs/intent/2026-11-03-refactor-whole-tree.md).
//
// Consumers: every test that imports it (grep for helpers/cw.mjs).
//
// cw(args, { cwd, env, timeout }) spawns `node dist/cli.js ...args` with no
// shell and gives back the spawnSync result (utf8). env defaults to
// process.env. A child that runs past the timeout (default 120000 ms, the
// runner's own per-test limit) is killed, and stderr gets one line naming
// the test file and the args, so a hang says where it was.

import { spawnSync } from "node:child_process";
import path from "node:path";

export const CLI = path.resolve(import.meta.dirname, "..", "..", "dist", "cli.js");
export const CW_TIMEOUT_MS = 120000;

export function cw(args, { cwd, env = process.env, timeout = CW_TIMEOUT_MS } = {}) {
  const result = spawnSync(process.execPath, [CLI, ...args], { cwd, env, encoding: "utf8", timeout, shell: false });
  if (result.error && result.error.code === "ETIMEDOUT") {
    const test = path.basename(process.argv[1] || "?");
    process.stderr.write(`${test}: cw ${args.join(" ")} killed after ${timeout}ms\n`);
  }
  return result;
}
