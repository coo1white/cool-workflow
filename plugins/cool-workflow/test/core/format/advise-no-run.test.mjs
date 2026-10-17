#!/usr/bin/env node
// advise-no-run — the fixed "no run selected" advice lives in
// core/format/recovery-hint.ts (a module every command loads), so
// `cw status` with no id no longer pulls in the run-reading modules
// (perf-ratchets PR 4). The payload is the same one every path gives.

import assert from "node:assert/strict";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { adviseNoRun } from "../../../dist/core/format/recovery-hint.js";
import * as operatorUx from "../../../dist/shell/operator-ux.js";
import { statusCli } from "../../../dist/shell/report-view-cli.js";
import { statusPayload } from "../../../dist/wiring/capability-table/registry-core.js";
import nodeModule from "node:module";

const expected = [
  {
    command: "cw plan <workflow-id> --repo <path>",
    reason: "No run id is available yet; create a workflow run before dispatching or recording evidence.",
    priority: "high",
  },
];
assert.deepEqual(adviseNoRun(), expected);
assert.equal(operatorUx.adviseNoRun, adviseNoRun, "operator-ux re-exports the one copy");
assert.deepEqual(statusCli(undefined, {}), { runId: null, nextActions: expected });
assert.deepEqual(statusPayload(undefined), { runId: null, nextActions: expected });

// The CLI path: same JSON bytes, and the run-reading modules stay unloaded.
const cli = path.resolve(import.meta.dirname, "..", "..", "..", "dist", "cli.js");
// dist/ is ES modules, which never reach require.cache, so the probe lists
// what it loads at module.registerHooks' load step (Node 22.15+).
if (typeof nodeModule.registerHooks !== "function") {
  process.stdout.write(`advise-no-run: ok (load probe skipped: module.registerHooks needs Node 22.15 or later; this is ${process.versions.node})\n`);
  process.exit(0);
}
const probe = `
  const seen = [];
  require("node:module").registerHooks({
    load(url, context, nextLoad) {
      if (url.startsWith("file:")) seen.push(require("node:url").fileURLToPath(url));
      return nextLoad(url, context);
    },
  });
  process.argv = [process.argv[0], ${JSON.stringify(cli)}, "status", "--json"];
  require(${JSON.stringify(cli)});
  process.on("exit", () => {
    if (!seen.some((f) => /[\\\\/]dist[\\\\/]cli\\.js$/.test(f))) throw new Error("the load hook saw no dist module");
    const loaded = seen.filter((f) => /[\\\\/]dist[\\\\/]shell[\\\\/](report-view-cli|operator-ux|run-store)\\.js$/.test(f));
    process.stderr.write("LOADED=" + JSON.stringify(loaded));
  });
`;
const r = spawnSync(process.execPath, ["-e", probe], { encoding: "utf8", env: { ...process.env, NO_COLOR: "1" } });
assert.equal(r.status, 0, r.stderr);
assert.deepEqual(JSON.parse(r.stdout), { runId: null, nextActions: expected });
assert.deepEqual(JSON.parse(r.stderr.split("LOADED=")[1]), [], "no run-reading module loads for a no-run status");

process.stdout.write("advise-no-run: ok\n");
